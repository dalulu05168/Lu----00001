/* No session secret is persisted by the browser UI after cookie-mode login. */
(()=>{
 if(window.CN_MIRROR_CONTEXT)return; // Sandboxed mirrors use the administrator's parent channel.
 const original=window.fetch.bind(window),marker='cn-cookie-session';
 const scope=__CN_BROWSER_ADMIN__?'admin':'client';
 window.fetch=function(input,options){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return original(input,options);
  const request=new Request(input instanceof Request?input:url.href,options),headers=new Headers(request.headers);
  const auth=headers.get('authorization')||'',login=['/api/auth/login','/api/admin/login'].includes(url.pathname);
  // Existing explicit Bearer sessions continue until re-login; the next login issues cookies only.
  const cookieMode=login||auth==='Bearer '+marker||!auth;
  if(cookieMode){headers.set('X-CN-Session-Mode','cookie');headers.set('X-CN-Session-Scope',scope);headers.delete('authorization');}
  return original(new Request(request,{headers,credentials:cookieMode?'same-origin':request.credentials}));
 };
})();
