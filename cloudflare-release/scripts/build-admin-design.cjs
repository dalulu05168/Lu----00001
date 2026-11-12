
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const previous = path.resolve(root, process.argv[2]);
const publication = JSON.parse(fs.readFileSync(path.join(previous, 'publication.json'), 'utf8'));
const baseline = fs.readFileSync(path.join(previous, 'worker.mjs'), 'utf8');
const hash = data => createHash('sha256').update(data).digest('hex');
assert(publication.verifiedAt && !publication.rolledBackAt);
assert.equal(hash(baseline), publication.sha256);

const web = name => fs.readFileSync(path.join(root,'web',name), 'utf8');
const tags = new Map([
  ['<!--ADMIN_NEXT_STYLE-->', '<style>' + web('admin-next.css') + '</style>'],
  ['<!--ADMIN_NEXT_AUTH-->', '<script>' + web('session-transport.js').replace('__CN_BROWSER_ADMIN__','true') + '</script><script>' + web('security-ui.js') + '</script>'],
  ['<!--ADMIN_NEXT_APP-->', '<script>' + web('admin-next.js').replace(/<\/script/gi,'<\\/script') + '</script>'],
]);
let next = web('admin-next.html');
for (const [marker,content] of tags) {
  assert.equal(next.split(marker).length,2,marker);
  next = next.replace(marker, () => content);
}
const embedded = /^const replacementPages = (.+);$/m;
const pages = JSON.parse(baseline.match(embedded)[1]);
assert.notEqual(next, pages.adminNext);
const style = '<style>@layer adminPresentation { html, *, *::before, *::after { scrollbar-width:none !important; font-weight:400 !important; } *::-webkit-scrollbar { display:none; } }</style>';
const mirror = /^\s*const MIRROR_TEMPLATE\s*=.*;$/m;
const viewportStyle='<style id="cn-mirror-viewport">'+web('mirror-viewport.css')+'</style>';
let admin = pages.admin.includes(style) ? pages.admin : pages.admin.replace(/<head[^>]*>/i, head => head + style);
const readyMarker = "    const seenKey='cncap.support.seen:'+me.userId;";
const mirrorBridge = "    window.CNAdminMirror=Object.freeze({open:email=>openClient(email,true)});\n";
if(admin.includes('<style id="cn-mirror-viewport">'))admin=admin.replace(/<style id="cn-mirror-viewport">[\s\S]*?<\/style>/,()=>viewportStyle);
else admin=admin.replace('</head>',()=>viewportStyle+'</head>');
assert.equal(admin.split(readyMarker).length,2,'Original mirror initialization hook');
if(!admin.includes(mirrorBridge))admin=admin.replace(readyMarker,()=>mirrorBridge+readyMarker);
assert(admin.match(mirror) && admin.match(mirror)[0] === pages.admin.match(mirror)[0], 'App mirror document changed');
const source = baseline.replace(embedded, () => 'const replacementPages = ' + JSON.stringify({...pages,admin,adminNext:next}) + ';');
assert.equal(source.replace(embedded,''),baseline.replace(embedded,''));
const directory = fs.mkdtempSync(path.join(root,'artifacts/admin-design-'));
const relative = path.relative(root,directory).replaceAll(path.sep,'/');
fs.writeFileSync(path.join(directory,'worker.mjs'),source);
const manifest = {kind:'UNPUBLISHED_DEVELOPMENT_CANDIDATE',scope:'ADMIN_ONLY',liveVersion:publication.version,liveSourceSha256:publication.sha256,sha256:hash(source)};
fs.writeFileSync(path.join(directory,'candidate.json'),JSON.stringify(manifest,null,2));
const runner = fs.readFileSync(path.join(root,'scripts/test-trade-candidate.cjs'),'utf8')
  .replace("path.resolve(__dirname,'..')","path.resolve(__dirname,'../..')")
  .replaceAll('artifacts/trade-candidate/',relative+'/')
  .replace('env.NODE_OPTIONS=',"env.CN_QA_ADMIN_DEFAULT='1';env.NODE_OPTIONS=");
fs.writeFileSync(path.join(directory,'verify.cjs'),runner);
console.log(relative);
console.log(manifest.sha256);

