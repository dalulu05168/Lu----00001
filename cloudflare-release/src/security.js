// Shared production throttling, using persistent counters rather than per-isolate memory.
var RATE_RULES = [
 {bucket:'login',method:'POST',path:'/api/auth/login',max:50,subjectMax:10,windowMs:300000,email:true},
 {bucket:'register',method:'POST',path:'/api/auth/register',max:12,subjectMax:6,windowMs:600000,email:true},
 {bucket:'admin-login',method:'POST',path:'/api/admin/login',max:30,subjectMax:8,windowMs:300000,email:true},
 {bucket:'admin-activate',method:'POST',path:'/api/admin/activate',max:20,subjectMax:8,windowMs:300000,email:true},
 {bucket:'admin-bootstrap',method:'POST',path:'/api/admin/bootstrap',max:5,subjectMax:3,windowMs:600000,email:true},
 {bucket:'pwreset-request',method:'POST',path:'/api/auth/password-reset/request',max:15,subjectMax:5,windowMs:600000,email:true},
 {bucket:'pwreset-confirm',method:'POST',path:'/api/auth/password-reset/confirm',max:20,subjectMax:8,windowMs:600000,email:true},
 {bucket:'admin-reauth',method:'POST',path:'/api/admin/reauth',max:20,subjectMax:5,windowMs:300000},
 ...['/api/orders','/api/bulk-orders','/api/fund-subscriptions','/api/product-settlement','/api/requests','/api/withdrawal-pin','/api/admin/requests','/api/admin/password-resets'].map(path=>({bucket:'write:'+path,method:'POST',path,max:120,subjectMax:30,windowMs:60000})),
 {bucket:'delegated',method:'POST',path:'/api/admin/client-action',max:600,subjectMax:300,windowMs:60000}
];
function matchRule(pathname,method){return RATE_RULES.find(r=>r.method===method&&r.path===pathname)||(['POST','PATCH','DELETE'].includes(method)&&pathname.startsWith('/api/admin/')?{bucket:'admin-write:'+pathname,method,path:pathname,max:120,subjectMax:30,windowMs:60000}:null);}
async function cnRateLimit(db,rule,request,now=Date.now()){
 const windowStart=new Date(Math.floor(now/rule.windowMs)*rule.windowMs);
 const retryAfter=Math.max(1,Math.ceil((windowStart.getTime()+rule.windowMs-now)/1000));
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 const dimensions=[['ip',digest(ip),rule.max]];
 const auth=request.headers.get('authorization')||'';
 if(auth.startsWith('Bearer ')&&auth.length<=263)dimensions.push(['session',digest(auth),rule.subjectMax]);
 if(rule.email){
  const length=Number(request.headers.get('content-length')||0);
  if(length>8192)return {status:413,error:'Request too large',retryAfter:0};
  const reader=request.clone().body?.getReader();let bytes=0,chunks=[];
  if(reader)try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192){reader.cancel().catch(()=>{});return {status:413,error:'Request too large',retryAfter:0};}chunks.push(part.value);}}finally{reader.releaseLock();}
  try{const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof payload.email==='string'&&payload.email.length<=254)dimensions.push(['account',digest(payload.email.trim().toLowerCase()),rule.subjectMax]);}catch{}
 }
 try{
  for(const [kind,id,max] of dimensions){
   const r=await db.query(`INSERT INTO auth_attempts(bucket,ip,window_start,count) VALUES($1,$2,$3,1)
     ON CONFLICT(bucket,ip,window_start) DO UPDATE SET count=LEAST(auth_attempts.count+1,1000000) RETURNING count`,[rule.bucket+':'+kind,id,windowStart]);
   if(!r.rows?.length||!Number.isInteger(Number(r.rows[0].count)))throw Error('Counter unavailable');
   if(Number(r.rows[0].count)>max)return {status:429,error:'Too many attempts',retryAfter};
  }
  return {status:200};
 }catch{console.error('security_rate_limit_unavailable');return {status:503,error:'Security verification unavailable',retryAfter:30};}
}
async function checkRateLimit(env,rule,request){return cnRateLimit(createRequestScopedDb(env.DATABASE_URL),rule,request);}
function cnRecentAdminVerification(session,now=Date.now()){
 const at=new Date(session?.adminVerifiedAt||0).getTime();
 return session?.adminVerified===true&&Number.isFinite(at)&&at<=now&&now-at<=300000;
}
function cnSensitiveAdminWrite(route,method){
 return ['POST','PATCH','DELETE'].includes(method)&&!['/api/admin/login','/api/admin/bootstrap','/api/admin/activate','/api/admin/reauth','/api/admin/support','/api/admin/client-action','/api/admin/subaccounts/overview'].includes(route);
}
async function cnReauthenticate(db,session,rawToken,credentials,ip){
 const r=await db.query(`SELECT u.password_hash,a.totp_secret_ciphertext,a.role FROM app_users u JOIN admin_roles a ON a.user_id=u.id
   WHERE u.id=$1 AND a.twofa_confirmed_at IS NOT NULL AND a.login_restricted_at IS NULL`,[session.userId]);
 const row=r.rows[0];
 if(!row||typeof credentials.password!=='string'||Buffer.byteLength(credentials.password)>1024||typeof credentials.otp!=='string'||!/^\d{6}$/.test(credentials.otp)||!await verifyPassword(credentials.password,row.password_hash)||!checkOtp(unprotectTotp(row.totp_secret_ciphertext),credentials.otp)){
  await db.query("INSERT INTO admin_audit_log(admin_user_id,role,action,ip) VALUES($1,$2,'admin.reauth.failed',$3)",[session.userId,row?.role||null,ip]);
  return false;
 }
 const tx=await db.connect();
 try{await tx.query('BEGIN');
  const updated=await tx.query(`UPDATE user_sessions SET admin_verified_at=now() WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()
    AND NOT EXISTS(SELECT 1 FROM admin_roles WHERE user_id=$2 AND login_restricted_at IS NOT NULL) RETURNING user_id`,[sessionTokenHash(rawToken),session.userId]);
  if(updated.rows.length!==1){await tx.query('ROLLBACK');return false;}
  await tx.query("INSERT INTO admin_audit_log(admin_user_id,role,action,ip) VALUES($1,$2,'admin.reauth',$3)",[session.userId,row.role,ip]);
  await tx.query('COMMIT');return true;
 }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
}
