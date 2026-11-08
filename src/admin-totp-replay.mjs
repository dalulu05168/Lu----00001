import {verifyTotpCode} from './totp.mjs';

// Return the exact accepted TOTP time-step, not merely a boolean. The caller
// must claim this step atomically in the database before issuing a session.
// Current step is preferred when adjacent codes happen to collide.
export function matchedAdminTotpStep(secret,code,{now=Date.now(),step=30}={}){
  if(typeof code!== 'string'|| !/^\d{6}$/.test(code) ||
     !Number.isFinite(now)||!Number.isSafeInteger(step)||step<=0)return null;
  const current=Math.floor(now/1000/step);
  for(const drift of [0,-1,1]){
    const candidate=current+drift;
    if(candidate<0)continue;
    if(verifyTotpCode(secret,code,{now:candidate*step*1000,step,window:0}))return candidate;
  }
  return null;
}

// Must be called on the same PostgreSQL transaction/client as challenge
// consumption and createSession. The conditional UPDATE serializes competing
// pending challenges for one admin, including across application instances.
// Column introduced by db/023_admin_totp_replay.sql; do not deploy the code
// before the migration is approved and applied to the exact target database.
export async function claimAdminTotpStep(client,userId,step){
  if(typeof userId!=='string'||!userId||!Number.isSafeInteger(step)||step<0)
    throw new TypeError('Invalid admin TOTP step claim');
  const result=await client.query('UPDATE admin_roles SET last_login_totp_step=$2 WHERE user_id=$1 AND (last_login_totp_step IS NULL OR last_login_totp_step < $2) RETURNING user_id',[userId,step]);
  return result.rowCount===1;
}
