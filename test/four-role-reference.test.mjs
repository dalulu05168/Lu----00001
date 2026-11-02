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
  const scripts=[...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/g)];
  assert.ok(scripts.length>0);
  for(const [,src] of scripts)if(src.trim())new Script(src);
});
