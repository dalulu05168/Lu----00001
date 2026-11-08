// Authenticated CN Capital terminal adapter. Existing login/auth endpoints stay unchanged.
import { mountStockChart } from './stock-chart.mjs';
import {readCatalog,readWatchlist,changeWatchlist} from './client-data-api.mjs';

// Isolated desktop adapter, not shared with mobile.
const token = sessionStorage.getItem('gsp_token');
const readOnlyPreview = new URLSearchParams(location.search).get('preview') === '1';
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


let watchlistItems = null;
let watchlistWriting = false;
function stillAuthenticated() {
  return Boolean(token && sessionStorage.getItem('gsp_token') === token);
}
function handleDataError(error,section) {
  if (error?.status === 401 || error?.status === 403) {
    sessionStorage.removeItem('gsp_token');
    location.replace('/#account-section');
    return;
  }
  if (stillAuthenticated() && typeof window.CN_DATA_STATUS === 'function') {
    window.CN_DATA_STATUS(section,section==='watchlist'?'自选列表暂不可用':'证券目录暂不可用');
  }
}
async function refreshClientCatalog() {
  const items = await readCatalog(token);
  if (stillAuthenticated()) window.CN_SYNC_CATALOG(items);
  return items;
}
async function refreshClientWatchlist() {
  const items = await readWatchlist(token);
  if (stillAuthenticated()) {
    watchlistItems = items;
    window.CN_SYNC_WATCHLIST(items);
  }
  return items;
}
window.CN_REFRESH_CATALOG = () =>
  refreshClientCatalog().catch(error => {handleDataError(error,'catalog');throw error;});
window.CN_TOGGLE_WATCHLIST = async key => {
  if (!stillAuthenticated()) throw new Error('登录已失效，请重新登录');
  if (watchlistWriting) throw new Error('自选操作正在处理');
  if (!Array.isArray(watchlistItems)) throw new Error('自选数据尚未同步');
  if (typeof key !== 'string' || !/^(US|CN):[A-Z0-9][A-Z0-9.-]{0,23}$/.test(key))
    throw new Error('无效的自选证券');
  const [market,symbol] = key.split(':');
  const wasSaved = watchlistItems.some(item => item.market===market && item.symbol===symbol);
  watchlistWriting = true;
  try {
    const items = await changeWatchlist(token,{market,symbol},watchlistItems);
    if (!stillAuthenticated()) throw new Error('登录已失效，请重新登录');
    watchlistItems = items;
    window.CN_SYNC_WATCHLIST(items);
    return !wasSaved;
  } catch(error) {
    if (error?.status === 401 || error?.status === 403) handleDataError(error,'watchlist');
    throw error;
  } finally {
    watchlistWriting = false;
  }
};
function refreshClientDatasets() {
  // Catalog and saved instruments are independent from account snapshot.
  // One failing must not wipe the authenticated cash/positions/order view.
  void Promise.allSettled([refreshClientCatalog(),refreshClientWatchlist()])
    .then(results => {
      if (results[0].status==='rejected') handleDataError(results[0].reason,'catalog');
      if (results[1].status==='rejected') handleDataError(results[1].reason,'watchlist');
    });
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
    if (!account?.account || !Number.isSafeInteger(account.account.cashCents) || !Array.isArray(account.positions) || !Array.isArray(account.orders)) {
      throw new Error('账户响应格式不匹配');
    }
    if(typeof window.CN_SYNC_ACCOUNT !== 'function') throw new Error('新版界面尚未准备好');
    window.CN_SYNC_ACCOUNT(account);
    attachToolbar();
    attachUsChart();
    ready();
    refreshClientDatasets();
  } catch (error) { errorView(error?.message || '账户加载失败'); }
}
if (readOnlyPreview) {
  // Render's static preview cannot serve /api/account. Do not make an auth
  // request, reuse an existing token, or allow fake local submission events.
  document.body.classList.add('desktop-readonly-preview');
  const notice = document.getElementById('desktop-public-preview');
  if (notice) notice.hidden = false;
  document.querySelectorAll('button, input, select').forEach(control => {
    if (control.matches('.nav .tn, #hidebtn')) return;
    control.disabled = true;
  });
  ready();
} else {
  run();
}
