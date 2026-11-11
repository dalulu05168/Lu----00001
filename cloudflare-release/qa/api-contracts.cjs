
const fs=require('fs'),assert=require('assert/strict');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT;
const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8');
(async()=>{
 const routes=JSON.parse(source.match(/const allowed = (\{[\s\S]*?\n  \});/)[1]);
 const publicAuth=['/api/admin/login','/api/admin/bootstrap','/api/admin/activate'];
 const report=[];
 for(const [route,methods] of Object.entries(routes)){
  if(publicAuth.includes(route))continue;
  const r=await fetch(base+route,{method:methods[0]});assert.equal(r.status,401,route+' without session');report.push({route,anonymous:r.status});
  const wrong=await fetch(base+route,{method:'DELETE'});assert.equal(wrong.status,405,route+' wrong method');
 }
 const protectedRoutes=['/api/products','/api/products/quote','/api/fund-subscriptions','/api/bulk-orders','/api/product-settlement','/api/orders','/api/account','/api/watchlist','/api/requests','/api/support','/api/profile-documents','/api/notifications','/api/withdrawal-pin'];
 for(const route of protectedRoutes){const r=await fetch(base+route,{method:['/api/fund-subscriptions','/api/bulk-orders','/api/orders'].includes(route)?'POST':'GET'});assert.equal(r.status,401,route);report.push({route,anonymous:r.status})}
 // Required by the isolated runner audit summary.
 const master=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE,'utf8'));
 const {createHmac}=require('crypto');const bits=[...master.totpSecret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(time).digest();const otp=String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
 const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'qa-master@example.test',password:'FixturePass123456!',otp})});assert.equal(login.status,200);
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify(report,null,2));console.log(report.length+' protected endpoint families deny anonymous access; admin method guards passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});

