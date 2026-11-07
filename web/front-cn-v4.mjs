// New desktop shell reusing the original app.mjs DOM and event-bound forms.
// No mock account balances or replacement trading APIs.
(()=>{
 const o=document.getElementById("overview");
 if(!o||new URLSearchParams(location.search).has("cn_legacy"))return;
 const oldHeader=o.querySelector(".main-content > .topbar");
 const workspace=o.querySelector(".main-content .workspace");
 const board=workspace?.querySelector(".trade-board");
 const account=workspace?.querySelector("#account-section");
 const chart=workspace?.querySelector("#stockChart");
 if(!oldHeader||!workspace||!board||!account||!chart)return;
 if(o.querySelector("#cnV4Header"))return;
 const head=document.createElement("header");
 head.id="cnV4Header";
 head.className="cn-v4-header";
 head.setAttribute("aria-label","CN Capital 客户交易工作台");
 head.innerHTML=[
  '<a class="cn-v4-brand" href="#transactions-section" aria-label="CN Capital 交易">',
  '<img src="/cn-logo.svg" width="36" height="36" alt="" decoding="async">',
  '<span><b>CN Capital</b><small>PRIVATE · TRADING</small></span></a>',
  '<nav class="cn-v4-tabs" aria-label="交易工作台模块">',
  '<button type="button" class="cn-v4-tab" data-cn-v4-tab="trade" aria-current="page">交易</button>',
  '<button type="button" class="cn-v4-tab" data-cn-v4-tab="account" aria-current="false">账户</button></nav>',
  '<div class="cn-v4-actions">',
  '<button type="button" id="cnV4Hide" class="cn-v4-pill" aria-pressed="false">隐藏金额</button>',
  '<button type="button" class="cn-v4-balance" id="cnV4Balance" title="打开账户">',
  '<span>现金余额 USD</span><strong id="cnV4Cash">—</strong></button>',
  '<div class="cn-v4-search-holder" id="cnV4SearchHolder"></div>',
  '<button type="button" id="cnV4Support" class="cn-v4-pill cn-v4-support">客服</button>',
  '<button type="button" id="cnV4Logout" class="cn-v4-avatar" aria-label="退出登录" title="退出登录">CN</button></div>'
 ].join("");
 o.prepend(head);
 const search=oldHeader.querySelector(".terminal-top-search");
 if(search)head.querySelector("#cnV4SearchHolder").append(search);
 const exportBtn=document.getElementById("exportHistoryButton");
 const list=board.querySelector(".transaction-list-panel");
 const listTitle=list?.querySelector(".panel-heading");
 if(exportBtn&&listTitle){exportBtn.classList.add("cn-v4-export");listTitle.append(exportBtn)}
 else if(exportBtn)head.querySelector(".cn-v4-actions").append(exportBtn);
 const conn=document.getElementById("connectionStatus");
 if(conn)head.querySelector(".cn-v4-actions").append(conn);
 const cashSource=document.getElementById("cash");
 const cashTarget=head.querySelector("#cnV4Cash");
 function syncCash(){
  const v=String(cashSource?.textContent||"—").trim();
  cashTarget.textContent=(v==="—"||v==="")?"—":v.startsWith("$")?v:"$"+v;
 }
 if(cashSource){new MutationObserver(syncCash).observe(cashSource,{subtree:true,characterData:true,childList:true});syncCash();}
 function setTab(name,scroll=true){
  const tab=name==="account"?"account":"trade";
  o.dataset.cnV4Tab=tab;
  head.querySelectorAll(".cn-v4-tab").forEach(b=>b.setAttribute("aria-current",b.dataset.cnV4Tab===tab?"page":"false"));
  if(scroll&&matchMedia("(min-width:769px)").matches)window.scrollTo({top:0,behavior:"instant"});
 }
 head.querySelectorAll(".cn-v4-tab").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.cnV4Tab)));
 head.querySelector("#cnV4Balance").addEventListener("click",()=>setTab("account"));
 head.querySelector("#cnV4Support").addEventListener("click",()=>{
  setTab("account");
  requestAnimationFrame(()=>{
   const node=document.getElementById("customerSupportPanel");
   if(node&&!node.hidden)node.scrollIntoView({behavior:"smooth",block:"start"});
  });
 });
 head.querySelector("#cnV4Logout").addEventListener("click",()=>{
  const button=document.getElementById("railLogout")||document.getElementById("logout");
  button?.click();
 });
 head.querySelector("#cnV4Hide").addEventListener("click",event=>{
  const hiding=o.classList.toggle("cn-v4-private");
  event.currentTarget.setAttribute("aria-pressed",String(hiding));
  event.currentTarget.textContent=hiding?"显示金额":"隐藏金额";
 });
 function syncHash(){
  const hash=decodeURIComponent(location.hash.slice(1));
  const accountTargets=["account-section","serviceRequestsPanel","customerSupportPanel",
    "commodityCatalogPanel","fundingRequestForm","bankLinkRequestForm","identityUploadForm",
    "accountSummary","authPanel"];
  if(accountTargets.includes(hash))setTab("account",false);
  else if(["holdings-section","transactions-section","terminal-section"].includes(hash))setTab("trade",false);
 }
 window.addEventListener("hashchange",syncHash);
 setTab("trade",false);syncHash();o.dataset.cnV4Ready="true";
})();
