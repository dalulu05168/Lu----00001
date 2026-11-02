import { summarizeMarketHoldings } from "./market-allocation.mjs";
const MARKETS = [
  {code:"US",label:"美国市场",exchange:"NYSE / NASDAQ",currency:"USD",icon:"US",sub:"United States"},
  {code:"HK",label:"香港市场",exchange:"HKEX",currency:"HKD",icon:"HK",sub:"Hong Kong"},
  {code:"CN",label:"中国内地",exchange:"SSE / SZSE",currency:"CNY",icon:"CN",sub:"China"},
  {code:"MY",label:"马来西亚",exchange:"BURSA MALAYSIA",currency:"MYR",icon:"MY",sub:"Malaysia"}
];
const INSTRUMENTS = [
  {market:"US",symbol:"AAPL",name:"Apple Inc."},
  {market:"US",symbol:"MSFT",name:"Microsoft Corporation"},
  {market:"HK",symbol:"0700",name:"Tencent Holdings"},
  {market:"HK",symbol:"9988",name:"Alibaba Group"},
  {market:"CN",symbol:"600519",name:"贵州茅台"},
  {market:"CN",symbol:"000001",name:"平安银行"},
  {market:"MY",symbol:"1155",name:"Maybank"},
  {market:"MY",symbol:"1023",name:"CIMB Group"}
];
const el = id => document.getElementById(id);
let market = "US";
let selected = INSTRUMENTS[0];
let account = null;
let token = sessionStorage.getItem("gsp_token");
let pricingConnected = false;
let authBusy = false;
let accountRefreshing = false;
let lastSyncedAt = null;
let watchlist = [];
let watchlistBusy = false;
let watchlistLoaded = false;
let watchlistFetching = false;
let watchlistFetchSequence = 0;
let catalog = [];
let catalogLoaded = false;
let catalogBusy = false;

const money = cents => {
  const value = Number(cents);
  if (!Number.isSafeInteger(value)) return "—";
  return (value / 100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
};
function textNode(label, cls) {
  const node = document.createElement("span");
  node.textContent = label;
  if (cls) node.className = cls;
  return node;
}
function makeEmpty(label) {
  const node = document.createElement("div");
  node.className = "record-empty";
  node.textContent = label;
  return node;
}
function renderMarkets() {
  const allocation = summarizeMarketHoldings(account?.positions ?? null);
  const marketButtons = MARKETS.map(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "market" + (market === item.code ? " active" : "");
    button.setAttribute("aria-pressed", String(market === item.code));
    button.append(textNode(item.icon,"market-code"));
    const label = document.createElement("span");
    label.className = "market-label";
    const title = document.createElement("strong");
    title.textContent = item.label;
    const exchange = document.createElement("small");
    exchange.textContent = item.exchange;
    label.append(title,exchange);
    button.append(label,textNode("›","market-arrow"));
    button.addEventListener("click",() => pickMarket(item.code));
    return button;
  });
  el("markets").replaceChildren(...marketButtons);
  const cards = MARKETS.map(item => {
    const count = allocation.markets[item.code];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "market-card" + (market === item.code ? " active" : "");
    button.setAttribute("aria-label",item.label + "，" + (allocation.available ? count.count + " 只持仓标的，占 " + count.percent + "%" : "登录后显示持仓统计"));
    const ratio = textNode(allocation.available ? count.percent + "%" : "—","market-card-ratio");
    const barBox = document.createElement("span");
    barBox.className = "market-card-bottom";
    const bar = document.createElement("span");
    bar.className = "market-card-bar";
    bar.style.height = allocation.available ? count.percent + "%" : "0%";
    barBox.append(bar);
    const name = document.createElement("span");
    name.className = "market-card-top";
    name.append(textNode(item.code,"market-card-code"),textNode(item.label,"market-card-name"));
    const detail = textNode(allocation.available ? count.count + " 只标的" : "登录后显示","market-card-detail");
    button.append(ratio,barBox,name,detail);
    button.addEventListener("click",() => {
      pickMarket(item.code);
      el("terminal-section").scrollIntoView({behavior:"smooth",block:"start"});
    });
    return button;
  });
  el("marketCards").replaceChildren(...cards);
}

function pickMarket(code) {
  if (!MARKETS.some(item => item.code === code)) return;
  market = code;
  selected = INSTRUMENTS.find(item => item.market === code);
  el("search").value = "";
  render();
}
function renderSymbols() {
  const search = el("search").value.trim().toLocaleLowerCase();
  const items = INSTRUMENTS.filter(item => item.market === market &&
    (item.symbol.toLowerCase().includes(search) || item.name.toLocaleLowerCase().includes(search)));
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "symbol-empty";
    empty.textContent = "未找到符合条件的股票代码";
    el("symbols").replaceChildren(empty);
    return;
  }
  const buttons = items.map(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol" + (item.market === selected.market && item.symbol === selected.symbol ? " active" : "");
    button.setAttribute("aria-pressed",String(item.market === selected.market && item.symbol === selected.symbol));
    button.append(textNode(item.symbol.slice(0,2),"symbol-icon"));
    const description = document.createElement("span");
    description.className = "symbol-text";
    const code = document.createElement("strong");
    code.textContent = item.symbol;
    const name = document.createElement("small");
    name.textContent = item.name;
    description.append(code,name);
    button.append(description,textNode("›","symbol-status"));
    button.addEventListener("click",() => {selected = item;render();});
    return button;
  });
  el("symbols").replaceChildren(...buttons);
  renderWatchlistControl();
  renderCatalog();
}
function renderSavedWatchlist() {
  const list=el("savedWatchlist");
  const refreshButton=el("refreshWatchlistButton");
  refreshButton.hidden=!token;
  refreshButton.disabled=!token||watchlistBusy||watchlistFetching;
  el("savedWatchlistCount").textContent=token&&watchlistLoaded ? String(watchlist.length) : "—";
  if(!token) {
    list.replaceChildren(makeEmpty("登录后查看已收藏股票"));
    return;
  }
  if(!watchlistLoaded) {
    list.replaceChildren(makeEmpty(watchlistFetching ? "正在读取自选列表…" : "自选列表尚未同步，可点击刷新重试"));
    return;
  }
  if(!watchlist.length) {
    list.replaceChildren(makeEmpty("暂无自选股票 · 点击图表上方的加入自选"));
    return;
  }
  const rows=watchlist.filter(item=>item&&MARKETS.some(m=>m.code===item.market)&&typeof item.symbol==="string").map(item=>{
    const row=document.createElement("div");
    row.className="saved-watchlist-row";
    const identity=document.createElement("div");
    identity.className="saved-watchlist-identity";
    identity.append(textNode(item.market,"saved-watchlist-market"));
    const description=document.createElement("span");
    description.className="saved-watchlist-description";
    const symbol=document.createElement("strong");
    symbol.textContent=item.symbol;
    const label=document.createElement("small");
    label.textContent=INSTRUMENTS.find(s=>s.market===item.market&&s.symbol===item.symbol)?.name || "自选代码（未验证行情）";
    description.append(symbol,label);
    identity.append(description);
    const actions=document.createElement("div");
    actions.className="saved-watchlist-actions";
    const view=document.createElement("button");
    view.type="button";
    view.className="saved-watchlist-open";
    view.textContent="查看";
    view.setAttribute("aria-label","查看 "+item.market+" "+item.symbol+" 走势图");
    view.addEventListener("click",()=>selectWatchlistInstrument(item));
    const remove=document.createElement("button");
    remove.type="button";
    remove.className="saved-watchlist-remove";
    remove.textContent="移除";
    remove.disabled=watchlistBusy;
    remove.setAttribute("aria-label","移除自选 "+item.market+" "+item.symbol);
    remove.addEventListener("click",()=>changeWatchlistItem(item,true));
    actions.append(view,remove);
    row.append(identity,actions);
    return row;
  });
  list.replaceChildren(...rows);
}
function selectWatchlistInstrument(item) {
  if(!MARKETS.some(m=>m.code===item.market)||typeof item.symbol!=="string")return;
  market=item.market;
  selected=INSTRUMENTS.find(s=>s.market===item.market&&s.symbol===item.symbol) ||
    {market:item.market,symbol:item.symbol,name:"自选代码（未验证行情）"};
  el("search").value="";
  el("watchlistFeedback").textContent="自选列表保存于当前账户";
  render();
  el("terminal-section").scrollIntoView?.({behavior:"smooth",block:"start"});
}
function renderWatchlistControl() {
  const button=el("watchlistToggle");
  const saved=watchlist.some(item=>item.market===selected.market&&item.symbol===selected.symbol);
  button.textContent=saved?"★ 已加入自选":"☆ 加入自选";
  button.disabled=!token||watchlistBusy;
  button.setAttribute("aria-pressed",String(saved));
  const feedback=el("watchlistFeedback");
  if(!token) feedback.textContent="";
  else if(watchlistBusy) feedback.textContent="正在同步自选…";
  renderSavedWatchlist();
}
async function refreshWatchlist() {
  if(!token){
    watchlist=[];
    watchlistLoaded=false;
    watchlistFetching=false;
    watchlistFetchSequence++;
    renderWatchlistControl();
    return;
  }
  const current=token,sequence=++watchlistFetchSequence;
  watchlistFetching=true;
  renderWatchlistControl();
  try {
    const data=await request("/watchlist");
    if(current!==token||sequence!==watchlistFetchSequence)return;
    if(!Array.isArray(data?.items))throw new Error("自选数据格式异常");
    watchlist=data.items;
    watchlistLoaded=true;
    el("savedWatchlistFeedback").textContent="";
  }catch(error) {
    if(current!==token||sequence!==watchlistFetchSequence)return;
    watchlistLoaded=false;
    el("savedWatchlistFeedback").textContent="自选列表同步失败："+error.message;
  }finally{
    if(sequence===watchlistFetchSequence){
      watchlistFetching=false;
      renderWatchlistControl();
    }
  }
}
async function changeWatchlistItem(item, remove) {
  if(!token||watchlistBusy||!MARKETS.some(m=>m.code===item.market))return;
  const current=token;
  watchlistBusy=true;
  renderWatchlistControl();
  try {
    await request("/watchlist",{method:remove?"DELETE":"POST",body:{market:item.market,symbol:item.symbol}});
    if(current!==token)return;
    await refreshWatchlist();
    if(current!==token)return;
    const notice=remove?"已从自选移除":"已保存到自选";
    el("savedWatchlistFeedback").textContent=notice;
    el("watchlistFeedback").textContent=notice;
  }catch(error){
    if(current===token){
      el("savedWatchlistFeedback").textContent=error.message;
      el("watchlistFeedback").textContent=error.message;
    }
  }finally {
    watchlistBusy=false;
    renderWatchlistControl();
  }
}
function renderCatalog() {
  const button=el("refreshCatalogButton");
  button.hidden=!token;
  button.disabled=catalogBusy;
  const list=el("catalogItems");
  if(!token){list.replaceChildren(makeEmpty("登录后查看商品目录"));return;}
  if(!catalogLoaded){list.replaceChildren(makeEmpty(catalogBusy?"正在读取商品目录…":"目录尚未同步"));return;}
  if(!catalog.length){list.replaceChildren(makeEmpty("暂无已发布的证券资料"));return;}
  const cards=catalog.filter(x=>x&&typeof x==="object").map(item=>{
    const row=document.createElement("article");
    row.className="catalog-row";
    const info=document.createElement("div");info.className="catalog-info";
    const title=document.createElement("strong");
    title.textContent=(item.itemType==="STOCK"?"股票":item.itemType==="FUND"?"基金":"IPO")+" · "+item.name;
    const desc=document.createElement("small");
    desc.textContent=item.market+":"+item.symbol+" · 证券资料";
    info.append(title,desc);
    row.append(info);return row;
  });
  list.replaceChildren(...cards);
}
async function refreshCatalog() {
  if(!token){catalog=[];catalogLoaded=false;renderCatalog();return;}
  const current=token;catalogBusy=true;renderCatalog();
  try {
    const data=await request("/catalog");
    if(current!==token)return;
    if(!Array.isArray(data?.items))throw Error("商品目录格式异常");
    catalog=data.items;catalogLoaded=true;
    el("catalogFeedback").textContent="";
  }catch(error){
    if(current!==token)return;
    catalogLoaded=false;
    el("catalogFeedback").textContent=error.message;
  }finally{catalogBusy=false;renderCatalog();}
}
function renderRecords() {
  const positions = Array.isArray(account?.positions) ? account.positions.filter(item =>
    item && MARKETS.some(m => m.code === item.market) && typeof item.symbol === "string" &&
    item.symbol.trim() && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
  ) : [];
  const orders = Array.isArray(account?.orders) ? account.orders : [];
  el("positionCount").textContent = account ? String(positions.length) : "—";
  el("orderCount").textContent = account ? String(orders.length) : "—";
  const posRows = positions.map(item => {
    const node = document.createElement("div");
    node.className = "record-item holding-row";
    const left = document.createElement("div");
    left.className = "holding-identity";
    const icon = textNode(item.market, "holding-market");
    const stock = document.createElement("div");
    stock.className = "holding-company";
    const code = document.createElement("strong");
    code.textContent = item.symbol;
    const name = textNode(INSTRUMENTS.find(s=>s.market === item.market && s.symbol === item.symbol)?.name || item.market + " MARKET","holding-name");
    stock.append(code,name);
    left.append(icon,stock);
    const right = document.createElement("div");
    right.className = "holding-quantity";
    const quantity = Number(item.quantity);
    right.append(textNode(Number.isSafeInteger(quantity) ? new Intl.NumberFormat("en-US").format(quantity) : String(item.quantity),"holding-quantity-value"),textNode("股","holding-quantity-unit"));
    node.append(left,right);
    return node;
  });
  el("positions").replaceChildren(...(posRows.length ? posRows : [makeEmpty(account ? "暂无持仓记录" : "登录后查看当前持仓")]));
  const orderRows = orders.slice(0,8).map(item => {
    const node = document.createElement("div");
    node.className = "record-item";
    const left = document.createElement("span");
    left.textContent = item.market + " · " + item.symbol + " · " + (item.side === "BUY" ? "买入" : "卖出");
    const right = document.createElement("small");
    right.textContent = String(item.quantity) + " 股";
    node.append(left,right);
    return node;
  });
  el("orders").replaceChildren(...(orderRows.length ? orderRows : [makeEmpty(account ? "暂无内部订单记录" : "登录后查看订单记录")]));
}

function render() {
  renderMarkets();
  renderSymbols();
  const selectedMarket = MARKETS.find(item => item.code === selected.market);
  el("marketLabel").textContent = selectedMarket.code + " MARKET";
  el("symbolTitle").textContent = selected.symbol;
  el("symbolName").textContent = selected.name;
  el("quotePrice").textContent = "—";
  el("orderSymbol").textContent = selected.market + " · " + selected.symbol;
  el("orderQuoteStatus").textContent = pricingConnected ? "已连接" : "未连接";
  el("cash").textContent = account ? money(account.account.cashCents) : "—";
  el("accountStatus").textContent = !token ? "未登录" : account ? "已连接" : "待同步";
  el("accountStatus").classList.toggle("ready",Boolean(account));
  el("authPanel").hidden = Boolean(token);
  el("accountSummary").hidden = !account;
  el("refreshAccountButton").hidden = !token;
  el("refreshAccountButton").disabled = accountRefreshing;
  el("refreshAccountButton").textContent = accountRefreshing ? "同步中…" : "刷新数据";
  el("accountIdLabel").textContent = account?.account?.id
    ? (account.account.id.length > 16 ? "••••" + account.account.id.slice(-8) : account.account.id)
    : "—";
  el("accountCashValue").textContent = account ? money(account.account.cashCents) : "—";
  el("accountCurrency").textContent = account?.account?.currency ?? "—";
  el("accountSyncedAt").textContent = lastSyncedAt && account
    ? "上次同步：" + new Intl.DateTimeFormat("zh-CN",{
        timeZone:"Asia/Kuala_Lumpur",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
      }).format(lastSyncedAt) + " MYT"
    : "尚未同步";
  el("logout").hidden = !token;
  el("orderForm").querySelector('button[type="submit"]').disabled = !token || !account || !pricingConnected;
  renderRecords();
  renderWatchlistControl();
}
async function request(path,options = {}) {
  let result;
  let response;
  try {
    response = await fetch("/api" + path,{
      method:options.method || "GET",
      headers:{"content-type":"application/json",...(token ? {authorization:"Bearer " + token} : {}),...(options.headers || {})},
      ...(options.body ? {body:JSON.stringify(options.body)} : {}),
      cache:"no-store"
    });
    result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  } catch {
    throw new Error("无法连接服务，请检查网络或部署状态");
  }
  if (!response.ok) {
    if (response.status === 503 && path !== "/orders") throw new Error("账户数据库尚未连接，登录服务暂不可用");
    if (response.status === 503 && path === "/orders") throw new Error("可信报价服务尚未接入，订单未执行");
    if (response.status === 401) throw new Error("账户认证失败或会话已失效");
    throw new Error(result.error || "请求失败（HTTP " + response.status + "）");
  }
  return result;
}
async function refreshAccount() {
  if (!token) { account = null; lastSyncedAt = null; render(); return; }
  if (accountRefreshing) return;
  accountRefreshing = true;
  const requestedToken = token;
  render();
  try {
    const data = await request("/account");
    if (requestedToken !== token) return;
    if (!data?.account || !Array.isArray(data.positions) || !Array.isArray(data.orders)) {
      throw new Error("账户数据格式不正确");
    }
    account = data;
    lastSyncedAt = new Date();
    await refreshWatchlist();
    await refreshCatalog();
    el("authFeedback").textContent = "账户数据已同步";
  } catch(error) {
    if (requestedToken !== token) return;
    account = null;
    lastSyncedAt = null;
    el("authFeedback").textContent = error.message;
    if (/认证失败|会话已失效/.test(error.message)) {
      token = null;
      watchlist = [];
      watchlistLoaded = false;
      watchlistFetchSequence++;
      sessionStorage.removeItem("gsp_token");
    }
  } finally {
    accountRefreshing = false;
    render();
  }
}

async function updateConnection() {
  const status = el("connectionStatus");
  const label = el("connectionText");
  status.classList.remove("ready","failed");
  label.textContent = "检测服务连接";
  try {
    const res = await fetch("/api/health",{cache:"no-store"});
    if (!res.ok) throw new Error("API unavailable");
    const health = await res.json();
    if (health.status !== "alive") throw new Error("Unexpected API status");
    pricingConnected = health.pricingConnected === true;
    const dbResponse = await fetch("/api/ready",{cache:"no-store"});
    if (!dbResponse.ok) {
      status.classList.add("failed");
      label.textContent = "账户数据库未连接";
    } else {
      const database = await dbResponse.json();
      if (database.status !== "ready" || database.database !== "connected") {
        status.classList.add("failed");
        label.textContent = "账户数据库未就绪";
      } else {
        status.classList.add("ready");
        label.textContent = pricingConnected ? "账户与行情就绪" : "账户已连接 · 行情待接入";
      }
    }
  } catch {
    status.classList.add("failed");
    label.textContent = "接口暂不可用";
    pricingConnected = false;
  }
  render();
}
function updateClock() {
  el("clock").textContent = new Intl.DateTimeFormat("zh-CN",{
    timeZone:"Asia/Kuala_Lumpur",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false
  }).format(new Date()) + " MYT";
}
el("search").addEventListener("input",renderSymbols);
el("watchlistToggle").addEventListener("click",()=>{
  const item={market:selected.market,symbol:selected.symbol};
  const exists=watchlist.some(x=>x.market===item.market&&x.symbol===item.symbol);
  changeWatchlistItem(item,exists);
});
el("refreshWatchlistButton").addEventListener("click",()=>{if(token&&!watchlistBusy)refreshWatchlist();});
el("refreshCatalogButton").addEventListener("click",()=>{if(token&&!catalogBusy)refreshCatalog();});
el("refreshAccountButton").addEventListener("click",() => { if(token) refreshAccount(); });
el("authForm").addEventListener("submit",async event => {
  event.preventDefault();
  if (authBusy) return;
  authBusy = true;
  const buttons = el("authForm").querySelectorAll("button");
  buttons.forEach(button => {button.disabled = true;});
  el("authFeedback").textContent = "正在验证账户...";
  try {
    const email = el("email").value.trim();
    const password = el("password").value;
    if (event.submitter?.value === "register") {
      const inviteCode=el("inviteCode").value.trim();
      await request("/auth/register",{method:"POST",body:{
        email,password,...(inviteCode?{inviteCode}:{})
      }});
    }
    const session = await request("/auth/login",{method:"POST",body:{email,password}});
    if (!session.token) throw new Error("登录接口未返回有效会话");
    token = session.token;
    sessionStorage.setItem("gsp_token",token);
    el("password").value = "";
    await refreshAccount();
  } catch(error) {
    el("authFeedback").textContent = error.message;
  } finally {
    authBusy = false;
    buttons.forEach(button => {button.disabled = false;});
    render();
  }
});
el("railLogout").addEventListener("click",() => {
  if (token) el("logout").click();
  else el("account-section").scrollIntoView({behavior:"smooth",block:"start"});
});
el("logout").addEventListener("click",async () => {
  if (!token) return;
  el("logout").disabled = true;
  try {
    await request("/auth/logout",{method:"POST"});
    sessionStorage.removeItem("gsp_token");
    token = null;
    account = null;
    lastSyncedAt = null;
    watchlist = [];
    watchlistLoaded = false;
    watchlistFetchSequence++;
    catalog=[];
    catalogLoaded=false;
    el("savedWatchlistFeedback").textContent="";
    el("authFeedback").textContent = "已退出账户";
    render();
  } catch(error) {
    el("authFeedback").textContent = error.message;
  } finally {el("logout").disabled = false;}
});
el("orderForm").addEventListener("submit",async event => {
  event.preventDefault();
  if (!account || !token) {
    el("feedback").textContent = "请先登录并同步账户";
    return;
  }
  if (!pricingConnected) {
    el("feedback").textContent = "可信报价未连接，订单没有提交";
    return;
  }
  const button = el("orderForm").querySelector('button[type="submit"]');
  button.disabled = true;
  el("feedback").textContent = "正在提交内部订单...";
  try {
    const result = await request("/orders",{
      method:"POST",
      headers:{"idempotency-key":crypto.randomUUID()},
      body:{side:el("side").value,market:selected.market,symbol:selected.symbol,quantity:Number(el("quantity").value)}
    });
    el("feedback").textContent = result.replayed ? "已查询到原内部订单" : "内部订单已由服务器记录";
    await refreshAccount();
  } catch(error) {
    el("feedback").textContent = error.message;
  } finally {
    button.disabled = !token || !account || !pricingConnected;
  }
});
render();
updateClock();
updateConnection();
refreshAccount();
