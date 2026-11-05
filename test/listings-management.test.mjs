import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createApi} from "../src/http-api.mjs";
import {updateListing} from "../src/admin-service.mjs";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("master edits metadata only while the listing is a draft",async()=>{
  const calls=[],id=randomUUID(),master={role:"MASTER",userId:randomUUID()};
  const db={query:async(sql,params)=>{
    calls.push({sql,params});return {rows:[{id}]};
  }};
  const changed=await updateListing(db,master,{
    id,itemType:"FUND",market:"HK",symbol:"2800",name:"  Tracker Fund  ",status:"PUBLISHED"
  });
  assert.equal(changed.name,"Tracker Fund");
  assert.match(calls[0].sql,/AND status='DRAFT'/);
  assert.equal(calls[0].params[0],id);
  assert.ok(calls[0].params.includes("Tracker Fund"));
  await updateListing(db,master,{id,status:"DRAFT"});
  assert.doesNotMatch(calls[1].sql,/AND status='DRAFT'/);
  assert.equal(calls[1].params[1],"DRAFT");
  await assert.rejects(updateListing(db,{role:"SUBADMIN"}, {id,status:"DRAFT"}),/Only master/);
  await assert.rejects(updateListing(db,master,{id,market:"UK"}),/Invalid listing update/);
  await assert.rejects(updateListing(db,master,{id,symbol:"bad symbol"}),/Invalid listing update/);
  await assert.rejects(updateListing(db,master,{id,name:"   "}),/Invalid listing update/);
  await assert.rejects(updateListing(db,master,{id,purchasePassword:"secret"}),/Invalid listing update/);
  await assert.rejects(updateListing(db,master,{id}),/Invalid listing update/);
  await assert.rejects(updateListing({query:async()=>({rows:[]})},master,
    {id,name:"Not allowed"}),/not a draft/);
});

test("published metadata edit is rejected when storage reports no draft",async()=>{
  await assert.rejects(updateListing({query:async()=>({rows:[]})},
    {role:"MASTER"}, {id:randomUUID(),name:"Renamed"}),/not a draft/);
});

test("master publish and withdraw changes what customers can see",async()=>{
  const entries=[],masterId=randomUUID(),subId=randomUUID();
  const db={query:async(sql,params=[])=>{
    if(sql.includes("FROM admin_roles"))return {rows:[{
      user_id:params[0],role:params[0]===masterId?"MASTER":"SUBADMIN",parent_user_id:null
    }]};
    if(sql.startsWith("INSERT INTO listings")){
      entries.push({id:params[0],item_type:params[1],market:params[2],
        symbol:params[3],display_name:params[4],status:params[6]});
      return {rows:[]};
    }
    if(sql.startsWith("UPDATE listings SET")){
      const row=entries.find(x=>x.id===params[0]);
      if(!row)return {rows:[]};
      if(sql.includes("AND status='DRAFT'")&&row.status!=="DRAFT")return {rows:[]};
      const columns={status:"status",item_type:"item_type",market:"market",symbol:"symbol",display_name:"display_name"};
      for(const match of sql.matchAll(/(status|item_type|market|symbol|display_name)=\$(\d+)/g)){
        row[columns[match[1]]]=params[Number(match[2])-1];
      }
      return {rows:[{id:row.id}]};
    }
    if(sql.includes("FROM listings WHERE status='PUBLISHED'"))
      return {rows:entries.filter(x=>x.status==="PUBLISHED")};
    if(sql.includes("FROM listings ORDER BY created_at DESC"))
      return {rows:entries};
    throw Error("Unexpected SQL: "+sql);
  }};
  const resolveSession=async token=>token==="master"
    ?{userId:masterId,accountId:"master-account",adminVerified:true}
    :token==="sub"
      ?{userId:subId,accountId:"sub-account",adminVerified:true}
      :token==="client"
        ?{userId:"client-id",accountId:"client-account",adminVerified:false}
        :null;
  const server=createApi({db,resolveSession});
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const base="http://127.0.0.1:"+server.address().port;
  const call=async(path,token,method="GET",body)=>{
    const response=await fetch(base+path,{method,headers:{
      authorization:"Bearer "+token,"content-type":"application/json"
    },...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();return {status:response.status,data};
  };
  try{
    let created=await call("/api/admin/listings","master","POST",{
      itemType:"IPO",market:"MY",symbol:"IPO1",name:"IPO Example",status:"DRAFT"
    });
    assert.equal(created.status,201);
    const id=created.data.id;
    assert.equal((await call("/api/catalog","client")).data.items.length,0);
    assert.equal((await call("/api/admin/listings","sub","PATCH",{id,status:"PUBLISHED"})).status,403);
    assert.equal((await call("/api/admin/listings","client","PATCH",{id,status:"PUBLISHED"})).status,403);
    assert.equal((await call("/api/admin/listings","master","PATCH",{id,status:"PUBLISHED"})).status,200);
    const published=await call("/api/catalog","client");
    assert.equal(published.data.items.length,1);
    assert.equal(published.data.items[0].itemType,"IPO");
    assert.equal((await call("/api/admin/listings","master","PATCH",{id,name:"Changed while published"})).status,400);
    assert.equal((await call("/api/admin/listings","master","PATCH",{id,status:"DRAFT"})).status,200);
    assert.equal((await call("/api/catalog","client")).data.items.length,0);
    assert.equal((await call("/api/admin/listings","master","PATCH",{id,name:"Updated IPO"})).status,200);
    assert.equal((await call("/api/admin/listings","master","PATCH",{id,status:"PUBLISHED"})).status,200);
    assert.equal((await call("/api/catalog","client")).data.items[0].name,"Updated IPO");
  }finally{await new Promise(done=>server.close(done));}
});

test("trusted pricing cannot create orders for draft, unknown or IPO directory entries",async()=>{
  const requests=[],id=randomUUID();
  let record={market:"US",symbol:"AAPL",status:"DRAFT",item_type:"STOCK"};
  const db={
    query:async(sql,params)=>{
      if(sql.includes("FROM listings WHERE market=$1")){
        requests.push({sql,params});
        return {rows:record&&record.market===params[0]&&record.symbol===params[1]&&
          record.status==="PUBLISHED"&&["STOCK","FUND"].includes(record.item_type)?[{id}]:[]};
      }
      throw Error("Unexpected SQL in listing eligibility check");
    },
    connect:async()=>{throw Error("Orders must not be written in this check");}
  };
  let providerCalls=0;
  const server=createApi({db,resolveSession:async()=>({accountId:"client",userId:"client",adminVerified:false}),
    resolveExecutionPrice:async()=>{providerCalls++;return null;}});
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const origin="http://127.0.0.1:"+server.address().port;
  const send=async()=>{const res=await fetch(origin+"/api/orders",{method:"POST",
    headers:{authorization:"Bearer client","idempotency-key":"valid-order-key-1",
      "content-type":"application/json"},
    body:JSON.stringify({market:"US",symbol:"AAPL",side:"BUY",quantity:1})});
    return {status:res.status,body:await res.json()};
  };
  try{
    assert.equal((await send()).status,409);
    record={...record,status:"PUBLISHED",item_type:"IPO"};
    assert.equal((await send()).status,409);
    record=null;
    assert.equal((await send()).status,409);
    assert.equal(providerCalls,0);
    record={market:"US",symbol:"AAPL",status:"PUBLISHED",item_type:"STOCK"};
    const allowed=await send();
    assert.equal(allowed.status,503);
    assert.equal(providerCalls,1);
    assert.equal(requests.length,4);
    assert.match(requests[0].sql,/status='PUBLISHED'/);
  }finally{await new Promise(done=>server.close(done));}
});

test("master console renders edit, publish and withdraw controls",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://preview.example/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const id=randomUUID(),listings=[{id,itemType:"STOCK",market:"US",symbol:"AAPL",name:"Apple",status:"DRAFT"}];
  const calls=[];
  const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async(url,options={})=>{
      const method=options.method||"GET";
      calls.push({url,method,body:options.body?JSON.parse(options.body):null});
      if(url==="/api/admin/login")return json(200,{token:"admin-token",role:"MASTER"});
      if(url==="/api/admin/me")return json(200,{role:"MASTER",userId:"master-id"});
      if(url==="/api/admin/mirror-status")return json(200,{ready:false});
      if(url==="/api/admin/stock-lookup?code=0700")return json(200,{
        items:[{market:"HK",symbol:"0700",name:"Tencent Holdings",exchange:"HKEX"}],provider:"unconfigured"
      });
      if(url==="/api/admin/listings"){
        if(method==="PATCH"){
          const data=JSON.parse(options.body),item=listings.find(x=>x.id===data.id);
          if(!item)return json(404,{error:"not found"});
          Object.assign(item,data);return json(200,{id:item.id,status:item.status});
        }
        if(method==="POST"){const data=JSON.parse(options.body);listings.push({id:randomUUID(),...data});return json(201,data);}
        return json(200,{items:listings.map(x=>({...x}))});
      }
      if(["/api/admin/subaccounts","/api/admin/clients"].includes(url))return json(200,{items:[]});
      throw Error("Unexpected mocked API: "+url);
    };
    await import("../web/admin.mjs?securities-listings-ui");
    const el=key=>dom.window.document.getElementById(key);
    el("adminEmail").value="master@example.test";
    el("adminPassword").value="safe-long-password";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(done=>setTimeout(done,100));
    assert.equal(el("adminListingCount").textContent,"1");
    let row=el("listings").querySelector(".admin-list-row");
    assert.match(row.textContent,/草稿/);
    row.querySelector(".listing-actions button").click();
    assert.equal(el("listingName").value,"Apple");
    assert.equal(el("listingSubmit").textContent,"保存修改");
    el("listingName").value="Apple New";
    el("listingForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(done=>setTimeout(done,50));
    assert.equal(listings[0].name,"Apple New");
    row=el("listings").querySelector(".admin-list-row");
    [...row.querySelectorAll('.listing-actions button')].find(b=>b.textContent==='发布').click();
    await new Promise(done=>setTimeout(done,45));
    assert.equal(listings[0].status,"PUBLISHED");
    row=el("listings").querySelector(".admin-list-row");
    assert.equal(row.querySelector(".listing-actions button").disabled,true);
    [...row.querySelectorAll('.listing-actions button')].find(b=>b.textContent==='撤回').click();
    await new Promise(done=>setTimeout(done,45));
    assert.equal(listings[0].status,"DRAFT");
    assert.ok(calls.some(x=>x.method==="PATCH"&&x.body.name==="Apple New"));
    assert.ok(calls.some(x=>x.method==="PATCH"&&x.body.status==="PUBLISHED"));
    assert.ok(calls.some(x=>x.method==="PATCH"&&x.body.status==="DRAFT"));
    const writes=calls.filter(call=>call.method==="POST"||call.method==="PATCH").length;
    el("listingSymbol").value="0700";
    el("listingLookupButton").click();
    await new Promise(done=>setTimeout(done,35));
    const match=el("listingLookupResults").querySelector("button");
    assert.match(match.textContent,/香港 · HKEX · 0700 · Tencent Holdings/);
    match.click();
    assert.equal(el("listingMarket").value,"HK");
    assert.equal(el("listingSymbol").value,"0700");
    assert.equal(el("listingName").value,"Tencent Holdings");
    assert.equal(calls.filter(call=>call.method==="POST"||call.method==="PATCH").length,writes);
  }finally{
    globalThis.document=old.document;
    globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;
    dom.window.close();
  }
});
