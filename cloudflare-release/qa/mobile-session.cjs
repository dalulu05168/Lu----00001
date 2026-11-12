// Mobile app (mobile-client #login-form) against the real Worker bundle and isolated PGlite, iPhone 13.
// Records the actual cookie-session behaviour for login, reload, explicit logout, server-side expiry and
// a desktop tab sharing the same browser cookie. MODE=probe only records; default mode asserts.
const fs = require('node:fs'), path = require('node:path'), a = require('node:assert/strict'), { createHmac, createHash } = require('node:crypto');
const { chromium, devices } = require('playwright'), { Pool } = require('pg');
const dir = process.env.CN_QA_SAVE_DIR; a(dir && process.env.CN_ACCEPTANCE_PG_PORT, 'Isolated runner required');
const base = 'http://127.0.0.1:' + process.env.CN_OPS_QA_PORT, password = 'FixturePass123456!', stamp = Date.now();
const probe = process.env.MOBILE_SESSION_MODE === 'probe';
const db = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:' + process.env.CN_ACCEPTANCE_PG_PORT + '/postgres', max: 1 });
const pages = JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE, 'utf8').match(/const replacementPages = (.+);/)[1]);
const otp = s => { const bits = [...s].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join(''), t = Buffer.alloc(8); t.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)))).update(t).digest(); return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0'); };
async function api(route, status, body, token) { const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (status !== null) a.equal(r.status, status, route + ' ' + (j.error || '')); return { status: r.status, json: j }; }
const observations = [], checks = [];
const note = (k, v) => { observations.push({ [k]: v }); console.log('OBSERVE ' + k + ' = ' + JSON.stringify(v)); };
const check = (cond, name) => { if (probe) { note('expect:' + name, !!cond); return; } a(cond, name); checks.push(name); console.log('PASS ' + name); };
const sessionRow = async value => (await db.query('SELECT expires_at, revoked_at FROM user_sessions WHERE token_hash=$1', [createHash('sha256').update(value).digest('hex')])).rows[0] || null;

async function mobilePage(ctx) {
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(base + '/**', r => r.request().resourceType() === 'document' ? r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname === '/login' ? pages.login : pages.mobile }) : r.continue());
  return { page, errors };
}
const cookieOf = async ctx => (await ctx.cookies()).find(c => c.name === '__Host-cn-client') || null;
async function signedIn(page) { return page.locator('nav [data-go=mine]').isVisible().catch(() => false); }
async function settle(page) { await Promise.race([page.locator('nav [data-go=mine]').waitFor({ timeout: 8000 }), page.locator('#login-form').waitFor({ timeout: 8000 })]).catch(() => {}); await page.waitForTimeout(400); }

(async () => {
  const master = (await api('/api/admin/login', 200, { email: 'qa-master@example.test', password, otp: otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret) })).json.token;
  const agentEmail = 'qa-msess-agent-' + stamp + '@example.test', agent = (await api('/api/admin/subaccounts', 201, { email: agentEmail, password }, master)).json;
  await api('/api/admin/activate', 200, { email: agentEmail, password, otp: otp(agent.totpSecret) });
  const email = 'qa-msess-' + stamp + '@example.test'; await api('/api/auth/register', 201, { email, password, inviteCode: agent.inviteCode });
  const browser = await chromium.launch({ executablePath: process.env.CN_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const ctx = await browser.newContext(devices['iPhone 13']);
    const { page, errors } = await mobilePage(ctx);
    await page.goto(base + '/'); await page.locator('#login-form').waitFor();
    note('loginNote', await page.locator('.live-note').innerText().catch(() => null));
    await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password);
    const loginReq = page.waitForRequest(r => r.url().endsWith('/api/auth/login'));
    await page.locator('#login-form button').click(); const req = await loginReq;
    await page.locator('nav [data-go=mine]').waitFor();
    const c1 = await cookieOf(ctx);
    note('loginRequestMode', req.headers()['x-cn-session-mode'] || null);
    note('cookieAfterLogin', c1 && { httpOnly: c1.httpOnly, secure: c1.secure, sameSite: c1.sameSite, maxAgeHours: Math.round((c1.expires - Date.now() / 1000) / 3600) });
    note('storageAfterLogin', await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })));
    check(c1 && c1.httpOnly && c1.sameSite === 'Strict', 'login issues an HttpOnly SameSite=Strict cookie');
    check((await api('/api/account', 200, null, c1.value)).status === 200, 'cookie session is valid on the server');

    // Reload.
    await page.reload(); await settle(page);
    const c2 = await cookieOf(ctx), row2 = c1 && await sessionRow(c1.value);
    note('afterReload', { signedIn: await signedIn(page), cookieStillPresent: !!c2, serverSessionRevoked: !!row2?.revoked_at, accountWithOldCookie: (await api('/api/account', null, null, c1.value)).status });
    const reloadSignedIn = await signedIn(page);

    // Explicit logout (sign in again first if reload dropped the session).
    if (!reloadSignedIn) { await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password); await page.locator('#login-form button').click(); await page.locator('nav [data-go=mine]').waitFor(); }
    const c3 = await cookieOf(ctx);
    await page.locator('nav [data-go=mine]').click();
    await page.locator('[data-action=logout]').click(); await page.locator('#login-form').waitFor();
    const c4 = await cookieOf(ctx);
    note('afterLogout', { cookieCleared: !c4, oldCookieAccount: (await api('/api/account', null, null, c3.value)).status });
    check(!c4 && (await api('/api/account', null, null, c3.value)).status === 401, 'explicit logout clears the cookie and ends the server session');

    // Server-side expiry while the app is open.
    await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password); await page.locator('#login-form button').click(); await page.locator('nav [data-go=mine]').waitFor();
    const c5 = await cookieOf(ctx);
    await db.query("UPDATE user_sessions SET created_at=now()-interval '2 days', expires_at=now()-interval '1 minute' WHERE token_hash=$1", [createHash('sha256').update(c5.value).digest('hex')]);
    await page.locator('nav [data-go=market]').click().catch(() => {});
    await page.locator('nav [data-go=mine]').click().catch(() => {});
    const expired = await page.locator('#login-form').waitFor({ timeout: 20000 }).then(() => true, () => false);
    note('afterExpiry', { backToLogin: expired, message: expired ? await page.locator('body').innerText().then(t => (t.match(/会话已过期[^。]*。/) || [null])[0]) : null });
    check(expired, 'server-side expiry returns the app to the login form');

    // Desktop and mobile tabs share one browser cookie.
    await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password); await page.locator('#login-form button').click(); await page.locator('nav [data-go=mine]').waitFor();
    const shared = await cookieOf(ctx);
    const second = await mobilePage(ctx); await second.page.goto(base + '/'); await settle(second.page);
    note('secondTabSameBrowser', { signedIn: await signedIn(second.page) });
    await second.page.close({ runBeforeUnload: true }); await page.waitForTimeout(800);
    note('afterClosingSecondTab', { firstTabServerSession: (await api('/api/account', null, null, shared.value)).status });
    await page.goto(base + '/login'); await page.waitForTimeout(800);
    note('afterNavigatingAwayFromApp', { serverSession: (await api('/api/account', null, null, shared.value)).status, cookieStillPresent: !!(await cookieOf(ctx)) });
    note('pageErrors', errors);
    await ctx.close();
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ probe, observations, checks }, null, 2));
    console.log(probe ? 'probe recorded' : checks.length + ' mobile session checks passed');
  } finally { await browser.close(); await db.end(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
