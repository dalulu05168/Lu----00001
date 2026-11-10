const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('../release-manifest.json');
const pages = Object.fromEntries(['desktop','mobile','admin','login'].map(kind => [kind, fs.readFileSync(path.join(root,'web',kind+'.html'),'utf8')]));
const logo = fs.readFileSync(path.join(root,'web','logo.png')).toString('base64');
const source = fs.readFileSync(path.join(root,'src','worker.template.mjs.in'),'utf8')
 .replace('__CN_PAGES__', () => JSON.stringify(pages)).replace('__CN_LOGO__', () => JSON.stringify(logo));
assert(!source.includes('__CN_PAGES__') && !source.includes('__CN_LOGO__'));
const sha256 = createHash('sha256').update(source).digest('hex');
assert.equal(sha256,manifest.sourceSha256,'Source differs from recorded production release');
const dir = path.join(root,'dist');
fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
fs.writeFileSync(path.join(dir,'worker.mjs'),source);
for (const [kind,name] of [['desktop','index'],['mobile','mobile'],['admin','admin'],['login','login']]) fs.writeFileSync(path.join(dir,'assets',name+'.html'),pages[kind]);
fs.copyFileSync(path.join(root,'web','logo.png'),path.join(dir,'assets','logo.png'));
console.log('Built production '+manifest.version+' SHA256 '+sha256);
