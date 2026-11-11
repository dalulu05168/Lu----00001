import {backgroundRefreshSafe} from './experience.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedName,notificationTarget,notificationTitle,readIds,chartSymbol,createExperience} from './experience.mjs';
import {ipoCostCents,units,createIpo} from './ipo.mjs';
test('only approved identity can name the customer',()=>{
 assert.equal(verifiedName([{kind:'BANK',status:'APPROVED',verifiedName:'错误来源'},{kind:'IDENTITY',status:'PENDING',verifiedName:'未审核'}]),'');
 assert.equal(verifiedName([{kind:'IDENTITY',status:'APPROVED',verifiedName:' 陈测试 '}]),'陈测试');
});
test('notification read markers remain scoped per customer and recover bad storage',()=>{
 const storage={getItem:k=>k==='cn.notify.read.client1'?'["message1"]':'[]'};
 assert.ok(readIds(storage,'client1').has('message1'));assert.ok(!readIds(storage,'client2').has('message1'));
 assert.equal(readIds({getItem:()=>'{invalid'},'x').size,0);
 assert.equal(notificationTarget({category:'PRODUCT',kind:'IPO'}),'ipo');assert.equal(notificationTarget({category:'SUPPORT'}),'support');
});
test('notification titles reflect business kind without fabricating missing status',()=>{
 assert.equal(notificationTitle({category:'SUPPORT',status:null}),'客服回复');
 assert.equal(notificationTitle({category:'DOCUMENT',kind:'IDENTITY',status:'APPROVED'}),'身份认证 · 审核通过');
 assert.equal(notificationTitle({category:'DOCUMENT',kind:'BANK',status:'REJECTED'}),'银行卡 · 审核未通过');
 assert.equal(notificationTitle({category:'CASH',kind:'DEPOSIT',status:'PENDING'}),'充值申请 · 待审核');
 assert.equal(notificationTitle({category:'CASH',status:null}),'资金申请');
});
test('chart selects exact instruments and never falls back to unrelated overview',()=>{
 assert.equal(chartSymbol({market:'US',symbol:'AAPL'}),'NASDAQ:AAPL');
 assert.equal(chartSymbol({market:'HK',symbol:'00700'}),'HKEX:700');
 assert.equal(chartSymbol({market:'CN',symbol:'600519'}),'SSE:600519');
 assert.equal(chartSymbol({market:'MY',symbol:'1155'}),'MYX:1155');
 assert.equal(chartSymbol({market:'XX',symbol:'ANY'}),null);assert.equal(chartSymbol({market:'US',symbol:'<script>'}),null);
});
test('IPO price and quantity use backend micro units with ceiling cents',()=>{
 assert.equal(ipoCostCents('1234567','3'),371n);assert.equal(ipoCostCents('1000000','100'),10000n);
 for(const q of ['0','01','1.5','1e3','999999999999999'])assert.throws(()=>ipoCostCents('1000000',q));
 assert.equal(units('1234500'),'1.2345');assert.equal(units('2000000'),'2');
});
test('notification polling skips hidden pages and updates badge without repainting forms',async()=>{
 const originals={window:globalThis.window,document:globalThis.document};
 let label='',dot=false,calls=0,renders=0;
 const button={setAttribute(k,v){if(k==='aria-label')label=v;},querySelector(){return dot?{remove(){dot=false;}}:null;},append(){dot=true;}};
 const doc={hidden:true,addEventListener(){},querySelector:()=>button,createElement:()=>({setAttribute(){}})};
 globalThis.document=doc;globalThis.window={addEventListener(){}};
 const state={authenticated:true,epoch:1,page:'support',notifications:[],notificationScope:'',busy:false};
 const c=createExperience({api:{request:async()=>{calls++;return {scope:'client',items:[{id:'new1',category:'SUPPORT'}]};}},state,business:{setNotifications(){},navigationSnapshot:()=>null},render(){renders++;},reset(){},onRestore:async()=>{},storage:{getItem:()=>null}});
 try{await c.poll();assert.equal(calls,0);doc.hidden=false;await c.poll();assert.equal(calls,1);assert.ok(label.includes('1条未读'));assert.ok(dot);assert.equal(renders,0);}finally{c.stop();globalThis.window=originals.window;globalThis.document=originals.document;}
});
test('expired catalog must not hide historical IPO orders',async()=>{
 const original=globalThis.window;globalThis.window={scrollTo(){}};
 try{
  const state={epoch:1,page:'ipo-records',busy:false};
  const ipo=createIpo({api:{request:async()=>({catalog:[],orders:[{kind:'IPO',symbol:'PASTIPO',product_id:'no-longer-listed',status:'SETTLED',requested_quantity_micros:'2000000',requested_amount_cents:'2500'},{kind:'MUTUAL_FUND',symbol:'FUND_ONLY'}],positions:[]})},state,esc:String,display:String,time:String,render(){},refresh:async()=>{},reset(){},back:()=>'',friendly:e=>e.message});
  await ipo.enter('ipo-records');const html=ipo.view('ipo-records');assert.ok(html.includes('PASTIPO'));assert.ok(!html.includes('FUND_ONLY'));assert.ok(!html.includes('暂无申购记录'));
 }finally{globalThis.window=original;}
});

test('background refresh never redraws editing or confirmation screens',()=>{
 const state={authenticated:true,busy:false,loading:false,page:'support'};
 const doc={hidden:false,activeElement:null,querySelectorAll:()=>[]};
 assert.equal(backgroundRefreshSafe(state,doc),true);
 for(const tagName of ['INPUT','SELECT','TEXTAREA']){doc.activeElement={tagName};assert.equal(backgroundRefreshSafe(state,doc),false);}
 doc.activeElement=null;doc.querySelectorAll=()=>[{type:'text',value:'unsent draft'}];assert.equal(backgroundRefreshSafe(state,doc),false);
 doc.querySelectorAll=()=>[{type:'file',files:[{}]}];assert.equal(backgroundRefreshSafe(state,doc),false);
 doc.querySelectorAll=()=>[];
 for(const page of ['fund-confirm','bulk-order','ipo-detail','identity','bank','pin','funding'])assert.equal(backgroundRefreshSafe({...state,page},doc),false);
 for(const patch of [{busy:true},{loading:true},{authenticated:false}])assert.equal(backgroundRefreshSafe({...state,...patch},doc),false);
 doc.hidden=true;assert.equal(backgroundRefreshSafe(state,doc),false);
});
test('focus and online polling serialize background refresh and skip hidden state',async()=>{
 const originals={window:globalThis.window,document:globalThis.document};let release,calls=0,background=0;const events={};
 globalThis.window={addEventListener(n,f){events[n]=f;}};
 globalThis.document={hidden:false,addEventListener(){},querySelector:()=>null};
 const state={authenticated:true,epoch:1,page:'support',busy:false,notifications:[]};
 const c=createExperience({api:{request:async()=>{calls++;await new Promise(r=>release=r);return {scope:'x',items:[]};}},state,business:{setNotifications(){}},render(){},reset(){},onRestore:async()=>{},onBackground:async()=>{background++;},storage:{getItem:()=>null}});
 try{
  events.focus();events.online();assert.equal(calls,1);release();await new Promise(r=>setTimeout(r,0));assert.equal(background,1);
  globalThis.document.hidden=true;events.online();assert.equal(calls,1);
 }finally{c.stop();globalThis.window=originals.window;globalThis.document=originals.document;}
});
