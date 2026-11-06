import {verifyPassword} from "./auth.mjs";
import {optionalReason} from "./optional-reason.mjs";
import {productError} from "./internal-products.mjs";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// HK/CN/MY withdrawn: no working free quote source was found for them, and
// their stocks were never purchasable (internal-purchases already required
// market==='US'), so no lock could exist under those markets regardless.
const markets=new Set(["US","RO"]);

export async function setStockPositionLock(db,actor,body){
 if(!actor?.userId||!["MASTER","SUBADMIN"].includes(actor.role))throw productError("Administrator session required",403);
 if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).some(key=>!["clientId","market","symbol","locked","expectedVersion","confirmPassword","reason"].includes(key)))
  throw productError("Invalid stock lock request");
 const {clientId,market,symbol,locked,expectedVersion,confirmPassword}=body;
 const reason=optionalReason(body.reason);
 if(!uuid.test(clientId??"")||!markets.has(market)||typeof symbol!=="string"||!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(symbol)||
    typeof locked!=="boolean"||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||
    typeof confirmPassword!=="string"||confirmPassword.length<12||confirmPassword.length>1024)
  throw productError("Invalid stock lock request");
 const user=(await db.query("SELECT password_hash FROM app_users WHERE id=$1",[actor.userId])).rows[0];
 if(!user||!await verifyPassword(confirmPassword,user.password_hash))throw productError("Invalid admin credentials",401);
 const c=await db.connect();
 try{
  await c.query("BEGIN");
  const account=(await c.query(`SELECT a.id FROM accounts a WHERE a.user_id=$1
   AND NOT EXISTS(SELECT 1 FROM admin_roles WHERE user_id=a.user_id) FOR UPDATE`,[clientId])).rows[0];
  if(!account)throw productError("Client not found",404);
  if(actor.role==="SUBADMIN"){
   const link=(await c.query("SELECT subadmin_user_id FROM client_links WHERE user_id=$1 FOR SHARE",[clientId])).rows[0];
   if(link?.subadmin_user_id!==actor.userId)throw productError("Client not found",404);
  }
  const position=await c.query(`SELECT 1 FROM internal_product_positions v JOIN internal_product_terms t ON t.id=v.terms_id
   JOIN listings l ON l.id=t.listing_id WHERE v.account_id=$1 AND l.item_type='STOCK'
   AND l.market=$2 AND l.symbol=$3 AND v.quantity>0
   UNION ALL SELECT 1 FROM positions WHERE account_id=$1 AND market=$2 AND symbol=$3 AND quantity>0 LIMIT 1`,
   [account.id,market,symbol]);
  if(!position.rows.length)throw productError("Stock position not found",409);
  const params=[account.id,market,symbol];
  const old=(await c.query("SELECT locked,version FROM stock_position_locks WHERE account_id=$1 AND market=$2 AND symbol=$3",params)).rows[0];
  const version=old?.version??0;
  if(version!==expectedVersion)throw productError("Stock lock changed; refresh before saving",409);
  if((old?.locked??false)===locked){await c.query("COMMIT");return {market,symbol,locked,version};}
  await c.query(`INSERT INTO stock_position_locks(account_id,market,symbol,locked,version) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(account_id,market,symbol) DO UPDATE SET locked=EXCLUDED.locked,version=EXCLUDED.version`,
   [...params,locked,version+1]);
  await c.query(`INSERT INTO stock_position_lock_audit(account_id,market,symbol,locked,version,actor_user_id,reason)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,[...params,locked,version+1,actor.userId,reason]);
  await c.query("COMMIT");
  return {market,symbol,locked,version:version+1};
 }catch(error){await c.query("ROLLBACK");throw error;}
 finally{c.release();}
}
