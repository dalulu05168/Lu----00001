// Real Chromium smoke for the current CN Capital customer frontend.
// Runs on the GitHub Ubuntu worker without credentials or production writes.
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {readFile,mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as pause} from "node:timers/promises";
import {createApi} from "../src/http-api.mjs";

function chromePath(){
 for(const name of ["google-chrome","google-chrome-stable","chromium","chromium-browser"]){
  const where=spawnSync("which",[name],{encoding:"utf8"});
  if(where.status===0&&where.stdout.trim())return where.stdout.trim();
 }
 throw new Error("Real Chromium browser is missing from the test host");
}
async function until(fn,limit=14000){
 let last=null;
 for(let i=0;i<limit/100;i++){
  try{const r=await fn();if(r)return r;}catch(e){last=e;}
  await pause(100);
 }
 throw new Error("Browser timeout: "+String(last||"not ready"));
}
async function cdp(wsUrl){
 const ws=new WebSocket(wsUrl);
 await new Promise((resolve,reject)=>{
  ws.addEventListener("open",resolve,{once:true});
  ws.addEventListener("error",reject,{once:true});
 });
 let seq=0;const pending=new Map();
 ws.addEventListener("message",e=>{
  const msg=JSON.parse(e.data);
  if(msg.id&&pending.has(msg.id)){
   const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
   if(msg.error)reject(new Error(msg.error.message));else resolve(msg.result||{});
  }
 });
 return {
  send(method,params={}){
   return new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
   });
  },
  close(){ws.close()}
 };
}
async function evalJS(client,expression){
 const result=await client.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
 if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
 return result.result?.value;
}
const dir=await mkdtemp(join(tmpdir(),"cn-real-browser-"));
const server=createApi({db:{},resolveSession:async()=>null});
let child,client;
try{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 child=spawn(chromePath(),[
  "--headless=new","--no-sandbox","--disable-dev-shm-usage","--disable-gpu",
  "--disable-extensions","--no-first-run","--no-default-browser-check",
  "--disable-background-networking","--remote-allow-origins=*",
  "--remote-debugging-port=0","--user-data-dir="+dir,"about:blank"
 ],{stdio:"ignore"});
 const lines=await until(async()=>{const x=await readFile(join(dir,"DevToolsActivePort"),"utf8");return x.trim().split(/\r?\n/);});
 const port=Number(lines[0]);
 const page=await until(async()=>{
  const res=await fetch("http://127.0.0.1:"+port+"/json/list");
  return (await res.json()).find(t=>t.type==="page"&&t.webSocketDebuggerUrl);
 });
 client=await cdp(page.webSocketDebuggerUrl);
 await client.send("Page.enable");await client.send("Runtime.enable");
 await mkdir("artifacts",{recursive:true});
 for(const view of [{width:1440,height:900,label:"desktop"},{width:390,height:844,label:"narrow"}]){
  await client.send("Emulation.setDeviceMetricsOverride",{
    width:view.width,height:view.height,deviceScaleFactor:1,mobile:view.width<600
  });
  await client.send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port+"/"});
  await until(()=>evalJS(client,"document.readyState==='complete' && !!document.querySelector('#entryGate .portal-logo img')"));
  const login=await evalJS(client,"(()=>{const img=document.querySelector('#entryGate .portal-logo img');const form=document.getElementById('entryForm');const style=getComputedStyle(document.querySelector('#entryGate .portal-logo'));return {src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0,formHeight:form.getBoundingClientRect().height,background:style.backgroundColor,border:style.borderTopWidth}})()");
  assert.equal(login.src,"/cn-login-logo.svg");
  assert.ok(login.loaded,"The animated SVG must load in "+view.label);
  assert.ok(login.formHeight>50,"Original login form must remain visible in "+view.label);
  assert.equal(login.background,"rgba(0, 0, 0, 0)","Login logo must have transparent backing");
  assert.equal(login.border,"0px","Login logo must have no border plate");
  const layout=await evalJS(client,"(()=>{document.getElementById('entryGate').hidden=true;document.getElementById('overview').hidden=false;document.getElementById('internalProductsPanel').hidden=false;document.getElementById('orderForm').hidden=false;const rect=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}};return {nav:rect('#overview .sidebar'),chart:rect('#overview #stockChart'),transactions:rect('#overview .transaction-list-panel'),trading:rect('#overview .trade-board-side > .order-panel'),holdings:rect('#overview #holdings-section'),watchlist:rect('#overview #markets-section'),accent:getComputedStyle(document.querySelector('#overview')).getPropertyValue('--cn-lime').trim(),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}})()");
  const shot=await client.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  await writeFile(join("artifacts","cn-front-"+view.label+".png"),Buffer.from(shot.data,"base64"));
  assert.equal(layout.accent,"#d7ff00",view.label+" CN design CSS missing");
  for(const key of ["nav","chart","transactions","trading","holdings","watchlist"]){
   assert.ok(layout[key]?.width>140&&layout[key]?.height>10,view.label+" missing module "+key+": "+JSON.stringify(layout));
  }
  assert.ok(layout.chart.y<layout.transactions.y,view.label+" chart must appear above transaction history");
  assert.ok(layout.trading.y<=layout.holdings.y,view.label+" trading must appear ahead of holdings");
  if(view.width>=1000)assert.ok(layout.chart.right<=layout.trading.x+8,"desktop trading should be beside chart");
  else assert.ok(layout.scrollWidth<=layout.viewport+12,"narrow layout overflows: "+JSON.stringify(layout));
  console.log("FRONT_BROWSER_OK "+JSON.stringify({view:view.label,login,layout}));
 }
 console.log("Chromium browser QA: desktop and narrow PASS");
}finally{
 try{client?.close()}catch{}
 if(child){child.kill("SIGTERM");await pause(70);if(child.exitCode===null)child.kill("SIGKILL");}
 server.closeAllConnections();
 await new Promise(resolve=>server.close(()=>resolve()));
 await rm(dir,{recursive:true,force:true});
}
