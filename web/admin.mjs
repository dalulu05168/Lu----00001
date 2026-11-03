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
async function refreshSubadmins(){
  try{
    const data=await api("/admin/subaccounts");
    el("adminSubadminCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    displayItems("subadmins",data.items||[],x=>[
      x.email+" · 子管理员",
      "邀请码 "+(x.code||"—")+" · 已用 "+x.uses+"/"+x.max_uses+" · 到期 "+(x.expires_at?new Date(x.expires_at).toLocaleDateString("zh-CN"):"—")
    ]);
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
      const button=document.createElement("button");button.type="button";button.className="outline mirror-open";
      button.textContent="查看 App 镜像";
      button.disabled=!mirrorBackendReady;
      button.addEventListener("click",()=>selectMirrorClient(c.id));
      row.append(meta,button);target.append(row);
    }
  }
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
  if(!mirrorBackendReady){el("mirrorStatus").textContent="镜像审计尚未准备好，查看功能已停用";return;}
  const match=mirrorClients.find(x=>x.id===clientId);
  if(!match)return;
  selectedMirrorClientId=clientId;mirrorSnapshot=null;
  activateAdminPane("mirror");
  const mySerial=++mirrorSerial,usedToken=adminToken;
  el("mirrorEmail").textContent=match.email;el("mirrorCash").textContent="—";
  el("mirrorCurrency").textContent="—";el("mirrorUpdated").textContent="—";
  el("mirrorStatus").textContent="正在读取已授权的客户账户数据";
  el("refreshMirror").disabled=true;setMirrorScreen();
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
    el("refreshMirror").disabled=false;setMirrorScreen();
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
      :"镜像暂不可用：访问审计表尚未配置，禁止读取客户数据";
  }catch(error){
    mirrorBackendReady=false;
    el("mirrorAvailability").textContent="镜像状态无法验证，已停止读取客户数据：" + error.message;
  }
  renderClientDirectory(mirrorClients);
}
el("mirrorClientSearch").addEventListener("input",()=>renderClientDirectory(mirrorClients));
async function refreshListings(){
  try{
    const data=await api("/admin/listings");
    el("adminListingCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    displayItems("listings",data.items||[],x=>[
      x.itemType+" · "+x.market+":"+x.symbol+" · "+x.name,
      (x.status==="PUBLISHED"?"已发布":"草稿")+" · "+x.id
    ]);
  }catch(e){setText("listingFeedback",e.message)}
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
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/listings",{method:"POST",body:{
      itemType:el("listingType").value,market:el("listingMarket").value,
      symbol:el("listingSymbol").value.toUpperCase().trim(),
      name:el("listingName").value.trim(),status:el("listingStatus").value
    }});
    setText("listingFeedback","已保存证券资料 "+result.symbol+" · "+(result.status==="PUBLISHED"?"已发布":"草稿"));
    await refreshListings();
  }catch(error){setText("listingFeedback",error.message)}
  finally{button.disabled=false;}
});
el("refreshSubadmins").addEventListener("click",refreshSubadmins);
el("refreshClients").addEventListener("click",refreshClients);
el("refreshListings").addEventListener("click",refreshListings);
el("adminLogout").addEventListener("click",()=>{
  const expiredToken=adminToken;
  if(expiredToken)void api("/admin/logout",{method:"POST",token:expiredToken}).catch(()=>{});
  sessionStorage.removeItem("gsp_admin_token");adminToken=null;role=null;
  mirrorSerial++;mirrorSnapshot=null;selectedMirrorClientId=null;mirrorClients=[];mirrorBackendReady=false;
  el("mirrorAvailability").textContent="未登录";
  el("mirrorClientSearch").value="";
  el("mirrorMatchCount").textContent="";
  el("mirrorEmail").textContent="尚未选择";el("mirrorCash").textContent="—";setMirrorScreen();
  el("mirrorClientList").replaceChildren();
  el("adminWorkspace").hidden=true;el("adminTopbar").hidden=true;el("admin-login").hidden=false;el("bootstrapPanel").hidden=true;
  setText("loginFeedback","已退出管理后台。");
});
/** Independent client-side navigation: authorization is always enforced by /api/admin/*. */
function activateAdminPane(page) {
  if(page==="audit")void refreshMirrorAudit();
  const target=document.querySelector('[data-pane="'+page+'"]');
  if(!target)return;
  const nav=document.querySelector('[data-admin-page="'+page+'"]');
  if(nav?.hidden)return;
  document.querySelectorAll(".admin-pane").forEach(pane=>pane.hidden=pane!==target);
  document.querySelectorAll("[data-admin-page]").forEach(button=>{
    if(button===nav)button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
}
document.querySelectorAll("[data-admin-page]").forEach(button=>{
  button.addEventListener("click",()=>activateAdminPane(button.dataset.adminPage));
});

showDashboard();
