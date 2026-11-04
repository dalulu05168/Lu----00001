import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("QA Render deploy configuration is gated on passed CI",()=>{
 const yaml=readFileSync(new URL("../render.yaml",import.meta.url),"utf8");
 assert.match(yaml,/name: global-stock-qa-preview/);
 assert.match(yaml,/plan: free/);
 assert.match(yaml,/branch: dev\/restore-four-role-platform-20261103/);
 assert.match(yaml,/autoDeployTrigger: checksPass/);
 assert.doesNotMatch(yaml,/autoDeployTrigger:\s*['"]?off/);
 assert.match(yaml,/key: DATABASE_URL\r?\n\s*sync: false/);
 assert.match(yaml,/healthCheckPath: \/ready/);
});
