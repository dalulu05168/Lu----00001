import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buyInternalProduct} from '../src/internal-purchases.mjs';
import {hashParticipationPassword} from '../src/internal-products.mjs';
test('internal purchase uses server discount, posts cash, position and unique ledger atomically',async()=>{
 const termsId=randomUUID(),accountId=randomUUID(),hash=await hashParticipationPassword('001234'),calls=[];
 const db={connect:async()=>({release(){},async query(sql,p=[]){
  calls.push({sql,p});
  if(sql.startsWith('SELECT cash_cents'))return {rows:[{cash_cents:'100000'}]};
  if(sql.includes('SELECT t.*'))return {rows:[{id:termsId,price_cents:'10000',discount_bps:1000,version:2,trading_enabled:true,
   commodity_id:randomUUID(),participation_password_hash:hash,product_status:'PUBLISHED',minimum_quantity:1}]};
  if(sql.startsWith('SELECT * FROM commodity_products'))return {rows:[{status:'PUBLISHED',name:'Synthetic',sku:'TEST'}]};
  if(sql.startsWith('SELECT * FROM internal_product_terms'))return {rows:[{price_cents:'10000',discount_bps:1000,version:2,trading_enabled:true,participation_password_hash:hash}]};
  if(sql.startsWith('INSERT INTO internal_purchases'))return {rows:[{id:p[0],total_cents:String(p[8])}]};
  return {rows:[]};
 }})};
 const result=await buyInternalProduct(db,accountId,'synthetic-key-123',{termsId,quantity:2,termsVersion:2,participationPassword:'001234'});
 assert.equal(result.replayed,false);
 assert.equal(calls.find(x=>x.sql.startsWith('UPDATE accounts')).p[1],'82000');
 assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO internal_product_positions')));
 assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO cash_ledger')&&x.sql.includes('internal_purchase_id')));
 assert.equal(calls.at(-1).sql,'COMMIT');
});
