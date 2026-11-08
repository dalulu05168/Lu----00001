import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

// Run only against the *extracted GPT Library candidate*, never against old GitHub HTML.
// Usage: node scripts/issue42-ui-handoff-verify.mjs /path/to/unzipped-ui
const root = resolve(process.argv[2] || '.');
const pages = {};
let scripts = 0;
for (const name of ['前台.html', '手机端.html', '后台.html']) {
  const html = readFileSync(join(root, name), 'utf8');
  pages[name] = html;
  assert.match(html, /<html\b/i, name + ': missing document');
  assert.match(html, /<style\b/i, name + ': missing styling');
  assert.match(html, /<script\b/i, name + ': missing interactivity');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) {
      new vm.Script(match[1], { filename: name });
      scripts++;
    }
  }
  assert.doesNotMatch(html, /function fillO\s*\(/, name + ': fabricated client orders');
  assert.doesNotMatch(html, /已提交身份审核，等待人工审核 · 演示界面/, name + ': fabricated KYC submit');
}
assert.equal(scripts, 13, 'unexpected inline script count');
const front = pages['前台.html'];
assert.match(front, /var TRADING_ENABLED=false;/, 'trading gate must stay closed');
assert.match(front, /function clearSnapshot\s*\(/, 'snapshot reset missing');
assert.match(front, /function cash\(\)\{return HAVE\.cashOverride/, 'unconfirmed cash is displayed');
for (const id of ['tb-ord', 'tb-hold', 'tb-watch', 'tb-req']) {
  assert.ok(front.includes('id="' + id + '"'), 'front: lost ' + id);
}
const mobile = pages['手机端.html'];
assert.match(mobile, /function avail\(\)\{return D\.auth&&D\.accountReady/, 'cash authorization gate missing');
assert.match(mobile, /auth:0,accountReady:false/, 'not logged out by default');
const admin = pages['后台.html'];
for (const id of ['p-over', 'p-cli', 'p-appr', 'p-fund', 'p-cat', 'm-mir', 'm-ap', 'm-det', 'm-sub', 'm-sec', 'm-ed', 'm-chat', 'm-subpass', 'm-sublock', 'm-com', 'm-cf']) {
  assert.ok(admin.includes('id="' + id + '"'), 'admin: lost ' + id);
}
assert.match(admin, /保存未确认，未更新界面/, 'unconfirmed admin save may claim success');
console.log('UI_HANDOFF_STATIC_OK: three pages, 13 valid inline scripts, original entry IDs kept');
