// Uses the original admin login/API. Does not broaden administrative privileges.
const token = sessionStorage.getItem('gsp_admin_token');
const ready = () => document.documentElement.classList.add('cn-ready');
const errorView = (message) => {
  document.body.textContent = '';
  const frame = document.createElement('main');
  frame.style.cssText = 'min-height:100vh;display:grid;place-items:center;background:#0b0d0a;color:#f1f4e8;font:15px sans-serif';
  const box = document.createElement('div');
  box.style.cssText = 'text-align:center;padding:24px';
  const txt = document.createElement('p');
  txt.textContent = message;
  const link = document.createElement('a');
  link.href = '/admin.html?legacy=1';
  link.textContent = '返回管理员登录';
  link.style.cssText = 'color:#d7ff00';
  box.append(txt,link);frame.append(box);document.body.append(frame);ready();
};
async function run() {
  if(!token) {location.replace('/admin.html');return;}
  try {
    const response = await fetch('/api/admin/me', {headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store'});
    if(response.status===401 || response.status===403) {
      sessionStorage.removeItem('gsp_admin_token');location.replace('/admin.html');return;
    }
    if(!response.ok) throw new Error('后台服务暂不可用');
    const identity = await response.json();
    if(!['MASTER','SUBADMIN'].includes(identity?.role)) throw new Error('账户没有管理员权限');
    const top = document.createElement('nav');
    top.id = 'cn-backend-switch';
    top.style.cssText = 'position:fixed;top:8px;right:10px;z-index:99999;display:flex;gap:8px';
    const management = document.createElement('a');
    management.href = '/admin.html?legacy=1';
    management.textContent = '系统管理';
    management.style.cssText = 'font:12px sans-serif;padding:8px 12px;border-radius:16px;background:#d7ff00;color:#111700;text-decoration:none';
    const logout = document.createElement('button');
    logout.textContent = '退出';
    logout.style.cssText = 'font:12px sans-serif;border:1px solid #b2b7aa;padding:8px 12px;border-radius:16px;background:#161915;color:#eef0e8;cursor:pointer';
    logout.addEventListener('click',()=>{sessionStorage.removeItem('gsp_admin_token');location.assign('/admin.html');});
    top.append(management,logout);
    document.body.append(top);
    ready();
  } catch (error) {errorView(error?.message || '后台连接失败');}
}
run();
