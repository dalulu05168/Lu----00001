const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {seal,open,restoreBoundary,advanceAlerts,backupDue,normalizeConstraint}=require('./core.cjs');
test('encrypted backup round trip rejects corruption, wrong key and truncation',()=>{
 const key=crypto.randomBytes(32),data={manifest:{tables:[{name:'orders',count:2}]},dump:Buffer.from('PGDMP fixture').toString('base64')};
 const archive=seal(data,key);assert.deepEqual(open(archive,key),data);assert(!archive.includes(Buffer.from('orders')));
 const corrupt=Buffer.from(archive);corrupt[corrupt.length-1]^=1;
 for(const invalid of [corrupt,archive.subarray(0,20)])assert.throws(()=>open(invalid,key));
 assert.throws(()=>open(archive,crypto.randomBytes(32)));
});
test('restore destination permits only a fresh loopback drill name',()=>{
 assert(restoreBoundary({host:'127.0.0.1',port:49512,database:'cn_restore_1234'}));
 for(const target of [{host:'production.neon.tech',port:5432,database:'neondb'},{host:'127.0.0.1',port:5432,database:'neondb'},{host:'localhost.evil',port:49512,database:'cn_restore_1234'}])assert.throws(()=>restoreBoundary(target));
});
test('incidents require two observations, deduplicate, and emit one recovery',()=>{
 let state={};let r=advanceAlerts(state,[{id:'health:main',message:'unavailable'}],'2026-11-11T10:00:00Z');assert.equal(r.events.length,0);state=r.state;
 r=advanceAlerts(state,[{id:'health:main',message:'unavailable'}],'2026-11-11T11:00:00Z');assert.equal(r.events.length,1);assert.equal(r.events[0].kind,'incident');state=r.state;
 r=advanceAlerts(state,[{id:'health:main',message:'unavailable'}],'2026-11-11T12:00:00Z');assert.equal(r.events.length,0);state=r.state;
 r=advanceAlerts(state,[],'2026-11-11T13:00:00Z');assert.equal(r.events[0].kind,'recovery');
 assert.equal(advanceAlerts(r.state,[],'2026-11-11T14:00:00Z').events.length,0);
});
test('critical accounting or backup failure alerts on first observation',()=>{
 const r=advanceAlerts({},[{id:'ledger',message:'mismatch',critical:true}],'2026-11-11T10:00:00Z');assert.equal(r.events.length,1);
});
test('a failed database check must not report accounting recovery',()=>{
 const before=advanceAlerts({},[{id:'accounting:ledger',message:'mismatch',critical:true}],'2026-11-11T10:00:00Z').state;
 const result=advanceAlerts(before,[],'2026-11-11T11:00:00Z',['accounting:ledger']);assert.equal(result.events.length,0);assert.deepEqual(result.state,before);
});
test('backup freshness rejects missing, invalid or future completion timestamps',()=>{
 const now=Date.parse('2026-11-11T10:00:00Z');
 assert(backupDue(null,now));assert(backupDue({completedAt:'invalid'},now));
 assert(backupDue({completedAt:'2026-11-12T10:00:00Z'},now));
 assert(!backupDue({completedAt:'2026-11-11T09:00:00Z',restored:true},now));
 assert(backupDue({completedAt:'2026-11-10T09:00:00Z'},now));
});
test('equivalent varchar-array cast rendering normalizes without hiding changed values',()=>{
 const original="CHECK (((side)::text = ANY ((ARRAY['BUY'::character varying, 'SELL'::character varying])::text[])))";
 const restored="CHECK (((side)::text = ANY (ARRAY[('BUY'::character varying)::text, ('SELL'::character varying)::text])))";
 assert.equal(normalizeConstraint(original),normalizeConstraint(restored));
 assert.notEqual(normalizeConstraint(original),normalizeConstraint(restored.replace("'SELL'","'OTHER'")));
 assert.notEqual(normalizeConstraint('CHECK (quantity > 0)'),normalizeConstraint('CHECK (quantity >= 0)'));
});
