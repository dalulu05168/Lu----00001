// Builds cloudflare-release/web/login.html from the handoff candidate.
// Every edit must match exactly once, so a drifted candidate fails loudly instead of half-applying.
const fs = require('fs');
const [candidatePath, productionPath, outPath] = process.argv.slice(2);
let h = fs.readFileSync(candidatePath, 'utf8');
const production = fs.readFileSync(productionPath, 'utf8');

function once(from, to) {
  const n = h.split(from).length - 1;
  if (n !== 1) throw Error(`expected 1 match, found ${n}: ${String(from).slice(0, 90)}`);
  h = h.replace(from, () => to);
}

// 1. Keep the element ids that the session, registration and browser-session suites already use.
once('<title>NUVEXA · 安全登录', '<title>CN Capital');
once('<input id="acc" ', '<input id="email" ');
once('<input id="pwd" ', '<input id="password" ');
once('<button type="submit" class="btn" id="sub">', '<button type="submit" class="btn" id="loginBtn">');
once('<input id="racc" ', '<input id="regEmail" ');
once('<input id="rpwd" ', '<input id="regPassword" ');
once('id="rsub"', 'id="regBtn"');
once('id="rinv"', 'id="inviteCode"');
once('<button type="button" id="greg">', '<button type="button" id="greg" data-tab="register">');
once("getElementById('acc')", "getElementById('email')");
once("getElementById('pwd')", "getElementById('password')");
once("getElementById('sub')", "getElementById('loginBtn')");
once("getElementById('racc')", "getElementById('regEmail')");
once("getElementById('rpwd')", "getElementById('regPassword')");
once("getElementById('rsub')", "getElementById('regBtn')");
once("getElementById('rinv')", "getElementById('inviteCode')");

// 2. Password recovery uses the existing administrator-issued reset code (request, then confirm).
once('<button type="button" class="back" id="rback" data-t="rback">已有账号？返回登录</button>\n</form>',
  '<button type="button" class="back" id="rback" data-t="rback">已有账号？返回登录</button>\n</form>\n' +
  '<form id="forgotForm" class="pn" novalidate hidden>\n' +
  '<div class="fld"><label data-t="lfe" for="forgotEmail">电子邮箱</label><div class="inp" id="fw1"><input id="forgotEmail" type="email" autocomplete="username" autocapitalize="none" data-ph="pacc" placeholder="请输入邮箱地址"></div></div>\n' +
  '<div class="err" id="forgotErr" role="alert"></div>\n' +
  '<button type="button" class="btn" id="forgotBtn"><span><span class="sp"></span><span data-t="fbtn">申请重置码</span></span></button>\n' +
  '<div id="resetStep" hidden>\n' +
  '<div class="fld"><label data-t="lrc" for="resetCode">重置码</label><div class="inp"><input id="resetCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-ph="prc" placeholder="请输入 6 位重置码"></div></div>\n' +
  '<div class="fld"><label data-t="lnp" for="newPassword">新密码</label><div class="inp"><input id="newPassword" type="password" autocomplete="new-password" data-ph="prp" placeholder="至少 12 位"></div></div>\n' +
  '<div class="err" id="resetErr" role="alert"></div>\n' +
  '<button type="button" class="btn" id="resetBtn"><span><span class="sp"></span><span data-t="rsbtn">设置新密码</span></span></button>\n' +
  '</div>\n' +
  '<button type="button" class="back" id="forgotBack" data-t="rback">已有账号？返回登录</button>\n' +
  '</form>');
once('.nuvexa-admin-only{display:none}</style>',
  '.nuvexa-admin-only{display:none}#forgotForm .inp input{width:100%;padding:15px 16px;color:inherit;background:transparent;border:0;outline:0}#forgotForm .inp{min-height:48px}#forgotForm .btn{margin-top:8px}.err.ok{color:#45e0d6}' +
  // The candidate's `font:16px/1 inherit` is invalid CSS, so inputs fell back to ~13px; 16px also stops iOS focus zoom.
  '.inp input,#otpField .inp input,#forgotForm .inp input{font-family:inherit;font-size:16px;line-height:1.2}</style>');

// 3. The decorative chart must not show a price label that reads like a live quote.
once("bx.fillStyle='rgba('+cc+',.92)';bx.fillRect(BW-66,py2-9,62,18);\nbx.fillStyle='#fff';bx.font='600 11px Inter,sans-serif';bx.textAlign='center';bx.fillText(ls.c.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g,','),BW-35,py2+4);\n", '');

// 4. Entry handling as in production: safe ?next=, address cleanup, mobile/admin entry markers.
once("var adminMode=location.hostname==='admin.maacropierce.com'||new URLSearchParams(location.search).get('admin')==='1';",
  "var params=new URLSearchParams(location.search);\n" +
  "var adminMode=location.hostname==='admin.maacropierce.com'||params.get('admin')==='1';\n" +
  "var next=params.get('next')||'';\n" +
  // Resolve with the browser's own URL parser: it strips tabs/newlines and treats a backslash as a slash,
  // so character checks alone let /%09/evil.example or /\evil.example escape. Only an identical origin is kept.
  "next=(function(n){if(!n||n.charAt(0)!=='/')return '';try{var u=new URL(n,location.origin);return u.origin===location.origin?u.pathname+u.search+u.hash:''}catch(e){return ''}})(next);\n" +
  "if(location.hostname==='nuvexapro.com')try{history.replaceState(history.state,'','/')}catch(e){}\n" +
  "var mobileEntry=!adminMode&&!!((navigator.userAgentData&&navigator.userAgentData.mobile)||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));");
once("if(adminMode){otpField.hidden=false;", "if(adminMode){rem.hidden=true;otpField.hidden=false;");
once("document.querySelector('.hero h1').textContent='管理员安全登录';}",
  "I.zh.atitle='管理员安全登录';I.zh.asub='管理员账号 · 需要 2FA 动态码';I.en.atitle='Administrator sign-in';I.en.asub='Administrator account · 2FA code required';document.querySelector('.hero h1').setAttribute('data-t','atitle');document.querySelector('.hero p').setAttribute('data-t','asub');}");

const finishStart = h.indexOf('function finishLogin(token){');
const finishEnd = h.indexOf("location.replace(adminMode?'/admin':'/index.html');\n}", finishStart);
if (finishStart < 0 || finishEnd < 0) throw Error('finishLogin not found');
h = h.slice(0, finishStart) +
  "function finishLogin(token,email){\n" +
  "  // session-transport.js turns the login into HttpOnly cookies; token is then only the cn-cookie-session marker.\n" +
  "  try{localStorage.setItem(adminMode?'cncap.admin.session':'cncap.session',token);localStorage.setItem('cncap.user',email||acc.value.trim())}catch(e){}\n" +
  "  try{if(adminMode)sessionStorage.setItem('cncap.admin.entry','1');else if(mobileEntry)sessionStorage.setItem('cncap.mobile.entry','1')}catch(e){}\n" +
  "  location.replace(adminMode?'/admin':(next||'/index.html'));\n}" +
  h.slice(finishEnd + "location.replace(adminMode?'/admin':'/index.html');\n}".length);

// 5. Show the server's own message (for example a restricted account) before falling back.
once("function authMessage(res){if(res.status===401)return adminMode?'账号、密码或动态码不正确':'邮箱或密码不正确';if(res.status===429)return '请求过于频繁，请稍后再试';if(res.status===503||res.status===0)return '服务暂时不可用，请稍后再试';return '操作失败，请检查输入后重试';}",
  "function authMessage(res){if(res.status===401)return adminMode?'账号、密码或动态码不正确':'邮箱或密码不正确';if(res.status===429)return '请求过于频繁，请稍后再试';if(res.status===503||res.status===0)return '服务暂时不可用，请稍后再试';if(res.json&&typeof res.json.error==='string'&&res.json.error)return res.json.error;return '操作失败，请检查输入后重试';}");

// 6. Three panels: sign in, register, recover.
once("var fm=document.getElementById('form'),rf=document.getElementById('rform'),",
  "var fm=document.getElementById('form'),rf=document.getElementById('rform'),ff=document.getElementById('forgotForm'),");
once("function setMode(m){var reg=m==='reg';fm.hidden=reg;rf.hidden=!reg;var a=reg?rf:fm;a.classList.remove('in');void a.offsetWidth;a.classList.add('in');h1.setAttribute('data-t',reg?'rtitle':'title');hp.setAttribute('data-t',reg?'rsub':'sub');",
  "function setMode(m){var reg=m==='reg',fg=m==='forgot';fm.hidden=reg||fg;rf.hidden=!reg;ff.hidden=!fg;var a=reg?rf:fg?ff:fm;a.classList.remove('in');void a.offsetWidth;a.classList.add('in');h1.setAttribute('data-t',reg?'rtitle':fg?'ftitle':'title');hp.setAttribute('data-t',reg?'rsub':fg?'fsub':'sub');");

// 6b. If the registration policy cannot be read, keep registration open as production does: show the
// invitation field as optional and let the server enforce its own rule.
once(".catch(function(){registrationPolicy=null});",
  ".catch(function(){registrationPolicy={inviteRequired:false,unknown:true};document.getElementById('rw3').parentElement.hidden=false;document.getElementById('r3').hidden=false});");
once("if(!registrationPolicy){r3.textContent='暂时无法读取注册规则，请稍后重试';return}",
  "if(!registrationPolicy)registrationPolicy={inviteRequired:false,unknown:true};");

// 7. After registering, sign in directly as production does; fall back to the sign-in panel.
once("say(d.rok);acc.value=email;pwd.value='';rpwd.value='';rinv.value='';setMode('login');",
  "var login=await postJSON('/api/auth/login',{email:email,password:password,remember:true});\n" +
  " if(login.ok&&typeof login.json.token==='string'&&login.json.token){finishLogin(login.json.token,email);return}\n" +
  " say(d.rok);acc.value=email;pwd.value='';rpwd.value='';rinv.value='';setMode('login');");

const lnkStart = h.indexOf("document.querySelector('.lnk').onclick=async function(e){");
const lnkEnd = h.indexOf('};', h.indexOf("say(result.ok?'如果账户存在", lnkStart));
if (lnkStart < 0 || lnkEnd < 0) throw Error('forgot link handler not found');
h = h.slice(0, lnkStart) +
  "Object.assign(I.zh,{ftitle:'找回密码',fsub:'通过管理员重置码设置新密码',lfe:'电子邮箱',fbtn:'申请重置码',lrc:'重置码',prc:'请输入 6 位重置码',lnp:'新密码',rsbtn:'设置新密码'});\n" +
  "Object.assign(I.en,{ftitle:'Reset password',fsub:'Set a new password with an administrator reset code',lfe:'Email address',fbtn:'Request reset code',lrc:'Reset code',prc:'Enter the 6-digit reset code',lnp:'New password',rsbtn:'Set new password'});\n" +
  "var forgotEmail=document.getElementById('forgotEmail'),forgotErr=document.getElementById('forgotErr'),forgotBtn=document.getElementById('forgotBtn'),resetStep=document.getElementById('resetStep'),resetCode=document.getElementById('resetCode'),newPassword=document.getElementById('newPassword'),resetErr=document.getElementById('resetErr'),resetBtn=document.getElementById('resetBtn');\n" +
  "function note(el,msg,ok){el.textContent=msg||'';el.classList.toggle('ok',!!ok)}\n" +
  "document.querySelector('.lnk').onclick=function(e){e.preventDefault();if(adminMode)return;forgotEmail.value=acc.value.trim();resetStep.hidden=true;note(forgotErr,'');note(resetErr,'');setMode('forgot')};\n" +
  "document.getElementById('forgotBack').onclick=function(){setMode('login')};\n" +
  "resetCode.addEventListener('input',function(){resetCode.value=resetCode.value.replace(/[^0-9]/g,'').slice(0,6)});\n" +
  "forgotBtn.onclick=async function(){var email=forgotEmail.value.trim();note(forgotErr,'');if(!emailRe.test(email)){note(forgotErr,'请输入有效的邮箱');return}\n" +
  " forgotBtn.disabled=true;forgotBtn.classList.add('load');var res=await postJSON('/api/auth/password-reset/request',{email:email});forgotBtn.disabled=false;forgotBtn.classList.remove('load');\n" +
  " if(!res.ok){note(forgotErr,authMessage(res));return}\n" +
  " resetStep.hidden=false;note(resetErr,'申请已提交，请联系管理员获取重置码',true);resetCode.focus()};\n" +
  "resetBtn.onclick=async function(){var email=forgotEmail.value.trim(),code=resetCode.value.replace(/\\D/g,''),pwd2=newPassword.value;note(resetErr,'');\n" +
  " if(!emailRe.test(email)){note(forgotErr,'请输入有效的邮箱');return}if(!/^\\d{6}$/.test(code)){note(resetErr,'请输入 6 位重置码');return}if(pwd2.length<12){note(resetErr,'新密码至少 12 位');return}\n" +
  " resetBtn.disabled=true;resetBtn.classList.add('load');var res=await postJSON('/api/auth/password-reset/confirm',{email:email,code:code,newPassword:pwd2});resetBtn.disabled=false;resetBtn.classList.remove('load');\n" +
  " if(!res.ok){note(resetErr,authMessage(res));return}\n" +
  " newPassword.value='';resetCode.value='';note(resetErr,'密码已重置，请用新密码登录',true);setTimeout(function(){setMode('login');acc.value=email;pwd.value='';pwd.focus()},1400)};\n" +
  "document.addEventListener('keydown',function(e){if(e.key==='Escape'&&fm.hidden)setMode('login')});\n" +
  "// Registration validates an email address; replace the candidate's later account-name wording.\n" +
  "Object.assign(I.zh,{era:'请输入邮箱地址',era2:'邮箱格式不正确'});Object.assign(I.en,{era:'Please enter an email address',era2:'Invalid email address'});\n" +
  "tr();\n" +
  "if(params.get('register')==='1'&&!adminMode)setMode('reg');\n" +
  "// An existing desktop session goes straight back to the workspace, as production does.\n" +
  "(function(){if(adminMode||mobileEntry)return;var s=null;try{s=localStorage.getItem('cncap.session')}catch(e){}if(!s)return;\n" +
  " fetch('/api/account',{headers:{Authorization:'Bearer '+s}}).then(function(r){if(r.ok)location.replace(next||'/index.html')}).catch(function(){})})();\n" +
  h.slice(lnkEnd + 2);

// 8. Keep the Cloudflare Web Analytics beacon the production page already ships.
const beacon = production.match(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com[^\n]*<\/script>/);
if (!beacon) throw Error('beacon not found in production page');
once('</body>', beacon[0] + '\n</body>');

for (const banned of ["getElementById('acc')", "id=\"sub\"", 'fillText(ls.c', '重置说明将发送到该邮箱']) {
  if (h.includes(banned)) throw Error('left over: ' + banned);
}
fs.writeFileSync(outPath, h);
console.log('wrote', outPath, h.length, 'bytes');
