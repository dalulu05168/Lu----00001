import { summarizeMarketHoldings } from "./market-allocation.mjs";
import { mergePublishedInstruments } from "./catalog-instruments.mjs";
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
const visibleInstruments = () => mergePublishedInstruments(INSTRUMENTS,catalog,{authenticated:Boolean(token),catalogLoaded,markets:MARKETS.map(item=>item.code)});
const instrumentName = (market,symbol) => {
 const published = catalogLoaded && token
  ? catalog.find(item=>item && ["STOCK","FUND"].includes(item.itemType) &&
      item.market===market && item.symbol===symbol && typeof item.name==="string" && item.name.trim())
  : null;
 return published?.name.trim() || INSTRUMENTS.find(item=>item.market===market&&item.symbol===symbol)?.name;
};
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
let transactionPage = 1;
let transactionPageSize = 10;


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
  selected = visibleInstruments().find(item => item.market === code) || INSTRUMENTS.find(item => item.market === code);
  el("search").value = "";
  render();
}
function renderSymbols() {
  const search = el("search").value.trim().toLocaleLowerCase();
  const items = visibleInstruments().filter(item => item.market === market &&
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
    label.textContent=instrumentName(item.market,item.symbol) || "自选代码（未验证行情）";
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
  selected=visibleInstruments().find(s=>s.market===item.market&&s.symbol===item.symbol) ||
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
  if(!token){list.replaceChildren(makeEmpty("登录后查看证券资料"));return;}
  if(!catalogLoaded){list.replaceChildren(makeEmpty(catalogBusy?"正在读取证券资料…":"证券资料尚未同步"));return;}
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
    if(!Array.isArray(data?.items))throw Error("证券资料目录格式异常");
    catalog=data.items;catalogLoaded=true;
    const updated=visibleInstruments().find(item=>item.market===selected.market&&item.symbol===selected.symbol);
    if(updated)selected=updated;
    el("catalogFeedback").textContent="";
    render();
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
    const name = textNode(instrumentName(item.market,item.symbol) || item.market + " MARKET","holding-name");
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
  el("orders").replaceChildren(...(orderRows.length ? orderRows : [makeEmpty(account ? "暂无订单记录" : "登录后查看订单记录")]));
}


const TRANSACTION_RANGE_LABELS = Object.freeze({
  all:"All time", "7d":"Last 7 days", "30d":"Last 30 days", "90d":"Last 90 days"
});
function transactionName(item) {
  return instrumentName(item.market,item.symbol) || "名称未登记";
}
function transactionPrice(item) {
  const marketInfo = MARKETS.find(entry => entry.code === item.market);
  const rawCents = item?.price_cents;
  if (!marketInfo || rawCents === null || rawCents === undefined || rawCents === "") return "—";
  const cents = Number(rawCents);
  if (!Number.isSafeInteger(cents) || cents < 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style:"currency", currency:marketInfo.currency, minimumFractionDigits:2, maximumFractionDigits:2
  }).format(cents / 100);
}
function transactionAmount(item) {
  const rawCents = item?.amount_usd_cents;
  if (rawCents === null || rawCents === undefined || rawCents === "") return "—";
  const cents = Number(rawCents);
  return Number.isSafeInteger(cents) && cents >= 0 ? "$" + money(cents) : "—";
}
function transactionTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone:"Asia/Kuala_Lumpur", month:"short", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  }).format(date);
}
function filteredTransactions() {
  const orders = Array.isArray(account?.orders) ? account.orders : [];
  const query = el("transactionSearch").value.trim().toLocaleLowerCase();
  const range = el("transactionRange").value;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 0;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  return orders.filter(item => {
    if (!item || typeof item !== "object") return false;
    if (query) {
      const haystack = [item.market,item.symbol,transactionName(item),item.side].join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (days) {
      const timestamp = item.created_at ? new Date(item.created_at).getTime() : NaN;
      if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > Date.now()) return false;
    }
    return true;
  });
}
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text;
}
function exportTransactionHistory() {
  const orders = filteredTransactions();
  if (!account || !orders.length) return;
  const rows = [
    ["Market","Symbol","Name","Side","Price","Price Currency","Quantity","Total USD","Record Status","Time"],
    ...orders.map(item => {
      const marketInfo = MARKETS.find(entry => entry.code === item.market);
      return [
        item.market,item.symbol,transactionName(item),item.side,
        transactionPrice(item),marketInfo?.currency ?? "",
        item.quantity,transactionAmount(item),"INTERNAL",item.created_at ?? ""
      ];
    })
  ];
  const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "transactions-" + new Date().toISOString().slice(0,10) + ".csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
function renderTransactionHistory() {
  const allOrders = Array.isArray(account?.orders) ? account.orders : [];
  let volumeCents = 0;
  let volumeCount = 0;
  let volumeSafe = true;
  for (const item of allOrders) {
    const rawCents = item?.amount_usd_cents;
    if (rawCents === null || rawCents === undefined || rawCents === "") continue;
    const cents = Number(rawCents);
    if (!Number.isSafeInteger(cents) || cents < 0) continue;
    if (!Number.isSafeInteger(volumeCents + cents)) { volumeSafe = false; break; }
    volumeCents += cents;
    volumeCount++;
  }
  el("transactionVolume").textContent = account && volumeCount && volumeSafe ? "$" + money(volumeCents) : "—";
  el("transactionVolumeNote").textContent = !account
    ? "登录后查看真实账户记录"
    : volumeCount && volumeSafe
      ? volumeCount + " 笔有效金额 · USD 等值"
      : allOrders.length ? "订单金额字段不可用" : "暂无交易记录";
  el("realizedPnl").textContent = "—";
  el("realizedPnlNote").textContent = "缺少逐笔成本匹配数据，暂不计算";
  el("internalRecordCount").textContent = account ? String(allOrders.length) : "—";
  el("brokerExecutionStatus").textContent = "未连接";

  const range = el("transactionRange").value;
  el("transactionRangeLabel").textContent = TRANSACTION_RANGE_LABELS[range] ?? "All time";
  const filtered = filteredTransactions();
  const pageCount = Math.max(1,Math.ceil(filtered.length / transactionPageSize));
  transactionPage = Math.min(Math.max(1,transactionPage),pageCount);
  const start = (transactionPage - 1) * transactionPageSize;
  const visible = filtered.slice(start,start + transactionPageSize);
  const body = el("transactionRows");
  if (!account) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "transaction-empty";
    cell.textContent = "登录后查看账户交易记录";
    row.append(cell);
    body.replaceChildren(row);
  } else if (!allOrders.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "transaction-empty";
    cell.textContent = "暂无交易记录";
    row.append(cell);
    body.replaceChildren(row);
  } else if (!visible.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "transaction-empty";
    cell.textContent = "没有符合筛选条件的记录";
    row.append(cell);
    body.replaceChildren(row);
  } else {
    const rows = visible.map(item => {
      const row = document.createElement("tr");
      row.dataset.transactionRow = "true";
      const symbol = document.createElement("td");
      symbol.className = "transaction-symbol-cell";
      symbol.append(textNode(item.symbol || "—","transaction-symbol-code"),textNode(item.market || "—","transaction-market-code"));
      const name = document.createElement("td");
      name.className = "transaction-name-cell";
      name.textContent = transactionName(item);
      const side = document.createElement("td");
      const sideLabel = textNode(item.side === "BUY" ? "↑ Buy" : item.side === "SELL" ? "↓ Sell" : "—",
        item.side === "BUY" ? "transaction-side side-buy" : item.side === "SELL" ? "transaction-side side-sell" : "transaction-side");
      side.append(sideLabel);
      const price = document.createElement("td");
      price.textContent = transactionPrice(item);
      const quantity = document.createElement("td");
      const qty = Number(item.quantity);
      quantity.textContent = Number.isSafeInteger(qty) && qty >= 0 ? qty.toLocaleString("en-US") : "—";
      const amount = document.createElement("td");
      amount.className = "transaction-amount-cell";
      amount.textContent = transactionAmount(item);
      const status = document.createElement("td");
      status.append(textNode("INTERNAL","record-status internal-status"));
      const time = document.createElement("td");
      time.className = "transaction-time-cell";
      time.textContent = transactionTime(item.created_at);
      row.append(symbol,name,side,price,quantity,amount,status,time);
      return row;
    });
    body.replaceChildren(...rows);
  }
  const total = filtered.length;
  const first = total ? start + 1 : 0;
  const last = Math.min(start + transactionPageSize,total);
  el("transactionPageSummary").textContent = account ? "Showing " + first + "–" + last + " of " + total : "登录后查看";
  el("transactionPageNumber").textContent = transactionPage + " / " + pageCount;
  el("transactionPrev").disabled = !account || transactionPage <= 1;
  el("transactionNext").disabled = !account || transactionPage >= pageCount;
  el("exportHistoryButton").disabled = !account || filtered.length === 0;
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
  renderTransactionHistory();
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
el("transactionSearch").addEventListener("input",() => {
  transactionPage = 1;
  renderTransactionHistory();
});
el("transactionRange").addEventListener("change",() => {
  transactionPage = 1;
  renderTransactionHistory();
});
el("transactionPageSize").addEventListener("change",() => {
  const size = Number(el("transactionPageSize").value);
  transactionPageSize = [10,25,50].includes(size) ? size : 10;
  transactionPage = 1;
  renderTransactionHistory();
});
el("transactionPrev").addEventListener("click",() => {
  transactionPage = Math.max(1,transactionPage - 1);
  renderTransactionHistory();
});
el("transactionNext").addEventListener("click",() => {
  transactionPage++;
  renderTransactionHistory();
});
el("exportHistoryButton").addEventListener("click",exportTransactionHistory);
document.querySelectorAll(".sidebar-link[href^='#']").forEach(link => {
  link.addEventListener("click",() => {
    document.querySelectorAll(".sidebar-link").forEach(item => item.classList.remove("active"));
    link.classList.add("active");
  });
});
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
    if (account) window.dispatchEvent(new Event("gsp:authenticated"));
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
  el("feedback").textContent = "正在提交订单记录...";
  try {
    const result = await request("/orders",{
      method:"POST",
      headers:{"idempotency-key":crypto.randomUUID()},
      body:{side:el("side").value,market:selected.market,symbol:selected.symbol,quantity:Number(el("quantity").value)}
    });
    el("feedback").textContent = result.replayed ? "已查询到原订单记录" : "订单已记录于平台";
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
