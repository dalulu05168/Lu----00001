import test from "node:test";
import assert from "node:assert/strict";
import {createApi} from "../src/http-api.mjs";

test("NuvexaPro hostname selects the right login without exposing workspace",async()=>{
  const db={query:async()=>({rows:[]})};
  const app=createApi({db,resolveSession:async()=>null});
  await new Promise(done=>app.listen(0,"127.0.0.1",done));
  const base="http://127.0.0.1:"+app.address().port;
  async function page(host,path="/"){
    const response=await fetch(base+path,{headers:{Host:host}});
    return {status:response.status,body:await response.text(),contentType:response.headers.get("content-type")};
  }
  try{
    const client=await page("nuvexapro.com");
    const admin=await page("admin.nuvexapro.com");
    const preview=await page("global-stock-qa-preview.onrender.com");
    const www=await page("www.nuvexapro.com");
    const forcedAdmin=await page("admin.nuvexapro.com","/index.html");
    const adminJs=await page("admin.nuvexapro.com","/admin.mjs");
    assert.equal(client.status,200);
    assert.match(client.body,/id="entryGate"/);
    assert.match(client.body,/id="overview" hidden/);
    assert.doesNotMatch(client.body,/id="adminLoginForm"/);
    for(const p of [admin,forcedAdmin]){
      assert.equal(p.status,200);
      assert.match(p.body,/id="adminLoginForm"/);
      assert.match(p.body,/id="adminWorkspace" hidden/);
      assert.doesNotMatch(p.body,/id="entryForm"/);
    }
    assert.match(preview.body,/id="entryGate"/);
    assert.match(www.body,/id="entryGate"/);
    assert.match(adminJs.contentType,/javascript/);
  }finally{await new Promise(done=>app.close(done));}
});
