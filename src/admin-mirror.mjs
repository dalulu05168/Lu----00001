import {getAccountSnapshot} from "./account-service.mjs";
import {listWatchlist} from "./watchlist-service.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message,statusCode){const e=new Error(message);e.statusCode=statusCode;throw e;}

/**
 * A scoped, audited, read-only snapshot of the same stored customer data returned
 * by /api/account and /api/watchlist. It never impersonates a customer session.
 *
 * MASTER: all non-administrator customers.
 * SUBADMIN: only customers bound to that subadmin through client_links.
 */

export async function getClientMirrorSetupStatus(db,actor){
  if(!actor?.userId||!["MASTER","SUBADMIN"].includes(actor.role))invalid("Administrator 2FA session required",403);
  const result=await db.query("SELECT to_regclass('public.admin_mirror_access_log') IS NOT NULL AS ready");
  return {ready:result.rows[0]?.ready===true,mode:"READ_ONLY"};
}
async function ensureMirrorAuditAvailable(db,actor){
  if(!(await getClientMirrorSetupStatus(db,actor)).ready)invalid("Mirror audit schema not installed",503);
}

export async function getClientAppMirror(db,actor,clientId){
  if(!UUID.test(clientId??""))invalid("Invalid client id",400);
  if(!actor?.userId||!["MASTER","SUBADMIN"].includes(actor.role))invalid("Administrator 2FA session required",403);
  const allowed=await db.query(`SELECT u.id AS user_id,u.email,a.id AS account_id,c.subadmin_user_id
      FROM app_users u
      JOIN accounts a ON a.user_id=u.id
      LEFT JOIN client_links c ON c.user_id=u.id
      WHERE u.id=$1
        AND NOT EXISTS (SELECT 1 FROM admin_roles r WHERE r.user_id=u.id)
        AND ($2::text='MASTER' OR c.subadmin_user_id=$3::uuid)
      LIMIT 1`,[clientId,actor.role,actor.userId]);
  if(allowed.rows.length!==1)invalid("Client not found",404);
  const row=allowed.rows[0];
  await ensureMirrorAuditAvailable(db,actor);
  const account=await getAccountSnapshot(db,row.account_id);
  const watchlist=await listWatchlist(db,row.account_id);
  // Viewing financial records is privileged: refuse to return data if audit fails.
  await db.query("INSERT INTO admin_mirror_access_log(actor_user_id,client_user_id) VALUES($1,$2)",[actor.userId,row.user_id]);
  return {
    client:{id:row.user_id,email:row.email,subadminUserId:row.subadmin_user_id??null},
    account:account.account,
    positions:account.positions,
    orders:account.orders,
    watchlist,
    mode:"READ_ONLY",
    checkedAt:new Date().toISOString(),
    disclosure:"Database snapshot of internal account records only; not a live device screen, licensed market feed, or brokerage position."
  };
}

/** Inspect mirror reads without exposing session tokens, passwords or unrelated accounts. */
export async function listClientMirrorAudit(db,actor){
  await ensureMirrorAuditAvailable(db,actor);
  const r=await db.query(`SELECT l.id,l.viewed_at AS "viewedAt",
      l.actor_user_id AS "actorUserId",l.client_user_id AS "clientUserId",
      c.email AS "clientEmail",a.email AS "actorEmail"
    FROM admin_mirror_access_log l
    JOIN app_users c ON c.id=l.client_user_id
    JOIN app_users a ON a.id=l.actor_user_id
    WHERE ($1::text='MASTER' OR l.actor_user_id=$2::uuid)
    ORDER BY l.viewed_at DESC,l.id DESC LIMIT 80`,[actor.role,actor.userId]);
  return r.rows;
}
