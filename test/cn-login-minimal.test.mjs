import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const get=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("customer login remains functional but contains no redundant footer, tagline or bottom disclaimer",async()=>{
 const html=await get("web/index.html");
 const dom=new JSDOM(html).window.document;
 const login=dom.getElementById("entryGate");
 assert.ok(login);
 for(const id of ["entryForm","entryEmail","entryPassword","entrySubmit","entryMode","entryFeedback"])
  assert.ok(login.querySelector("#"+id),id+" removed");
 assert.equal(login.querySelector(".portal-foot"),null);
 assert.equal(login.querySelector(".portal-sim-note"),null);
 assert.equal(login.querySelector(".portal-subtitle"),null);
 assert.equal(login.querySelector(".portal-logo img")?.getAttribute("src"),"/cn-login-logo.svg");
 assert.ok(dom.getElementById("overview"),"Actual account workspace must remain");
 assert.ok(html.includes("/mobile-entry.mjs"),"Current mobile routing must remain");
});

test("administrator login and real 2FA controls stay while bottom labels disappear",async()=>{
 const html=await get("web/admin.html");
 const doc=new JSDOM(html).window.document;
 const login=doc.getElementById("admin-login");
 assert.ok(login);
 for(const id of ["adminLoginForm","adminTotpForm","totpCode","adminEmail","adminPassword","totpBack","loginFeedback","showAdminSetup"])
  assert.ok(login.querySelector("#"+id),id+" removed");
 assert.equal(login.querySelector(".portal-foot"),null);
 assert.equal(login.querySelector(".portal-subtitle"),null);
 assert.equal(login.querySelector(".portal-logo img")?.getAttribute("src"),"/cn-login-logo.svg");
 assert.ok(doc.getElementById("bootstrapForm"),"Admin setup flow must remain");
});

test("silver N is smaller and rotates flat slowly; C static and white starlets float",async()=>{
 const svg=await get("web/cn-login-logo.svg");
 assert.ok(svg.includes('class="cn-fixed-c"'));
 assert.ok(svg.includes('class="cn-n-scale"'));
 assert.ok(svg.includes('class="cn-turning-n"'));
 assert.match(svg,/transform:scale\(\.86\)/);
 assert.match(svg,/animation:cnRotateN 40s linear infinite/);
 assert.match(svg,/transform:rotate\(360deg\)/);
 assert.doesNotMatch(svg,/rotateY\(|perspective\(/);
 assert.equal((svg.match(/class="cn-star"/g)||[]).length,12);
 assert.match(svg,/fill:#edf3fb/);
 assert.match(svg,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(svg,/<script|<foreignObject|<image/i);
});
