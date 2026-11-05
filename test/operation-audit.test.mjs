import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {listUnifiedAudit} from "../src/operation-audit.mjs";
test("unified audit scopes all client events and hides commodity/subadmin audits from subaccounts",async()=>{
 let query=null,params=null;
 const db={query:async(q,p)=>{query=q;params=p;return {rows:[]}}};
 const master=randomUUID(),sub=randomUUID();
 assert.deepEqual((await listUnifiedAudit(db,{role:"MASTER",userId:master},{limit:50})).items,[]);
 assert.deepEqual(params,["MASTER",master,50]);
 assert.match(query,/commodity_product_audit a WHERE \$1::text='MASTER'/);
 assert.match(query,/admin_subaccount_control_audit a WHERE \$1::text='MASTER'/);
 assert.equal((query.match(/l\.subadmin_user_id=\$2::uuid/g)||[]).length,6);
 assert.match(query,/internal_product_terms_audit a WHERE \$1::text='MASTER'/);
 await listUnifiedAudit(db,{role:"SUBADMIN",userId:sub});
 assert.deepEqual(params,["SUBADMIN",sub,100]);
 await assert.rejects(listUnifiedAudit(db,{role:"CLIENT",userId:sub}),/Administrator required/);
 await assert.rejects(listUnifiedAudit(db,{role:"SUBADMIN",userId:sub},{limit:201}),/Invalid audit limit/);
});
