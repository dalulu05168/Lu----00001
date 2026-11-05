import {randomUUID} from "node:crypto";
import {productError} from "./internal-products.mjs";
import {getUsStockQuote} from "./us-stock-quotes.mjs";

const max=BigInt(Number.MAX_SAFE_INTEGER);
export async function sellInternalStock(db,accountId,key,body,{getStockQuote=getUsStockQuote}={}){
 if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).some(k=>!["symbol","quantity","confirmedStockPriceCents"].includes(k))||
    typeof key!=="string"||key.length<8||key.length>128||
    typeof body.symbol!=="string"||!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(body.symbol)||
    !Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>1000000||
    !Number.isSafeInteger(body.confirmedStockPriceCents)||body.confirmedStockPriceCents<1)
  throw productError("Invalid stock sale");
 const {symbol,quantity,confirmedStockPriceCents}=body;
 // Quote before locking the account; any failure is raised at the original step.
 const prefetched=await getStockQuote({market:"US",symbol}).then(quote=>({quote}),error=>({error}));
 const c=await db.connect();
 try{
  await c.query("BEGIN");
  const account=(await c.query("SELECT cash_cents FROM accounts WHERE id=$1 FOR UPDATE",[accountId])).rows[0];
  if(!account)throw productError("Account not found",404);
  const old=(await c.query("SELECT * FROM internal_stock_sales WHERE account_id=$1 AND idempotency_key=$2",[accountId,key])).rows[0];
  if(old){
   if(old.symbol!==symbol||Number(old.quantity)!==quantity)throw productError("Stock sale key already used",409);
   await c.query("COMMIT");return {replayed:true,sale:old};
  }
  const lock=(await c.query("SELECT locked FROM stock_position_locks WHERE account_id=$1 AND market='US' AND symbol=$2",[accountId,symbol])).rows[0];
  if(lock?.locked)throw productError("Stock position is locked",409);
  const lots=(await c.query(`SELECT p.id,p.terms_id,p.quantity,p.total_cents,
   COALESCE(s.quantity,0) AS sold_quantity
   FROM internal_purchases p JOIN internal_product_terms t ON t.id=p.terms_id
   JOIN listings l ON l.id=t.listing_id
   LEFT JOIN LATERAL (SELECT sum(quantity) AS quantity FROM internal_stock_sale_lots WHERE purchase_id=p.id) s ON true
   WHERE p.account_id=$1 AND p.item_type='STOCK' AND l.market='US' AND p.product_code=$2
   AND (p.stock_unlock_at IS NULL OR p.stock_unlock_at<=now()) AND p.quantity>COALESCE(s.quantity,0)
   ORDER BY p.created_at,p.id`,[accountId,symbol])).rows;
  let remaining=BigInt(quantity);
  const allocations=[],byTerms=new Map();
  for(const lot of lots){
   if(!remaining)break;
   const bought=BigInt(lot.quantity),sold=BigInt(lot.sold_quantity),principal=BigInt(lot.total_cents);
   const take=remaining<bought-sold?remaining:bought-sold;
   const cost=(sold+take)*principal/bought-sold*principal/bought;
   allocations.push({purchaseId:lot.id,quantity:take,cost});
   const sums=byTerms.get(lot.terms_id)??{quantity:0n,cost:0n};
   sums.quantity+=take;sums.cost+=cost;byTerms.set(lot.terms_id,sums);
   remaining-=take;
  }
  if(remaining)throw productError("Insufficient unlocked stock quantity",409);
  if(prefetched.error)throw prefetched.error;
  const quote=prefetched.quote;
  if(quote.priceCents!==confirmedStockPriceCents)throw productError("Stock price changed; refresh the quote and confirm again",409);
  const total=BigInt(quote.priceCents)*BigInt(quantity),balance=BigInt(account.cash_cents)+total;
  if(balance>max)throw productError("Stock sale amount exceeds account limit",409);
  const sale=(await c.query(`INSERT INTO internal_stock_sales(id,account_id,idempotency_key,market,symbol,quantity,
    unit_price_cents,total_cents,quote_at,quote_source) VALUES($1,$2,$3,'US',$4,$5,$6,$7,$8,$9) RETURNING *`,
   [randomUUID(),accountId,key,symbol,quantity,quote.priceCents,String(total),new Date(quote.timestampMs),quote.source])).rows[0];
  for(const lot of allocations)await c.query("INSERT INTO internal_stock_sale_lots(sale_id,purchase_id,quantity,cost_cents) VALUES($1,$2,$3,$4)",
   [sale.id,lot.purchaseId,String(lot.quantity),String(lot.cost)]);
  for(const [termsId,sums] of byTerms){
   const params=[accountId,termsId,String(sums.quantity),String(sums.cost)];
   const removed=await c.query("DELETE FROM internal_product_positions WHERE account_id=$1 AND terms_id=$2 AND quantity=$3 AND cost_cents=$4",params);
   if(!removed.rowCount){
    const reduced=await c.query("UPDATE internal_product_positions SET quantity=quantity-$3,cost_cents=cost_cents-$4 WHERE account_id=$1 AND terms_id=$2 AND quantity>$3 AND cost_cents>$4",params);
    if(!reduced.rowCount)throw Error("Stock position does not reconcile");
   }
  }
  await c.query("UPDATE accounts SET cash_cents=$2 WHERE id=$1",[accountId,String(balance)]);
  await c.query("INSERT INTO cash_ledger(account_id,internal_stock_sale_id,delta_cents,balance_after_cents) VALUES($1,$2,$3,$4)",
   [accountId,sale.id,String(total),String(balance)]);
  await c.query("COMMIT");return {replayed:false,sale,cashCents:Number(balance)};
 }catch(error){await c.query("ROLLBACK");throw error;}
 finally{c.release();}
}
