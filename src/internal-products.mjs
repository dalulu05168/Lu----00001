import {hashPassword,verifyPassword} from './auth.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function productError(message,statusCode=400){return Object.assign(new Error(message),{statusCode});}
export function purchaseQuote(price,discount,quantity){
 if(!Number.isSafeInteger(price)||price<1||!Number.isSafeInteger(discount)||discount<0||discount>9999||!Number.isSafeInteger(quantity)||quantity<1)
  throw productError('Invalid internal purchase terms');
 const unit=(BigInt(price)*BigInt(10000-discount)+5000n)/10000n,total=unit*BigInt(quantity);
 if(unit<1n||total>BigInt(Number.MAX_SAFE_INTEGER))throw productError('Internal purchase amount out of range');
 return {originalPriceCents:price,discountBps:discount,unitPriceCents:Number(unit),quantity,totalCents:Number(total)};
}
export async function hashParticipationPassword(value){
 if(typeof value!=='string'||!/^\d{6}$/.test(value))throw productError('Participation password must contain six digits');
 return hashPassword('product-participation:'+value);
}
export async function checkParticipationPassword(value,hash){
 if(typeof value!=='string'||!/^\d{6}$/.test(value))return false;
 return verifyPassword('product-participation:'+value,hash);
}
export function publicTerms(row){
 if(!row?.terms_id)return {tradingEnabled:false,discountBps:0,internalPriceCents:null,passwordConfigured:false,termsVersion:null};
 return {termsId:row.terms_id,tradingEnabled:row.trading_enabled===true,discountBps:Number(row.discount_bps),internalPriceCents:row.price_cents===null?null:Number(row.price_cents),
  passwordConfigured:row.password_configured===true,termsVersion:Number(row.version)};
}
export async function saveProductTerms(db,kind,id,input){
 const keys=['tradingEnabled','discountBps','internalPriceCents','participationPassword'];
 if(!keys.some(k=>Object.hasOwn(input,k)))return;
 if(!['COMMODITY','LISTING'].includes(kind))throw productError('Invalid product kind');
 const column=kind==='COMMODITY'?'commodity_id':'listing_id';
 const previous=(await db.query('SELECT * FROM internal_product_terms WHERE '+column+'=$1 FOR UPDATE',[id])).rows[0];
 const enabled=input.tradingEnabled??previous?.trading_enabled??false;
 const price=Object.hasOwn(input,'internalPriceCents')?input.internalPriceCents:(previous?.price_cents==null?null:Number(previous.price_cents));
 const discount=input.discountBps??previous?.discount_bps??0;
 if(typeof enabled!=='boolean')throw productError('Invalid internal trading setting');
 if(!Number.isSafeInteger(discount)||discount<0||discount>9999)throw productError('Invalid discount');
 if(price!==null)purchaseQuote(price,discount,1);
 else if(discount!==0||enabled)throw productError('Set an internal USD price before enabling purchases');
 const password=input.participationPassword;
 const hash=password===undefined||password===''?previous?.participation_password_hash:await hashParticipationPassword(password);
 if(enabled&&!hash)throw productError('Set a six digit participation password before enabling purchases');
 // Disabled/unconfigured terms are still editable, but never become purchasable implicitly.
 await db.query(`INSERT INTO internal_product_terms(${column},price_cents,discount_bps,trading_enabled,participation_password_hash)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT(${column}) DO UPDATE SET price_cents=EXCLUDED.price_cents,
  discount_bps=EXCLUDED.discount_bps,trading_enabled=EXCLUDED.trading_enabled,
  participation_password_hash=EXCLUDED.participation_password_hash,version=internal_product_terms.version+1,updated_at=now()`,
 [id,price,discount,enabled,hash??null]);
}
export async function readAdminProductTerms(db,actor,kind,id){
 if(actor?.role!=='MASTER')throw productError('Master permission required',403);
 if(!['COMMODITY','LISTING'].includes(kind)||!UUID.test(id??''))throw productError('Invalid product reference');
 const table=kind==='COMMODITY'?'commodity_products':'listings',column=kind==='COMMODITY'?'commodity_id':'listing_id';
 const r=await db.query(`SELECT t.id AS terms_id,t.price_cents,t.discount_bps,t.trading_enabled,t.version,
  t.participation_password_hash IS NOT NULL AS password_configured FROM ${table} p
  LEFT JOIN internal_product_terms t ON t.${column}=p.id WHERE p.id=$1`,[id]);
 if(!r.rows.length)throw productError('Product not found',404);
 return publicTerms(r.rows[0]);
}
export async function updateAdminProductTerms(db,actor,body){
 if(actor?.role!=='MASTER')throw productError('Master permission required',403);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['kind','id','expectedVersion','tradingEnabled','internalPriceCents','discountBps','participationPassword','reason'].includes(k)))throw productError('Invalid product terms');
 if(!['COMMODITY','LISTING'].includes(body.kind)||!UUID.test(body.id??'')||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)throw productError('Invalid product reference');
 if(typeof body.reason!=='string'||body.reason.trim().length<12||body.reason.length>400)throw productError('Change reason required');
 if(!['tradingEnabled','internalPriceCents','discountBps','participationPassword'].some(k=>Object.hasOwn(body,k)))throw productError('No terms to update');
 const c=await db.connect();let active=false;
 try{
  await c.query('BEGIN');active=true;
  const table=body.kind==='COMMODITY'?'commodity_products':'listings';
  const found=await c.query('SELECT id FROM '+table+' WHERE id=$1 FOR UPDATE',[body.id]);
  if(!found.rows.length)throw productError('Product not found',404);
  const previous=await readAdminProductTerms(c,actor,body.kind,body.id);
  if((previous.termsVersion??0)!==body.expectedVersion)throw productError('Product terms changed; refresh before saving',409);
  await saveProductTerms(c,body.kind,body.id,body);
  const next=await readAdminProductTerms(c,actor,body.kind,body.id);
  await c.query(`INSERT INTO internal_product_terms_audit(terms_id,actor_user_id,version,price_cents,discount_bps,trading_enabled,password_changed,reason)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[next.termsId,actor.userId,next.termsVersion,next.internalPriceCents,next.discountBps,next.tradingEnabled,Boolean(body.participationPassword),body.reason.trim()]);
  await c.query('COMMIT');active=false;return next;
 }catch(error){if(active)await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function listPublishedInternalProducts(db){
 const result=await db.query(`SELECT t.id AS terms_id,t.price_cents,t.discount_bps,t.trading_enabled,t.version,
  t.participation_password_hash IS NOT NULL AS password_configured,
  COALESCE(p.name,l.display_name) AS name,COALESCE(p.sku,l.symbol) AS code,
  CASE WHEN p.id IS NOT NULL THEN 'COMMODITY' ELSE l.item_type END AS item_type,
  COALESCE(p.unit,'份') AS unit,COALESCE(p.minimum_quantity,1) AS minimum_quantity
  FROM internal_product_terms t LEFT JOIN commodity_products p ON p.id=t.commodity_id
  LEFT JOIN listings l ON l.id=t.listing_id
  WHERE COALESCE(p.status,l.status)='PUBLISHED' AND t.trading_enabled=true ORDER BY t.updated_at DESC LIMIT 300`);
 return result.rows.map(r=>({...publicTerms(r),name:r.name,code:r.code,itemType:r.item_type,unit:r.unit,minimumQuantity:Number(r.minimum_quantity)}));
}
