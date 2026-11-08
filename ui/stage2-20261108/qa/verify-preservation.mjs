import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const baseline=JSON.parse(readFileSync(join(root,'qa/preservation-baseline.json'),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
for(const [file, old] of Object.entries(baseline)){
 const source=readFileSync(join(root,file),'utf8');
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
console.log('UI_PRESERVATION_OK: exact non-JS markup + CSS + IDs + static event controls retained for all 3 pages');
