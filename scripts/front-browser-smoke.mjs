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
 for(const view of [{width:1440,height:900,label:"desktop"}]){
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
  // The real desktop app and the mobile native full-screen UI share the same auth/API DOM.
  await pause(200);
  await evalJS(client,"document.getElementById('entryGate').hidden=true;document.getElementById('overview').hidden=false");
  if(view.width>=1000){
   const layout=await evalJS(client,"(()=>{document.getElementById('internalProductsPanel').hidden=false;document.getElementById('orderForm').hidden=false;const rect=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}:null};return {mode:document.getElementById('overview').dataset.cnMode,nav:rect('#overview .sidebar'),chart:rect('#overview #stockChart'),transactions:rect('#overview .transaction-list-panel'),trading:rect('#overview .trade-board-side > .order-panel'),holdings:rect('#overview #holdings-section'),watchlist:rect('#overview #markets-section'),accent:getComputedStyle(document.querySelector('#overview')).getPropertyValue('--cn-lime').trim(),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}})()");
   assert.equal(layout.mode,"desktop");
   assert.equal(layout.accent,"#d7ff00");
   for(const key of ["nav","chart","transactions","trading","holdings","watchlist"]){
    assert.ok(layout[key]?.width>140&&layout[key]?.height>10,"desktop module missing "+key);
   }
   assert.ok(layout.chart.y<layout.transactions.y,"desktop chart precedes history");
   assert.ok(layout.trading.y<=layout.holdings.y,"desktop trading panel precedes holdings");
   assert.ok(layout.chart.right<=layout.trading.x+8,"desktop trading panel sits beside chart");
   const shot=await client.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
   await writeFile(join("artifacts","cn-front-desktop.png"),Buffer.from(shot.data,"base64"));
   console.log("FRONT_BROWSER_OK "+JSON.stringify({view:"desktop",login,layout}));
  }else{
   const mobile=await evalJS(client,"(()=>{const o=document.getElementById('overview');const r=s=>{const e=document.querySelector(s);const v=e?.getBoundingClientRect();return v?{x:v.x,y:v.y,width:v.width,height:v.height}:null};return {mode:o.dataset.cnMode,view:o.dataset.cnView,hero:r('#cnMobileHero'),header:r('#cnMobileHeader'),bottom:r('#cnMobileTabs'),originalSidebar:r('#overview .sidebar'),cash:document.getElementById('cnMobileCash').textContent.trim(),tabCount:document.querySelectorAll('#cnMobileTabs button[data-cn-tab]').length,deviceChrome:document.querySelectorAll('.isl,.mirror-status-bar,.sb').length,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth}})()");
   assert.equal(mobile.mode,"mobile","narrow screen must choose mobile UI automatically");
   assert.equal(mobile.view,"home");
   assert.equal(mobile.tabCount,5,"native app must have 5 bottom tabs");
   assert.ok(mobile.header?.height>=40,"mobile brand header missing");
   assert.ok(mobile.bottom?.height>=50,"mobile bottom tabs missing");
   assert.ok(mobile.hero?.width>=view.width-36,"hero must be full width, not a 390px device shell");
   assert.equal(mobile.originalSidebar?.height,0,"legacy desktop sidebar must be absent in mobile mode");
   assert.equal(mobile.deviceChrome,0,"fake device notch/statusbar is forbidden");
   assert.equal(mobile.cash,"—","mobile starts with no pretend account balance");
   assert.ok(mobile.bodyWidth<=mobile.viewport+5,"mobile home overflows width");
   const check=async(name,selectors)=>{
    const result=await evalJS(client,"(()=>{document.querySelector('#cnMobileTabs button[data-cn-tab="+name+"]').click();const q=s=>{const e=document.querySelector(s);const r=e?.getBoundingClientRect();return r?{width:r.width,height:r.height,y:r.y}:null};return {selected:document.getElementById('overview').dataset.cnView,tabs:[...document.querySelectorAll('#cnMobileTabs button[aria-current=page]')].map(e=>e.dataset.cnTab),modules:["+selectors.map(x=>JSON.stringify(x)).join(",")+"].map(q),width:document.documentElement.scrollWidth,viewport:innerWidth}})()");
    assert.equal(result.selected,name);
    assert.deepEqual(result.tabs,[name]);
    selectors.forEach((selector,i)=>assert.ok(result.modules[i]?.height>20&&result.modules[i]?.width>200,name+": module not visible: "+selector+" "+JSON.stringify(result)));
    assert.ok(result.width<=result.viewport+10,name+": horizontal overflow");
    const shot=await client.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(join("artifacts","cn-mobile-"+name+".png"),Buffer.from(shot.data,"base64"));
    console.log("MOBILE_VIEW_OK "+JSON.stringify({name,modules:result.modules,viewport:result.viewport}));
   };
   await check("home",["#cnMobileHero","#holdings-section","#markets-section"]);
   await check("market",["#terminal-section","#markets-section"]);
   await evalJS(client,"document.getElementById('internalProductsPanel').hidden=false;document.getElementById('orderForm').hidden=false");
   await check("trade",["#overview .trade-board-side > .order-panel","#holdings-section"]);
   await check("orders",["#overview .transaction-list-panel","#cnMobileExport"]);
   await evalJS(client,"document.getElementById('serviceRequestsPanel').hidden=false;document.getElementById('customerSupportPanel').hidden=false");
   await check("account",["#account-section","#fundingRequestForm","#customerSupportPanel"]);
   const actions=await evalJS(client,"(()=>{document.querySelector('[data-cn-tab=home]').click();document.querySelector('[data-cn-action=withdraw]').click();return {tab:document.getElementById('overview').dataset.cnView,request:document.getElementById('fundingRequestKind').value}})()");
   assert.deepEqual(actions,{tab:"account",request:"WITHDRAWAL"},"withdraw action must use existing form but never submit it");
   const desktopSwitch=await evalJS(client,"(()=>{document.getElementById('cnModeSwitch').click();const a=document.getElementById('overview').dataset.cnMode;document.getElementById('cnDesktopReturn').click();return {desktop:a,restored:document.getElementById('overview').dataset.cnMode}})()");
   assert.deepEqual(desktopSwitch,{desktop:"desktop",restored:"mobile"},"manual switch between desktop and mobile must work");
   console.log("FRONT_BROWSER_OK "+JSON.stringify({view:"narrow",login,mobile,actions,desktopSwitch}));
  }
 }
 console.log("Chromium desktop browser QA PASS; independent mobile QA runs in its own smoke script");
}finally{
 try{client?.close()}catch{}
 if(child){child.kill("SIGTERM");await pause(70);if(child.exitCode===null)child.kill("SIGKILL");}
 server.closeAllConnections();
 await new Promise(resolve=>server.close(()=>resolve()));
 await rm(dir,{recursive:true,force:true,maxRetries:15,retryDelay:250});
}
