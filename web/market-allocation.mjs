export const MARKET_CODES = Object.freeze(["US","CN"]);

/**
 * Count distinct held instruments by market, using only the account's
 * server-returned positive positions. This is NOT a value-weighted allocation:
 * market values require licensed prices and FX quotes.
 */
export function summarizeMarketHoldings(positions) {
  const available = Array.isArray(positions);
  const counts = Object.fromEntries(MARKET_CODES.map(code => [code,0]));
  const seen = new Set();
  if (available) {
    for (const position of positions) {
      if (!position || !MARKET_CODES.includes(position.market)) continue;
      if (typeof position.symbol !== "string" || !position.symbol.trim()) continue;
      const quantity = Number(position.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const key = position.market + ":" + position.symbol.trim().toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      counts[position.market]++;
    }
  }
  const total = Object.values(counts).reduce((a,b) => a+b,0);
  const markets = Object.fromEntries(MARKET_CODES.map(code => [
    code,{
      count:counts[code],
      percent:total ? Math.round(counts[code]*1000/total)/10 : 0
    }
  ]));
  return { available,total,markets };
}
