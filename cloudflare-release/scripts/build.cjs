const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('../release-manifest.json');
const pages = Object.fromEntries(['desktop','mobile','admin','login'].map(kind => [kind, fs.readFileSync(path.join(root,'web',kind+'.html'),'utf8')]));
pages.admin=pages.admin.replace('</head>',()=>'<script>'+fs.readFileSync(path.join(root,'web/security-ui.js'),'utf8')+'</script></head>');
const newsUI=fs.readFileSync(path.join(root,'web','news-ui.js'),'utf8');
for(const name of ['desktop','mobile','admin'])pages[name]=pages[name].replace('</head>',()=>'<script>'+newsUI+'</script></head>');
const refinements=fs.readFileSync(path.join(root,'web','ui-refinements.css'),'utf8');
for(const name of ['desktop','admin','login'])pages[name]=pages[name].replace('</head>',()=>'<style>'+refinements+'</style></head>');
const designSystem='<style id="cn-design-system">'+fs.readFileSync(path.join(root,'web','design-system.css'),'utf8')+'</style>';
// The shared design system applies to every page, as in production 08bbfd25 (Issue #57). 860bea19 had lost it
// on the customer desktop page and the mobile document (and so the admin mirror); see releases/860bea19/README.md.
const designSystemPages=['desktop','admin','login'],designSystemInMobile=true;
for(const name of designSystemPages)pages[name]=pages[name].replace('</head>',()=>designSystem+'</head>');
const productUI=fs.readFileSync(path.join(root,'web/products-ui.js'),'utf8');
for(const name of ['desktop','mobile','admin'])pages[name]=pages[name].replace(/<\/body>/i,()=>'<script>'+productUI+'</script></body>');
const mirrorPage=require('./mobile-bundle.cjs')(path.resolve(root,'../mobile-client'),{production:true}).replace('</head>',()=>'<script>'+newsUI+'</script>'+(designSystemInMobile?designSystem:'')+'</head>');
const browserTransport=fs.readFileSync(path.join(root,'web/session-transport.js'),'utf8');
function browserSessionPage(html,admin){return html.replace(/<head>/i,()=>'<head><script>'+browserTransport.replace('__CN_BROWSER_ADMIN__',String(admin))+'</script>');}
for(const kind of ['desktop','login','admin'])pages[kind]=browserSessionPage(pages[kind],kind==='admin'||kind==='login');
// Admin presentation layer (hidden scrollbars, uniform weight) goes first in <head>, as published in 860bea19.
pages.admin=pages.admin.replace(/<head[^>]*>/i,head=>head+'<style>'+fs.readFileSync(path.join(root,'web','admin-presentation.css'),'utf8')+'</style>');
// Phone-mirror viewport rules are the last style in the admin <head>, as published in 860bea19.
pages.admin=pages.admin.replace('</head>',()=>'<style id="cn-mirror-viewport">'+fs.readFileSync(path.join(root,'web','mirror-viewport.css'),'utf8')+'</style></head>');
pages.login=pages.login.replace("const scope=true?'admin':'client';","const scope=location.hostname==='admin.maacropierce.com'||new URLSearchParams(location.search).has('admin')?'admin':'client';");
pages.mobile=browserSessionPage(mirrorPage,false);
assert(/const MIRROR_TEMPLATE\s*=\s*[^\r\n]+;/.test(pages.admin),'Mirror template missing');
pages.admin=pages.admin.replace(/const MIRROR_TEMPLATE\s*=\s*[^\r\n]+;/,()=> 'const MIRROR_TEMPLATE = '+JSON.stringify(mirrorPage).replace(/</g,'\\u003c')+';');
pages.adminNext=fs.readFileSync(path.join(root,'web','admin-next.html'),'utf8')
 .replace('<!--ADMIN_NEXT_STYLE-->',()=>'<style>'+fs.readFileSync(path.join(root,'web','admin-next.css'),'utf8')+'</style>')
 .replace('<!--ADMIN_NEXT_AUTH-->',()=>'<script>'+browserTransport.replace('__CN_BROWSER_ADMIN__','true')+'</script><script>'+fs.readFileSync(path.join(root,'web/security-ui.js'),'utf8')+'</script>')
 .replace('<!--ADMIN_NEXT_APP-->',()=>'<script>'+fs.readFileSync(path.join(root,'web/admin-next.js'),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
const logo = fs.readFileSync(path.join(root,'web','logo.png')).toString('base64');
const source = fs.readFileSync(path.join(root,'src','worker.template.mjs.in'),'utf8')
 .replace('__CN_NEWS__', () => fs.readFileSync(path.join(root,'src','news-service.mjs'),'utf8').replace('export function ', 'function '))
 .replace('__CN_BROWSER_SESSIONS__', () => fs.readFileSync(path.join(root,'src/browser-sessions.js'),'utf8')).replace('__CN_SECURITY__', () => fs.readFileSync(path.join(root,'src/security.js'),'utf8')).replace('__CN_PRODUCTS__', () => fs.readFileSync(path.join(root,'src/products/service.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/products/quote.js'),'utf8')).replace('__CN_PAGES__', () => JSON.stringify(pages)).replace('__CN_LOGO__', () => JSON.stringify(logo));
assert(!source.includes('__CN_PAGES__') && !source.includes('__CN_LOGO__'));
const sha256 = createHash('sha256').update(source).digest('hex');
const candidate = require('../docs/release-review-58/artifact-manifest.json');
const development=process.argv.includes('--development');
assert(!(development&&process.argv.includes('--record')),'Development builds cannot update the release manifest');
assert(!process.argv.includes('--record'),'Historical production manifest is immutable; use a separate candidate lock');
if(!development) assert.equal(sha256,candidate.files['worker.mjs'],'Source differs from accepted release candidate');
const dir = path.join(root,development?'dist-dev':'dist');
fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
fs.writeFileSync(path.join(dir,'worker.mjs'),source);
for (const [kind,name] of [['desktop','index'],['mobile','mobile'],['admin','admin'],['login','login'],['adminNext','admin-next']]) fs.writeFileSync(path.join(dir,'assets',name+'.html'),pages[kind]);
fs.copyFileSync(path.join(root,'web','logo.png'),path.join(dir,'assets','logo.png'));
console.log(development?'Built development candidate SHA256 '+sha256:'Built accepted release candidate SHA256 '+sha256);




