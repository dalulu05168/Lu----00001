import test from "node:test";
import assert from "node:assert/strict";
import {isDatabaseReady} from "../src/readiness.mjs";

// Model catalog existence, not application data. Omitting any one of these
// tables breaks a route that the readiness probe must protect.
const names=["app_users","accounts","positions","orders","cash_ledger","user_sessions",
 "watchlist_items","admin_roles","invite_codes","client_links","listings","registration_policy",
 "admin_mirror_access_log","client_admin_policies","client_policy_audit","client_funding_requests",
 "client_kyc_requests","client_bank_link_requests","client_workflow_audit","admin_subaccount_policies",
 "admin_subaccount_control_audit","commodity_products","commodity_product_audit","support_threads",
 "support_messages","support_status_audit","internal_product_terms","internal_purchases",
 "internal_product_positions","internal_purchase_attempts","internal_product_terms_audit"];
const catalog=missing=>({query:async sql=>{
 const row={};for(const [,name] of sql.matchAll(/to_regclass\('public\.([a-z_]+)'\)/g))row[name]=name===missing?null:name;
 return {rows:[row]};
}});
test("readiness refuses a database missing any client, admin, or audit table",async()=>{
 for(const missing of names)assert.equal(await isDatabaseReady(catalog(missing)),false,missing);
 assert.equal(await isDatabaseReady(catalog(null)),true);
});
