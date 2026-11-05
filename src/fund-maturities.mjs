const maxCents=BigInt(Number.MAX_SAFE_INTEGER);

export function fundPayout(principalCents,returnBps){
 const principal=BigInt(principalCents);
 const profit=(principal*BigInt(returnBps)+5000n)/10000n;
 if(principal+profit>maxCents)throw Object.assign(new Error("Fund payout exceeds account limit"),{statusCode:400});
 return profit;
}

async function settleFund(db,{purchase_id:purchaseId,account_id:accountId}){
 const c=await db.connect();
 try{
  await c.query("BEGIN");
  // All balance writers lock the account first.
  const account=(await c.query("SELECT cash_cents FROM accounts WHERE id=$1 FOR UPDATE",[accountId])).rows[0];
  const entry=(await c.query(`SELECT p.terms_id,p.quantity,p.total_cents,m.profit_cents
   FROM fund_maturities m JOIN internal_purchases p ON p.id=m.purchase_id
   WHERE m.purchase_id=$1 AND p.account_id=$2 AND m.settled_at IS NULL AND m.due_at<=now()
   FOR UPDATE OF m`,[purchaseId,accountId])).rows[0];
  if(!entry){await c.query("COMMIT");return false;}
  const position=(await c.query(`SELECT quantity,cost_cents FROM internal_product_positions
   WHERE account_id=$1 AND terms_id=$2 FOR UPDATE`,[accountId,entry.terms_id])).rows[0];
  if(!position)throw Error("Fund position missing");
  const quantity=BigInt(position.quantity)-BigInt(entry.quantity);
  const cost=BigInt(position.cost_cents)-BigInt(entry.total_cents);
  if(quantity<0n||cost<0n||(quantity===0n)!==(cost===0n))throw Error("Fund position does not reconcile");
  const amount=BigInt(entry.total_cents)+BigInt(entry.profit_cents);
  const balance=BigInt(account.cash_cents)+amount;
  if(balance>maxCents)throw Error("Fund settlement exceeds account limit");
  if(quantity===0n)await c.query("DELETE FROM internal_product_positions WHERE account_id=$1 AND terms_id=$2",[accountId,entry.terms_id]);
  else await c.query("UPDATE internal_product_positions SET quantity=$3,cost_cents=$4 WHERE account_id=$1 AND terms_id=$2",
   [accountId,entry.terms_id,String(quantity),String(cost)]);
  await c.query("UPDATE accounts SET cash_cents=$2 WHERE id=$1",[accountId,String(balance)]);
  await c.query("INSERT INTO cash_ledger(account_id,fund_maturity_id,delta_cents,balance_after_cents) VALUES($1,$2,$3,$4)",
   [accountId,purchaseId,String(amount),String(balance)]);
  await c.query("UPDATE fund_maturities SET settled_at=now() WHERE purchase_id=$1",[purchaseId]);
  await c.query("COMMIT");
  return true;
 }catch(error){
  await c.query("ROLLBACK");
  throw error;
 }finally{c.release();}
}

/**
 * Settles due fund maturities. The long-running server sweeps all accounts on a
 * timer; account reads pass accountId so serverless deployments (no timer) and
 * instances that were asleep still pay out as soon as the customer looks.
 */
export async function settleDueFunds(db,{accountId=null}={}){
 const {rows}=await db.query(`SELECT m.purchase_id,p.account_id FROM fund_maturities m
  JOIN internal_purchases p ON p.id=m.purchase_id WHERE m.settled_at IS NULL AND m.due_at<=now()
  AND ($1::uuid IS NULL OR p.account_id=$1::uuid)
  ORDER BY m.due_at,m.purchase_id LIMIT 100`,[accountId]);
 let settled=0,failed=0;
 for(const row of rows){
  try{if(await settleFund(db,row))settled++;}
  catch{failed++;}
 }
 return {settled,failed};
}
