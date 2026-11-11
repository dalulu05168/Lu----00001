const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),net=require('node:net'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');const {seal,open,hash,snapshot,restoreBoundary,backupDue,advanceAlerts}=require('./core.cjs');
const home=path.resolve(process.env.CN_OPS_HOME||'C:/Users/mrmal/Desktop/手机端/安全备份');
const bin=path.join(home,'tools/pgsql/bin'),pg=require(path.join(home,'tools/node/node_modules/pg'));
const privateDir=path.join(home,'private'),archiveDir=path.join(home,'archives'),records=path.join(home,'records'),pendingDir=path.join(home,'alerts/pending'),sentDir=path.join(home,'alerts/sent');
for(const p of [archiveDir,records,pendingDir,sentDir])fs.mkdirSync(p,{recursive:true});
const json=p=>JSON.parse(fs.readFileSync(p,'utf8')),write=(p,v)=>{const temp=p+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(v,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,p);};
function latestBackup(){try{const r=json(path.join(records,'latest-backup.json'));assert.equal(path.basename(r.file),r.file);assert.equal(hash(fs.readFileSync(path.join(archiveDir,r.file))),r.verification.archiveSha256);return r;}catch{return null;}}
function vault(){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'vault.ps1'),'-Mode','unprotect','-Path',path.join(privateDir,'credentials.dpapi')],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,'Local credential vault cannot be unlocked');return JSON.parse(r.stdout);}
function connection(secret){const u=new URL(secret.databaseUrl);assert(u.hostname.endsWith('.neon.tech')&&!u.hostname.includes('-pooler.'),'Direct Neon connection required');u.search='';return {connectionString:u.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:20000,application_name:'cn-local-backup',options:'-c default_transaction_read_only=on -c statement_timeout=300000'};}
function pgEnv(secret){const u=new URL(secret.databaseUrl);return {...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(privateDir,'roots.pem'),PGCONNECT_TIMEOUT:'20',PGAPPNAME:'cn-local-backup',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=300000'};}
function command(name,args,opts={}){const {toolBin=bin,...spawnOpts}=opts;const r=spawnSync(path.join(toolBin,name+'.exe'),args,{windowsHide:true,timeout:300000,maxBuffer:256*1024*1024,...spawnOpts});if(r.error||r.status!==0){const detail=String(r.stderr||'').split(/\r?\n/).filter(x=>/error:|ERROR:|FATAL:/.test(x)).slice(0,2).join(' ').replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted connection]');const e=new Error(name+' failed (exit '+r.status+'): '+detail);e.code=name.toUpperCase()+'_FAILED';throw e;}return r.stdout;}
function recoveryTools(){
 const root=path.join(os.tmpdir(),'cn-capital-recovery');assert(/^[\x20-\x7e]+$/.test(root),'PostgreSQL initdb needs an ASCII temporary path on Windows');fs.mkdirSync(root,{recursive:true});
 const code="$ErrorActionPreference='Stop';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','ContainerInherit,ObjectInherit','None','Allow')));[IO.Directory]::SetAccessControl('"+root.replaceAll("'","''")+"',$acl)";
 const secured=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',code],{encoding:'utf8',windowsHide:true});assert.equal(secured.status,0,'Recovery directory permissions failed');
 const tools=path.join(root,'pgsql-17');if(!fs.existsSync(path.join(tools,'bin/initdb.exe')))fs.cpSync(path.join(home,'tools/pgsql'),tools,{recursive:true});return {root,toolBin:path.join(tools,'bin')};
}
async function freePort(){const server=net.createServer();await new Promise((ok,bad)=>server.listen(0,'127.0.0.1',ok).once('error',bad));const p=server.address().port;await new Promise(ok=>server.close(ok));return p;}
async function restoreDrill(archive,key){
 const value=open(fs.readFileSync(archive),key),dump=Buffer.from(value.dump,'base64');assert.equal(hash(dump),value.manifest.dumpSha256);
 const recovery=recoveryTools(),id=crypto.randomUUID().replaceAll('-',''),run=path.join(recovery.root,'restore-'+id);fs.mkdirSync(run);const cluster=path.join(run,'cluster'),pwfile=path.join(run,'init-password');
 const password=crypto.randomBytes(32).toString('base64url');fs.writeFileSync(pwfile,password,{flag:'wx'});
 const port=await freePort(),database='cn_restore_'+id;restoreBoundary({host:'127.0.0.1',port,database});let server,client;
 try{
  command('initdb',['-D',cluster,'--username=cn_restore','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile='+pwfile],{toolBin:recovery.toolBin});fs.unlinkSync(pwfile);
  server=spawn(path.join(recovery.toolBin,'postgres.exe'),['-D',cluster,'-h','127.0.0.1','-p',String(port),'-c','log_min_messages=panic','-c','log_min_error_statement=panic'],{windowsHide:true,stdio:'ignore'});
  const config={host:'127.0.0.1',port,user:'cn_restore',password,database:'postgres',connectionTimeoutMillis:1000};
  for(let attempt=0;attempt<60;attempt++){const probe=new pg.Client(config);try{await probe.connect();await probe.end();break;}catch{await probe.end().catch(()=>{});if(attempt===59)throw Error('Local restore server startup failed');await new Promise(ok=>setTimeout(ok,250));}}
  client=new pg.Client(config);await client.connect();await client.query('CREATE ROLE cn_backup_monitor NOLOGIN');await client.query('CREATE DATABASE "'+database+'"');await client.end();client=null;
  const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'cn_restore',PGPASSWORD:password,PGDATABASE:database,PGSSLMODE:'disable',PGOPTIONS:''};
  // This database was just created above on the guarded loopback server. The archive
  // recreates public; --clean only removes objects in this disposable destination.
  command('pg_restore',['--exit-on-error','--clean','--if-exists','--no-owner','--no-acl','--single-transaction','-d',database],{env,input:dump,toolBin:recovery.toolBin});
  client=new pg.Client({...config,database});await client.connect();const after=await snapshot(client);assert.deepEqual(after,value.manifest.snapshot,'Restored database does not match the exported snapshot');
  return {passed:true,tables:after.tables.length,rows:after.tables.reduce((a,t)=>a+Number(t.count),0),constraints:after.constraints.length,sequences:after.sequences.length,dumpSha256:hash(dump),archiveSha256:hash(fs.readFileSync(archive)),checkedAt:new Date().toISOString(),target:'new loopback database; removed after comparison'};
 }finally{
  await client?.end().catch(()=>{});
  if(server){try{command('pg_ctl',['-D',cluster,'-m','fast','-w','stop'],{toolBin:recovery.toolBin});}catch{server.kill();}await new Promise(ok=>server.exitCode!==null?ok():server.once('exit',ok));}
  const real=fs.realpathSync(run),parent=fs.realpathSync(recovery.root);assert.equal(path.dirname(real),parent);assert(/^restore-[a-f0-9]+$/.test(path.basename(real)));fs.rmSync(real,{recursive:true});
 }
}
async function backup(secret){
 const client=new pg.Client(connection(secret));await client.connect();let dump,meta;
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const id=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const rls=(await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity")).rows;
  const policies=(await client.query("SELECT tablename,roles::text,permissive,cmd,qual FROM pg_policies WHERE schemaname='public'")).rows;
  for(const t of rls){const relevant=policies.filter(p=>p.tablename===t.relname&&(/cn_backup_monitor|public/.test(p.roles))&&['SELECT','ALL'].includes(p.cmd));assert(relevant.some(p=>p.permissive==='PERMISSIVE'&&p.qual==='true')&&!relevant.some(p=>p.permissive==='RESTRICTIVE'),'Backup SELECT policy requires review: '+t.relname);}
  const snap=await snapshot(client);dump=command('pg_dump',['--format=custom','--no-owner','--no-acl','--enable-row-security','--schema=public','--lock-wait-timeout=10000','--snapshot='+id],{env:pgEnv(secret)});assert(dump.subarray(0,5).equals(Buffer.from('PGDMP')));meta={format:1,project:'bitter-heart-61838251',branch:'br-crimson-morning-b3rhjeoi',snapshotAt:new Date().toISOString(),dumpSha256:hash(dump),dumpBytes:dump.length,snapshot:snap};await client.query('COMMIT');}finally{await client.end();}
 const name='cn-capital-'+new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(3).toString('hex')+'.cnbak',target=path.join(archiveDir,name),key=Buffer.from(secret.backupKey,'base64');
 fs.writeFileSync(target,seal({manifest:meta,dump:dump.toString('base64')},key),{flag:'wx'});
 const verification=await restoreDrill(target,key);const report={file:name,completedAt:new Date().toISOString(),restored:true,encrypted:true,bytes:fs.statSync(target).size,verification};write(path.join(records,name+'.json'),report);write(path.join(records,'latest-backup.json'),report);return report;
}
async function inspect(secret){
 const issues=[],checks=[],unknown=[];
 for(const origin of ['https://nuvexapro.com','https://admin.maacropierce.com']){
  try{const r=await fetch(origin+'/ready',{signal:AbortSignal.timeout(25000),redirect:'error'}),j=await r.json();assert(r.status===200&&j.status==='ready'&&j.database==='connected');checks.push({origin,ready:true});}catch{issues.push({id:'health:'+origin,message:origin+' 站点或数据库健康检查失败'});}
 }
 const client=new pg.Client(connection(secret));
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  const over=(await client.query("SELECT count(*)::int AS count FROM auth_attempts WHERE window_start>now()-interval '15 minutes' AND ((bucket='login:ip' AND count>=50) OR (bucket='admin-login:ip' AND count>=30) OR (bucket='admin-bootstrap:ip' AND count>=5))")).rows[0].count;
  checks.push({recentLoginThresholdBuckets:over});if(over>0)issues.push({id:'security:login-volume',message:'最近 15 分钟有 '+over+' 个登录请求限流窗口达到阈值；需要检查访问情况'});
  const mismatch=(await client.query("SELECT count(*)::int AS count FROM accounts a LEFT JOIN (SELECT account_id,sum(delta_cents) AS total FROM cash_ledger GROUP BY account_id) l ON l.account_id=a.id WHERE a.cash_cents<>COALESCE(l.total,0)")).rows[0].count;
  checks.push({ledgerMismatchAccounts:mismatch});if(mismatch>0)issues.push({id:'accounting:ledger',message:'发现 '+mismatch+' 个有资金流水的账户余额与流水合计不一致',critical:true});
  await client.query('COMMIT');
 }catch{issues.push({id:'database:monitor',message:'数据库只读安全巡检未完成'});unknown.push('accounting:ledger','security:login-volume');}finally{await client.end().catch(()=>{});}
 const latest=latestBackup();
 if(backupDue(latest))issues.push({id:'backup:stale',message:'没有 20 小时内完成且恢复核验通过的本地备份',critical:true});
 return {issues,checks,unknown};
}
async function run(mode){
 const secret=mode==='ack'?null:vault();
 if(mode==='backup'){const result=await backup(secret);console.log(JSON.stringify({backup:result.file,...result.verification,encrypted:true}));return;}
 if(mode==='restore-latest'){const latest=json(path.join(records,'latest-backup.json'));assert.equal(path.basename(latest.file),latest.file);console.log(JSON.stringify(await restoreDrill(path.join(archiveDir,latest.file),Buffer.from(secret.backupKey,'base64'))));return;}
 if(mode==='ack'){
  const [id,receipt]=process.argv.slice(3);assert(/^[a-f0-9-]{36}$/.test(id));assert(receipt&&receipt.length<200);const file=path.join(pendingDir,id+'.json');const event=json(file);write(path.join(sentDir,id+'.json'),{...event,sentAt:new Date().toISOString(),providerReceipt:receipt});fs.unlinkSync(file);console.log(JSON.stringify({acknowledged:id}));return;
 }
 assert(['cycle','monitor','scheduled-backup'].includes(mode),'Use backup, restore-latest, monitor, cycle, scheduled-backup or ack');let backupFailure;
 if(mode==='cycle'||mode==='scheduled-backup'){if(mode==='scheduled-backup'||backupDue(latestBackup()))try{await backup(secret);}catch(e){backupFailure={id:'backup:failed',message:'本地备份或恢复核验失败（'+(e.code||e.name)+'）',critical:true};}}
 const result=await inspect(secret);if(backupFailure)result.issues.push(backupFailure);
 const stateFile=path.join(records,'monitor-state.json');let previous={};try{previous=json(stateFile).active||{};}catch{}
 const lastFailure=previous['backup:failed'],latest=latestBackup();
 if(lastFailure&&(!latest||Date.parse(latest.completedAt)<=Date.parse(lastFailure.firstSeen)))result.unknown.push('backup:failed');
 const at=new Date().toISOString(),next=advanceAlerts(previous,result.issues,at,result.unknown);
 for(const event of next.events){const id=crypto.randomUUID();write(path.join(pendingDir,id+'.json'),{id,to:'dalulu05168@gmail.com',...event});}
 const report={checkedAt:at,active:next.state,checks:result.checks,pending:fs.readdirSync(pendingDir).filter(x=>x.endsWith('.json')).length,backupFailure:!!backupFailure};write(stateFile,report);console.log(JSON.stringify(report));if(backupFailure)process.exitCode=1;
}
const lock=path.join(records,'run.lock');let fd;
async function acquire(mode){for(let attempt=0;attempt<61;attempt++){
 try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));return true;}catch(e){
  if(e.code!=='EEXIST')throw e;let owner,mtime;try{owner=Number(fs.readFileSync(lock,'utf8'));mtime=fs.statSync(lock).mtimeMs;}catch{continue;}
  let alive=false;try{if(owner>0){process.kill(owner,0);alive=true;}}catch{}
  if(!alive&&Date.now()-mtime>1800000){fs.unlinkSync(lock);continue;}
  if(mode==='monitor'){console.log(JSON.stringify({skipped:true,reason:'Another operations run is active'}));return false;}
  assert(attempt<60,'Another operations run remained active for 60 seconds');await new Promise(ok=>setTimeout(ok,1000));
 }
}}
(async()=>{const mode=process.argv[2]||'monitor';if(!await acquire(mode))return;try{await run(mode);}finally{fs.closeSync(fd);fs.unlinkSync(lock);}})().catch(e=>{const failure={checkedAt:new Date().toISOString(),mode:process.argv[2]||'monitor',failed:true,code:e.code||e.name,message:e.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted connection]')};write(path.join(records,'last-run-error.json'),failure);console.error(JSON.stringify(failure));process.exitCode=1});
