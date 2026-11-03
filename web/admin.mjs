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
async function api(path,{method="GET",body,token=adminToken}={}){
  let res,answer;
  try{
    res=await fetch("/api"+path,{
      method,cache:"no-store",
      headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    answer=await res.json().catch(()=>({}));
  }catch{throw Error("后台接口连接失败");}
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
let currentClientPolicy=null,clientPolicySerial=0,clientWorkflowSerial=0;
let currentSubadminPolicy=null,subadminPolicySerial=0;
const dateLabel=value=>value && !Number.isNaN(Date.parse(value))?new Date(value).toLocaleString("zh-CN"):"未提供";
function detailRow(name,value){
  const row=document.createElement("div");row.className="record-field";
  row.append(plainNode("span",name),plainNode("strong",value??"未提供"));return row;
}
function closeClientDetail(){
  selectedClientDetailId=null;currentClientPolicy=null;clientPolicySerial++;clientWorkflowSerial++;
  el("clientDetail").hidden=true;el("clientDetailFields").replaceChildren();
  el("clientWorkflowPanel").hidden=true;el("clientWorkflowHistory").replaceChildren();
  el("clientWorkflowStatus").textContent="";
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
  }
  selectedClientDetailId=c.id;
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
  try{
    const data=await api("/admin/subaccounts");
    el("adminSubadminCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    renderSubadminDirectory(data.items);
  }catch(e){setText("subadminFeedback",e.message)}
}
async function refreshClients(){
  try{
    const data=await api("/admin/clients");
    el("adminClientCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    renderClientDirectory(data.items||[]);
  }catch(e){setText("clients",e.message)}
}

let mirrorClients=[],selectedMirrorClientId=null,mirrorSnapshot=null,mirrorActiveTab="assets",mirrorSerial=0;
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
  activateAdminPane("clients");openClientDetail(selectedMirrorClientId);
});


async function refreshClientWorkflowHistory(clientId){
  if(!clientId||selectedClientDetailId!==clientId)return;
  const serial=++clientWorkflowSerial,usedToken=adminToken;
  const panel=el("clientWorkflowPanel");
  panel.hidden=false;
  el("clientWorkflowStatus").textContent="正在读取当前客户的申请记录";
  el("clientWorkflowHistory").replaceChildren();
  try{
    const categories=["FUNDING","KYC","BANK_LINK"];
    const responses=await Promise.all(categories.map(category=>
      api("/admin/workflow-requests?category="+category)));
    if(serial!==clientWorkflowSerial||selectedClientDetailId!==clientId||adminToken!==usedToken)return;
    const rows=responses.flatMap((result,index)=>
      (Array.isArray(result.items)?result.items:[])
        .filter(item=>item.clientId===clientId)
        .map(item=>({...item,category:categories[index]})));
    rows.sort((a,b)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")));
    const target=el("clientWorkflowHistory");target.replaceChildren();
    if(!rows.length)target.append(plainNode("p","当前客户暂无近期申请","muted"));
    else for(const item of rows.slice(0,60)){
      const row=itemRow(caseSummary(item),"提交时间 "+dateLabel(item.createdAt)+" · "+item.category);
      target.append(row);
    }
    el("clientWorkflowStatus").textContent="当前客户近期申请 "+rows.length+" 条；来源为授权范围内的业务记录。";
  }catch(error){
    if(serial!==clientWorkflowSerial||selectedClientDetailId!==clientId||adminToken!==usedToken)return;
    el("clientWorkflowStatus").textContent="当前客户申请读取失败："+error.message;
  }
}
el("refreshClientWorkflow").addEventListener("click",()=>{
  if(selectedClientDetailId)void refreshClientWorkflowHistory(selectedClientDetailId);
});

function renderClientDirectory(items){
  mirrorClients=Array.isArray(items)?items:[];
  const list=el("clients"),quick=el("mirrorClientList");
  const term=el("mirrorClientSearch").value.trim().toLocaleLowerCase();
  const visible=mirrorClients.filter(c=>String(c.email).toLocaleLowerCase().includes(term));
  el("mirrorMatchCount").textContent="匹配 "+visible.length+" / "+mirrorClients.length+" 位客户";
  for(const target of [list,quick]){
    target.replaceChildren();
    const entries=target===quick?visible:mirrorClients;
    if(!entries.length){target.append(plainNode("p",term?"没有匹配的客户":"暂无有权限查看的客户","muted"));continue;}
    for(const c of entries){
      const row=document.createElement("div");row.className="admin-list-row mirror-customer";
      const meta=document.createElement("div");
      meta.append(plainNode("div",c.email),plainNode("small",c.subadmin_user_id?"已有子账户归属":"直接注册客户"));
      if(target===list){
        const detail=document.createElement("button");detail.type="button";detail.className="outline record-detail-open";detail.textContent="查看详情";
        detail.addEventListener("click",()=>openClientDetail(c.id));
        row.append(meta,detail);
      }else row.append(meta);
      const button=document.createElement("button");button.type="button";button.className="outline mirror-open";
      button.textContent="查看 App 镜像";
      button.disabled=!mirrorBackendReady;
      button.addEventListener("click",()=>selectMirrorClient(c.id));
      row.append(button);target.append(row);
    }
  }
  if(selectedClientDetailId)openClientDetail(selectedClientDetailId);
}
function setMirrorScreen(){
  const view=el("mirrorAppScreen");view.replaceChildren();
  if(!mirrorSnapshot){view.append(plainNode("p","请选择客户以读取账户快照","muted"));return;}
  const snap=mirrorSnapshot;
  const formats={
    market:()=>[["当前行情","未经授权的数据源尚未接入"],["自选股票",String(snap.watchlist?.length??0)+" 只"],["K 线图","暂无已核验行情，不展示虚构走势"]],
    trade:()=>[["委托入口","不可操作"],["证券实时价格","未接入"],["券商连接状态","未连接"],["已有内部订单",String(snap.orders?.length??0)+" 笔"]],
    assets:()=>[["账户编号",snap.account?.id],["账面币种",snap.account?.currency],["持仓记录",snap.positions?.length??0],["内部历史订单",snap.orders?.length??0],["自选标的",snap.watchlist?.length??0]],
    positions:()=>snap.positions?.map(p=>[p.market+" · "+p.symbol,Number(p.quantity).toLocaleString("en-US")+" 股（内部记录）"])??[],
    orders:()=>snap.orders?.map(o=>[(o.side==="BUY"?"买入":"卖出")+" · "+o.market+":"+o.symbol,
      "数量 "+o.quantity+" · 内部金额 "+cashFmt(o.amount_usd_cents)+" USD"+(o.created_at?" · "+new Date(o.created_at).toLocaleDateString("zh-CN"):"")])??[],
    watchlist:()=>snap.watchlist?.map(w=>[w.market+" · "+w.symbol,"已保存（无实时价格）"])??[]
  };
  const rows=formats[mirrorActiveTab]?.()??[];
  if(!rows.length){view.append(plainNode("p","该客户暂无对应记录","muted"));return;}
  const wrapper=document.createElement("div");wrapper.className="mirror-records";
  for(const [name,value] of rows){
    const line=document.createElement("div");line.className="mirror-record";
    line.append(plainNode("span",name),plainNode("span",value));wrapper.append(line);
  }
  view.append(wrapper);
}
async function selectMirrorClient(clientId){
  if(!mirrorBackendReady){el("mirrorStatus").textContent="镜像服务暂不可用";return;}
  const match=mirrorClients.find(x=>x.id===clientId);
  if(!match)return;
  selectedMirrorClientId=clientId;mirrorSnapshot=null;
  activateAdminPane("mirror");
  const mySerial=++mirrorSerial,usedToken=adminToken;
  el("mirrorEmail").textContent=match.email;el("mirrorCash").textContent="—";
  el("mirrorCurrency").textContent="—";el("mirrorUpdated").textContent="—";
  el("mirrorStatus").textContent="正在读取已授权的客户账户数据";
  el("refreshMirror").disabled=true;el("mirrorManageClient").disabled=true;setMirrorScreen();
  try{
    const data=await api("/admin/mirror?clientId="+encodeURIComponent(clientId));
    if(mySerial!==mirrorSerial||adminToken!==usedToken||selectedMirrorClientId!==clientId)return;
    if(data.mode!=="READ_ONLY")throw Error("镜像模式不安全");
    mirrorSnapshot=data;
    el("mirrorEmail").textContent=data.client.email;
    el("mirrorCash").textContent=cashFmt(data.account.cashCents);
    el("mirrorCurrency").textContent=data.account.currency;
    el("mirrorUpdated").textContent="快照读取时间："+new Date(data.checkedAt).toLocaleString("zh-CN");
    el("mirrorStatus").textContent="只读 · 已记录访问审计";
    el("refreshMirror").disabled=false;el("mirrorManageClient").disabled=false;setMirrorScreen();
  }catch(error){
    if(mySerial!==mirrorSerial||adminToken!==usedToken)return;
    el("mirrorStatus").textContent=error.message;setMirrorScreen();
  }
}
document.querySelectorAll("[data-mirror-tab]").forEach(button=>{
  button.addEventListener("click",()=>{
    mirrorActiveTab=button.dataset.mirrorTab;
    document.querySelectorAll("[data-mirror-tab]").forEach(b=>b.setAttribute("aria-selected",b===button?"true":"false"));
    setMirrorScreen();
  });
});
el("refreshMirror").addEventListener("click",()=>{if(selectedMirrorClientId)selectMirrorClient(selectedMirrorClientId)});
el("refreshMirrorClients").addEventListener("click",refreshClients);


// Read-only administrative mirror access history. Server handles actor-level isolation.
async function refreshMirrorAudit(){
  const feedback=el("mirrorAuditStatus"),target=el("mirrorAuditList");
  feedback.textContent="正在读取审计记录";
  target.replaceChildren();
  try{
    const {items}=await api("/admin/mirror-audit");
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
  }catch(e){feedback.textContent=e.message;}
}
el("refreshMirrorAudit").addEventListener("click",refreshMirrorAudit);

async function refreshMirrorStatus(){
  try{
    const response=await api("/admin/mirror-status");
    mirrorBackendReady=response.mode==="READ_ONLY"&&response.ready===true;
    el("mirrorAvailability").textContent=mirrorBackendReady
      ?"镜像审计已就绪 · 仅供只读查看"
      :"镜像服务暂不可用";
  }catch(error){
    mirrorBackendReady=false;
    el("mirrorAvailability").textContent="镜像状态检查失败：" + error.message;
  }
  renderClientDirectory(mirrorClients);
}
el("mirrorClientSearch").addEventListener("input",()=>renderClientDirectory(mirrorClients));
let editingListingId=null;
function clearListingEditor(){
  editingListingId=null;
  el("listingForm").reset();
  el("listingSubmit").textContent="保存证券资料";
  el("listingCancelEdit").hidden=true;
}
function beginListingEdit(item){
  if(role!=="MASTER")return;
  if(item.status!=="DRAFT"){
    setText("listingFeedback","请先撤回为草稿，再编辑证券资料。");return;
  }
  editingListingId=item.id;
  el("listingType").value=item.itemType;
  el("listingMarket").value=item.market;
  el("listingSymbol").value=item.symbol;
  el("listingName").value=item.name;
  el("listingStatus").value=item.status;
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
      actions.append(edit,toggle);row.append(actions);
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
let caseRows=[],selectedCase=null,caseSerial=0,fundingSerial=0;
function caseSummary(item){
 const status=CASE_STATUS[item.status]??item.status;
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
  if(item.status==="SUBMITTED")return [["UNDER_REVIEW","进入审核"]];
  if(item.status==="UNDER_REVIEW"&&role==="MASTER")return [["APPROVED","审核通过（不执行付款）"],["REJECTED","拒绝申请"]];
 }else if(item.category==="KYC"){
  if(item.status==="AWAITING_EVIDENCE")return [["NEEDS_INFORMATION","要求补充资料"]];
  if(item.status==="NEEDS_INFORMATION")return [["UNDER_REVIEW","开始人工审阅"]];
  if(item.status==="UNDER_REVIEW"&&role==="MASTER")return [["MANUALLY_REVIEWED","人工已审阅（非实名认证）"],["REJECTED","拒绝工单"]];
 }else if(item.category==="BANK_LINK"){
  if(item.status==="PENDING_VERIFICATION")return role==="MASTER"
   ?[["NEEDS_INFORMATION","要求补充资料"],["REJECTED","拒绝登记"]]
   :[["NEEDS_INFORMATION","要求补充资料"]];
 }
 return [];
}
function clearCaseSelection(){
 selectedCase=null;el("workflowReviewForm").hidden=true;
 el("workflowDecision").replaceChildren();el("workflowReason").value="";el("workflowConfirm").checked=false;
}
function renderCaseList(){
 const target=el("workflowItems");target.replaceChildren();
 if(!caseRows.length){target.append(plainNode("p","当前权限下暂无此类申请","muted"));return;}
 for(const item of caseRows){
  const row=itemRow(caseSummary(item),"客户编号："+item.clientId+" · 提交："+dateLabel(item.createdAt));
  row.classList.add("workflow-row");
  const next=caseOptions(item);
  if(next.length){
   const action=document.createElement("button");action.type="button";action.className="outline";action.textContent="处理申请";
   action.addEventListener("click",()=>{
    selectedCase=item;el("workflowSelection").textContent=caseSummary(item)+" · "+item.clientId;
    const select=el("workflowDecision");select.replaceChildren();
    for(const [value,label] of next){
     const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);
    }
    el("workflowReviewForm").hidden=false;
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
  el("workflowStatus").textContent="共 "+caseRows.length+" 条申请。审核状态不会触发付款或身份验证。";
 }catch(error){
  if(serial!==caseSerial||adminToken!==usedToken)return;
  caseRows=[];el("workflowStatus").textContent="读取失败："+error.message;
 }
}
async function refreshFundingOverview(){
 const serial=++fundingSerial,usedToken=adminToken;
 el("fundingSummaryStatus").textContent="正在读取资金申请";
 try{
  const data=await api("/admin/workflow-requests?category=FUNDING");
  if(serial!==fundingSerial||adminToken!==usedToken)return;
  const rows=Array.isArray(data.items)?data.items:[];
  const count=pred=>String(rows.filter(pred).length);
  el("depositRequestTotal").textContent=count(x=>x.kind==="DEPOSIT");
  el("withdrawRequestTotal").textContent=count(x=>x.kind==="WITHDRAWAL");
  el("pendingRequestTotal").textContent=count(x=>x.status==="SUBMITTED"||x.status==="UNDER_REVIEW");
  el("approvedRequestTotal").textContent=count(x=>x.status==="APPROVED");
  const target=el("fundingRequestRows");target.replaceChildren();
  for(const item of rows.slice(0,100))target.append(itemRow(caseSummary(item),"客户编号："+item.clientId+" · "+dateLabel(item.createdAt)));
  if(!rows.length)target.append(plainNode("p","暂无资金申请","muted"));
  el("fundingSummaryStatus").textContent="仅统计申请记录，实际资金划转尚未接入。";
 }catch(error){if(serial===fundingSerial)el("fundingSummaryStatus").textContent="读取失败："+error.message;}
}
el("workflowCategory").addEventListener("change",()=>{void refreshCaseList()});
el("workflowRefresh").addEventListener("click",()=>{void refreshCaseList()});
el("refreshFundingSummary").addEventListener("click",()=>{void refreshFundingOverview()});
el("workflowCancel").addEventListener("click",clearCaseSelection);
el("workflowReviewForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!selectedCase||!el("workflowConfirm").checked){el("workflowStatus").textContent="请先选择申请并确认";return;}
 const body={category:selectedCase.category,id:selectedCase.id,expectedStatus:selectedCase.status,
  status:el("workflowDecision").value,reason:el("workflowReason").value.trim()};
 const button=el("workflowSubmit");button.disabled=true;
 try{
  await api("/admin/workflow-requests",{method:"PATCH",body});
  clearCaseSelection();await refreshCaseList();
  el("workflowStatus").textContent="审核记录已保存；未执行任何资金划转或第三方核验。";
 }catch(error){el("workflowStatus").textContent="保存失败："+error.message;}
 finally{button.disabled=false;}
});

async function refreshListings(){
  try{
    const data=await api("/admin/listings");
    const items=Array.isArray(data.items)?data.items:[];
    el("adminListingCount").textContent=String(items.length);
    renderListingDirectory(items);
  }catch(error){setText("listingFeedback",error.message)}
}
async function showDashboard(){
  if(!adminToken){el("adminWorkspace").hidden=true;return;}
  try{
    const me=await api("/admin/me");
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
    await Promise.all([refreshSubadmins(),refreshClients(),refreshListings(),refreshMirrorStatus()]);
  }catch{
    sessionStorage.removeItem("gsp_admin_token");
    adminToken=null;
    el("adminWorkspace").hidden=true;
    el("adminTopbar").hidden=true;
    el("admin-login").hidden=false;
  }
}
el("adminLoginForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/login",{method:"POST",token:null,body:{
      email:el("adminEmail").value,password:el("adminPassword").value
    }});
    if(result.role!==selectedAdminRole){
      void api("/admin/logout",{method:"POST",token:result.token}).catch(()=>{});
      throw new Error("该账号不属于所选角色，请切换主账户或子账户");
    }
    adminToken=result.token;
    sessionStorage.setItem("gsp_admin_token",adminToken);
    el("adminPassword").value="";
    setText("loginFeedback","管理员验证成功");
    await showDashboard();
  }catch(error){setText("loginFeedback",error.message)}
  finally{button.disabled=false;}
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
    const result=await api("/admin/listings",editingListingId
      ?{method:"PATCH",body:{id:editingListingId,...body}}
      :{method:"POST",body});
    clearListingEditor();
    setText("listingFeedback","已保存证券资料 "+body.symbol+" · "+(body.status==="PUBLISHED"?"已发布":"草稿"));
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
el("adminLogout").addEventListener("click",()=>{
  const expiredToken=adminToken;
  if(expiredToken)void api("/admin/logout",{method:"POST",token:expiredToken}).catch(()=>{});
  sessionStorage.removeItem("gsp_admin_token");adminToken=null;role=null;
  mirrorSerial++;mirrorSnapshot=null;selectedMirrorClientId=null;mirrorClients=[];mirrorBackendReady=false;
  subadminDirectory=[];closeClientDetail();closeSubadminDetail();
  caseSerial++;fundingSerial++;caseRows=[];clearCaseSelection();
  el("workflowItems").replaceChildren();el("fundingRequestRows").replaceChildren();
  el("mirrorAvailability").textContent="未登录";
  el("mirrorClientSearch").value="";
  el("mirrorMatchCount").textContent="";
  el("mirrorEmail").textContent="尚未选择";el("mirrorCash").textContent="—";el("mirrorManageClient").disabled=true;setMirrorScreen();
  el("mirrorClientList").replaceChildren();
  setMobileNavExpanded(false);
  el("adminWorkspace").hidden=true;el("adminTopbar").hidden=true;el("admin-login").hidden=false;el("bootstrapPanel").hidden=true;
  setText("loginFeedback","已退出管理后台。");
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
function activateAdminPane(page) {
  if(page==="audit")void refreshMirrorAudit();
  if(page==="approvals")void refreshCaseList();
  if(page==="treasury")void refreshFundingOverview();
  const target=document.querySelector('[data-pane="'+page+'"]');
  if(!target)return;
  const nav=document.querySelector('[data-admin-page="'+page+'"]');
  if(nav?.hidden)return;
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

showDashboard();
