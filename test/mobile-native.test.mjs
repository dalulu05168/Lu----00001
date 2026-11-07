import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const file=async path=>readFile(new URL("../"+path,import.meta.url),"utf8");
function documentAt(width,search=""){
  return file("web/index.html").then(html=>{
    const dom=new JSDOM(html,{
      runScripts:"dangerously",url:"https://nuvexapro.com/"+search,pretendToBeVisual:true,
      beforeParse(win){
        Object.defineProperty(win,"innerWidth",{configurable:true,value:width});
        win.matchMedia=()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}});
        win.scrollTo=()=>{};
        win.HTMLElement.prototype.scrollIntoView=()=>{};
        win.requestAnimationFrame=fn=>{fn();return 1;};
        win.fetch=()=>{throw Error("The mobile UI must never independently fetch account or trading data")};
      }
    });
    return dom;
  });
}
test("mobile routes automatically only after original login, with all native five tabs and no fake device shell",async()=>{
 const dom=await documentAt(390);
 try{
  const d=dom.window.document,o=d.getElementById("overview");
  assert.equal(o.dataset.cnMode,"mobile");
  assert.equal(o.dataset.cnView,"home");
  assert.equal(o.hidden,true,"Original authenticated gate cannot be bypassed");
  assert.ok(d.getElementById("entryForm"));
  assert.equal(d.querySelectorAll("#cnMobileTabs [data-cn-tab]").length,5);
  assert.deepEqual([...d.querySelectorAll("#cnMobileTabs button[aria-current=page]")].map(x=>x.dataset.cnTab),["home"]);
  assert.equal(d.querySelectorAll(".isl,.mirror-status-bar,.sb,.phone-shell,.phone-frame").length,0);
  for(const id of ["orderForm","watchlistToggle","savedWatchlist","positions","transactionRows",
    "fundingRequestForm","bankLinkRequestForm","customerSupportForm","accountCashValue"]){
    assert.ok(d.getElementById(id),"Missing original API-backed control "+id);
  }
  const css=await file("web/front-cn-v3.css");
  assert.match(css,/CN Capital mobile: genuine full-bleed website UI/);
  assert.match(css,/width:100%!important;max-width:none!important/);
  assert.match(css,/#cnMobileTabs/);
  assert.doesNotMatch(css,/(?:border-radius:36px|class="isl"|class="sb")/);
 }finally{dom.window.close();}
});
test("mobile cash, account and count fields mirror only current live DOM state, not supplied demo money",async()=>{
 const dom=await documentAt(390);
 try{
  const d=dom.window.document;
  assert.equal(d.getElementById("cnMobileCash").textContent,"—");
  d.getElementById("accountCashValue").textContent="1,234.56";
  d.getElementById("portfolioValue").textContent="$2,000.00";
  d.getElementById("positionCount").textContent="2";
  d.getElementById("savedWatchlistCount").textContent="3";
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(d.getElementById("cnMobileCash").textContent,"1,234.56");
  assert.equal(d.getElementById("cnMobileAssets").textContent,"$2,000.00");
  assert.equal(d.getElementById("cnMobileHoldings").textContent,"2");
  assert.equal(d.getElementById("cnMobileWatchCount").textContent,"3");
  assert.doesNotMatch((await file("web/index.html")),/\$998,937\.60|const D=\{cash:/);
 }finally{dom.window.close();}
});
test("bottom navigation and quick shortcuts keep original real service forms without synthetic writes",async()=>{
 const dom=await documentAt(390);
 try{
  const d=dom.window.document,o=d.getElementById("overview");
  for(const tab of ["market","trade","orders","account","home"]){
    d.querySelector('[data-cn-tab="'+tab+'"]').click();
    assert.equal(o.dataset.cnView,tab);
    assert.deepEqual([...d.querySelectorAll("#cnMobileTabs [aria-current=page]")].map(x=>x.dataset.cnTab),[tab]);
  }
  d.querySelector('[data-cn-action=withdraw]').click();
  assert.equal(o.dataset.cnView,"account");
  assert.equal(d.getElementById("fundingRequestKind").value,"WITHDRAWAL");
  d.querySelector('[data-cn-action=deposit]').click();
  assert.equal(d.getElementById("fundingRequestKind").value,"DEPOSIT");
  d.querySelector('[data-cn-action=support]').click();
  assert.equal(o.dataset.cnView,"account");
  d.getElementById("cnModeSwitch").click();
  assert.equal(o.dataset.cnMode,"desktop");
  assert.equal(dom.window.location.search,"?view=desktop");
  d.getElementById("cnDesktopReturn").click();
  assert.equal(o.dataset.cnMode,"mobile");
  assert.equal(dom.window.location.search,"?view=mobile");
 }finally{dom.window.close();}
});
test("desktop remains default on large non-touch viewport; users can manually force mobile",async()=>{
 const dom=await documentAt(1440);
 try{
  const d=dom.window.document;
  assert.equal(d.getElementById("overview").dataset.cnMode,"desktop");
  const url=new URL(dom.window.location.href);
  url.searchParams.set("view","mobile");
  dom.window.history.replaceState(null,"",url.pathname+url.search);
  dom.window.dispatchEvent(new dom.window.Event("popstate"));
  assert.equal(d.getElementById("overview").dataset.cnMode,"mobile");
 }finally{dom.window.close();}
});
