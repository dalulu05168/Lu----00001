import { summarizeMarketHoldings } from "./market-allocation.mjs";
import { mountStockChart, resolveTradingViewSymbol } from "./stock-chart.mjs";
const MARKETS = [
  {code:"US",label:"美国市场",exchange:"NYSE / NASDAQ",currency:"USD",icon:"US",sub:"United States"},
  {code:"HK",label:"香港市场",exchange:"HKEX",currency:"HKD",icon:"HK",sub:"Hong Kong"},
  {code:"CN",label:"中国内地",exchange:"SSE / SZSE",currency:"CNY",icon:"CN",sub:"China"},
  {code:"MY",label:"马来西亚",exchange:"BURSA MALAYSIA",currency:"MYR",icon:"MY",sub:"Malaysia"},
  {code:"RO",label:"罗马尼亚市场",exchange:"BVB",currency:"RON",icon:"RO",sub:"Romania"}
];
const INSTRUMENTS = [
  {market:"US",symbol:"AAPL",name:"Apple Inc."},
  {market:"US",symbol:"MSFT",name:"Microsoft Corporation"},
  {market:"HK",symbol:"0700",name:"Tencent Holdings"},
  {market:"HK",symbol:"9988",name:"Alibaba Group"},
  {market:"CN",symbol:"600519",name:"贵州茅台"},
  {market:"CN",symbol:"000001",name:"平安银行"},
  {market:"MY",symbol:"1155",name:"Maybank"},
  {market:"MY",symbol:"1023",name:"CIMB Group"},
  {market:"RO",symbol:"BRD",name:"BRD – Groupe Société Générale"}
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
let catalogFetchSequence = 0;
let serviceFetchSequence = 0;
let transactionPage = 1;
let transactionPageSize = 10;
let serviceBusy=false,serviceRequests=[];
let internalProductsSerial=0,internalPurchaseBusy=false,internalPurchaseKeys=new Map();
let internalHoldings=[];
let tradeProducts=[],tradeCategory="STOCK";
let stockTradingConfigured=false;
let stockSaleConfigured=false;
const stockSaleKeys=new Map();
let productOrders=[];
let internalHoldingsUnavailable=false;
let privateDataReady=false,privateDataSerial=0;
let customerCommodityItems=[],customerCommoditySerial=0,customerSupportSerial=0;
let customerSupportClosed=false;
let accountAnalytics=null,accountAnalyticsSerial=0,accountAnalyticsState="idle",accountAnalyticsError="";
const ANALYTICS_REASONS={INCOMPLETE_HISTORY:"缺少买入成本记录，无法匹配卖出",
 POSITION_HISTORY_MISMATCH:"历史订单与当前持仓不一致",INVALID_RECORDS:"历史记录格式或顺序不完整",
 AMOUNT_OVERFLOW:"统计金额超出安全计算范围",LEDGER_HISTORY_UNAVAILABLE:"缺少可靠入账顺序或流水金额不符"};


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
function selectionInstruments(){
  const published=catalogLoaded?catalog.filter(item=>item&&["STOCK","FUND"].includes(item.itemType)&&
    MARKETS.some(m=>m.code===item.market)&&typeof item.symbol==="string"&&/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(item.symbol)&&
    typeof item.name==="string"&&item.name.trim()):[];
  const identities=new Set(published.map(item=>item.market+":"+item.symbol));
  return [...published,...INSTRUMENTS.filter(item=>!identities.has(item.market+":"+item.symbol))];
}
function renderChart(){
  const host=el("stockChart");
  if(!token||!account){
    host.replaceChildren(makeEmpty("登录后查看公开走势图"));delete host.dataset.chartSymbol;
    host.classList.remove("chart--external");return;
  }
  host.classList.add("chart--external");
  mountStockChart(host,selected);
}
function renderMarkets() {
  const allocation = summarizeMarketHoldings(account&&!internalHoldingsUnavailable?
    [...(account.positions??[]),...internalHoldings]:null);
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
    if(allocation.available&&count.count===0)barBox.append(textNode('暂无持仓','market-card-empty'));
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
  selected = selectionInstruments().find(item => item.market === code);
  el("search").value = "";
  render();
}
function renderSymbols() {
  const search = el("search").value.trim().toLocaleLowerCase();
  const items = selectionInstruments().filter(item => item.market === market &&
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
    label.textContent=selectionInstruments().find(s=>s.market===item.market&&s.symbol===item.symbol)?.name || "自选代码（未验证行情）";
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
  selected=selectionInstruments().find(s=>s.market===item.market&&s.symbol===item.symbol) ||
    {market:item.market,symbol:item.symbol,name:item.name??"证券名称暂不可用"};
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
    row.append(info);
    if(["STOCK","FUND"].includes(item.itemType)&&MARKETS.some(m=>m.code===item.market)&&
      typeof item.symbol==="string"&&/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(item.symbol)){
      const view=document.createElement("button");view.type="button";view.className="secondary-button";
      view.textContent="查看走势图";view.setAttribute("aria-label","查看 "+item.market+" "+item.symbol+" 走势图");
      view.addEventListener("click",()=>selectWatchlistInstrument(item));row.append(view);
    }
    return row;
  });
  list.replaceChildren(...cards);
}
async function refreshCatalog() {
  if(!token){catalog=[];catalogLoaded=false;renderCatalog();return;}
  const current=token,sequence=++catalogFetchSequence;catalogBusy=true;renderCatalog();
  try {
    const data=await request("/catalog");
    if(current!==token||sequence!==catalogFetchSequence)return;
    if(!Array.isArray(data?.items))throw Error("证券资料目录格式异常");
    catalog=data.items;catalogLoaded=true;
    selected=selectionInstruments().find(item=>item.market===selected.market&&item.symbol===selected.symbol)??selected;
    el("catalogFeedback").textContent="";
  }catch(error){
    if(current!==token||sequence!==catalogFetchSequence)return;
    catalogLoaded=false;
    el("catalogFeedback").textContent=error.message;
  }finally{if(sequence===catalogFetchSequence){catalogBusy=false;renderSymbols();renderChart();}}
}
const STOCK_QUOTE_ERRORS=new Set(["Stock price changed; refresh the quote and confirm again","Verified US stock quote unavailable"]);
function stockSaleForm(item){
 const available=Number(item.unlocked_quantity??0);
 if(item.manually_locked||item.market!=="US"||available<1){
  return textNode(item.manually_locked?"已人工锁仓":item.market!=="US"?"该市场暂未开放实时卖出":
    "暂无可卖数量 · 持仓仍在锁定期","stock-sale-note");
 }
 if(!stockSaleConfigured)return null;
 const form=document.createElement("form");form.className="stock-sale-form";
 form.setAttribute("aria-label",item.symbol+" 股票卖出");
 const label=document.createElement("label");label.textContent="卖出数量 · 可卖 "+available+" 股";
 const quantity=document.createElement("input");
 Object.assign(quantity,{type:"number",min:"1",max:String(Math.min(1000000,available)),step:"1",value:"1",required:true});
 label.append(quantity);
 const preview=textNode("获取实时报价后显示预计到账金额","");preview.setAttribute("role","status");
 const refresh=document.createElement("button");refresh.type="button";refresh.className="secondary-button";refresh.textContent="获取卖出报价";
 const submit=document.createElement("button");submit.type="submit";submit.className="primary-button";submit.textContent="确认卖出";submit.disabled=true;
 let quote=null,busy=false;
 const update=()=>{
  const amount=Number(quantity.value)*(quote?.priceCents??0);
  const valid=Boolean(quote)&&quantity.validity.valid&&Number.isSafeInteger(amount)&&amount>0;
  submit.disabled=!valid||busy;
  if(valid)preview.textContent="每股 $"+money(quote.priceCents)+" · 预计到账 $"+money(amount)+" USD · "+transactionTime(quote.timestampMs);
  else if(quote)preview.textContent="请输入有效卖出数量";
 };
 quantity.addEventListener("input",update);
 refresh.addEventListener("click",async()=>{
  if(busy)return;
  quote=null;submit.disabled=true;refresh.disabled=true;preview.textContent="正在获取实时卖出报价…";
  const usedToken=token;
  try{const result=await request("/stock-quote?market=US&symbol="+encodeURIComponent(item.symbol));
   if(usedToken===token&&form.isConnected){quote=result;update();}
  }catch{if(usedToken===token)preview.textContent="实时股价暂不可用。";}
  finally{refresh.disabled=false;}
 });
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!token||!quote||busy||!form.reportValidity())return;
  const usedToken=token,n=Number(quantity.value),fingerprint=item.symbol+":"+n;
  const key=stockSaleKeys.get(fingerprint)??crypto.randomUUID();stockSaleKeys.set(fingerprint,key);
  busy=true;submit.disabled=true;refresh.disabled=true;
  try{
   await request("/internal-purchases",{method:"PATCH",headers:{"idempotency-key":key},
    body:{symbol:item.symbol,quantity:n,confirmedStockPriceCents:quote.priceCents}});
   if(usedToken===token){stockSaleKeys.delete(fingerprint);await refreshAccount();}
  }catch(error){
   if(usedToken===token){
    quote=null;
    const reason=STOCK_QUOTE_ERRORS.has(error.message)?"报价已变化或暂不可用，请重新获取报价。":
      error.message==="Stock position is locked"?"该持仓已锁仓，请刷新持仓查看状态。":
      error.message==="Insufficient unlocked stock quantity"?"可卖数量不足，请刷新持仓后调整数量。":
      "暂未确认卖出结果。请先查看交易记录，再决定是否重试。";
    preview.textContent=reason;
   }
  }finally{busy=false;refresh.disabled=false;update();}
 });
 const scope=textNode("确认后将更新账户余额和持仓，订单不会提交交易所。","stock-sale-note");
 form.append(label,refresh,preview,scope,submit);return form;
}
function appendPublicChartButton(container,item){
 if(!resolveTradingViewSymbol(item))return;
 const button=document.createElement("button");
 button.type="button";
 button.className="secondary-button holding-chart-link";
 button.textContent="查看走势";
 button.setAttribute("aria-label","查看 "+item.symbol+" 公开走势");
 button.addEventListener("click",()=>selectWatchlistInstrument(item));
 container.append(button);
}
function renderRecords() {
  const positions = Array.isArray(account?.positions) ? account.positions.filter(item =>
    item && MARKETS.some(m => m.code === item.market) && typeof item.symbol === "string" &&
    item.symbol.trim() && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
  ) : [];
  const orders = Array.isArray(account?.orders) ? account.orders : [];
  const productPositions = account ? internalHoldings : [];
  const saleStatus=el("holdingsSaleStatus");
  saleStatus.hidden=stockSaleConfigured||!productPositions.some(item=>item.item_type==="STOCK"&&item.market==="US");
  saleStatus.textContent=saleStatus.hidden?"":"美股实时卖出暂停 · 暂无可用报价";
  el("positionCount").textContent = account && !internalHoldingsUnavailable ? String(positions.length + productPositions.length) : "—";
  el("orderCount").textContent = account ? String(transactionOrderCount(orders.length+productOrders.length)) : "—";
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
    const name = textNode(selectionInstruments().find(s=>s.market === item.market && s.symbol === item.symbol)?.name || item.market + " MARKET","holding-name");
    stock.append(code,name);
    appendPublicChartButton(stock,item);
    left.append(icon,stock);
    const right = document.createElement("div");
    right.className = "holding-quantity";
    const quantity = Number(item.quantity);
    right.append(textNode(Number.isSafeInteger(quantity) ? new Intl.NumberFormat("en-US").format(quantity) : String(item.quantity),"holding-quantity-value"),textNode("股","holding-quantity-unit"));
    node.append(left,right);
    return node;
  });
  for(const item of productPositions){
    const row=document.createElement('div');row.className='record-item holding-row';
    const identity=document.createElement('div');identity.className='holding-company';
    identity.append(textNode(item.name),textNode(item.code+' · 持仓成本 $'+money(item.cost_cents),'holding-name'));
    if(item.item_type==="STOCK")appendPublicChartButton(identity,{...item,symbol:item.symbol??item.code});
    row.append(identity,textNode(String(item.quantity)+(item.item_type==="STOCK"?' 股':' 份'),'holding-quantity-value'));
    posRows.push(row);
    if(item.item_type==="STOCK"){
      const sale=stockSaleForm(item);
      if(sale)posRows.push(sale);
    }
  }
  if(account&&internalHoldingsUnavailable)posRows.push(makeEmpty('部分持仓读取失败，请刷新账户数据'));
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
  return item.product_name || selectionInstruments().find(stock => stock.market === item.market && stock.symbol === item.symbol)?.name || "名称未登记";
}
function transactionOrders(){
  if(!account)return [];
  const orders=Array.isArray(account.orders)?account.orders:[];
  if(!productOrders.length)return orders;
  return [...orders,...productOrders].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
}
function transactionOrderCount(loadedCount){
  return accountAnalytics?.orderCount??loadedCount;
}
function transactionPrice(item) {
  const marketInfo = MARKETS.find(entry => entry.code === item.market);
  const currency = item.price_currency ?? marketInfo?.currency;
  const rawCents = item?.price_cents;
  if (!currency || rawCents === null || rawCents === undefined || rawCents === "") return "—";
  const cents = Number(rawCents);
  if (!Number.isSafeInteger(cents) || cents < 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style:"currency", currency, minimumFractionDigits:2, maximumFractionDigits:2
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
  const orders = transactionOrders();
  const query = el("transactionSearch").value.trim().toLocaleLowerCase();
  const range = "all";
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
        transactionPrice(item),item.price_currency ?? marketInfo?.currency ?? "",
        item.quantity,transactionAmount(item),"RECORDED",item.created_at ?? ""
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
  const allOrders = transactionOrders();
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
  if(account&&accountAnalytics){
    if(Number.isSafeInteger(accountAnalytics.volumeCents)){
      el("transactionVolume").textContent="$"+money(accountAnalytics.volumeCents);
      el("transactionVolumeNote").textContent=accountAnalytics.orderCount+" 笔 · 完整历史 · USD 等值";
    }
    if(accountAnalytics.historyAvailable){
      el("realizedPnl").textContent="$"+money(accountAnalytics.realizedPnlCents);
      el("realizedPnlNote").textContent="FIFO 已实现毛盈亏 · 含卖出与基金到期结算 · 未扣手续费及税费";
    }else el("realizedPnlNote").textContent=ANALYTICS_REASONS[accountAnalytics.reason]??"完整成本记录不可用";
  }
  el("internalRecordCount").textContent = account ? String(transactionOrderCount(allOrders.length)) : "—";

  const range = "all";
  el("transactionRangeLabel").textContent = TRANSACTION_RANGE_LABELS[range] ?? "All time";
  const totalHistory=internalHoldingsUnavailable?undefined:accountAnalytics?.orderCount;
  el("transactionHistoryScope").textContent=!account?"登录后查看记录范围":Number.isSafeInteger(totalHistory)
    ?"统计基于完整历史 "+totalHistory+" 笔；列表已加载 "+allOrders.length+" 笔，筛选、分页和导出仅作用于已加载记录。"
    :internalHoldingsUnavailable?"部分交易记录读取失败，请刷新账户数据。":"筛选、分页和导出适用于已加载的最近记录。";
  if(Number.isSafeInteger(totalHistory)&&totalHistory>allOrders.length)
    el("transactionRangeLabel").textContent="最近 "+allOrders.length+" 笔";
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
      const sideLabel = textNode(item.side === "BUY" ? "↑ Buy" : item.side === "SELL" ? "↓ Sell" : item.side==="REDEEM"?"到期返还":"—",
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
      status.append(textNode(item.settled_at?"已返还":item.due_at?"持有中 · "+transactionTime(item.due_at):"已记录","record-status internal-status"));
      const time = document.createElement("td");
      time.className = "transaction-time-cell";
      time.textContent = transactionTime(item.created_at);
      row.append(symbol,name,side,price,quantity,amount,status,time);
      ["代码","名称","类型","单价","数量","金额（USD）","状态","时间"].forEach((label,index)=>{
        row.cells[index].dataset.label=label;
      });
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

function syncClientGate(){
  const admitted=Boolean(token&&account);
  el("entryGate").hidden=admitted;
  el("overview").hidden=!admitted;
  if(!admitted&&token)el("entryFeedback").textContent=accountRefreshing?"正在验证账户状态…":el("authFeedback").textContent;
}
function renderAccountAnalytics(){
 const data=account?accountAnalytics:null;
 const values={analyticsBuyVolume:data?.buyVolumeCents,analyticsSellVolume:data?.sellVolumeCents,
  overviewDayRealizedPnl:data?.historyAvailable?data.dayRealizedPnlCents:null,
  overviewMonthRealizedPnl:data?.historyAvailable?data.monthRealizedPnlCents:null,
  analyticsPositionCost:data?.historyAvailable?data.positionCostCents:null,
  dayRealizedPnl:data?.historyAvailable?data.dayRealizedPnlCents:null,
  monthRealizedPnl:data?.historyAvailable?data.monthRealizedPnlCents:null};
 for(const [id,value] of Object.entries(values))el(id).textContent=Number.isSafeInteger(value)?"$"+money(value):"—";
 el("portfolioValue").textContent=Number.isSafeInteger(data?.portfolioValueCents)?"$"+money(data.portfolioValueCents):"—";
 el("portfolioValueNote").textContent=Number.isSafeInteger(data?.portfolioValueCents)
  ?"仅现金，无持仓 · USD 账户记录":data?.holdingCount>0?"缺少持仓报价，无法计算总市值":
   !account?"登录后查看账户估值":"等待完整账户统计";
 if(account&&(internalHoldings.length||internalHoldingsUnavailable)){el('portfolioValue').textContent='—';el('portfolioValueNote').textContent='完整市值暂不可用，数量与成本请查看持仓';}
 el("refreshAnalyticsButton").disabled=!account||accountAnalyticsState==="loading";
 el("accountAnalyticsStatus").textContent=!account?"登录后读取统计":accountAnalyticsState==="loading"
  ?"正在读取完整账户历史":accountAnalyticsState==="error"?"统计不可用："+accountAnalyticsError:
   data?(data.historyAvailable?"FIFO 按流水入账顺序计算，未扣手续费、税费；日/月按订单记录时间 UTC 归属，持仓成本不是市值。":
    (ANALYTICS_REASONS[data.reason]??"成本统计不可用")+"；不显示推算收益。")+" · 统计时间 "+data.asOf:
    "尚未读取账户统计";
}
async function refreshAccountAnalytics(){
 if(!token||!account)return;
 const serial=++accountAnalyticsSerial,usedToken=token;
 accountAnalytics=null;accountAnalyticsState="loading";accountAnalyticsError="";render();
 try{
  const data=await request("/account/analytics");
  if(serial!==accountAnalyticsSerial||usedToken!==token)return;
  const amounts=["buyVolumeCents","sellVolumeCents","volumeCents","realizedPnlCents",
   "dayRealizedPnlCents","monthRealizedPnlCents","positionCostCents","portfolioValueCents"];
  if(!data||data.currency!=="USD"||data.method!=="FIFO"||data.basis!=="INTERNAL_GROSS"||
    data.orderBasis!=="CASH_LEDGER_ID"||data.periodBasis!=="ORDER_CREATED_AT"||
    data.reportingTimeZone!=="UTC"||!Number.isFinite(Date.parse(data.asOf))||
    typeof data.historyAvailable!=="boolean"||!Number.isSafeInteger(data.orderCount)||data.orderCount<0||
    amounts.some(key=>data[key]!==null&&!Number.isSafeInteger(data[key])))throw Error("统计数据格式不正确");
  if(data.historyAvailable&&["realizedPnlCents","dayRealizedPnlCents","monthRealizedPnlCents","positionCostCents"]
    .some(key=>data[key]===null))throw Error("成本统计数据不完整");
  accountAnalytics=data;accountAnalyticsState="ready";
 }catch(error){
  if(serial!==accountAnalyticsSerial||usedToken!==token)return;
  accountAnalyticsState="error";accountAnalyticsError=error.message;
 }finally{if(serial===accountAnalyticsSerial&&usedToken===token)render();}
}
el("refreshAnalyticsButton").addEventListener("click",()=>void refreshAccountAnalytics());
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
  el("serviceRequestsPanel").hidden = !account;
  el("commodityCatalogPanel").hidden = !account;
  el("customerSupportPanel").hidden = !account;
  el("logout").hidden = !token;
  el("orderForm").querySelector('button[type="submit"]').disabled = !token || !account || !pricingConnected;
  renderRecords();
  renderTransactionHistory();
  renderAccountAnalytics();
  renderWatchlistControl();
  renderChart();
  syncClientGate();
}
function resetClientSession(message){
  clearPrivateInputs();
  clearInternalProducts();
  sessionStorage.removeItem("gsp_token");token=null;account=null;lastSyncedAt=null;accountRefreshing=false;
  watchlist=[];watchlistLoaded=false;watchlistBusy=false;watchlistFetching=false;watchlistFetchSequence++;
  catalog=[];catalogLoaded=false;catalogBusy=false;catalogFetchSequence++;
  serviceRequests=[];serviceBusy=false;serviceFetchSequence++;
  customerCommoditySerial++;customerSupportSerial++;customerCommodityItems=[];
  customerSupportClosed=false;
  accountAnalyticsSerial++;accountAnalytics=null;accountAnalyticsState="idle";accountAnalyticsError="";
  for(const id of ["serviceRequestHistory","customerCommodityItems","customerSupportMessages"])el(id).replaceChildren();
  for(const id of ["serviceRequestFeedback","customerCommodityStatus","customerSupportStatus","savedWatchlistFeedback",
    "watchlistFeedback","catalogFeedback","feedback"])el(id).textContent="";
  for(const id of ["customerSupportText","fundingRequestAmount","bankRequestName","bankRequestLast4"])el(id).value="";
  for(const id of ["startKycRequest","fundingRequestForm","bankLinkRequestForm","customerSupportForm"]){
    const node=el(id);if(node.tagName==="BUTTON")node.disabled=false;
    else node.querySelectorAll('button[type="submit"]').forEach(button=>button.disabled=false);
  }
  selected=INSTRUMENTS[0];market=selected.market;transactionPage=1;
  el("authFeedback").textContent=message;el("entryFeedback").textContent=message;
  render();
}
async function request(path,options = {}) {
  let result;
  let response;
  const usedToken=Object.hasOwn(options,"token")?options.token:token;
  try {
    response = await fetch("/api" + path,{
      method:options.method || "GET",
      headers:{"content-type":"application/json",...(usedToken ? {authorization:"Bearer " + usedToken} : {}),...(options.headers || {})},
      ...(options.body ? {body:JSON.stringify(options.body)} : {}),
      cache:"no-store"
    });
    result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  } catch {
    throw new Error("无法连接服务，请检查网络或部署状态");
  }
  if(usedToken&&usedToken!==token&&path!=="/auth/logout")throw new Error("账户会话已变更");
  if (!response.ok) {
    if(response.status===401&&usedToken&&usedToken===token&&!path.startsWith("/auth/"))
      resetClientSession("账户认证失败或会话已失效，请重新登录");
    if (response.status === 503 && ["/auth/login","/auth/register"].includes(path)) throw new Error("账户数据库尚未连接，登录服务暂不可用");
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
  accountAnalyticsSerial++;accountAnalytics=null;accountAnalyticsState="loading";accountAnalyticsError="";
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
    await Promise.all([refreshWatchlist(),refreshCatalog(),refreshServiceRequests(),refreshAccountAnalytics(),
      refreshCustomerCommodities(),refreshCustomerSupport(),refreshInternalProducts(),refreshPrivateStatus()]);
    if(requestedToken!==token)return;
    el("authFeedback").textContent = "账户数据已同步";
  } catch(error) {
    if (requestedToken !== token) return;
    account = null;
    lastSyncedAt = null;
    el("authFeedback").textContent = error.message;
    if (/认证失败|会话已失效/.test(error.message)) {
      resetClientSession(error.message);
    }
  } finally {
    if(requestedToken===token){accountRefreshing = false;render();}
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
el("transactionSearch").addEventListener("change",() => {
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
// Credential-only client entry. No workspace DOM is displayed until /api/account succeeds.
let entryRegisterMode=false,entryBusy=false;
el("entryMode").addEventListener("click",()=>{
  entryRegisterMode=!entryRegisterMode;
  el("entryInviteWrap").hidden=!entryRegisterMode;
  el("entrySubmit").textContent=entryRegisterMode?"注册并进入平台":"进入交易平台";
  el("entryMode").textContent=entryRegisterMode?"已有账户？返回登录":"创建新账户";
  el("entryTitle").textContent=entryRegisterMode?"新账户注册":"安全账户登录";
  el("entryFeedback").textContent="";
});
el("entryForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(entryBusy)return;
  entryBusy=true;
  const button=el("entrySubmit");button.disabled=true;
  el("entryFeedback").textContent="正在安全验证账户…";
  try{
    const email=el("entryEmail").value.trim(),password=el("entryPassword").value;
    if(entryRegisterMode){
      const inviteCode=el("entryInvite").value.trim();
      await request("/auth/register",{method:"POST",body:{email,password,...(inviteCode?{inviteCode}:{})}});
    }
    const session=await request("/auth/login",{method:"POST",body:{email,password}});
    if(!session?.token)throw new Error("登录未返回有效会话");
    token=session.token;
    clearPrivateInputs();
    clearInternalProducts();
    serviceRequests=[];el("serviceRequestHistory").replaceChildren();
    sessionStorage.setItem("gsp_token",token);
    el("entryPassword").value="";
    await refreshAccount();
    if(!account)throw new Error(el("authFeedback").textContent||"账户无法验证，请重试");
    el("entryFeedback").textContent="";
    syncClientGate();
  }catch(error){
    el("entryFeedback").textContent=error.message;
  }finally{
    entryBusy=false;button.disabled=false;
    render();
  }
});
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
    clearPrivateInputs();
    clearInternalProducts();
    serviceRequests=[];el("serviceRequestHistory").replaceChildren();
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

const SERVICE_STATUS={
 SUBMITTED:"已提交",UNDER_REVIEW:"审核中",APPROVED:"审核通过（未划转）",REJECTED:"已拒绝",
 AWAITING_EVIDENCE:"等待验证材料",NEEDS_INFORMATION:"需补充材料",
 MANUALLY_REVIEWED:"人工已审阅（未实名认证）",PENDING_VERIFICATION:"待第三方银行验证"
};
function serviceDescription(item){
 let status=SERVICE_STATUS[item.status]??item.status;
 if(item.category==='BANK_LINK'){
  if(item.bound)status='绑定已确认（人工审核）';
  else if(item.detailsStored&&item.status==='PENDING_VERIFICATION')status='待人工审核';
 }
 if(item.category==='FUNDING'&&item.settlementStatus==='INTERNAL_POSTED')status=item.kind==='WITHDRAWAL'?'已从余额扣账':'已计入账户余额';
 if(item.category==="FUNDING"){
  const cents=Number(item.amountCents);
  const amount=Number.isSafeInteger(cents)?money(cents):"—";
  return (item.kind==="DEPOSIT"?"充值申请":"提现申请")+" · "+amount+" USD · "+status;
 }
 if(item.category==="KYC")return "身份审核工单 · "+status;
 return (item.bankLabel??"银行")+" · 账户尾号 "+(item.accountLast4??"—")+" · "+status;
}
function renderServiceRequests(){
 const target=el("serviceRequestHistory");target.replaceChildren();
 if(!serviceRequests.length){target.append(makeEmpty("暂无已提交申请"));return;}
 const rows=serviceRequests.slice().sort((a,b)=>String(b.createdAt??"").localeCompare(String(a.createdAt??""))).slice(0,80);
 for(const item of rows){
  const row=document.createElement("div");row.className="service-request-record";
  const title=document.createElement("strong");title.textContent=serviceDescription(item);
  const time=document.createElement("span");time.textContent=item.createdAt?
   new Date(item.createdAt).toLocaleString("zh-CN"):"等待记录时间";
  row.append(title,time);target.append(row);
 }
}
async function refreshServiceRequests(){
 if(!token||!account)return;
 const usedToken=token,sequence=++serviceFetchSequence;el("serviceRequestFeedback").textContent="正在读取已提交申请…";
 try{
  const categories=["FUNDING","KYC","BANK_LINK"];
  const results=await Promise.all(categories.map(category=>request("/requests?category="+category)));
  if(usedToken!==token||sequence!==serviceFetchSequence)return;
  serviceRequests=results.flatMap((x,i)=>(Array.isArray(x.items)?x.items:[]).map(item=>({
   ...item,category:categories[i]
  })));
  renderServiceRequests();
  el("serviceRequestFeedback").textContent="已同步 "+serviceRequests.length+" 条申请。记录不代表实际收付款或核验通过。";
 }catch(error){
  if(usedToken===token&&sequence===serviceFetchSequence)el("serviceRequestFeedback").textContent="申请列表读取失败："+error.message;
 }
}
function validateUsdCents(input){
 const raw=String(input??"").trim();
 if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw))throw Error("请输入合法的 USD 金额，最多两位小数");
 const [whole,fraction=""]=raw.split(".");
 const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(cents)||cents<100||cents>100000000)
  throw Error("每笔申请金额必须在 1.00 到 1,000,000.00 USD 之间");
 return cents;
}
async function submitService(category,body,button){
 if(!token||!account){el("serviceRequestFeedback").textContent="请先登录并同步账户";return false;}
 if(serviceBusy)return false;serviceBusy=true;button.disabled=true;
 const usedToken=token;
 try{
  const {item}=await request("/requests?category="+category,{method:"POST",body});
  if(usedToken!==token)return false;
  el("serviceRequestFeedback").textContent="申请 "+String(item.id).slice(0,8)+" 已提交。尚无实际资金划转或第三方验证。";
  await refreshServiceRequests();
  return usedToken===token;
 }catch(error){if(usedToken===token)el("serviceRequestFeedback").textContent="申请未提交："+(error.message==="Withdrawal requires a bound bank account"?"提现前需要先绑定银行卡，并等待后台审核通过。":error.message);return false;}
 finally{if(usedToken===token){serviceBusy=false;button.disabled=false;}}
}

function customerCommodityCard(item){
 const box=document.createElement("article");box.className="customer-commodity-card";
 const h=document.createElement("h3");h.textContent=item.sku+" · "+item.name;
 const info=document.createElement("p");info.textContent=
  item.category+" · "+item.unit+" · 最低数量 "+item.minimumQuantity;
 const price=document.createElement("strong");price.textContent=item.indicativePriceCents===null
  ?"没有参考报价"
  :money(item.indicativePriceCents)+" USD";
 const disclosure=document.createElement("small");
 disclosure.textContent="管理员参考价格 · 非实时报价 · 未连接商品交易商";
 box.append(h,info,price,disclosure);return box;
}
async function refreshCustomerCommodities(){
 if(!token||!account)return;
 const serial=++customerCommoditySerial,usedToken=token;
 el("customerCommodityStatus").textContent="正在同步商品目录";
 try{
  const result=await request("/commodities");
  if(serial!==customerCommoditySerial||usedToken!==token)return;
  customerCommodityItems=Array.isArray(result.items)?result.items:[];
  const root=el("customerCommodityItems");
  root.replaceChildren(...customerCommodityItems.map(customerCommodityCard));
  if(!customerCommodityItems.length)root.append(makeEmpty("暂无已发布商品"));
  el("customerCommodityStatus").textContent="目录已同步；人工参考价，不构成实际交易报价";
 }catch(error){
  if(serial===customerCommoditySerial&&usedToken===token)
   el("customerCommodityStatus").textContent="商品目录读取失败："+error.message;
 }
}
async function refreshCustomerSupport(){
 if(!token||!account)return;
 const serial=++customerSupportSerial,usedToken=token;
 el("customerSupportStatus").textContent="正在同步客服消息";
 try{
  const response=await request("/support");
  if(serial!==customerSupportSerial||usedToken!==token)return;
  const root=el("customerSupportMessages");root.replaceChildren();
  const messages=Array.isArray(response.messages)?response.messages:[];
  if(!messages.length)root.append(makeEmpty("暂无客服消息，您可以直接发送问题"));
  for(const item of messages){
   const box=document.createElement("article");
   const own=item.senderUserId===response.thread?.clientId;
   box.className="customer-support-message "+(own?"from-customer":"from-support");
   const content=document.createElement("p");content.textContent=item.body;
   const from=document.createElement("small");from.textContent=(own?"我的消息":"客服回复")+" · "+
     (item.createdAt?new Date(item.createdAt).toLocaleString("zh-CN"):"");
   box.append(content,from);root.append(box);
  }
  const closed=response.thread?.status==="CLOSED";
  customerSupportClosed=closed;
  el("customerSupportForm").querySelector('button[type="submit"]').disabled=closed;
  el("customerSupportStatus").textContent=closed
   ?"当前会话已关闭，发送新消息前请联系客服重新开启"
   :"共 "+messages.length+" 条消息，来自真实账户客服记录";
 }catch(error){
  if(serial===customerSupportSerial&&usedToken===token)
   el("customerSupportStatus").textContent="客服消息读取失败："+error.message;
 }
}
el("refreshCustomerCommodities").addEventListener("click",()=>void refreshCustomerCommodities());
el("refreshCustomerSupport").addEventListener("click",()=>void refreshCustomerSupport());
el("customerSupportForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!token||!account)return;
 const tokenAtSend=token,button=event.currentTarget.querySelector('button[type="submit"]');
 button.disabled=true;
 try{
  await request("/support",{method:"POST",body:{message:el("customerSupportText").value.trim()}});
  if(tokenAtSend!==token)return;
  el("customerSupportText").value="";
  await refreshCustomerSupport();
  if(tokenAtSend!==token)return;
  if(!customerSupportClosed)el("customerSupportStatus").textContent="客服消息已提交并保存";
 }catch(error){
  if(tokenAtSend===token)el("customerSupportStatus").textContent="发送失败："+error.message;
 }finally{if(tokenAtSend===token)button.disabled=customerSupportClosed;}
});

el("refreshServiceRequests").addEventListener("click",()=>{void refreshServiceRequests()});
el("fundingRequestForm").addEventListener("submit",async event=>{
 event.preventDefault();
 try{
  const amountCents=validateUsdCents(el("fundingRequestAmount").value);
  const ok=await submitService("FUNDING",{kind:el("fundingRequestKind").value,amountCents},
   event.currentTarget.querySelector('button[type="submit"]'));
  if(ok)el("fundingRequestAmount").value="";
 }catch(error){el("serviceRequestFeedback").textContent=error.message;}
});
el("bankLinkRequestForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(privateDataReady){
  await submitPrivateMaterial('BANK_LINK',{bankName:el('bankRequestName').value.trim(),accountNumber:el('bankRequestNumber').value},event.currentTarget.querySelector('button[type="submit"]'),token);
  return;
 }
 const ok=await submitService("BANK_LINK",{
  bankLabel:el("bankRequestName").value.trim(),accountLast4:el("bankRequestLast4").value.trim()
 },event.currentTarget.querySelector('button[type="submit"]'));
 if(ok){el("bankRequestName").value="";el("bankRequestLast4").value="";}
});
el("startKycRequest").addEventListener("click",async()=>{
 await submitService("KYC",{},el("startKycRequest"));
});

el("railLogout").addEventListener("click",() => {
  if (token) el("logout").click();
  else el("account-section").scrollIntoView({behavior:"smooth",block:"start"});
});
el("logout").addEventListener("click",async () => {
  if (!token) return;
  const expiredToken=token;
  resetClientSession("已退出账户");
  el("logout").disabled = true;
  try {
    await request("/auth/logout",{method:"POST",token:expiredToken});
  } catch(error) {
    if(!token)el("entryFeedback").textContent="本机已退出；服务端会话撤销未确认，请稍后重试或等待会话到期";
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
async function refreshReferenceFx(){
 const button=el('refreshReferenceFx');button.disabled=true;
 el('referenceFxStatus').textContent='正在读取日参考汇率…';
 el('referenceFxRates').textContent='';
 try{
  const response=await fetch('/api/reference-fx');
  if(!response.ok)throw Error('unavailable');
  const data=await response.json();
  if(data.source!=='ECB'||data.base!=='USD'||!['available','stale'].includes(data.status)||
   !/^\d{4}-\d{2}-\d{2}$/.test(data.date)||['USD','HKD','CNY','MYR'].some(c=>!Number.isFinite(data.rates?.[c])||data.rates[c]<=0))throw Error('invalid');
  el('referenceFxStatus').textContent=`ECB 日参考汇率 · 数据日期 ${data.date}${data.status==='stale'?' · 旧数据／更新未确认，请谨慎参考':''}`;
  el('referenceFxRates').textContent='1 USD = '+['HKD','CNY','MYR'].map(c=>data.rates[c].toFixed(4)+' '+c).join(' / ');
 }catch{el('referenceFxStatus').textContent='日参考汇率暂不可用，请稍后刷新';}
 finally{button.disabled=false;}
}
el('refreshReferenceFx').addEventListener('click',()=>void refreshReferenceFx());
void refreshReferenceFx();

function clearInternalProducts(){
 internalHoldings=[];productOrders=[];internalHoldingsUnavailable=false;
 tradeProducts=[];tradeCategory="STOCK";stockTradingConfigured=false;stockSaleConfigured=false;
 stockSaleKeys.clear();
 internalProductsSerial++;internalPurchaseBusy=false;internalPurchaseKeys.clear();
 el('internalProductsPanel').hidden=true;
 el('internalProductsItems').replaceChildren();
 el('internalProductsStatus').textContent='';
}
function internalProductCard(item){
 const card=document.createElement('article');card.className='internal-product-card';
 const title=document.createElement('h3');title.textContent=item.name+' · '+item.code;
 if(item.itemType==="FUND"&&item.fundImageUrl){
  const cover=document.createElement("img");cover.className="fund-cover";cover.alt="";
  cover.loading="lazy";cover.setAttribute("referrerpolicy","no-referrer");cover.src=item.fundImageUrl;
  cover.addEventListener("error",()=>cover.remove(),{once:true});card.append(cover);
 }
 const detail=document.createElement('p'),stock=item.itemType==="STOCK";
 let stockQuote=null;
 const discounted=()=>Number((BigInt(stock?(stockQuote?.priceCents??0):item.internalPriceCents)*BigInt(10000-item.discountBps)+5000n)/10000n);
 const types={STOCK:'股票',FUND:'基金',IPO:'IPO',COMMODITY:'大宗商品'};
 detail.textContent=stock?'股票 · 优惠 '+(item.discountBps/100)+'% · 买入后持有 '+(item.stockHoldingDays??0)+' 天':
  (types[item.itemType]??item.itemType)+' · 原价 $'+money(item.internalPriceCents)+' / '+item.unit+' · 优惠 '+(item.discountBps/100)+'% · 购买单价 $'+money(discounted());
 card.append(title,detail);
 if(stock&&(item.market!=="US"||!stockTradingConfigured)){
  card.append(textNode(item.market!=="US"?"该市场暂未接入行情，模拟买卖未开放":"美股模拟买卖暂停 · 行情源未配置","stock-sale-note"));
  appendPublicChartButton(card,{...item,symbol:item.code});
  return card;
 }
 const form=document.createElement('form');form.autocomplete='off';
 const qtyLabel=document.createElement('label');qtyLabel.textContent='参与数量（最低'+item.minimumQuantity+'）';
 const qty=document.createElement('input');qty.type='number';qty.min=String(item.minimumQuantity);qty.max='1000000';qty.step='1';qty.value=String(item.minimumQuantity);qty.required=true;qtyLabel.append(qty);
 const pinLabel=document.createElement('label');pinLabel.textContent='六位商品参与密码';
 const pin=document.createElement('input');pin.type='password';pin.inputMode='numeric';pin.pattern='[0-9]{6}';pin.minLength=6;pin.maxLength=6;pin.autocomplete='off';pin.required=true;pinLabel.append(pin);
 const fund=item.itemType==="FUND"&&Number.isInteger(item.fundDays);
 const total=document.createElement('output');const updateTotal=()=>{
  if(stock&&!stockQuote){total.textContent="请先获取实时股价";return;}
  const n=Number(qty.value),amount=discounted()*n;
  const valid=Number.isSafeInteger(n)&&n>=item.minimumQuantity&&n<=1000000&&Number.isSafeInteger(amount)&&amount>0;
  total.textContent=valid?'实付 $'+money(amount)+' USD':'请输入有效数量';
  if(fund&&valid){
   const profit=(BigInt(amount)*BigInt(item.fundReturnBps)+5000n)/10000n;
   if(BigInt(amount)+profit<=BigInt(Number.MAX_SAFE_INTEGER))total.append(' · 到期返还 $'+money(amount+Number(profit))+' USD');
  }
 };qty.addEventListener('input',updateTotal);updateTotal();
 const button=document.createElement('button');button.type='submit';button.className='primary-button';button.textContent='确认购买';
 if(stock){
  button.disabled=true;
  const refresh=document.createElement("button");refresh.type="button";refresh.className="secondary-button";refresh.textContent="获取实时股价";
  refresh.addEventListener("click",async()=>{
   const usedToken=token;stockQuote=null;button.disabled=true;refresh.disabled=true;updateTotal();
   try{
    const quote=await request("/stock-quote?market=US&symbol="+encodeURIComponent(item.code));
    if(token!==usedToken||!card.isConnected)return;
    stockQuote=quote;button.disabled=false;
    detail.textContent="每股 $"+money(quote.priceCents)+" · 优惠 "+(item.discountBps/100)+"% · 折后 $"+money(discounted())+" · "+transactionTime(quote.timestampMs);
   }catch{if(token===usedToken)detail.textContent="实时报价暂不可用，请稍后刷新。";}
   finally{refresh.disabled=false;updateTotal();}
  });
  form.append(refresh);
 }
 const feedback=document.createElement('small');feedback.setAttribute('role','status');
 form.append(qtyLabel,pinLabel,total);
 if(stock)form.append(textNode("确认后将更新账户余额和持仓，订单不会提交交易所。","stock-sale-note"));
 form.append(button,feedback);
 if(fund)card.append(textNode('持有 '+item.fundDays+' 天 · 期间固定收益 '+(item.fundReturnBps/100)+'% · 到期一次返还本金与收益',''));
 card.append(form);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!token||!account||internalPurchaseBusy||(stock&&!stockQuote))return;
  const usedToken=token,quantity=Number(qty.value),fingerprint=item.termsId+':'+item.termsVersion+':'+quantity;
  const key=internalPurchaseKeys.get(fingerprint)??crypto.randomUUID();internalPurchaseKeys.set(fingerprint,key);
  const body={termsId:item.termsId,termsVersion:item.termsVersion,quantity,participationPassword:pin.value};pin.value='';
  if(stock)body.confirmedStockPriceCents=stockQuote.priceCents;
  internalPurchaseBusy=true;button.disabled=true;feedback.textContent='正在处理购买…';
  try{
   const result=await request('/internal-purchases',{method:'POST',headers:{'idempotency-key':key},body});
   if(usedToken!==token)return;
   internalPurchaseKeys.delete(fingerprint);
   if(accountRefreshing)await refreshInternalProducts();else await refreshAccount();
   if(usedToken===token){
    const status=el('internalProductsStatus');
    status.textContent=result.replayed?'已读取原购买记录。':'购买成功。';
    if(internalHoldingsUnavailable){status.append(' 持仓读取失败，请刷新账户数据。');}
    else{const link=document.createElement('a');link.href='#holdings-section';link.textContent='查看持仓';status.append(' ',link);}
   }
  }catch(error){
   if(usedToken===token){
    if(stock&&STOCK_QUOTE_ERRORS.has(error.message)){
     stockQuote=null;updateTotal();
     feedback.textContent='报价已变化或暂不可用，请重新获取报价后确认。';
    }else{
     feedback.textContent='购买未确认：'+error.message+'。若网络中断，重试将使用同一请求编号。';
    }
   }
  }finally{
   body.participationPassword='';
   if(usedToken===token){internalPurchaseBusy=false;button.disabled=stock&&!stockQuote;}
  }
 });
 return card;
}
function renderTradeProducts(){
 for(const button of el("tradeCategories").querySelectorAll("button")){
  button.setAttribute("aria-pressed",String(button.dataset.tradeCategory===tradeCategory));
 }
 const cards=tradeProducts.filter(item=>item.itemType===tradeCategory).map(internalProductCard);
 el('internalProductsItems').replaceChildren(...(cards.length?cards:[makeEmpty('该分类暂无可购买产品')]));
}
el("tradeCategories").addEventListener("click",event=>{
 const button=event.target.closest("button[data-trade-category]");
 if(button&&button.dataset.tradeCategory!==tradeCategory&&!internalPurchaseBusy){
  tradeCategory=button.dataset.tradeCategory;renderTradeProducts();
 }
});
async function refreshInternalProducts(){
 if(!token||!account){clearInternalProducts();return;}
 const usedToken=token,serial=++internalProductsSerial;el('internalProductsPanel').hidden=false;
 el('internalProductsStatus').textContent='正在读取产品、交易记录和持仓…';
 try{
  const [catalogResult,recordsResult]=await Promise.allSettled([request('/internal-products'),request('/internal-purchases')]);
  if(usedToken!==token||serial!==internalProductsSerial)return;
  if(recordsResult.status==='rejected')throw recordsResult.reason;
  const products=catalogResult.status==='fulfilled'?catalogResult.value:{};
  const records=recordsResult.value;
  const valid=Array.isArray(products.items)?products.items:[];
  stockTradingConfigured=products.stockQuotesConfigured===true;
  stockSaleConfigured=records.stockQuotesConfigured===true;
  tradeProducts=valid;renderTradeProducts();
  internalHoldings=Array.isArray(records.positions)?records.positions:[];
  productOrders=(Array.isArray(records.purchases)?records.purchases:[]).map(item=>({
   symbol:item.product_code,product_name:item.product_name,side:'BUY',quantity:item.quantity,
   price_cents:item.unit_price_cents,price_currency:'USD',amount_usd_cents:item.total_cents,created_at:item.created_at,
   due_at:item.due_at,settled_at:item.settled_at
  }));
  for(const item of records.settlements??[]){
   productOrders.push({symbol:item.product_code,product_name:item.product_name,side:"REDEEM",quantity:item.quantity,
    amount_usd_cents:Number(item.total_cents)+Number(item.profit_cents),created_at:item.settled_at});
  }
  for(const item of records.sales??[]){
   productOrders.push({market:item.market,symbol:item.symbol,side:"SELL",quantity:item.quantity,
    price_cents:item.unit_price_cents,price_currency:"USD",amount_usd_cents:item.total_cents,created_at:item.created_at});
  }
  internalHoldingsUnavailable=false;
  renderMarkets();
  el('internalProductsStatus').textContent=catalogResult.status==='rejected'?'商品目录暂不可用，持仓与购买记录已同步。':'已同步 '+valid.length+' 个可参与产品 · 产品单价和支付币种均为USD';
  renderRecords();
  renderTransactionHistory();
  renderAccountAnalytics();
 }catch(error){
  if(usedToken!==token||serial!==internalProductsSerial)return;
  stockTradingConfigured=false;stockSaleConfigured=false;
  internalHoldings=[];productOrders=[];tradeProducts=[];internalHoldingsUnavailable=true;renderMarkets();renderRecords();renderTransactionHistory();renderAccountAnalytics();
  el('internalProductsItems').replaceChildren();
  el('internalProductsStatus').textContent='购买数据暂不可用：'+error.message;
 }
}
el('refreshInternalProducts').addEventListener('click',()=>void refreshInternalProducts());

function clearPrivateInputs(){
 privateDataSerial++;privateDataReady=false;
 for(const id of ['identityFront','identityBack','bankRequestNumber'])el(id).value='';
 el('identityUploadForm').hidden=true;el('startKycRequest').hidden=false;
 el('bankFullField').hidden=true;el('bankMaskedField').hidden=false;
 el('bankRequestNumber').required=false;el('bankRequestLast4').required=true;
}
async function refreshPrivateStatus(){
 if(!token||!account)return;
 const usedToken=token,serial=++privateDataSerial;
 try{
  const result=await request('/private-data/status');if(usedToken!==token||serial!==privateDataSerial)return;
  privateDataReady=result.ready===true;
 }catch{if(usedToken!==token||serial!==privateDataSerial)return;privateDataReady=false;}
 el('identityUploadForm').hidden=!privateDataReady;el('startKycRequest').hidden=privateDataReady;
 el('bankFullField').hidden=!privateDataReady;el('bankMaskedField').hidden=privateDataReady;
 el('bankRequestNumber').required=privateDataReady;el('bankRequestLast4').required=!privateDataReady;
 el('identityUploadStatus').textContent=privateDataReady?'身份证正反面加密保存，提交后由授权人员人工审核。':'安全上传未启用，当前只能创建资料审核工单。';
 el('bankPrivacyStatus').textContent=privateDataReady?'完整号码加密保存，列表仅显示末四位；人工确认绑定不等于银行验证。绝不填写网银密码、验证码或CVV。':'安全绑定未启用，当前只登记末四位，不接收完整号码、网银密码或验证码。';
}
async function imagePayload(file){
 if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>2*1024*1024)throw Error('请选择2MB以内的PNG/JPEG图片');
 const bytes=new Uint8Array(await file.arrayBuffer());let raw='';
 for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return {mime:file.type,base64:btoa(raw)};
}
async function submitPrivateMaterial(kind,payload,button,usedToken){
 if(!privateDataReady||!account||!token||usedToken!==token||serviceBusy)return;
 serviceBusy=true;button.disabled=true;el('serviceRequestFeedback').textContent='正在加密提交审核资料…';
 try{
  const {item}=await request('/private-data?kind='+kind,{method:'POST',body:payload});
  if(usedToken!==token)return;
  await refreshServiceRequests();
  if(usedToken===token)el('serviceRequestFeedback').textContent='加密资料已保存，申请 '+String(item.id).slice(0,8)+' 等待人工审核。';
 }catch(error){if(usedToken===token)el('serviceRequestFeedback').textContent='资料未确认保存：'+error.message;}
 finally{
  if(kind==='BANK_LINK')payload.accountNumber='';else {payload.front.base64='';payload.back.base64='';}
  if(usedToken===token){serviceBusy=false;button.disabled=false;for(const id of ['identityFront','identityBack','bankRequestNumber'])el(id).value='';}
 }
}
el('identityUploadForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!privateDataReady||serviceBusy)return;
 const usedToken=token,button=event.currentTarget.querySelector('button');button.disabled=true;
 try{
  const [front,back]=await Promise.all([imagePayload(el('identityFront').files[0]),imagePayload(el('identityBack').files[0])]);
  if(usedToken===token)await submitPrivateMaterial('KYC',{front,back},button,usedToken);
 }catch(error){if(usedToken===token)el('serviceRequestFeedback').textContent=error.message;}
 finally{if(usedToken===token)button.disabled=false;}
});
