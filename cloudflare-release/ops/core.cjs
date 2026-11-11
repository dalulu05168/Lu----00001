const crypto=require('node:crypto'),assert=require('node:assert/strict');
const MAGIC=Buffer.from('CNBK0001');
function seal(value,key){assert.equal(key.length,32);const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(MAGIC);return Buffer.concat([MAGIC,iv,c.update(JSON.stringify(value),'utf8'),c.final(),c.getAuthTag()]);}
function open(bytes,key){assert(bytes.length>36&&bytes.subarray(0,8).equals(MAGIC),'Invalid backup envelope');const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));d.setAAD(MAGIC);d.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([d.update(bytes.subarray(20,-16)),d.final()]).toString('utf8'));}
function restoreBoundary(c){assert.equal(c.host,'127.0.0.1');assert(Number.isInteger(c.port)&&c.port>1024&&c.port!==5432);assert(/^cn_restore_[a-z0-9_]+$/.test(c.database));return true;}
function backupDue(record,now=Date.now()){const at=Date.parse(record?.completedAt);return !Number.isFinite(at)||at>now+60000||now-at>=20*3600000||!record.restored;}
function advanceAlerts(previous,issues,now,unknown=[]){const state={},events=[];for(const id of unknown)if(previous[id])state[id]=previous[id];for(const issue of issues){const old=previous[issue.id],streak=(old?.streak||0)+1;const notified=!!old?.notified||issue.critical||streak>=2;state[issue.id]={message:issue.message,firstSeen:old?.firstSeen||now,lastSeen:now,streak,notified};if(notified&&!old?.notified)events.push({issueId:issue.id,kind:'incident',message:issue.message,firstSeen:state[issue.id].firstSeen,at:now});}for(const [id,old]of Object.entries(previous))if(!state[id]&&old.notified)events.push({issueId:id,kind:'recovery',message:old.message,firstSeen:old.firstSeen,at:now});return {state,events};}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function normalizeConstraint(definition){
 // PostgreSQL may serialize an array-wide varchar[] -> text[] coercion as
 // per-element coercions after pg_dump/restore. Normalize only that exact case.
 return definition.replace(/\(ARRAY\[((?:'(?:[^']|'')*'::character varying(?:, )?)+)\]\)::text\[\]/g,(_,values)=>'ARRAY['+values.replace(/('(?:[^']|'')*'::character varying)/g,'($1)::text')+']');
}
async function snapshot(client){
 await client.query("SET TIME ZONE 'UTC'");
 const schemas=(await client.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname")).rows.map(x=>x.nspname);
 // Stop rather than silently omit a new application schema.
 assert.deepEqual(schemas,['public'],'Additional schemas require an explicit backup scope review');
 const names=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename),tables=[];
 for(const name of names){const identifier='"'+name.replaceAll('"','""')+'"';const r=await client.query("SELECT count(*)::text AS count,encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS sha256 FROM public."+identifier+' t');tables.push({name,...r.rows[0]});}
 const constraints=(await client.query("SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname,definition")).rows.map(c=>({...c,definition:normalizeConstraint(c.definition)}));
 const sequences=(await client.query("SELECT sequencename,last_value::text AS last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
 const policies=(await client.query("SELECT tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
 return {schemas,tables,constraints,sequences,policies};
}
module.exports={seal,open,restoreBoundary,advanceAlerts,backupDue,hash,snapshot,normalizeConstraint};
