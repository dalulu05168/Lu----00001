// Official TradingView embed keeps market data inside the vendor-hosted widget.
// Do not scrape or reuse widget values as a trade execution price.
export const TRADING_VIEW_WIDGET_SCRIPT =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

const LISTED = Object.freeze({
  "US:AAPL": "NASDAQ:AAPL",
  "US:MSFT": "NASDAQ:MSFT",
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

export function mountStockChart(host, instrument) {
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
    theme: "light",
    style: "1",
    locale: "en",
    backgroundColor: "#ffffff",
    gridColor: "rgba(46, 46, 46, 0.06)",
    allow_symbol_change: false,
    hide_top_toolbar: true,
    hide_side_toolbar: true,
    hide_legend: false,
    hide_volume: true,
    save_image: false,
    withdateranges: true,
    calendar: false
  });
  script.addEventListener("load", () => loading.remove(), {once:true});
  script.addEventListener("error", () => {
    loading.textContent = "图表加载失败，请使用下方数据源链接查看";
  }, {once:true});
  // Retain the official widget container/branding; the script creates an iframe.
  wrapper.append(chart, loading, attribution, script);
  host.replaceChildren(wrapper);
  return symbol;
}
