import { applyOrder } from "./ledger.mjs";

/**
 * db must expose query(sql, params) and connect() returning a client with query/release.
 * Account row lock serializes writes; all mutations commit atomically.
 * Caller must authenticate account ownership before calling.
 */
export async function placeInternalOrder(db, accountId, key, input, newOrderId) {
  if (typeof accountId !== "string" || !accountId) throw new Error("Account required");
  if (typeof key !== "string" || key.length < 8 || key.length > 128) throw new Error("Invalid idempotency key");
  if (typeof newOrderId !== "string" || !newOrderId) throw new Error("Order id required");
  const client = await db.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN"); transactionStarted = true;
    const a = await client.query("SELECT cash_cents FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
    if (a.rows.length !== 1) throw new Error("Account not found");
    const existing = await client.query("SELECT * FROM orders WHERE account_id=$1 AND idempotency_key=$2", [accountId,key]);
    if (existing.rows.length) {
      const previous = existing.rows[0];
      // An idempotency key represents one order intent, not a reusable
      // authorization to return an unrelated fill. A refreshed quote may
      // differ on retry; the original committed fill remains authoritative.
      if (previous.side !== input?.side || previous.market !== input?.market ||
          previous.symbol !== input?.symbol || String(previous.quantity) !== String(input?.quantity)) {
        throw Object.assign(new Error("Idempotency key already used for another order"), { statusCode:409 });
      }
      await client.query("COMMIT"); transactionStarted=false;
      return { replayed:true, order:previous };
    }
    if(input.side==="SELL"){
      const lock=await client.query("SELECT locked FROM stock_position_locks WHERE account_id=$1 AND market=$2 AND symbol=$3",
        [accountId,input.market,input.symbol]);
      if(lock.rows[0]?.locked)throw Object.assign(new Error("Stock position is locked"),{statusCode:409});
    }
    const p = await client.query("SELECT market,symbol,quantity FROM positions WHERE account_id=$1", [accountId]);
    const account = {cashCents:Number(a.rows[0].cash_cents),positions:Object.fromEntries(p.rows.map(r=>[r.market+":"+r.symbol,Number(r.quantity)])),orders:[]};
    const updated = applyOrder(account,input);
    const order = updated.orders[0];
    const position = updated.positions[order.market+":"+order.symbol];
    await client.query("UPDATE accounts SET cash_cents=$2 WHERE id=$1",[accountId,updated.cashCents]);
    await client.query(`INSERT INTO positions(account_id,market,symbol,quantity) VALUES($1,$2,$3,$4)
      ON CONFLICT(account_id,market,symbol) DO UPDATE SET quantity=EXCLUDED.quantity`,
      [accountId,order.market,order.symbol,position]);
    await client.query(`INSERT INTO orders(id,account_id,idempotency_key,market,symbol,side,quantity,price_cents,fx_usd_micros,amount_usd_cents)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newOrderId,accountId,key,order.market,order.symbol,order.side,order.quantity,order.priceCents,order.fxUsdMicros,order.amountCents]);
    await client.query("INSERT INTO cash_ledger(account_id,order_id,delta_cents,balance_after_cents) VALUES($1,$2,$3,$4)",
      [accountId,newOrderId,order.side==="BUY"?-order.amountCents:order.amountCents,updated.cashCents]);
    await client.query("COMMIT");transactionStarted=false;
    return {replayed:false,order:{id:newOrderId,...order},cashCents:updated.cashCents,position};
  } catch(error) {
    if(transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {client.release();}
}
