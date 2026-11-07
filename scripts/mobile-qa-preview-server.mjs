// Independent mobile-only QA preview. Do not use the production database or
// impersonate its sessions. API calls are forwarded to the existing isolated
// Render QA backend; neither demo balances nor client credentials are logged.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_API_ORIGIN = 'https://global-stock-qa-preview.onrender.com';
const ROOT = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const MAX_REQUEST = 8 * 1024 * 1024;
const MAX_RESPONSE = 12 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
function json(res, status, error) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify({ error }));
}
async function readLimited(stream, limit) {
  let total = 0;
  const chunks = [];
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > limit) throw new RangeError('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function proxyApi(req, res, requestUrl, upstream, fetchImpl) {
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))
    return json(res, 405, 'Method not allowed');
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept', 'idempotency-key']) {
    if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
  }
  let body;
  try {
    if (!['GET', 'HEAD'].includes(req.method)) body = await readLimited(req, MAX_REQUEST);
  } catch (error) {
    return json(res, error instanceof RangeError ? 413 : 400, 'Request body rejected');
  }
  let remote;
  try {
    remote = await fetchImpl(new URL(requestUrl.pathname + requestUrl.search, upstream), {
      method: req.method, headers, body, redirect: 'manual',
      signal: AbortSignal.timeout(65_000)
    });
  } catch {
    return json(res, 503, '测试账户接口暂时不可用，请稍后重试；请求未被确认');
  }
  const contentType = remote.headers.get('content-type') || '';
  if (!/\bapplication\/(?:[\w.+-]*\+)?json\b/i.test(contentType))
    return json(res, 502, '测试账户接口未返回 JSON，请勿在此输入正式账户密码');
  let bytes;
  try { bytes = Buffer.from(await remote.arrayBuffer()); }
  catch { return json(res, 502, '测试账户接口响应读取失败'); }
  if (bytes.length > MAX_RESPONSE) return json(res, 502, '测试账户接口响应过大');
  res.writeHead(remote.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
async function serveStatic(req, res, pathname, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return json(res, 405, 'Method not allowed');
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return json(res, 400, 'Invalid path'); }
  if (decoded.includes('\0') || decoded.includes('\\')) return json(res, 400, 'Invalid path');
  const full = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!full.startsWith(root + sep)) return json(res, 403, 'Forbidden');
  const ext = extname(full).toLowerCase();
  if (!Object.hasOwn(TYPES, ext)) return json(res, 404, 'Not found');
  try {
    if (!(await stat(full)).isFile()) return json(res, 404, 'Not found');
    let body = await readFile(full);
    if (ext === '.html') {
      // The preview must never look like a production login: warn on every page.
      const warning = '<div role="note" style="position:relative;z-index:9999;background:#40301f;color:#fff4cc;text-align:center;font:13px/1.5 system-ui,sans-serif;padding:8px">独立 QA 测试环境 · 请勿使用正式账户密码</div>';
      body = Buffer.from(body.toString('utf8').replace(/<body([^>]*)>/i, '<body$1>' + warning));
    }
    res.writeHead(200, {
      'content-type': TYPES[ext], 'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { json(res, 404, 'Not found'); }
}
export function createMobileQaServer({ root = ROOT, upstream = QA_API_ORIGIN, fetchImpl = fetch } = {}) {
  const base = resolve(root);
  return createServer((req, res) => {
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { return json(res, 400, 'Invalid URL'); }
    const task = url.pathname.startsWith('/api/')
      ? proxyApi(req, res, url, upstream, fetchImpl)
      : serveStatic(req, res, url.pathname, base);
    task.catch(() => { if (!res.headersSent) json(res, 500, 'Service unavailable'); else res.destroy(); });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || '10000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  createMobileQaServer().listen(port, '0.0.0.0', () =>
    console.log('Mobile QA preview listening on port ' + port));
}