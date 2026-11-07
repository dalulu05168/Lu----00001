import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createMobileQaServer } from '../scripts/mobile-qa-preview-server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
test('mobile QA preview serves mobile assets and proxies API without inventing a session', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mobile-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'index.html'), '<body><title>Test login</title></body>');
  await writeFile(join(root, 'mobile.html'), '<body><title>Mobile app</title></body>');
  let received;
  const backend = createServer(async (req, res) => {
    if (req.url === '/api/auth/login') {
      const chunks = []; for await (const x of req) chunks.push(x);
      received = { authorization: req.headers.authorization, path: req.url,
        data: JSON.parse(Buffer.concat(chunks).toString()) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({token:'test-fixture-token'}));
    } else if (req.url === '/api/account') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({error:'Authentication required'}));
    } else if (req.url === '/api/unexpected-html') {
      res.writeHead(200, { 'content-type': 'text/html' });res.end('<html>No API</html>');
    } else { res.writeHead(404, {'content-type':'application/json'});res.end('{}'); }
  });
  t.after(() => backend.close());
  const upstream = await listen(backend);
  const preview = createMobileQaServer({ root, upstream });
  t.after(() => preview.close());
  const origin = await listen(preview);
  const home = await fetch(origin + '/');
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /Test login/);
  assert.match(homeHtml, /请勿使用正式账户密码/);
  const mobile = await fetch(origin + '/mobile.html');
  assert.equal(mobile.status, 200);
  const mobileHtml = await mobile.text();
  assert.match(mobileHtml, /Mobile app/);
  assert.match(mobileHtml, /请勿使用正式账户密码/);
  assert.equal((await fetch(origin + '/not-found.js')).status, 404);
  assert.equal((await fetch(origin + '/mobile.html', { method: 'POST' })).status, 405);
  const response = await fetch(origin + '/api/auth/login', {
    method:'POST', headers:{'content-type':'application/json','authorization':'Bearer fixture'},
    body:JSON.stringify({email:'qa@example.test',password:'fixture'})
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).token, 'test-fixture-token');
  assert.deepEqual(received, {authorization:'Bearer fixture',path:'/api/auth/login',data:{email:'qa@example.test',password:'fixture'}});
  const missing = await fetch(origin + '/api/account');
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), {error:'Authentication required'});
  const html = await fetch(origin + '/api/unexpected-html');
  assert.equal(html.status, 502);
  assert.match((await html.json()).error, /JSON/);
});