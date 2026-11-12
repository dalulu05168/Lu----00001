import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { integerCents, cents, amount, formatMoney } from './api.mjs';

test('mobile preserves adjacent integer-cent strings and signed decimal amounts', () => {
  assert.equal(formatMoney(cents('9007199254740993')), '90,071,992,547,409.93');
  assert.equal(formatMoney(cents('9007199254740994')), '90,071,992,547,409.94');
  assert.equal(formatMoney(amount('-90071992547409.95')), '-90,071,992,547,409.95');
  assert.equal(formatMoney(cents(2)), '0.02');
  assert.equal(integerCents('9007199254740994') - integerCents('9007199254740993'), 1n);
  for (const value of [null, '1e3', '1.1', Number.MAX_SAFE_INTEGER + 1]) assert.equal(cents(value), null);
});

test('desktop renders exact money and sums position costs without losing a cent', () => {
  const html = fs.readFileSync(new URL('../cloudflare-release/web/desktop.html', import.meta.url), 'utf8');
  const helpers = html.slice(html.indexOf('function integerCents('), html.indexOf('function $(id)'));
  const total = html.slice(html.indexOf('function safeTotal('), html.indexOf('function cost('));
  const ui = vm.runInNewContext(helpers + total + '\n({desktopCents, decimalCents, f, safeTotal})');
  assert.equal(ui.f(ui.desktopCents('9007199254740993')), '90,071,992,547,409.93');
  assert.equal(ui.f(ui.desktopCents(2)), '0.02');
  assert.equal(ui.f(ui.safeTotal([{c:'90071992547409.93'}, {c:'0.01'}], 'c')), '90,071,992,547,409.94');
  assert.equal(ui.decimalCents('90071992547409.94') > ui.decimalCents('90071992547409.93'), true);
  assert.equal(ui.f(ui.desktopCents(Number.MAX_SAFE_INTEGER + 1)), '—');
});
