// Standalone fail-closed chart regression. Run on the unzipped Library UI package:
// node qa/issue-42-ui-cleanup/verify-stage2-chart-source.mjs /path/to/unzipped/UI
// No network, credential, application DB, or third-party quote use.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';

const root=process.argv[2];
if(!root)throw new Error('Pass extracted UI ZIP folder path');
const bar=(t,v=0)=>({t,o:101,h:103,l:100,c:102,v});
let checks=0;
for(const page of ['前台.html','手机端.html','后台.html']){
 const html=readFileSync(join(root,page),'utf8');
 assert.doesNotMatch(html,/function bridge\s*\(/,'fabricated intraday price path: '+page);
 assert.doesNotMatch(html,/2026-01-01/,'hard-coded year: '+page);
 const begin=html.indexOf('/* K 线/分时只过滤实际收到的 OHLCV');
 const end=html.indexOf('function vol(v)',begin);
 assert.ok(begin!==-1&&end>begin,'chart source missing: '+page);
 const ctx={DL:[],D:{rg:'All'},ST:{rg:'All'},Date,isFinite};
 vm.createContext(ctx);
 vm.runInContext(html.slice(begin,end),ctx,{filename:page});
 function get(range,records){ctx.DL=records;ctx.D.rg=range;ctx.ST.rg=range;return vm.runInContext('ser()',ctx)}
 assert.equal(get('1D',[]).length,0);checks++;
 const six=[1,2,3,4,5,6].map(n=>bar('2027-01-0'+n));
 assert.equal(get('1D',six).length,1);checks++;
 const five=get('5D',six);
 assert.equal(five.length,5);
 assert.strictEqual(five[0],six[1]);checks++;
 const minute=[bar('2027-01-05T09:30:00Z'),bar('2027-01-06T09:30:00Z'),bar('2027-01-06T09:31:00Z',3)];
 assert.equal(get('1D',minute).length,2);checks++;
 const invalid=get('All',[bar('2027-01-01'),bar('2027-01-02')]);
 assert.ok(invalid.every(x=>x.v===0));checks++;
 const malformed=bar('2027-01-03');malformed.h=50;
 assert.equal(get('All',[malformed]).length,0);checks++;
 assert.equal(get('YTD',[bar('2026-12-31'),bar('2027-01-01')]).length,1);checks++;
}
console.log('STAGE2_UI_CHART_OK '+checks+'/21 (isolation fixtures only)');
