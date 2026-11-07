import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
test("both existing login pages use the independent animated N logo and retain authentication controls",async()=>{
  const [front,admin]=await Promise.all([read("web/index.html"),read("web/admin.html")]);
  const userDoc=new JSDOM(front).window.document,adminDoc=new JSDOM(admin).window.document;
  assert.equal(userDoc.querySelector("#entryGate .portal-logo img")?.getAttribute("src"),"/cn-login-logo.svg");
  assert.equal(adminDoc.querySelector("#admin-login .portal-logo img")?.getAttribute("src"),"/cn-login-logo.svg");
  assert.equal(userDoc.querySelector(".sidebar-logo .cn-capital-mark")?.getAttribute("src"),"/cn-logo.svg");
  assert.equal(adminDoc.querySelector("#adminTopbar .cn-new-logo")?.getAttribute("src"),"/cn-logo.svg");
  for(const id of ["adminLoginForm","adminTotpForm","totpCode","adminWorkspace","adminLogout"])
    assert.ok(adminDoc.getElementById(id),id);
  assert.match(front,/id="authForm"/);
  assert.match(admin,/src="\/admin\.mjs"/);
});
test("the uploaded CN shape has a stationary C, a separately spinning N and silver drifting stars",async()=>{
  const animated=await read("web/cn-login-logo.svg"),staticLogo=await read("web/cn-logo.svg");
  const svg=new JSDOM(animated,{contentType:"image/svg+xml"}).window.document;
  assert.equal(svg.querySelectorAll(".cn-fixed-c").length,1);
  assert.equal(svg.querySelectorAll(".cn-turning-n").length,1);
  assert.equal(svg.querySelectorAll(".cn-star").length,12);
  assert.match(animated,/animation:cnRotateN 40s/);
  assert.match(animated,/transform:scale\(\.86\)/);
  assert.match(animated,/rotate\(360deg\)/);
  assert.doesNotMatch(animated,/rotateY\(/);
  assert.match(animated,/cnSilverDrift/);
  assert.match(animated,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(staticLogo,/@keyframes|cn-star|cnSilverDrift/);
  assert.doesNotMatch(animated,/<script|<image|<foreignObject|<rect/i);
});
test("admin gateway serves both vector logo files without changing the stock quote API",async()=>{
  const gateway=await read("src/http-api.mjs");
  assert.match(gateway,/"\/cn-logo\.svg"/);
  assert.match(gateway,/"\/cn-login-logo\.svg"/);
  const server=await read("src/server.mjs");
  assert.match(server,/us-stock-quotes\.mjs/);
});
