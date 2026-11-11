// Browser sessions use host-only HttpOnly cookies. Explicit Bearer API clients remain compatible.
const CN_COOKIE_MARKER='cn-cookie-session';
function cnCookieName(scope){return scope==='admin'?'__Host-cn-admin':'__Host-cn-client';}
function cnCookieToken(header,name){
 const values=String(header||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(values.length!==1)return null;const value=values[0].slice(name.length+1);
 return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
function cnPrepareBrowserSession(req,res,route){
 const scope=route.startsWith('/api/admin/')||req.headers['x-cn-session-scope']==='admin'?'admin':'client';
 const cookieMode=req.headers['x-cn-session-mode']==='cookie';
 res.cnBrowserSession={scope,mode:cookieMode,route,backgroundClose:req.headers['x-cn-session-close']==='background'};
 const authorization=req.headers.authorization||'';
 const useCookie=cookieMode||!authorization||authorization==='Bearer '+CN_COOKIE_MARKER;
 if(!useCookie)return true;
 const token=cnCookieToken(req.headers.cookie,cnCookieName(scope));
 if(token){
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.headers.origin,host=req.headers.host;
   let allowedOrigin=false;try{allowedOrigin=!!origin&&(new URL(origin).host===host||['https://nuvexapro.com','https://admin.maacropierce.com'].includes(new URL(origin).origin));}catch{}
   if(!cookieMode||req.headers['sec-fetch-site']==='cross-site'||origin&&!allowedOrigin){response(res,403,{error:'Cross-site request forbidden'});return false;}
  }
  req.headers.authorization='Bearer '+token;
 }else if(authorization==='Bearer '+CN_COOKIE_MARKER){delete req.headers.authorization;}
 return true;
}
function cnBrowserSessionResult(res,status,value){
 const info=res.cnBrowserSession;
 if(!info?.mode)return value;
 if(status===200&&['/api/admin/login','/api/auth/login','/api/admin/reauth'].includes(info.route)&&typeof value?.token==='string'){
  const maxAge=Math.max(0,Math.floor((new Date(value.expiresAt).getTime()-Date.now())/1000));
  res.setHeader('Set-Cookie',cnCookieName(info.scope)+'='+value.token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge);
  return {...value,token:CN_COOKIE_MARKER,sessionMode:'cookie'};
 }
 if(status===204&&info.route==='/api/auth/logout'&&!info.backgroundClose)res.setHeader('Set-Cookie',cnCookieName(info.scope)+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
 return value;
}
