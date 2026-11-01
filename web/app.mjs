const MARKETS=["US","HK","CN","MY"];
let token=sessionStorage.getItem("gsp_token");
let account={cashCents:0,positions:{},orders:[]};
const instruments=[
 {market:"US",symbol:"AAPL",name:"Apple Inc."},{market:"US",symbol:"MSFT",name:"Microsoft"},
 {market:"HK",symbol:"0700",name:"Tencent Holdings"},{market:"HK",symbol:"9988",name:"Alibaba Group"},
 {market:"CN",symbol:"600519",name:"贵州茅台"},{market:"CN",symbol:"000001",name:"平安银行"},
 {market:"MY",symbol:"1155",name:"Maybank"},{market:"MY",symbol:"1023",name:"CIMB Group"}
];
let market="US",selected=instruments[0];
const el=id=>document.getElementById(id);
const money=n=>(n/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function render(){
 el("markets").replaceChildren(...MARKETS.map(m=>{const b=document.createElement("button");b.className="market"+(market===m?" active":"");b.textContent=m;b.onclick=()=>{market=m;selected=instruments.find(i=>i.market===m);render()};return b}));
 const q=el("search").value.trim().toLowerCase();
 el("symbols").replaceChildren(...instruments.filter(i=>i.market===market&&(i.symbol.toLowerCase().includes(q)||i.name.toLowerCase().includes(q))).map(i=>{const b=document.createElement("button");b.className="symbol"+(selected.symbol===i.symbol?" active":"");b.textContent=i.symbol;const s=document.createElement("small");s.textContent=i.name;b.append(s);b.onclick=()=>{selected=i;render()};return b}));
 el("marketLabel").textContent=selected.market+" MARKET";el("symbolTitle").textContent=selected.symbol;el("symbolName").textContent=selected.name;el("quotePrice").textContent="—";el("cash").textContent=token?money(account.cashCents):"—";
 const p=Object.entries(account.positions).filter(([,v])=>v>0);el("positions").replaceChildren(...(p.length?p.map(([k,v])=>{const d=document.createElement("div");d.textContent=k+" · "+v+" 股";return d}):[document.createTextNode("暂无持仓")]));
 el("orders").replaceChildren(...(account.orders.length?[...account.orders].reverse().map(o=>{const d=document.createElement("div");d.textContent=o.market+" "+o.symbol+" · "+(o.side==="BUY"?"买入":"卖出")+" "+o.quantity+" 股 · 内部记录";return d}):[document.createTextNode("暂无订单")]));
 el("orderForm").querySelector("button[type=submit]").disabled=!token;
}
el("search").addEventListener("input",render);
async function request(path,options={}){
 const response=await fetch("/api"+path,{...options,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{}),...(options.headers||{})}});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||"Request failed");
 return result;
}
async function refreshAccount(){
 if(!token)return;
 try{
  const snapshot=await request("/account");
  account={cashCents:snapshot.account.cashCents,positions:Object.fromEntries(snapshot.positions.map(p=>[p.market+":"+p.symbol,Number(p.quantity)])),orders:snapshot.orders.map(o=>({...o,execution:"INTERNAL_ONLY"}))};
  render();
 }catch(error){el("feedback").textContent="账户同步失败："+error.message;}
}
el("orderForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!token){el("feedback").textContent="请先登录账户";return;}
 const button=el("orderForm").querySelector("button[type=submit]");
 button.disabled=true;
 try{
  await request("/orders",{method:"POST",headers:{"idempotency-key":crypto.randomUUID()},body:JSON.stringify({side:el("side").value,market:selected.market,symbol:selected.symbol,quantity:Number(el("quantity").value)})});
  el("feedback").textContent="内部订单已由服务器记录";
  await refreshAccount();
 }catch(error){el("feedback").textContent="订单未执行："+error.message;}
 finally{button.disabled=false;}
});
el("authForm").addEventListener("submit",async event=>{
 event.preventDefault();
 try{
  const email=el("email").value,password=el("password").value;
  if(event.submitter?.value==="register")await request("/auth/register",{method:"POST",body:JSON.stringify({email,password})});
  const session=await request("/auth/login",{method:"POST",body:JSON.stringify({email,password})});
  token=session.token;sessionStorage.setItem("gsp_token",token);
  el("password").value="";
  el("authFeedback").textContent="已登录";
  await refreshAccount();
 }catch(error){el("authFeedback").textContent=error.message;}
});
el("logout").addEventListener("click",async()=>{
 try{if(token)await request("/auth/logout",{method:"POST"});}catch(error){el("authFeedback").textContent=error.message;return;}
 token=null;sessionStorage.removeItem("gsp_token");
 account={cashCents:0,positions:{},orders:[]};render();
 el("authFeedback").textContent="已退出";
});
render();
refreshAccount();
