export class ApiError extends Error {
  constructor(message,status=0){super(message);this.status=status;}
}
export function createApi(fetcher=globalThis.fetch){
  let token=null,scope=null;
  const journal=()=>scope?'cn.pending.'+scope:null;
  async function durableKey(path,body,key){
    if(!key||!scope||!['/api/orders','/api/bulk-orders','/api/fund-subscriptions','/api/product-settlement','/api/requests','/api/support'].includes(path))return {key};
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(x=>x.toString(16).padStart(2,'0')).join('');
    let record;try{record=JSON.parse(sessionStorage.getItem(journal())||'null')}catch{throw new ApiError('无法读取未决订单记录，请先核对订单，暂停重复提交');}
    if(record&&(record.path!==path||record.digest!==digest)){
      const status=await request('/api/order-results?key='+encodeURIComponent(record.key));
      if(status.found){await clearJournal();record=null;throw new ApiError('上一笔订单已确认，请查看订单记录；核对后可重新提交当前订单');}
      throw new ApiError('存在结果尚未确认的订单，请先按原条件重试并核对记录，再提交新订单');
    }
    record=record||{path,digest,key};
    try{if(globalThis.CN_MIRROR_STORE_PENDING)await globalThis.CN_MIRROR_STORE_PENDING(record);sessionStorage.setItem(journal(),JSON.stringify(record))}catch{throw new ApiError('无法保存订单恢复记录，暂不提交订单');}
    return {key:record.key,durable:true};
  }
  async function clearJournal(){if(globalThis.CN_MIRROR_STORE_PENDING)await globalThis.CN_MIRROR_STORE_PENDING(null);sessionStorage.removeItem(journal());}
  async function request(path,{method='GET',body,signal,key,anonymous=false}={}){
    if(!path.startsWith('/api/'))throw new ApiError('接口路径无效');
    const headers={'Accept':'application/json'};
    if(token&&!anonymous)headers.Authorization='Bearer '+token;
    if(body!==undefined)headers['Content-Type']='application/json';
    const pending=await durableKey(path,body,key);
    if(pending.key)headers['Idempotency-Key']=pending.key;
    const response=await fetcher(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',signal:signal||AbortSignal.timeout(20000)});
    if(response.status===204)return null;
    let data;try{data=await response.json()}catch{throw new ApiError('接口响应格式无效',response.status)}
    if(!response.ok){if(pending.durable&&response.status>=400&&response.status<500&&![401,408,429].includes(response.status))await clearJournal();throw new ApiError(data.error||'请求失败',response.status);}
    if(pending.durable)await clearJournal();
    return data;
  }
  return {
    request,
    adoptMirror(email){if(globalThis.parent===globalThis)throw new ApiError('镜像仅可在后台窗口内初始化');token='delegated';scope='mirror:'+email.trim().toLowerCase();},
    async login(email,password){const result=await request('/api/auth/login',{method:'POST',body:{email,password,remember:false},anonymous:true});if(typeof result.token!=='string'||!result.token)throw new ApiError('登录响应缺少会话');token=result.token;scope=email.trim().toLowerCase();return result;},
    clear(){token=null;},
    async logout(){try{if(token)await request('/api/auth/logout',{method:'POST'})}finally{token=null;}},
    leave(){if(token){fetcher('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token,'X-CN-Session-Close':'background'},keepalive:true,credentials:'omit'}).catch(()=>{});token=null;}},
    account:()=>request('/api/account'),catalog:()=>request('/api/catalog'),watchlist:()=>request('/api/watchlist'),announcements:()=>request('/api/announcements'),
    watch:(item,add)=>request('/api/watchlist',{method:add?'POST':'DELETE',body:{market:item.market,symbol:item.symbol}})
  };
}
export function integerCents(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  return typeof value === 'string' && /^-?\d{1,40}$/.test(value) ? BigInt(value) : null;
}
function decimalCents(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^-?\d{1,40}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return text.startsWith('-') ? -cents : cents;
}
function centsDecimal(value) {
  const absolute = value < 0n ? -value : value;
  return (value < 0n ? '-' : '') + (absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0');
}
export function formatMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
  const cents = decimalCents(value);
  return cents === null ? '—' : centsDecimal(cents).replace(/\B(?=(\d{3})+\.)/g, ',');
}
export function cents(value) {
  const n = integerCents(value);
  if (n === null) return null;
  const exact = centsDecimal(n);
  return n > -1000000000000000n && n < 1000000000000000n ? Number(exact) : exact;
}
export function amount(value) {
  return decimalCents(value) === null ? null : value;
}
export function quote(item){return cents(item?.lastPriceCents);}
export function instrumentKey(item){return item.market+':'+item.symbol;}

