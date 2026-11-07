const MARKETS = new Set(["US", "CN"]);
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;

export function validateWatchlistInstrument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["market", "symbol"].includes(key))) {
    throw new Error("Invalid watchlist item");
  }
  const market = value.market;
  const symbol = value.symbol;
  if (!MARKETS.has(market) || typeof symbol !== "string" ||
      !SYMBOL_PATTERN.test(symbol)) {
    throw new Error("Invalid watchlist instrument");
  }
  return { market, symbol };
}

export async function listWatchlist(db, accountId) {
  const result = await db.query(
    "SELECT market,symbol,created_at FROM watchlist_items WHERE account_id=$1 ORDER BY created_at DESC,market,symbol LIMIT 100",
    [accountId]
  );
  return result.rows.map(row => ({
    market: row.market,
    symbol: row.symbol,
    createdAt: row.created_at
  }));
}

export async function addWatchlistItem(db, accountId, instrument) {
  const {market,symbol} = validateWatchlistInstrument(instrument);
  const current = await db.query(
    "SELECT count(*)::int AS total FROM watchlist_items WHERE account_id=$1",
    [accountId]
  );
  if (Number(current.rows[0]?.total ?? 0) >= 100) {
    const existing = await db.query(
      "SELECT 1 FROM watchlist_items WHERE account_id=$1 AND market=$2 AND symbol=$3",
      [accountId,market,symbol]
    );
    if (!existing.rows.length) throw new Error("Watchlist limit reached");
  }
  await db.query(
    "INSERT INTO watchlist_items(account_id,market,symbol) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [accountId,market,symbol]
  );
  return {market,symbol};
}

export async function removeWatchlistItem(db, accountId, instrument) {
  const {market,symbol} = validateWatchlistInstrument(instrument);
  await db.query(
    "DELETE FROM watchlist_items WHERE account_id=$1 AND market=$2 AND symbol=$3",
    [accountId,market,symbol]
  );
  return {market,symbol};
}
