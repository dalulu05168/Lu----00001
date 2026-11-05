import {randomUUID} from 'node:crypto';
import {purchaseQuote,checkParticipationPassword,productError} from './internal-products.mjs';
import {fundPayout} from './fund-maturities.mjs';
import {getUsStockQuote} from './us-stock-quotes.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function buyInternalProduct(db,accountId,key,body,delegation,{getStockQuote=getUsStockQuote}={}){
 if(!UUID.test(accountId??'')||typeof key!=='string'||key.length<8||key.length>128)throw productError('Invalid purchase reference');
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['termsId','quantity','termsVersion','participationPassword','confirmedStockPriceCents'].includes(k)))throw productError('Invalid purchase fields');
 if(!UUID.test(body.termsId??'')||!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>1000000||!Number.isSafeInteger(body.termsVersion)||body.termsVersion<1||typeof body.participationPassword!=='string'||!/^\d{6}$/.test(body.participationPassword))throw productError('Invalid purchase fields');
 const c=await db.connect();let active=false;
 try{
  await c.query('BEGIN');active=true;
  if(delegation){
   const target=await c.query(`SELECT a.id FROM accounts a JOIN app_users u ON u.id=a.user_id
    WHERE a.id=$1 AND u.id=$2 AND NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id=u.id)
    FOR SHARE OF u`,[accountId,delegation.clientId]);
   if(target.rows.length!==1)throw productError('Client not found',404);
  }
  const account=(await c.query('SELECT cash_cents FROM accounts WHERE id=$1 FOR UPDATE',[accountId])).rows[0];
  if(!account)throw productError('Account not found',404);
  const old=(await c.query('SELECT * FROM internal_purchases WHERE account_id=$1 AND idempotency_key=$2',[accountId,key])).rows[0];
  if(old){
   if(delegation){
    const audit=await c.query('SELECT 1 FROM admin_mirror_purchase_audit WHERE purchase_id=$1 AND actor_user_id=$2',[old.id,delegation.actorId]);
    if(!audit.rows.length)throw productError('Purchase key already used',409);
   }
   if(old.terms_id!==body.termsId||Number(old.quantity)!==body.quantity||Number(old.terms_version)!==body.termsVersion)throw productError('Idempotency key already used for another purchase',409);
   await c.query('COMMIT');active=false;return {replayed:true,purchase:old};
  }
  const attempt=(await c.query('SELECT failures,blocked_until FROM internal_purchase_attempts WHERE account_id=$1',[accountId])).rows[0];
  if(attempt?.blocked_until&&new Date(attempt.blocked_until).getTime()>Date.now())throw productError('Participation password temporarily locked; retry in 15 minutes',429);
  const terms=(await c.query(`SELECT t.*,COALESCE(p.status,l.status) AS product_status,
   COALESCE(p.name,l.display_name) AS product_name,COALESCE(p.sku,l.symbol) AS product_code,
   CASE WHEN p.id IS NOT NULL THEN 'COMMODITY' ELSE l.item_type END AS item_type,
   COALESCE(p.minimum_quantity,1) AS minimum_quantity FROM internal_product_terms t
   LEFT JOIN commodity_products p ON p.id=t.commodity_id LEFT JOIN listings l ON l.id=t.listing_id
   WHERE t.id=$1`,[body.termsId])).rows[0];
  if(!terms||!terms.trading_enabled||terms.product_status!=='PUBLISHED')throw productError('Product is not available for internal purchase',409);
  // Lock publication rows too: an administrator withdrawal must serialize with this purchase.
  const source=terms.commodity_id?'commodity_products':'listings',sourceId=terms.commodity_id??terms.listing_id;
  const published=await c.query('SELECT * FROM '+source+' WHERE id=$1 FOR SHARE',[sourceId]);
  if(published.rows[0]?.status!=='PUBLISHED')throw productError('Product is not available for internal purchase',409);
  const locked=(await c.query('SELECT * FROM internal_product_terms WHERE id=$1 FOR SHARE',[body.termsId])).rows[0];
  if(!locked?.trading_enabled)throw productError('Product is not available for internal purchase',409);
  Object.assign(terms,locked,{minimum_quantity:terms.commodity_id?published.rows[0].minimum_quantity:locked.minimum_quantity,
   product_name:published.rows[0].name??published.rows[0].display_name,
   product_code:published.rows[0].sku??published.rows[0].symbol,
   item_type:terms.commodity_id?'COMMODITY':published.rows[0].item_type});
  if(Number(terms.version)!==body.termsVersion)throw productError('Product terms changed; refresh and confirm the new price',409);
  if(terms.item_type==='FUND'&&terms.fund_days==null)throw productError('Fund holding period is not configured',409);
  if(body.quantity<Number(terms.minimum_quantity))throw productError('Quantity is below product minimum');
  if(!await checkParticipationPassword(body.participationPassword,terms.participation_password_hash)){
   await c.query(`INSERT INTO internal_purchase_attempts(account_id,failures,blocked_until) VALUES($1,1,NULL)
    ON CONFLICT(account_id) DO UPDATE SET failures=CASE WHEN internal_purchase_attempts.updated_at<now()-interval '15 minutes' THEN 1 ELSE LEAST(internal_purchase_attempts.failures+1,5) END,
    blocked_until=CASE WHEN internal_purchase_attempts.updated_at>=now()-interval '15 minutes' AND internal_purchase_attempts.failures>=4 THEN now()+interval '15 minutes' ELSE NULL END,updated_at=now()`,[accountId]);
   await c.query('COMMIT');active=false;
   throw Object.assign(productError('Participation password is incorrect',403),{code:'PARTICIPATION_PASSWORD_INCORRECT'});
  }
  if(terms.item_type==='STOCK'&&published.rows[0].market!=='US')throw productError('This stock market is not enabled for real-time trading',503);
  const stockQuote=terms.item_type==='STOCK'?await getStockQuote({market:published.rows[0].market,symbol:terms.product_code}):null;
  if(stockQuote&&body.confirmedStockPriceCents!==stockQuote.priceCents)throw productError('Stock price changed; refresh the quote and confirm again',409);
  const quote=purchaseQuote(stockQuote?.priceCents??Number(terms.price_cents),Number(terms.discount_bps),body.quantity);
  const balance=BigInt(account.cash_cents)-BigInt(quote.totalCents);
  if(balance<0n)throw productError('Insufficient internal balance',409);
  const existingPosition=(await c.query('SELECT quantity,cost_cents FROM internal_product_positions WHERE account_id=$1 AND terms_id=$2',[accountId,body.termsId])).rows[0];
  if(BigInt(existingPosition?.quantity??0)+BigInt(body.quantity)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(existingPosition?.cost_cents??0)+BigInt(quote.totalCents)>BigInt(Number.MAX_SAFE_INTEGER))throw productError('Internal position limit exceeded',409);
  const purchase=(await c.query(`INSERT INTO internal_purchases(id,account_id,terms_id,idempotency_key,quantity,original_price_cents,discount_bps,unit_price_cents,total_cents,terms_version,product_name,product_code,item_type,stock_unlock_at,stock_quote_at,stock_quote_source)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $14::integer>0 THEN now()+($14*interval '24 hours') END,$15,$16) RETURNING *`,
   [randomUUID(),accountId,body.termsId,key,body.quantity,quote.originalPriceCents,quote.discountBps,quote.unitPriceCents,quote.totalCents,body.termsVersion,terms.product_name,terms.product_code,terms.item_type,terms.stock_holding_days,
    stockQuote?new Date(stockQuote.timestampMs):null,stockQuote?.source??null])).rows[0];
  if(terms.item_type==='FUND')await c.query(`INSERT INTO fund_maturities(purchase_id,due_at,term_days,return_bps,profit_cents)
   VALUES($1,$2::timestamptz+($3::integer*interval '24 hours'),$3,$4,$5)`,
   [purchase.id,purchase.created_at,terms.fund_days,terms.fund_return_bps,String(fundPayout(quote.totalCents,terms.fund_return_bps))]);
  await c.query('UPDATE accounts SET cash_cents=$2 WHERE id=$1',[accountId,balance.toString()]);
  await c.query(`INSERT INTO internal_product_positions(account_id,terms_id,quantity,cost_cents) VALUES($1,$2,$3,$4)
   ON CONFLICT(account_id,terms_id) DO UPDATE SET quantity=internal_product_positions.quantity+EXCLUDED.quantity,cost_cents=internal_product_positions.cost_cents+EXCLUDED.cost_cents`,[accountId,body.termsId,body.quantity,quote.totalCents]);
  await c.query('INSERT INTO cash_ledger(account_id,internal_purchase_id,delta_cents,balance_after_cents) VALUES($1,$2,$3,$4)',[accountId,purchase.id,-quote.totalCents,balance.toString()]);
  if(delegation)await c.query('INSERT INTO admin_mirror_purchase_audit(purchase_id,actor_user_id,client_user_id) VALUES($1,$2,$3)',
   [purchase.id,delegation.actorId,delegation.clientId]);
  await c.query('DELETE FROM internal_purchase_attempts WHERE account_id=$1',[accountId]);
  await c.query('COMMIT');active=false;return {replayed:false,purchase,cashCents:Number(balance)};
 }catch(error){if(active)await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function readInternalPurchaseRows(db,accountId){
  const positions=await db.query(`SELECT v.terms_id,v.quantity,v.cost_cents,COALESCE(p.name,l.display_name) AS name,
   COALESCE(p.sku,l.symbol) AS code,l.market,l.symbol,l.item_type,COALESCE(k.locked,false) AS manually_locked,COALESCE(k.version,0) AS lock_version
   ,CASE WHEN l.item_type='STOCK' THEN COALESCE(s.unlocked_quantity,0) END AS unlocked_quantity
   FROM internal_product_positions v JOIN internal_product_terms t ON t.id=v.terms_id
   LEFT JOIN commodity_products p ON p.id=t.commodity_id LEFT JOIN listings l ON l.id=t.listing_id
   LEFT JOIN stock_position_locks k ON k.account_id=v.account_id AND k.market=l.market AND k.symbol=l.symbol
   LEFT JOIN LATERAL (
    SELECT sum(b.quantity-COALESCE((SELECT sum(x.quantity) FROM internal_stock_sale_lots x WHERE x.purchase_id=b.id),0)) AS unlocked_quantity
    FROM internal_purchases b WHERE b.account_id=v.account_id AND b.terms_id=v.terms_id AND b.item_type='STOCK'
      AND (b.stock_unlock_at IS NULL OR b.stock_unlock_at<=now())
   ) s ON l.item_type='STOCK'
   WHERE v.account_id=$1 ORDER BY v.terms_id`,[accountId]);
  const purchases=await db.query(`SELECT p.*,m.due_at,m.settled_at,m.term_days,m.return_bps,m.profit_cents
   FROM internal_purchases p LEFT JOIN fund_maturities m ON m.purchase_id=p.id
   WHERE p.account_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 100`,[accountId]);
  const settlements=await db.query(`SELECT p.id,p.product_code,p.product_name,p.quantity,p.total_cents,
    m.profit_cents,m.settled_at FROM fund_maturities m JOIN internal_purchases p ON p.id=m.purchase_id
    WHERE p.account_id=$1 AND m.settled_at IS NOT NULL ORDER BY m.settled_at DESC,p.id DESC LIMIT 100`,[accountId]);
  const sales=await db.query("SELECT * FROM internal_stock_sales WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",[accountId]);
  return {positions:positions.rows,purchases:purchases.rows,settlements:settlements.rows,sales:sales.rows,execution:'INTERNAL_ONLY'};
}
export async function internalPurchaseAccount(db,accountId){
 const c=await db.connect();let active=false;
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
  const result=await readInternalPurchaseRows(c,accountId);
  await c.query('COMMIT');active=false;return result;
 }catch(error){if(active)await c.query('ROLLBACK');throw error;}finally{c.release();}
}
