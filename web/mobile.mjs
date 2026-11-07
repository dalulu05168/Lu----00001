import {mountStockChart} from "./stock-chart.mjs";

// All displayed balances/holdings/orders originate from the authenticated API.
// No hardcoded market prices, order statuses or demo cash figures.
const $=id=>document.getElementById(id);
const TOKEN_KEY="gsp_token";
let token=sessionStorage.getItem(TOKEN_KEY);
const S={
 tab:"home",account:null,analytics:null,watchlist:null,catalog:null,
 products:null,ledger:null,requests:null,support:null,privateReady:false,
 priceAvailable:false,stockQuoteConfigured:false,quote:null,quoteSymbol:"",
 selected:{market:"US",symbol:"AAPL",name:"Apple Inc."},
 search:"",filter:"全部",loading:true,failed:false,submitting:false,
 error:"",lastUpdated:null,quoteLoading:false,tabBeforeSheet:null
};
const mny=cents=>Number.isSafeInteger(Number(cents))?(Number(cents)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
const amount=cents=>Number.isSafeInteger(Number(cents))?"$"+mny(cents):"—";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const textNode=(text,style="")=>'<p class="muted '+style+'">'+esc(text)+'</p>';
const onlyArray=v=>Array.isArray(v)?v:[];
const stamp=v=>v?new Date(v).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
const empty=label=>'<div class="empty">'+esc(label)+'</div>';
const note=(label,kind="")=>'<div class="note '+kind+'">'+esc(label)+'</div>';
const row=(title,detail,right="",action="")=>'<article class="row"'+action+'><div class="meta"><strong>'+esc(title)+'</strong><small>'+esc(detail)+'</small></div><div class="right">'+right+'</div></article>';
const panel=(title,body,extra="")=>'<section class="card"><header class="card-head"><h3>'+esc(title)+'</h3>'+extra+'</header>'+body+'</section>';
const field=(name,id,type="text",val="",attrs="")=>'<label class="field">'+esc(name)+'<input id="'+esc(id)+'" type="'+esc(type)+'" value="'+esc(val)+'" '+attrs+'></label>';
const moneyValue=p=>Number(p?.cost_cents??p?.costCents??NaN);
const loginUrl=()=>location.hostname==="m.nuvexapro.com"?"https://www.nuvexapro.com/":"/";
function invalidate(){sessionStorage.removeItem(TOKEN_KEY);location.replace(loginUrl());}
function mobileError(error){const message=String(error?.message??error);$("mobileConnection").className="connection bad";$("mobileConnection").textContent="同步失败";S.error=message;toast(message);}
async function api(path,options={}){
 const auth=token;
 const h={"content-type":"application/json",...(auth?{authorization:"Bearer "+auth}:{}),...(options.headers||{})};
 const res=await fetch("/api"+path,{method:options.method||"GET",headers:h,cache:"no-store",...(options.body!==undefined?{body:JSON.stringify(options.body)}:{})});
 let result={};if(res.status!==204){try{result=await res.json()}catch{throw Error("服务端返回的数据格式不正确");}}
 if(res.status===401){invalidate();throw Error("账户会话失效，请重新登录");}
 if(!res.ok)throw Error(String(result.error||"操作失败（HTTP "+res.status+"）"));
 return result;
}
function toast(message){
 const el=$("mobileToast");el.textContent=String(message);el.hidden=false;
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>{el.hidden=true},3500);
}
function sheet(title,content){
 $("mobileDialogTitle").textContent=title;
 $("mobileDialogBody").innerHTML=content;
 $("mobileSheet").hidden=false;
 document.body.style.overflow="hidden";
 $("mobileDialogClose").focus();
}
function closeSheet(){$("mobileSheet").hidden=true;$("mobileDialogBody").replaceChildren();document.body.style.overflow="";}
function supportedStocks(){
 const existing=onlyArray(S.catalog?.items).filter(x=>x.market==="US"&&x.symbol&&["STOCK","FUND"].includes(x.itemType??x.item_type??"STOCK"));
 const watch=onlyArray(S.watchlist).filter(x=>x.market==="US");
 const pos=onlyArray(S.account?.positions).filter(x=>x.market==="US");
 const intern=onlyArray(S.ledger?.positions).filter(x=>x.market==="US"&&x.symbol);
 const result=new Map();
 for(const x of [S.selected,...watch,...pos,...intern,...existing]){
  const symbol=String(x?.symbol??"").toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(symbol))continue;
  if(!result.has(symbol))result.set(symbol,{market:"US",symbol,name:x.name||symbol});
 }
 return [...result.values()];
}
function holdingRows(){
 const result=[];
 for(const p of onlyArray(S.account?.positions)){
  if(!p?.symbol||Number(p.quantity)<=0)continue;
  result.push({symbol:p.symbol,market:p.market,quantity:Number(p.quantity),cost:moneyValue(p),name:p.name||p.symbol,source:"account"});
 }
 for(const p of onlyArray(S.ledger?.positions)){
  if(!p?.code&&!p?.symbol)continue;
  if(Number(p.quantity)<=0)continue;
  result.push({symbol:p.symbol||p.code,market:p.market||"",quantity:Number(p.quantity),cost:moneyValue(p),name:p.name||p.code,source:"internal",locked:p.manually_locked,unlocked:p.unlocked_quantity});
 }
 return result;
}
function orderRows(){
 const result=[];
 for(const o of onlyArray(S.account?.orders))result.push({type:o.side==="SELL"?"卖出":"买入",name:o.symbol,quantity:o.quantity,
  date:o.created_at??o.createdAt,price:o.price_cents??o.priceCents,total:o.amount_usd_cents??o.totalCents,status:o.status||"已记录",id:o.id});
 for(const o of onlyArray(S.ledger?.purchases))result.push({type:"内部购买",name:o.product_code??o.productCode??"商品",quantity:o.quantity,date:o.created_at??o.createdAt,
  price:o.unit_price_cents,total:o.total_cents,status:o.status||"已记录",id:o.id});
 for(const o of onlyArray(S.ledger?.sales))result.push({type:"内部卖出",name:o.symbol??"证券",quantity:o.quantity,date:o.created_at??o.createdAt,
  price:o.unit_price_cents,total:o.total_cents,status:o.status||"已记录",id:o.id});
 return result.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
}
function buttonAction(label,action,className="secondary",attrs=""){
 return '<button class="'+className+'" type="button" data-action="'+action+'" '+attrs+'>'+label+'</button>';
}
function holdingsSection(){
 const holdings=holdingRows();
 const content=holdings.length?'<div class="cards2">'+holdings.map(p=>'<div class="card holding"><div class="hero-title"><span class="coin">'+esc(String(p.symbol).slice(0,2))+'</span><strong>'+esc(p.name)+'</strong></div><span class="quantity">'+esc(p.symbol)+' · '+p.quantity+' 股</span><span class="cost">成本 '+amount(p.cost)+'</span></div>').join("")+'</div>':empty("账户暂无持仓记录");
 return '<div class="header-line"><h2>我的持仓</h2><span class="count">'+holdings.length+'</span></div>'+content;
}
function watchSection(){
 const items=onlyArray(S.watchlist);
 const symbols=supportedStocks();
 let results=items.length?items.map(p=>({market:p.market,symbol:p.symbol,name:symbols.find(x=>x.symbol===p.symbol)?.name||p.symbol,follow:true})):symbols.slice(0,6).map(x=>({...x,follow:false}));
 const contents=results.map(x=>row(x.symbol,x.name,'<button class="mini-button '+(x.follow?"active":"")+'" data-action="favorite" data-market="'+esc(x.market)+'" data-symbol="'+esc(x.symbol)+'" aria-label="'+(x.follow?"移出自选":"加入自选")+'">'+(x.follow?"★":"☆")+'</button>', ' data-symbol="'+esc(x.symbol)+'" data-market="'+esc(x.market)+'"')).join("");
 return '<div class="header-line"><h2>自选</h2><span class="count">'+items.length+'</span></div>'+(contents?'<div class="list">'+contents+'</div>':empty("尚无自选证券，请在行情页添加"));
}
function home(){
 const a=S.account?.account;
 const balance=amount(a?.cashCents);
 const basis=S.analytics?.historyAvailable?amount(S.analytics?.positionCostCents):"—";
 const hero=S.watchlist?.[0]||supportedStocks()[0]||null;
 const heading=hero?'<div class="hero-title"><span class="coin">'+esc(hero.symbol.slice(0,2))+'</span><div style="flex:1"><strong>开始交易</strong><small>'+esc(hero.symbol)+' · '+esc(hero.name||hero.symbol)+'</small></div><span class="hero-go">去下单 ›</span></div>':'<div class="hero-title"><strong>开始交易</strong><span class="hero-go">查看行情 ›</span></div>';
 return '<div><div class="eyebrow">欢迎使用 CN Capital</div><h1>我的交易账户</h1><div class="eyebrow">现金余额 USD</div><div class="balance">'+balance+'</div><div class="balance-sub">持仓成本 '+basis+'</div></div>'
 +'<button class="card lime" data-action="go-trade" style="display:block;text-align:left;width:100%;color:inherit">'+heading+'<div class="hero-pr"><strong>'+esc(hero?.symbol||"查看市场")+'</strong><span class="hero-go">›</span></div></button>'
 +'<div class="actions"><button class="action" data-action="deposit"><span class="action-icon">＋</span>充值</button><button class="action withdraw" data-action="withdraw"><span class="action-icon">↓</span>提现</button><button class="action orders" data-tab="orders"><span class="action-icon">☷</span>订单</button></div>'
 +holdingsSection()+watchSection()
 +note("内部账户记录，不连接券商。行情或市值不可用时不显示虚构价格。","info");
}
function market(){
 const items=supportedStocks().filter(x=>(x.symbol+" "+x.name).toLowerCase().includes(S.search.toLowerCase())).slice(0,100);
 const watch=new Set(onlyArray(S.watchlist).map(x=>x.market+":"+x.symbol));
 const list=items.map(x=>row(x.symbol,x.name,
  '<button class="mini-button '+(watch.has(x.market+":"+x.symbol)?"active":"")+'" data-action="favorite" data-market="'+esc(x.market)+'" data-symbol="'+esc(x.symbol)+'">'+(watch.has(x.market+":"+x.symbol)?"★":"☆")+'</button>',
  ' data-symbol="'+esc(x.symbol)+'" data-market="'+esc(x.market)+'"')).join("");
 const same=S.quote?.symbol===S.selected.symbol||S.quoteSymbol===S.selected.symbol;
 const quote=S.quote&&same?amount(S.quote.priceCents):"—";
 return '<div class="header-line"><h1>行情</h1>'+buttonAction("刷新报价","quote")+'</div>'
 +'<label class="field">查找证券<input id="mobileSearch" type="search" placeholder="搜索股票代码或名称" value="'+esc(S.search)+'" autocomplete="off"></label>'
 +panel("当前标的",'<div class="hero-title"><span class="coin">'+esc(S.selected.symbol.slice(0,2))+'</span><div style="flex:1"><strong>'+esc(S.selected.symbol)+'</strong><small>'+esc(S.selected.name)+'</small></div></div><div class="symbol-price">'+quote+'</div><div class="muted">'+(S.quoteLoading?"正在读取报价…":S.quote?"只读参考报价 · "+esc(stamp(S.quote.timestampMs)):"可信报价暂不可用")+'</div><div class="chart" id="mobileStockChart" aria-label="股票参考走势图"><div class="loading">正在加载参考图表…</div></div><p class="chart-caption">图表来自公开第三方，可能延迟；不作为交易订单结算价格。</p>'
 +'<div class="grid2">'+buttonAction("添加 / 移出自选","favorite-selected")+buttonAction("进入交易","go-trade")+'</div>')
 +panel("市场证券",list?'<div class="list">'+list+'</div>':empty("未找到匹配证券。"))
 +note("仅展示现有后台覆盖的行情。没有可信报价时显示“—”，不生成演示曲线。","info");
}
function trade(){
 const quoteReady=S.quote?.symbol===S.selected.symbol&&Number.isSafeInteger(S.quote?.priceCents);
 const regularEnabled=S.priceAvailable&&S.selected.market==="US";
 const prod=onlyArray(S.products?.items);
 const cards=prod.map((p,i)=>{
  const k=p.itemType||p.item_type||"";
  return '<article class="row"><div class="meta"><strong>'+esc(p.name||p.code||"产品")+'</strong><small>'+esc(k)+' · '+esc(p.code||p.symbol||"")+'</small></div><div class="right">'+buttonAction("查看参与","product","mini-button",'data-product-index="'+i+'"')+'</div></article>';
 }).join("");
 return '<div class="header-line"><h1>交易</h1>'+buttonAction("获取报价","quote")+'</div>'
 +panel("证券交易",'<div class="hero-title"><span class="coin">'+esc(S.selected.symbol.slice(0,2))+'</span><div style="flex:1"><strong>'+esc(S.selected.symbol)+'</strong><small>'+esc(S.selected.name)+'</small></div></div><p class="muted">当前报价：'+(quoteReady?amount(S.quote.priceCents):"—")+'</p>'
 +'<form id="mobileOrderForm" class="stack"><label class="field">交易方向<select id="mobileSide"><option value="BUY">买入</option><option value="SELL">卖出</option></select></label>'
 +field("数量（股）","mobileQuantity","number","1",'min="1" max="1000000" step="1" required')
 +'<p class="muted">订单价格由服务端可信行情确定，页面不接受手动价格。</p>'
 +'<button class="primary" type="submit" '+(!regularEnabled?"disabled":"")+'>提交内部订单</button></form>'
 +(!regularEnabled?note("当前可信执行报价未连接，订单不可提交；系统不会伪造成交。"):note("仅为平台内部交易记录，不向交易所或券商发送真实订单。","info")))
 +panel("内部产品和大宗交易",prod.length?'<div class="list">'+cards+'</div>':empty("尚无可参与产品或暂时无法同步"))
 +note("购买内部产品需核对当前条款版本，可能要求参与密码；真实交易功能以服务端状态为准。","info");
}
function orders(){
 const values=orderRows();
 const selected=values.filter(o=>S.filter==="全部"||(S.filter==="买入"?o.type.includes("买入")||o.type.includes("购买"):o.type.includes("卖出")));
 const list=selected.map(x=>row(x.name||"订单",x.type+" · "+esc(x.quantity??"—")+" · "+stamp(x.date),
  '<strong>'+amount(x.total)+'</strong><small>'+esc(x.status)+'</small>')).join("");
 const opts=["全部","买入","卖出"].map(x=>'<button type="button" data-filter="'+x+'" aria-selected="'+(x===S.filter)+'">'+x+'</button>').join("");
 return '<div class="header-line"><h1>订单</h1>'+buttonAction("导出记录","export")+'</div><div class="inline-tabs">'+opts+'</div>'
 +panel("平台交易记录",list?'<div class="list">'+list+'</div>':empty("当前筛选下暂无订单记录"))
 +note("页面仅呈现已从账户服务读取的订单，不提供虚构的“已成交”状态。","info");
}
function requestSection(){
 const items=onlyArray(S.requests);
 const list=items.slice(0,20).map(x=>row(
  ({FUNDING:x.kind==="DEPOSIT"?"充值申请":"提现申请",KYC:"身份审核",BANK_LINK:"银行资料"}[x.category]||"申请"),
  stamp(x.createdAt),'<small>'+esc(x.status??"待审核")+'</small>'
 )).join("");
 return panel("审核申请记录",list?'<div class="list">'+list+'</div>':empty("暂无申请"));
}
function account(){
 const a=S.account?.account||{};
 const code=String(a.id||"");
 return '<div class="header-line"><h1>我的账户</h1>'+buttonAction("刷新数据","reload")+'</div>'
 +panel("账户摘要",'<div class="eyebrow">账户编号</div><h2 style="word-break:break-all">'+esc(code?"••••"+code.slice(-8):"—")+'</h2>'
 +'<div class="grid2"><div class="card"><div class="eyebrow">币种</div><strong>'+esc(a.currency||"—")+'</strong></div><div class="card"><div class="eyebrow">现金</div><strong>'+amount(a.cashCents)+'</strong></div></div><div class="muted">最近同步 '+stamp(S.lastUpdated)+'</div>')
 +'<div class="grid2">'+buttonAction("银行资料","bank")+buttonAction("身份审核","kyc")+buttonAction("充值申请","deposit")+buttonAction("提现申请","withdraw")+'</div>'
 +requestSection()
 +panel("客户客服",'<div class="stack"><div class="list">'+onlyArray(S.support?.messages).slice(-20).map(m=>row(m.senderUserId===S.support?.thread?.clientId?"我的消息":"客服回复",stamp(m.createdAt),'<small>'+esc(String(m.body||"").slice(0,130))+'</small>')).join("")+'</div>'
 +'<form id="mobileSupportForm" class="stack"><label class="field">发送客服消息<textarea id="mobileSupportText" maxlength="4000" required placeholder="输入需要客服处理的问题"></textarea></label>'
 +'<button class="primary" type="submit" '+(S.support?.thread?.status==="CLOSED"?"disabled":"")+'>发送消息</button></form></div>')
 +'<div class="grid2">'+buttonAction("切换电脑版本","desktop")+buttonAction("退出账户","logout")+'</div>'
 +note("资金、银行和身份审核属于平台内部工作流，不代表实际到账或第三方实名认证。","info");
}
function render(){
 if(S.loading&&!S.account){$("mobileScreen").innerHTML='<div class="loading">正在安全同步账户数据…</div>';return;}
 if(!S.account){$("mobileScreen").innerHTML=empty(S.error||"账户尚未同步");return;}
 $("mobileNav").querySelectorAll("[data-tab]").forEach(button=>{button.setAttribute("aria-current",button.dataset.tab===S.tab?"page":"false")});
 const html={home,market,trade,orders,account}[S.tab]();
 $("mobileScreen").innerHTML=html;
 if(S.tab==="market"){
  const place=$("mobileStockChart");
  if(place){
   try{mountStockChart(place,{market:S.selected.market,symbol:S.selected.symbol,name:S.selected.name},{mobile:true})}
   catch{place.textContent="参考图表暂时无法加载";}
  }
 }
}
async function refresh(){
 if(!token){invalidate();return;}
 S.loading=true;if(!S.account)render();
 try{
  S.account=await api("/account");if(!S.account?.account||!Array.isArray(S.account?.positions)||!Array.isArray(S.account?.orders))throw Error("账户快照格式错误");
  S.error="";S.loading=false;S.failed=false;S.lastUpdated=new Date().toISOString();
  $("mobileConnection").className="connection ok";$("mobileConnection").textContent="账户已连接";
  render();
  const paths=[
   ["watchlist","/watchlist"],["analytics","/account/analytics"],
   ["catalog","/catalog"],["products","/internal-products"],["ledger","/internal-purchases"],
   ["funding","/requests?category=FUNDING"],["kyc","/requests?category=KYC"],["bank","/requests?category=BANK_LINK"],
   ["support","/support"],["privacy","/private-data/status"],["health","/health"]
  ];
  const results=await Promise.allSettled(paths.map(([,path])=>api(path)));
  const byId=Object.fromEntries(paths.map(([name],i)=>[name,results[i].status==="fulfilled"?results[i].value:null]));
  S.watchlist=byId.watchlist?.items??null;
  S.analytics=byId.analytics;
  S.catalog=byId.catalog;
  S.products=byId.products;
  S.ledger=byId.ledger;
  S.support=byId.support;
  S.privateReady=byId.privacy?.ready===true;
  S.stockQuoteConfigured=byId.products?.stockQuotesConfigured===true;
  S.priceAvailable=byId.health?.pricingConnected===true;
  S.requests=[...onlyArray(byId.funding?.items).map(x=>({...x,category:"FUNDING"})),
    ...onlyArray(byId.kyc?.items).map(x=>({...x,category:"KYC"})),
    ...onlyArray(byId.bank?.items).map(x=>({...x,category:"BANK_LINK"}))].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  render();
 }catch(error){
  S.loading=false;S.account=null;mobileError(error);render();
 }
}
async function quote(){
 const symbol=S.selected.symbol;
 if(S.quoteLoading)return;
 S.quoteLoading=true;S.quote=null;S.quoteSymbol=symbol;render();
 try{
  const data=await api("/stock-quote?market=US&symbol="+encodeURIComponent(symbol));
  if(data.symbol!==symbol||!Number.isSafeInteger(data.priceCents)||data.priceCents<=0)throw Error("报价校验失败");
  S.quote=data;
 }catch(error){toast("可信报价暂不可用："+error.message)}
 finally{S.quoteLoading=false;render();}
}
async function favorite(symbol,market="US"){
 if(!S.account)return;
 const exists=onlyArray(S.watchlist).some(x=>x.market===market&&x.symbol===symbol);
 const verb=exists?"DELETE":"POST";
 try{
  await api("/watchlist",{method:verb,body:{market,symbol}});
  const data=await api("/watchlist");
  S.watchlist=data.items;render();toast(exists?"已移出自选":"已加入自选");
 }catch(error){toast("自选修改失败："+error.message)}
}
function funding(kind){
 const withdraw=kind==="WITHDRAWAL";
 sheet(withdraw?"申请提现":"申请充值",'<form id="mobileFundingForm" class="stack">'
 +note("申请提交后台人工审核，不代表真实资金到账或提现完成。","info")
 +'<input type="hidden" name="kind" value="'+kind+'">'
 +field("金额（USD）","mobileFundingAmount","text","",'inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required placeholder="例如 100.00"')
 +'<button class="primary" type="submit">提交'+(withdraw?"提现":"充值")+'申请</button></form>');
}
function bank(){
 sheet("登记银行账户",'<form id="mobileBankForm" class="stack">'
 +note("仅登记银行名称和末四位，不收集网银密码、验证码或 CVV。后台人工核验。","info")
 +field("银行名称","mobileBankName","text","",'minlength="2" maxlength="80" required')
 +field("账户号码末四位","mobileBankLast4","text","",'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required')
 +'<button class="primary" type="submit">提交资料审核</button></form>');
}
function kyc(){
 sheet("身份资料审核",'<div class="stack">'+note("为保护个人证件，当前手机端仅创建后台审核工单；如需上传照片，请使用官方受保护资料入口。","info")
 +'<button class="primary" data-action="kyc-request">创建身份审核工单</button></div>');
}
function product(index){
 const item=onlyArray(S.products?.items)[index];if(!item)return;
 const stock=item.itemType==="STOCK";
 const disabled=stock&&!S.stockQuoteConfigured;
 sheet("参与内部产品",'<form class="stack" id="mobileProductForm" data-product-index="'+index+'">'
 +'<h3>'+esc(item.name??item.code)+'</h3><p class="muted">'+esc(item.code||"")+' · '+esc(item.itemType||"内部产品")+'</p>'
 +note("参与前请核对产品条款。股票类产品必须先取得可信报价，购买记录仅在本系统内部生效。","info")
 +field("数量","mobileProductQuantity","number","1",'min="1" max="1000000" step="1" required')
 +field("参与密码","mobileProductPassword","password","",'required autocomplete="off"')
 +(stock?buttonAction("获取可信报价","product-quote","secondary")+'<p class="muted" id="productQuoteInfo">尚未获取报价</p>':"")
 +'<button class="primary" id="mobileProductSubmit" type="submit" '+(disabled?"disabled":"")+'>确认参与</button></form>');
 S.productQuote=null;
}
async function productQuote(){
 const form=$("mobileProductForm");if(!form)return;
 const item=S.products?.items?.[Number(form.dataset.productIndex)];
 if(!item?.code)return;
 const msg=$("productQuoteInfo");msg.textContent="正在获取可信报价…";
 try{
  const q=await api("/stock-quote?market=US&symbol="+encodeURIComponent(item.code));
  if(!Number.isSafeInteger(q.priceCents)||q.priceCents<=0)throw Error("无效报价");
  S.productQuote=q;
  msg.textContent="参考单价 "+amount(q.priceCents)+"；最终以服务端校验为准";
  $("mobileProductSubmit").disabled=false;
 }catch(error){S.productQuote=null;msg.textContent="获取失败："+error.message;$("mobileProductSubmit").disabled=true;}
}
async function postFunding(form){
 const input=$("mobileFundingAmount").value.trim();
 if(!/^\d+(\.\d{1,2})?$/.test(input))throw Error("金额须为最多两位小数");
 const cents=Math.round(Number(input)*100);
 if(!Number.isSafeInteger(cents)||cents<100||cents>100000000)throw Error("金额超出允许范围");
 await api("/requests?category=FUNDING",{method:"POST",body:{kind:form.elements.kind.value,amountCents:cents}});
}
async function onSubmit(e){
 const form=e.target;if(!form?.id||S.submitting)return;
 if(!["mobileFundingForm","mobileBankForm","mobileSupportForm","mobileOrderForm","mobileProductForm"].includes(form.id))return;
 e.preventDefault();S.submitting=true;
 const btn=form.querySelector('button[type="submit"]');if(btn)btn.disabled=true;
 try{
  if(form.id==="mobileFundingForm")await postFunding(form);
  if(form.id==="mobileBankForm")await api("/requests?category=BANK_LINK",{method:"POST",body:{bankLabel:$("mobileBankName").value.trim(),accountLast4:$("mobileBankLast4").value.trim()}});
  if(form.id==="mobileSupportForm"){
   const body=$("mobileSupportText").value.trim();
   if(!body)throw Error("请输入需要发送的消息");
   await api("/support",{method:"POST",body:{message:body}});
  }
  if(form.id==="mobileOrderForm"){
   if(!S.priceAvailable)throw Error("可信成交报价未连接，订单未提交");
   const qty=Number($("mobileQuantity").value);
   if(!Number.isSafeInteger(qty)||qty<=0||qty>1000000)throw Error("数量超出范围");
   await api("/orders",{method:"POST",headers:{"idempotency-key":crypto.randomUUID()},body:{side:$("mobileSide").value,market:S.selected.market,symbol:S.selected.symbol,quantity:qty}});
  }
  if(form.id==="mobileProductForm"){
   const item=S.products?.items?.[Number(form.dataset.productIndex)];
   if(!item)throw Error("产品不存在");
   const qty=Number($("mobileProductQuantity").value);
   if(!Number.isSafeInteger(qty)||qty<=0)throw Error("数量无效");
   const payload={termsId:item.termsId,termsVersion:item.termsVersion,quantity:qty,participationPassword:$("mobileProductPassword").value};
   if(item.itemType==="STOCK"){
    if(!S.productQuote?.priceCents)throw Error("请重新获取可信报价");
    payload.confirmedStockPriceCents=S.productQuote.priceCents;
   }
   await api("/internal-purchases",{method:"POST",headers:{"idempotency-key":crypto.randomUUID()},body:payload});
   $("mobileProductPassword").value="";
  }
  closeSheet();toast("操作已提交，正在同步最新记录");await refresh();
 }catch(error){toast("操作未确认："+error.message);}
 finally{S.submitting=false;if(btn?.isConnected)btn.disabled=false;}
}
async function logout(){
 const current=token;token=null;sessionStorage.removeItem(TOKEN_KEY);
 try{await fetch("/api/auth/logout",{method:"POST",headers:{"authorization":"Bearer "+current,"content-type":"application/json"}})}catch{}
 location.replace(loginUrl());
}
function downloadOrders(){
 const list=orderRows();
 const lines=[["证券","方向","数量","参考总额（美分）","时间","状态","记录编号"],...list.map(x=>[x.name,x.type,x.quantity,x.total,x.date,x.status,x.id])];
 const csv="\ufeff"+lines.map(x=>x.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="cn-capital-mobile-orders.csv";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1200);
}
async function onAction(e){
 const filter=e.target.closest("[data-filter]");
 if(filter){S.filter=filter.dataset.filter;render();return;}
 const tab=e.target.closest("[data-tab]");
 if(tab){S.tab=tab.dataset.tab;render();window.scrollTo(0,0);return;}
 const a=e.target.closest("[data-action]");
 const symbolRow=e.target.closest(".row[data-symbol]");
 if(symbolRow&&!a){
  const selected=supportedStocks().find(x=>x.symbol===symbolRow.dataset.symbol&&x.market===symbolRow.dataset.market);
  if(selected){S.selected=selected;S.quote=null;S.quoteSymbol="";S.tab="market";S.search="";render();window.scrollTo(0,0);}
  return;
 }
 if(!a)return;
 if(S.submitting)return;
 const action=a.dataset.action;
 if(action==="go-trade"){S.tab="trade";render();window.scrollTo(0,0);}
 else if(action==="reload")await refresh();
 else if(action==="quote")await quote();
 else if(action==="favorite")await favorite(a.dataset.symbol,a.dataset.market);
 else if(action==="favorite-selected")await favorite(S.selected.symbol,S.selected.market);
 else if(action==="deposit")funding("DEPOSIT");
 else if(action==="withdraw")funding("WITHDRAWAL");
 else if(action==="bank")bank();
 else if(action==="kyc")kyc();
 else if(action==="product")product(Number(a.dataset.productIndex));
 else if(action==="product-quote")await productQuote();
 else if(action==="desktop"){sessionStorage.setItem("cn_view_mode","desktop");location.assign(location.hostname==="m.nuvexapro.com"?"https://www.nuvexapro.com/?view=desktop":"/");}
 else if(action==="logout")await logout();
 else if(action==="export")downloadOrders();
 else if(action==="kyc-request"){
  S.submitting=true;
  try{await api("/requests?category=KYC",{method:"POST",body:{}});closeSheet();toast("已建立身份资料审核工单");await refresh();}
  catch(error){toast("提交失败："+error.message)}finally{S.submitting=false}
 }

}
$("mobileContent").addEventListener("click",onAction);
$("mobileNav").addEventListener("click",onAction);
$("mobileDialogBody").addEventListener("click",onAction);
$("mobileContent").addEventListener("input",e=>{if(e.target?.id==="mobileSearch"){S.search=e.target.value;const pos=e.target.selectionStart;render();const newInput=$("mobileSearch");if(newInput){newInput.focus();newInput.setSelectionRange(pos,pos)}}});
$("mobileApp").addEventListener("submit",onSubmit);
$("mobileDialogClose").addEventListener("click",closeSheet);
$("mobileSheet").addEventListener("click",e=>{if(e.target===$("mobileSheet"))closeSheet()});
$("mobileRefresh").addEventListener("click",refresh);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("mobileSheet").hidden)closeSheet()});
async function startMobile(){
 if(location.hostname==="m.nuvexapro.com"&&location.hash.startsWith("#handoff=")){
  const handoff=location.hash.slice("#handoff=".length);
  history.replaceState(null,"",location.pathname+location.search);
  sessionStorage.removeItem(TOKEN_KEY);
  token=null;
  try{
   if(!/^[A-Za-z0-9_-]{43}$/.test(handoff)){invalidate();return;}
   const response=await fetch("/api/auth/mobile-session",{method:"POST",cache:"no-store",
    headers:{authorization:"Handoff "+handoff}});
   if(response.ok){
    const session=await response.json();
    if(typeof session.token!=="string")throw Error("Invalid session");
    token=session.token;sessionStorage.setItem(TOKEN_KEY,token);
   }else if(response.status!==401)throw Error("Mobile sign-in unavailable");
  }catch(error){
   mobileError(error);
   $("mobileScreen").replaceChildren();
   const link=document.createElement("a");link.href=loginUrl();link.textContent="返回登录";
   $("mobileScreen").append(link);return;
  }
 }
 if(!token)invalidate();else await refresh();
}
void startMobile();
