const fs = require('node:fs');
const path = require('node:path');
const {fork,spawn} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const testedSha=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dist/worker.mjs'))).digest('hex');
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'artifacts','acceptance-'));
const suites={"write-receipts":["write-receipts.cjs",8906],"experience":["experience.cjs",8905],"product-notifications":["product-notifications.cjs",8904],"mirror":["mirror-operations.cjs",8903],"contracts":["api-contracts.cjs",8902],"charts":["chart-render.cjs",8901],"product-browser":["product-browser.cjs",8900],"products":["products.cjs",8891],"permissions":["permissions.cjs",8892],"registration":["registration.cjs",8893],"stocks":["stocks.cjs",8894],"interface":["interface.cjs",8895],"sessions":["sessions.cjs",8896],"reference":["reference.cjs",8897],"forms":["forms.cjs",8898],"access":["access.cjs",8899]};
async function run(name) {
 const [file,port]=suites[name],dir=path.join(out,name);fs.mkdirSync(dir);
 const env={...process.env,CN_ACCEPTANCE_SOURCE:path.join(root,'dist','worker.mjs'),CN_QA_SAVE_DIR:dir,CN_OPS_QA_PORT:String(port),CN_ACCEPTANCE_PG_PORT:String(port+6600),CN_OPS_MASTER_FILE:path.join(dir,'fixture-master.json'),CN_OPS_LIVE_UI:'1',CN_REFERENCE_FIXTURE:name==='reference'?'1':'0'};
 if(name==='reference')env.CN_QUOTE_REPORT=path.join(root,'qa','reference-quote-report.json');
 return new Promise(resolve=>{
  const log=fs.createWriteStream(path.join(dir,'qa.log'));
  const server=fork(path.join(root,'qa','isolated-server.cjs'),[],{env,cwd:root,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  let child,code=1;
  const print=data=>{log.write(data);process.stdout.write(name+' '+data)};
  const timer=setTimeout(()=>{child?.kill();server.kill()},180000);
  server.stderr.on('data',print);
  server.stdout.on('data',data=>{
   if(child||!String(data).includes('Isolated local QA API ready'))return;
   child=spawn(process.execPath,[path.join(root,'qa',file),...(name==='interface'?['--live']:[])],{env,cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
   child.stdout.on('data',print);child.stderr.on('data',print);
   child.once('exit',result=>{code=result??1;if(server.connected)server.send('close');else server.kill()});
  });
  server.once('exit',status=>{
   clearTimeout(timer);log.end();
   if(fs.existsSync(env.CN_OPS_MASTER_FILE))fs.unlinkSync(env.CN_OPS_MASTER_FILE);
   resolve({name,code:status?status:code});
  });
 });
}
(async()=>{
 const names=process.argv.slice(2).length?process.argv.slice(2):Object.keys(suites);
 for(const name of names)if(!suites[name])throw Error('Unknown suite '+name);
 const result=[];
 for(const name of names)result.push(await run(name));
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourceSha256:testedSha,sourceUnchanged:testedSha===require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dist/worker.mjs'))).digest('hex'),productionVersion:require('../release-manifest.json').version,checkedAt:new Date().toISOString(),results:result},null,2));
 console.log('Evidence '+out); console.log(JSON.stringify(result));process.exitCode=result.some(x=>x.code!==0)||testedSha!==require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dist/worker.mjs'))).digest('hex')?1:0;
})().catch(e=>{console.error(e.stack);process.exitCode=1});

