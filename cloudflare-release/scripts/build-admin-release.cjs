
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const liveVersion = '08bbfd25-0773-4af5-8600-81367ea90ca7';
const liveFile = path.join(root, 'artifacts/deploy-tools/live-08bbfd25/worker.mjs');
const candidateDir = path.resolve(root, process.argv[2] || 'artifacts/trade-candidate');
const live = fs.readFileSync(liveFile, 'utf8');
const candidate = fs.readFileSync(path.join(candidateDir, 'worker.mjs'), 'utf8');
const digest = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(candidateDir, 'candidate.json'), 'utf8'));
assert.equal(digest(candidate), manifest.sha256);
assert.equal(manifest.kind, 'UNPUBLISHED_DEVELOPMENT_CANDIDATE');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start + ' / ' + end);
  assert.equal(source.indexOf(start, a + start.length), -1, start);
  return source.slice(a, b);
}

const adminChanges = [
  ['async function handleAdminApi(', '__name(handleAdminApi,'],
  ['async function cnProductSave(', 'async function cnFundSubscribe('],
  ['function productFailure(', 'function createApiHandler('],
];
let worker = live;
for (const [start, end] of adminChanges) {
  const before = section(live, start, end);
  const after = section(candidate, start, end);
  assert.notEqual(after, before);
  worker = worker.replace(before, () => after);
}

const customerStart = "  const data=await productBody(req,['action','product','terms','quantity','amount']);";
const originalSettlement = section(live, customerStart, 'function createApiHandler(');
const updatedSettlement = section(worker, customerStart, 'function createApiHandler(');
assert.equal(updatedSettlement.replace(/\r\n/g,'\n'), originalSettlement.replace(/\r\n/g,'\n'));

const pageLine = /^const replacementPages = (.+);$/m;
const livePages = JSON.parse(live.match(pageLine)[1]);
const nextPages = JSON.parse(candidate.match(pageLine)[1]);
assert(nextPages.adminNext.includes('admin-compat'));
worker = worker.replace(pageLine, () => 'const replacementPages = ' + JSON.stringify({ ...livePages, adminNext: nextPages.adminNext }) + ';');

const nextRoute = "    if(requestUrl.hostname==='admin.maacropierce.com'&&[";
const workersDevRoute = '    if(requestUrl.hostname==="lu----00001.dalulu05168.workers.dev"';
const entry = section(candidate, nextRoute, workersDevRoute)
  .replace("['/admin-next','/admin-compat']", "['/admin','/admin.html','/admin-next','/admin-compat']")
  .replace("requestUrl.pathname==='/admin-next'", "requestUrl.pathname!=='/admin-compat'");
assert(entry.includes("['/admin','/admin.html','/admin-next','/admin-compat']"));
assert(entry.includes("requestUrl.pathname!=='/admin-compat'"));
worker = worker.replace(workersDevRoute, () => entry + workersDevRoute);
worker = worker.replace(/^\/\/# sourceMappingURL=.*$/m, '');
assert(!/\b(request_intent|quote_evidence)\b/.test(worker), 'Pending order schema changes must stay out of the admin release');

const dir = fs.mkdtempSync(path.join(root, 'artifacts/admin-production-'));
fs.writeFileSync(path.join(dir, 'worker.mjs'), worker);
fs.writeFileSync(path.join(dir, 'candidate.json'), JSON.stringify({
  kind: manifest.kind, scope: 'ADMIN_ONLY', liveVersion,
  liveSourceSha256: digest(live), developmentSourceSha256: digest(candidate), sha256: digest(worker),
}, null, 2));
const relative = path.relative(root, dir).replaceAll(path.sep, '/');
const runner = fs.readFileSync(path.join(root,'scripts/test-trade-candidate.cjs'),'utf8')
  .replace("path.resolve(__dirname,'..')","path.resolve(__dirname,'../..')")
  .replaceAll('artifacts/trade-candidate/',relative+'/')
  .replace('env.NODE_OPTIONS=', "env.CN_QA_ADMIN_DEFAULT='1';env.NODE_OPTIONS=");
fs.writeFileSync(path.join(dir, 'verify.cjs'), runner);
console.log(relative);
console.log(digest(worker));

