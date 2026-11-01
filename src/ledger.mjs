export const MARKETS = Object.freeze(["US","HK","CN","MY"]);
export function createAccount(initialCashCents = 1_000_000) {
  if (!Number.isSafeInteger(initialCashCents) || initialCashCents < 0) throw new Error("Invalid opening balance");
  return { cashCents: initialCashCents, positions: {}, orders: [] };
}
export function applyOrder(account, order) {
  const { side, symbol, market, quantity, priceCents, fxUsdMicros = 1_000_000 } = order;
  if (!["BUY","SELL"].includes(side)) throw new Error("Invalid side");
  if (!MARKETS.includes(market)) throw new Error("Invalid market");
  if (typeof symbol !== "string" || !/^[A-Z0-9.\-]{1,24}$/.test(symbol)) throw new Error("Invalid symbol");
  if (![quantity,priceCents,fxUsdMicros].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error("Invalid quantity, price or FX rate");
  const amount = Math.round(quantity * priceCents * fxUsdMicros / 1_000_000);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Amount overflow");
  const key = market + ":" + symbol;
  const held = account.positions[key] ?? 0;
  if (side === "BUY" && account.cashCents < amount) throw new Error("Insufficient funds");
  if (side === "SELL" && held < quantity) throw new Error("Insufficient position");
  const next = {
    cashCents: account.cashCents + (side === "BUY" ? -amount : amount),
    positions: { ...account.positions, [key]: held + (side === "BUY" ? quantity : -quantity) },
    orders: [...account.orders, { side, symbol, market, quantity, priceCents, fxUsdMicros, amountCents: amount, execution: "INTERNAL_ONLY" }]
  };
  return next;
}
