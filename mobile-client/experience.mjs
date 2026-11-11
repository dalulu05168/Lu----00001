const memoryReadMarkers=new Map();
export const notificationStorage={getItem(key){try{return globalThis.localStorage.getItem(key);}catch{return memoryReadMarkers.get(key)||null;}},setItem(key,value){try{globalThis.localStorage.setItem(key,value);}catch{memoryReadMarkers.set(key,value);}}};
export function readIds(storage,scope){try{const ids=JSON.parse(storage.getItem('cn.notify.read.'+scope)||'[]');return new Set(Array.isArray(ids)?ids:[]);}catch{return new Set();}}
export function notificationTarget(item){return ({SUPPORT:'support',DOCUMENT:'documents',CASH:'requests'})[item.category]||(item.kind==='IPO'?'ipo':'fund-records');}
export function notificationTitle(item){
 if(item.category==='SUPPORT')return '客服回复';
 const kind=({IDENTITY:'身份认证',BANK:'银行卡',DEPOSIT:'充值申请',WITHDRAW:'提现申请',IPO:'IPO申购',TERM_FUND:'基金合约'})[item.kind];
 const title=kind||({DOCUMENT:'资料审核',CASH:'资金申请',PRODUCT:'产品消息'})[item.category]||'账户消息';
 const status=({PENDING:'待审核',APPROVED:'审核通过',REJECTED:'审核未通过',ACTIVE:'持有中',MATURED:'已到期',PAID:'已完成',SETTLED:'已结算',CANCELLED:'已取消',SUCCEEDED:'已完成',SUCCESS:'已完成'})[item.status];
 return title+(status?' · '+status:'');
}
export function verifiedName(items){return items.find(x=>x.kind==='IDENTITY'&&x.status==='APPROVED'&&typeof x.verifiedName==='string')?.verifiedName.trim()||'';}
export function chartSymbol(item){
 if(!item||!/^[A-Z0-9.-]{1,24}$/.test(item.symbol||''))return null;
 const known={AAPL:'NASDAQ:AAPL',MSFT:'NASDAQ:MSFT',NVDA:'NASDAQ:NVDA',SPY:'AMEX:SPY',QQQ:'NASDAQ:QQQ',IWM:'AMEX:IWM',DIA:'AMEX:DIA'};
 if(item.market==='US')return known[item.symbol]||item.symbol;
 if(item.market==='CN'&&/^\d{6}$/.test(item.symbol))return (/^6/.test(item.symbol)?'SSE:':/^[489]/.test(item.symbol)?'BSE:':'SZSE:')+item.symbol;
 if(item.market==='HK'&&/^\d{1,5}$/.test(item.symbol))return 'HKEX:'+String(Number(item.symbol));
 if(item.market==='MY'&&/^\d{4}$/.test(item.symbol))return 'MYX:'+item.symbol;
 return null;
}
export function mountChart(target,item){
 if(!target)return;const symbol=chartSymbol(item);
 if(!symbol){target.textContent='暂不支持此市场图表映射。未使用其他股票曲线替代。';return;}
 const frame=document.createElement('iframe');frame.title='TradingView '+item.symbol+' 历史行情';frame.className='real-chart';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups');
 const config={symbol,autosize:true,interval:'D',style:'1',locale:'zh_CN',theme:'light',allow_symbol_change:false,hide_side_toolbar:true,hide_top_toolbar:false,calendar:false,support_host:'https://www.tradingview.com'};
 frame.srcdoc='<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;font:12px system-ui}.tradingview-widget-container{height:100%;width:100%}.tradingview-widget-container__widget{height:calc(100% - 28px)}a{color:#56788e}</style><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView 提供图表</a><script async src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js">'+JSON.stringify(config).replace(/</g,'\\u003c')+'</script></div></html>';
 target.replaceChildren(frame);target.dataset.chartSymbol=symbol;
}
export function createExperience({api,state,business,render,reset,onRestore,onBackground=async()=>{},storage=notificationStorage,intervalMs=15000}){
 let timer=null,polling=false,activeEpoch=-1,lastRoute='',historyReady=false,restoring=false,failed=0,historyAllowed=true;
 const localTrail=[];
 const snapshot=()=>({page:state.page,selected:state.selected,market:state.market,query:state.query,subtab:state.subtab,business:business.navigationSnapshot()});
 function badge(){const button=document.querySelector('[data-business="notifications"].notification');if(!button)return;const read=readIds(storage,state.notificationScope),unread=state.notifications.filter(x=>!read.has(x.id)).length;button.setAttribute('aria-label',`账户消息${unread?'，'+unread+'条未读':''}`);button.querySelector('.unread-dot')?.remove();if(unread){const dot=document.createElement('i');dot.className='unread-dot';dot.setAttribute('aria-hidden','true');button.append(dot);}button.title=state.notificationError?'通知暂不可用，稍后重试':'账户消息';}
 async function poll(){if(polling||!state.authenticated||document.hidden)return;clearTimeout(timer);polling=true;const epoch=state.epoch;
  try{const result=await api.request('/api/notifications');if(epoch!==state.epoch)return;state.notifications=Array.isArray(result.items)?result.items:[];state.notificationScope=result.scope||'';state.notificationError='';failed=0;business.setNotifications(result);badge();if(state.page==='notifications'&&!state.busy)render();}
  catch(error){if(epoch===state.epoch){if(error.status===401)reset('会话已过期，请重新登录。');else{failed++;state.notificationError='通知暂不可用';badge();}}}
  finally{try{if(state.authenticated&&!document.hidden&&epoch===state.epoch)await onBackground();}catch{}polling=false;if(state.authenticated&&epoch===state.epoch){clearTimeout(timer);timer=setTimeout(poll,Math.min(intervalMs*2**Math.min(failed,3),120000));}}
 }
 function sync(){
  if(!state.authenticated){clearTimeout(timer);timer=null;activeEpoch=-1;lastRoute='';historyReady=false;localTrail.length=0;return;}
  if(activeEpoch!==state.epoch){activeEpoch=state.epoch;queueMicrotask(poll);}
  badge();
  const key=state.page+':'+(state.selected?.market||'')+':'+(state.selected?.symbol||'')+':'+(business.navigationSnapshot()?.selected?.id||'');
  if(!historyReady){try{history.replaceState({nuvexa:true,...snapshot()},'');}catch{historyAllowed=false;}localTrail.push(snapshot());historyReady=true;lastRoute=key;}
  else if(key!==lastRoute){if(!restoring){try{if(historyAllowed)history.pushState({nuvexa:true,...snapshot()},'');}catch{historyAllowed=false;}localTrail.push(snapshot());}lastRoute=key;document.querySelector('main.content')?.classList.add('page-enter');}
  if(state.page==='detail')mountChart(document.getElementById('tradingview-chart'),state.selected);
 }
 function haptic(){if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches&&typeof navigator.vibrate==='function'){try{navigator.vibrate(8);}catch{}}}
 async function pop(event){if(!state.authenticated)return;if(!event.state?.nuvexa)return;if(state.busy){history.pushState({nuvexa:true,...snapshot()},'');return;}restoring=true;Object.assign(state,{page:event.state.page,selected:event.state.selected,market:event.state.market||'ALL',query:event.state.query||'',subtab:event.state.subtab||'positions',error:''});business.restoreNavigation(event.state.business);render();window.scrollTo(0,0);restoring=false;await onRestore(state.page);}
 function back(){if(historyAllowed&&historyReady&&history.state?.nuvexa&&state.page!=='home')history.back();else if(localTrail.length>1){localTrail.pop();pop({state:{nuvexa:true,...localTrail.at(-1)}});}else{state.page='home';render();}}
 window.addEventListener('focus',()=>{if(!document.hidden&&state.authenticated)poll();});window.addEventListener('online',()=>{if(!document.hidden&&state.authenticated)poll();});window.addEventListener('popstate',pop);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.authenticated)poll();});
 return {sync,badge,poll,haptic,back,stop(){clearTimeout(timer);timer=null;}};
}

export function backgroundRefreshSafe(state,doc=globalThis.document){
 if(!state.authenticated||state.busy||state.loading||doc.hidden)return false;
 const focused=doc.activeElement;
 if(focused&&(/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)||focused.isContentEditable))return false;
 for(const field of doc.querySelectorAll('form input,form textarea,form select')){
  if(field.type==='file'&&field.files?.length)return false;
  if(field.type!=='hidden'&&String(field.value||'').trim())return false;
 }
 return !['fund-confirm','bulk-order','ipo-detail','identity','bank','pin','funding'].includes(state.page);
}
