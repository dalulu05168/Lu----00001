/* Re-verify the current administrator before retrying a server-denied sensitive action. */
(()=>{
 const original=window.fetch.bind(window);let pending=null;
 function verify(){
  if(pending)return pending;
  pending=new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='cn-security-dialog';
   dialog.innerHTML=`<form><header><h2>安全验证</h2><button type="button" data-cancel aria-label="关闭">×</button></header><p>为保护账户，请验证当前管理员密码和动态验证码。</p><label>管理员密码<input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label><label>2FA 动态验证码<input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><p role="alert"></p><footer><button type="button" data-cancel>取消</button><button type="submit">验证并继续</button></footer></form>`;
   const style=document.createElement('style');style.textContent=`.cn-security-dialog{width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);box-sizing:border-box;padding:24px;border:1px solid #d6e1ef;border-radius:20px;color:#172534;background:#fff;font:15px/1.6 system-ui;box-shadow:0 24px 70px #10274426}.cn-security-dialog::backdrop{background:#17253466;backdrop-filter:blur(3px)}.cn-security-dialog header,.cn-security-dialog footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.cn-security-dialog h2{font-size:20px;margin:0}.cn-security-dialog label{display:grid;gap:8px;margin-top:16px}.cn-security-dialog input{box-sizing:border-box;width:100%;height:46px;padding:10px 14px;border:1px solid #d6e1ef;border-radius:12px;background:#f5f8fc;color:#172534;font:inherit}.cn-security-dialog button{min-height:40px;padding:8px 18px;border:1px solid #d6e1ef;border-radius:999px;background:#f5f8fc;color:#29435d;font:inherit;cursor:pointer}.cn-security-dialog button[type=submit]{background:#175bb0;color:#fff}.cn-security-dialog [role=alert]{color:#b0293e;min-height:24px}.cn-security-dialog button:disabled{opacity:.55;cursor:wait}`;
   dialog.append(style);document.body.append(dialog);let done=false;
   const finish=ok=>{if(done)return;done=true;dialog.querySelector('form').reset();dialog.close();dialog.remove();resolve(ok);};
   dialog.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>finish(false));dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false)});
   dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget,submit=form.querySelector('[type=submit]'),alert=form.querySelector('[role=alert]');submit.disabled=true;alert.textContent='正在验证…';
    const token=localStorage.getItem('cncap.admin.session')||'';
    try{const r=await original('/api/admin/reauth',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({password:form.elements.password.value,otp:form.elements.otp.value}),cache:'no-store'});
     form.elements.password.value='';form.elements.otp.value='';
     if(r.ok&&(await r.json()).verified){finish(true);return;}
     alert.textContent=r.status===429?'验证次数过多，请稍后再试。':r.status===503?'安全校验暂不可用，请稍后重试。':'验证失败，请核对密码和动态验证码。';
    }catch{alert.textContent='连接失败，请重试。';}finally{submit.disabled=false;}
   };
   dialog.showModal();dialog.querySelector('input').focus();
  }).finally(()=>{pending=null});return pending;
 }
 window.fetch=async function(input,options){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/admin/')||url.pathname==='/api/admin/reauth')return original(input,options);
  const request=new Request(input instanceof Request?input:url.href,options),retry=request.clone();
  const response=await original(request);
  if(response.status!==428)return response;
  const result=await response.clone().json().catch(()=>({}));
  if(result.error!=='Recent admin verification required'||!await verify())return response;
  return original(retry); // Exactly once; no retry after network failure or unknown execution outcome.
 };
})();
