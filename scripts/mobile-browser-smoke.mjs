// Local, fixture-backed real Chromium smoke. No production credentials or writes.
// The fixture is ONLY in this test harness, never shipped by web/mobile.mjs.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {spawn,spawnSync} from "node:child_process";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {setTimeout as pause} from "node:timers/promises";
const root=new URL("../web/",import.meta.url);
const requested=[];
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,"http://localhost").pathname;
 const auth=req.headers.authorization==="Bearer qa-mobile-fixture";
 let body=null,status=200,type="application/json";
 if(path.startsWith("/api/")){
  requested.push({path,method:req.method,auth});
  if(!auth){status=401;body={error:"Authentication required"};}
  else if(path==="/api/account")body={account:{id:"00000000-0000-4000-8000-000000000111",currency:"USD",cashCents:12345678},positions:[],orders:[]};
  else if(path==="/api/watchlist")body={items:[]};
  else if(path==="/api/account/analytics")body={historyAvailable:false,positionCostCents:null};
  else if(path==="/api/catalog")body={items:[{market:"US",symbol:"AAPL",name:"Apple Inc.",itemType:"STOCK"}]};
  else if(path==="/api/internal-products")body={items:[],stockQuotesConfigured:false};
  else if(path==="/api/internal-purchases")body={positions:[],purchases:[],sales:[],stockQuotesConfigured:false};
  else if(path.startsWith("/api/requests?"))body={items:[]};
  else if(path==="/api/support")body={thread:{clientId:"qa-user",status:"OPEN"},messages:[]};
  else if(path==="/api/private-data/status")body={ready:false};
  else if(path==="/api/health")body={status:"alive",pricingConnected:false,brokerConnected:false};
  else if(path==="/api/stock-quote"){status=503;body={error:"Verified US stock quote unavailable"};}
  else{status=404;body={error:"Not found"};}
 }else{
  const file=path==="/"?null:path.replace(/^\/+/,"");
  if(!file){type="text/html";body="<!doctype html><html><body><p>Origin test fixture only</p></body></html>";}
  else if(!["mobile.html","mobile.css","mobile.mjs","stock-chart.mjs","cn-logo.svg"].includes(file)){
   status=404;body="not found";type="text/plain";
  }else{
   try{body=await readFile(new URL(file,root));type=file.endsWith(".mjs")?"text/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":"text/html";}
   catch{status=404;body="not found";type="text/plain";}
  }
 }
 res.writeHead(status,{"content-type":type,"cache-control":"no-store"});
 res.end(Buffer.isBuffer(body)?body:typeof body==="string"?body:JSON.stringify(body));
});
const dir=await mkdtemp(join(tmpdir(),"cn-mobile-qa-"));
let chrome,cdp;
async function until(fn,ms=12000){let last;for(let i=0;i<ms/100;i++){try{const x=await fn();if(x)return x}catch(e){last=e}await pause(100)}throw Error("QA timeout: "+last)}
async function connection(wsUrl){
 const ws=new WebSocket(wsUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true})});
 let id=0;const queue=new Map();
 ws.addEventListener("message",e=>{
  const v=JSON.parse(e.data);
  if(v.id&&queue.has(v.id)){const p=queue.get(v.id);queue.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result||{})}
 });
 return {send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;queue.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))})},close(){ws.close()}};
}
async function ev(src){
 const v=await cdp.send("Runtime.evaluate",{expression:src,returnByValue:true,awaitPromise:true});
 if(v.exceptionDetails)throw Error("Browser JS exception: "+JSON.stringify(v.exceptionDetails));
 return v.result?.value;
}
try{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const found=spawnSync("which",["google-chrome"],{encoding:"utf8"});
 const binary=found.status===0?found.stdout.trim():"/usr/bin/chromium";
 chrome=spawn(binary,["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--disable-background-networking","--remote-allow-origins=*","--remote-debugging-port=0","--user-data-dir="+dir,"about:blank"],{stdio:"ignore"});
 const port=Number((await until(async()=>(await readFile(join(dir,"DevToolsActivePort"),"utf8")).split("\n")[0])));
 const page=await until(async()=>{const r=await fetch("http://127.0.0.1:"+port+"/json/list");return(await r.json()).find(x=>x.type==="page")});
 cdp=await connection(page.webSocketDebuggerUrl);await cdp.send("Page.enable");await cdp.send("Runtime.enable");
 const origin="http://127.0.0.1:"+server.address().port;
 await mkdir("artifacts",{recursive:true});
 for(const v of [{width:390,height:844,label:"phone"},{width:428,height:926,label:"large-phone"}]){
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:v.width,height:v.height,deviceScaleFactor:1,mobile:true});
  await cdp.send("Page.navigate",{url:origin+"/"});
  await until(()=>ev("document.readyState==='complete'"));
  await ev('sessionStorage.setItem("gsp_token","qa-mobile-fixture");true');
  await cdp.send("Page.navigate",{url:origin+"/mobile.html"});
  await until(()=>ev('document.readyState==="complete" && !!document.querySelector("#mobileApp")'));
  const state=await until(async()=>{
   const s=await ev('(()=>({ready:!!document.querySelector(".balance"),text:document.querySelector("#mobileScreen")?.textContent||""}))()');
   return s?.ready?s:null;
  });
  const layout=await ev('(()=>{const r=e=>{const b=document.querySelector(e).getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,body:r("body"),app:r("#mobileApp"),navigation:r("#mobileNav"),header:r(".mobile-head"),balance:document.querySelector(".balance")?.textContent,loginScreen:!!document.querySelector(".portal-logo"),hardware:document.querySelectorAll(".sb,.isl,.phone-frame,.status-bar,.dynamic-island").length}})()');
  assert.equal(layout.hardware,0,"No simulated hardware should be rendered");
  assert.equal(layout.loginScreen,false);
  assert.equal(layout.app.width,v.width,"Full viewport width; never a fixed 390px mock phone");
  assert.ok(layout.scrollWidth<=v.width+1,"No horizontal page overflow");
  assert.ok(layout.navigation.bottom<=v.height+1&&layout.navigation.y>v.height-140,"Bottom navigation must fit physical screen");
  assert.equal(layout.balance,"$123,456.78","Fixture cash must come from API, not hardcoded app data");
  const shot=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  await writeFile(join("artifacts","cn-mobile-"+v.label+".png"),Buffer.from(shot.data,"base64"));
  await ev('document.querySelector("#mobileNav [data-tab=trade]").click();true');
  const trade=await ev('(()=>({visible:document.querySelector("#mobileOrderForm")?.getBoundingClientRect().height>0,disabled:document.querySelector("#mobileOrderForm button[type=submit]")?.disabled}))()');
  assert.deepEqual(trade,{visible:true,disabled:true},"Trade UI should show and fail closed without execution pricing");
  await ev('document.querySelector("#mobileNav [data-tab=account]").click();true');
  assert.ok(await ev('!!document.querySelector("#mobileSupportForm")'),"Support form should appear in account module");
  console.log("MOBILE_BROWSER_OK "+JSON.stringify({view:v.label,layout,trade,requests:requested.length}));
 }
 assert.ok(requested.some(x=>x.path==="/api/account"&&x.auth),"Mobile must use authenticated account endpoint");
 assert.ok(requested.some(x=>x.path==="/api/watchlist"&&x.auth),"Mobile must read authenticated watchlist");
 assert.ok(requested.some(x=>x.path==="/api/internal-purchases"&&x.auth),"Mobile must read internal ledger");
 console.log("PASS: real Chromium mobile full-screen rendering, authenticated APIs, fail-closed trade and no phone shell");
}finally{
 try{cdp?.close()}catch{}
 if(chrome){chrome.kill("SIGTERM");await pause(50);if(chrome.exitCode===null)chrome.kill("SIGKILL")}
 server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));
 await rm(dir,{recursive:true,force:true,maxRetries:15,retryDelay:250});
}
