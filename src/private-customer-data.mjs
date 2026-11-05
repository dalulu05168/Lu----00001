import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function privateDataKey(value=process.env.CUSTOMER_DATA_KEY){
 if(typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value))return Buffer.from(value,'hex');
 if(typeof value==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(value))return Buffer.from(value,'base64');
 throw fail('Private data storage is not configured',503);
}
export function sealPrivateData(payload,key,context){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));
 const bytes=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join('.');
}
export function openPrivateData(value,key,context){
 const parts=typeof value==='string'?value.split('.'):[];
 if(parts.length!==4||parts[0]!=='v1')throw fail('Private data cannot be opened',503);
 const iv=Buffer.from(parts[1],'base64'),tag=Buffer.from(parts[2],'base64');
 if(iv.length!==12||tag.length!==16)throw fail('Private data cannot be opened',503);
 const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);cipher.setAAD(Buffer.from(context));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(parts[3],'base64')),cipher.final()]).toString('utf8'));
}
function exact(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw fail('Invalid private submission');
}
export function validateBankDetails(body){
 exact(body,['bankName','accountNumber']);
 if(typeof body.bankName!=='string'||body.bankName.trim().length<2||body.bankName.length>80||typeof body.accountNumber!=='string'||body.accountNumber.length>80||!/^[0-9 -]+$/.test(body.accountNumber))throw fail('Invalid bank details');
 const accountNumber=body.accountNumber.replace(/[ -]/g,'');
 if(!/^\d{6,34}$/.test(accountNumber))throw fail('Invalid bank account number');
 return {bankName:body.bankName.trim(),accountNumber};
}
function validateImage(image){
 exact(image,['mime','base64']);
 if(!['image/png','image/jpeg'].includes(image.mime)||typeof image.base64!=='string'||image.base64.length>2796204||image.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64))throw fail('Use a PNG or JPEG up to 2 MiB');
 const data=Buffer.from(image.base64,'base64');let width=0,height=0;
 if(data.toString('base64')!==image.base64)throw fail('Invalid image encoding');
 if(data.length>2*1024*1024||data.length<24)throw fail('Invalid image size');
 if(image.mime==='image/png'){
  if(data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.subarray(12,16).toString()!=='IHDR'||data.subarray(-8,-4).toString()!=='IEND')throw fail('Invalid PNG image');
  width=data.readUInt32BE(16);height=data.readUInt32BE(20);
 }else{
  if(data[0]!==255||data[1]!==216||data.at(-2)!==255||data.at(-1)!==217)throw fail('Invalid JPEG image');
  let i=2;
  while(i+4<data.length){
   if(data[i++]!==255)throw fail('Invalid JPEG image');
   while(data[i]===255)i++;const marker=data[i++];
   if(i+2>data.length)throw fail('Invalid JPEG image');
   if(marker===0xda||marker===0xd9)break;
   const length=data.readUInt16BE(i);if(length<2||i+length>data.length)throw fail('Invalid JPEG image');
   if([0xc0,0xc1,0xc2].includes(marker)&&length>=8){height=data.readUInt16BE(i+3);width=data.readUInt16BE(i+5);break;}
   i+=length;
  }
 }
 if(width<1||height<1||width>10000||height>10000||width*height>20000000)throw fail('Image dimensions exceed the limit');
 return {mime:image.mime,base64:data.toString('base64')};
}
export function validateIdentityImages(body){exact(body,['front','back']);return {front:validateImage(body.front),back:validateImage(body.back)};}
function context(kind,userId,requestId){return 'customer-private:v1:'+kind+':'+userId+':'+requestId;}
export async function submitPrivateData(db,userId,kind,body,{key=privateDataKey()}={}){
 if(!UUID.test(userId??'')||!['KYC','BANK_LINK'].includes(kind))throw fail('Invalid private submission');
 const payload=kind==='KYC'?validateIdentityImages(body):validateBankDetails(body);
 const c=await db.connect();let active=false;
 try{
  await c.query('BEGIN');active=true;
  const user=await c.query('SELECT id FROM app_users WHERE id=$1 FOR UPDATE',[userId]);if(!user.rows.length)throw fail('Account not found',404);
  const count=await c.query("SELECT count(*)::int AS n FROM private_customer_submissions WHERE user_id=$1 AND created_at>=now()-interval '1 day'",[userId]);
  if(count.rows[0].n>=5)throw fail('Daily private submission limit reached',429);
  const requestId=randomUUID();
  if(kind==='KYC')await c.query("INSERT INTO client_kyc_requests(id,client_user_id,status,documents_stored) VALUES($1,$2,'UNDER_REVIEW',true)",[requestId,userId]);
  else await c.query('INSERT INTO client_bank_link_requests(id,client_user_id,bank_label,account_last4,bank_details_stored) VALUES($1,$2,$3,$4,true)',[requestId,userId,payload.bankName,payload.accountNumber.slice(-4)]);
  const column=kind==='KYC'?'kyc_request_id':'bank_request_id';
  await c.query('INSERT INTO private_customer_submissions(user_id,kind,'+column+',encrypted_payload) VALUES($1,$2,$3,$4)',[userId,kind,requestId,sealPrivateData(payload,key,context(kind,userId,requestId))]);
  const status=kind==='KYC'?'UNDER_REVIEW':'PENDING_VERIFICATION';
  await c.query('INSERT INTO client_workflow_audit(category,request_id,client_user_id,actor_user_id,new_status,reason) VALUES($1,$2,$3,$3,$4,$5)',[kind,requestId,userId,status,'Customer submitted encrypted private material']);
  await c.query('COMMIT');active=false;return {id:requestId,category:kind,status,...(kind==='KYC'?{documentsStored:true}:{bankLabel:payload.bankName,accountLast4:payload.accountNumber.slice(-4),detailsStored:true})};
 }catch(error){if(active)await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function readPrivateData(db,actor,kind,requestId,{key=privateDataKey()}={}){
 if(!UUID.test(requestId??'')||!UUID.test(actor?.userId??'')||!['KYC','BANK_LINK'].includes(kind))throw fail('Invalid private reference');
 if(!['CLIENT','MASTER','SUBADMIN'].includes(actor.role))throw fail('Permission required',403);
 const column=kind==='KYC'?'s.kyc_request_id':'s.bank_request_id';
 const result=await db.query(`SELECT s.id,s.user_id,s.encrypted_payload FROM private_customer_submissions s
  LEFT JOIN client_links l ON l.user_id=s.user_id WHERE ${column}=$1 AND s.kind=$2
  AND ($3::text='MASTER' OR ($3::text='CLIENT' AND s.user_id=$4::uuid) OR ($3::text='SUBADMIN' AND l.subadmin_user_id=$4::uuid))`,[requestId,kind,actor.role,actor.userId]);
 if(result.rows.length!==1)throw fail('Private submission not found',404);
 const row=result.rows[0];
 const payload=openPrivateData(row.encrypted_payload,key,context(kind,row.user_id,requestId));
 await db.query('INSERT INTO private_customer_access_audit(submission_id,client_user_id,actor_user_id,kind) VALUES($1,$2,$3,$4)',[row.id,row.user_id,actor.userId,kind]);
 return payload;
}
