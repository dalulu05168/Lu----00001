const MARKETS=new Set(["US","HK","CN","MY"]);
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
function unavailable(reason){throw Object.assign(new Error(reason),{reason});}
function integer(value,{positive=false}={}){
 if(typeof value==="number"&&!Number.isSafeInteger(value))unavailable("INVALID_RECORDS");
 if(!["string","number"].includes(typeof value)||!/^\d+$/.test(String(value)))unavailable("INVALID_RECORDS");
 const result=BigInt(value);
 if(result>MAX||(positive&&result===0n))unavailable("INVALID_RECORDS");
 return result;
}
function identity(row){
 if(row?.market==="PRODUCT"&&typeof row.symbol==="string"&&/^[0-9a-f-]{36}$/i.test(row.symbol))
  return "PRODUCT:"+row.symbol;
 if(!row||!MARKETS.has(row.market)||typeof row.symbol!=="string"||!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(row.symbol))
  unavailable("INVALID_RECORDS");
 return row.market+":"+row.symbol;
}
function safeNumber(value){if(value>MAX||value< -MAX)unavailable("AMOUNT_OVERFLOW");return Number(value);}

/** Full ledger-ordered INTERNAL_ONLY records; no market quotes or fee/tax assumptions. */
export function calculateAccountAnalytics({cashCents,positions,orders,now=new Date()}){
 const instant=new Date(now);
 if(!Number.isFinite(instant.getTime()))throw new Error("Invalid analytics time");
 const result={currency:"USD",method:"FIFO",basis:"INTERNAL_GROSS",reportingTimeZone:"UTC",
  orderBasis:"CASH_LEDGER_ID",periodBasis:"ORDER_CREATED_AT",
  asOf:instant.toISOString(),historyAvailable:false,reason:null,
  orderCount:Array.isArray(orders)?orders.length:0,holdingCount:null,
  buyVolumeCents:null,sellVolumeCents:null,volumeCents:null,
  realizedPnlCents:null,dayRealizedPnlCents:null,monthRealizedPnlCents:null,
  positionCostCents:null,portfolioValueCents:null};
 try{
  if(!Array.isArray(positions)||!Array.isArray(orders))unavailable("INVALID_RECORDS");
  const cash=integer(cashCents),current=new Map();
  for(const row of positions){
   const key=identity(row),quantity=integer(row.quantity);
   if(current.has(key))unavailable("INVALID_RECORDS");
   if(quantity>0n)current.set(key,quantity);
  }
  result.holdingCount=current.size;
  if(current.size===0)result.portfolioValueCents=Number(cash);
  let bought=0n,sold=0n,previousSequence=0n;
  const history=orders.map(row=>{
   const key=identity(row),quantity=integer(row.quantity,{positive:true});
   const amount=integer(row.amount_usd_cents,{positive:true});
   const timestamp=row.created_at instanceof Date?row.created_at.getTime():
    typeof row.created_at==="string"?Date.parse(row.created_at):NaN;
   if(!["BUY","SELL"].includes(row.side)||!Number.isFinite(timestamp)||timestamp>instant.getTime())
    unavailable("INVALID_RECORDS");
   if(!["number","string"].includes(typeof row.ledger_sequence)||
    (typeof row.ledger_sequence==="number"&&!Number.isSafeInteger(row.ledger_sequence))||
    !/^\d+$/.test(String(row.ledger_sequence)))unavailable("LEDGER_HISTORY_UNAVAILABLE");
   const sequence=BigInt(row.ledger_sequence);
   if(sequence<=previousSequence)unavailable("LEDGER_HISTORY_UNAVAILABLE");
   previousSequence=sequence;
   if(!["number","string"].includes(typeof row.ledger_delta_cents)||
    (typeof row.ledger_delta_cents==="number"&&!Number.isSafeInteger(row.ledger_delta_cents))||
    !/^-?\d+$/.test(String(row.ledger_delta_cents))||
    BigInt(row.ledger_delta_cents)!==(row.side==="BUY"?-amount:amount))unavailable("LEDGER_HISTORY_UNAVAILABLE");
   if(row.side==="BUY")bought+=amount;else sold+=amount;
   return {key,quantity,amount,side:row.side,date:new Date(timestamp).toISOString()};
  });
  result.buyVolumeCents=safeNumber(bought);result.sellVolumeCents=safeNumber(sold);
  result.volumeCents=safeNumber(bought+sold);
  const lots=new Map();let realized=0n,day=0n,month=0n;
  for(const row of history){
   if(!lots.has(row.key))lots.set(row.key,{items:[],head:0});
   const queue=lots.get(row.key);
   if(row.side==="BUY"){
    queue.items.push({quantity:row.quantity,cost:row.amount,consumed:0n,allocated:0n});continue;
   }
   let remaining=row.quantity,cost=0n;
   while(remaining>0n){
    const lot=queue.items[queue.head];if(!lot)unavailable("INCOMPLETE_HISTORY");
    const available=lot.quantity-lot.consumed,take=remaining<available?remaining:available;
    lot.consumed+=take;
    // Cumulative allocation conserves the original lot cost across partial sells.
    const allocation=lot.cost*lot.consumed/lot.quantity;
    cost+=allocation-lot.allocated;lot.allocated=allocation;remaining-=take;
    if(lot.consumed===lot.quantity)queue.head++;
   }
   const profit=row.amount-cost;realized+=profit;
   if(row.date.slice(0,10)===result.asOf.slice(0,10))day+=profit;
   if(row.date.slice(0,7)===result.asOf.slice(0,7))month+=profit;
  }
  let remainingCost=0n;const reconstructed=new Map();
  for(const [key,queue] of lots){
   let quantity=0n;
   for(let index=queue.head;index<queue.items.length;index++){
    const lot=queue.items[index];quantity+=lot.quantity-lot.consumed;remainingCost+=lot.cost-lot.allocated;
   }
   if(quantity>0n)reconstructed.set(key,quantity);
  }
  if(reconstructed.size!==current.size||[...reconstructed].some(([key,quantity])=>current.get(key)!==quantity))
   unavailable("POSITION_HISTORY_MISMATCH");
  // Convert all values first, so an overflow never returns a partial P/L result.
  const values=[realized,day,month,remainingCost].map(safeNumber);
  [result.realizedPnlCents,result.dayRealizedPnlCents,result.monthRealizedPnlCents,result.positionCostCents]=values;
  result.historyAvailable=true;
 }catch(error){
  if(!error.reason)throw error;
  result.reason=error.reason;
 }
 return result;
}

/** All reads share one snapshot; caller must derive accountId from the session. */
export async function getAccountAnalytics(db,accountId,{now}={}){
 const client=await db.connect();let active=false;
 try{
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");active=true;
  const account=await client.query("SELECT cash_cents,clock_timestamp() AS as_of FROM accounts WHERE id=$1",[accountId]);
  if(account.rows.length!==1)throw Object.assign(new Error("Account not found"),{statusCode:404});
  const positions=await client.query("SELECT market,symbol,quantity FROM positions WHERE account_id=$1 AND quantity>0 "+
   "UNION ALL SELECT 'PRODUCT',terms_id::text,quantity FROM internal_product_positions WHERE account_id=$1",[accountId]);
  const orders=await client.query("SELECT o.market,o.symbol,o.side,o.quantity,o.amount_usd_cents,o.created_at,"+
   "l.id AS ledger_sequence,l.delta_cents AS ledger_delta_cents FROM orders o "+
   "LEFT JOIN cash_ledger l ON l.order_id=o.id AND l.account_id=o.account_id "+
   "WHERE o.account_id=$1 UNION ALL "+
   "SELECT 'PRODUCT',p.terms_id::text,'BUY',p.quantity,p.total_cents,p.created_at,l.id,l.delta_cents "+
   "FROM internal_purchases p LEFT JOIN cash_ledger l ON l.internal_purchase_id=p.id AND l.account_id=p.account_id "+
   "WHERE p.account_id=$1 ORDER BY ledger_sequence ASC NULLS LAST",[accountId]);
  const result=calculateAccountAnalytics({cashCents:account.rows[0].cash_cents,positions:positions.rows,orders:orders.rows,
   now:now??account.rows[0].as_of??new Date()});
  await client.query("COMMIT");active=false;return result;
 }catch(error){if(active)await client.query("ROLLBACK");throw error;}
 finally{client.release();}
}
