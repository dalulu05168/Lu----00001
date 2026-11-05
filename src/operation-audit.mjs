const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function listUnifiedAudit(db,actor,{limit=100}={}){
 if(!actor||!["MASTER","SUBADMIN"].includes(actor.role)||!UUID.test(actor.userId))
  throw Object.assign(new Error("Administrator required"),{statusCode:403});
 if(!Number.isSafeInteger(limit)||limit<1||limit>200)
  throw Object.assign(new Error("Invalid audit limit"),{statusCode:400});
 const query=`
 SELECT * FROM (
  SELECT 'CLIENT_POLICY'::text AS event_type, a.id::text AS event_id, a.client_user_id AS client_id,
   a.actor_user_id AS actor_id, a.field_name AS action,a.reason AS description,a.recorded_at AS event_at
  FROM client_policy_audit a LEFT JOIN client_links l ON l.user_id=a.client_user_id
  WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)
  UNION ALL
  SELECT 'WORKFLOW',a.id::text,a.client_user_id,a.actor_user_id,
   a.category||':'||a.new_status,COALESCE(a.reason,''),a.event_at
  FROM client_workflow_audit a LEFT JOIN client_links l ON l.user_id=a.client_user_id
  WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)
  UNION ALL
  SELECT 'APP_MIRROR',a.id::text,a.client_user_id,a.actor_user_id,
   'VIEW','Client account snapshot viewed',a.viewed_at
  FROM admin_mirror_access_log a LEFT JOIN client_links l ON l.user_id=a.client_user_id
  WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)
  UNION ALL
  SELECT 'SUPPORT',a.id::text,t.client_user_id,a.actor_user_id,
   a.previous_status||' → '||a.new_status,a.reason,a.recorded_at
  FROM support_status_audit a JOIN support_threads t ON t.id=a.thread_id
   LEFT JOIN client_links l ON l.user_id=t.client_user_id
  WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)
  UNION ALL
  SELECT 'COMMODITY',a.id::text,NULL::uuid,a.actor_user_id,
   a.action||':'||a.new_status,a.reason,a.recorded_at
  FROM commodity_product_audit a WHERE $1::text='MASTER'
  UNION ALL
  SELECT 'SUBADMIN',a.id::text,NULL::uuid,a.actor_user_id,
   CASE WHEN a.new_login_allowed THEN 'ALLOW_LOGIN' ELSE 'BLOCK_LOGIN' END,
   a.reason,a.recorded_at
  FROM admin_subaccount_control_audit a WHERE $1::text='MASTER'
  UNION ALL
  SELECT 'PRODUCT_TERMS',a.id::text,NULL::uuid,a.actor_user_id,
   'CONFIGURE:v'||a.version::text,a.reason,a.created_at
  FROM internal_product_terms_audit a WHERE $1::text='MASTER'
  UNION ALL
  SELECT 'INTERNAL_PURCHASE',p.id::text,a.user_id,COALESCE(m.actor_user_id,a.user_id),
   'BUY:'||p.product_code,'Quantity '||p.quantity::text||', USD cents '||p.total_cents::text,p.created_at
  FROM internal_purchases p JOIN accounts a ON a.id=p.account_id
   LEFT JOIN admin_mirror_purchase_audit m ON m.purchase_id=p.id
   LEFT JOIN client_links l ON l.user_id=a.user_id
  WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)
 ) events ORDER BY event_at DESC,event_type,event_id DESC LIMIT $3`;
 const result=await db.query(query,[actor.role,actor.userId,limit]);
 return {items:result.rows.map(x=>({eventType:x.event_type,eventId:x.event_id,clientId:x.client_id,
  actorId:x.actor_id,action:x.action,description:x.description,recordedAt:x.event_at}))};
}
