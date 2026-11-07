import test from "node:test";
import assert from "node:assert/strict";
import {handleMobileSession} from "../src/mobile-session.mjs";
import {sessionTokenHash} from "../src/auth.mjs";

const sourceToken="s".repeat(43);
const code="h".repeat(43);
const authorization="Handoff "+code;
function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=JSON.parse(body);}};}
function request(host,origin,headers={}){return {method:"POST",headers:{host,origin,...headers}};}
const source=()=>request("www.nuvexapro.com","https://www.nuvexapro.com",{authorization:"Bearer "+sourceToken});
const mobile=()=>request("m.nuvexapro.com","https://m.nuvexapro.com",{authorization});
const customer=async()=>({accountId:"acct",userId:"user",adminVerified:false});

// One isolated test owns the process-level rollout flag for its entire lifetime.
test("mobile handoff protects origins, expires atomically and rolls back failed session creation",async t=>{
 const previous=process.env.MOBILE_ORIGIN;
 process.env.MOBILE_ORIGIN="https://m.nuvexapro.com";
 try{
  await t.test("untrusted origins and mismatched hosts cannot issue or redeem",async()=>{
   const forbidden=[request("www.nuvexapro.com","https://evil.test"),request("www.nuvexapro.com","https://nuvexapro.com"),request("m.nuvexapro.com","https://www.nuvexapro.com",{authorization}),request("admin.nuvexapro.com","https://admin.nuvexapro.com",{authorization}),request("m.nuvexapro.com",undefined,{authorization})];
   for(const req of forbidden){const res=response();await handleMobileSession(req,res,{},customer);assert.equal(res.status,403);}
  });
  await t.test("source session and customer role are required",async()=>{
   for(const resolver of [async()=>null,async()=>({accountId:"a",adminVerified:true})]){
    const res=response();await handleMobileSession(source(),res,{},resolver);assert.equal(res.status,401);
   }
  });
  await t.test("issuance stores hashes and returns a short-lived handoff without a shared cookie",async()=>{
   const calls=[];
   const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.includes("INSERT")?[{code_hash:params[0]}]:[]};}};
   const res=response();await handleMobileSession(source(),res,db,customer);
   assert.equal(res.status,200);
   assert.equal(res.body.url,"https://m.nuvexapro.com/");
   assert.equal(res.headers["set-cookie"],undefined);
   const raw=res.body.handoff;
   assert.match(raw,/^[A-Za-z0-9_-]{43}$/);
   assert.equal(calls[1].params[0],sessionTokenHash(raw));
   assert.equal(calls[1].params[1],sessionTokenHash(sourceToken));
   assert.match(calls[1].sql,/LEAST\(expires_at,now\(\)\+interval '60 seconds'\)/);
   assert.match(calls[1].sql,/revoked_at IS NULL AND admin_verified_at IS NULL/);
   assert.ok(!JSON.stringify(res.body).includes(sourceToken));
  });
  await t.test("disabled rollout preserves current mobile URL without DB writes",async()=>{
   delete process.env.MOBILE_ORIGIN;
   const res=response();await handleMobileSession(source(),res,{},customer);
   assert.equal(res.status,200);assert.deepEqual(res.body,{url:"/mobile.html"});
   process.env.MOBILE_ORIGIN="https://m.nuvexapro.com";
  });
  await t.test("invalid or ambiguous handoff headers cannot reach the database",async()=>{
   for(const value of [undefined,"Handoff bad",authorization+", "+authorization]){
    const req=mobile();req.headers.authorization=value;
    const res=response();await handleMobileSession(req,res,{},customer);assert.equal(res.status,401);
   }
  });
  await t.test("exchange creates a replacement session once and rejects replay",async()=>{
   let consumed=false,released=0;const queries=[];
   const expires=new Date(Date.now()+600000);
   const client={query:async(sql,params)=>{
    queries.push(sql);
    if(sql.startsWith("DELETE")){
     assert.equal(params[0],sessionTokenHash(code));
     assert.match(sql,/expires_at>now\(\)/);
     if(consumed)return {rows:[]};consumed=true;return {rows:[{session_hash:sessionTokenHash(sourceToken)}]};
    }
    if(sql.startsWith("UPDATE"))return {rows:[{user_id:"user",account_id:"acct",expires_at:expires}]};
    return {rows:[]};
   },release(){released++;}};
   const db={connect:async()=>client};
   const res=response();await handleMobileSession(mobile(),res,db,customer);
   assert.equal(res.status,200);assert.match(res.body.token,/^[A-Za-z0-9_-]{43}$/);
   assert.equal(res.body.expiresAt,expires.toISOString());
   assert.ok(queries.find(sql=>sql.startsWith("UPDATE user_sessions s SET revoked_at=now()")));
   assert.equal(queries.at(-1),"COMMIT");
   const replay=response();await handleMobileSession(mobile(),replay,db,customer);
   assert.equal(replay.status,401);assert.equal(queries.at(-1),"ROLLBACK");assert.equal(released,2);
   assert.equal(queries.filter(sql=>sql.startsWith("INSERT INTO user_sessions")).length,1);
  });
  await t.test("revoked or expired source cannot become a mobile session",async()=>{
   const sqls=[];const client={query:async sql=>{sqls.push(sql);return {rows:sql.startsWith("DELETE")?[{session_hash:"hash"}]:[]};},release(){}};
   const res=response();await handleMobileSession(mobile(),res,{connect:async()=>client},customer);
   assert.equal(res.status,401);assert.equal(sqls.at(-1),"COMMIT");assert.ok(!sqls.some(sql=>sql.startsWith("INSERT")));
  });
  await t.test("creation failure rolls back consumption and revocation",async()=>{
   const sqls=[];let released=false;
   const client={query:async sql=>{
    sqls.push(sql);
    if(sql.startsWith("DELETE"))return {rows:[{session_hash:"hash"}]};
    if(sql.startsWith("UPDATE"))return {rows:[{user_id:"user",account_id:"acct",expires_at:new Date(Date.now()+600000)}]};
    if(sql.startsWith("INSERT"))throw Error("DB unavailable");
    return {rows:[]};
   },release(){released=true;}};
   const res=response();await handleMobileSession(mobile(),res,{connect:async()=>client},customer);
   assert.equal(res.status,503);assert.equal(sqls.at(-1),"ROLLBACK");assert.equal(released,true);
  });
 }finally{if(previous===undefined)delete process.env.MOBILE_ORIGIN;else process.env.MOBILE_ORIGIN=previous;}
});

// Verify the deployed-host branch, which local preview routing does not exercise.
test("phone routing uses the handoff response only after account validation",async()=>{
 const {readFile}=await import("node:fs/promises");
 const {runInNewContext}=await import("node:vm");
 const script=await readFile(new URL("../web/mobile-entry.mjs",import.meta.url),"utf8");
 async function route(destination,search=""){
  const gate={hidden:false},desktop={hidden:true,prepend(){}},navigations=[],requests=[];
  let observer;
  const context={
   document:{getElementById:id=>id==="entryGate"?gate:desktop,createElement:()=>({addEventListener(){}})},
   sessionStorage:{getItem:key=>key==="gsp_token"?sourceToken:null},
   location:{hostname:"www.nuvexapro.com",search,replace:url=>navigations.push(url)},
   navigator:{userAgent:"iPhone Mobile"},matchMedia:()=>({matches:true}),URLSearchParams,
   MutationObserver:class{constructor(fn){observer=fn;}observe(){}},
   fetch:async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>({url:destination,handoff:code})};}
  };
  runInNewContext(script,context);
  assert.equal(requests.length,0);assert.equal(navigations.length,0);
  gate.hidden=true;desktop.hidden=false;await observer();
  return {requests,navigations};
 }
 const success=await route("https://m.nuvexapro.com/");
 assert.deepEqual(success.navigations,["https://m.nuvexapro.com/#handoff="+code]);
 assert.equal(success.requests[0].path,"/api/auth/mobile-session");
 assert.equal(success.requests[0].options.headers.authorization,"Bearer "+sourceToken);
 assert.deepEqual((await route("https://evil.test/")).navigations,[]);
 assert.deepEqual((await route("https://m.nuvexapro.com/","?view=desktop")).requests,[]);
});
