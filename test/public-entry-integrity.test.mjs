import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createApi} from "../src/http-api.mjs";
const html=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");

test("CN Capital login and logo are visible by default; workspace is hidden",()=>{
  assert.match(html,/<section id="entryGate" class="portal"/);
  assert.match(html,/<div class="app-shell" id="overview" hidden>/);
  assert.match(html,/class="portal-name">CN <span>Capital<\/span>/);
  assert.match(html,/id="entryForm"/);
  assert.match(html,/src="\/portal\.mjs"/);
  assert.match(html,/src="\/app\.mjs"/);
});

test("customer terminal hides internal implementation disclaimers",()=>{
  for(const phrase of [
    "非市值权重","本平台仅记录账户活动","不向券商或交易所",
    "授权行情未接入前","Account activity · 内部账户记录",
    "平台记录不代表券商成交或结算","无券商交易执行功能","INTERNAL ONLY"
  ])assert.equal(html.includes(phrase),false,phrase);
  assert.match(html,/交易服务暂不可用/);
});

test("Node server serves every module needed by the login experience",async()=>{
  const db={query:async()=>({rows:[]})};
  const app=createApi({db,resolveSession:async()=>null});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  try{
    const base="http://127.0.0.1:"+app.address().port;
    for(const path of ["/","/app.mjs","/portal.mjs","/styles.css","/portal.css","/market-allocation.mjs","/favicon.svg"]){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path+" must be served");
      if(path.endsWith(".mjs"))assert.match(response.headers.get("content-type"),/javascript/);
      if(path==="/market-allocation.mjs")assert.match(await response.text(),/export function summarizeMarketHoldings/);
    }
  }finally{await new Promise(resolve=>app.close(resolve))}
});
