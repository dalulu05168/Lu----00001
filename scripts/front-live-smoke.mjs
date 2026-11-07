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
 assert.ok(page.body.includes('src="/cn-login-logo.svg"'),"Animated login logo missing at "+url);
 const assetBase=new URL(page.url);
 const stylesheet=await get(new URL("/front-cn-v3.css",assetBase).href);
 assert.match(stylesheet.type||"",/text\/css/);
 assert.ok(stylesheet.body.includes("--cn-lime:#d7ff00"),"New CN palette missing at "+assetBase);
 const logo=await get(new URL("/cn-login-logo.svg",assetBase).href);
 assert.match(logo.type||"",/image\/svg\+xml/);
 assert.ok(logo.body.includes("cnRotateN"),"N rotation missing at "+assetBase);
 console.log("FRONT_LIVE_OK "+JSON.stringify({requested:url,resolved:page.url,http:page.status,css:stylesheet.status,logo:logo.status,bodyBytes:page.body.length}));
}
console.log("PASS: live frontend hostnames are serving the verified CN login, CSS and rotating logo.");
