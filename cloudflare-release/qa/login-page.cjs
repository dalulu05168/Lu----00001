// Login page acceptance against the real Worker bundle and an isolated local PGlite database.
// Covers desktop and iPhone viewports, error states, cookie sessions, redirects, password recovery and admin 2FA.
const fs = require('fs'), a = require('assert/strict'), { createHmac } = require('crypto'), { chromium, devices } = require('playwright');
const base = 'http://127.0.0.1:' + process.env.CN_OPS_QA_PORT, password = 'FixturePass123456!', stamp = Date.now();
const pages = JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE, 'utf8').match(/const replacementPages = (.+);/)[1]);
const masterSecret = JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret;
function otp(s) { const bits = [...s].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join(''); const t = Buffer.alloc(8); t.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)))).update(t).digest(); return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0'); }
async function api(path, status, data, token) { const r = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: data ? JSON.stringify(data) : undefined }); const j = await r.json().catch(() => ({})); a.equal(r.status, status, path + ' ' + (j.error || '')); return j; }
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const stub = '<!doctype html><html><head><title>stub</title></head><body>workspace stub</body></html>';

async function open(browser, opts, path, { reduced = true } = {}) {
  const page = await browser.newPage(opts);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(base + '/**', r => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const p = new URL(r.request().url()).pathname;
    return r.fulfill({ contentType: 'text/html', body: p === '/login' ? pages.login : stub });
  });
  await page.goto(base + path);
  await page.locator('#email').waitFor({ state: 'visible' });
  return { page, errors };
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  a(o.sw <= o.cw + 1, label + ' has horizontal overflow ' + JSON.stringify(o));
  const box = await page.locator('#card').boundingBox();
  const vw = page.viewportSize().width;
  a(box && box.x >= 0 && box.x + box.width <= vw + 1, label + ' card outside viewport ' + JSON.stringify(box));
}
async function submitLogin(page, email, pwd) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(pwd);
  await page.locator('#loginBtn').click();
}

(async () => {
  const master = (await api('/api/admin/login', 200, { email: 'qa-master@example.test', password, otp: otp(masterSecret) })).token;
  const agentEmail = 'qa-login-agent-' + stamp + '@example.test', agent = await api('/api/admin/subaccounts', 201, { email: agentEmail, password }, master);
  await api('/api/admin/activate', 200, { email: agentEmail, password, otp: otp(agent.totpSecret) });
  const browser = await chromium.launch({ executablePath: process.env.CN_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const [kind, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', devices['iPhone 13']]]) {
      const email = 'qa-login-' + kind + '-' + stamp + '@example.test';
      await api('/api/auth/register', 201, { email, password, inviteCode: agent.inviteCode });

      // Splash + layout with normal motion.
      { const { page, errors } = await open(browser, opts, '/login', { reduced: false });
        await page.locator('#loginBtn').click({ trial: true, timeout: 8000 });
        await noOverflow(page, kind);
        a.equal(await page.title(), 'CN Capital');
        a(!(await page.locator('#otpField').isVisible()), 'customer page must not show 2FA');
        a.deepEqual(errors, []); await page.close(); pass(kind + ': splash opens the form, no overflow, no page errors'); }

      const { page, errors } = await open(browser, opts, '/login');
      let calls = 0; page.on('request', r => { if (r.url().endsWith('/api/auth/login')) calls++; });
      await submitLogin(page, 'not-an-email', 'x');
      a.match(await page.locator('#e1').innerText(), /有效邮箱/); a.equal(calls, 0);
      await page.locator('[data-tab=register]').click(); await page.locator('#regEmail').fill('bad'); await page.locator('#regBtn').click();
      await page.locator('#r1', { hasText: '邮箱格式不正确' }).waitFor();
      await page.locator('#rback').click(); await page.locator('#email').waitFor({ state: 'visible' });
      pass(kind + ': invalid input is rejected before any request');

      await submitLogin(page, email, 'WrongPassword123!');
      await a.doesNotReject(page.locator('#e2', { hasText: '邮箱或密码不正确' }).waitFor());
      a.equal(await page.locator('#password').inputValue(), '');
      pass(kind + ': wrong password shows 401 message and clears the password');

      for (const [status, body, text] of [[429, { error: 'x' }, '请求过于频繁'], [403, { error: '账户已被限制登录' }, '账户已被限制登录']]) {
        await page.route(base + '/api/auth/login', r => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
        await submitLogin(page, email, password);
        await page.locator('#e2', { hasText: text }).waitFor();
        await page.unroute(base + '/api/auth/login');
      }
      await page.route(base + '/api/auth/login', r => r.abort('internetdisconnected'));
      await submitLogin(page, email, password);
      await page.locator('#e2', { hasText: '服务暂时不可用' }).waitFor();
      a(await page.locator('#loginBtn').isEnabled(), 'button must recover after a network failure');
      await page.unroute(base + '/api/auth/login');
      pass(kind + ': 429, server message and network failure are explained and recoverable');

      const sent = page.waitForRequest(r => r.url().endsWith('/api/auth/login'));
      await submitLogin(page, email, password);
      const loginRequest = await sent;
      a.equal(loginRequest.headers()['x-cn-session-mode'], 'cookie');
      a(!loginRequest.headers()['authorization'], 'login must not send a bearer token');
      await page.waitForURL('**/index.html');
      const cookie = (await page.context().cookies()).find(c => c.name === '__Host-cn-client');
      a(cookie && cookie.httpOnly && cookie.sameSite === 'Strict', 'HttpOnly client cookie missing');
      a.equal(await page.evaluate(() => localStorage.getItem('cncap.session')), 'cn-cookie-session');
      a.equal(await page.evaluate(() => sessionStorage.getItem('cncap.mobile.entry')), kind === 'mobile' ? '1' : null);
      a.equal((await api('/api/account', 200, null, cookie.value)).account !== undefined, true);
      a.deepEqual(errors, []);
      pass(kind + ': login uses an HttpOnly cookie, stores only the marker, and redirects');

      if (kind === 'desktop') {
        await page.goto(base + '/login');
        await page.waitForURL('**/index.html');
        pass('desktop: an existing session skips the login form');
      }
      await page.close();

      for (const [target, expected] of [['/index.html?tab=market', '/index.html?tab=market'], ['//evil.example/x', '/index.html'], ['/\\evil.example', '/index.html'], ['https://evil.example/', '/index.html']]) {
        const ctx = await browser.newContext(opts); const p = await ctx.newPage(); await p.emulateMedia({ reducedMotion: 'reduce' });
        await p.route(base + '/**', r => r.request().resourceType() === 'document' ? r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname === '/login' ? pages.login : stub }) : r.continue());
        await p.goto(base + '/login?next=' + encodeURIComponent(target));
        await submitLogin(p, email, password);
        await p.waitForURL(u => u.origin === base && u.pathname !== '/login');
        const u = new URL(p.url()); a.equal(u.pathname + u.search, expected, 'next=' + target);
        await ctx.close();
      }
      pass(kind + ': ?next= follows same-origin paths only');

      // Password recovery: request, administrator issues a code, customer confirms in the page.
      { const ctx = await browser.newContext(opts); const p = await ctx.newPage(); await p.emulateMedia({ reducedMotion: 'reduce' });
        await p.route(base + '/**', r => r.request().resourceType() === 'document' ? r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname === '/login' ? pages.login : stub }) : r.continue());
        await p.goto(base + '/login'); await p.locator('#email').fill(email);
        await p.locator('.lnk').click(); await p.locator('#forgotForm').waitFor({ state: 'visible' });
        a.equal(await p.locator('#forgotEmail').inputValue(), email);
        await Promise.all([p.waitForResponse(r => r.url().endsWith('/api/auth/password-reset/request') && r.status() === 202), p.locator('#forgotBtn').click()]);
        await p.locator('#resetStep').waitFor({ state: 'visible' });
        const request = (await api('/api/admin/password-resets', 200, null, master)).items.find(x => x.email === email && x.status === 'PENDING'); a(request);
        const issued = await api('/api/admin/password-resets', 200, { requestId: request.id }, master);
        await p.locator('#resetCode').fill('12345'); await p.locator('#newPassword').fill('short'); await p.locator('#resetBtn').click();
        await p.locator('#resetErr', { hasText: '6 位重置码' }).waitFor();
        const fresh = 'LoginPageReset' + kind + '2468!';
        await p.locator('#resetCode').fill(issued.code); await p.locator('#newPassword').fill(fresh);
        await Promise.all([p.waitForResponse(r => r.url().endsWith('/api/auth/password-reset/confirm') && r.status() === 200), p.locator('#resetBtn').click()]);
        await p.locator('#form').waitFor({ state: 'visible' });
        await api('/api/auth/login', 200, { email, password: fresh });
        await api('/api/auth/login', 401, { email, password });
        await ctx.close(); pass(kind + ': password recovery with administrator reset code works end to end'); }
    }

    // Administrator mode: 2FA required, customer-only controls hidden, admin cookie issued.
    { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); await p.emulateMedia({ reducedMotion: 'reduce' });
      await p.route(base + '/**', r => r.request().resourceType() === 'document' ? r.fulfill({ contentType: 'text/html', body: new URL(r.request().url()).pathname === '/login' ? pages.login : stub }) : r.continue());
      await p.goto(base + '/login?admin=1'); await p.locator('#otp').waitFor({ state: 'visible' });
      a(!(await p.locator('#greg').isVisible()) && !(await p.locator('.lnk').isVisible()) && !(await p.locator('#rem').isVisible()), 'customer controls visible in admin mode');
      a.equal(await p.locator('label[data-t=lacc]').innerText(), '电子邮箱');
      a.equal(await p.locator('.hero h1').innerText(), '管理员安全登录');
      await p.locator('.lang button[data-l=en]').click(); a.equal(await p.locator('.hero h1').innerText(), 'Administrator sign-in');
      await p.locator('.lang button[data-l=zh]').click(); a.equal(await p.locator('.hero p').innerText(), '管理员账号 · 需要 2FA 动态码');
      await submitLogin(p, 'qa-master@example.test', password);
      await p.locator('#e3', { hasText: '6 位动态验证码' }).waitFor();
      await p.locator('#otp').fill('000000'); await p.locator('#loginBtn').click();
      await p.locator('#e2', { hasText: '账号、密码或动态码不正确' }).waitFor();
      a.equal(await p.locator('#password').inputValue(), '', 'failed admin attempt must clear the password');
      await p.locator('#password').fill(password); await p.locator('#otp').fill(otp(masterSecret)); await p.locator('#loginBtn').click();
      await p.waitForURL('**/admin');
      a((await ctx.cookies()).some(c => c.name === '__Host-cn-admin' && c.httpOnly), 'HttpOnly admin cookie missing');
      a.equal(await p.evaluate(() => sessionStorage.getItem('cncap.admin.entry')), '1');
      await ctx.close(); pass('admin: 2FA enforced, customer controls hidden, admin cookie issued'); }

    fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR, 'results.json'), JSON.stringify({ passed: true, checks }, null, 2));
    console.log(checks.length + ' login page checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
