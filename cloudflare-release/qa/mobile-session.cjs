// Issue #56: the mobile app (mobile-client #login-form) restores a valid HttpOnly cookie session after reload.
// Real Worker bundle + isolated PGlite, iPhone 13. Covers first login, reload, second tab, background switch,
// real server-side expiry, 401, explicit logout, network failure, account isolation and order idempotency.
const fs = require('node:fs'), path = require('node:path'), a = require('node:assert/strict'), { createHmac, createHash, randomUUID } = require('node:crypto');
const { chromium, devices } = require('playwright'), { Pool } = require('pg');
const dir = process.env.CN_QA_SAVE_DIR; a(dir && process.env.CN_ACCEPTANCE_PG_PORT, 'Isolated runner required');
const base = 'http://127.0.0.1:' + process.env.CN_OPS_QA_PORT, password = 'FixturePass123456!', stamp = Date.now(), pin = '749286';
const db = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:' + process.env.CN_ACCEPTANCE_PG_PORT + '/postgres', max: 1 });
const pages = JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE, 'utf8').match(/const replacementPages = (.+);/)[1]);
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
const otp = s => { const bits = [...s].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join(''), t = Buffer.alloc(8); t.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)))).update(t).digest(); return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0'); };
async function api(route, status, token, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(route === '/api/orders' && body ? { 'Idempotency-Key': randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (status !== null) a.equal(r.status, status, route + ' ' + JSON.stringify(data.error)); return { status: r.status, data };
}
const admin = p => '/api/admin/' + p;
// Works before and after the backend started requiring expectedStatus on cash request reviews.
async function review(master, id) {
  const first = await api(admin('requests'), null, master, { id, decision: 'APPROVE' });
  if (first.status === 200) return;
  a.equal(first.status, 400, JSON.stringify(first.data));
  const row = (await db.query('SELECT status FROM cn_cash_requests WHERE id=$1', [id]).catch(() => ({ rows: [] }))).rows[0];
  a(row, 'cash request status unavailable: ' + JSON.stringify(first.data));
  await api(admin('requests'), 200, master, { id, decision: 'APPROVE', expectedStatus: row.status });
}
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const hash = v => createHash('sha256').update(v).digest('hex');
const cookieOf = async ctx => (await ctx.cookies()).find(c => c.name === '__Host-cn-client') || null;
const signedIn = page => page.locator('nav [data-go=mine]').isVisible().catch(() => false);
async function settled(page) { await Promise.race([page.locator('nav [data-go=mine]').waitFor({ timeout: 10000 }), page.locator('#login-form').waitFor({ timeout: 10000 })]).catch(() => {}); }
async function mobilePage(ctx, logouts) {
  const page = await ctx.newPage(), errors = []; page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url().endsWith('/api/auth/logout')) logouts.push({ url: r.url(), background: r.headers()['x-cn-session-close'] || null }); });
  await page.route(base + '/**', r => r.request().resourceType() === 'document' ? r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname === '/login' ? pages.login : pages.mobile }) : r.continue());
  return { page, errors };
}
async function formLogin(page, email) {
  await page.locator('#login-form [name=email]').fill(email); await page.locator('#login-form [name=password]').fill(password);
  await page.locator('#login-form button').click(); await page.locator('nav [data-go=mine]').waitFor();
}
async function accountId(page) { await page.locator('nav [data-go=mine]').click(); const t = await page.locator('.account-id').innerText(); await page.locator('nav [data-go=home]').click().catch(() => {}); return t; }
const nvda = async cookie => ((await api('/api/account', 200, cookie)).data.positions || []).filter(p => p.symbol === 'NVDA').reduce((n, p) => n + Number(p.quantity), 0);

(async () => {
  const master = (await api(admin('login'), 200, null, { email: 'qa-master@example.test', password, otp: otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret) })).data.token;
  const agentEmail = 'qa-msess-agent-' + stamp + '@example.test', agent = (await api(admin('subaccounts'), 201, master, { email: agentEmail, password })).data;
  const agentCreds = { email: agentEmail, password, otp: otp(agent.totpSecret) };
  await api(admin('activate'), 200, null, agentCreds); const agentToken = (await api(admin('login'), 200, null, agentCreds)).data.token;
  const A = 'qa-msess-a-' + stamp + '@example.test', B = 'qa-msess-b-' + stamp + '@example.test';
  for (const e of [A, B]) await api('/api/auth/register', 201, null, { email: e, password, inviteCode: agent.inviteCode });
  // Account A holds 3 NVDA so a real order can be lost and retried.
  const clientA = (await api('/api/auth/login', 200, null, { email: A, password })).data.token;
  for (const doc of [{ kind: 'IDENTITY', front: image, back: image }, { kind: 'BANK', bankName: 'QA Bank', accountNumber: '1234567890' }]) {
    await api('/api/profile-documents', 201, clientA, doc);
    const r = (await api(admin('profile-documents?') + new URLSearchParams({ email: A, kind: doc.kind }), 200, agentToken)).data;
    await api(admin('profile-documents'), 200, agentToken, { email: A, kind: doc.kind, status: 'APPROVED', version: r.version }, 'PATCH');
  }
  const deposit = (await api('/api/requests', 201, clientA, { kind: 'DEPOSIT', amountCents: 100000 })).data;
  for (let i = 0; i < 2; i++) await review(master, deposit.id);
  await api(admin('listings'), 201, master, { market: 'US', status: 'PUBLISHED', itemType: 'STOCK', symbol: 'NVDA', name: 'NVIDIA', tradePin: pin });
  await api('/api/orders', 201, clientA, { market: 'US', symbol: 'NVDA', side: 'BUY', quantity: 3, limitPriceCents: 1300, tradePin: pin });
  await api('/api/auth/logout', 204, clientA, {});

  const browser = await chromium.launch({ executablePath: process.env.CN_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const logouts = [];
  try {
    const ctx = await browser.newContext(devices['iPhone 13']);
    const { page, errors } = await mobilePage(ctx, logouts);

    // 1. First login.
    await page.goto(base + '/'); await page.locator('#login-form').waitFor();
    a.match(await page.locator('.live-note').innerText(), /安全 Cookie/);
    a(!(await page.locator('.live-note').innerText()).includes('刷新页面后需重新登录'));
    const loginReq = page.waitForRequest(r => r.url().endsWith('/api/auth/login'));
    await formLogin(page, A);
    a.equal((await loginReq).headers()['x-cn-session-mode'], 'cookie');
    const c1 = await cookieOf(ctx);
    a(c1 && c1.httpOnly && c1.secure && c1.sameSite === 'Strict', 'HttpOnly Secure SameSite=Strict cookie expected');
    const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    a(!stored.includes(c1.value) && !/bearer/i.test(stored) && !stored.includes('cn-cookie-session'), 'no credential in Web Storage: ' + stored);
    a(!(await page.evaluate(() => document.cookie)).includes('cn-client'), 'cookie must not be readable by scripts');
    const idA = await accountId(page);
    pass('first login: HttpOnly cookie session, nothing credential-like in Web Storage, note matches behaviour');

    // 2. Reload restores the session through the protected account API.
    const accountCheck = page.waitForResponse(r => r.url().endsWith('/api/account') && r.request().method() === 'GET');
    await page.reload(); a.equal((await accountCheck).status(), 200);
    await page.locator('nav [data-go=mine]').waitFor();
    a.equal((await cookieOf(ctx)).value, c1.value); a.equal(logouts.length, 0, 'reload must not log out');
    a.equal((await api('/api/account', null, c1.value)).status, 200);
    a.equal(await accountId(page), idA);
    pass('reload: session restored only after GET /api/account returned 200; no logout sent');

    // 3. Second tab in the same browser.
    const second = await mobilePage(ctx, logouts); await second.page.goto(base + '/'); await second.page.locator('nav [data-go=mine]').waitFor();
    pass('second tab: restored from the shared cookie');

    // 4. Background switch (visibility hidden + persisted pagehide) keeps the session.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); });
    await page.waitForTimeout(800);
    a.equal(logouts.length, 0, 'background switch must not log out'); a.equal((await api('/api/account', null, c1.value)).status, 200);
    const recheck = page.waitForResponse(r => r.url().endsWith('/api/account') && r.request().method() === 'GET');
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange')); });
    a.equal((await recheck).status(), 200, 'returning to the page re-checks the cookie with the server');
    await page.locator('nav [data-go=mine]').waitFor(); a.equal(logouts.length, 0);
    pass('background switch and back/forward-cache return: no logout, cookie re-checked with the server, still signed in');

    // 5. Order idempotency across a reload: the response to a real sell is lost after the server committed it.
    a.equal(await nvda(c1.value), 3);
    let lost = 0, lostKey = null;
    await page.route(base + '/api/orders', async r => { if (r.request().method() === 'POST' && lost === 0) { lost++; lostKey = r.request().headers()['idempotency-key']; await r.fetch(); return r.abort('connectionreset'); } return r.continue(); });
    await page.locator('nav [data-go=trade]').click();
    await page.locator('.holding').filter({ hasText: 'NVDA' }).locator('[data-position]').click();
    await page.locator('form[data-business-form=position-sell] [name=quantity]').fill('1');
    await page.locator('form[data-business-form=position-sell]').getByRole('button', { name: '确认卖出' }).click();
    await page.waitForTimeout(1500);
    a.equal(lost, 1); a.equal(await nvda(c1.value), 2, 'server committed the lost sell once');
    const pendingKeys = await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('cn.pending.')));
    a.equal(pendingKeys.length, 1, 'pending order journal kept: ' + JSON.stringify(pendingKeys)); a.match(pendingKeys[0], /^cn\.pending\.account:/);
    await page.unroute(base + '/api/orders');
    await page.reload(); await page.locator('nav [data-go=mine]').waitFor();
    await page.locator('nav [data-go=trade]').click();
    await page.locator('.holding').filter({ hasText: 'NVDA' }).locator('[data-position]').click();
    await page.locator('form[data-business-form=position-sell] [name=quantity]').fill('1');
    const [replay] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST'), page.locator('form[data-business-form=position-sell]').getByRole('button', { name: '确认卖出' }).click()]);
    a([200, 201].includes(replay.status()), 'replay status ' + replay.status());
    a(lostKey, 'lost request carried an idempotency key');
    a.equal(replay.request().headers()['idempotency-key'], lostKey, 'retry after reload must reuse the key of the lost request');
    a.equal(await nvda(c1.value), 2, 'retry after reload must replay, not sell again');
    a.equal((await db.query("SELECT count(*)::int AS n FROM orders o JOIN accounts ac ON ac.id=o.account_id JOIN app_users u ON u.id=ac.user_id WHERE u.email=$1 AND o.symbol='NVDA' AND o.side='SELL'", [A])).rows[0].n, 1, 'exactly one sell order stored');
    a.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('cn.pending.')).length), 0, 'journal cleared after confirmed replay');
    pass('order idempotency: a sell whose response was lost is replayed with its original key after reload, not duplicated');

    // 6. Network failure while restoring.
    await page.route(base + '/api/account', r => r.abort('internetdisconnected'));
    await page.reload(); await page.locator('#login-form').waitFor();
    a.match(await page.locator('body').innerText(), /网络连接失败，暂时无法确认登录状态/);
    a(!(await signedIn(page))); await page.unroute(base + '/api/account');
    await page.reload(); await page.locator('nav [data-go=mine]').waitFor();
    pass('network failure during restore: not signed in, explained, recovers on the next reload');

    // 7. Real server-side expiry, then 401 at restore.
    await db.query("UPDATE user_sessions SET created_at=now()-interval '2 days', expires_at=now()-interval '1 minute' WHERE token_hash=$1", [hash(c1.value)]);
    await page.locator('nav [data-go=market]').click().catch(() => {}); await page.locator('nav [data-go=mine]').click().catch(() => {});
    await page.locator('#login-form').waitFor({ timeout: 20000 });
    a.match(await page.locator('body').innerText(), /会话已过期，请重新登录。/);
    const restoreAttempt = page.waitForResponse(r => r.url().endsWith('/api/account'));
    await page.reload(); a.equal((await restoreAttempt).status(), 401); await page.locator('#login-form').waitFor();
    a(!/会话已过期|网络连接失败|暂时无法确认/.test(await page.locator('body').innerText()), '401 at start-up shows the form quietly');
    await second.page.reload(); await second.page.locator('#login-form').waitFor();
    pass('expiry: open app returns to login with a message; 401 at start-up shows the form quietly in every tab');

    // 8. Explicit logout ends the server session and clears the cookie for every tab.
    await formLogin(page, A); const c2 = await cookieOf(ctx);
    await second.page.reload(); await second.page.locator('nav [data-go=mine]').waitFor();
    await page.locator('nav [data-go=mine]').click(); await page.locator('[data-action=logout]').click(); await page.locator('#login-form').waitFor();
    a.equal(logouts.length, 1); a.equal(logouts[0].background, null);
    a.equal(await cookieOf(ctx), null); a.equal((await api('/api/account', null, c2.value)).status, 401);
    await page.reload(); await page.locator('#login-form').waitFor();
    await second.page.locator('nav [data-go=market]').click().catch(() => {}); await second.page.locator('nav [data-go=mine]').click().catch(() => {});
    await second.page.locator('#login-form').waitFor({ timeout: 20000 });
    pass('explicit logout: one foreground logout, cookie cleared, session 401, other tab returns to login');

    // 9. Account isolation: B signs in through the desktop login page in the same browser.
    await formLogin(page, A);
    const desktop = await ctx.newPage();
    await desktop.route(base + '/**', r => r.request().resourceType() === 'document' ? r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname === '/login' ? pages.login : '<!doctype html><title>stub</title>' }) : r.continue());
    await desktop.emulateMedia({ reducedMotion: 'reduce' }); await desktop.goto(base + '/login');
    await desktop.locator('#email').fill(B); await desktop.locator('#password').fill(password); await desktop.locator('#loginBtn').click(); await desktop.waitForURL('**/index.html');
    await page.reload(); await page.locator('nav [data-go=mine]').waitFor();
    const idB = await accountId(page);
    a.notEqual(idB, idA, 'restored identity must follow the cookie (B), not the earlier tab state (A)');
    a.equal(await nvda((await cookieOf(ctx)).value), 0);
    await page.locator('nav [data-go=trade]').click();
    a.equal(await page.locator('.holding').filter({ hasText: 'NVDA' }).count(), 0, "B must not see A's holdings");
    pass('account isolation: restore follows the server-confirmed cookie identity; no data from the previous account');

    // 10. A pending order record written before account-keyed journals (key "cn.pending.<email>").
    const legacyKey = 'cn.pending.' + A, legacyRecord = { path: '/api/orders', digest: 'legacy-digest', key: 'legacy-key-' + stamp };
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [legacyKey, JSON.stringify(legacyRecord)]);
    await page.reload(); await page.locator('#login-form').waitFor();
    a.match(await page.locator('body').innerText(), /尚未确认的订单记录/);
    a(!(await signedIn(page)), 'a valid cookie (B) must not auto-restore while an unconfirmed legacy record exists');
    await formLogin(page, B);
    a.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('cn.pending.'))), [legacyKey], "B must not take over A's record");
    await page.reload(); await page.locator('#login-form').waitFor();
    await formLogin(page, A);
    const idAValue = idA.match(/[0-9a-f-]{36}/i)?.[0]; a(idAValue, 'account id visible: ' + idA);
    const migrated = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([k]) => k.startsWith('cn.pending.'))));
    a.deepEqual(Object.keys(migrated), ['cn.pending.account:' + idAValue]); a.equal(JSON.parse(migrated['cn.pending.account:' + idAValue]).key, legacyRecord.key);
    const cookieA = (await cookieOf(ctx)).value, before = await nvda(cookieA);
    const posted = []; page.on('request', r => { if (r.url().endsWith('/api/orders') && r.method() === 'POST') posted.push(r); });
    await page.locator('nav [data-go=trade]').click();
    await page.locator('.holding').filter({ hasText: 'NVDA' }).locator('[data-position]').click();
    await page.locator('form[data-business-form=position-sell] [name=quantity]').fill('1');
    await page.locator('form[data-business-form=position-sell]').getByRole('button', { name: '确认卖出' }).click();
    await page.getByText(/存在结果尚未确认的订单/).first().waitFor();
    a.equal(posted.length, 0, 'no new order may be sent while the migrated record is unconfirmed'); a.equal(await nvda(cookieA), before);
    await page.evaluate(() => { for (const k of Object.keys(sessionStorage)) if (k.startsWith('cn.pending.')) sessionStorage.removeItem(k); });
    pass('legacy e-mail record: blocks auto-restore, ignored by another account, migrated to the proven account id, holds back new orders');

    a.deepEqual([...errors, ...second.errors], []);
    pass('no uncaught page errors');
    await ctx.close();
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ passed: true, checks }, null, 2));
    console.log(checks.length + ' mobile session checks passed');
  } finally { await browser.close(); await db.end(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
