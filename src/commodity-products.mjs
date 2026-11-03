import {randomUUID} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES=new Set(["PRECIOUS_METAL","ENERGY","AGRICULTURE","INDUSTRIAL_METAL","OTHER"]);
const STATUSES=new Set(["DRAFT","PUBLISHED","ARCHIVED"]);
function bad(msg,statusCode=400){throw Object.assign(new Error(msg),{statusCode});}
function master(actor){if(actor?.role!=="MASTER"||!UUID.test(actor?.userId??""))bad("Master permission required",403);}
function validate(input,{update=false}={}){
 if(!input||typeof input!=="object"||Array.isArray(input))bad("Invalid commodity product");
 const allowed=update?["id","name","category","unit","minimumQuantity","indicativePriceCents","status","reason"]:
 ["sku","name","category","unit","minimumQuantity","indicativePriceCents","status","reason"];
 if(Object.keys(input).some(k=>!allowed.includes(k)))bad("Unexpected commodity fields");
 if(!update&&(typeof input.sku!=="string"||!/^[A-Z0-9][A-Z0-9._-]{1,31}$/.test(input.sku)))
  bad("Invalid product SKU");
 if(update&&(!UUID.test(input.id)||!["name","category","unit","minimumQuantity","indicativePriceCents","status"].some(k=>Object.hasOwn(input,k))))
  bad("Invalid product update");
 if(Object.hasOwn(input,"name")&&(typeof input.name!=="string"||input.name.trim().length<2||input.name.trim().length>120))bad("Invalid product name");
 if(Object.hasOwn(input,"category")&&!CATEGORIES.has(input.category))bad("Invalid product category");
 if(Object.hasOwn(input,"unit")&&(typeof input.unit!=="string"||input.unit.trim().length<2||input.unit.trim().length>24))bad("Invalid product unit");
 if(Object.hasOwn(input,"minimumQuantity")&&(!Number.isSafeInteger(input.minimumQuantity)||input.minimumQuantity<1||input.minimumQuantity>1000000))bad("Invalid minimum quantity");
 if(Object.hasOwn(input,"indicativePriceCents")&&input.indicativePriceCents!==null&&
  (!Number.isSafeInteger(input.indicativePriceCents)||input.indicativePriceCents<1||input.indicativePriceCents>1000000000000))
  bad("Invalid indicative price");
 if(Object.hasOwn(input,"status")&&!STATUSES.has(input.status))bad("Invalid commodity status");
 if(!update&&(!input.name||!input.category||!input.unit))bad("Incomplete product");
 if(typeof input.reason!=="string"||input.reason.trim().length<12||input.reason.trim().length>400)bad("Change reason required");
 return input;
}
function output(r){return {id:r.id,sku:r.sku,name:r.name,category:r.category,unit:r.unit,
 minimumQuantity:r.minimum_quantity,indicativePriceCents:r.indicative_price_cents===null?null:Number(r.indicative_price_cents),
 priceSource:"ADMIN_INDICATIVE",isDemo:r.is_demo===true,status:r.status,updatedAt:r.updated_at,createdAt:r.created_at};}
async function txn(db,operation){const c=await db.connect();let started=false;try{
 await c.query("BEGIN");started=true;const result=await operation(c);await c.query("COMMIT");started=false;return result;
}catch(e){if(started)await c.query("ROLLBACK");throw e;}finally{c.release();}}
export async function listCommodityProducts(db,actor,{publishedOnly=false}={}){
 if(!publishedOnly&&!["MASTER","SUBADMIN"].includes(actor?.role))bad("Administrator required",403);
 const q=await db.query("SELECT * FROM commodity_products"+(publishedOnly?" WHERE status='PUBLISHED'":"")+
  " ORDER BY updated_at DESC,id DESC LIMIT 300");
 return {items:q.rows.map(output),dataOrigin:"ADMIN_INDICATIVE",brokerConnected:false};
}
export async function createCommodityProduct(db,actor,body){
 master(actor);const d=validate(body),id=randomUUID();
 return txn(db,async c=>{
  const r=await c.query("INSERT INTO commodity_products(id,sku,name,category,unit,minimum_quantity,indicative_price_cents,status,created_by,updated_by)"+
   " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *",
   [id,d.sku,d.name.trim(),d.category,d.unit.trim(),d.minimumQuantity??1,d.indicativePriceCents??null,d.status??"DRAFT",actor.userId]);
  await c.query("INSERT INTO commodity_product_audit(product_id,actor_user_id,action,new_status,reason)"+
   " VALUES($1,$2,'CREATE',$3,$4)",[id,actor.userId,r.rows[0].status,d.reason.trim()]);
  return output(r.rows[0]);
 });
}
export async function updateCommodityProduct(db,actor,body){
 master(actor);const d=validate(body,{update:true});
 const cols={name:"name",category:"category",unit:"unit",minimumQuantity:"minimum_quantity",
  indicativePriceCents:"indicative_price_cents",status:"status"};
 return txn(db,async c=>{
  const before=await c.query("SELECT * FROM commodity_products WHERE id=$1 FOR UPDATE",[d.id]);
  if(before.rows.length!==1)bad("Commodity product not found",404);
  const values=[d.id],sets=[];
  for(const [field,col] of Object.entries(cols)){
   if(!Object.hasOwn(d,field))continue;
   values.push(typeof d[field]==="string"&&["name","unit"].includes(field)?d[field].trim():d[field]);
   sets.push(col+"=$"+values.length);
  }
  values.push(actor.userId);sets.push("updated_by=$"+values.length,"updated_at=now()");
  const next=await c.query("UPDATE commodity_products SET "+sets.join(",")+" WHERE id=$1 RETURNING *",values);
  await c.query("INSERT INTO commodity_product_audit(product_id,actor_user_id,action,previous_status,new_status,reason)"+
   " VALUES($1,$2,'UPDATE',$3,$4,$5)",
   [d.id,actor.userId,before.rows[0].status,next.rows[0].status,d.reason.trim()]);
  return output(next.rows[0]);
 });
}
export async function commodityProductAudit(db,actor,id){
 master(actor);if(!UUID.test(id??""))bad("Invalid product reference");
 const q=await db.query("SELECT actor_user_id,action,previous_status,new_status,reason,recorded_at FROM commodity_product_audit"+
  " WHERE product_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 100",[id]);return {items:q.rows};
}
