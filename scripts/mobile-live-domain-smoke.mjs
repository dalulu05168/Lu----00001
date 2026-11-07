// Public read-only domain verification after Render deploy. No credentials, account data, or writes.
import assert from "node:assert/strict";
async function get(uri){
 const response=await fetch(uri,{redirect:"follow",signal:AbortSignal.timeout(25000),headers:{Accept:"text/html,text/css,text/javascript,image/svg+xml"}});
 const body=await response.text();
 console.log("LIVE_HTTP "+JSON.stringify({from:uri,final:response.url,status:response.status,bytes:body.length,type:response.headers.get("content-type")}));
 assert.equal(response.status,200,uri+" does not return 200");
 return {response,body};
}
for(const base of ["https://nuvexapro.com","https://www.nuvexapro.com"]){
 const entry=await get(base+"/");
 assert.ok(entry.body.includes('id="entryGate"'),"Original login page missing from "+base);
 assert.ok(entry.body.includes('src="/mobile-entry.mjs"'),"Automatic mobile routing module missing from "+base);
 const mobile=await get(base+"/mobile.html");
 assert.match(mobile.body,/id="mobileApp"/);
 assert.match(mobile.body,/id="mobileNav"/);
 assert.ok(!mobile.body.includes("phone-frame"),"Fake phone frame still in mobile markup");
 const css=await get(base+"/mobile.css");
 assert.match(css.body,/min-height:100dvh/);
 assert.match(css.body,/safe-area-inset-bottom/);
 const js=await get(base+"/mobile.mjs");
 assert.match(js.body,/from "\.\/stock-chart\.mjs"/);
 assert.match(js.body,/api\("\/account"\)/);
 assert.match(js.body,/api\("\/watchlist"\)/);
 const routing=await get(base+"/mobile-entry.mjs");
 assert.match(routing.body,/location\.replace\("\/mobile\.html"\)/);
}
console.log("LIVE_MOBILE_OK: apex and www resolve new independent no-shell mobile page with original login routing, CSS and API module.");
