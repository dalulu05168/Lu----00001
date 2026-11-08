import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const STAGE2_SHA=Object.freeze({'前台.html':'f9b38dd10837052bbb00731e9cdd27a2e0d6423cfc9200aafe558e7816bd159a','手机端.html':'07bf03895275a265e86ead549585fd28e7629d8db11253f42ff7bc9afb2d4a81','后台.html':'f4a49976a7ef0358753f20ed87eb26d989c46d6f8c5f40853c95c2924a0b76e0'});
const STAGE3_SHA=Object.freeze({'前台.html':STAGE2_SHA['前台.html'],'手机端.html':'afc62f87ef8a99b634ae6c28ef010af42e02fee9c486582041b5b95e64b79afc','后台.html':'c4a7f0584bb0152c1967a7030a949ed9c44cc00b61247b61b26f46148a6d60e7'});
const stage3=process.argv.includes('--stage3');
const baseline=JSON.parse(readFileSync(join(root,'qa/preservation-baseline.json'),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
for(const [file, old] of Object.entries(baseline)){
 let source=readFileSync(join(root,file),'utf8');
 if(stage3){
  assert.equal(hash(source),STAGE3_SHA[file],file+': stage3 hash unexpectedly changed');
  if(file==='手机端.html'){
   assert.equal(source.split('@media(max-width:599px)').length-1,4,'mobile: expected 4 independent fullscreen rules');
   source=source.replaceAll('@media(max-width:599px)','@media(max-width:420px)');
  }
  if(file==='后台.html'){
   assert.equal(source.split('申请列表<small>共 — 条</small>').length-1,1,'admin: expected one unknown approval count');
   source=source.replace('申请列表<small>共 — 条</small>','申请列表<small>共 4 条</small>');
  }
  assert.equal(hash(source),STAGE2_SHA[file],file+': changes outside allowlisted fullscreen/count fix');
 }
 const markup=source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'<script>[JS]</script>');
 assert.equal(hash(markup),old.markup_without_js_sha256,`${file}: layout/visible markup changed`);
 const styles=[...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>hash(m[1]));
 assert.deepEqual(styles,old.style_blocks_sha256,`${file}: CSS changed`);
 const ids=[...new Set([...markup.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]))].sort();
 assert.deepEqual(ids,old.html_ids,`${file}: modal/form/page id changed`);
 for(const [attr,values] of Object.entries(old.static_events)){
  const actual=[...new Set([...markup.matchAll(new RegExp('\\b'+attr+'=["\\\']([^"\\\']+)["\\\']','g'))].map(m=>m[1]))].sort();
  assert.deepEqual(actual,values,`${file}: ${attr} controls changed`);
 }
 assert.equal([...source.matchAll(/<script\b/gi)].length,old.inline_script_count);
}
console.log('UI_PRESERVATION_OK: '+(stage3?'stage3 allowlisted viewport/count change':'stage2 exact original')+'; three pages, all DOM IDs, controls and CSS preserved except documented changes');
