// CN Capital admin console: API-only data and 2FA-verified session.
const token=sessionStorage.getItem('gsp_admin_token');
const root=document.getElementById('adminVerifiedApp');
const el=id=>document.getElementById(id);
const ready=()=>document.documentElement.classList.add('cn-ready');
const state={role:null,clients:null,subadmins:null,listings:null,audit:null,invalidated:false};
const headers=()=>({Authorization:'Bearer '+token,Accept:'application/json'});
const cell=(row,value)=>{const td=document.createElement('td');td.textContent=String(value??'—');row.appendChild(td);return td};
const when=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('zh-CN')};
function status(id,message,error=false){const node=el(id);node.textContent=message;node.dataset.error=String(error);}
function renderRows(id,items,callback,columns){
 const tbody=el(id);tbody.replaceChildren();
 if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns;td.textContent='暂无记录';td.style.textAlign='center';td.style.color='var(--mut)';tr.appendChild(td);tbody.appendChild(tr);return;}
 for(const item of items){const tr=document.createElement('tr');callback(tr,item);tbody.appendChild(tr);}
}
function invalidate(){state.invalidated=true;sessionStorage.removeItem('gsp_admin_token');root.hidden=true;location.replace('/admin.html');}
async function api(path,{method='GET',body}={}){
 const r=await fetch('/api/admin/'+path,{method,headers:{...headers(),...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
 if(r.status===401||r.status===403){invalidate();throw Error('管理员会话无效');}
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||'接口访问失败：HTTP '+r.status);
 return data;
}
function summary(){
 el('overviewClientCount').textContent=state.clients?.length??'—';
 el('overviewSubadminCount').textContent=state.subadmins?.length??'—';
 el('overviewListingCount').textContent=state.listings?.length??'—';
 const complete=[state.clients,state.subadmins,state.listings].every(Array.isArray);
 status('overviewStatus',complete?'后台记录已同步':'部分接口未返回有效数据，请查看对应页面',!complete);
}
async function loadClients(){
 try{
  status('clientsStatus','读取中…');
  const data=await api('clients');
  if(!Array.isArray(data.items))throw Error('客户数据格式异常');
  state.clients=data.items;
  renderRows('clientsRows',data.items,(r,x)=>{cell(r,x.email);cell(r,x.subadmin_user_id);cell(r,when(x.created_at));},3);
  status('clientsStatus','已读取 '+data.items.length+' 条关联客户记录');
 }catch(e){state.clients=null;renderRows('clientsRows',[],()=>{},3);status('clientsStatus',e.message,true);}
 summary();
}
async function loadSubadmins(){
 try{
  status('subadminsStatus','读取中…');
  const data=await api('subaccounts');
  if(!Array.isArray(data.items))throw Error('子管理员数据格式异常');
  state.subadmins=data.items;
  renderRows('subadminsRows',data.items,(r,x)=>{
   cell(r,x.email);cell(r,x.twofa_confirmed_at?'已启用':'未启用');
   cell(r,(x.uses??0)+' / '+(x.max_uses??'—'));cell(r,when(x.expires_at));
  },4);
  status('subadminsStatus','已读取 '+data.items.length+' 条子管理员记录');
 }catch(e){state.subadmins=null;renderRows('subadminsRows',[],()=>{},4);status('subadminsStatus',e.message,true);}
 summary();
}
async function loadListings(){
 try{
  status('listingsStatus','读取中…');
  const data=await api('listings');
  if(!Array.isArray(data.items))throw Error('证券目录格式异常');
  const supported=data.items.filter(x=>x?.market==='US'||x?.market==='CN');
  state.listings=supported;
  renderRows('listingsRows',supported,(r,x)=>{
   cell(r,x.market);cell(r,x.symbol);cell(r,x.name);cell(r,x.itemType);
   cell(r,x.status==='PUBLISHED'?'已发布':'草稿');
   const td=document.createElement('td');
   if(state.role==='MASTER'&&['DRAFT','PUBLISHED'].includes(x.status)){
    const b=document.createElement('button');b.type='button';b.className='cnbutton';
    b.dataset.listingId=x.id;b.dataset.listingStatus=x.status==='PUBLISHED'?'DRAFT':'PUBLISHED';
    b.textContent=x.status==='PUBLISHED'?'设为草稿':'发布';td.appendChild(b);
   }else td.textContent='—';
   r.appendChild(td);
  },6);
  status('listingsStatus','已读取 '+supported.length+' 条美股及 A 股目录记录'+(data.items.length!==supported.length?'；旧市场记录未展示':''));
 }catch(e){state.listings=null;renderRows('listingsRows',[],()=>{},6);status('listingsStatus',e.message,true);}
 summary();
}
async function loadAudit(){
 if(state.role!=='MASTER')return;
 try{
  status('auditStatus','正在读取审计记录…');
  const data=await api('audit');
  if(!Array.isArray(data.items))throw Error('审计接口返回格式异常');
  state.audit=data.items;
  renderRows('auditRows',data.items,(r,x)=>{
   cell(r,when(x.created_at));cell(r,x.action);cell(r,x.actor_user_id);cell(r,x.target_id);
   cell(r,JSON.stringify(x.details??{}));
  },5);
  status('auditStatus','最近 '+data.items.length+' 条审计记录');
 }catch(error){state.audit=null;renderRows('auditRows',[],()=>{},5);status('auditStatus',error.message,true);}
}
function show(name){
 for(const n of document.querySelectorAll('[data-view]'))n.hidden=n.dataset.view!==name;
 for(const b of document.querySelectorAll('[data-panel]'))b.classList.toggle('on',b.dataset.panel===name);
}
function provisioning(values){
 const box=el('subadminOnce');box.replaceChildren();
 const title=document.createElement('strong');title.textContent='创建成功。以下信息仅显示一次，请安全交付子管理员。';box.appendChild(title);
 for(const [key,value] of values){
  const label=document.createElement('small');label.textContent=key;
  const code=document.createElement('code');code.textContent=String(value??'—');
  box.append(label,code);
 }
 box.hidden=false;
}
function wire(){
 document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.panel)));
 el('adminRefresh').addEventListener('click',()=>{void Promise.all([loadClients(),loadSubadmins(),loadListings()]);});
 el('refreshClients').addEventListener('click',()=>{void loadClients();});
 el('refreshSubadmins').addEventListener('click',()=>{void loadSubadmins();});
 el('refreshListings').addEventListener('click',()=>{void loadListings();});
 el('refreshAudit').addEventListener('click',()=>{void loadAudit();});
 el('adminLogout').addEventListener('click',async()=>{
  try{await fetch('/api/auth/logout',{method:'POST',headers:headers(),cache:'no-store'});}catch{}
  sessionStorage.removeItem('gsp_admin_token');location.assign('/admin.html');
 });
 el('subadminCreateForm').addEventListener('submit',async e=>{
  e.preventDefault();if(state.role!=='MASTER')return;
  const form=e.currentTarget,b=form.querySelector('button[type=submit]');b.disabled=true;
  el('subadminOnce').hidden=true;el('subadminOnce').replaceChildren();
  try{
   const data=await api('subaccounts',{method:'POST',body:{email:form.elements.email.value.trim(),password:form.elements.password.value}});
   provisioning([['邮箱',data.email],['邀请码',data.inviteCode],['2FA 密钥',data.totpSecret],['验证器设置 URI',data.setupUri]]);
   status('subadminCreateStatus','已创建子管理员。其 2FA 激活后邀请码方可使用。');
   await loadSubadmins();
  }catch(error){status('subadminCreateStatus',error.message,true);}
  finally{form.elements.password.value='';b.disabled=false;}
 });
 el('listingCreateForm').addEventListener('submit',async e=>{
  e.preventDefault();if(state.role!=='MASTER')return;
  const form=e.currentTarget,b=form.querySelector('button[type=submit]');b.disabled=true;
  try{
   await api('listings',{method:'POST',body:{
    itemType:form.elements.itemType.value,market:form.elements.market.value,
    symbol:form.elements.symbol.value.trim().toUpperCase(),name:form.elements.name.value.trim(),
    status:form.elements.status.value
   }});
   form.reset();status('listingCreateStatus','证券目录已保存');await loadListings();
  }catch(error){status('listingCreateStatus',error.message,true);}
  finally{b.disabled=false;}
 });
 el('listingsRows').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-listing-id]');
  if(!b||state.role!=='MASTER')return;
  b.disabled=true;
  try{
   await api('listings',{method:'PATCH',body:{id:b.dataset.listingId,status:b.dataset.listingStatus}});
   status('listingsStatus','已更新证券状态');await loadListings();
  }catch(error){status('listingsStatus',error.message,true);b.disabled=false;}
 });
}
function errorView(message){
 root.hidden=true;
 document.body.replaceChildren();
 const main=document.createElement('main');main.style.cssText='min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b0d0a;color:#f1f4e8;font:15px sans-serif';
 const box=document.createElement('div');box.style.textAlign='center';
 const p=document.createElement('p');p.textContent=message;
 const a=document.createElement('a');a.href='/admin.html';a.textContent='返回管理员登录';a.style.color='#d7ff00';
 box.append(p,a);main.appendChild(box);document.body.appendChild(main);ready();
}
async function run(){
 if(!token){location.replace('/admin.html');return;}
 try{
  const r=await fetch('/api/admin/me',{headers:headers(),cache:'no-store'});
  if(r.status===401||r.status===403){invalidate();return;}
  if(!r.ok)throw Error('管理员会话验证失败');
  const identity=await r.json();
  if(!['MASTER','SUBADMIN'].includes(identity?.role)){invalidate();return;}
  state.role=identity.role;
  el('adminRoleTag').textContent=identity.role==='MASTER'?'主管理员 · 2FA':'子管理员 · 2FA';
  el('subadminCreateSection').hidden=identity.role!=='MASTER';
  el('listingCreateSection').hidden=identity.role!=='MASTER';
  el('adminAuditNav').hidden=identity.role!=='MASTER';
  wire();
  await Promise.all([loadClients(),loadSubadmins(),loadListings(),...(state.role==='MASTER'?[loadAudit()]:[])]);
  if(state.invalidated)return;
  root.hidden=false;ready();
 }catch(e){errorView(e.message||'后台暂不可用');}
}
void run();
