import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {privateDataKey,sealPrivateData,openPrivateData,validateBankDetails,validateIdentityImages} from '../src/private-customer-data.mjs';
test('private data needs its own key, authenticates context and rejects modified ciphertext',()=>{
 assert.throws(()=>privateDataKey(undefined));assert.throws(()=>privateDataKey('short'));
 const key=privateDataKey(randomBytes(32).toString('hex')),context='KYC:synthetic-user:synthetic-request';
 assert.deepEqual(privateDataKey(key.toString('base64')),key);
 const encrypted=sealPrivateData({synthetic:'example'},key,context);
 assert.equal(encrypted.includes('example'),false);
 assert.deepEqual(openPrivateData(encrypted,key,context),{synthetic:'example'});
 assert.throws(()=>openPrivateData(encrypted,key,context+'other'));
 assert.throws(()=>openPrivateData(encrypted,randomBytes(32),context));
 const chunks=encrypted.split('.');chunks[2]=Buffer.alloc(16).toString('base64');
 assert.throws(()=>openPrivateData(chunks.join('.'),key,context));
});
test('bank submissions normalize account separators and reject password or extra fields',()=>{
 assert.deepEqual(validateBankDetails({bankName:' Example Bank ',accountNumber:'1234 5678-9012'}),{bankName:'Example Bank',accountNumber:'123456789012'});
 assert.throws(()=>validateBankDetails({bankName:'Bank',accountNumber:'12345'}));
 assert.throws(()=>validateBankDetails({bankName:'Bank',accountNumber:'123456789012',password:'not-collected'}));
});
test('identity submissions require two bounded raster images rather than arbitrary data URLs',()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const image={mime:'image/png',base64:png};
 assert.equal(validateIdentityImages({front:image,back:image}).front.mime,'image/png');
 assert.throws(()=>validateIdentityImages({front:image}));
 assert.throws(()=>validateIdentityImages({front:{mime:'image/svg+xml',base64:Buffer.from('<svg/>').toString('base64')},back:image}));
 assert.throws(()=>validateIdentityImages({front:{mime:'image/png',base64:'a'.repeat(3*1024*1024)},back:image}));
});
