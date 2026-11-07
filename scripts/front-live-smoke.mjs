// Non-authenticated, read-only smoke of the two public production frontend hostnames.
// Does not submit credentials, open orders, invoke writes, or touch the admin service.
import assert from "node:assert/strict";
import {setTimeout as pause} from "node:timers/promises";
const sites=["https://nuvexapro.com/","https://www.nuvexapro.com/"];
async function get(url){
 let last;
 for(let i=0;i<3;i++){
  try{
   const res=await fetch(url,{headers:{"accept":"text/html,text/css,image/svg+xml"},signal:AbortSignal.timeout(20000),redirect:"follow"});
   const body=await res.text();
   if(res.status===200)return {body,status:res.status,url:res.url,type:res.headers.get("content-type")};
   last=new Error("HTTP "+res.status+" at "+url);
  }catch(e){last=e;}
  if(i<2)await pause(1000);
 }
 throw last;
}
for(const url of sites){
 const page=await get(url);
 assert.equal(page.status,200);
 assert.ok(page.body.includes('id="entryForm"'),"Unexpected frontend login form at "+url);
 assert.ok(page.body.includes('href="/front-cn-v3.css"'),"New CN UI not visible at "+url);
 assert.ok(page.body.includes('href="/front-cn-v4.css"'),"Two-tab CN v4 UI missing at "+url);
 assert.ok(page.body.includes('src="/front-cn-v4.mjs"'),"New live desktop layout bridge missing at "+url);
 const loginMarkup=page.body.slice(page.body.indexOf('id="entryGate"'),page.body.indexOf('id="overview"'));
 assert.ok(!loginMarkup.includes('class="portal-foot"'),"Old login footer still visible at "+url);
 assert.ok(!loginMarkup.includes('class="portal-sim-note"'),"Old login disclaimer still visible at "+url);

 assert.ok(page.body.includes('src="/cn-login-logo.svg"'),"Animated login logo missing at "+url);
 const assetBase=new URL(page.url);
 const stylesheet=await get(new URL("/front-cn-v3.css",assetBase).href);
 assert.match(stylesheet.type||"",/text\/css/);
 assert.ok(stylesheet.body.includes("--cn-lime:#d7ff00"),"New CN palette missing at "+assetBase);
 const v4=await get(new URL("/front-cn-v4.css",assetBase).href);
 assert.ok(v4.body.includes(".cn-v4-header"),"V4 header stylesheet not live");
 assert.match(v4.type||"",/text\/css/);
 const bridge=await get(new URL("/front-cn-v4.mjs",assetBase).href);
 assert.ok(bridge.body.includes("cnV4Header"),"New real account/trade UI bridge not live");
 assert.match(bridge.type||"",/text\/javascript/);
 const logo=await get(new URL("/cn-login-logo.svg",assetBase).href);
 assert.match(logo.type||"",/image\/svg\+xml/);
 assert.ok(logo.body.includes("cnRotateN"),"N rotation missing at "+assetBase);
 assert.ok(logo.body.includes("cnRotateN 40s"),"Slow 40 s planar N rotation missing");
 assert.ok(logo.body.includes("rotate(360deg)"),"N must rotate in image plane");
 assert.ok(!logo.body.includes("rotateY("),"Old 3D flipping N still deployed");
 assert.ok(logo.body.includes("transform:scale(.86)"),"N reduction missing");

 console.log("FRONT_LIVE_OK "+JSON.stringify({requested:url,resolved:page.url,http:page.status,css:stylesheet.status,logo:logo.status,bodyBytes:page.body.length}));
}
console.log("PASS: live frontend hostnames are serving the verified CN login, CSS and rotating logo.");

const admin=await get("https://admin.nuvexapro.com/");
assert.equal(admin.status,200);
assert.ok(admin.body.includes('id="adminLoginForm"'),"Admin login missing");
assert.ok(admin.body.includes('id="adminTotpForm"'),"Original 2FA form missing");
const adminLogin=admin.body.slice(admin.body.indexOf('id="admin-login"'),admin.body.indexOf('id="bootstrapPanel"'));
assert.ok(!adminLogin.includes('class="portal-foot"'),"Admin login lower footer still present");
assert.ok(adminLogin.includes('src="/cn-login-logo.svg"'),"Admin logo differs from customer login");
console.log("CN_V4_PRODUCTION_ACCEPTED "+JSON.stringify({customer:true,admin:true,login2FA:true,nMotion:"40s flat",uiShell:"new 2-tab",footerRemoved:true}));
