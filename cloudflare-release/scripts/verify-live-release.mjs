// Read-only check: does the live site serve exactly the release bundle stored in Git?
// Only sends GET requests. Never writes to production, never needs credentials.
// Usage: node scripts/verify-live-release.mjs releases/860bea19
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve(process.argv[2] || 'releases/860bea19');
const bundle = fs.readFileSync(path.join(dir, 'worker.mjs'));
const publication = JSON.parse(fs.readFileSync(path.join(dir, 'publication.json'), 'utf8'));
const text = bundle.toString('utf8');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

const sha = crypto.createHash('sha256').update(bundle).digest('hex');
check('bundle sha256 matches publication.json', sha === publication.sha256, sha);

const agents = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
};
const pages = [
  ['customer desktop', 'https://nuvexapro.com/', 'desktop'],
  ['customer mobile', 'https://nuvexapro.com/', 'mobile'],
  ['admin login', 'https://admin.maacropierce.com/', 'desktop'],
  ['admin workbench', 'https://admin.maacropierce.com/admin-next', 'desktop'],
];
for (const [name, url, agent] of pages) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': agents[agent] }, cache: 'no-store' });
    const body = await res.text();
    const embedded = text.includes(body) || text.includes(JSON.stringify(body).slice(1, -1));
    check(`${name} page is served from this bundle`, res.status === 200 && embedded, `${res.status} ${body.length}B`);
  } catch (e) { check(`${name} page is served from this bundle`, false, String(e)); }
}
for (const origin of ['https://nuvexapro.com', 'https://admin.maacropierce.com']) {
  try {
    const ready = await (await fetch(origin + '/api/ready', { cache: 'no-store' })).json();
    check(`${origin} database connected`, ready.database === 'connected', JSON.stringify(ready));
    const anon = await fetch(origin + '/api/account', { cache: 'no-store' });
    check(`${origin} anonymous /api/account rejected`, anon.status === 401, String(anon.status));
  } catch (e) { check(`${origin} readiness`, false, String(e)); }
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed for release ${publication.version}`);
process.exitCode = failed ? 1 : 0;
