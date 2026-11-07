import {createSession,generateSessionToken,sessionTokenHash} from "./auth.mjs";

const MOBILE_ORIGIN="https://m.nuvexapro.com";
const LOGIN_ORIGINS=new Set(["https://www.nuvexapro.com","https://nuvexapro.com"]);

function send(res,status,body){
 res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
 res.end(JSON.stringify(body));
}
// The handoff code is a one-time, 60-second credential.
// Exact Origin/Host checks prevent sibling sites from issuing or redeeming it.
export async function handleMobileSession(req,res,db,resolveSession){
 if(req.method!=="POST")return send(res,405,{error:"Method not allowed"});
 const origin=req.headers.origin;
 const hostname=String(req.headers.host??"").toLowerCase().split(":")[0];
 const loginHost=hostname==="nuvexapro.com"||hostname==="www.nuvexapro.com";
 const enabled=process.env.MOBILE_ORIGIN===MOBILE_ORIGIN;
 try{
  if(loginHost){
   if(!LOGIN_ORIGINS.has(origin)||new URL(origin).hostname!==hostname)return send(res,403,{error:"Invalid origin"});
   const authorization=req.headers.authorization??"";
   if(!authorization.startsWith("Bearer "))return send(res,401,{error:"Authentication required"});
   const token=authorization.slice(7);
   const session=await resolveSession(token);
   if(!session?.accountId||session.adminVerified)return send(res,401,{error:"Customer session required"});
   if(!enabled)return send(res,200,{url:"/mobile.html"});
   const handoff=generateSessionToken();
   await db.query("DELETE FROM mobile_session_handoffs WHERE expires_at<=now()");
   const result=await db.query(`INSERT INTO mobile_session_handoffs(code_hash,session_hash,expires_at)
    SELECT $1,token_hash,LEAST(expires_at,now()+interval '60 seconds') FROM user_sessions
    WHERE token_hash=$2 AND expires_at>now() AND revoked_at IS NULL AND admin_verified_at IS NULL
    ON CONFLICT(session_hash) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at
    RETURNING code_hash`,[sessionTokenHash(handoff),sessionTokenHash(token)]);
   if(!result.rows.length)return send(res,401,{error:"Session expired"});
   return send(res,200,{url:MOBILE_ORIGIN+"/",handoff});
  }
  if(hostname!=="m.nuvexapro.com"||origin!==MOBILE_ORIGIN||!enabled)return send(res,403,{error:"Invalid origin"});
  const handoff=/^Handoff ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??"")?.[1];
  if(!handoff)return send(res,401,{error:"Sign in required"});
  const client=await db.connect();
  try{
   await client.query("BEGIN");
   const result=await client.query(`DELETE FROM mobile_session_handoffs WHERE code_hash=$1 AND expires_at>now()
    RETURNING session_hash`,[sessionTokenHash(handoff)]);
   if(!result.rows.length){
    await client.query("ROLLBACK");return send(res,401,{error:"Sign in required"});
   }
   // Revoke the source session in the same transaction that consumes the code.
   // A repeated or concurrent exchange can never mint a second mobile session.
   const source=await client.query(`UPDATE user_sessions s SET revoked_at=now() FROM accounts a
    WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL
    AND s.admin_verified_at IS NULL AND a.id=s.account_id AND a.user_id=s.user_id
    RETURNING s.user_id,s.account_id,s.expires_at`,[result.rows[0].session_hash]);
   if(!source.rows.length){
    await client.query("COMMIT");return send(res,401,{error:"Session expired"});
   }
   const row=source.rows[0];
   const token=await createSession(client,{userId:row.user_id,accountId:row.account_id,expiresAt:new Date(row.expires_at)});
   await client.query("COMMIT");
   return send(res,200,{token,expiresAt:new Date(row.expires_at).toISOString()});
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
 }catch{return send(res,503,{error:"Mobile sign-in temporarily unavailable"});}
}
