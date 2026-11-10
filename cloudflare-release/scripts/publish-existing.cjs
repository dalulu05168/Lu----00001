const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const auth = { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN };
if(!account||!process.env.CLOUDFLARE_API_TOKEN)throw Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
const accountApi = 'https://api.cloudflare.com/client/v4/accounts/' + account;
const workerApi = '/workers/scripts/lu----00001';
const baseline = require('../release-manifest.json').version;
const artifact = 'dist/worker.mjs';
const active = payload => (payload.deployments || payload)[0].versions.map(v => [v.version_id, v.percentage]);
const bindings = version => version.resources.bindings.map(row => [row.type, row.name]).sort();
const domains = rows => rows.filter(row => row.service === 'lu----00001').map(row => [row.hostname, row.id]).sort();
const endpoints = [
  ['https://nuvexapro.com/ready', 200],
  ['https://admin.maacropierce.com/ready', 200],
  ['https://nuvexapro.com/logo.png', 200],
  ['https://admin.maacropierce.com/logo.png', 200]
];
async function api(path, options = {}) {
  const response = await fetch(accountApi + path, { ...options, headers: auth, signal: AbortSignal.timeout(35000) });
  const result = await response.json();
  if (!response.ok || !result.success) throw Error(path + ' HTTP ' + response.status + ' ' + JSON.stringify(result.errors));
  return result.result;
}
async function publicResources() {
  return Promise.all(endpoints.map(async ([url, status]) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, status, url);
    const type = response.headers.get('content-type');
    const body = Buffer.from(await response.arrayBuffer());
    if (url.endsWith('/ready')) {
      const state = JSON.parse(body);
      assert.equal(state.status, 'ready', url);
      assert.equal(state.database, 'connected', url);
      return {url, type, database: state.database};
    }
    assert(type.startsWith('image/'), url + ' ' + type);
    return {url, type, hash: createHash('sha256').update(body).digest('hex')};
  }));
}
(async () => {
  const deployPath = workerApi + '/deployments';
  const versionPath = workerApi + '/versions';
  if (process.argv[2] === 'verify') {
    const before = JSON.parse(fs.readFileSync('artifacts/publication.json', 'utf8'));
    const [deployment, currentDomains, resources] = await Promise.all([api(deployPath), api('/workers/domains'), publicResources()]);
    assert.deepEqual(active(deployment), [[before.version, 100]]);
    assert.deepEqual(domains(currentDomains), before.domains);
    assert.deepEqual(resources, before.resources);
    console.log('Active version ' + before.version + ' at 100%; both domains, Logo assets and databases verified');
    return;
  }
  const [deployment, original, currentDomains, resources] = await Promise.all([
    api(deployPath), api(versionPath + '/' + baseline), api('/workers/domains'), publicResources()
  ]);
  assert.deepEqual(active(deployment), [[baseline, 100]]);
  const expectedDomains = domains(currentDomains);
  assert.deepEqual(expectedDomains.map(row => row[0]), ['admin.maacropierce.com','nuvexapro.com']);
  const expectedBindings = bindings(original);
  assert(expectedBindings.some(([type,name]) => type === 'assets' && name === 'ASSETS'));
  const metadata = {
    main_module: 'worker.mjs',
    compatibility_date: original.resources.script_runtime.compatibility_date,
    compatibility_flags: original.resources.script_runtime.compatibility_flags,
    keep_assets: true,
    keep_bindings: [...new Set(expectedBindings.map(row => row[0]))]
  };
  const body = new FormData();
  body.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  body.set('worker.mjs', new Blob([fs.readFileSync(artifact)], { type: 'application/javascript+module' }), 'worker.mjs');
  const uploaded = await api(versionPath, { method: 'POST', body });
  const candidate = await api(versionPath + '/' + uploaded.id);
  assert.deepEqual(bindings(candidate), expectedBindings);
  assert.deepEqual(candidate.resources.script_runtime, original.resources.script_runtime);
  assert.deepEqual(active(await api(deployPath)), [[baseline, 100]]);
  fs.writeFileSync('artifacts/publication.json', JSON.stringify({version: uploaded.id, domains: expectedDomains, resources}));
  console.log('Uploaded ' + uploaded.id + ' with matching bindings and runtime settings');
})().catch(error => {console.error(error.stack);process.exitCode=1});
