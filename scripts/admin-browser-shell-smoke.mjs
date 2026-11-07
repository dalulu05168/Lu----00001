// Isolated, read-only Chromium test of the REAL post-login admin UI.
// Fake session and API are strictly local to this test: no production credentials or writes.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn,spawnSync} from "node:child_process";
import {readFile,writeFile,mkdir,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as pause} from "node:timers/promises";

const web=new URL("../web/",import.meta.url);
const files=new Set(["admin.html","admin.mjs","admin.css","admin-cn-v3.css","portal.css",
  "portal.mjs","cn-logo.svg","cn-login-logo.svg","stock-chart.mjs"]);
const requests=[];
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  try{
    if(path.startsWith("/api/")){
      requests.push({path,method:req.method,auth:req.headers.authorization});
      if(req.method!=="GET"){res.writeHead(405);res.end("fixture prohibits writes");return;}
      const body=path==="/api/admin/me"?{role:"MASTER",id:"qa-master"}:{items:[],clients:[],authorized:false};
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
      res.end(JSON.stringify(body));return;
    }
    const file=path==="/"
      ?"admin.html":path.substring(1);
    if(!files.has(file)){res.writeHead(404);res.end("not found");return;}
    const data=await readFile(new URL(file,web));
    const type=file.endsWith(".mjs")?"text/javascript":file.endsWith(".css")?"text/css":
      file.endsWith(".svg")?"image/svg+xml":"text/html";
    res.writeHead(200,{"content-type":type,"cache-control":"no-store"});res.end(data);
  }catch(e){res.writeHead(500);res.end(String(e))}
});
async function until(fn,ms=18000){
  let error;
  for(let i=0;i<ms/100;i++){try{const value=await fn();if(value)return value;}catch(e){error=e;}await pause(100)}
  throw Error("Timed out waiting for actual browser: "+String(error||"condition not ready"));
}
function chromium(){
  for(const name of ["google-chrome","google-chrome-stable","chromium","chromium-browser"]){
    const r=spawnSync("which",[name],{encoding:"utf8"});
    if(r.status===0&&r.stdout.trim())return r.stdout.trim();
  }
  throw Error("Chromium browser unavailable on CI worker");
}
async function connect(url){
  const ws=new WebSocket(url);
  await new Promise((yes,no)=>{ws.addEventListener("open",yes,{once:true});ws.addEventListener("error",no,{once:true})});
  let counter=0;const pending=new Map();
  ws.addEventListener("message",e=>{
    const item=JSON.parse(e.data);const result=pending.get(item.id);
    if(!result)return;pending.delete(item.id);
    item.error?result.reject(Error(item.error.message)):result.resolve(item.result||{});
  });
  return {send(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++counter;pending.set(id,{resolve,reject});
      ws.send(JSON.stringify({id,method,params}));
    });
  },close(){ws.close()}};
}
async function js(cdp,fn){
  const result=await cdp.send("Runtime.evaluate",{
    expression:"("+fn.toString()+")()",returnByValue:true,awaitPromise:true
  });
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
function desktopState(){
  const root=document.querySelector("#adminWorkspace");
  const top=document.querySelector("#adminTopbar");
  if(!root||root.hidden||!top||top.hidden)return null;
  return {
    background:getComputedStyle(root).backgroundColor,
    topDisplay:getComputedStyle(top).display,
    navDisplay:getComputedStyle(document.querySelector("#adminPages")).display,
    role:document.querySelector("#adminRole").textContent,
    tabs:document.querySelectorAll("[data-admin-page]").length,
    active:document.querySelector('[data-admin-page][aria-current="page"]')?.dataset.adminPage,
    panes:document.querySelectorAll(".admin-pane:not([hidden])").length,
    loginHidden:document.querySelector("#admin-login").hidden
  };
}
function mobileState(){
  const root=document.querySelector("#adminWorkspace"),button=document.querySelector("#adminMobileNavToggle");
  if(!root||root.hidden)return null;
  return {
    workspaceVisible:!root.hidden,
    navDisplay:getComputedStyle(document.querySelector("#adminPages")).display,
    mobileMenu:getComputedStyle(button).display,
    width:document.documentElement.clientWidth
  };
}
const temp=await mkdtemp(join(tmpdir(),"cn-admin-fixture-"));
let browser,cdp;
try{
  await new Promise(yes=>server.listen(0,"127.0.0.1",yes));
  browser=spawn(chromium(),["--headless=new","--no-sandbox","--disable-gpu",
    "--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
    "--disable-background-networking","--disable-extensions",
    "--remote-allow-origins=*","--remote-debugging-port=0",
    "--user-data-dir="+temp,"about:blank"],{stdio:"ignore"});
  const debugPort=await until(async()=>{
    const data=await readFile(join(temp,"DevToolsActivePort"),"utf8");
    return Number(data.trim().split("\n")[0])||null;
  });
  const tab=await until(async()=>{
    const response=await fetch("http://127.0.0.1:"+debugPort+"/json");
    const tabs=await response.json();
    return tabs.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);
  });
  cdp=await connect(tab.webSocketDebuggerUrl);
  await cdp.send("Page.enable");await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1360,height:850,deviceScaleFactor:1,mobile:false});
  await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:'sessionStorage.setItem("gsp_admin_token","qa-admin-only");'});
  await cdp.send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port+"/"});
  const desktop=await until(async()=>{
    const x=await js(cdp,desktopState);
    return x?.active==="dashboard"?x:null;
  });
  assert.equal(desktop.background,"rgb(11, 13, 10)","New charcoal CSS not applied");
  assert.equal(desktop.topDisplay,"grid","Expected new CSS grid admin topbar");
  assert.notEqual(desktop.navDisplay,"none");
  assert.equal(desktop.role,"主账户");
  assert.equal(desktop.tabs,10);
  assert.equal(desktop.panes,1);
  assert.equal(desktop.loginHidden,true);
  const output=new URL("../artifacts/",import.meta.url);
  await mkdir(output,{recursive:true});
  const image=await cdp.send("Page.captureScreenshot",{format:"png"});
  await writeFile(new URL("cn-admin-qa-desktop.png",output),Buffer.from(image.data,"base64"));
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await cdp.send("Page.reload",{ignoreCache:true});
  let lastPhone=null;
  const phone=await until(async()=>{
    lastPhone=await js(cdp,mobileState);
    return lastPhone?.width<=650&&lastPhone?.mobileMenu!=="none"?lastPhone:null;
  },9000).catch(error=>{throw Error(error.message+"; observed mobile state: "+JSON.stringify(lastPhone));});
  console.log("ADMIN_MOBILE_VIEWPORT "+JSON.stringify(phone));
  assert.equal(phone.workspaceVisible,true);
  assert.notEqual(phone.mobileMenu,"none","Mobile navigation button hidden");
  assert.equal(phone.navDisplay,"none","Mobile navigation unexpectedly expanded");
  const mobile=await cdp.send("Page.captureScreenshot",{format:"png"});
  await writeFile(new URL("cn-admin-qa-mobile.png",output),Buffer.from(mobile.data,"base64"));
  assert.ok(requests.some(x=>x.path==="/api/admin/me"&&x.auth==="Bearer qa-admin-only"));
  assert.ok(requests.every(x=>x.method==="GET"),"Fixture would have modified state");
  console.log("ADMIN_BROWSER_OK "+JSON.stringify({desktop,phone,apiRequests:requests.length,mode:"isolated fixture"}));
}finally{
  cdp?.close();if(browser&&!browser.killed)browser.kill("SIGTERM");
  await new Promise(done=>server.close(done));
  await rm(temp,{recursive:true,force:true});
}
