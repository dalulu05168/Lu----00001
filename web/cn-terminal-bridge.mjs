// Authenticated CN Capital terminal adapter. Existing login/auth endpoints stay unchanged.
import { mountStockChart } from './stock-chart.mjs';

const token = sessionStorage.getItem('gsp_token');
const ready = () => document.documentElement.classList.add('cn-ready');
const errorView = (message) => {
  document.body.innerHTML = '';
  const main = document.createElement('main');
  main.style.cssText = 'display:grid;place-items:center;min-height:100vh;padding:24px;color:#e9ebe2;background:#080a06;font:15px sans-serif';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:420px;text-align:center';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  const retry = document.createElement('a');
  retry.href = '/';
  retry.textContent = '返回登录';
  retry.style.cssText = 'color:#d7ff00';
  box.append(paragraph, retry); main.append(box); document.body.append(main); ready();
};
const authHeaders = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

function attachToolbar() {
  const right = document.querySelector('.top .right');
  if (!right || document.getElementById('cn-logout')) return;
  const logout = document.createElement('button');
  logout.id = 'cn-logout';
  logout.className = 'btn';
  logout.type = 'button';
  logout.textContent = '退出';
  logout.addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', {method:'POST',headers:authHeaders()}); }
    finally {sessionStorage.removeItem('gsp_token'); location.assign('/');}
  });
  right.append(logout);
}

function attachUsChart() {
  const host = document.getElementById('cw');
  if (!host || document.getElementById('cn-chart-switch')) return;
  const toggle = document.createElement('button');
  toggle.id = 'cn-chart-switch';
  toggle.className = 'btn';
  toggle.textContent = 'TradingView 图表';
  toggle.type = 'button';
  toggle.style.cssText = 'position:absolute;top:10px;right:12px;z-index:5';
  const layer = document.createElement('div');
  layer.id = 'cn-vendor-chart';
  layer.hidden = true;
  layer.style.cssText = 'position:absolute;inset:0;z-index:4;background:#080a06';
  toggle.addEventListener('click', () => {
    layer.hidden = !layer.hidden;
    toggle.textContent = layer.hidden ? 'TradingView 图表' : '返回原走势图';
    if(!layer.hidden) mountStockChart(layer, {market:'US',symbol:'AA'});
  });
  host.append(layer, toggle);
}

async function run() {
  if (!token) {location.replace('/#account-section');return;}
  try {
    const response = await fetch('/api/account', {headers:authHeaders(),cache:'no-store'});
    if (response.status === 401 || response.status === 403) {
      sessionStorage.removeItem('gsp_token'); location.replace('/#account-section'); return;
    }
    if (!response.ok) throw new Error('账户数据暂不可用');
    const account = await response.json();
    if (!account?.account || !Array.isArray(account.positions) || !Array.isArray(account.orders)) {
      throw new Error('账户响应格式不匹配');
    }
    if(typeof window.CN_SYNC_ACCOUNT !== 'function') throw new Error('新版界面尚未准备好');
    window.CN_SYNC_ACCOUNT(account);
    attachToolbar();
    attachUsChart();
    ready();
  } catch (error) { errorView(error?.message || '账户加载失败'); }
}
run();
