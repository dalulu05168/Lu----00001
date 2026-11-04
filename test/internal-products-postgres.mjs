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
export async function verifyInternalProducts(){
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
   entries.push({kind:'LISTING',id:listing.id});
  }
  const configured=[];
  for(const entry of entries){
   const before=await readAdminProductTerms(db,actor,entry.kind,entry.id);assert.equal(before.tradingEnabled,false);
   const item=await updateAdminProductTerms(db,actor,{...entry,expectedVersion:0,tradingEnabled:true,internalPriceCents:10000,discountBps:1000,participationPassword:'001234',reason:'Synthetic exact discount and participation configuration'});
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
  for(const item of configured.slice(1))await buyInternalProduct(db,accountId,randomUUID(),{...request,termsId:item.termsId});
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'28000');
  const records=await internalPurchaseAccount(db,accountId);assert.equal(records.positions.length,4);assert.equal(records.purchases.length,4);
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
  app=createApi({db,resolveSession:async token=>token==='synthetic-owner'?{userId,accountId}:token==='synthetic-other'?{userId:otherId,accountId:otherId}:null});
  await new Promise(done=>app.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+app.address().port;
  assert.equal((await fetch(origin+'/api/internal-purchases')).status,401);
  const other=await (await fetch(origin+'/api/internal-purchases',{headers:{authorization:'Bearer synthetic-other'}})).json();
  assert.deepEqual(other.purchases,[]);assert.deepEqual(other.positions,[]);
  const publicProducts=await (await fetch(origin+'/api/internal-products',{headers:{authorization:'Bearer synthetic-owner'}})).json();
  assert.equal(JSON.stringify(publicProducts).includes('participation_password_hash'),false);
 }finally{if(app)await new Promise(done=>app.close(done));await db.end();}
}
