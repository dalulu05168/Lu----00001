import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdminApi} from '../src/admin-http.mjs';

const CLIENT='33333333-3333-4333-8333-333333333333';
const MASTER='11111111-1111-4111-8111-111111111111';
const PATH='/api/admin/client-analytics';
function response(){
 const data={status:null,body:null};
 const res={
  writeHead(code){data.status=code;},
  end(body){data.body=body?JSON.parse(body):null;}
 };
 return {data,res};
}
function request({method='GET',auth=null,clientId=CLIENT}={}){
 return {method,url:PATH+'?clientId='+encodeURIComponent(clientId),
  headers:auth===null?{}:{authorization:'Bearer '+auth}};
}
test('admin client analytics route requires a valid bearer session',async()=>{
 const {data,res}=response();
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('No db access allowed');}};
 assert.equal(await handleAdminApi(request(),res,PATH,db,async()=>null),true);
 assert.equal(data.status,401);assert.equal(calls,0);
});
test('admin client analytics route rejects write methods without DB access',async()=>{
 const {data,res}=response();
 const db={query:async()=>{throw new Error('Should not touch DB');}};
 assert.equal(await handleAdminApi(request({method:'POST'}),res,PATH,db,async()=>null),true);
 assert.equal(data.status,405);
});
test('admin client analytics route rejects unverified admin session',async()=>{
 const {data,res}=response();
 const db={query:async()=>{throw new Error('No db access allowed');}};
 assert.equal(await handleAdminApi(request({auth:'synthetic-token'}),res,PATH,db,
  async()=>({userId:MASTER,adminVerified:false})),true);
 assert.equal(data.status,403);
});
test('verified admin analytics route rejects malformed client ID before financial read',async()=>{
 const {data,res}=response();
 let queries=0;
 const db={async query(sql,args){
  queries++;
  assert.match(sql,/FROM admin_roles/);
  assert.deepEqual(args,[MASTER]);
  return {rows:[{user_id:MASTER,role:'MASTER',parent_user_id:null}]};
 }};
 assert.equal(await handleAdminApi(request({auth:'synthetic-token',clientId:'invalid-id'}),res,PATH,db,
  async()=>({userId:MASTER,adminVerified:true})),true);
 assert.equal(data.status,400);
 assert.equal(queries,1);
});
