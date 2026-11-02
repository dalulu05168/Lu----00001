import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  resolveTradingViewSymbol, tradingViewSymbolUrl, TRADING_VIEW_WIDGET_SCRIPT,
  mountStockChart
} from "../web/stock-chart.mjs";

test("stock symbols use explicit provider exchange codes across four markets", () => {
  const expected = [
    ["US","AAPL","NASDAQ:AAPL"], ["US","MSFT","NASDAQ:MSFT"],
    ["HK","0700","HKEX:700"], ["HK","9988","HKEX:9988"],
    ["CN","600519","SSE:600519"], ["CN","000001","SZSE:000001"],
    ["MY","1155","MYX:1155"], ["MY","1023","MYX:1023"]
  ];
  for(const [market,symbol,provider] of expected) {
    assert.equal(resolveTradingViewSymbol({market,symbol}),provider);
    assert.match(tradingViewSymbolUrl(provider),/^https:\/\/www\.tradingview\.com\/symbols\//);
  }
  assert.equal(resolveTradingViewSymbol({market:"US",symbol:"NOT_LISTED"}),null);
  assert.equal(resolveTradingViewSymbol({market:"US",symbol:"AAPL<script>"}),null);
  assert.equal(tradingViewSymbolUrl("NASDAQ:AAPL<script>"),null);
});

test("official widget is configured with the selected stock, attribution and no fake values", () => {
  const dom=new JSDOM('<div id="chart"></div>',{url:"https://example.test/"});
  try {
    const host=dom.window.document.getElementById("chart");
    assert.equal(mountStockChart(host,{market:"US",symbol:"AAPL"}),"NASDAQ:AAPL");
    const first=host.querySelector("script");
    assert.equal(first.src,TRADING_VIEW_WIDGET_SCRIPT);
    const settings=JSON.parse(first.textContent);
    assert.equal(settings.symbol,"NASDAQ:AAPL");
    assert.equal(settings.theme,"light");
    assert.equal(settings.interval,"D");
    assert.equal(settings.allow_symbol_change,false);
    assert.equal(host.querySelector(".tradingview-widget-container__widget").children.length,0);
    assert.equal(host.querySelector(".stock-chart-loading").parentElement.className,"tradingview-widget-container");
    first.dispatchEvent(new dom.window.Event("error"));
    assert.match(host.querySelector(".stock-chart-loading").textContent,/加载失败/);
    first.dispatchEvent(new dom.window.Event("load"));
    assert.equal(host.querySelector(".stock-chart-loading"),null);
    assert.match(host.querySelector(".tradingview-widget-copyright a").textContent,/TradingView|NASDAQ:AAPL/);
    assert.equal(host.querySelector(".tradingview-widget-copyright a").href,"https://www.tradingview.com/symbols/NASDAQ-AAPL/");
    assert.equal(mountStockChart(host,{market:"US",symbol:"AAPL"}),"NASDAQ:AAPL");
    assert.equal(host.querySelector("script"),first,"account refresh should not repeatedly load external chart");
    mountStockChart(host,{market:"HK",symbol:"0700"});
    assert.equal(JSON.parse(host.querySelector("script").textContent).symbol,"HKEX:700");
    assert.notEqual(host.querySelector("script"),first);
    assert.equal(host.querySelector("iframe"),null,"test does not fabricate returned third-party data");
    mountStockChart(host,{market:"HK",symbol:"UNKNOWN"});
    assert.equal(host.querySelector("script"),null);
    assert.match(host.textContent,/尚未配置/);
  } finally {dom.window.close();}
});
