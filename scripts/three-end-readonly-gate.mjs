#!/usr/bin/env node
// Issue #42: read-only pre-integration QA gate, NOT end-to-end trading validation.
// No cookies, tokens, mutations, database writes, or UI source changes.
import {pathToFileURL} from 'node:url';

const PUBLIC_JSON = Object.freeze([
  ['/api/health', 'alive'],
  ['/api/ready', 'ready']
]);
const DENIED_JSON = Object.freeze([
  '/api/account',
  '/api/account/analytics',
  '/api/catalog',
  '/api/watchlist',
  '/api/internal-products',
  '/api/internal-purchases',
  '/api/support',
  '/api/requests',
  '/api/stock-quote?market=US&symbol=AAPL',
  '/api/admin/me',
  '/api/admin/clients'
]);
// These paths are only the historical QA asset baseline. They do not assert
// the final cleaned CN_Capital three-end UI has been delivered or connected.
const EXISTING_ASSETS = Object.freeze([
  '/', '/admin.html', '/mobile.html', '/app.mjs', '/admin.mjs', '/mobile.mjs'
]);

export function gateTargets() {
  return [
    ...PUBLIC_JSON.map(([path, status]) => ({path, expectedCode:200, kind:'health', expectedStatus:status})),
    ...DENIED_JSON.map(path => ({path, expectedCode:401, kind:'authorization'})),
    ...EXISTING_ASSETS.map(path => ({path, expectedCode:200, kind:'qa-asset'}))
  ];
}

export function validateBaseUrl(baseUrl, {remoteReadonly=false}={}) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('Explicit --base-url is required');
  const url=new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Base URL must be a plain HTTP(S) origin without credentials, path, query or fragment');
  }
  if (!remoteReadonly && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Remote QA requires explicit --remote-readonly; never send credentials to this gate');
  }
  return url.origin;
}

export async function runThreeEndReadonlyGate({baseUrl, remoteReadonly=false, fetchImpl=globalThis.fetch, timeoutMs=8000}={}) {
  const origin=validateBaseUrl(baseUrl,{remoteReadonly});
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  const checks=[];
  for (const target of gateTargets()) {
    let response;
    try {
      response=await fetchImpl(origin+target.path, {
        method:'GET', headers:{accept:target.kind==='qa-asset'?'*/*':'application/json'},
        redirect:'manual', cache:'no-store', signal:AbortSignal.timeout(timeoutMs)
      });
      const contentType=String(response.headers.get('content-type')||'').toLowerCase();
      const isJson=contentType.includes('application/json');
      const isHtml=contentType.includes('text/html');
      const isJs=contentType.includes('javascript');
      let passed=response.status===target.expectedCode;
      let reason='';
      if (!passed) reason='HTTP '+response.status+', expected '+target.expectedCode;
      if (passed && target.kind!=='qa-asset' && !isJson) {
        passed=false; reason='API must return JSON, not an HTML login/preview page';
      }
      if (passed && target.kind==='qa-asset') {
        const expectedScript=target.path.endsWith('.mjs');
        if (expectedScript?!isJs:!isHtml) {
          passed=false; reason='QA asset has wrong content type';
        } else if (!(await response.text()).trim()) {
          passed=false; reason='QA asset is empty';
        }
      }
      if (passed && target.kind==='health') {
        let data;
        try {data=await response.json();} catch {data=null;}
        if (data?.status!==target.expectedStatus) {
          passed=false; reason='Health/readiness semantic status mismatch';
        }
      }
      checks.push({path:target.path,kind:target.kind,expectedStatus:target.expectedCode,
        httpStatus:response.status,passed,...(reason?{reason}:{})});
    } catch(error) {
      checks.push({path:target.path,kind:target.kind,expectedStatus:target.expectedCode,
        httpStatus:null,passed:false,reason:'Request failed: '+(error?.name||'network error')});
    }
  }
  return {mode:'anonymous GET-only',baseUrl:origin,passed:checks.every(c=>c.passed),
    passedCount:checks.filter(c=>c.passed).length,total:checks.length,checks,
    businessValidation:'NOT TESTED: external US/CN quote entitlements, internal order/DB, cost basis, realized/unrealized P&L, final UI, authenticated end-to-end'};
}

async function main(argv) {
  const urlIndex=argv.indexOf('--base-url');
  const baseUrl=urlIndex>=0?argv[urlIndex+1]:undefined;
  const remoteReadonly=argv.includes('--remote-readonly');
  const result=await runThreeEndReadonlyGate({baseUrl,remoteReadonly});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if (!result.passed) process.exitCode=1;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error=>{
    process.stderr.write(String(error?.message||error)+'\n'); process.exitCode=1;
  });
}
