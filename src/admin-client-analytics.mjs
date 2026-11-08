import {getAccountAnalytics} from './account-analytics.mjs';
import {getClientMirrorSetupStatus} from './admin-mirror.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message,statusCode){throw Object.assign(new Error(message),{statusCode});}

/**
 * Admin-only read of the existing FIFO cash-ledger analytics. Never creates
 * a price or derives an unrealized gain from a missing market quote.
 * The existing mirror audit table records every successful financial read.
 */
export async function getAdminClientAnalytics(db,actor,clientId,{
  readAnalytics=getAccountAnalytics,
  mirrorStatus=getClientMirrorSetupStatus
}={}){
  if(!actor||!['MASTER','SUBADMIN'].includes(actor.role)||!UUID.test(actor.userId??''))
    fail('Administrator session required',403);
  if(!UUID.test(clientId??''))fail('Invalid client id',400);

  // Return an indistinguishable 404 for nonexistent, administrator, and
  // out-of-scope client identifiers. Never read account records first.
  const allowed=await db.query(`SELECT a.id AS account_id FROM app_users u
    JOIN accounts a ON a.user_id=u.id
    LEFT JOIN client_links c ON c.user_id=u.id
    WHERE u.id=$1
      AND NOT EXISTS(SELECT 1 FROM admin_roles ar WHERE ar.user_id=u.id)
      AND ($2::text='MASTER' OR c.subadmin_user_id=$3::uuid)
    LIMIT 1`,[clientId,actor.role,actor.userId]);
  if(allowed.rows.length!==1)fail('Client not found',404);

  const status=await mirrorStatus(db,actor);
  if(status?.ready!==true)fail('Mirror audit schema not installed',503);
  const analytics=await readAnalytics(db,allowed.rows[0].account_id);

  // Fail closed: do not return financial data when the audit INSERT fails.
  await db.query('INSERT INTO admin_mirror_access_log(actor_user_id,client_user_id) VALUES($1,$2)',
    [actor.userId,clientId]);
  return {clientId,analytics,mode:'READ_ONLY'};
}
