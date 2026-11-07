const REQUIRED_TABLES = Object.freeze([
  "app_users", "accounts", "positions", "orders", "cash_ledger", "user_sessions"
]);

// A successful database ping is not enough: the app schema must be installed.
export async function isDatabaseReady(db) {
  const fields = REQUIRED_TABLES.map(name =>
    "to_regclass('public." + name + "') AS " + name
  ).join(", ");
  const result = await db.query("SELECT " + fields);
  const row = result.rows[0];
  return Boolean(row && REQUIRED_TABLES.every(name => row[name]));
}
