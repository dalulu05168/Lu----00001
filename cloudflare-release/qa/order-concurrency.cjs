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

 const deposit=await ok('/api/requests',201,token,{kind:'DEPOSIT',amountCents:100000},randomUUID());
 for(let i=0;i<2;i++)await ok('/api/admin/requests',200,master,{id:deposit.id,decision:'APPROVE',expectedStatus:i===0?'PENDING':'REVIEWED'});
 await ok('/api/admin/listings',201,master,{market:'US',itemType:'STOCK',symbol:'AAPL',name:'Apple',status:'PUBLISHED',tradePin:'749286'});
 const buy={market:'US',symbol:'AAPL',side:'BUY',quantity:1,limitPriceCents:1300,tradePin:'749286'},key=randomUUID();
 const repeated=await Promise.all(Array.from({length:12},()=>call('/api/orders',token,buy,key)));
 assert(repeated.every(x=>[200,201].includes(x.status)));assert.equal(repeated.filter(x=>x.status===201).length,1);assert.equal(new Set(repeated.map(x=>x.data.order.id)).size,1);
 const buys=await Promise.all(Array.from({length:4},()=>call('/api/orders',token,{...buy,quantity:50},randomUUID())));
 assert.equal(buys.filter(x=>x.status===201).length,1);assert(buys.filter(x=>x.status!==201).every(x=>[400,409].includes(x.status)));
 const sells=await Promise.all(Array.from({length:4},()=>call('/api/orders',token,{market:'US',symbol:'AAPL',side:'SELL',quantity:40},randomUUID())));
 assert.equal(sells.filter(x=>x.status===201).length,1);assert(sells.filter(x=>x.status!==201).every(x=>[400,409].includes(x.status)));
 const snapshot=await ok('/api/account',200,token);assert.equal(snapshot.account.cashCents,86386);assert.equal(snapshot.orders.length,3);assert.equal(Number(snapshot.positions.find(p=>p.symbol==='AAPL').quantity),11);
 fs.writeFileSync(path.join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({passed:true,duplicateBuyCalls:12,duplicateBuyOrders:1,competingBuys:4,acceptedBuys:1,competingSells:4,acceptedSells:1,cashCents:86386,position:11,orders:3,snapshot},null,2));
 console.log('12 repeated buys write once; 4 competing buys and 4 sells preserve balance, position and ledger');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
