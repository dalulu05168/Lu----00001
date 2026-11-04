import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('reference FX displays date and stale status and clears rates on failure',async()=>{
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'https://local.invalid/'});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 let fail=false;const flush=async()=>{for(let n=0;n<20;n++)await new Promise(r=>setImmediate(r));};
 Object.assign(globalThis,{document:dom.window.document,sessionStorage:dom.window.sessionStorage,fetch:async(url)=>new Response(JSON.stringify(url==='/api/reference-fx'?(fail?{}:{source:'ECB',base:'USD',date:'2026-11-03',status:'stale',rates:{USD:1,HKD:8,CNY:7,MYR:4}}):{items:[]}),{status:url==='/api/reference-fx'&&fail?503:200})});
 const el=id=>dom.window.document.getElementById(id);
 try{
  await import('../web/app.mjs?reference-fx-ui');await flush();
  assert.match(el('referenceFxStatus').textContent,/2026-11-03.*旧数据/);
  assert.match(el('referenceFxRates').textContent,/8.0000 HKD/);
  fail=true;el('refreshReferenceFx').click();await flush();
  assert.match(el('referenceFxStatus').textContent,/暂不可用/);assert.equal(el('referenceFxRates').textContent,'');assert.equal(el('refreshReferenceFx').disabled,false);
 }finally{Object.assign(globalThis,old);dom.window.close();}
});
