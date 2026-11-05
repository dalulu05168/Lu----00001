import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApi} from '../src/http-api.mjs';
import {createCommodityProduct} from '../src/commodity-products.mjs';
import {createListing} from '../src/admin-service.mjs';
import {readAdminProductTerms,updateAdminProductTerms,listPublishedInternalProducts} from '../src/internal-products.mjs';
import {buyInternalProduct,internalPurchaseAccount} from '../src/internal-purchases.mjs';
import {getClientAppMirror} from '../src/admin-mirror.mjs';
import {listUnifiedAudit} from '../src/operation-audit.mjs';
import {getAccountAnalytics} from '../src/account-analytics.mjs';
import {settleDueFunds} from '../src/fund-maturities.mjs';
import {sellInternalStock} from '../src/internal-stock-sales.mjs';
import {setStockPositionLock} from '../src/stock-position-locks.mjs';
export async function verifyInternalProducts(){
 const getStockQuote=async({market,symbol})=>({market,symbol,priceCents:10000,timestampMs:Date.now(),source:'Synthetic test feed'});
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});
 let app;
 try{
  const masterId=(await db.query("SELECT user_id FROM admin_roles WHERE role='MASTER'")).rows[0].user_id;
  const actor={role:'MASTER',userId:masterId},userId=randomUUID(),accountId=randomUUID(),otherId=randomUUID();
  await db.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3),($4,$5,$3)',[userId,userId+'@example.test','synthetic-only',otherId,otherId+'@example.test']);
  await db.query('INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,100000),($3,$3,0)',[accountId,userId,otherId]);
  await db.query('INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,100000,100000)',[accountId]);
  const commodity=await createCommodityProduct(db,actor,{sku:'T'+randomUUID().slice(0,8).toUpperCase(),name:'Synthetic metal',unit:'份额',category:'PRECIOUS_METAL',minimumQuantity:1,status:'PUBLISHED',reason:'Synthetic internal product integration setup'});
  const entries=[{kind:'COMMODITY',id:commodity.id}];
  for(const itemType of ['STOCK','FUND','IPO']){
   const listing=await createListing(db,actor,{itemType,market:'US',symbol:'T'+randomUUID().slice(0,8).toUpperCase(),name:'Synthetic '+itemType,status:'PUBLISHED'});
   entries.push({kind:'LISTING',id:listing.id,itemType});
  }
  const configured=[];
  for(const entry of entries){
   const before=await readAdminProductTerms(db,actor,entry.kind,entry.id);assert.equal(before.tradingEnabled,false);
   const item=await updateAdminProductTerms(db,actor,{kind:entry.kind,id:entry.id,expectedVersion:0,tradingEnabled:true,internalPriceCents:10000,discountBps:1000,participationPassword:'001234',reason:'',
    ...(entry.itemType==='FUND'?{fundDays:30,fundReturnBps:500,fundImageUrl:'https://example.test/cover.jpg'}:{})});
   assert.equal(item.passwordConfigured,true);assert.equal(JSON.stringify(item).includes('hash'),false);assert.equal(JSON.stringify(item).includes('001234'),false);
   configured.push(item);
  }
  const first=configured[0],request={termsId:first.termsId,termsVersion:first.termsVersion,quantity:2,participationPassword:'001234'};
  const key=randomUUID();const concurrent=await Promise.all([buyInternalProduct(db,accountId,key,request),buyInternalProduct(db,accountId,key,request)]);
  assert.deepEqual(concurrent.map(x=>x.replayed).sort(),[false,true]);
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'82000');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM internal_purchases WHERE account_id=$1',[accountId])).rows[0].n,1);
  await assert.rejects(buyInternalProduct(db,accountId,key,{...request,quantity:3}),e=>e.statusCode===409);
  await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),{...request,termsVersion:99}),e=>e.statusCode===409);
  await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),{...request,quantity:100}),e=>e.statusCode===409);
  await assert.rejects(updateAdminProductTerms(db,{role:'SUBADMIN',userId:otherId},{...entries[0],expectedVersion:1}),e=>e.statusCode===403);
  for(let n=0;n<5;n++)await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),{...request,participationPassword:'999999'}),e=>e.statusCode===403);
  await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),request),e=>e.statusCode===429);
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'82000');
  await db.query("UPDATE internal_purchase_attempts SET blocked_until=now()-interval '1 second' WHERE account_id=$1",[accountId]);
  for(const item of configured.slice(1))await buyInternalProduct(db,accountId,randomUUID(),{...request,termsId:item.termsId,confirmedStockPriceCents:10000},undefined,{getStockQuote});
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'28000');
  const records=await internalPurchaseAccount(db,accountId);assert.equal(records.positions.length,4);assert.equal(records.purchases.length,4);
  const analytics=await getAccountAnalytics(db,accountId);
  assert.equal(analytics.orderCount,4);
  assert.equal(analytics.historyAvailable,true);
  assert.equal(analytics.buyVolumeCents,72000);
  assert.equal(analytics.positionCostCents,72000);
  assert.deepEqual(new Set(records.purchases.map(x=>x.item_type)),new Set(['COMMODITY','STOCK','FUND','IPO']));
  assert.ok(records.purchases.every(x=>x.total_cents==='18000'&&x.unit_price_cents==='9000'));
  const changed=await updateAdminProductTerms(db,actor,{...entries[0],expectedVersion:1,discountBps:2000,reason:'Synthetic version update preserving existing participation hash'});
  assert.equal(changed.passwordConfigured,true);assert.equal(changed.termsVersion,2);
  await assert.rejects(updateAdminProductTerms(db,actor,{...entries[0],expectedVersion:1,discountBps:0,reason:'Synthetic stale administrator edit must be rejected'}),e=>e.statusCode===409);
  await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),request),e=>e.statusCode===409);
  await db.query("UPDATE commodity_products SET status='ARCHIVED' WHERE id=$1",[entries[0].id]);
  assert.equal((await listPublishedInternalProducts(db)).some(x=>x.termsId===first.termsId),false);
  await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),{...request,termsVersion:2}),e=>e.statusCode===409);
  const purchaseIds=records.purchases.map(x=>x.id);
  const ledger=(await db.query('SELECT count(*)::int AS n,sum(delta_cents)::text AS total FROM cash_ledger WHERE internal_purchase_id=ANY($1::uuid[])',[purchaseIds])).rows[0];
  assert.deepEqual(ledger,{n:4,total:'-72000'});
  const fault='internal_buy_fault_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.account_id='${accountId}'::uuid AND NEW.internal_purchase_id IS NOT NULL THEN RAISE EXCEPTION 'synthetic purchase ledger failure'; END IF; RETURN NEW; END $$`);
  try{
   await db.query(`CREATE TRIGGER ${fault} BEFORE INSERT ON cash_ledger FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
   await assert.rejects(buyInternalProduct(db,accountId,randomUUID(),{...request,termsId:configured[3].termsId,quantity:1}),/synthetic purchase ledger failure/);
   assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'28000');
   assert.equal((await internalPurchaseAccount(db,accountId)).purchases.length,4);
   assert.equal((await db.query('SELECT quantity FROM internal_product_positions WHERE account_id=$1 AND terms_id=$2',[accountId,configured[3].termsId])).rows[0].quantity,'2');
  }finally{
   await db.query(`DROP TRIGGER IF EXISTS ${fault} ON cash_ledger`);await db.query(`DROP FUNCTION ${fault}()`);
  }
  const mirror=await getClientAppMirror(db,actor,userId);
  assert.equal(mirror.internalProducts.positions.length,4);assert.equal(mirror.internalProducts.purchases.length,4);
  await assert.rejects(getClientAppMirror(db,{role:'SUBADMIN',userId:otherId},userId),e=>e.statusCode===404);
  const audit=await listUnifiedAudit(db,actor,{limit:200});
  assert.ok(audit.items.some(x=>x.eventType==='PRODUCT_TERMS'));
  assert.ok(audit.items.some(x=>x.eventType==='INTERNAL_PURCHASE'&&x.clientId===userId));
  assert.equal((await listUnifiedAudit(db,{role:'SUBADMIN',userId:otherId},{limit:200})).items.some(x=>x.eventType==='PRODUCT_TERMS'||x.clientId===userId),false);
  // Actual HTTP ownership boundary, without logging or exporting a production credential.
  app=createApi({db,getStockQuote,resolveSession:async token=>token==='synthetic-master'?{userId:masterId,adminVerified:true}:token==='synthetic-owner'?{userId,accountId}:token==='synthetic-other'?{userId:otherId,accountId:otherId}:null});
  await new Promise(done=>app.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+app.address().port;
  assert.equal((await fetch(origin+'/api/internal-purchases')).status,401);
  const other=await (await fetch(origin+'/api/internal-purchases',{headers:{authorization:'Bearer synthetic-other'}})).json();
  assert.deepEqual(other.purchases,[]);assert.deepEqual(other.positions,[]);
  const publicProducts=await (await fetch(origin+'/api/internal-products',{headers:{authorization:'Bearer synthetic-owner'}})).json();
  assert.equal(JSON.stringify(publicProducts).includes('participation_password_hash'),false);
  const purchaseTerms={internalPriceCents:10000,discountBps:1000,participationPassword:'001234'};
  const listingInput={itemType:'STOCK',market:'US',symbol:'T'+randomUUID().slice(0,8).toUpperCase(),name:'Quick listing',status:'PUBLISHED'};
  const commodityInput={sku:'T'+randomUUID().slice(0,8).toUpperCase(),name:'Quick commodity',unit:'份额',category:'PRECIOUS_METAL',minimumQuantity:1,status:'PUBLISHED',reason:'Synthetic quick commodity creation'};
  const invalidTerms={...purchaseTerms,participationPassword:'12345'};
  await assert.rejects(createListing(db,actor,{...listingInput,purchaseTerms:invalidTerms}),e=>e.statusCode===400);
  await assert.rejects(createCommodityProduct(db,actor,{...commodityInput,purchaseTerms:invalidTerms}),e=>e.statusCode===400);
  assert.equal((await db.query('SELECT id FROM listings WHERE symbol=$1',[listingInput.symbol])).rowCount,0);
  assert.equal((await db.query('SELECT id FROM commodity_products WHERE sku=$1',[commodityInput.sku])).rowCount,0);
  const quickListing=await createListing(db,actor,{...listingInput,purchaseTerms:{...purchaseTerms,minimumQuantity:2,stockHoldingDays:7}});
  const quickCommodity=await createCommodityProduct(db,actor,{...commodityInput,purchaseTerms});
  const available=await listPublishedInternalProducts(db);
  for(const [kind,id] of [['LISTING',quickListing.id],['COMMODITY',quickCommodity.id]]){
   const terms=await readAdminProductTerms(db,actor,kind,id);
   assert.equal(terms.tradingEnabled,true);
   assert.equal(terms.passwordConfigured,true);
   assert.ok(available.some(product=>product.termsId===terms.termsId&&product.minimumQuantity===(kind==='LISTING'?2:1)));
  }
  const terms=await readAdminProductTerms(db,actor,'LISTING',quickListing.id);
  const keyForMirror=randomUUID();
  const mirrorOrder={clientId:userId,termsId:terms.termsId,termsVersion:terms.termsVersion,quantity:2,confirmedStockPriceCents:10000,
   participationPassword:'001234',confirmed:true,confirmPassword:'replacement-master-password-2026'};
  const submitMirror=(body,token='synthetic-master')=>fetch(origin+'/api/admin/mirror-purchases',{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':keyForMirror},body:JSON.stringify(body)});
  assert.equal((await submitMirror(mirrorOrder,'synthetic-owner')).status,403);
  assert.equal((await submitMirror({...mirrorOrder,confirmPassword:'synthetic-invalid-password'})).status,401);
  assert.equal((await submitMirror({...mirrorOrder,clientId:masterId})).status,404);
  assert.equal((await submitMirror({...mirrorOrder,quantity:1})).status,400);
  const wrongPin=await submitMirror({...mirrorOrder,participationPassword:'999999'});
  assert.equal(wrongPin.status,403);
  assert.equal((await wrongPin.json()).error,'Participation password is incorrect');
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'28000');
  const placed=await submitMirror(mirrorOrder);assert.equal(placed.status,201);
  const {id}=await placed.json();
  assert.ok((await db.query('SELECT stock_unlock_at,stock_quote_source FROM internal_purchases WHERE id=$1',[id])).rows[0].stock_unlock_at);
  assert.equal((await submitMirror(mirrorOrder)).status,200);
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'10000');
  assert.deepEqual((await db.query('SELECT actor_user_id,client_user_id FROM admin_mirror_purchase_audit WHERE purchase_id=$1',[id])).rows,
   [{actor_user_id:masterId,client_user_id:userId}]);
  const delegated=(await listUnifiedAudit(db,actor,{limit:200})).items.find(item=>item.eventId===id);
  assert.equal(delegated.actorId,masterId);
  const fund=records.purchases.find(item=>item.item_type==='FUND');
  assert.equal(fund.term_days,30);
  assert.equal(fund.return_bps,500);
  assert.equal(fund.profit_cents,'900');
  const fundListing=entries.find(item=>item.itemType==='FUND');
  await updateAdminProductTerms(db,actor,{kind:'LISTING',id:fundListing.id,expectedVersion:1,fundDays:60,fundReturnBps:1200});
  assert.deepEqual(await settleDueFunds(db),{settled:0,failed:0});
  await db.query("UPDATE fund_maturities SET due_at=now()-interval '1 second' WHERE purchase_id=$1",[fund.id]);
  const batches=await Promise.all([settleDueFunds(db),settleDueFunds(db)]);
  assert.equal(batches.reduce((sum,result)=>sum+result.settled,0),1);
  assert.ok(batches.every(result=>result.failed===0));
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'28900');
  const settled=await internalPurchaseAccount(db,accountId);
  assert.ok(!settled.positions.some(position=>position.terms_id===fund.terms_id));
  assert.equal(settled.settlements.length,1);
  assert.equal(settled.settlements[0].profit_cents,'900');
  const settledAnalytics=await getAccountAnalytics(db,accountId);
  assert.equal(settledAnalytics.historyAvailable,true);
  assert.equal(settledAnalytics.realizedPnlCents,900);
  const sellBody={symbol:listingInput.symbol,quantity:1,confirmedStockPriceCents:10000};
  const saleKey=randomUUID(),lockBody={clientId:userId,market:'US',symbol:listingInput.symbol,locked:true,expectedVersion:0,
   confirmPassword:mirrorOrder.confirmPassword};
  await assert.rejects(sellInternalStock(db,accountId,saleKey,sellBody,{getStockQuote}),/Insufficient unlocked stock quantity/);
  const sub=(await db.query("SELECT user_id FROM admin_roles WHERE role='SUBADMIN' ORDER BY user_id LIMIT 1")).rows[0];
  if(sub){
   await assert.rejects(setStockPositionLock(db,{role:'SUBADMIN',userId:sub.user_id},{...lockBody,confirmPassword:'testing-subadmin-pass-2026'}),e=>e.statusCode===404);
  }
  await setStockPositionLock(db,actor,lockBody);
  await assert.rejects(sellInternalStock(db,accountId,saleKey,sellBody,{getStockQuote}),/Stock position is locked/);
  await setStockPositionLock(db,actor,{...lockBody,locked:false,expectedVersion:1});
  await assert.rejects(sellInternalStock(db,accountId,saleKey,sellBody,{getStockQuote}),/Insufficient unlocked stock quantity/);
  await db.query("UPDATE internal_purchases SET stock_unlock_at=now()-interval '1 second' WHERE id=$1",[id]);
  await assert.rejects(sellInternalStock(db,accountId,saleKey,{...sellBody,confirmedStockPriceCents:9999},{getStockQuote}),/Stock price changed/);
  const sale=await sellInternalStock(db,accountId,saleKey,sellBody,{getStockQuote});
  assert.equal(sale.cashCents,38900);
  assert.equal((await sellInternalStock(db,accountId,saleKey,sellBody,{getStockQuote})).replayed,true);
  const saleAnalytics=await getAccountAnalytics(db,accountId);
  assert.equal(saleAnalytics.historyAvailable,true);
  assert.equal(saleAnalytics.realizedPnlCents,1900);
  assert.equal(saleAnalytics.orderCount,7);
  const nextLot=await buyInternalProduct(db,accountId,randomUUID(),{
   termsId:terms.termsId,termsVersion:terms.termsVersion,quantity:2,participationPassword:'001234',confirmedStockPriceCents:10000
  },undefined,{getStockQuote});
  await db.query("UPDATE internal_purchases SET stock_unlock_at=now()-interval '1 second' WHERE id=$1",[nextLot.purchase.id]);
  const multiLot=await sellInternalStock(db,accountId,randomUUID(),{...sellBody,quantity:3},{getStockQuote});
  assert.equal(multiLot.cashCents,50900);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM internal_stock_sale_lots WHERE sale_id=$1',[multiLot.sale.id])).rows[0].n,2);
  const finalAnalytics=await getAccountAnalytics(db,accountId);
  assert.equal(finalAnalytics.historyAvailable,true);
  assert.equal(finalAnalytics.realizedPnlCents,4900);
  assert.equal(finalAnalytics.orderCount,9);
 }finally{if(app)await new Promise(done=>app.close(done));await db.end();}
}
