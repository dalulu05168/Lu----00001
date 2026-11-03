import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";

const read=p=>readFileSync(new URL("../web/"+p,import.meta.url),"utf8");
test("brand and animated login are shared across client and admin",()=>{
  for(const path of ["index.html","admin.html"]){
    const html=read(path);
    assert.match(html,/CN Capital/);
    assert.match(html,/portal-stars/);
    assert.match(html,/portal\.mjs/);
    assert.match(html,/portal\.css/);
    assert.match(html,/class="cn-capital-mark"/);
    assert.doesNotMatch(html,/adminOtp|activateForm|动态验证码/);
  }
  const animation=read("portal.mjs");
  assert.match(animation,/requestAnimationFrame/);
  assert.match(animation,/prefers-reduced-motion/);
  new Script(animation);
});
test("admin only offers email/password and never asks for a time-based code",()=>{
  const admin=read("admin.html");
  assert.match(admin,/id="adminLoginForm"/);
  assert.match(admin,/id="adminEmail"/);
  assert.match(admin,/id="adminPassword"/);
  assert.match(admin,/data-role-choice="MASTER"/);
  assert.match(admin,/data-role-choice="SUBADMIN"/);
  assert.doesNotMatch(admin,/id="adminOtp"|id="activateOtp"|id="activateForm"/);
});
test("dark graphite theme and regular weight remain consistent",()=>{
  const frontend=read("styles.css"),admin=read("admin.css"),portal=read("portal.css");
  for(const color of ["#17191c","#1e2023","#363a3f"])assert.ok(frontend.includes(color)&&admin.includes(color));
  assert.match(portal,/background:linear-gradient/);
  assert.match(portal,/font-weight:400!important/);
  assert.match(portal,/portalReveal/);
  assert.match(frontend,/font-weight:400!important/);
});
