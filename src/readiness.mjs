const REQUIRED_TABLES = Object.freeze([
  "app_users", "accounts", "positions", "orders", "cash_ledger", "user_sessions",
  "watchlist_items", "admin_roles", "invite_codes", "client_links", "listings", "registration_policy",
  "admin_mirror_access_log", "client_admin_policies", "client_policy_audit", "client_funding_requests",
  "client_kyc_requests", "client_bank_link_requests", "client_workflow_audit", "admin_subaccount_policies",
  "admin_subaccount_control_audit", "commodity_products", "commodity_product_audit", "support_threads",
  "support_messages", "support_status_audit", "internal_product_terms", "internal_purchases",
  "internal_product_positions", "internal_purchase_attempts", "internal_product_terms_audit",
  "admin_mirror_purchase_audit",
  "private_customer_submissions", "private_customer_access_audit", "fund_maturities",
  "stock_position_locks", "stock_position_lock_audit", "internal_stock_sales", "internal_stock_sale_lots"
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
