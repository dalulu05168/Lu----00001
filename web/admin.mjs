import {mountStockChart,mountStockHistory,resolveTradingViewSymbol} from "./stock-chart.mjs";
const el=id=>document.getElementById(id);
if(document.location?.hostname==="admin.nuvexapro.com"){
  document.querySelectorAll("[data-client-home]").forEach(link=>{
    link.href="https://nuvexapro.com/";
  });
}
let adminToken=sessionStorage.getItem("gsp_admin_token");
let role=null;
let selectedAdminRole="MASTER";
document.querySelectorAll("[data-role-choice]").forEach(button=>{
  button.addEventListener("click",()=>{
    selectedAdminRole=button.dataset.roleChoice;
    document.querySelectorAll("[data-role-choice]").forEach(x=>x.setAttribute("aria-pressed",String(x===button)));
  });
});
el("showAdminSetup").addEventListener("click",()=>{el("admin-login").hidden=true;el("bootstrapPanel").hidden=false;});
el("closeAdminSetup").addEventListener("click",()=>{el("bootstrapPanel").hidden=true;el("admin-login").hidden=false;});


const setText=(id,value)=>{el(id).textContent=value};
async function api(path,{method="GET",body,token=adminToken,idempotencyKey}={}){
  let res,answer;
  try{
    res=await fetch("/api"+path,{
      method,cache:"no-store",
      headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{}),
        ...(idempotencyKey?{"idempotency-key":idempotencyKey}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    answer=await res.json().catch(()=>({}));
  }catch{throw Error("后台接口连接失败");}
  // A response belongs to the session that sent it, even after a new login.
  if(token&&token!==adminToken&&path!=="/admin/logout")throw Error("管理会话已变更");
  if(token===adminToken&&token&&(
    (res.status===401&&answer.error==="Authentication required")||
    (res.status===403&&answer.error==="Administrator session required")
  ))resetAdminSession("登录已失效，请重新登录。");
  if(!res.ok)throw Error(answer.error||"请求失败（HTTP "+res.status+"）");
  return answer;
}
function itemRow(main,small){
  const row=document.createElement("div");row.className="admin-list-row";
  const info=document.createElement("div");
  const title=document.createElement("strong");title.textContent=main;
  const detail=document.createElement("small");detail.textContent=small;
  info.append(title,detail);row.append(info);return row;
}
function displayItems(id,rows,format){
  const node=el(id),container=document.createElement("div");container.className="admin-list";
  if(!Array.isArray(rows)||!rows.length){
    container.append(itemRow("暂无记录",""));
  }else for(const record of rows){
    const [title,description]=format(record);
    container.append(itemRow(title,description));
  }
  node.replaceChildren(container);
}
let subadminDirectory=[],selectedSubadminId=null,selectedClientDetailId=null;
let currentClientPolicy=null,clientPolicySerial=0,clientWorkflowSerial=0,clientHistoryCursor=null,clientHistoryLoaded=0,clientHistoryLoading=false;
let currentSubadminPolicy=null,subadminPolicySerial=0;
const dateLabel=value=>value && !Number.isNaN(Date.parse(value))?new Date(value).toLocaleString("zh-CN"):"未提供";
function detailRow(name,value){
  const row=document.createElement("div");row.className="record-field";
  row.append(plainNode("span",name),plainNode("strong",value??"未提供"));return row;
}
function setClientDetailTab(name){
  const selected=["overview","policy","requests"].includes(name)?name:"overview";
  document.querySelectorAll("[data-client-tab]").forEach(button=>{
    const active=button.dataset.clientTab===selected;
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll("[data-client-panel]").forEach(panel=>{
    panel.hidden=panel.dataset.clientPanel!==selected;
  });
}
document.querySelectorAll("[data-client-tab]").forEach(button=>{
  button.addEventListener("click",()=>setClientDetailTab(button.dataset.clientTab));
});
function closeClientDetail(){
  el("clientListView").hidden=false;
  setClientDetailTab("overview");
  selectedClientDetailId=null;currentClientPolicy=null;clientPolicySerial++;clientWorkflowSerial++;
  el("clientDetail").hidden=true;el("clientDetailFields").replaceChildren();
  el("clientWorkflowPanel").hidden=true;el("clientWorkflowHistory").replaceChildren();
  el("clientWorkflowAudit").replaceChildren();
  el("clientWorkflowStatus").textContent="";
  clientHistoryCursor=null;clientHistoryLoaded=0;clientHistoryLoading=false;
  el("clientWorkflowMore").hidden=true;el("clientWorkflowMore").disabled=false;
  el("clientPolicyArea").hidden=true;el("clientPolicyForm").hidden=true;el("clientPolicyReadout").replaceChildren();
  el("clientPolicyAudit").replaceChildren();
  el("clientPolicyReason").value="";el("clientPolicyPassword").value="";el("clientPolicyConfirm").checked=false;
}
function closeSubadminDetail(){
 selectedSubadminId=null;currentSubadminPolicy=null;subadminPolicySerial++;
 el("subadminDetail").hidden=true;el("subadminDetailFields").replaceChildren();
 el("subadminPolicyArea").hidden=true;el("subadminPolicyForm").hidden=true;
 el("subadminPolicyFields").replaceChildren();el("subadminPolicyAudit").replaceChildren();
 el("subadminPolicyReason").value="";el("subadminPolicyPassword").value="";
 el("subadminPolicyConfirm").checked=false;
}
function openClientDetail(clientId){
  const c=mirrorClients.find(item=>item.id===clientId);
  if(!c){closeClientDetail();return;}
  if(selectedClientDetailId!==c.id){
    currentClientPolicy=null;el("clientPolicyReason").value="";
    el("clientPolicyPassword").value="";el("clientPolicyConfirm").checked=false;
    clientWorkflowSerial++;clientHistoryCursor=null;clientHistoryLoaded=0;clientHistoryLoading=false;
    el("clientWorkflowPanel").hidden=true;el("clientWorkflowHistory").replaceChildren();
    el("clientWorkflowAudit").replaceChildren();el("clientWorkflowMore").hidden=true;
  }
  selectedClientDetailId=c.id;
  el("clientListView").hidden=true;
  el("clientDetailHeadline").textContent=c.email;
  el("clientDetailSubhead").textContent=c.subadmin_user_id?"由所属子账号管理的客户":"直接注册客户";
  setClientDetailTab("overview");
  const target=el("clientDetailFields");target.replaceChildren(
    detailRow("客户邮箱",c.email),detailRow("客户编号",c.id),
    detailRow("归属子账号",c.subadmin_user_id||"未绑定子账号"),
    detailRow("关联时间",dateLabel(c.created_at)),
    detailRow("账户管理策略","请查看下方 VIP、登录、提现及贷款申请资格"),
    detailRow("身份认证与银行卡","请在业务申请审核查看工单；第三方核验尚未接入")
  );
  el("clientDetail").hidden=false;
  void refreshClientPolicy(clientId);
  void refreshClientWorkflowHistory(clientId);
}
function openSubadminDetail(userId){
  const c=subadminDirectory.find(item=>item.user_id===userId);
  if(!c){closeSubadminDetail();return;}
  if(selectedSubadminId!==c.user_id){
    currentSubadminPolicy=null;el("subadminPolicyReason").value="";
    el("subadminPolicyPassword").value="";el("subadminPolicyConfirm").checked=false;
  }
  selectedSubadminId=c.user_id;
  const target=el("subadminDetailFields");target.replaceChildren(
    detailRow("管理员邮箱",c.email),detailRow("子账号编号",c.user_id),
    detailRow("邀请码",c.code||"未提供"),
    detailRow("邀请码使用次数",String(c.uses??0)+" / "+String(c.max_uses??"—")),
    detailRow("邀请码到期",dateLabel(c.expires_at)),
    detailRow("登录状态与操作权限","请查看下方登录管理区")
  );
  el("subadminDetail").hidden=false;
  void refreshSubadminPolicy(userId);
}

function renderSubadminPolicy(policy){
 currentSubadminPolicy=policy;
 const target=el("subadminPolicyFields");target.replaceChildren(
  detailRow("管理员登录",policy.loginAllowed?"正常":"受限"),
  detailRow("名下客户",String(policy.clientCount??0)+" 人"),
  detailRow("名下充值及提现申请",String(policy.requestCount??0)+" 笔"),
  detailRow("待处理资金申请",String(policy.pendingRequestCount??0)+" 笔"),
  detailRow("策略版本",String(policy.version??0)),
  detailRow("更新时间",dateLabel(policy.updatedAt))
 );
 el("subadminPolicyForm").hidden=role!=="MASTER";
 el("subadminPolicyArea").hidden=false;
 el("subadminPolicyStatus").textContent=role==="MASTER"
  ?"主账号可在确认后限制或恢复子账号登录":"当前账号仅可查看自己的管理状态";
 el("subadminLoginAllowed").value=String(policy.loginAllowed);
}
async function refreshSubadminPolicy(userId){
 if(selectedSubadminId!==userId)return;
 const serial=++subadminPolicySerial,usedToken=adminToken;
 el("subadminPolicyArea").hidden=false;el("subadminPolicyForm").hidden=true;
 currentSubadminPolicy=null;el("subadminPolicyFields").replaceChildren();
 el("subadminPolicyStatus").textContent="正在读取子账号管理策略";
 el("subadminPolicyAudit").replaceChildren();
 try{
  const {policy}=await api("/admin/subaccount-controls?userId="+encodeURIComponent(userId));
  if(serial!==subadminPolicySerial||selectedSubadminId!==userId||adminToken!==usedToken)return;
  renderSubadminPolicy(policy);
  try{
   const {items}=await api("/admin/subaccount-control-audit?userId="+encodeURIComponent(userId));
   if(serial!==subadminPolicySerial||selectedSubadminId!==userId||adminToken!==usedToken)return;
   const target=el("subadminPolicyAudit");target.replaceChildren();
   if(!Array.isArray(items)||!items.length){target.append(plainNode("p","暂无权限调整记录","muted"));return;}
   for(const item of items.slice(0,8)){
    const row=itemRow((item.oldLoginAllowed?"允许登录":"限制登录")+" → "+
      (item.newLoginAllowed?"允许登录":"限制登录"),"原因："+item.reason+" · "+dateLabel(item.recordedAt));
    target.append(row);
   }
  }catch(error){
   if(serial===subadminPolicySerial)el("subadminPolicyAudit").append(plainNode("p","记录暂不可读："+error.message,"muted"));
  }
 }catch(error){
  if(serial!==subadminPolicySerial||selectedSubadminId!==userId||adminToken!==usedToken)return;
  currentSubadminPolicy=null;el("subadminPolicyForm").hidden=true;
  el("subadminPolicyStatus").textContent="读取失败："+error.message;
 }
}
el("refreshSubadminPolicy").addEventListener("click",()=>{
 if(selectedSubadminId)void refreshSubadminPolicy(selectedSubadminId);
});
el("subadminPolicyForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(role!=="MASTER"||!currentSubadminPolicy||!selectedSubadminId){
  el("subadminPolicyStatus").textContent="没有修改权限或策略未加载";return;
 }
 if(!el("subadminPolicyConfirm").checked){
  el("subadminPolicyStatus").textContent="请确认本次变更";return;
 }
 const loginAllowed=el("subadminLoginAllowed").value==="true";
 if(currentSubadminPolicy.loginAllowed===loginAllowed){
  el("subadminPolicyStatus").textContent="状态未发生变化";return;
 }
 const userId=selectedSubadminId,usedToken=adminToken;
 const body={userId,loginAllowed,expectedVersion:currentSubadminPolicy.version,
  reason:el("subadminPolicyReason").value.trim(),confirmPassword:el("subadminPolicyPassword").value};
 const button=el("subadminPolicySubmit");button.disabled=true;
 try{
  await api("/admin/subaccount-controls",{method:"PATCH",body});
  if(selectedSubadminId!==userId||adminToken!==usedToken)return;
  el("subadminPolicyReason").value="";el("subadminPolicyPassword").value="";
  el("subadminPolicyConfirm").checked=false;
  await refreshSubadminPolicy(userId);
  if(selectedSubadminId===userId)el("subadminPolicyStatus").textContent="登录权限已修改，并记录审计";
 }catch(error){
  if(selectedSubadminId===userId)el("subadminPolicyStatus").textContent="保存失败："+error.message;
 }finally{button.disabled=false;el("subadminPolicyPassword").value="";}
});

function renderSubadminDirectory(items){
  subadminDirectory=Array.isArray(items)?items:[];
  const target=el("subadmins");target.replaceChildren();
  if(!subadminDirectory.length){target.append(plainNode("p","暂无可查看的子账号","muted"));closeSubadminDetail();return;}
  for(const c of subadminDirectory){
    const row=itemRow(c.email+" · 子管理员","邀请码使用 "+(c.uses??0)+" / "+(c.max_uses??"—")+" · 到期 "+dateLabel(c.expires_at));
    const action=document.createElement("button");action.className="outline";action.type="button";action.textContent="查看详情";
    action.addEventListener("click",()=>openSubadminDetail(c.user_id));
    row.append(action);target.append(row);
  }
  if(selectedSubadminId)openSubadminDetail(selectedSubadminId);
}
async function refreshSubadmins(){
  const token=adminToken;
  try{
    const data=await api("/admin/subaccounts");
    if(token!==adminToken)return;
    el("adminSubadminCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    renderSubadminDirectory(data.items);
  }catch(e){if(token===adminToken)setText("subadminFeedback",e.message)}
}
async function refreshClients(){
  const token=adminToken;
  try{
    const data=await api("/admin/clients");
    if(token!==adminToken)return;
    el("adminClientCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    renderClientDirectory(data.items||[]);
  }catch(e){if(token===adminToken)setText("clients",e.message)}
}

let mirrorClients=[],selectedMirrorClientId=null,mirrorSnapshot=null,mirrorActiveTab="watchlist",mirrorSerial=0;
let mirrorChartSymbol=null;
let mirrorPolicy=null,mirrorPolicyField=null,mirrorOpsSerial=0,mirrorRequestsSerial=0,mirrorCase=null;
let mirrorBackendReady=false;
const cashFmt=cents=>(Number(cents??0)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function plainNode(tag,text,cls=""){
  const n=document.createElement(tag);n.textContent=String(text??"—");
  if(cls)n.className=cls;return n;
}

const POLICY_TEXT={
  loginAllowed:"客户登录",
  withdrawalRequestsAllowed:"提现申请",
  vipTier:"VIP 等级",
  loanRequestsAllowed:"贷款申请资格",
  accountClass:"账户类别"
};
const POLICY_OPTIONS={
  loginAllowed:[["true","允许登录"],["false","限制登录"]],
  withdrawalRequestsAllowed:[["true","允许申请提现"],["false","暂停提现申请"]],
  vipTier:[["STANDARD","普通"],["SILVER","白银"],["GOLD","黄金"],["PLATINUM","铂金"]],
  loanRequestsAllowed:[["true","允许提交贷款申请"],["false","暂停贷款申请"]],
  accountClass:[["SIMULATED","模拟账户（无实盘）"],["REAL_PENDING","真实账户（待接券商）"],["INTERNAL","内部记录账户"]]
};
function policyTextValue(field,value){
  return POLICY_OPTIONS[field]?.find(([code])=>code===String(value))?.[1]??String(value??"—");
}
function refreshPolicyValues(){
  const field=el("clientPolicyField").value;
  const selector=el("clientPolicyValue");selector.replaceChildren();
  for(const [code,label] of POLICY_OPTIONS[field]??[]){
    const option=document.createElement("option");option.value=code;option.textContent=label;selector.append(option);
  }
  if(currentClientPolicy && Object.hasOwn(currentClientPolicy,field)){
    selector.value=String(currentClientPolicy[field]);
  }
}
function renderClientPolicy(policy){
  currentClientPolicy=policy;
  const target=el("clientPolicyReadout");target.replaceChildren();
  for(const [field,label] of Object.entries(POLICY_TEXT)){
    target.append(detailRow(label,policyTextValue(field,policy[field])));
  }
  target.append(detailRow("策略版本",String(policy.version??0)),detailRow("最近更新",dateLabel(policy.updatedAt)));
  el("clientPolicyArea").hidden=false;
  el("clientPolicyForm").hidden=role!=="MASTER";
  el("clientPolicyStatus").textContent=role==="MASTER"?"修改需再次输入主账号密码、填写原因并留下审计":"此客户仅允许查看，策略修改限主账号";
  refreshPolicyValues();
}
async function refreshClientPolicy(clientId){
  if(!clientId || selectedClientDetailId!==clientId)return;
  const serial=++clientPolicySerial,token=adminToken;
  el("clientPolicyArea").hidden=false;el("clientPolicyForm").hidden=true;
  currentClientPolicy=null;el("clientPolicyReadout").replaceChildren();
  el("clientPolicyStatus").textContent="正在读取客户策略";el("clientPolicyAudit").replaceChildren();
  try{
    const {policy}=await api("/admin/client-controls?clientId="+encodeURIComponent(clientId));
    if(serial!==clientPolicySerial||selectedClientDetailId!==clientId||adminToken!==token)return;
    renderClientPolicy(policy);
    try{
      const {items}=await api("/admin/client-control-audit?clientId="+encodeURIComponent(clientId));
      if(serial!==clientPolicySerial||selectedClientDetailId!==clientId||adminToken!==token)return;
      const target=el("clientPolicyAudit");target.replaceChildren();
      if(!Array.isArray(items)||!items.length){target.append(plainNode("p","暂无权限调整记录","muted"));return;}
      for(const item of items.slice(0,8)){
        const row=document.createElement("div");row.className="admin-list-row";
        const meta=plainNode("div",(POLICY_TEXT[item.field]??item.field)+" · "+policyTextValue(item.field,item.previousValue)+" → "+policyTextValue(item.field,item.nextValue));
        meta.append(plainNode("small","原因："+item.reason+" · "+dateLabel(item.recordedAt)));
        row.append(meta);target.append(row);
      }
    }catch(error){
      if(serial===clientPolicySerial)el("clientPolicyAudit").append(plainNode("p","审计记录暂不可读："+error.message,"muted"));
    }
  }catch(error){
    if(serial!==clientPolicySerial||selectedClientDetailId!==clientId||adminToken!==token)return;
    currentClientPolicy=null;
    el("clientPolicyForm").hidden=true;
    el("clientPolicyStatus").textContent="客户策略读取失败："+error.message;
  }
}
el("clientPolicyField").addEventListener("change",refreshPolicyValues);
el("refreshClientPolicy").addEventListener("click",()=>{if(selectedClientDetailId)void refreshClientPolicy(selectedClientDetailId)});
el("clientPolicyForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(role!=="MASTER"||!selectedClientDetailId||!currentClientPolicy){
    el("clientPolicyStatus").textContent="没有修改权限或策略未加载";return;
  }
  if(!el("clientPolicyConfirm").checked){el("clientPolicyStatus").textContent="请先确认这次管理操作";return;}
  const field=el("clientPolicyField").value;
  const raw=el("clientPolicyValue").value;
  const value=["loginAllowed","withdrawalRequestsAllowed","loanRequestsAllowed"].includes(field)?raw==="true":raw;
  if(currentClientPolicy[field]===value){el("clientPolicyStatus").textContent="目标状态与当前设置一致";return;}
  const clientId=selectedClientDetailId,token=adminToken;
  const body={clientId,field,value,reason:el("clientPolicyReason").value.trim(),
    confirmPassword:el("clientPolicyPassword").value,expectedVersion:currentClientPolicy.version};
  const button=el("clientPolicySubmit");button.disabled=true;
  try{
    const result=await api("/admin/client-controls",{method:"PATCH",body});
    if(selectedClientDetailId!==clientId||adminToken!==token)return;
    currentClientPolicy=result.policy;
    el("clientPolicyReason").value="";el("clientPolicyPassword").value="";el("clientPolicyConfirm").checked=false;
    renderClientPolicy(result.policy);
    el("clientPolicyStatus").textContent="修改已保存，并写入服务端审计";
    void refreshClientPolicy(clientId);
  }catch(error){
    if(selectedClientDetailId===clientId)el("clientPolicyStatus").textContent="未保存："+error.message+"；可刷新后重试";
  }finally{button.disabled=false;el("clientPolicyPassword").value="";}
});
el("mirrorManageClient").addEventListener("click",()=>{
  if(!selectedMirrorClientId)return;
  setMirrorOperationTab("controls");
  el("mirrorOperations").scrollIntoView?.({block:"nearest"});
  el("mirrorRefreshControls").focus?.();
});
el("mirrorQuickRequests").addEventListener("click",()=>{
  if(!selectedMirrorClientId)return;
  setMirrorOperationTab("requests");
  el("mirrorOperations").scrollIntoView?.({block:"nearest"});
});


async function refreshClientWorkflowHistory(clientId,{append=false}={}){
  if(!clientId||selectedClientDetailId!==clientId||clientHistoryLoading)return;
  if(append&&!clientHistoryCursor)return;
  const serial=++clientWorkflowSerial,usedToken=adminToken;
  const requestedCursor=append?clientHistoryCursor:null;
  const panel=el("clientWorkflowPanel"),button=el("clientWorkflowMore");
  panel.hidden=false;clientHistoryLoading=true;button.disabled=true;
  el("clientWorkflowStatus").textContent=append?"正在读取下一页申请":"正在读取当前客户的申请记录";
  if(!append){
    clientHistoryCursor=null;clientHistoryLoaded=0;
    button.hidden=true;
    el("clientWorkflowHistory").replaceChildren();
    el("clientWorkflowAudit").replaceChildren();
  }
  try{
    const url="/admin/client-history?clientId="+encodeURIComponent(clientId)+
      (requestedCursor?"&cursor="+encodeURIComponent(requestedCursor):"");
    const page=await api(url);
    if(serial!==clientWorkflowSerial||selectedClientDetailId!==clientId||adminToken!==usedToken)return;
    const rows=Array.isArray(page.items)?page.items:[];
    if(rows.some(item=>item.clientId!==clientId))throw Error("请求记录权限验证失败");
    const target=el("clientWorkflowHistory");
    if(!append&&!rows.length)target.append(plainNode("p","当前客户暂无申请记录","muted"));
    for(const item of rows){
      target.append(itemRow(caseSummary(item),"提交时间 "+dateLabel(item.createdAt)+" · "+item.category));
    }
    clientHistoryLoaded+=rows.length;
    clientHistoryCursor=page.hasMore&&typeof page.nextCursor==="string"?page.nextCursor:null;
    button.hidden=!clientHistoryCursor;
    el("clientWorkflowStatus").textContent="已加载该客户 "+clientHistoryLoaded+" 条申请"+
      (clientHistoryCursor?"；还有更早记录":"；已到末页");
    if(!append){
      try{
        const audit=await api("/admin/workflow-audit?clientId="+encodeURIComponent(clientId));
        if(serial!==clientWorkflowSerial||selectedClientDetailId!==clientId||adminToken!==usedToken)return;
        const auditTarget=el("clientWorkflowAudit");auditTarget.replaceChildren();
        const entries=Array.isArray(audit.items)?audit.items:[];
        if(!entries.length)auditTarget.append(plainNode("p","暂无审核操作记录","muted"));
        else for(const event of entries.slice(0,25)){
          const previous=CASE_STATUS[event.old_status]??event.old_status??"新建申请";
          const next=CASE_STATUS[event.new_status]??event.new_status??"—";
          const title=(CASE_NAMES[event.category]??event.category??"申请")+" · "+previous+" → "+next;
          const detail="操作员 "+String(event.actor_user_id??"未知")+
            " · "+dateLabel(event.event_at)+(event.reason?" · 原因："+event.reason:"");
          auditTarget.append(itemRow(title,detail));
        }
      }catch(error){
        if(serial===clientWorkflowSerial&&selectedClientDetailId===clientId&&adminToken===usedToken)
          el("clientWorkflowAudit").append(plainNode("p","审核记录读取失败："+error.message,"muted"));
      }
    }
  }catch(error){
    if(serial!==clientWorkflowSerial||selectedClientDetailId!==clientId||adminToken!==usedToken)return;
    el("clientWorkflowStatus").textContent="客户申请读取失败："+error.message;
  }finally{
    if(serial===clientWorkflowSerial){
      clientHistoryLoading=false;
      button.disabled=false;
    }
  }
}
el("refreshClientWorkflow").addEventListener("click",()=>{
  if(selectedClientDetailId)void refreshClientWorkflowHistory(selectedClientDetailId);
});
el("clientWorkflowMore").addEventListener("click",()=>{
  if(selectedClientDetailId)void refreshClientWorkflowHistory(selectedClientDetailId,{append:true});
});

function renderClientDirectory(items){
  mirrorClients=Array.isArray(items)?items:[];
  const list=el("clients"),quick=el("mirrorClientList");
  const term=el("mirrorClientSearch").value.trim().toLocaleLowerCase();
  const visible=mirrorClients.filter(c=>String(c.email).toLocaleLowerCase().includes(term));
  const dirTerm=el("clientDirectorySearch").value.trim().toLocaleLowerCase();
  const directory=mirrorClients.filter(c=>
    String(c.email).toLocaleLowerCase().includes(dirTerm)||String(c.id).toLowerCase().includes(dirTerm));
  el("clientDirectoryCount").textContent="显示 "+directory.length+" / "+mirrorClients.length+" 位客户";
  el("mirrorMatchCount").textContent="匹配 "+visible.length+" / "+mirrorClients.length+" 位客户";
  for(const target of [list,quick]){
    target.replaceChildren();
    const entries=target===quick?visible:directory;
    if(!entries.length){target.append(plainNode("p",term?"没有匹配的客户":"暂无有权限查看的客户","muted"));continue;}
    for(const c of entries){
      const row=document.createElement("div");row.className=target===list?"admin-list-row client-directory-row":"admin-list-row mirror-customer";
      const meta=document.createElement("div");
      meta.append(plainNode("div",c.email),plainNode("small",c.subadmin_user_id?"子账号归属 · "+c.subadmin_user_id:"直接注册客户"));
      const actions=document.createElement("div");actions.className="client-directory-actions";
      if(target===list){
        const detail=document.createElement("button");detail.type="button";detail.className="outline record-detail-open";detail.textContent="查看详情";
        detail.addEventListener("click",()=>openClientDetail(c.id));
        actions.append(detail);
      }
      row.append(meta);
      const button=document.createElement("button");button.type="button";button.className="outline mirror-open";
      button.textContent="查看 App 镜像";
      button.disabled=false; // Client policy operations remain available if the read-only snapshot is offline.
      button.addEventListener("click",()=>selectMirrorClient(c.id));
      actions.append(button);row.append(actions);target.append(row);
    }
  }
  if(selectedClientDetailId&&!mirrorClients.some(c=>c.id===selectedClientDetailId))closeClientDetail();
}
el("clientDirectorySearch").addEventListener("input",()=>renderClientDirectory(mirrorClients));
let mirrorPurchaseBusy=false;
const mirrorPurchaseKeys=new Map();
async function renderMirrorTrade(view,snap){
  if(role!=="MASTER"){view.append(plainNode("p","由主账户提交交易。","muted"));return;}
  const token=adminToken;
  const current=()=>token===adminToken&&mirrorSnapshot===snap&&mirrorActiveTab==="trade"&&el("mirrorDialog").open;
  const notice=plainNode("p","正在读取可购买产品…","muted");view.append(notice);
  try{
    const {items,stockQuotesConfigured}=await api("/admin/mirror-purchases");
    if(!current())return;
    if(!items.length){notice.textContent="暂无可购买产品";return;}
    notice.textContent="使用所选客户的平台余额购买，订单和持仓记入该客户账户。";
    const form=document.createElement("form");form.className="mirror-trade-form";
    function field(labelText,control){
      const label=plainNode("label",labelText);label.append(control);form.append(label);return control;
    }
    const product=field("购买产品",document.createElement("select"));
    items.forEach((item,i)=>{
      const option=plainNode("option",item.code+" · "+item.name);
      option.value=String(i);product.append(option);
    });
    const quantity=field("数量",document.createElement("input"));
    Object.assign(quantity,{type:"number",max:"1000000",step:"1",required:true});
    const total=plainNode("output","");form.append(total);
    const pin=field("六位商品参与密码",document.createElement("input"));
    Object.assign(pin,{type:"password",inputMode:"numeric",pattern:"[0-9]{6}",maxLength:6,autocomplete:"off",required:true});
    const password=field("主账户登录密码",document.createElement("input"));
    Object.assign(password,{type:"password",minLength:12,autocomplete:"off",required:true});
    const confirm=field("确认使用 "+snap.client.email+" 的余额购买",document.createElement("input"));
    Object.assign(confirm,{type:"checkbox",required:true});
    const submit=plainNode("button","确认购买");submit.type="submit";form.append(submit);
    const status=plainNode("p","","muted");status.setAttribute("role","status");form.append(status);
    let stockQuote=null,quoteSequence=0;
    const refreshQuote=(reset=false)=>{
      const item=items[Number(product.value)];
      quantity.min=String(item.minimumQuantity);
      if(reset)quantity.value=quantity.min;
      confirm.checked=false;
      const price=item.itemType==="STOCK"?stockQuote?.priceCents:item.internalPriceCents;
      if(price==null){total.textContent="等待有效美股实时报价";submit.disabled=true;return;}
      submit.disabled=mirrorPurchaseBusy;
      const unit=Number((BigInt(price)*BigInt(10000-item.discountBps)+5000n)/10000n);
      const amount=unit*Number(quantity.value);
      total.textContent="单价 "+cashFmt(unit)+" USD · 实付 "+(Number.isSafeInteger(amount)&&amount>0?cashFmt(amount)+" USD":"—");
      confirm.checked=false;
    };
    const loadQuote=async()=>{
      const item=items[Number(product.value)],sequence=++quoteSequence;
      stockQuote=null;refreshQuote(true);
      if(item.itemType!=="STOCK")return;
      if(item.market!=="US"){total.textContent="该市场尚未开放实时报价交易";return;}
      if(stockQuotesConfigured===false){total.textContent="美股实时买卖暂停 · 等待行情授权";return;}
      try{
        const quote=await api("/admin/stock-quote?market=US&symbol="+encodeURIComponent(item.code));
        if(current()&&sequence===quoteSequence){stockQuote=quote;refreshQuote();}
      }catch{if(current()&&sequence===quoteSequence)total.textContent="实时报价暂不可用";}
    };
    const refreshStock=plainNode("button","刷新产品报价");refreshStock.type="button";refreshStock.className="outline";
    refreshStock.addEventListener("click",()=>{if(!mirrorPurchaseBusy)void loadQuote();});form.prepend(refreshStock);
    product.addEventListener("change",()=>void loadQuote());
    quantity.addEventListener("input",()=>refreshQuote());
    void loadQuote();
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(!current()||!form.reportValidity()||mirrorPurchaseBusy)return;
      const item=items[Number(product.value)];
      if(item.itemType==="STOCK"&&!stockQuote)return;
      const body={clientId:snap.client.id,termsId:item.termsId,termsVersion:item.termsVersion,quantity:Number(quantity.value),
        participationPassword:pin.value,confirmPassword:password.value,confirmed:confirm.checked};
      if(item.itemType==="STOCK")body.confirmedStockPriceCents=stockQuote.priceCents;
      const fingerprint=[body.clientId,body.termsId,body.termsVersion,body.quantity].join(":");
      const key=mirrorPurchaseKeys.get(fingerprint)??crypto.randomUUID();
      mirrorPurchaseKeys.set(fingerprint,key);
      pin.value="";password.value="";confirm.checked=false;
      mirrorPurchaseBusy=true;submit.disabled=true;status.textContent="正在提交购买…";
      try{
        const result=await api("/admin/mirror-purchases",{method:"POST",body,idempotencyKey:key});
        mirrorPurchaseKeys.delete(fingerprint);
        if(token!==adminToken||selectedMirrorClientId!==snap.client.id||!el("mirrorDialog").open)return;
        await selectMirrorClient(snap.client.id);
        if(token===adminToken&&selectedMirrorClientId===snap.client.id)
          el("mirrorStatus").textContent="购买已记录 · 订单 "+result.id;
      }catch(error){
        if(current()){
          const message={
            "Participation password is incorrect":"六位商品参与密码不正确，请核对该商品的密码后再试。",
            "Invalid admin credentials":"主账户登录密码不正确，请重新输入。",
            "Master permission required":"当前账户没有代买权限，请使用主账户登录。",
            "Participation password temporarily locked; retry in 15 minutes":"商品参与密码尝试次数过多，请在 15 分钟后重试。"
          }[error.message];
          status.textContent=message??("购买未确认："+error.message+"。重试同一笔购买会沿用请求编号。");
        }
      }finally{
        body.confirmPassword="";body.participationPassword="";
        mirrorPurchaseBusy=false;submit.disabled=false;
      }
    });
    view.append(form);
  }catch(error){if(current())notice.textContent="产品读取失败："+error.message;}
}
function renderMirrorMarket(view,snap){
  const instruments=new Map();
  for(const item of [...(snap.internalProducts?.positions??[]),...(snap.positions??[]),...(snap.watchlist??[])]){
    const code=resolveTradingViewSymbol(item);
    if(code&&!instruments.has(code))instruments.set(code,item);
  }
  const reference={market:"US",symbol:"AAPL"};
  const showReference=!instruments.size;
  if(showReference)instruments.set(resolveTradingViewSymbol(reference),reference);
  const label=plainNode("label",showReference?"参考标的走势图":"走势图");label.className="mirror-chart-picker";
  const select=document.createElement("select");label.append(select);
  const host=document.createElement("div");host.className="mirror-chart";
  for(const [code,item] of instruments){
    const option=plainNode("option",item.name?code+" · "+item.name:code);
    option.value=code;select.append(option);
  }
  if(instruments.has(mirrorChartSymbol))select.value=mirrorChartSymbol;
  let chartSerial=0;
  const renderChart=()=>{
    const item=instruments.get(select.value),serial=++chartSerial;
    mountStockChart(host,item,{mobile:true});
    if(item.market!=="US")return;
    const token=adminToken,symbol=item.symbol;
    void api("/admin/stock-history?symbol="+encodeURIComponent(symbol)).then(data=>{
      if(serial!==chartSerial||token!==adminToken||!host.isConnected||data.symbol!==symbol||!Array.isArray(data.points)||data.points.length<2)return;
      mountStockHistory(host,data.points);
      note.textContent="Twelve Data · 历史日收盘价";
    }).catch(()=>{});
  };
  const note=plainNode("p","公开参考行情 · 可能延迟","mirror-chart-note");
  select.addEventListener("change",()=>{
    mirrorChartSymbol=select.value;
    note.textContent="公开参考行情 · 可能延迟";
    renderChart();
  });
  view.append(label,host,note);
  renderChart();
}
function renderMirrorWatchlist(view,snap){
  const held=new Map((snap.internalProducts?.positions??[]).filter(item=>item.item_type==="STOCK")
    .map(item=>[item.market+":"+item.symbol,item]));
  for(const item of snap.positions??[]){
    const key=item.market+":"+item.symbol;
    if(!held.has(key))held.set(key,item);
  }
  const watchlist=snap.watchlist??[];
  if(!watchlist.length){
    view.append(plainNode("p","此账户尚未添加自选。","mirror-market-hint"));
    if(held.size)view.append(plainNode("h5","账户持仓","mirror-market-section"));
  }
  for(const record of watchlist.length?watchlist:held.values()){
    const position=held.get(record.market+":"+record.symbol),chart=resolveTradingViewSymbol(record);
    const row=document.createElement(chart?"button":"div");row.className="mirror-quote-row";
    if(chart){
      row.type="button";
      row.addEventListener("click",()=>{mirrorChartSymbol=chart;activateMirrorTab("market");});
    }
    const icon=plainNode("span",record.symbol.slice(0,2),"mirror-symbol-mark");icon.setAttribute("aria-hidden","true");
    const identity=plainNode("span","","mirror-symbol-info");
    identity.append(plainNode("strong",record.symbol),plainNode("small",position?.name??record.market));
    const value=plainNode("span","","mirror-symbol-value");
    value.append(plainNode("strong",position?position.quantity+" 股":"—"),
      plainNode("small",position?"账户持仓":chart?"查看走势":"暂无走势"));
    row.append(icon,identity,value);view.append(row);
  }
}
function appendMirrorStockLocks(view,snap){
  const stocks=new Map((snap.internalProducts?.positions??[]).filter(p=>p.item_type==="STOCK")
    .map(p=>[p.market+":"+p.symbol,p]));
  for(const [code,position] of stocks){
    const form=document.createElement("form");form.className="mirror-trade-form";
    const toggle=plainNode("button",code+" · "+(position.manually_locked?"解除人工锁仓":"人工锁仓"));toggle.type="button";
    const fields=document.createElement("div");fields.hidden=true;
    const label=plainNode("label","当前管理员登录密码");
    const password=document.createElement("input");
    Object.assign(password,{type:"password",required:true,minLength:12,autocomplete:"off"});
    const submit=plainNode("button",position.manually_locked?"确认解锁":"确认锁仓");submit.type="submit";
    const status=plainNode("p","","muted");status.setAttribute("role","status");
    label.append(password);fields.append(label,submit,status);form.append(toggle,fields);
    toggle.addEventListener("click",()=>{fields.hidden=!fields.hidden;password.value="";if(!fields.hidden)password.focus();});
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(fields.hidden||submit.disabled||!form.reportValidity()||mirrorSnapshot!==snap)return;
      const token=adminToken;
      const body={clientId:snap.client.id,market:position.market,symbol:position.symbol,locked:!position.manually_locked,
        expectedVersion:Number(position.lock_version),confirmPassword:password.value};
      password.value="";submit.disabled=true;
      try{
        await api("/admin/stock-position-lock",{method:"PATCH",body});
        if(token===adminToken&&mirrorSnapshot===snap&&el("mirrorDialog").open)await selectMirrorClient(snap.client.id);
      }catch(error){if(token===adminToken&&mirrorSnapshot===snap)status.textContent="未能更新锁仓："+error.message;}
      finally{body.confirmPassword="";submit.disabled=false;}
    });
    view.append(form);
  }
}
function setMirrorScreen(){
  const view=el("mirrorAppScreen");view.replaceChildren();
  view.parentElement.dataset.activePage=mirrorActiveTab;
  el("mirrorPageTitle").textContent={watchlist:"自选",market:"行情",trade:"交易",positions:"持仓",orders:"订单",assets:"资产"}[mirrorActiveTab];
  view.scrollTop=0;
  if(!mirrorSnapshot){view.append(plainNode("p","请选择客户以读取账户快照","muted"));return;}
  const snap=mirrorSnapshot;
  if(mirrorActiveTab==="trade"){void renderMirrorTrade(view,snap);return;}
  if(mirrorActiveTab==="market"){renderMirrorMarket(view,snap);return;}
  if(mirrorActiveTab==="watchlist"){renderMirrorWatchlist(view,snap);return;}
  const formats={
    assets:()=>[["账户编号",snap.account?.id?"•••• "+snap.account.id.slice(-8):"—"],["账面币种",snap.account?.currency],["持仓记录",(snap.positions?.length??0)+(snap.internalProducts?.positions?.length??0)],["交易记录",(snap.orders?.length??0)+(snap.internalProducts?.purchases?.length??0)+(snap.internalProducts?.sales?.length??0)+(snap.internalProducts?.settlements?.length??0)],["自选标的",snap.watchlist?.length??0]],
    positions:()=>[
      ...(snap.positions??[]).map(p=>[p.market+" · "+p.symbol,Number(p.quantity).toLocaleString("en-US")+" 股"]),
      ...(snap.internalProducts?.positions??[]).map(p=>[p.name+" · "+p.code,"数量 "+p.quantity+" · 成本 "+cashFmt(p.cost_cents)+" USD"+
        (p.item_type==="STOCK"?(p.manually_locked?" · 人工锁仓":" · 持有期已满 "+p.unlocked_quantity+" 股"):"")])
    ],
    orders:()=>[
      ...(snap.orders??[]).map(o=>({name:(o.side==="BUY"?"买入":"卖出")+" · "+o.market+":"+o.symbol,
        detail:"数量 "+o.quantity+" · "+cashFmt(o.amount_usd_cents)+" USD",at:o.created_at})),
      ...(snap.internalProducts?.purchases??[]).map(p=>({name:"买入 · "+p.product_name+" · "+p.product_code,
        detail:"数量 "+p.quantity+" · 实付 "+cashFmt(p.total_cents)+" USD"+(p.due_at||p.stock_unlock_at?" · 到期 "+dateLabel(p.due_at??p.stock_unlock_at):""),at:p.created_at})),
      ...(snap.internalProducts?.sales??[]).map(p=>({name:"卖出 · "+p.symbol,
        detail:"数量 "+p.quantity+" · 到账 "+cashFmt(p.total_cents)+" USD",at:p.created_at})),
      ...(snap.internalProducts?.settlements??[]).map(p=>({name:"到期返还 · "+p.product_name+" · "+p.product_code,
        detail:"本金 "+cashFmt(p.total_cents)+" USD · 收益 "+cashFmt(p.profit_cents)+" USD",at:p.settled_at}))
    ].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)).map(o=>[o.name,o.detail+(o.at?" · "+dateLabel(o.at):"")])
  };
  const rows=formats[mirrorActiveTab]?.()??[];
  if(!rows.length){view.append(plainNode("p","该客户暂无对应记录","muted"));return;}
  const wrapper=document.createElement("div");wrapper.className="mirror-records";
  for(const [name,value] of rows){
    const line=document.createElement("div");line.className="mirror-record";
    line.append(plainNode("span",name),plainNode("span",value));wrapper.append(line);
  }
  view.append(wrapper);
  if(mirrorActiveTab==="positions")appendMirrorStockLocks(view,snap);
}

function setMirrorOperationTab(tab){
 const name=tab==="requests"?"requests":"controls";
 document.querySelectorAll("[data-mirror-operation-tab]").forEach(b=>{
  const active=b.dataset.mirrorOperationTab===name;
  b.setAttribute("aria-selected",String(active));b.tabIndex=active?0:-1;
 });
 document.querySelectorAll("[data-mirror-operation-panel]").forEach(p=>{
  p.hidden=p.dataset.mirrorOperationPanel!==name;
 });
 if(name==="requests"&&selectedMirrorClientId)void refreshMirrorRequests();
}
function hideMirrorPolicyForm(){
 mirrorPolicyField=null;el("mirrorPolicyForm").hidden=true;
 el("mirrorPolicyValue").replaceChildren();el("mirrorPolicyReason").value="";
 el("mirrorPolicyPassword").value="";el("mirrorPolicyConfirm").checked=false;
}
function hideMirrorReviewForm(){
 mirrorCase=null;el("mirrorReviewForm").hidden=true;el("mirrorReviewDecision").replaceChildren();
 el("mirrorReviewReason").value="";el("mirrorReviewConfirm").checked=false;
}
function clearMirrorOperations(){
 mirrorOpsSerial++;mirrorRequestsSerial++;mirrorPolicy=null;
 hideMirrorPolicyForm();hideMirrorReviewForm();
 for(const id of ["mirrorControlRows","mirrorPolicyAudit","mirrorRequestRows"])el(id).replaceChildren();
 el("mirrorControlStatus").textContent="请选择客户读取管理策略";
 el("mirrorRequestStatus").textContent="请选择客户读取申请";
 el("mirrorOperationsCustomer").textContent="";
 el("mirrorOperations").hidden=true;
 el("mirrorPolicySave").disabled=false;el("mirrorReviewSave").disabled=false;
 setMirrorOperationTab("controls");
}
function renderMirrorPolicy(policy){
 mirrorPolicy=policy;const root=el("mirrorControlRows");root.replaceChildren();
 for(const [field,label] of Object.entries(POLICY_TEXT)){
  const row=document.createElement("div");row.className="mirror-control-row";
  const info=document.createElement("div");info.className="mirror-control-info";
  info.append(plainNode("small",label),plainNode("strong",policyTextValue(field,policy[field])));
  row.append(info);
  if(role==="MASTER"){
   const button=document.createElement("button");button.type="button";button.className="outline";
   button.textContent="修改";button.setAttribute("aria-label","修改 "+label);
   button.addEventListener("click",()=>{
    mirrorPolicyField=field;
    el("mirrorPolicyHeading").textContent="修改 "+label;
    const select=el("mirrorPolicyValue");select.replaceChildren();
    for(const [value,caption] of POLICY_OPTIONS[field]){
     const option=document.createElement("option");option.value=value;option.textContent=caption;select.append(option);
    }
    select.value=String(policy[field]);
    el("mirrorPolicyReason").value="";el("mirrorPolicyPassword").value="";
    el("mirrorPolicyConfirm").checked=false;el("mirrorPolicyForm").hidden=false;
   });
   row.append(button);
  }
  root.append(row);
 }
 el("mirrorControlStatus").textContent=role==="MASTER"
  ?"选择管理项目并修改；必须再次输入主账号密码":"子账号只可查看此客户策略，修改权归主账号";
}
async function loadMirrorPolicy(clientId){
 if(!clientId||selectedMirrorClientId!==clientId)return;
 const serial=++mirrorOpsSerial,token=adminToken;hideMirrorPolicyForm();
 el("mirrorControlStatus").textContent="读取客户管理策略中";
 try{
  const {policy}=await api("/admin/client-controls?clientId="+encodeURIComponent(clientId));
  if(serial!==mirrorOpsSerial||clientId!==selectedMirrorClientId||token!==adminToken)return;
  renderMirrorPolicy(policy);
  try{
   const {items}=await api("/admin/client-control-audit?clientId="+encodeURIComponent(clientId));
   if(serial!==mirrorOpsSerial||clientId!==selectedMirrorClientId||token!==adminToken)return;
   const root=el("mirrorPolicyAudit");root.replaceChildren();
   if(!Array.isArray(items)||!items.length)root.append(plainNode("p","暂无权限修改记录","muted"));
   else for(const x of items.slice(0,8))
    root.append(itemRow((POLICY_TEXT[x.field]??x.field)+" · "+policyTextValue(x.field,x.previousValue)+" → "+
     policyTextValue(x.field,x.nextValue),"原因："+x.reason+" · "+dateLabel(x.recordedAt)));
  }catch(error){
   if(serial===mirrorOpsSerial)el("mirrorPolicyAudit").append(plainNode("p","审计读取失败："+error.message,"muted"));
  }
 }catch(error){
  if(serial!==mirrorOpsSerial||clientId!==selectedMirrorClientId||token!==adminToken)return;
  mirrorPolicy=null;el("mirrorControlRows").replaceChildren();
  el("mirrorControlStatus").textContent="策略读取失败："+error.message;
 }
}
async function refreshMirrorRequests(){
 const clientId=selectedMirrorClientId;if(!clientId)return;
 const serial=++mirrorRequestsSerial,token=adminToken,category=el("mirrorRequestCategory").value;
 hideMirrorReviewForm();const root=el("mirrorRequestRows");root.replaceChildren();
 el("mirrorRequestStatus").textContent="读取该客户申请中";
 try{
  const {items}=await api("/admin/workflow-requests?category="+category+"&clientId="+encodeURIComponent(clientId));
  if(serial!==mirrorRequestsSerial||clientId!==selectedMirrorClientId||token!==adminToken)return;
  if(!Array.isArray(items)||items.some(x=>x.clientId!==clientId))throw Error("服务端返回的客户归属不匹配");
  if(!items.length)root.append(plainNode("p","该客户暂无此类申请","muted"));
  for(const item of items){
   const row=document.createElement("div");row.className="mirror-request-row";
   const meta=document.createElement("div");meta.className="mirror-control-info";
   meta.append(plainNode("strong",caseSummary(item)),plainNode("small",dateLabel(item.createdAt)));
   row.append(meta);
   appendPrivateViewButton(row,item);
   const options=caseOptions(item);
   if(options.length){
    const button=document.createElement("button");button.type="button";button.className="outline";
    button.textContent="处理";
    button.addEventListener("click",()=>{
     mirrorCase=item;el("mirrorReviewHeading").textContent=caseSummary(item);
     const select=el("mirrorReviewDecision");select.replaceChildren();
     for(const [value,label] of options){
      const opt=document.createElement("option");opt.value=value;opt.textContent=label;select.append(opt);
     }
     el("mirrorReviewReason").value="";el("mirrorReviewConfirm").checked=false;
     el("mirrorReviewForm").hidden=false;
    });
    row.append(button);
   }
   root.append(row);
  }
  el("mirrorRequestStatus").textContent="显示 "+items.length+" 条申请；审核不执行真实收付款";
 }catch(error){
  if(serial===mirrorRequestsSerial&&clientId===selectedMirrorClientId&&token===adminToken)
   el("mirrorRequestStatus").textContent="申请读取失败："+error.message;
 }
}
document.querySelectorAll("[data-mirror-operation-tab]").forEach(b=>{
 b.addEventListener("click",()=>setMirrorOperationTab(b.dataset.mirrorOperationTab));
});
el("mirrorPolicyCancel").addEventListener("click",hideMirrorPolicyForm);
el("mirrorReviewCancel").addEventListener("click",hideMirrorReviewForm);
el("mirrorRequestCategory").addEventListener("change",()=>void refreshMirrorRequests());
el("mirrorRefreshControls").addEventListener("click",()=>{
 if(selectedMirrorClientId){void loadMirrorPolicy(selectedMirrorClientId);
  if(!el("mirrorRequestsPanel").hidden)void refreshMirrorRequests();}
});
el("mirrorPolicyForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const clientId=selectedMirrorClientId,field=mirrorPolicyField;
 if(role!=="MASTER"||!clientId||!field||!mirrorPolicy)return;
 const raw=el("mirrorPolicyValue").value;
 const value=["loginAllowed","withdrawalRequestsAllowed","loanRequestsAllowed"].includes(field)?raw==="true":raw;
 if(value===mirrorPolicy[field]){
  el("mirrorControlStatus").textContent="新值与当前状态相同";return;
 }
 const token=adminToken,button=el("mirrorPolicySave");button.disabled=true;
 const body={clientId,field,value,expectedVersion:mirrorPolicy.version,
  reason:el("mirrorPolicyReason").value.trim(),confirmPassword:el("mirrorPolicyPassword").value};
 try{
  const {policy}=await api("/admin/client-controls",{method:"PATCH",body});
  if(clientId!==selectedMirrorClientId||token!==adminToken)return;
  hideMirrorPolicyForm();renderMirrorPolicy(policy);
  el("mirrorControlStatus").textContent="已提交，正在重新读取策略和审计";
  await loadMirrorPolicy(clientId);
 }catch(error){
  if(clientId===selectedMirrorClientId&&token===adminToken)
   el("mirrorControlStatus").textContent="修改失败："+error.message;
 }finally{button.disabled=false;el("mirrorPolicyPassword").value="";}
});
el("mirrorReviewForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const item=mirrorCase,clientId=selectedMirrorClientId,token=adminToken;
 if(!item||!clientId||item.clientId!==clientId)return;
 const body={category:item.category,id:item.id,expectedStatus:item.status,
  status:el("mirrorReviewDecision").value,reason:el("mirrorReviewReason").value.trim()};
 const button=el("mirrorReviewSave");button.disabled=true;
 try{
  const result=await api("/admin/workflow-requests",{method:"PATCH",body});
  if(clientId!==selectedMirrorClientId||token!==adminToken)return;
  hideMirrorReviewForm();await refreshMirrorRequests();
  if(result.item?.settlementStatus==='INTERNAL_POSTED'){
   await selectMirrorClient(clientId);
   await refreshMirrorRequests();
  }
  el("mirrorRequestStatus").textContent=result.item?.settlementStatus==='INTERNAL_POSTED'?'审批成功，平台内部余额已更新':'申请审核已保存；未执行银行付款或第三方核验';
 }catch(error){
  if(clientId===selectedMirrorClientId&&token===adminToken)
   el("mirrorRequestStatus").textContent="审核失败："+error.message;
 }finally{button.disabled=false;}
});

let mirrorClockTimer;
function openMirrorDialog(){
 const dialog=el("mirrorDialog");
 if(dialog.open)return;
 if(typeof dialog.showModal==="function")dialog.showModal();
 else dialog.setAttribute("open","");
 const updateClock=()=>{el("mirrorClock").textContent=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false});};
 updateClock();
 mirrorClockTimer=document.defaultView.setInterval(updateClock,15000);
}
function closeMirrorDialog(){
 const dialog=el("mirrorDialog");
 if(!dialog.open)return;
 clearMirrorTradeCredentials();
 document.defaultView.clearInterval(mirrorClockTimer);
 if(typeof dialog.close==="function")dialog.close();
 else dialog.removeAttribute("open");
}
function clearMirrorTradeCredentials(){
 el("mirrorAppScreen").querySelectorAll('.mirror-trade-form input[type="password"]').forEach(input=>{input.value="";});
}
el("mirrorDialog").addEventListener("close",()=>{
 clearMirrorTradeCredentials();
 document.defaultView.clearInterval(mirrorClockTimer);
});
el("mirrorDialogClose").addEventListener("click",closeMirrorDialog);
el("mirrorDialog").addEventListener("click",event=>{
 if(event.target===el("mirrorDialog"))closeMirrorDialog();
});
async function selectMirrorClient(clientId){
  const match=mirrorClients.find(x=>x.id===clientId);
  if(!match)return;
  if(selectedMirrorClientId!==clientId||!el("mirrorDialog").open){
    mirrorChartSymbol=null;activateMirrorTab("watchlist");
  }
  selectedMirrorClientId=clientId;mirrorSnapshot=null;
  activateAdminPane("mirror");
  openMirrorDialog();
  clearMirrorOperations();
  el("mirrorOperations").hidden=false;
  el("mirrorOperationsCustomer").textContent=match.email;
  void loadMirrorPolicy(clientId);
  const mySerial=++mirrorSerial,usedToken=adminToken;
  el("mirrorEmail").textContent=match.email;el("mirrorCash").textContent="—";
  el("mirrorCurrency").textContent="—";el("mirrorUpdated").textContent="—";
  el("mirrorStatus").textContent="正在读取已授权的客户账户数据";
  el("refreshMirror").disabled=true;el("mirrorManageClient").disabled=false;el("mirrorQuickRequests").disabled=false;setMirrorScreen();
  try{
    const data=await api("/admin/mirror?clientId="+encodeURIComponent(clientId));
    if(mySerial!==mirrorSerial||adminToken!==usedToken||selectedMirrorClientId!==clientId)return;
    if(data.mode!=="READ_ONLY")throw Error("镜像模式不安全");
    if(data.client?.id!==clientId)throw Error("客户快照身份不匹配");
    mirrorSnapshot=data;
    el("mirrorEmail").textContent=data.client.email;
    el("mirrorCash").textContent=cashFmt(data.account.cashCents);
    el("mirrorCurrency").textContent=data.account.currency;
    el("mirrorUpdated").textContent="快照读取时间："+new Date(data.checkedAt).toLocaleString("zh-CN");
    el("mirrorStatus").textContent="快照已读取 · 管理操作在右侧";
    el("refreshMirror").disabled=false;el("mirrorManageClient").disabled=false;el("mirrorQuickRequests").disabled=false;setMirrorScreen();
  }catch(error){
    if(mySerial!==mirrorSerial||adminToken!==usedToken)return;
    el("mirrorStatus").textContent="快照不可用："+error.message+"；右侧管理操作可独立使用";setMirrorScreen();
  }
}
function activateMirrorTab(page){
  mirrorActiveTab=page;
  document.querySelectorAll("[data-mirror-tab]").forEach(button=>
    button.setAttribute("aria-selected",String(button.dataset.mirrorTab===page)));
  setMirrorScreen();
}
document.querySelectorAll("[data-mirror-tab]").forEach(button=>{
  button.addEventListener("click",()=>activateMirrorTab(button.dataset.mirrorTab));
});
el("refreshMirror").addEventListener("click",()=>{if(selectedMirrorClientId)selectMirrorClient(selectedMirrorClientId)});
el("refreshMirrorClients").addEventListener("click",refreshClients);


// Read-only administrative mirror access history. Server handles actor-level isolation.
async function refreshMirrorAudit(){
  const token=adminToken;
  const feedback=el("mirrorAuditStatus"),target=el("mirrorAuditList");
  feedback.textContent="正在读取审计记录";
  target.replaceChildren();
  try{
    const {items}=await api("/admin/mirror-audit");
    if(token!==adminToken)return;
    if(!Array.isArray(items))throw Error("无效的审计数据");
    if(!items.length){
      target.append(plainNode("p","暂无镜像访问记录","muted"));
    }else{
      for(const rec of items){
        const card=document.createElement("div");
        card.className="admin-list-row mirror-audit-row";
        const text=document.createElement("div");
        text.append(plainNode("div",rec.clientEmail),
                    plainNode("small","查看人员："+rec.actorEmail+" · "+new Date(rec.viewedAt).toLocaleString("zh-CN")));
        card.append(text);
        target.append(card);
      }
    }
    feedback.textContent="已加载 "+items.length+" 条访问记录（最多 80 条）";
  }catch(e){if(token===adminToken)feedback.textContent=e.message;}
}
el("refreshMirrorAudit").addEventListener("click",refreshMirrorAudit);

async function refreshMirrorStatus(){
  const token=adminToken;
  try{
    const response=await api("/admin/mirror-status");
    if(token!==adminToken)return;
    mirrorBackendReady=response.mode==="READ_ONLY"&&response.ready===true;
    el("mirrorAvailability").textContent=mirrorBackendReady
      ?"账户快照与访问审计已就绪；权限管理操作独立授权"
      :"账户快照暂不可用；仍可尝试通过受控后台管理接口操作";
  }catch(error){
    if(token!==adminToken)return;
    mirrorBackendReady=false;
    el("mirrorAvailability").textContent="镜像状态检查失败：" + error.message;
  }
  renderClientDirectory(mirrorClients);
}
el("mirrorClientSearch").addEventListener("input",()=>renderClientDirectory(mirrorClients));
let editingListingId=null;
let listingLookupSerial=0;
let listingLookupTimer;
let listingLookupSelection=null;
const listingMarketNames={US:"美国",HK:"香港",CN:"中国内地",MY:"马来西亚",RO:"罗马尼亚"};
function clearListingLookup(){
  clearTimeout(listingLookupTimer);
  listingLookupSerial++;
  el("listingLookup").hidden=el("listingType").value!=="STOCK";
  el("listingQuickPriceField").hidden=el("listingType").value==="STOCK";
  el("listingHoldingDaysField").hidden=el("listingType").value!=="STOCK";
  setText("listingStockQuote","");
  el("listingFundFields").hidden=el("listingType").value!=="FUND";
  el("listingLookupButton").disabled=false;
  el("listingLookupResults").replaceChildren();
  setText("listingLookupStatus","输入股票代码可查看匹配结果。");
}
el("listingType").addEventListener("change",clearListingLookup);
el("listingSymbol").addEventListener("input",()=>{
  const prior=listingLookupSelection;
  if(prior&&el("listingSymbol").value.trim().toUpperCase()!==prior.symbol){
    if(el("listingName").value===prior.name)el("listingName").value="";
    listingLookupSelection=null;
  }
  clearListingLookup();
  if(el("listingType").value==="STOCK"&&/^[A-Z0-9][A-Z0-9.-]{1,23}$/i.test(el("listingSymbol").value.trim())){
    listingLookupTimer=setTimeout(searchListingCode,450);
  }
});
el("listingLookupButton").addEventListener("click",searchListingCode);
async function searchListingCode(){
  if(role!=="MASTER"||el("listingType").value!=="STOCK")return;
  clearListingLookup();
  const code=el("listingSymbol").value.trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(code)){
    setText("listingLookupStatus","请先输入有效的股票代码。");return;
  }
  const serial=listingLookupSerial,token=adminToken;
  const current=()=>serial===listingLookupSerial&&token===adminToken&&role==="MASTER";
  el("listingLookupButton").disabled=true;
  setText("listingLookupStatus","正在搜索股票代码…");
  try{
    const {items,provider}=await api("/admin/stock-lookup?code="+encodeURIComponent(code));
    if(!current())return;
    const normalized=value=>/^\d+$/.test(value)?value.replace(/^0+(?=\d)/,""):value;
    const exact=items.filter(item=>normalized(item.symbol)===normalized(code));
    const fill=item=>{
      listingLookupSelection=item;
      el("listingMarket").value=item.market;
      el("listingSymbol").value=item.symbol;
      el("listingName").value=item.name;
    };
    const showStockQuote=async item=>{
      const active=listingLookupSerial;
      const show=text=>{
        if(active===listingLookupSerial&&token===adminToken&&listingLookupSelection===item)setText("listingStockQuote",text);
      };
      if(item.market!=="US"){show("该市场尚未开放实时报价交易。");return;}
      show("正在获取美股实时报价…");
      try{
        const quote=await api("/admin/stock-quote?market=US&symbol="+encodeURIComponent(item.symbol));
        show("每股 $"+cashFmt(quote.priceCents)+" USD · "+dateLabel(new Date(quote.timestampMs))+" · "+quote.source);
      }catch{show("实时报价暂不可用，股票交易在有效报价可用后开放。");}
    };
    const autoFill=exact.length===1&&!el("listingName").value.trim();
    if(autoFill){fill(exact[0]);void showStockQuote(exact[0]);}
    for(const item of items){
      const option=document.createElement("button");
      option.type="button";
      option.className="outline";
      option.textContent=[listingMarketNames[item.market],item.exchange||"交易所未登记",item.symbol,item.name].join(" · ");
      option.addEventListener("click",()=>{
        if(!current())return;
        fill(item);
        clearListingLookup();
        setText("listingLookupStatus","已填入 "+listingMarketNames[item.market]+" · "+item.symbol+"。");
        void showStockQuote(item);
      });
      el("listingLookupResults").append(option);
    }
    const scope=provider==="available"?"数据源目录及平台记录":provider==="unavailable"?
      "数据源暂不可用，仅查询平台记录和参考标的":"仅查询平台记录和参考标的，尚未接入更广的证券目录";
    setText("listingLookupStatus",(autoFill?"已自动填入唯一匹配。":items.length?"找到 "+items.length+" 条结果，点击填入。":"没有找到匹配代码，可手动填写。")+" "+scope+"。");
  }catch(error){
    if(current())setText("listingLookupStatus","搜索失败："+error.message);
  }finally{
    if(current())el("listingLookupButton").disabled=false;
  }
}
function clearListingEditor(){
  editingListingId=null;
  listingLookupSelection=null;
  el("listingForm").reset();
  clearListingLookup();
  el('listingQuickPurchase').hidden=false;
  el("listingSubmit").textContent="保存证券资料";
  el("listingCancelEdit").hidden=true;
}
function beginListingEdit(item){
  if(role!=="MASTER")return;
  if(item.status!=="DRAFT"){
    setText("listingFeedback","请先撤回为草稿，再编辑证券资料。");return;
  }
  editingListingId=item.id;
  listingLookupSelection=null;
  el('listingQuickPurchase').hidden=true;
  el("listingType").value=item.itemType;
  el("listingMarket").value=item.market;
  el("listingSymbol").value=item.symbol;
  el("listingName").value=item.name;
  el("listingStatus").value=item.status;
  clearListingLookup();
  el("listingSubmit").textContent="保存修改";
  el("listingCancelEdit").hidden=false;
  setText("listingFeedback","正在编辑 "+item.market+":"+item.symbol+"（草稿）");
}
function renderListingDirectory(items){
  const container=document.createElement("div");container.className="admin-list";
  const entries=Array.isArray(items)?items:[];
  if(!entries.length)container.append(itemRow("暂无记录",""));
  for(const item of entries){
    const published=item.status==="PUBLISHED";
    const row=itemRow(item.itemType+" · "+item.market+":"+item.symbol+" · "+item.name,
      published?"已发布 · 客户目录可见":"草稿 · 客户目录不可见");
    if(role==="MASTER"){
      const actions=document.createElement("div");actions.className="listing-actions";
      const edit=document.createElement("button");edit.type="button";edit.className="outline";
      edit.textContent="编辑";edit.disabled=published;
      edit.title=published?"请先撤回为草稿":"编辑证券资料";
      edit.addEventListener("click",()=>beginListingEdit(item));
      const toggle=document.createElement("button");toggle.type="button";toggle.className="outline";
      toggle.textContent=published?"撤回":"发布";
      toggle.addEventListener("click",async()=>{
        toggle.disabled=true;edit.disabled=true;
        try{
          const status=published?"DRAFT":"PUBLISHED";
          await api("/admin/listings",{method:"PATCH",body:{id:item.id,status}});
          if(editingListingId===item.id)clearListingEditor();
          setText("listingFeedback",(published?"已撤回 ":"已发布 ")+item.market+":"+item.symbol);
          await refreshListings();
        }catch(error){
          setText("listingFeedback",error.message);
          toggle.disabled=false;edit.disabled=published;
        }
      });
      const termsButton=document.createElement('button');termsButton.type='button';termsButton.className='outline';termsButton.textContent='折扣与交易设置';termsButton.addEventListener('click',()=>openProductTerms('LISTING',item));
      actions.append(edit,toggle,termsButton);row.append(actions);
    }
    container.append(row);
  }
  el("listings").replaceChildren(container);
}

/* Operational request reviewer. All visible results come from role-scoped API responses. */
const CASE_NAMES={FUNDING:"充值／提现",KYC:"身份认证工单",BANK_LINK:"银行卡登记"};
const CASE_STATUS={
 SUBMITTED:"已提交",UNDER_REVIEW:"审核中",APPROVED:"审核通过（未执行资金划转）",REJECTED:"已拒绝",
 AWAITING_EVIDENCE:"待补验证材料",NEEDS_INFORMATION:"需补充信息",
 MANUALLY_REVIEWED:"人工已审阅（未实名认证）",PENDING_VERIFICATION:"待银行核实"
};
let caseRows=[],selectedCase=null,selectedCaseRow=null,selectedCaseAction=null,caseSerial=0,fundingSerial=0;
function caseSummary(item){
 let status=CASE_STATUS[item.status]??item.status;
 if(item.category==='BANK_LINK'){
  if(item.bound)status='绑定已确认（人工审核）';
  else if(item.detailsStored&&item.status==='PENDING_VERIFICATION')status='待人工审核';
 }
 if(item.category==='FUNDING'&&item.settlementStatus==='INTERNAL_POSTED')status='已完成平台内部入账';
 if(item.category==="FUNDING"){
  const dollars=Number(item.amountCents)/100;
  const amount=Number.isFinite(dollars)?dollars.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
  return (item.kind==="DEPOSIT"?"充值申请":"提现申请")+" · "+amount+" USD · "+status;
 }
 if(item.category==="BANK_LINK")return (item.bankLabel??"银行")+" · 尾号 "+(item.accountLast4??"—")+" · "+status;
 return (CASE_NAMES[item.category]??"工单")+" · "+status;
}
function caseOptions(item){
 if(item.category==="FUNDING"){
  if(item.status==="SUBMITTED")return role==='MASTER'?[["APPROVED","同意并完成平台内部入账"],["UNDER_REVIEW","进入审核"]]:[["UNDER_REVIEW","进入审核"]];
  if(item.status==="UNDER_REVIEW"&&role==="MASTER")return [["APPROVED","同意并完成平台内部入账"],["REJECTED","拒绝申请"]];
 }else if(item.category==="KYC"){
  if(item.status==="AWAITING_EVIDENCE")return [["NEEDS_INFORMATION","要求补充资料"]];
  if(item.status==="NEEDS_INFORMATION")return [["UNDER_REVIEW","开始人工审阅"]];
  if(item.status==="UNDER_REVIEW"&&role==="MASTER")return [["MANUALLY_REVIEWED","人工已审阅（非实名认证）"],["REJECTED","拒绝工单"]];
 }else if(item.category==="BANK_LINK"){
  if(item.status==="PENDING_VERIFICATION")return role==="MASTER"
   ?[...(item.detailsStored?[["MANUALLY_REVIEWED","人工确认绑定"]]:[]),["NEEDS_INFORMATION","要求补充资料"],["REJECTED","拒绝登记"]]
   :[["NEEDS_INFORMATION","要求补充资料"]];
  if(item.status==="NEEDS_INFORMATION")return role==="MASTER"
   ?[["PENDING_VERIFICATION","资料已补充，重新核实"],["REJECTED","拒绝登记"]]
   :[["PENDING_VERIFICATION","资料已补充，重新核实"]];
 }
 return [];
}
function clearCaseSelection({restoreFocus=false}={}){
 const focusTarget=selectedCaseAction;
 selectedCaseRow?.classList.remove("workflow-row-selected");
 selectedCaseAction?.setAttribute("aria-expanded","false");
 selectedCaseRow=null;selectedCaseAction=null;selectedCase=null;
 el("workflowReviewForm").hidden=true;
 el("workflowDecision").replaceChildren();el("workflowReason").value="";el("workflowConfirm").checked=false;
 if(restoreFocus&&focusTarget?.isConnected)focusTarget.focus();
}
function renderCaseList(){
 const target=el("workflowItems");target.replaceChildren();
 if(!caseRows.length){target.append(plainNode("p","当前权限下暂无此类申请","muted"));return;}
 for(const item of caseRows){
  const row=itemRow(caseSummary(item),"客户编号："+item.clientId+" · 提交："+dateLabel(item.createdAt));
  appendPrivateViewButton(row,item);
  row.classList.add("workflow-row");
  const next=caseOptions(item);
  if(next.length){
   const action=document.createElement("button");action.type="button";action.className="outline";action.textContent="处理申请";
   action.setAttribute("aria-controls","workflowReviewForm");
   action.setAttribute("aria-expanded","false");
   action.setAttribute("aria-label","处理申请："+caseSummary(item));
   action.addEventListener("click",()=>{
    clearCaseSelection();
    selectedCase=item;selectedCaseRow=row;selectedCaseAction=action;
    row.classList.add("workflow-row-selected");
    action.setAttribute("aria-expanded","true");
    el("workflowSelection").textContent=caseSummary(item)+" · "+item.clientId;
    const select=el("workflowDecision");select.replaceChildren();
    for(const [value,label] of next){
     const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);
    }
    const form=el("workflowReviewForm");
    form.hidden=false;
    el("workflowStatus").textContent="已选中申请，审核表单已展开。请核对申请信息后再确认。";
    const reduceMotion=form.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true;
    form.scrollIntoView?.({behavior:reduceMotion?"auto":"smooth",block:"center"});
    select.focus({preventScroll:true});
   });
   row.append(action);
  }
  target.append(row);
 }
}
async function refreshCaseList(){
 const cat=el("workflowCategory").value,serial=++caseSerial,usedToken=adminToken;
 clearCaseSelection();el("workflowItems").replaceChildren();el("workflowStatus").textContent="正在读取申请";
 try{
  const data=await api("/admin/workflow-requests?category="+encodeURIComponent(cat));
  if(serial!==caseSerial||adminToken!==usedToken)return;
  caseRows=Array.isArray(data.items)?data.items:[];renderCaseList();
  el("workflowStatus").textContent="共 "+caseRows.length+" 条申请。资金同意后完成平台内部记账，不发起银行付款。";
 }catch(error){
  if(serial!==caseSerial||adminToken!==usedToken)return;
  caseRows=[];el("workflowStatus").textContent="读取失败："+error.message;
 }
}
function fundingMoney(cents){
 const amount=BigInt(cents);return '$'+(amount/100n).toLocaleString('en-US')+'.'+String(amount%100n).padStart(2,'0');
}
function clearFundingDashboard(message='正在读取资金申请'){
 for(const id of ['dashboardDepositAmount','dashboardWithdrawAmount','dashboardPendingCount','dashboardDepositPosted','dashboardWithdrawPosted','dashboardDepositCount','dashboardWithdrawCount'])el(id).textContent='—';
 el('dashboardFundingRows').replaceChildren();el('dashboardFundingBreakdown').replaceChildren();el('dashboardFundingStatus').textContent=message;
}
function renderFundingDashboard(rows){
 const sum=(kind,source=rows)=>source.filter(x=>x.kind===kind).reduce((total,x)=>total+BigInt(x.amountCents),0n);
 for(const x of rows)if(x.category!=='FUNDING'||!['DEPOSIT','WITHDRAWAL'].includes(x.kind)||x.currency!=='USD'||!Number.isSafeInteger(x.amountCents)||x.amountCents<=0)throw Error('资金申请金额或币种不正确');
 el('dashboardDepositAmount').textContent=fundingMoney(sum('DEPOSIT'));
 el('dashboardWithdrawAmount').textContent=fundingMoney(sum('WITHDRAWAL'));
 el('dashboardDepositCount').textContent=rows.filter(x=>x.kind==='DEPOSIT').length+' 笔充值申请';
 el('dashboardWithdrawCount').textContent=rows.filter(x=>x.kind==='WITHDRAWAL').length+' 笔提现申请';
 el('dashboardPendingCount').textContent=String(rows.filter(x=>['SUBMITTED','UNDER_REVIEW'].includes(x.status)).length);
 const posted=rows.filter(x=>x.settlementStatus==='INTERNAL_POSTED');
 el('dashboardDepositPosted').textContent=fundingMoney(sum('DEPOSIT',posted));
 el('dashboardWithdrawPosted').textContent=fundingMoney(sum('WITHDRAWAL',posted));
 const target=el('dashboardFundingRows');target.replaceChildren();
 for(const x of rows.slice(0,10)){
  const row=document.createElement('tr');
  const client=plainNode('td',x.clientId);
  if(mirrorClients.some(item=>item.id===x.clientId)){
   const open=plainNode('button',x.clientId,'dashboard-client-link');
   open.type='button';open.setAttribute('aria-label','查看客户 '+x.clientId);
   open.addEventListener('click',()=>{activateAdminPane('clients');openClientDetail(x.clientId);});
   client.replaceChildren(open);
  }
  row.append(plainNode('td',x.kind==='DEPOSIT'?'充值申请':'提现申请'),plainNode('td',fundingMoney(x.amountCents)),client,
   plainNode('td',x.settlementStatus==='INTERNAL_POSTED'?'成功 · 内部已记账':CASE_STATUS[x.status]??x.status),plainNode('td',dateLabel(x.createdAt)));
  target.append(row);
 }
 if(!rows.length){const row=document.createElement('tr'),cell=plainNode('td','暂无进出资金申请');cell.colSpan=5;row.append(cell);target.append(row);}
 const breakdown=el('dashboardFundingBreakdown');breakdown.replaceChildren();
 for(const [status,label] of [['SUBMITTED','待受理'],['UNDER_REVIEW','审核中'],['APPROVED','已通过'],['REJECTED','已拒绝']]){
  const line=plainNode('div','', 'dashboard-status-row');line.append(plainNode('span',label),plainNode('strong',String(rows.filter(x=>x.status===status).length)));breakdown.append(line);
 }
 const totals=plainNode('div','', 'dashboard-status-row');totals.append(plainNode('span','内部已记账'),plainNode('strong',String(posted.length)));breakdown.append(totals);
 el('dashboardFundingStatus').textContent='汇总当前权限内最近最多 300 条申请，共 '+rows.length+' 条。明细显示最近 10 条。已入账金额为平台账面记录。更新于 '+dateLabel(new Date().toISOString());
}
async function refreshFundingOverview(){
 if(!adminToken)return;
 const serial=++fundingSerial,usedToken=adminToken;
 clearFundingDashboard();
 el("fundingSummaryStatus").textContent="正在读取资金申请";
 try{
  const data=await api("/admin/workflow-requests?category=FUNDING");
  if(serial!==fundingSerial||adminToken!==usedToken)return;
  const rows=Array.isArray(data.items)?data.items:[];
  renderFundingDashboard(rows);
  const count=pred=>String(rows.filter(pred).length);
  el("depositRequestTotal").textContent=count(x=>x.kind==="DEPOSIT");
  el("withdrawRequestTotal").textContent=count(x=>x.kind==="WITHDRAWAL");
  el("pendingRequestTotal").textContent=count(x=>x.status==="SUBMITTED"||x.status==="UNDER_REVIEW");
  el("approvedRequestTotal").textContent=count(x=>x.status==="APPROVED");
  const target=el("fundingRequestRows");target.replaceChildren();
  for(const item of rows.slice(0,100))target.append(itemRow(caseSummary(item),"客户编号："+item.clientId+" · "+dateLabel(item.createdAt)));
  if(!rows.length)target.append(plainNode("p","暂无资金申请","muted"));
  el("fundingSummaryStatus").textContent="仅统计申请记录，实际资金划转尚未接入。";
 }catch(error){if(serial===fundingSerial&&adminToken===usedToken){clearFundingDashboard('资金数据读取失败：'+error.message);el("fundingRequestRows").replaceChildren();for(const id of ['depositRequestTotal','withdrawRequestTotal','pendingRequestTotal','approvedRequestTotal'])el(id).textContent='—';el("fundingSummaryStatus").textContent="读取失败："+error.message;}}
}
el('refreshDashboardFunding').addEventListener('click',()=>void refreshFundingOverview());
el('dashboardOpenTreasury').addEventListener('click',()=>activateAdminPane('treasury'));
el('dashboardOpenApprovals').addEventListener('click',()=>{el('workflowCategory').value='FUNDING';activateAdminPane('approvals');});
el("workflowCategory").addEventListener("change",()=>{void refreshCaseList()});
el("workflowRefresh").addEventListener("click",()=>{void refreshCaseList()});
el("refreshFundingSummary").addEventListener("click",()=>{void refreshFundingOverview()});
el("workflowCancel").addEventListener("click",()=>clearCaseSelection({restoreFocus:true}));
el("workflowReviewForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!selectedCase||!el("workflowConfirm").checked){el("workflowStatus").textContent="请先选择申请并确认";return;}
 const body={category:selectedCase.category,id:selectedCase.id,expectedStatus:selectedCase.status,
  status:el("workflowDecision").value,reason:el("workflowReason").value.trim()};
 const button=el("workflowSubmit");button.disabled=true;
 try{
  const result=await api("/admin/workflow-requests",{method:"PATCH",body});
  clearCaseSelection();await refreshCaseList();
  el("workflowStatus").textContent=result.item?.settlementStatus==='INTERNAL_POSTED'?'审批成功，平台内部余额与流水已更新。':'审核记录已保存；未执行银行付款或第三方核验。';
 }catch(error){el("workflowStatus").textContent="保存失败："+error.message;}
 finally{button.disabled=false;}
});


/* Commodity directory is administrator-managed and explicitly not live market data. */
let commodityEditingId=null,commodityRows=[],commoditySerial=0;
const COMMODITY_CATEGORIES={PRECIOUS_METAL:"贵金属",ENERGY:"能源",AGRICULTURE:"农产品",
 INDUSTRIAL_METAL:"工业金属",OTHER:"其他"};
function commodityPrice(value){
 if(value===null||value===undefined)return "未提供";
 const dollars=Number(value)/100;
 return Number.isFinite(dollars)?dollars.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" USD":"—";
}
function commodityCents(value){
 const str=String(value??"").trim();
 if(!str)return null;
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(str))throw Error("参考价格式不正确");
 const [whole,frac=""]=str.split(".");
 const cents=Number(whole)*100+Number(frac.padEnd(2,"0"));
 if(!Number.isSafeInteger(cents)||cents<1||cents>1000000000000)throw Error("参考价超出范围");
 return cents;
}
function resetCommodityEditor(){
 commodityEditingId=null;el("commodityForm").reset();
 el('commodityQuickPurchase').hidden=false;
 el("commoditySku").disabled=false;el("commoditySubmit").textContent="创建商品";
 el("commodityCancel").hidden=true;el("commodityMinQty").value="1";
}
function openCommodityEditor(item){
 if(role!=="MASTER")return;
 commodityEditingId=item.id;
 el('commodityQuickPurchase').hidden=true;
 el("commoditySku").value=item.sku;el("commoditySku").disabled=true;
 el("commodityName").value=item.name;el("commodityCategory").value=item.category;
 el("commodityUnit").value=item.unit;el("commodityMinQty").value=String(item.minimumQuantity);
 el("commodityIndicativePrice").value=item.indicativePriceCents===null?"":String(item.indicativePriceCents/100);
 el("commodityStatus").value=item.status;el("commodityReason").value="";
 el("commoditySubmit").textContent="保存修改";el("commodityCancel").hidden=false;
 el("commodityForm").scrollIntoView?.({block:"nearest"});
}
function renderCommodityItems(items){
 const target=el("commodityItems");target.replaceChildren();
 if(!items.length){target.append(plainNode("p","暂无商品目录记录","muted"));return;}
 for(const item of items){
  const row=itemRow(item.sku+" · "+item.name,COMMODITY_CATEGORIES[item.category]+" · "+
   item.unit+" · 最低数量 "+item.minimumQuantity+" · "+
   commodityPrice(item.indicativePriceCents)+" · "+item.status+
   " · 人工参考价 / 非交易所实时报价");
  if(role==="MASTER"){
   const btn=document.createElement("button");btn.type="button";btn.className="outline";
   btn.textContent="编辑";btn.addEventListener("click",()=>openCommodityEditor(item));row.append(btn);
   const termsButton=document.createElement('button');termsButton.type='button';termsButton.className='outline';termsButton.textContent='折扣与交易设置';termsButton.addEventListener('click',()=>openProductTerms('COMMODITY',item));row.append(termsButton);
  }
  target.append(row);
 }
}
async function refreshCommodityItems(){
 const serial=++commoditySerial,usedToken=adminToken;
 el("commodityFeedback").textContent="正在读取商品目录";
 try{
  const r=await api("/admin/commodities");
  if(serial!==commoditySerial||usedToken!==adminToken)return;
  commodityRows=Array.isArray(r.items)?r.items:[];
  renderCommodityItems(commodityRows);
  el("commodityFeedback").textContent="已同步 "+commodityRows.length+" 条商品目录记录";
 }catch(error){
  if(serial===commoditySerial&&usedToken===adminToken)el("commodityFeedback").textContent="读取失败："+error.message;
 }
}
el("commodityRefresh").addEventListener("click",()=>void refreshCommodityItems());
el("commodityCancel").addEventListener("click",resetCommodityEditor);
el("commodityForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(role!=="MASTER")return;
 const btn=el("commoditySubmit");btn.disabled=true;
 try{
  const data={
   name:el("commodityName").value.trim(),category:el("commodityCategory").value,
   unit:el("commodityUnit").value.trim(),minimumQuantity:Number(el("commodityMinQty").value),
   indicativePriceCents:commodityCents(el("commodityIndicativePrice").value),
   status:el("commodityStatus").value,reason:el("commodityReason").value.trim()
  };
  if(commodityEditingId)await api("/admin/commodities",{method:"PATCH",body:{id:commodityEditingId,...data}});
  else{
   includeQuickPurchase('commodity',data);
   await api("/admin/commodities",{method:"POST",body:{sku:el("commoditySku").value.trim().toUpperCase(),...data}});
  }
  resetCommodityEditor();await refreshCommodityItems();
  el("commodityFeedback").textContent=data.purchaseTerms?'商品已上架，前台可购买':'商品目录已保存';
 }catch(error){el("commodityFeedback").textContent="保存失败："+error.message;}
 finally{btn.disabled=false;}
});

/* Scoped support chat; all messages persist in PostgreSQL and inherit admin ownership checks. */
let selectedSupportThread=null,supportSerial=0,supportLoading=false;
function resetSupportWorkspace(){
 supportSerial++;selectedSupportThread=null;supportLoading=false;
 el("supportThreads").replaceChildren();el("supportMessages").replaceChildren();
 el("supportReplyForm").hidden=true;el("supportStatusForm").hidden=true;
 el("supportStatusToggle").hidden=true;
 el("supportReplyMessage").value="";el("supportStatusReason").value="";
 el("supportConversationTitle").textContent="选择一位客户";
 el("supportListStatus").textContent="";el("supportActionStatus").textContent="";
}
async function refreshSupportThreads(){
 const serial=++supportSerial,token=adminToken;
 el("supportListStatus").textContent="正在读取客服会话";
 try{
  const data=await api("/admin/support");
  if(serial!==supportSerial||token!==adminToken)return;
  const items=Array.isArray(data.items)?data.items:[];
  const root=el("supportThreads");root.replaceChildren();
  if(!items.length)root.append(plainNode("p","暂无客户客服消息","muted"));
  for(const item of items){
   const row=itemRow(item.clientEmail??item.clientId,item.status==="CLOSED"?"已关闭":"进行中");
   const btn=document.createElement("button");btn.type="button";btn.className="outline";
   btn.textContent="打开会话";btn.addEventListener("click",()=>void selectSupportThread(item.id));
   row.append(btn);root.append(row);
  }
  el("supportListStatus").textContent="当前权限可见 "+items.length+" 条会话";
 }catch(error){if(serial===supportSerial)el("supportListStatus").textContent="读取失败："+error.message;}
}
async function selectSupportThread(threadId){
 if(!threadId)return;
 const serial=++supportSerial,token=adminToken;
 supportLoading=true;el("supportActionStatus").textContent="读取客服消息中";
 el("supportMessages").replaceChildren();el("supportReplyForm").hidden=true;
 el("supportStatusForm").hidden=true;el("supportStatusToggle").hidden=true;
 try{
  const response=await api("/admin/support-thread?threadId="+encodeURIComponent(threadId));
  if(serial!==supportSerial||token!==adminToken)return;
  selectedSupportThread=response.thread;
  el("supportConversationTitle").textContent="客户 "+response.thread.clientId.slice(0,12);
  const target=el("supportMessages");target.replaceChildren();
  for(const msg of response.messages??[]){
   const box=document.createElement("article");
   box.className="support-message"+(msg.senderUserId===response.thread.clientId?" from-client":" from-admin");
   const content=document.createElement("p");content.textContent=msg.body;
   const stamp=document.createElement("small");stamp.textContent=dateLabel(msg.createdAt);
   box.append(content,stamp);target.append(box);
  }
  el("supportReplyForm").hidden=response.thread.status!=="OPEN";
  el("supportStatusToggle").hidden=false;
  el("supportStatusToggle").textContent=response.thread.status==="OPEN"?"关闭会话":"重新开启";
  el("supportActionStatus").textContent="已同步客服消息 · "+(response.messages?.length??0)+" 条";
 }catch(error){if(serial===supportSerial)el("supportActionStatus").textContent="读取失败："+error.message;}
 finally{if(serial===supportSerial)supportLoading=false;}
}
el("supportRefresh").addEventListener("click",()=>void refreshSupportThreads());
el("supportStatusToggle").addEventListener("click",()=>{
 if(!selectedSupportThread)return;
 el("supportStatusForm").hidden=false;el("supportStatusReason").value="";
});
el("supportStatusCancel").addEventListener("click",()=>{el("supportStatusForm").hidden=true;});
el("supportReplyForm").addEventListener("submit",async e=>{
 e.preventDefault();const thread=selectedSupportThread;if(!thread||supportLoading)return;
 const token=adminToken,btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;
 try{
  await api("/admin/support",{method:"POST",body:{threadId:thread.id,message:el("supportReplyMessage").value.trim()}});
  if(token!==adminToken||thread.id!==selectedSupportThread?.id)return;
  el("supportReplyMessage").value="";await selectSupportThread(thread.id);
  await refreshSupportThreads();
 }catch(error){el("supportActionStatus").textContent="发送失败："+error.message;}
 finally{btn.disabled=false;}
});
el("supportStatusForm").addEventListener("submit",async e=>{
 e.preventDefault();const thread=selectedSupportThread;if(!thread)return;
 const token=adminToken,btn=el("supportStatusConfirm");btn.disabled=true;
 try{
  const status=thread.status==="OPEN"?"CLOSED":"OPEN";
  await api("/admin/support",{method:"PATCH",body:{threadId:thread.id,expectedStatus:thread.status,status,
   reason:el("supportStatusReason").value.trim()}});
  if(token!==adminToken||thread.id!==selectedSupportThread?.id)return;
  el("supportStatusForm").hidden=true;await selectSupportThread(thread.id);
  await refreshSupportThreads();
 }catch(error){el("supportActionStatus").textContent="状态修改失败："+error.message;}
 finally{btn.disabled=false;}
});

async function refreshListings(){
  const token=adminToken;
  try{
    const data=await api("/admin/listings");
    if(token!==adminToken)return;
    const items=Array.isArray(data.items)?data.items:[];
    el("adminListingCount").textContent=String(items.length);
    renderListingDirectory(items);
  }catch(error){if(token===adminToken)setText("listingFeedback",error.message)}
}
async function showDashboard(){
  if(!adminToken){el("adminWorkspace").hidden=true;return;}
  const token=adminToken;
  try{
    const me=await api("/admin/me");
    if(token!==adminToken)return;
    role=me.role;
    setText("adminRole",role==="MASTER"?"主账户":"子账户");
    document.querySelectorAll("[data-required-role]").forEach(node=>node.hidden=node.dataset.requiredRole!==role);
    activateAdminPane("dashboard");
    el("adminWorkspace").hidden=false;
    el("admin-login").hidden=true;
    el("bootstrapPanel").hidden=true;
    el("adminTopbar").hidden=false;
    el("subadminForm").hidden=role!=="MASTER";
    el("listingForm").hidden=role!=="MASTER";
    el("commodityForm").hidden=role!=="MASTER";
    await Promise.all([refreshSubadmins(),refreshClients(),refreshListings(),refreshMirrorStatus()]);
  }catch{
    if(token===adminToken)resetAdminSession("登录已失效，请重新登录。");
  }
}
let pendingAdminTotpToken=null;
el("adminLoginForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/login",{method:"POST",token:null,body:{
      email:el("adminEmail").value,password:el("adminPassword").value
    }});
    pendingAdminTotpToken=result.pendingToken;
    el("totpSetupInfo").hidden=!result.totpSetupRequired;
    if(result.totpSetupRequired)setText("totpSecretText",result.secret);
    el("adminLoginForm").hidden=true;
    el("adminTotpForm").hidden=false;
    el("totpCode").value="";
    setText("loginFeedback",result.totpSetupRequired?"首次登录，请使用验证器 App 绑定并输入验证码":"请输入两步验证码");
    el("totpCode").focus();
  }catch(error){setText("loginFeedback",error.message)}
  finally{button.disabled=false;}
});
el("adminTotpForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;
  try{
    const result=await api("/admin/totp/verify",{method:"POST",token:null,body:{
      pendingToken:pendingAdminTotpToken,code:el("totpCode").value.trim()
    }});
    if(result.role!==selectedAdminRole){
      void api("/admin/logout",{method:"POST",token:result.token}).catch(()=>{});
      throw new Error("该账号不属于所选角色，请切换主账户或子账户");
    }
    adminToken=result.token;
    sessionStorage.setItem("gsp_admin_token",adminToken);
    pendingAdminTotpToken=null;
    el("adminPassword").value="";el("totpCode").value="";
    setText("loginFeedback","管理员验证成功");
    await showDashboard();
  }catch(error){setText("loginFeedback",error.message)}
  finally{button.disabled=false;}
});
el("totpBack").addEventListener("click",()=>{
  pendingAdminTotpToken=null;
  el("adminTotpForm").hidden=true;
  el("adminLoginForm").hidden=false;
  el("totpCode").value="";
  setText("loginFeedback","");
});
el("bootstrapForm").addEventListener("submit",async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/bootstrap",{method:"POST",token:null,body:{
      email:el("bootstrapEmail").value.trim(),password:el("bootstrapPassword").value,setupKey:el("bootstrapKey").value
    }});
    el("bootstrapPassword").value="";el("bootstrapKey").value="";
    setText("bootstrapFeedback",result.ready?"主账户创建成功。现在返回登录页面，使用刚设置的邮箱和密码登录。":"创建失败");
  }catch(error){setText("bootstrapFeedback",error.message);}
  finally{button.disabled=false;}
});
el("recoverForm").addEventListener("submit",async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/recover-pending-master",{method:"POST",token:null,body:{
      email:el("recoverEmail").value.trim(),password:el("recoverPassword").value,setupKey:el("recoverKey").value
    }});
    el("recoverPassword").value="";el("recoverKey").value="";
    setText("recoverFeedback",result.ready?"密码已经更新。请返回登录页面，输入主账户邮箱与新密码。":"更新失败");
  }catch(error){setText("recoverFeedback",error.message);}
  finally{button.disabled=false;}
});
el("subadminForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const data=await api("/admin/subaccounts",{method:"POST",body:{
      email:el("subadminEmail").value,password:el("subadminPassword").value
    }});
    el("subadminPassword").value="";
    const box=el("subadminProvisioning");box.hidden=false;box.replaceChildren();
    const heading=document.createElement("p");heading.textContent="子账户已创建，请将邀请码交给对应管理员。";
    const code=document.createElement("code");code.textContent="邀请码："+data.inviteCode;
    box.append(heading,code);
    setText("subadminFeedback","子管理员使用邮箱和所设置的密码直接登录。");
    await refreshSubadmins();
  }catch(error){setText("subadminFeedback",error.message)}
  finally{button.disabled=false;}
});
el("listingForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(role!=="MASTER"){setText("listingFeedback","只有总管理员可以修改证券资料");return;}
  const button=el("listingSubmit");button.disabled=true;
  try{
    const body={
      itemType:el("listingType").value,market:el("listingMarket").value,
      symbol:el("listingSymbol").value.toUpperCase().trim(),
      name:el("listingName").value.trim(),status:el("listingStatus").value
    };
    if(!editingListingId)includeQuickPurchase('listing',body);
    await api("/admin/listings",editingListingId
      ?{method:"PATCH",body:{id:editingListingId,...body}}
      :{method:"POST",body});
    clearListingEditor();
    setText("listingFeedback","已保存证券资料 "+body.symbol+" · "+(body.purchaseTerms?'已发布并开启购买':body.status==="PUBLISHED"?"已发布":"草稿"));
    await refreshListings();
  }catch(error){setText("listingFeedback",error.message)}
  finally{button.disabled=false;}
});
el("listingCancelEdit").addEventListener("click",()=>{
  clearListingEditor();setText("listingFeedback","已取消编辑");
});
el("closeClientDetail").addEventListener("click",closeClientDetail);
el("closeSubadminDetail").addEventListener("click",closeSubadminDetail);
el("clientDetailMirror").addEventListener("click",()=>{
  if(selectedClientDetailId)void selectMirrorClient(selectedClientDetailId);
});
el("refreshSubadmins").addEventListener("click",refreshSubadmins);
el("refreshClients").addEventListener("click",refreshClients);
el("refreshListings").addEventListener("click",refreshListings);
function resetAdminSession(message){
  closePrivateData();
  closeProductTerms();
  sessionStorage.removeItem("gsp_admin_token");adminToken=null;role=null;
  mirrorSerial++;mirrorSnapshot=null;selectedMirrorClientId=null;mirrorClients=[];mirrorBackendReady=false;
  mirrorPurchaseKeys.clear();
  clearMirrorOperations();closeMirrorDialog();
  subadminDirectory=[];closeClientDetail();closeSubadminDetail();
  caseSerial++;fundingSerial++;caseRows=[];clearCaseSelection();
  el("workflowItems").replaceChildren();el("fundingRequestRows").replaceChildren();
  commoditySerial++;commodityRows=[];resetCommodityEditor();el("commodityItems").replaceChildren();
  resetSupportWorkspace();
  unifiedAuditSerial++;
  clearFundingDashboard('登录后读取资金数据');
  for(const id of ["clients","subadmins","listings","mirrorAuditList","unifiedAuditList","subadminProvisioning"])
    el(id).replaceChildren();
  for(const id of ["adminClientCount","adminSubadminCount","adminListingCount","depositRequestTotal",
    "withdrawRequestTotal","pendingRequestTotal","approvedRequestTotal"])el(id).textContent="—";
  for(const id of ["mirrorAuditStatus","unifiedAuditStatus","adminRole","clientDetailHeadline","clientDetailSubhead",
    "workflowSelection","workflowStatus","fundingSummaryStatus","listingFeedback","subadminFeedback"])
    el(id).textContent="";
  el("adminWorkspace").querySelectorAll("form").forEach(form=>form.reset());
  clearListingEditor();
  el("mirrorAvailability").textContent="未登录";
  el("mirrorClientSearch").value="";
  el("mirrorMatchCount").textContent="";
  el("mirrorEmail").textContent="尚未选择";el("mirrorCash").textContent="—";el("mirrorManageClient").disabled=true;el("mirrorQuickRequests").disabled=true;setMirrorScreen();
  el("mirrorClientList").replaceChildren();
  setMobileNavExpanded(false);
  el("adminWorkspace").hidden=true;el("adminTopbar").hidden=true;el("admin-login").hidden=false;el("bootstrapPanel").hidden=true;
  pendingAdminTotpToken=null;
  el("adminLoginForm").hidden=false;el("adminTotpForm").hidden=true;el("totpSetupInfo").hidden=true;el("totpCode").value="";
  setText("loginFeedback",message);
}
el("adminLogout").addEventListener("click",()=>{
  const expiredToken=adminToken;
  resetAdminSession("已退出管理后台。");
  if(expiredToken)void api("/admin/logout",{method:"POST",token:expiredToken}).catch(()=>{});
});
/** Independent client-side navigation: authorization is always enforced by /api/admin/*. */
function setMobileNavExpanded(expanded){
  const menu=el("adminMobileNavToggle");
  el("adminWorkspace").querySelector(".admin-nav").dataset.mobileOpen=String(Boolean(expanded));
  menu.setAttribute("aria-expanded",String(Boolean(expanded)));
  menu.textContent=expanded?"收起菜单":"打开菜单";
}
el("adminMobileNavToggle").addEventListener("click",()=>{
  setMobileNavExpanded(el("adminMobileNavToggle").getAttribute("aria-expanded")!=="true");
});
let unifiedAuditSerial=0;
async function refreshUnifiedAudit(){
 if(!adminToken)return;
 const serial=++unifiedAuditSerial,token=adminToken;
 el("unifiedAuditStatus").textContent="正在读取已授权审计记录";
 try{
  const {items}=await api("/admin/audit-events?limit=100");
  if(serial!==unifiedAuditSerial||token!==adminToken)return;
  const list=el("unifiedAuditList");list.replaceChildren();
  if(!Array.isArray(items)||!items.length)list.append(plainNode("p","当前权限暂无操作记录","muted"));
  else for(const x of items){
   const title=(x.eventType??"EVENT")+" · "+(x.action??"记录");
   const context="对象："+(x.clientId??"系统级")+" · 操作人："+(x.actorId??"—")+
    " · "+dateLabel(x.recordedAt);
   const row=itemRow(title,context);
   const reason=document.createElement("small");reason.textContent=x.description??"";
   row.append(reason);list.append(row);
  }
  el("unifiedAuditStatus").textContent="已读取 "+(items?.length??0)+" 条授权范围内的操作记录";
 }catch(error){
  if(serial===unifiedAuditSerial)el("unifiedAuditStatus").textContent="读取失败："+error.message;
 }
}
el("refreshUnifiedAudit").addEventListener("click",()=>void refreshUnifiedAudit());
function activateAdminPane(page) {
  if(page!=="mirror")closeMirrorDialog();
  if(page==="clients")closeClientDetail();
  if(page==="audit"){void refreshMirrorAudit();void refreshUnifiedAudit();}
  if(page==="approvals")void refreshCaseList();
  if(page==="treasury")void refreshFundingOverview();
  if(page==="dashboard")void refreshFundingOverview();
  if(page==="commodities")void refreshCommodityItems();
  if(page==="support")void refreshSupportThreads();
  const target=document.querySelector('[data-pane="'+page+'"]');
  if(!target)return;
  const nav=document.querySelector('[data-admin-page="'+page+'"]');
  if(nav?.hidden)return;
  el('adminPageTitle').textContent=target.querySelector('.pane-title h2')?.textContent??nav?.textContent??'管理工作台';
  document.querySelectorAll(".admin-pane").forEach(pane=>pane.hidden=pane!==target);
  document.querySelectorAll("[data-admin-page]").forEach(button=>{
    if(button===nav)button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
  setMobileNavExpanded(false);
}
document.querySelectorAll("[data-admin-page]").forEach(button=>{
  button.addEventListener("click",()=>activateAdminPane(button.dataset.adminPage));
});
el("commodityOpenSecurities").addEventListener("click",()=>{
  activateAdminPane("catalog");
  el("listingSymbol").focus();
});
document.querySelectorAll("[data-dashboard-open]").forEach(button=>{
  button.addEventListener("click",()=>activateAdminPane(button.dataset.dashboardOpen));
});

let productTermsState=null,productTermsSerial=0;
let privateViewSerial=0;
function closePrivateData(){
 privateViewSerial++;el('privateDataContent').replaceChildren();el('privateDataFeedback').textContent='';
 const dialog=el('privateDataDialog');if(dialog.open&&typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
}
function appendPrivateViewButton(row,item){
 if(!item.documentsStored&&!item.detailsStored)return;
 const button=document.createElement('button');button.type='button';button.className='outline';button.textContent='查看加密审核资料';
 button.addEventListener('click',()=>void viewPrivateData(item));row.append(button);
}
async function viewPrivateData(item){
 closePrivateData();const serial=++privateViewSerial,usedToken=adminToken;
 const dialog=el('privateDataDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
 el('privateDataFeedback').textContent='正在读取授权范围内的资料…';
 try{
  const result=await api('/admin/private-data?kind='+item.category+'&id='+encodeURIComponent(item.id));
  if(serial!==privateViewSerial||usedToken!==adminToken)return;
  const root=el('privateDataContent');
  if(item.category==='BANK_LINK')root.append(plainNode('p','银行：'+result.payload.bankName),plainNode('p','银行卡／账户号码：'+result.payload.accountNumber));
  else for(const [side,label] of [['front','身份证正面'],['back','身份证反面']]){
   const value=result.payload[side];if(!['image/png','image/jpeg'].includes(value?.mime)||typeof value.base64!=='string')throw Error('资料格式不正确');
   const image=document.createElement('img');image.alt=label;image.style.cssText='display:block;max-width:100%;max-height:420px;object-fit:contain;margin:10px 0 20px';image.src='data:'+value.mime+';base64,'+value.base64;root.append(plainNode('h3',label),image);
  }
  el('privateDataFeedback').textContent='资料已读取，查看已记录审计。请人工核对后处理申请。';
 }catch(error){if(serial===privateViewSerial&&usedToken===adminToken){el('privateDataContent').replaceChildren();el('privateDataFeedback').textContent='无法读取资料：'+error.message;}}
}
el('closePrivateData').addEventListener('click',closePrivateData);
el('privateDataDialog').addEventListener('cancel',()=>{privateViewSerial++;el('privateDataContent').replaceChildren();});
function closeProductTerms(){
 productTermsSerial++;productTermsState=null;el('productTermsPassword').value='';el('productTermsForm').reset();
 const dialog=el('productTermsDialog');if(dialog.open&&typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
}
async function openProductTerms(kind,item){
 if(role!=='MASTER')return;
 closeProductTerms();const serial=++productTermsSerial,usedToken=adminToken;
 el('productTermsName').textContent=item.name+' · '+(item.sku??item.symbol);
 el('productTermsFeedback').textContent='正在读取交易设置';el('productTermsSave').disabled=true;
 const dialog=el('productTermsDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
 try{
  const {item:terms}=await api('/admin/product-terms?kind='+kind+'&id='+encodeURIComponent(item.id));
  if(serial!==productTermsSerial||adminToken!==usedToken)return;
  productTermsState={kind,id:item.id,itemType:item.itemType,...terms};
  el('productTermsPrice').value=terms.internalPriceCents==null?'':String(terms.internalPriceCents/100);
  el('productTermsDiscount').value=String(terms.discountBps/100);
  el('productTermsMinimumField').hidden=kind!=='LISTING';
  el('productTermsMinimum').value=String(terms.minimumQuantity??1);
  el('productTermsHoldingDaysField').hidden=item.itemType!=='STOCK';
  el('productTermsHoldingDays').value=String(terms.stockHoldingDays??0);
  el('productTermsPriceField').hidden=item.itemType==='STOCK';
  el('productTermsPrice').required=item.itemType!=='STOCK';
  el('productTermsFundFields').hidden=item.itemType!=='FUND';
  el('productTermsFundDays').value=terms.fundDays??'';
  el('productTermsFundReturn').value=terms.fundReturnBps==null?'':String(terms.fundReturnBps/100);
  el('productTermsFundImage').value=terms.fundImageUrl??'';
  el('productTermsEnabled').value=String(terms.tradingEnabled);
  updateProductPasswordRequirement();
  el('productTermsFeedback').textContent=terms.passwordConfigured?'已设置密码，留空保留原密码':'尚未设置参与密码';
 }catch(error){if(serial===productTermsSerial)el('productTermsFeedback').textContent='读取失败：'+error.message;}
 finally{if(serial===productTermsSerial)el('productTermsSave').disabled=!productTermsState;}
}
function updateProductPasswordRequirement(){el('productTermsPassword').required=el('productTermsEnabled').value==='true'&&!productTermsState?.passwordConfigured;}
function discountInputBps(value){
 if(!/^\d{1,2}(?:\.\d{1,2})?$/.test(value))throw Error('优惠比例应在0至99.99%之间');
 const [whole,part='']=value.split('.');return Number(whole)*100+Number(part.padEnd(2,'0'));
}
function fundTermFields(prefix){
 const days=Number(el(prefix+'FundDays').value),value=el(prefix+'FundReturn').value;
 if(!Number.isInteger(days)||days<1||days>3650||!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)||Number(value)>10000)
  throw Error('请输入有效的持有天数和整个持有期固定收益率');
 return {fundDays:days,fundReturnBps:Math.round(Number(value)*100),fundImageUrl:el(prefix+'FundImage').value.trim()||null};
}
function includeQuickPurchase(prefix,body){
 if(!el(prefix+'QuickEnabled').checked)return;
 const password=el(prefix+'QuickPassword').value;
 const price=commodityCents(el(prefix+'QuickPrice').value);
 const stock=prefix==='listing'&&body.itemType==='STOCK';
 if((!stock&&!price)||!/^\d{6}$/.test(password))throw Error('请填写六位参与密码和此产品所需的交易条件');
 body.status='PUBLISHED';
 body.purchaseTerms={internalPriceCents:price,discountBps:discountInputBps(el(prefix+'QuickDiscount').value),participationPassword:password};
 if(prefix==='listing')body.purchaseTerms.minimumQuantity=Number(el('listingQuickMinimum').value);
 if(stock)body.purchaseTerms.stockHoldingDays=Number(el('listingHoldingDays').value);
 if(prefix==='listing'&&body.itemType==='FUND')Object.assign(body.purchaseTerms,fundTermFields('listing'));
}
el('productTermsEnabled').addEventListener('change',updateProductPasswordRequirement);
el('productTermsCancel').addEventListener('click',closeProductTerms);
el('productTermsDialog').addEventListener('cancel',()=>{productTermsSerial++;productTermsState=null;el('productTermsPassword').value='';});
el('productTermsForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!productTermsState||role!=='MASTER')return;
 const usedToken=adminToken,serial=productTermsSerial,state=productTermsState,button=el('productTermsSave');button.disabled=true;
 try{
  const body={kind:state.kind,id:state.id,expectedVersion:state.termsVersion??0,
   internalPriceCents:commodityCents(el('productTermsPrice').value),discountBps:discountInputBps(el('productTermsDiscount').value),
   tradingEnabled:el('productTermsEnabled').value==='true',reason:el('productTermsReason').value.trim()};
  if(el('productTermsPassword').value)body.participationPassword=el('productTermsPassword').value;
  if(state.kind==='LISTING')body.minimumQuantity=Number(el('productTermsMinimum').value);
  if(state.itemType==='STOCK')body.stockHoldingDays=Number(el('productTermsHoldingDays').value);
  if(state.itemType==='FUND'&&(body.tradingEnabled||el('productTermsFundDays').value||el('productTermsFundReturn').value))
    Object.assign(body,fundTermFields('productTerms'));
  const {item}=await api('/admin/product-terms',{method:'PATCH',body});
  if(usedToken!==adminToken||serial!==productTermsSerial)return;
  productTermsState={...state,...item};el('productTermsPassword').value='';updateProductPasswordRequirement();
  el('productTermsFeedback').textContent='交易设置已保存 · 优惠 '+(item.discountBps/100)+'% · '+(item.tradingEnabled?'购买已开启':'购买已关闭');
 }catch(error){if(usedToken===adminToken&&serial===productTermsSerial)el('productTermsFeedback').textContent='未保存：'+error.message;}
 finally{el('productTermsPassword').value='';if(serial===productTermsSerial)button.disabled=false;}
});
showDashboard();
