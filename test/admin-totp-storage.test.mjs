import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {adminTotpKey,sealTotpSecret,openTotpSecret} from '../src/admin-totp-storage.mjs';
test('admin TOTP secrets need their own key, authenticate to the owning user, and reject modified ciphertext',()=>{
 assert.throws(()=>adminTotpKey(undefined));assert.throws(()=>adminTotpKey('short'));
 const key=adminTotpKey(randomBytes(32).toString('hex'));
 assert.deepEqual(adminTotpKey(key.toString('base64')),key);
 const secret=randomBytes(20),userId='synthetic-admin-user';
 const encrypted=sealTotpSecret(secret,key,userId);
 assert.equal(encrypted.includes(secret.toString('base64')),false);
 assert.deepEqual(openTotpSecret(encrypted,key,userId),secret);
 assert.throws(()=>openTotpSecret(encrypted,key,'other-user'));
 assert.throws(()=>openTotpSecret(encrypted,randomBytes(32),userId));
 const chunks=encrypted.split('.');chunks[2]=Buffer.alloc(16).toString('base64');
 assert.throws(()=>openTotpSecret(chunks.join('.'),key,userId));
 assert.throws(()=>openTotpSecret('not-the-right-shape',key,userId));
});
