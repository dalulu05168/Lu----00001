import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseQuote,hashParticipationPassword,checkParticipationPassword} from '../src/internal-products.mjs';
test('discount is an exact reduction of USD unit price and never creates a zero price',()=>{
 assert.deepEqual(purchaseQuote(12345,1000,3),{originalPriceCents:12345,discountBps:1000,unitPriceCents:11111,quantity:3,totalCents:33333});
 assert.equal(purchaseQuote(10000,0,1).totalCents,10000);
 for(const values of [[0,0,1],[100,10000,1],[100,-1,1],[100,1.5,1],[100,0,0],[1,9999,1],[Number.MAX_SAFE_INTEGER,0,2]])assert.throws(()=>purchaseQuote(...values));
});
test('participation passwords preserve leading zeros and never expose a reusable plaintext value',async()=>{
 const hash=await hashParticipationPassword('001234');
 assert.equal(await checkParticipationPassword('001234',hash),true);
 assert.equal(await checkParticipationPassword('123456',hash),false);
 assert.equal(await checkParticipationPassword('1234',hash),false);
 assert.equal(hash.includes('001234'),false);
 await assert.rejects(hashParticipationPassword('12345'));
 await assert.rejects(hashParticipationPassword('abcdef'));
});
