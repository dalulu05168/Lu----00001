'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),previous=path.resolve(root,process.argv[2]||'artifacts/unified-ui-release-1RWOVS');
const publication=JSON.parse(fs.readFileSync(path.join(previous,'publication.json'))),baseline=fs.readFileSync(path.join(previous,'worker.mjs'),'utf8');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');assert(publication.verifiedAt&&!publication.rolledBackAt);assert.equal(hash(baseline),publication.sha256);
const script=fs.readFileSync(path.join(root,'scripts/build.cjs'),'utf8'),boundary=script.indexOf('const sha256 =');assert(boundary>0);
const context={__dirname:path.join(root,'scripts'),require(name){if(name==='node:fs')return {readFileSync:fs.readFileSync};if(name==='../release-manifest.json')return JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json')));if(name==='./mobile-bundle.cjs')return require(path.join(root,'scripts/mobile-bundle.cjs'));if(['node:path','node:assert/strict','node:crypto'].includes(name))return require(name);throw Error('Unexpected dependency');}};
vm.runInNewContext(script.slice(0,boundary)+'\nglobalThis.clientPages=pages;',context,{timeout:10000});
const line=/^const replacementPages = (.+);$/m,old=JSON.parse(baseline.match(line)[1]),next=context.clientPages;
// Only customer pages and the existing delegated mobile document change. Backend and admin workspace remain identical.
const mobile=require('./mobile-bundle.cjs')(path.resolve(root,'../mobile-client'),{production:true}).replace('</head>',()=>'<script>'+fs.readFileSync(path.join(root,'web/news-ui.js'),'utf8')+'</script></head>');
const admin=old.admin.replace(/const MIRROR_TEMPLATE\s*=\s*[^\r\n]+;/,()=> 'const MIRROR_TEMPLATE = '+JSON.stringify(mobile).replace(/</g,'\\u003c')+';');assert.notEqual(admin,old.admin);
const source=baseline.replace(line,()=> 'const replacementPages = '+JSON.stringify({...old,desktop:next.desktop,mobile:next.mobile,admin})+';');
assert.equal(source.replace(line,''),baseline.replace(line,''));assert.equal(JSON.parse(source.match(line)[1]).adminNext,old.adminNext);
const dir=fs.mkdtempSync(path.join(root,'artifacts/frontend-sync-'));fs.writeFileSync(path.join(dir,'worker.mjs'),source);
fs.writeFileSync(path.join(dir,'candidate.json'),JSON.stringify({kind:'UNPUBLISHED_DEVELOPMENT_CANDIDATE',scope:'FRONTEND_AND_MIRROR_ONLY',liveVersion:publication.version,liveSourceSha256:publication.sha256,sha256:hash(source),backendUnchanged:true,adminWorkspaceUnchanged:true},null,2));
let verify=fs.readFileSync(path.join(previous,'verify-comprehensive.cjs'),'utf8').replaceAll('artifacts/admin-design-D2f2Bk/',path.relative(root,dir).replaceAll(path.sep,'/')+'/').replace('const suites={\\\"admin-account-layout', 'const suites={\\\"frontend-sync\\\":[\\\"frontend-sync.cjs\\\",8927],\\\"admin-account-layout');
fs.writeFileSync(path.join(dir,'verify.cjs'),verify);console.log(path.relative(root,dir));console.log(hash(source));
