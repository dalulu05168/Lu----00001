const mobile = location.pathname === '/cn-mobile.html';
const key = 'gsp_token';
let token = sessionStorage.getItem(key);
let favorites = new Map();
let instruments = new Map();
let pendingFavorite = false;
let loading;
let signingIn = false;

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch('/api/' + path, {
    method, cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 401 && token) {
    sessionStorage.removeItem(key);
    token = null;
    location.replace(mobile ? '/cn-mobile.html' : '/');
  }
  if (!response.ok) throw new Error('HTTP ' + response.status);
  if (response.status !== 204) return response.json();
}

const label = item => item.market + ':' + item.symbol;
const cents = value => value != null && Number.isSafeInteger(Number(value)) ? Number(value) / 100 : null;
const validInstrument = item => /^[A-Z]{2,8}$/.test(item.market) && /^[A-Z0-9][A-Z0-9.:-]{0,23}$/.test(item.symbol);

async function refresh() {
  const snapshot = await request('account');
  const [catalog, watchlist] = await Promise.allSettled([request('catalog'), request('watchlist')]);
  instruments = new Map();
  favorites = new Map();
  const names = Object.create(null);
  const sec = Object.create(null);
  for (const item of catalog.value?.items || []) {
    if (!validInstrument(item)) continue;
    const code = label(item);
    instruments.set(code, item);
    names[code] = item.name;
    sec[code] = { market: item.market, type: {STOCK:'股票', FUND:'基金', IPO:'IPO', COMMODITY:'大宗商品'}[item.itemType] };
  }
  for (const item of watchlist.value?.items || []) {
    if (validInstrument(item)) favorites.set(label(item), item);
  }
  for (const item of [...snapshot.positions, ...snapshot.orders, ...favorites.values()]) {
    if (validInstrument(item)) names[label(item)] ??= label(item);
  }
  const fav = [...favorites.keys()];
  const view = {
    acct: String(snapshot.account.id).slice(-8),
    cashOverride: cents(snapshot.account.cashCents),
    names,
    sync: new Intl.DateTimeFormat('zh-CN', {dateStyle:'short', timeStyle:'short', timeZone:'Asia/Kuala_Lumpur'}).format(new Date()) + ' MYT',
    holds: snapshot.positions.filter(validInstrument).map(p => ({s:label(p), q:Number(p.quantity), c:null})),
    orders: snapshot.orders.filter(validInstrument).map(o => ({
      s:label(o), t:o.side === 'SELL' ? '卖出' : '买入', q:Number(o.quantity),
      p:cents(o.price_cents), a:cents(o.amount_usd_cents), id:String(o.id || '').replace(/[^a-zA-Z0-9-]/g,''),
      d:Number.isFinite(Date.parse(o.created_at)) ? new Date(o.created_at).toISOString() : '—',
      st:'已记录'
    })),
    ...(catalog.status === 'fulfilled' ? {sec} : {}),
    ...(watchlist.status === 'fulfilled' ? {watch:fav,fav} : {})
  };
  window.CN_RENDER_SNAPSHOT(view);
  document.documentElement.classList.add('cn-ready');
}

window.CN_REFRESH = () => {
  if (!loading) loading = refresh().finally(() => { loading = null; });
  return loading;
};
window.CN_FAVORITE = async code => {
  if (pendingFavorite) return;
  const item = favorites.get(code) || instruments.get(code) || (code === 'AA' ? {market:'US',symbol:'AA'} : null);
  if (!item) throw new Error('证券不可用');
  pendingFavorite = true;
  try {
    await request('watchlist', { method: favorites.has(label(item)) ? 'DELETE' : 'POST', body:{market:item.market,symbol:item.symbol} });
    if (loading) await loading.catch(() => {});
    await window.CN_REFRESH();
  } finally {
    pendingFavorite = false;
  }
};
window.CN_LOGIN = async (email, password) => {
  if (signingIn || !email || !password) return;
  signingIn = true;
  try {
    if (!token) {
      const session = await request('auth/login', {method:'POST',body:{email,password}});
      token = session.token;
      sessionStorage.setItem(key, token);
    }
    await window.CN_REFRESH();
  } finally {
    signingIn = false;
  }
};
window.CN_LOGOUT = async () => {
  try { if (token) await request('auth/logout', {method:'POST'}); }
  finally {
    sessionStorage.removeItem(key);
    location.replace(mobile ? '/cn-mobile.html' : '/');
  }
};

if (!mobile) {
  const navigation = document.querySelector('.top .right') || document.querySelector('header .right');
  const phone = document.createElement('a');
  phone.href = '/cn-mobile.html';
  phone.textContent = '手机端';
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.textContent = '退出';
  logout.addEventListener('click', () => void window.CN_LOGOUT().catch(() => {}));
  phone.className = logout.className = 'btn';
  (navigation || document.body).append(phone, logout);
}
if (token) {
  window.CN_REFRESH().catch(() => {
    document.documentElement.classList.add('cn-ready');
    const error = document.createElement('p');
    error.setAttribute('role','alert');
    error.textContent = '账户数据读取失败，请刷新重试。';
    document.body.prepend(error);
  });
} else if (!mobile) {
  location.replace('/');
}
