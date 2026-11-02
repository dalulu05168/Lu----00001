import test from "node:test";
import assert from "node:assert/strict";
import {hashPassword,verifyPassword,generateSessionToken,sessionTokenHash,createSessionResolver,revokeSession} from "../src/auth.mjs";
test("password hash verifies correct secret and rejects incorrect secret",async()=>{
 const hashed=await hashPassword("this is a secure password");
 assert.equal(await verifyPassword("this is a secure password",hashed),true);
 assert.equal(await verifyPassword("wrong password",hashed),false);
 assert.equal(hashed.includes("this is a secure password"),false);
});
test("password hashing rejects short passwords",async()=>{
 await assert.rejects(hashPassword("short"),/Invalid password/);
});
test("session tokens are random and hashed before storage",()=>{
 const a=generateSessionToken(),b=generateSessionToken();
 assert.notEqual(a,b);assert.equal(sessionTokenHash(a).length,64);assert.notEqual(sessionTokenHash(a),a);
});
test("session resolver reads only authenticated account from database",async()=>{
 const calls=[];
 const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{account_id:"account-1",user_id:"user-1"}]};}};
 const resolver=createSessionResolver(db);
 const token=generateSessionToken();
 assert.deepEqual(await resolver(token),{accountId:"account-1",userId:"user-1",adminVerified:false});
 assert.equal(calls[0].params[0],sessionTokenHash(token));
 assert.match(calls[0].sql,/revoked_at IS NULL/);
});
test("invalid session token is rejected before querying database",async()=>{
 const resolver=createSessionResolver({query:async()=>{throw new Error("must not query");}});
 assert.equal(await resolver("invalid"),null);
});
test("session revocation hashes token",async()=>{
 const calls=[];const db={query:async(...args)=>{calls.push(args);return {rows:[]};}};
 const token=generateSessionToken();await revokeSession(db,token);
 assert.equal(calls[0][1][0],sessionTokenHash(token));
});
