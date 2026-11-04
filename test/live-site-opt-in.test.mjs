import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

test("normal CI never probes an external website without explicit opt-in",()=>{
 const result=spawnSync(process.execPath,["--import",
  "data:text/javascript,globalThis.fetch=async()=>{throw new Error('External request attempted')}",
  "--test","--test-reporter=tap","test/live-site-api.test.mjs"],{
  cwd:new URL("..",import.meta.url),encoding:"utf8",timeout:10000,windowsHide:true,
  env:{...process.env,NODE_TEST_CONTEXT:undefined,GITHUB_ACTIONS:"true",RUN_LIVE_SITE_CHECKS:"",LIVE_SITE_ORIGIN:""}
 });
 assert.equal(result.error,undefined);
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/# skipped 17/);
});
