const el=id=>document.getElementById(id);
let adminToken=sessionStorage.getItem("gsp_admin_token");
let role=null;

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
      x.email+" · "+(x.twofa_confirmed_at?"已启用2FA":"待启用2FA"),
      "邀请码 "+(x.code||"—")+" · 已用 "+x.uses+"/"+x.max_uses+" · 到期 "+(x.expires_at?new Date(x.expires_at).toLocaleDateString("zh-CN"):"—")
    ]);
  }catch(e){setText("subadminFeedback",e.message)}
}
async function refreshClients(){
  try{
    const data=await api("/admin/clients");
    el("adminClientCount").textContent=Array.isArray(data.items)?String(data.items.length):"—";
    displayItems("clients",data.items||[],x=>[x.email,"归属子账户："+x.subadmin_user_id]);
  }catch(e){setText("clients",e.message)}
}
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
    setText("adminRole",role==="MASTER"?"主账户 / MASTER":"子管理员 / SUBADMIN");
    document.querySelectorAll("[data-required-role]").forEach(node=>node.hidden=node.dataset.requiredRole!==role);
    activateAdminPane("dashboard");
    el("adminWorkspace").hidden=false;
    el("admin-login").hidden=true;
    el("bootstrapPanel").hidden=true;
    el("subadminForm").hidden=role!=="MASTER";
    el("listingForm").hidden=role!=="MASTER";
    await Promise.all([refreshSubadmins(),refreshClients(),refreshListings()]);
  }catch{
    sessionStorage.removeItem("gsp_admin_token");
    adminToken=null;
    el("adminWorkspace").hidden=true;
  }
}
el("adminLoginForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/login",{method:"POST",token:null,body:{
      email:el("adminEmail").value,password:el("adminPassword").value,otp:el("adminOtp").value
    }});
    adminToken=result.token;
    sessionStorage.setItem("gsp_admin_token",adminToken);
    el("adminPassword").value="";el("adminOtp").value="";
    setText("loginFeedback","管理员验证成功");
    await 
/** Independent client-side navigation: authorization is always enforced by /api/admin/*. */
function activateAdminPane(page) {
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
  }catch(error){setText("loginFeedback",error.message)}
  finally{button.disabled=false;}
});
el("bootstrapForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/bootstrap",{method:"POST",token:null,body:{
      email:el("bootstrapEmail").value.trim(),
      password:el("bootstrapPassword").value,
      setupKey:el("bootstrapKey").value
    }});
    el("bootstrapKey").value="";
    el("bootstrapPassword").value="";
    const box=el("bootstrapResult");box.hidden=false;box.replaceChildren();
    const title=document.createElement("strong");title.textContent="仅首次显示：请立即保存至验证器，并勿发送给他人";
    const text=document.createElement("code");text.textContent=result.totpSecret;
    const uri=document.createElement("code");uri.textContent=result.setupUri;
    box.append(title,text,uri);
    setText("bootstrapFeedback","已生成主账户2FA，请在验证器中添加并输入动态验证码确认。");
  }catch(error){setText("bootstrapFeedback",error.message)}
  finally{button.disabled=false;}
});
el("activateForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");button.disabled=true;
  try{
    const result=await api("/admin/activate",{method:"POST",token:null,body:{
      email:el("activateEmail").value.trim(),
      password:el("activatePassword").value,
      otp:el("activateOtp").value
    }});
    setText("activateFeedback",result.activated?"2FA绑定成功；现在可使用上方管理员登录。":"未启用");
    el("activateOtp").value="";
    el("activatePassword").value="";
    el("bootstrapResult").hidden=true;el("bootstrapResult").replaceChildren();
  }catch(error){setText("activateFeedback",error.message)}
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
    const heading=document.createElement("strong");heading.textContent="只显示一次：交付子账户管理员并要求启用2FA";
    for(const [label,value] of [
      ["子账户邮箱",data.email],["注册邀请码",data.inviteCode],
      ["2FA 初始化密钥",data.totpSecret],["验证器设置URI",data.setupUri]
    ]){
      const small=document.createElement("small");small.textContent=label;
      const code=document.createElement("code");code.textContent=value;
      box.append(small,code);
    }
    setText("subadminFeedback","子账户已创建；邀请码在子账户完成2FA激活后可用于注册。");
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
  sessionStorage.removeItem("gsp_admin_token");adminToken=null;role=null;
  el("adminWorkspace").hidden=true;el("admin-login").hidden=false;el("bootstrapPanel").hidden=false;
  setText("loginFeedback","已退出管理界面；服务器端会话将在到期时失效。");
});
showDashboard();
