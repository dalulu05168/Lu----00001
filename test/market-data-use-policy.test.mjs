import test from 'node:test';
import assert from 'node:assert/strict';
import { assessClientQuoteDisplay, assessQuoteForOrderExecution } from '../src/market-data-use-policy.mjs';

const now = 1_800_000_000_000;
const quote = {market:'US', symbol:'AAPL', source:'Provider X', priceCents:12001, timestampMs:now-12_000};
const rights = {provider:'Provider X', externalClientDisplay:true, reviewReference:'operator-reviewed-contract-id'};

test('rejects absent rights even when a provider declares a quote entitled', () => {
  assert.equal(assessClientQuoteDisplay({quote:{...quote, entitled:true},now}).reason,'EXTERNAL_DISPLAY_RIGHTS_UNVERIFIED');
  assert.equal(assessClientQuoteDisplay({quote,rights:{...rights,reviewReference:''},now}).allowed,false);
  assert.equal(assessClientQuoteDisplay({quote,rights:{...rights,provider:'Other'},now}).allowed,false);
});

test('never accepts six-day quotes as live display or future timestamps', () => {
  assert.equal(assessClientQuoteDisplay({quote:{...quote,timestampMs:now-6*86400000},rights,now}).reason,'STALE_OR_FUTURE_QUOTE');
  assert.equal(assessClientQuoteDisplay({quote:{...quote,timestampMs:now+6000},rights,now}).reason,'STALE_OR_FUTURE_QUOTE');
  assert.equal(assessClientQuoteDisplay({quote,rights,now,maxAgeMs:6*86400000}).reason,'INVALID_FRESHNESS_POLICY');
});

test('rejects unsupported markets and malformed quotes', () => {
  for (const invalid of [{...quote,market:'HK'},{...quote,market:'MY'},{...quote,priceCents:0},{...quote,symbol:'AAPL/..'},{...quote,source:''}]) {
    assert.equal(assessClientQuoteDisplay({quote:invalid,rights,now}).allowed,false);
  }
  assert.equal(assessClientQuoteDisplay({quote:{...quote,market:'CN',symbol:'600519'},rights,now}).allowed,true);
});

test('valid reviewed display quote remains explicitly non-executable', () => {
  const result=assessClientQuoteDisplay({quote,rights,now});
  assert.equal(result.allowed,true);
  assert.equal(result.purpose,'DISPLAY_ONLY');
  assert.equal(result.ageMs,12000);
  assert.equal(result.orderExecutionAllowed,false);
  assert.equal(assessQuoteForOrderExecution({quote,rights,now}).reason,'BROKER_EXECUTION_NOT_SUPPORTED');
});