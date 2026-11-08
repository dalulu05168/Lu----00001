import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.argv[2] || process.cwd();
const names = ['前台.html', '手机端.html', '后台.html'];
const files = Object.fromEntries(names.map(name => [name, readFileSync(join(root, name), 'utf8')]));
let scripts = 0;
for (const [name, html] of Object.entries(files)) {
  assert.match(html, /<html\b/i, name + ': HTML missing');
  assert.match(html, /<style\b/i, name + ': style missing');
  assert.match(html, /<script\b/i, name + ': script missing');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) { new vm.Script(match[1], {filename: name}); scripts++; }
  }
  assert.doesNotMatch(html, /function fillO\s*\(/, name + ': fabricated order execution');
  assert.doesNotMatch(html, /已提交身份审核，等待人工审核 · 演示界面/, name + ': fabricated form success');
}
const front = files['前台.html'];
assert.match(front, /var TRADING_ENABLED=false;/, 'front: trading gate must remain off');
assert.match(front, /function clearSnapshot\s*\(/, 'front: no reset function');
assert.match(front, /function cash\(\)\{return HAVE\.cashOverride/, 'front: cash cannot be inferred');
for (const id of ['tb-ord', 'tb-hold', 'tb-watch', 'tb-req'])
  assert.ok(front.includes('id="' + id + '"'), 'front missing ' + id);
const mobile = files['手机端.html'];
assert.match(mobile, /function avail\(\)\{return D\.auth&&D\.accountReady/, 'mobile: cash availability gate missing');
assert.match(mobile, /auth:0,accountReady:false/, 'mobile: logged-out default missing');
const admin = files['后台.html'];
for (const id of ['p-over', 'p-cli', 'p-appr', 'p-fund', 'p-cat', 'm-mir', 'm-ap', 'm-det', 'm-sub', 'm-sec', 'm-ed', 'm-chat', 'm-subpass', 'm-sublock', 'm-com', 'm-cf'])
  assert.ok(admin.includes('id="' + id + '"'), 'admin missing ' + id);
assert.match(admin, /保存未确认，未更新界面/, 'admin: unconfirmed save must not succeed');
console.log('UI_STATIC_OK:', names.length, 'HTML files,', scripts, 'valid inline scripts; business gates present');