// Development-only candidate compiler. Does not change production dist or release manifest.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'artifacts','trade-candidate');fs.mkdirSync(dir,{recursive:true});
const script=fs.readFileSync(path.join(root,'scripts/build.cjs'),'utf8');
const boundary=script.indexOf('const sha256 =');if(boundary<0)throw Error('Unknown build layout');
const readOnlyFs={readFileSync:fs.readFileSync};
const context={__dirname:path.join(root,'scripts'),require(name){if(name==='node:fs')return readOnlyFs;if(name==='../release-manifest.json')return JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json')));if(name==='./mobile-bundle.cjs')return require(path.join(root,'scripts/mobile-bundle.cjs'));if(['node:path','node:assert/strict','node:crypto'].includes(name))return require(name);throw Error('Unexpected dependency');}};
vm.runInNewContext(script.slice(0,boundary)+'\nglobalThis.candidate=source;',context,{timeout:10000});
const sha=crypto.createHash('sha256').update(context.candidate).digest('hex');fs.writeFileSync(path.join(dir,'worker.mjs'),context.candidate);fs.writeFileSync(path.join(dir,'candidate.json'),JSON.stringify({kind:'UNPUBLISHED_DEVELOPMENT_CANDIDATE',sha256:sha,baseline:require('../release-manifest.json').sourceSha256},null,2));console.log('Unpublished candidate SHA256 '+sha);
