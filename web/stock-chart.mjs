// Official TradingView embed keeps market data inside the vendor-hosted widget.
// Do not scrape or reuse widget values as a trade execution price.
export const TRADING_VIEW_WIDGET_SCRIPT =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

const LISTED = Object.freeze({
  "US:AAPL": "NASDAQ:AAPL",
  "US:MSFT": "NASDAQ:MSFT",
  "US:AA": "NYSE:AA",
  // Confirmed by Newmont investor stock information (NYSE listing).
  "US:NEM": "NYSE:NEM",
  "HK:0700": "HKEX:700",
  "HK:9988": "HKEX:9988",
  "CN:600519": "SSE:600519",
  "CN:000001": "SZSE:000001",
  "MY:1155": "MYX:1155",
  "MY:1023": "MYX:1023"
});

export function resolveTradingViewSymbol({market,symbol} = {}) {
  return LISTED[String(market) + ":" + String(symbol)] ?? null;
}

export function tradingViewSymbolUrl(symbol) {
  if (!Object.values(LISTED).includes(symbol)) return null;
  return "https://www.tradingview.com/symbols/" + symbol.replace(":", "-") + "/";
}

export function mountStockHistory(host,points){
  const width=280,height=260,left=8,right=211,top=16,bottom=225;
  const prices=points.map(point=>point.price);
  const min=Math.min(...prices),max=Math.max(...prices);
  const padding=Math.max((max-min)*.08,max*.001);
  const low=Math.max(0,min-padding),high=max+padding;
  const x=index=>left+(right-left)*index/(points.length-1);
  const y=price=>bottom-(bottom-top)*(price-low)/(high-low);
  const priceLabel=price=>price.toFixed(price<1?4:2);
  const date=index=>new Date(points[index].time).toISOString().slice(0,10);
  const doc=host.ownerDocument;
  const node=(tag,attributes,text)=>{
    const element=doc.createElementNS("http://www.w3.org/2000/svg",tag);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);
    if(text!==undefined)element.textContent=text;
    return element;
  };
  const svg=node("svg",{viewBox:`0 0 ${width} ${height}`,class:"mirror-history",tabindex:"0",
    "aria-label":"历史收盘价走势图，使用左右方向键查看日期和价格"});
  for(let step=0;step<=4;step++){
    const price=high-(high-low)*step/4;
    svg.append(node("line",{x1:left,x2:right,y1:y(price),y2:y(price),class:"history-grid"}),
      node("text",{x:right+6,y:y(price)+4},priceLabel(price)));
  }
  svg.append(node("polyline",{points:points.map((point,index)=>x(index)+","+y(point.price)).join(" "),class:"history-trend"}),
    node("text",{x:left,y:bottom+22},date(0)),
    node("text",{x:right,y:bottom+22,"text-anchor":"end"},date(points.length-1)));
  const cursor=node("g",{class:"history-cursor","aria-hidden":"true"});
  const status=doc.createElement("output");
  status.className="mirror-chart-note";status.setAttribute("aria-live","polite");
  svg.append(cursor);
  let selected=points.length-1;
  const show=index=>{
    selected=Math.max(0,Math.min(points.length-1,index));
    const px=x(selected),py=y(points[selected].price);
    const dateX=Math.max(42,Math.min(right-42,px));
    cursor.replaceChildren(node("line",{x1:px,x2:px,y1:top,y2:bottom}),
      node("line",{x1:left,x2:right,y1:py,y2:py}),
      node("circle",{cx:px,cy:py,r:3}),
      node("rect",{x:right+2,y:py-10,width:width-right-2,height:20,rx:3}),
      node("text",{x:right+6,y:py+4},priceLabel(points[selected].price)),
      node("rect",{x:dateX-41,y:bottom+5,width:82,height:20,rx:3}),
      node("text",{x:dateX,y:bottom+19,"text-anchor":"middle"},date(selected)));
    status.textContent=date(selected)+" · 收盘 $"+priceLabel(points[selected].price);
  };
  svg.addEventListener("pointermove",event=>{
    const matrix=svg.getScreenCTM();
    if(!matrix)return;
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    show(Math.round((point.matrixTransform(matrix.inverse()).x-left)/(right-left)*(points.length-1)));
  });
  svg.addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight"].includes(event.key))return;
    event.preventDefault();show(selected+(event.key==="ArrowLeft"?-1:1));
  });
  show(selected);
  delete host.dataset.chartSymbol;
  host.replaceChildren(svg,status);
}

export function mountStockChart(host, instrument, {mobile=false} = {}) {
  if (!host) throw new Error("Missing chart container");
  const symbol = resolveTradingViewSymbol(instrument);
  if (host.dataset.chartSymbol === symbol) return symbol;
  const doc = host.ownerDocument;
  host.dataset.chartSymbol = symbol ?? "";
  if (!symbol) {
    const message = doc.createElement("p");
    message.className = "stock-chart-empty";
    message.textContent = "该标的尚未配置第三方走势图";
    host.replaceChildren(message);
    return null;
  }
  const wrapper = doc.createElement("div");
  wrapper.className = "tradingview-widget-container";
  const chart = doc.createElement("div");
  chart.className = "tradingview-widget-container__widget";
  const loading = doc.createElement("p");
  loading.className = "stock-chart-loading";
  loading.textContent = "正在加载第三方走势图…若不可用，可使用下方来源链接查看";
  // Keep the loading hint outside the iframe mount node: vendor scripts may
  // append an iframe instead of replacing existing children.
  const attribution = doc.createElement("div");
  attribution.className = "tradingview-widget-copyright";
  const link = doc.createElement("a");
  link.href = tradingViewSymbolUrl(symbol);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = symbol + " 图表";
  attribution.append(link, doc.createTextNode(" by TradingView"));
  const script = doc.createElement("script");
  script.src = TRADING_VIEW_WIDGET_SCRIPT;
  script.type = "text/javascript";
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol,
    interval: "D",
    timezone: "Etc/UTC",
    theme: "dark",
    style: mobile ? "2" : "1",
    locale: mobile ? "zh_CN" : "en",
    backgroundColor: mobile ? "#050506" : "#1b1e21",
    gridColor: "rgba(174, 180, 186, 0.08)",
    allow_symbol_change: false,
    hide_top_toolbar: true,
    hide_side_toolbar: true,
    hide_legend: mobile,
    hide_volume: true,
    save_image: false,
    withdateranges: !mobile,
    calendar: false
  });
  const showUnavailable = () => {
    loading.textContent = "图表加载失败，请使用下方数据源链接查看";
  };
  script.addEventListener("load", () => {
    if (host.querySelector("iframe")) loading.remove();
    else showUnavailable();
  }, {once:true});
  script.addEventListener("error", showUnavailable, {once:true});
  // Retain the official widget container/branding; the script creates an iframe.
  wrapper.append(chart, loading, attribution, script);
  host.replaceChildren(wrapper);
  return symbol;
}
