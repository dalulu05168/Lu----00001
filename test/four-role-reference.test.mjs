import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../web/role-preview.html',import.meta.url),'utf8');

test('restored original user reference covers client, operations and master roles',()=>{
  assert.match(html,/const opsNav=/);
  assert.match(html,/const masterNav=/);
  assert.match(html,/role:.*client/);
  assert.match(html,/Approval Center/);
  assert.match(html,/Treasury & Ledger/);
  assert.match(html,/Client Accounts/);
  assert.match(html,/Portfolio/);
  assert.match(html,/const state=/);
});
test('crosshair and high-resolution chart mechanics retained',()=>{
  assert.match(html,/market-crosshair|chart-crosshair/);
  assert.match(html,/canvas|<svg/);
  assert.match(html,/font-weight: 400 !important/);
  assert.match(html,/shape-rendering: geometricPrecision/);
});
test('embedded Javascript is syntactically valid',()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>0);
  for(const [,src] of scripts)if(src.trim())new Script(src);
});
test('real admin layout preserves secure flows and separates capabilities',()=>{
  const admin=readFileSync(new URL('../web/admin.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../web/admin.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('../web/admin.css',import.meta.url),'utf8');
  for(const id of ['adminLoginForm','bootstrapForm','recoverForm','subadminForm','listingForm','adminWorkspace'])assert.match(admin,new RegExp('id="'+id+'"'));
  assert.match(js,/role===["']MASTER["']/);
  assert.match(admin,/data-role-choice="MASTER"/);
  assert.match(admin,/data-role-choice="SUBADMIN"/);
  assert.match(js,/data-required-role/);
  for(const page of ['dashboard','clients','catalog','approvals','treasury','risk','audit'])assert.match(admin,new RegExp('data-pane="'+page+'"'));
  for(const id of ['workflowCategory','workflowRefresh','workflowReviewForm','workflowDecision','workflowReason','fundingRequestRows'])
    assert.match(admin,new RegExp('id="'+id+'"'));
  assert.match(admin,/审核不执行资金划转/);
  assert.match(admin,/不代表银行支付流水或真实资金余额/);
  assert.doesNotMatch(admin,/后端没有资金申请|adminOtp|activateForm|6 位动态验证码|TOTP/);
  assert.match(css,/h1,h2,h3\{font-weight:650/);
  assert.doesNotMatch(css,/\*,\*::before,\*::after\{[^}]*font-weight:400!important/);
  new Script(js.replace(/^const el.*$/m,'const el=id=>document.getElementById(id);')); // syntax smoke
});
