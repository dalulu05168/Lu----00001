// CN Capital management UI: live, permission-scoped APIs only. No static account/finance records.
const token=sessionStorage.getItem('gsp_admin_token');
const $=id=>document.getElementById(id);
const ready=()=>document.documentElement.classList.add('cn-ready');
let role=null,clients=[],subadmins=[],listings=[];

function row(table,values,action) {
  const tr=document.createElement('tr');
  for(const value of values){
    const td=document.createElement('td');
    td.textContent=value==null||value===''?'—':String(value);
    tr.append(td);
  }
  if(action){const td=document.createElement('td');td.append(action);tr.append(td);}
  table.append(tr);
}
function empty(table,columns,message){
  const tr=document.createElement('tr');tr.className='cn-empty';
  const td=document.createElement('td');td.colSpan=columns;td.textContent=message;tr.append(td);table.append(tr);
}
function button(text,onClick){
  const b=document.createElement('button');b.type='button';b.className='btn cn-action';b.textContent=text;
  b.addEventListener('click',onClick);return b;
}
function formattedDate(value){
  if(!value)return '—';const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleString('zh-CN',{timeZone:'Asia/Kuala_Lumpur'});
}
async function api(route,{method='GET',body}={}){
  const res=await fetch('/api/admin/'+route,{
    method,cache:'no-store',
    headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  let obj={};try{obj=await res.json()}catch{}
  if(res.status===401||res.status===403){
    sessionStorage.removeItem('gsp_admin_token');
    location.replace('/admin.html');throw new Error('管理员会话已失效');
  }
  if(!res.ok)throw new Error(obj.error||'后台数据请求失败（HTTP '+res.status+'）');
  return obj;
}
function setPage(name,updateHash=true){
  if(!['over','cli','appr','fund','cat'].includes(name))name='over';
  document.querySelectorAll('.pg').forEach(section=>section.hidden=section.id!=='p-'+name);
  document.querySelectorAll('.tn').forEach(b=>b.classList.toggle('on',b.dataset.p===name));
  if(updateHash&&location.hash!=='#'+name)history.replaceState(null,'','#'+name);
}
function renderClients(){
  const body=$('cn-client-rows');body.replaceChildren();
  const needle=$('cn-client-search').value.trim().toLowerCase();
  const data=clients.filter(x=>(String(x.email||'')+' '+String(x.id||'')).toLowerCase().includes(needle));
  if(!data.length)return empty(body,4,needle?'没有匹配的客户':'暂无客户数据');
  for(const x of data)row(body,[x.email,x.id,x.subadmin_user_id,formattedDate(x.created_at)]);
}
function renderSubadmins(){
  const body=$('cn-subadmin-rows');body.replaceChildren();
  if(!subadmins.length)return empty(body,4,'暂无子账户数据');
  for(const x of subadmins)row(body,[x.email,x.twofa_confirmed_at?'已启用':'待启用',
    String(x.uses??0)+' / '+String(x.max_uses??0),formattedDate(x.expires_at)]);
}
function renderListings(){
  const body=$('cn-listing-rows');body.replaceChildren();
  if(!listings.length)return empty(body,5,'暂无证券目录');
  for(const x of listings){
    const action=role==='MASTER'?button(x.status==='PUBLISHED'?'设为草稿':'发布',async()=>{
      action.disabled=true;
      try{
        await api('listings',{method:'PATCH',body:{id:x.id,status:x.status==='PUBLISHED'?'DRAFT':'PUBLISHED'}});
        await refreshListings();
      }catch(error){$('cn-listing-status').textContent=error.message;}
      finally{action.disabled=false;}
    }):document.createTextNode('—');
    row(body,[x.itemType,x.market+':'+x.symbol,x.name,x.status==='PUBLISHED'?'已发布':'草稿'],action);
  }
}
async function refreshClients(){
  const result=await api('clients');
  clients=Array.isArray(result.items)?result.items:[];
  $('cn-count-clients').textContent=String(clients.length);
  renderClients();
}
async function refreshSubadmins(){
  const result=await api('subaccounts');
  subadmins=Array.isArray(result.items)?result.items:[];
  $('cn-count-subadmins').textContent=String(subadmins.length);
  renderSubadmins();
}
async function refreshListings(){
  const result=await api('listings');
  listings=Array.isArray(result.items)?result.items:[];
  $('cn-count-listings').textContent=String(listings.length);
  renderListings();
}
async function refreshAll(){
  const output=await Promise.allSettled([refreshClients(),refreshSubadmins(),refreshListings()]);
  const errors=output.filter(x=>x.status==='rejected');
  $('cn-sync-time').textContent='更新时间：'+formattedDate(new Date());
  $('cn-over-feedback').textContent=errors.length?'有 '+errors.length+' 个数据模块未能读取：'+errors.map(x=>x.reason?.message||'未知错误').join('；'):'数据已更新';
}
function bindControls(){
  document.querySelectorAll('.tn[data-p]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.p)));
  $('cn-admin-logout').addEventListener('click',()=>{sessionStorage.removeItem('gsp_admin_token');location.assign('/admin.html?legacy=1');});
  $('cn-refresh').addEventListener('click',refreshAll);
  $('cn-refresh-clients').addEventListener('click',()=>refreshClients().catch(e=>$('cn-over-feedback').textContent=e.message));
  $('cn-refresh-subadmins').addEventListener('click',()=>refreshSubadmins().catch(e=>$('cn-over-feedback').textContent=e.message));
  $('cn-refresh-listings').addEventListener('click',()=>refreshListings().catch(e=>$('cn-listing-status').textContent=e.message));
  $('cn-client-search').addEventListener('input',renderClients);
  $('cn-create-subadmin').addEventListener('submit',async e=>{
    e.preventDefault();
    if(role!=='MASTER')return;
    const form=e.currentTarget,btn=form.querySelector('button[type=submit]');
    const body={email:form.elements.namedItem('email').value.trim(),password:form.elements.namedItem('password').value};
    btn.disabled=true;
    try{
      const created=await api('subaccounts',{method:'POST',body});
      form.reset();
      const output=$('cn-subadmin-credentials');output.hidden=false;
      output.textContent='邮箱：'+created.email+'\n邀请码：'+created.inviteCode+'\n2FA 密钥（只显示一次）：'+created.totpSecret+'\n验证器 URI：'+created.setupUri;
      $('cn-subadmin-status').textContent='子账户已创建，请妥善保存一次性配置资料。';
      await refreshSubadmins();
    }catch(error){$('cn-subadmin-status').textContent=error.message;}
    finally{btn.disabled=false;}
  });
  $('cn-create-listing').addEventListener('submit',async e=>{
    e.preventDefault();
    if(role!=='MASTER')return;
    const form=e.currentTarget,btn=form.querySelector('button[type=submit]');
    const value=name=>form.elements.namedItem(name).value;
    const body={itemType:value('itemType'),market:value('market'),symbol:value('symbol').trim().toUpperCase(),name:value('name').trim(),status:value('status')};
    btn.disabled=true;
    try{const item=await api('listings',{method:'POST',body});
      $('cn-listing-status').textContent='已保存 '+item.market+':'+item.symbol;form.reset();await refreshListings();
    }catch(error){$('cn-listing-status').textContent=error.message;}
    finally{btn.disabled=false;}
  });
}
async function init(){
  if(!token){location.replace('/admin.html');return;}
  try{
    const me=await api('me');
    if(!['MASTER','SUBADMIN'].includes(me.role))throw new Error('管理员权限不足');
    role=me.role;
    $('cn-admin-role').textContent=role==='MASTER'?'主账户':'子账户';
    $('cn-create-subadmin').hidden=role!=='MASTER';
    $('cn-create-listing').hidden=role!=='MASTER';
    bindControls();
    setPage(location.hash.slice(1)||'over',false);
    ready();
    await refreshAll();
  }catch(error){
    if(!document.documentElement.classList.contains('cn-ready')){
      document.body.replaceChildren();
      const screen=document.createElement('main');
      screen.style.cssText='padding:50px;color:#e9ebe2;background:#0b0d0a;min-height:100vh';
      const msg=document.createElement('p');msg.textContent=error.message||'后台连接失败';
      const link=document.createElement('a');link.href='/admin.html?legacy=1';link.textContent='返回管理员登录';
      screen.append(msg,link);document.body.append(screen);ready();
    }
  }
}
init();
