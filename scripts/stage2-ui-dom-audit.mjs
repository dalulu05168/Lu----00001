// Audit the exact stage2 Library HTML files. Does not modify any HTML or send requests.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const UI_SHA256=Object.freeze({
 '前台.html':'f9b38dd10837052bbb00731e9cdd27a2e0d6423cfc9200aafe558e7816bd159a',
 '手机端.html':'07bf03895275a265e86ead549585fd28e7629d8db11253f42ff7bc9afb2d4a81',
 '后台.html':'f4a49976a7ef0358753f20ed87eb26d989c46d6f8c5f40853c95c2924a0b76e0'
});
const REQUIRED=Object.freeze({
 '前台.html':{
  ids:['p-trade','p-acct','tb-hold','tb-ord','tb-watch','tb-req','f-dep','f-id','f-bank','f-chat',
    'm-trade','tr-go','cv','cw'],
  hooks:['data-b="cash"','data-b="total"','data-b="cost"','data-b="realized"','data-b="nord"',
    'data-b="nhold"','data-b="nreq"','data-b="acct"','data-b="sync"',
    'function loadData()','function placeOrder()','TRADING_ENABLED=false']},
 '手机端.html':{
  ids:['host','css'],hooks:['attachShadow({mode:',"if(['login','place','cancelo'",
    'data-a="login"','data-a="logout"','data-a="tab"','data-a="place"',
    'data-a="submit"','data-a="send"','data-a="ksub"','data-a="bsub"','data-a="fav"']},
 '后台.html':{
  ids:['p-over','p-cli','p-appr','p-fund','p-cat','m-mir','m-ap','m-det','m-sub',
    'm-sec','m-ed','m-chat','m-subpass','m-sublock','m-com','m-cf'],
  hooks:['data-action="refresh-clients"','data-action="save-bank"','data-mo="m-sub"',
    'data-mo="m-sec"','data-mo="m-com"','data-a="login"','data-a="place"']}
});
const knownSourceRoutes=Object.freeze({
 desktop:['/api/auth/login','/api/account','/api/account/analytics','/api/catalog',
 '/api/stock-quote','/api/orders','/api/watchlist','/api/requests','/api/private-data','/api/support'],
 mobile:['/api/auth/login','/api/account','/api/account/analytics','/api/catalog',
 '/api/stock-quote','/api/orders','/api/watchlist','/api/requests','/api/private-data','/api/support'],
 admin:['/api/admin/login','/api/admin/totp/verify','/api/admin/me','/api/admin/clients',
 '/api/admin/subaccounts','/api/admin/listings','/api/admin/commodities',
 '/api/admin/workflow-requests','/api/admin/support','/api/admin/audit-events']
});
export function inspectStage2Html(filename,bytes){
 if(!REQUIRED[filename])throw Error('Invalid stage2 UI filename');
 const html=bytes.toString('utf8');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const ids=REQUIRED[filename].ids.filter(id=>!(html.includes('id="'+id+'"')||html.includes("id='"+id+"'")));
 const hooks=REQUIRED[filename].hooks.filter(s=>!html.includes(s));
 return {filename,sha,shaVerified:sha===UI_SHA256[filename],missingIds:ids,missingHooks:hooks,
   ready:sha===UI_SHA256[filename]&&ids.length===0&&hooks.length===0};
}
export async function auditStage2Files({root,readBytes=readFile}={}){
 if(typeof root!=='string'||!root)throw new Error('UI directory required');
 const checked=[];
 for(const name of Object.keys(UI_SHA256))checked.push(inspectStage2Html(name,await readBytes(resolve(root,name))));
 return {checked,passed:checked.every(x=>x.ready),baseline:'exact cleaned stage2 HTML',
    endpoints:knownSourceRoutes,uiMounted:false,tradeQAVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 auditStage2Files({root:process.argv[2]}).then(r=>{
  console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;
 }).catch(e=>{console.error(e.message);process.exitCode=1;});
}
