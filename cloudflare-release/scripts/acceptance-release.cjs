// Runs the isolated acceptance suites against a given worker bundle (default: the stored 860bea19 release).
// All business writes go to a local PGlite database on 127.0.0.1. Production is only read (live UI pages).
// Usage: node scripts/acceptance-release.cjs [--bundle path/to/worker.mjs] [suite ...]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const at = args.indexOf('--bundle');
const bundle = path.resolve(root, at >= 0 ? args.splice(at, 2)[1] : 'releases/860bea19/worker.mjs');
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex');
const testedSha = digest();
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'artifacts', 'release-acceptance-'));
const suites = {"mobile-session":["mobile-session.cjs",8941],"funding-safety":["funding-safety.cjs",8930],"login-page":["login-page.cjs",8928],"admin-next":["admin-next.cjs",8918],"trade-database":["trade-database.cjs",8917],"frontend-sync":["frontend-sync.cjs",8927],"admin-account-layout":["admin-account-layout.cjs",8926],"news":["news-browser.cjs",8916],"browser-sessions":["browser-sessions.cjs",8915],"security":["security.cjs",8914],"quote-guards":["quote-guards.cjs",8913],"notification-session":["notification-session.cjs",8912],"product-recovery":["product-recovery.cjs",8911],"admin-funding":["admin-funding.cjs",8910],"order-concurrency":["order-concurrency.cjs",8908],"layout-controls":["layout-controls.cjs",8907],"write-receipts":["write-receipts.cjs",8906],"experience":["experience.cjs",8905],"product-notifications":["product-notifications.cjs",8904],"mirror":["mirror-operations.cjs",8903],"contracts":["api-contracts.cjs",8902],"charts":["chart-render.cjs",8901],"product-browser":["product-browser.cjs",8900],"products":["products.cjs",8891],"permissions":["permissions.cjs",8892],"registration":["registration.cjs",8893],"stocks":["stocks.cjs",8894],"interface":["interface.cjs",8895],"sessions":["sessions.cjs",8896],"reference":["reference.cjs",8897],"forms":["forms.cjs",8898],"access":["access.cjs",8899]};
const securitySuites = ['mobile-session', 'funding-safety', 'frontend-sync', 'security', 'browser-sessions', 'trade-database', 'admin-next'];

function run(name) {
  // CN_QA_PORT_OFFSET lets two runners (for example Claude and Codex) test on one machine without port clashes.
  const [file, basePort] = suites[name], port = basePort + Number(process.env.CN_QA_PORT_OFFSET || 0), dir = path.join(out, name);
  fs.mkdirSync(dir);
  const env = { ...process.env, CN_QA_SECURITY: securitySuites.includes(name) ? '1' : '0', CN_ACCEPTANCE_SOURCE: bundle, CN_QA_SAVE_DIR: dir,
    CN_OPS_QA_PORT: String(port), CN_ACCEPTANCE_PG_PORT: String(port + 6600), CN_OPS_MASTER_FILE: path.join(dir, 'fixture-master.json'),
    CN_OPS_LIVE_UI: '1', CN_REFERENCE_FIXTURE: name === 'reference' ? '1' : '0' };
  delete env.DATABASE_URL;
  if (name === 'reference') env.CN_QUOTE_REPORT = path.join(root, 'qa', 'reference-quote-report.json');
  return new Promise(resolve => {
    const log = fs.createWriteStream(path.join(dir, 'qa.log'));
    const server = fork(path.join(root, 'qa', 'isolated-server.cjs'), [], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let child, code = 1;
    const print = data => { log.write(data); process.stdout.write(name + ' ' + data); };
    const timer = setTimeout(() => { child?.kill(); server.kill(); }, 180000);
    server.stderr.on('data', print);
    server.stdout.on('data', data => {
      if (child || !String(data).includes('Isolated local QA API ready')) return;
      child = spawn(process.execPath, [path.join(root, 'qa', file), ...(name === 'interface' ? ['--live'] : [])], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', print); child.stderr.on('data', print);
      child.once('exit', result => { code = result ?? 1; if (server.connected) server.send('close'); else server.kill(); });
    });
    server.once('exit', status => {
      clearTimeout(timer); log.end();
      if (fs.existsSync(env.CN_OPS_MASTER_FILE)) fs.unlinkSync(env.CN_OPS_MASTER_FILE);
      resolve({ name, code: status ? status : code });
    });
  });
}

(async () => {
  const names = args.length ? args : Object.keys(suites);
  for (const name of names) if (!suites[name]) throw Error('Unknown suite ' + name);
  const results = [];
  for (const name of names) results.push(await run(name));
  const unchanged = testedSha === digest();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ bundle, sha256: testedSha, bundleUnchanged: unchanged, checkedAt: new Date().toISOString(), results }, null, 2));
  console.log('Evidence ' + out);
  console.log(JSON.stringify(results));
  process.exitCode = results.some(x => x.code !== 0) || !unchanged ? 1 : 0;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
