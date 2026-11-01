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
  // Multiply in integers; Number multiplication can silently round before overflow checks.
  const totalMicros = BigInt(quantity) * BigInt(priceCents) * BigInt(fxUsdMicros);
  const cents = (totalMicros + 500_000n) / 1_000_000n;
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount overflow");
  const amount = Number(cents);
  if (!Number.isSafeInteger(account?.cashCents) || account.cashCents < 0) throw new Error("Invalid cash balance");
  const key = market + ":" + symbol;
  const held = account.positions[key] ?? 0;
  if (side === "BUY" && account.cashCents < amount) throw new Error("Insufficient funds");
  if (side === "SELL" && held < quantity) throw new Error("Insufficient position");
  const nextCash = BigInt(account.cashCents) + (side === "BUY" ? -cents : cents);
  const nextHeld = BigInt(held) + (side === "BUY" ? BigInt(quantity) : -BigInt(quantity));
  if (nextCash < 0n || nextCash > BigInt(Number.MAX_SAFE_INTEGER) ||
      nextHeld < 0n || nextHeld > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount overflow");
  const next = {
    cashCents: Number(nextCash),
    positions: { ...account.positions, [key]: Number(nextHeld) },
    orders: [...account.orders, { side, symbol, market, quantity, priceCents, fxUsdMicros, amountCents: amount, execution: "INTERNAL_ONLY" }]
  };
  return next;
}
