const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const label=process.env.CN_PUBLICATION_LABEL||'9fea07e';assert(/^[a-zA-Z0-9-]+$/.test(label));
const root=path.resolve(__dirname,'..'),dir=path.join(root,'artifacts','publication-'+label),pages=JSON.parse(fs.readFileSync(path.join(root,'dist/worker.mjs'),'utf8').match(/const replacementPages = (.+);/)[1]);
const hash=b=>createHash('sha256').update(b).digest('hex');
async function request(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(30000)});}
(async()=>{
 const report={checkedAt:new Date().toISOString(),version:JSON.parse(fs.readFileSync(path.join(dir,'publication.json'))).version,sourceSha256:hash(fs.readFileSync(path.join(root,'dist/worker.mjs'))),checks:[]};
 for(const origin of ['https://nuvexapro.com','https://admin.maacropierce.com']){
  const ready=await request(origin+'/ready');assert.equal(ready.status,200);assert.equal((await ready.json()).database,'connected');
  const logo=await request(origin+'/logo.png');assert.equal(logo.status,200);assert.equal(hash(Buffer.from(await logo.arrayBuffer())),hash(fs.readFileSync(path.join(root,'web/logo.png'))));
  report.checks.push({origin,database:'connected',logo:'matching'});
  for(const [route,method]of [['/api/account','GET'],['/api/products','GET'],['/api/product-settlement','GET'],['/api/requests','POST'],['/api/support','POST'],['/api/admin/clients','GET'],['/api/admin/client-action','POST']]){
   const r=await request(origin+route,{method});assert([401,404].includes(r.status),origin+route+' '+r.status);report.checks.push({url:origin+route,method,status:r.status});
  }
 }
 const mobile=await request('https://nuvexapro.com/',{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1','Sec-CH-UA-Mobile':'?1'}});assert.equal(mobile.status,200);const html=await mobile.text();assert.equal(hash(html),hash(pages.mobile));assert(html.includes('createMutualFunds')&&html.includes('/api/support')&&html.includes('/api/requests'));report.checks.push({device:'mobile',origin:'https://nuvexapro.com/',http:200,htmlMatchesAcceptedBuild:true});
 const admin=await request('https://admin.maacropierce.com/');assert.equal(admin.status,200);assert.equal(hash(await admin.text()),hash(pages.login));
 const desktop=await request('https://nuvexapro.com/',{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36','Sec-CH-UA-Mobile':'?0'}});assert.equal(desktop.status,200);assert.equal(hash(await desktop.text()),hash(pages.desktop));
 report.checks.push({device:'desktop/admin',htmlMatchesAcceptedBuild:true});
 const legacy=await request('https://m.nuvexapro.com/');report.mobileSubdomain={status:legacy.status,server:legacy.headers.get('server'),migrated:false};
 report.browserChecks={desktopLogoutReturnsRootLogin:false,adminPasswordAndTwoFactorVisible:false,physicalDeviceVerified:false,mobileBrowserInteractionVerified:false};
 fs.writeFileSync(path.join(dir,'online-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,version:report.version,checks:report.checks.length,mobileMainDomain:true,mobileSubdomain:report.mobileSubdomain}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
