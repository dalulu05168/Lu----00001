const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/worker.template.mjs.in'), 'utf8');
const functionSource = (name, end) => source.slice(source.indexOf(`async function ${name}(`), source.indexOf(end));
const review = vm.runInNewContext(
  functionSource('pendingWithdrawCents', '__name(pendingWithdrawCents') +
  functionSource('reviewCashRequest', '__name(reviewCashRequest') + '\nreviewCashRequest',
  { invalid2(message) { throw new Error(message); } }
);
const id = '00000000-0000-0000-0000-000000000001';
function fixture({ kind = 'DEPOSIT', cash = '9007199254740993', amount = '2', frozen = '0', status = 'REVIEWED', auditError = false } = {}) {
  const calls = [];
  const db = { async connect() { return {
    async query(sql, params = []) {
      calls.push({ sql, params: Array.from(params) });
      if (sql.includes('FOR UPDATE OF r')) return { rows: [{ account_id: 'account', kind, amount_cents: amount, status }] };
      if (sql.includes('SELECT cash_cents')) return { rows: [{ cash_cents: cash }] };
      if (sql.includes('sum(amount_cents)')) return { rows: [{ total: frozen }] };
      if (auditError && sql.includes('INSERT INTO admin_audit_log')) throw new Error('Audit unavailable');
      return { rows: [] };
    },
    release() { calls.push({ sql: 'release' }); }
  }; } };
  return { calls, run: (role = 'MASTER', decision = 'APPROVE') => review(db, { role, userId: 'reviewer' }, { id, decision, reason: 'Review decision' }) };
}

test('final deposit preserves the exact balance and ledger amount', async () => {
  const { calls, run } = fixture();
  assert.equal((await run()).status, 'APPROVED');
  assert.deepEqual(calls.find(({ sql }) => sql.startsWith('UPDATE accounts')).params.map(String), ['account', '9007199254740995']);
  assert.deepEqual(calls.find(({ sql }) => sql.includes('INSERT INTO cash_ledger')).params.map(String), ['account', '2', '9007199254740995']);
});

test('withdrawal approval rejects when exact available balance is one cent short', async () => {
  const { calls, run } = fixture({ kind: 'WITHDRAW', cash: '9007199254740994', frozen: '9007199254740993', amount: '2' });
  await assert.rejects(run(), /Insufficient available balance/);
  assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE accounts')), false);
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
});

test('finalized requests and non-master final approvals cannot write the ledger', async () => {
  for (const [status, role, error] of [['APPROVED', 'MASTER', /already finalized/], ['REVIEWED', 'SUBADMIN', /Master permission/]]) {
    const { calls, run } = fixture({ status });
    await assert.rejects(run(role), error);
    assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO cash_ledger')), false);
  }
});

test('audit failure rolls the final approval transaction back', async () => {
  const { calls, run } = fixture({ auditError: true });
  await assert.rejects(run(), /Audit unavailable/);
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), false);
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
});
