import test from "node:test";
import assert from "node:assert/strict";
import {calculateAccountAnalytics,getAccountAnalytics} from "../src/account-analytics.mjs";
const now=new Date('2026-11-04T10:00:00Z');
let sequence=0;
const order=(side,quantity,amount,created='2026-11-04T09:00:00Z',market='US',symbol='AAPL')=>
 ({market,symbol,side,quantity:String(quantity),amount_usd_cents:String(amount),created_at:created,
  ledger_sequence:String(++sequence),ledger_delta_cents:side==='BUY'?'-'+amount:String(amount)});
const held=(quantity,market='US',symbol='AAPL')=>({market,symbol,quantity:String(quantity)});
const calculate=(orders,positions=[],cashCents=1000)=>calculateAccountAnalytics({orders,positions,cashCents,now});

test('FIFO splits multiple lots and preserves exact remaining costs and UTC realized totals',()=>{
 const result=calculate([
  order('BUY',3,1000,'2026-10-30T00:00:00Z'),order('BUY',2,900,'2026-11-01T00:00:00Z'),
  order('SELL',2,800,'2026-11-03T23:59:59Z'),order('SELL',2,1000)
 ],[held(1)]);
 assert.equal(result.historyAvailable,true);assert.equal(result.orderCount,4);
 assert.equal(result.buyVolumeCents,1900);assert.equal(result.sellVolumeCents,1800);
 assert.equal(result.volumeCents,3700);assert.equal(result.realizedPnlCents,350);
 assert.equal(result.dayRealizedPnlCents,216);assert.equal(result.monthRealizedPnlCents,350);
 assert.equal(result.positionCostCents,450);assert.equal(result.portfolioValueCents,null);
 assert.equal(result.reportingTimeZone,'UTC');assert.equal(result.method,'FIFO');
});
test('partial lot cost allocation reconciles to original cents across successive sells',()=>{
 const result=calculate([order('BUY',3,5),order('SELL',1,2),order('SELL',1,2),order('SELL',1,2)]);
 assert.equal(result.realizedPnlCents,1);assert.equal(result.positionCostCents,0);
 assert.equal(result.portfolioValueCents,1000);
});
test('losses and identical tickers in different markets are independent',()=>{
 const result=calculate([order('BUY',1,500),order('BUY',1,700,undefined,'RO'),order('SELL',1,300)], [held(1,'RO')]);
 assert.equal(result.realizedPnlCents,-200);assert.equal(result.positionCostCents,700);
});
test('missing acquisitions and mismatched current positions never fabricate profits',()=>{
 for(const [orders,positions,reason] of [
  [[order('SELL',1,500)],[],'INCOMPLETE_HISTORY'],
  [[order('BUY',2,500)],[held(1)],'POSITION_HISTORY_MISMATCH'],
  [[],[held(1)],'POSITION_HISTORY_MISMATCH']
 ]){
  const result=calculate(orders,positions);assert.equal(result.historyAvailable,false);
  assert.equal(result.reason,reason);assert.equal(result.realizedPnlCents,null);assert.equal(result.positionCostCents,null);
 }
});
test('invalid, unsafe and nonchronological records are explicitly unavailable',()=>{
 for(const orders of [[order('BUY',1,'bad')],[order('BUY',0,100)],
  [order('BUY',1,Number.MAX_SAFE_INTEGER),order('BUY',1,1)],
  [order('BUY',1,100,'invalid')],
  [{...order('BUY',1,100),ledger_sequence:'2'},{...order('BUY',1,100),ledger_sequence:'1'}]]){
  const result=calculate(orders);assert.equal(result.historyAvailable,false);assert.equal(result.realizedPnlCents,null);
 }
});
test('FIFO follows reliable ledger order even when transaction timestamps or UUID order disagree',()=>{
 const result=calculate([
  order('BUY',1,10000,'2026-11-03T00:00:00Z'),
  order('BUY',1,20000,'2026-11-02T00:00:00Z'),order('SELL',1,15000)
 ],[held(1)]);
 assert.equal(result.historyAvailable,true);assert.equal(result.realizedPnlCents,5000);
 assert.equal(result.positionCostCents,20000);assert.equal(result.orderBasis,'CASH_LEDGER_ID');
 for(const incomplete of [
  {...order('BUY',1,100),ledger_sequence:null},
  {...order('BUY',1,100),ledger_delta_cents:'100'}
 ]){
  const rejected=calculate([incomplete],[held(1)]);
  assert.equal(rejected.historyAvailable,false);assert.equal(rejected.reason,'LEDGER_HISTORY_UNAVAILABLE');
 }
});
test('empty histories and complete histories longer than the transaction page remain exact',()=>{
 const empty=calculate([]);assert.equal(empty.realizedPnlCents,0);assert.equal(empty.portfolioValueCents,1000);
 const orders=[order('BUY',120,12000),...Array.from({length:120},()=>order('SELL',1,150))];
 const result=calculate(orders);assert.equal(result.orderCount,121);assert.equal(result.realizedPnlCents,6000);
 assert.equal(result.volumeCents,30000);assert.equal(result.positionCostCents,0);
});
test('analytics reads only the requested account in a read-only consistent transaction and releases on failure',async()=>{
 const calls=[];let released=false;
 const client={query:async(sql,params)=>{calls.push({sql,params});
  if(sql.includes('FROM accounts'))return {rows:[{cash_cents:'1000'}]};
  return {rows:[]};},release(){released=true}};
 const db={connect:async()=>client};
 const result=await getAccountAnalytics(db,'account-A',{now});assert.equal(result.portfolioValueCents,1000);
 assert.match(calls[0].sql,/REPEATABLE READ READ ONLY/);
 for(const call of calls.filter(call=>call.sql.includes('FROM ')))assert.deepEqual(call.params,['account-A']);
 const history=calls.find(call=>call.sql.includes('FROM orders'));assert.match(history.sql,/ORDER BY ledger_sequence ASC/);
 assert.match(history.sql,/LEFT JOIN cash_ledger/);
 assert.doesNotMatch(history.sql,/LIMIT/i);assert.equal(calls.at(-1).sql,'COMMIT');assert.equal(released,true);
 calls.length=0;released=false;client.query=async(sql)=>{calls.push({sql});if(sql.includes('FROM accounts'))throw Error('offline');return {rows:[]}};
 await assert.rejects(getAccountAnalytics(db,'account-A'),/offline/);
 assert.equal(calls.at(-1).sql,'ROLLBACK');assert.equal(released,true);
});
