const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHmac,randomUUID}=require('node:crypto');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!';
function otp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(time).digest();return String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');}
async function call(route,token,body,key,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function ok(route,status,token,body,key,method){const r=await call(route,token,body,key,method);assert.equal(r.status,status,route+' '+JSON.stringify(r.data));return r.data;}
(async()=>{
 const master=(await ok('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const agentEmail='qa-receipts-agent@example.test',agent=await ok('/api/admin/subaccounts',201,master,{email:agentEmail,password});
 const credentials={email:agentEmail,password,otp:otp(agent.totpSecret)};
 await ok('/api/admin/activate',200,null,credentials);
 const owner=(await ok('/api/admin/login',200,null,credentials)).token;
 const email='qa-receipts-client@example.test';await ok('/api/auth/register',201,null,{email,password,inviteCode:agent.inviteCode});
 const token=(await ok('/api/auth/login',200,null,{email,password})).token;
 const other=(await ok('/api/auth/login',200,null,{email:'qa-mobile@example.test',password})).token;
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
 for(const body of [{kind:'IDENTITY',fullName:'隔离验收客户',front:png,back:png},{kind:'BANK',bankName:'Fixture Bank',accountNumber:'000000001234'}]){
  await ok('/api/profile-documents',201,token,body);
  const d=await ok('/api/admin/profile-documents?'+new URLSearchParams({email,kind:body.kind}),200,owner);
  await ok('/api/admin/profile-documents',200,owner,{email,kind:body.kind,status:'APPROVED',version:d.version},null,'PATCH');
 }
 const checks=[];
 for(const [route,body,changed]of [['/api/requests',{kind:'DEPOSIT',amountCents:12345},{kind:'DEPOSIT',amountCents:12346}],['/api/support',{message:'并发去重验收'},{message:'不同内容'}]]){
  const key=randomUUID(),rows=await Promise.all(Array.from({length:6},()=>ok(route,201,token,body,key)));
  assert.equal(new Set(rows.map(x=>x.id)).size,1);await ok(route,409,token,changed,key);
  const replay=await ok(route,201,token,body,key);assert.equal(replay.id,rows[0].id);assert.equal(replay.replayed,true);
  const result=await ok('/api/order-results?key='+key,200,token);assert.equal(result.found,true);
  assert.equal((await ok('/api/order-results?key='+key,200,other)).found,false);
  await ok(route,400,token,body,'short');checks.push(route+': six concurrent submissions, replay, conflict, receipt ownership');
 }
 await ok('/api/withdrawal-pin',200,token,{password,pin:'472863'});
 const key=randomUUID();assert.notEqual((await call('/api/requests',token,{kind:'WITHDRAW',amountCents:1000,withdrawalPin:'472863'},key)).status,201);
 // A failed transaction must roll back its receipt, allowing a corrected request with that key.
 await ok('/api/requests',201,token,{kind:'DEPOSIT',amountCents:1000},key);checks.push('rejected withdrawal leaves no committed receipt');
 const shared=randomUUID(),a=await ok('/api/support',201,token,{message:'甲'},shared),b=await ok('/api/support',201,other,{message:'乙'},shared);assert.notEqual(a.id,b.id);checks.push('same key isolated by customer');
 fs.writeFileSync(path.join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({passed:true,checks},null,2));console.log(checks.join('\n'));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
