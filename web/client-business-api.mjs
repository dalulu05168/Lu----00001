// Client-only adapter for existing authenticated platform HTTP endpoints.
// No prices, balances, fills, or P/L are synthesized in this module.
const MARKETS = new Set(['US', 'CN']);
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const MAX_QUOTE_AGE_MS = 60_000;
const HISTORY_INTERVALS = new Set(['1min','5min','15min','1day','1week','1month']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, status, cause) {
  return Object.assign(new Error(message), {code, ...(status === undefined ? {} : {status}), ...(cause === undefined ? {} : {cause})});
}
function integer(value, min = 0) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  // Database bigint values may arrive as decimal strings. Reject JS coercions
  // such as 1e3, 0x10 or whitespace rather than silently altering quantities.
  if (typeof value === 'string' && !/^-?(?:0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min ? number : null;
}
function identity(item) {
  if (!item || typeof item !== 'object' || !MARKETS.has(item.market) ||
      typeof item.symbol !== 'string' || !SYMBOL.test(item.symbol)) {
    throw failure('INVALID_INSTRUMENT', '证券代码或市场无效');
  }
  return {market:item.market, symbol:item.symbol};
}
function nonEmptyId(value) { return typeof value === 'string' && value.length > 0; }
function historicalIdentity(item) {
  if (item?.market === 'RO' && typeof item.symbol === 'string' && SYMBOL.test(item.symbol))
    return {market:'RO',symbol:item.symbol,legacyReadOnly:true};
  return identity(item);
}
function transactionKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || !/^[\x21-\x7E]+$/.test(value)) {
    throw failure('INVALID_IDEMPOTENCY_KEY', '缺少有效的交易请求标识');
  }
  return value;
}
function shape(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw failure('INVALID_RESPONSE', label + '响应格式不正确');
  }
  return value;
}

export function normalizeAccountSnapshot(payload) {
  shape(payload, '账户');
  const account = shape(payload.account, '账户');
  const cashCents = integer(account.cashCents);
  if (!nonEmptyId(account.id) || cashCents === null || account.currency !== 'USD') {
    throw failure('INVALID_RESPONSE', '账户余额未能确认');
  }
  if (!Array.isArray(payload.positions) || !Array.isArray(payload.orders)) {
    throw failure('INVALID_RESPONSE', '持仓或订单数据未能确认');
  }
  const positionsSeen = new Set();
  const positions = payload.positions.map(item => {
    const ref = historicalIdentity(item);
    const quantity = integer(item.quantity, 1);
    if (quantity === null) throw failure('INVALID_RESPONSE', '持仓数量无效');
    const key = ref.market + ':' + ref.symbol;
    if (positionsSeen.has(key)) throw failure('INVALID_RESPONSE', '持仓记录重复');
    positionsSeen.add(key);
    return {...ref, quantity};
  });
  const orderIds = new Set();
  const orders = payload.orders.map(item => {
    const ref = historicalIdentity(item);
    const quantity = integer(item.quantity, 1);
    const priceCents = integer(item.price_cents, 1);
    const amountUsdCents = integer(item.amount_usd_cents, 1);
    if (!nonEmptyId(item.id) || !['BUY','SELL'].includes(item.side) ||
        quantity === null || priceCents === null || amountUsdCents === null ||
        !Number.isFinite(Date.parse(item.created_at))) {
      throw failure('INVALID_RESPONSE', '订单记录无效');
    }
    if (orderIds.has(item.id)) throw failure('INVALID_RESPONSE', '订单记录重复');
    orderIds.add(item.id);
    return {id:item.id, ...ref, side:item.side, quantity, priceCents, amountUsdCents,
      createdAt:new Date(item.created_at).toISOString()};
  });
  return {account:{id:account.id, cashCents, currency:account.currency}, positions, orders};
}

export function normalizeAnalytics(payload) {
  const data = shape(payload, '盈亏');
  if (data.currency !== 'USD' || data.method !== 'FIFO' || data.basis !== 'INTERNAL_GROSS' ||
      typeof data.historyAvailable !== 'boolean') {
    throw failure('INVALID_RESPONSE', '盈亏口径未能确认');
  }
  const fields = ['orderCount','holdingCount','buyVolumeCents','sellVolumeCents','volumeCents',
    'realizedPnlCents','dayRealizedPnlCents','monthRealizedPnlCents','positionCostCents','portfolioValueCents'];
  const result = {currency:'USD', method:'FIFO', basis:'INTERNAL_GROSS', historyAvailable:data.historyAvailable,
    asOf:typeof data.asOf === 'string' && Number.isFinite(Date.parse(data.asOf)) ? data.asOf : null,
    reason:typeof data.reason === 'string' ? data.reason : null};
  for (const field of fields) {
    const value = data[field];
    // null means unknown; never coerce it to zero.
    if (value == null) { result[field] = null; continue; }
    const parsed = integer(value, field.toLowerCase().includes('pnl') ? Number.MIN_SAFE_INTEGER : 0);
    if (parsed === null) throw failure('INVALID_RESPONSE', '盈亏字段无效：' + field);
    result[field] = parsed;
  }
  if (!data.historyAvailable) {
    for (const field of ['realizedPnlCents','dayRealizedPnlCents','monthRealizedPnlCents','positionCostCents']) result[field] = null;
  }
  return result;
}

/**
 * Display-eligible quote contract. A vendor's raw `entitled:true`, token,
 * `entitlement` description, or HTTP 200 is NOT a reviewed license grant.
 * The same-origin API must attach displayPermission only after verifying its
 * server-owned grant for this market/source/currency and current time.
 */
export function normalizeVerifiedQuote(payload, expected, {nowMs = Date.now(), maxAgeMs = MAX_QUOTE_AGE_MS} = {}) {
  const ref = identity(expected);
  const quote = shape(payload, '行情');
  const currency = ref.market === 'CN' ? 'CNY' : 'USD';
  const cents = quote.priceCents == null ? null : integer(quote.priceCents, 1);
  const priceMicros = quote.priceMicros == null ?
    (cents === null || !Number.isSafeInteger(cents * 10_000) ? null : cents * 10_000) :
    integer(quote.priceMicros, 1);
  const timestampMs = quote.timestampMs;
  if (quote.market !== ref.market || quote.symbol !== ref.symbol || priceMicros === null ||
      (quote.priceCents != null && (cents === null || priceMicros !== cents * 10_000)) ||
      quote.currency !== currency || !nonEmptyId(quote.source) ||
      !Number.isSafeInteger(timestampMs) || !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > MAX_QUOTE_AGE_MS ||
      timestampMs > nowMs + 5_000 || nowMs - timestampMs > maxAgeMs ||
      quote.stale !== false || quote.status !== 'FRESH') {
    throw failure('QUOTE_UNAVAILABLE', '当前行情不可用，请刷新后重试', 503);
  }
  const permission = quote.displayPermission;
  if (permission?.customerDisplayAllowed !== true || permission?.market !== ref.market ||
      permission?.source !== quote.source || permission?.currency !== currency ||
      !Number.isSafeInteger(permission?.validUntilMs) || permission.validUntilMs < nowMs) {
    throw failure('QUOTE_NOT_ENTITLED', '当前行情不可用，请刷新后重试', 503);
  }
  // `priceCents === null` for a true sub-cent quote; never round a display
  // quote to fit the existing internal-order cents ledger.
  const result={...ref,currency,source:quote.source,timestampMs,priceMicros,
    priceCents:priceMicros%10_000===0?priceMicros/10_000:null,price:priceMicros/1_000_000,
    stale:false};
  if(quote.name!==undefined){
    if(typeof quote.name!=='string'||!quote.name.trim()||quote.name.length>180)
      throw failure('INVALID_RESPONSE','证券名称不可用');
    result.name=quote.name.trim();
  }
  if(quote.mic!==undefined){
    if(typeof quote.mic!=='string'||!/^[A-Z0-9]{4}$/.test(quote.mic))
      throw failure('INVALID_RESPONSE','交易所信息不可用');
    result.mic=quote.mic;
  }
  if(quote.price!==undefined&&(!Number.isFinite(quote.price)||
      Math.abs(quote.price-result.price)>1e-8))
    throw failure('INVALID_RESPONSE','行情数值不一致');
  for(const field of ['previousClose','change','percentChange']){
    if(quote[field]!==undefined){
      if(quote[field]!==null&&!Number.isFinite(quote[field]))
        throw failure('INVALID_RESPONSE','行情字段不可用');
      result[field]=quote[field];
    }
  }
  return result;
}


/** Only a published server catalog can supply instrument names and item types.
 * If QA still advertises US/RO, do not silently pretend it is US/CN-ready.
 * The catalog does NOT convey a trade-execution price or order eligibility.
 */
export function normalizePublishedCatalog(payload) {
  const data = shape(payload, '证券目录');
  if (!Array.isArray(data.items)) throw failure('INVALID_RESPONSE', '证券目录响应缺少列表');
  const seen = new Set();
  return data.items.map(item => {
    const ref = identity(item);
    if (!['STOCK','FUND','IPO'].includes(item.itemType) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 180) {
      throw failure('INVALID_RESPONSE', '证券目录名称或类型无效');
    }
    const key = ref.market + ':' + ref.symbol;
    if (seen.has(key)) throw failure('INVALID_RESPONSE', '证券目录包含重复代码');
    seen.add(key);
    return {...ref, name:item.name.trim(),itemType:item.itemType,
      orderEligible:false}; // Listing alone never authorizes a BUY or SELL.
  });
}

export function normalizeClientWatchlist(payload) {
  const data = shape(payload, '自选');
  if (!Array.isArray(data.items)) throw failure('INVALID_RESPONSE', '自选列表响应缺少列表');
  const seen = new Set();
  return data.items.map(item => {
    const ref = identity(item);
    const key = ref.market + ':' + ref.symbol;
    if (seen.has(key)) throw failure('INVALID_RESPONSE', '自选列表包含重复代码');
    seen.add(key);
    return ref;
  });
}


// Exactly the same stock history contract is used by both customer terminals.
// Data remains exchange-local OHLCV, never browser-generated candles.
export function normalizeMarketHistory(payload,expected,{interval='1day',outputsize=90,nowMs=Date.now()}={}){
  const ref=identity(expected), data=shape(payload,'历史行情');
  const currency=ref.market==='CN'?'CNY':'USD';
  const timezone=interval.includes('min')?(ref.market==='CN'?'Asia/Shanghai':'America/New_York'):'EXCHANGE_LOCAL_DATE';
  const permission=data.displayPermission;
  if(!HISTORY_INTERVALS.has(interval)||!Number.isSafeInteger(outputsize)||outputsize<1||outputsize>500||
     data.status!=='HISTORICAL'||data.market!==ref.market||data.symbol!==ref.symbol||
     data.currency!==currency||data.interval!==interval||data.timezone!==timezone||
     !nonEmptyId(data.source)||!Array.isArray(data.values)||data.values.length<1||
     data.values.length>outputsize||!nonEmptyId(data.name)||data.name.length>180||
     permission?.customerDisplayAllowed!==true||permission.market!==ref.market||
     permission.currency!==currency||permission.source!==data.source||
     !Number.isSafeInteger(permission.validUntilMs)||permission.validUntilMs<nowMs)
    throw failure('HISTORY_UNAVAILABLE','历史行情不可用',503);
  const intraday=interval.includes('min');let previous='';
  const values=data.values.map(row=>{
    const t=row?.datetime;
    if(typeof t!=='string'||!(intraday?/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/).test(t)||
       t<=previous)throw failure('HISTORY_UNAVAILABLE','历史时间无效',503);
    const date=t.slice(0,10),ms=Date.parse(date+'T00:00:00Z');
    if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date||
       ms>nowMs+86_400_000||(intraday&&(Number(t.slice(11,13))>23||
         Number(t.slice(14,16))>59||Number(t.slice(17,19))>59))||
       !['open','high','low','close'].every(k=>Number.isFinite(row[k])&&row[k]>0)||
       row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close)||
       integer(row.volume)===null)
      throw failure('HISTORY_UNAVAILABLE','历史 OHLCV 无效',503);
    previous=t;
    return {datetime:t,open:row.open,high:row.high,low:row.low,close:row.close,volume:integer(row.volume)};
  });
  return {...ref,name:data.name.trim(),currency,source:data.source,interval,timezone,values};
}

// One REPEATABLE READ backend snapshot, not two unrelated client GETs.
export function normalizeConsistentPortfolio(payload,{nowMs=Date.now()}={}){
  const data=shape(payload,'资产快照');
  const account=normalizeAccountSnapshot(data.accountSnapshot);
  const analytics=normalizeAnalytics(data.analytics);
  const val=shape(data.valuation,'估值');
  if(typeof data.snapshotAt!=='string'||analytics.asOf!==data.snapshotAt||
     val.currency!=='USD'||val.method!=='FIFO'||typeof val.valuationAvailable!=='boolean'||
     !Array.isArray(val.quotes)||
     (analytics.holdingCount!==null&&analytics.holdingCount!==account.positions.length))
    throw failure('INVALID_RESPONSE','资产快照不一致');
  const realized=analytics.historyAvailable?analytics.realizedPnlCents:null;
  if(!val.valuationAvailable)return {account,analytics,snapshotAt:data.snapshotAt,
    valuation:{valuationAvailable:false,realizedPnlCents:realized,unrealizedPnlCents:null,
      marketValueCents:null,portfolioValueCents:null,
      reason:typeof val.reason==='string'?val.reason:'VALUATION_UNAVAILABLE',quotes:[]}};
  if(!analytics.historyAvailable||realized===null||val.realizedPnlCents!==realized||
     val.quotes.length!==account.positions.length||
     !Number.isSafeInteger(val.marketValueCents)||val.marketValueCents<0||
     !Number.isSafeInteger(val.portfolioValueCents)||val.portfolioValueCents<0||
     !Number.isSafeInteger(val.unrealizedPnlCents)||analytics.positionCostCents===null)
    throw failure('INVALID_RESPONSE','盈亏数据未能核对');
  let sum=0n;const seen=new Set();
  const quotes=val.quotes.map(q=>{
    const ref=identity(q),key=ref.market+':'+ref.symbol;
    const held=account.positions.find(x=>x.market===ref.market&&x.symbol===ref.symbol);
    if(!held||seen.has(key)||held.quantity!==integer(q.quantity,1)||
       integer(q.priceCents,1)===null||integer(q.marketValueCents)===null||
       q.currency!==(q.market==='CN'?'CNY':'USD')||!nonEmptyId(q.source)||
       !Number.isSafeInteger(q.quoteTimestampMs)||q.quoteTimestampMs>nowMs+5000||
       nowMs-q.quoteTimestampMs>MAX_QUOTE_AGE_MS)
      throw failure('INVALID_RESPONSE','持仓报价记录无效');
    seen.add(key);sum+=BigInt(q.marketValueCents);
    return {...ref,quantity:held.quantity,priceCents:integer(q.priceCents,1),
      marketValueCents:integer(q.marketValueCents),currency:q.currency,
      source:q.source,quoteTimestampMs:q.quoteTimestampMs};
  });
  if(sum>BigInt(Number.MAX_SAFE_INTEGER)||Number(sum)!==val.marketValueCents||
     BigInt(val.portfolioValueCents)!==BigInt(account.account.cashCents)+sum||
     BigInt(val.unrealizedPnlCents)!==sum-BigInt(analytics.positionCostCents))
    throw failure('INVALID_RESPONSE','资产市值与 FIFO 成本不一致');
  return {account,analytics,snapshotAt:data.snapshotAt,
    valuation:{valuationAvailable:true,realizedPnlCents:realized,
      unrealizedPnlCents:val.unrealizedPnlCents,marketValueCents:val.marketValueCents,
      portfolioValueCents:val.portfolioValueCents,quotes,reason:null}};
}

export function normalizeExecutedOrder(payload,expected){
  const data=shape(payload,'订单');const ref=identity(expected);
  if(!data.order||!data.receipt||!data.quote)
    throw failure('ORDER_UNVERIFIED','缺少服务端成交凭证',503);
  const o=shape(data.order,'订单'),r=shape(data.receipt,'成交凭证'),q=shape(data.quote,'报价');
  const price=integer(o.priceCents,1),fx=integer(o.fxUsdMicros,1),amount=integer(o.amountCents,1);
  if(typeof data.replayed!=='boolean'||!nonEmptyId(o.id)||o.execution!=='INTERNAL_ONLY'||
     o.market!==ref.market||o.symbol!==ref.symbol||o.side!==expected.side||
     integer(o.quantity,1)!==integer(expected.quantity,1)||price===null||fx===null||amount===null||
     r.id!==o.id||r.market!==o.market||r.symbol!==o.symbol||r.side!==o.side||
     integer(r.quantity,1)!==integer(o.quantity,1)||r.execution!=='INTERNAL_ONLY'||
     integer(r.unitPriceCents,1)!==price||integer(r.fxUsdMicros,1)!==fx||
     integer(r.amountUsdCents,1)!==amount||
     integer(r.cashDeltaCents,Number.MIN_SAFE_INTEGER)!==(o.side==='BUY'?-amount:amount)||
     !nonEmptyId(r.quoteSource)||!Number.isSafeInteger(r.quoteTimestampMs)||
     q.source!==r.quoteSource||q.timestampMs!==r.quoteTimestampMs||
     q.priceCents!==price||q.currency!==r.quoteCurrency||
     q.currency!==(ref.market==='CN'?'CNY':'USD'))
    throw failure('ORDER_UNVERIFIED','成交与审计记录不一致',503);
  return {order:{id:o.id,side:o.side,...ref,quantity:integer(o.quantity,1),
    priceCents:price,fxUsdMicros:fx,amountCents:amount,execution:'INTERNAL_ONLY'},
    receipt:r,quote:q,replayed:data.replayed};
}

export function normalizeInternalProducts(payload){
  const data=shape(payload,'理财产品');
  if(!Array.isArray(data.items))throw failure('INVALID_RESPONSE','理财产品列表不可用');
  const ids=new Set();
  return data.items.map(row=>{
    if(!nonEmptyId(row?.termsId)||!nonEmptyId(row.name)||!nonEmptyId(row.code)||
       !['STOCK','FUND','COMMODITY'].includes(row.itemType)||
       typeof row.tradingEnabled!=='boolean'||!Number.isSafeInteger(row.termsVersion)||
       ids.has(row.termsId))throw failure('INVALID_RESPONSE','理财产品资料不完整');
    ids.add(row.termsId);return {...row};
  });
}

export function normalizeInternalPurchaseAccount(payload){
  const data=shape(payload,'理财持仓');
  if(data.execution!=='INTERNAL_ONLY'||!['positions','purchases','settlements','sales'].every(k=>Array.isArray(data[k])))
    throw failure('INVALID_RESPONSE','理财持仓不可用');
  return {execution:'INTERNAL_ONLY',positions:data.positions,purchases:data.purchases,
    settlements:data.settlements,sales:data.sales};
}

export function createClientBusinessApi({getToken, fetchImpl = fetch,
  capabilities = {}, now = Date.now} = {}) {
  if (typeof getToken !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('Missing client API dependencies');
  // Must be enabled explicitly after QA/server permission verification; defaults are read-only.
  const allowed = Object.freeze({trading:capabilities.trading === true,
    supportWrites:capabilities.supportWrites === true, requestWrites:capabilities.requestWrites === true,
    watchlistWrites:capabilities.watchlistWrites === true,
    privateDataWrites:capabilities.privateDataWrites === true,
    productWrites:capabilities.productWrites === true});
  function assertSameSession(token, message='登录账户已切换，请重新加载') {
    if (getToken() !== token) throw failure('SESSION_CHANGED', message, 401);
  }
  async function call(path,{method='GET', body, key}={}) {
    const token = getToken();
    if (typeof token !== 'string' || !token) throw failure('AUTH_REQUIRED', '请先登录', 401);
    const headers = {authorization:'Bearer ' + token, accept:'application/json'};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key !== undefined) headers['idempotency-key'] = transactionKey(key);
    let response;
    try {
      response = await fetchImpl('/api' + path, {method, headers, cache:'no-store',
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    } catch (cause) {
      throw failure('NETWORK_UNAVAILABLE', '网络连接失败，请核对操作结果后再试', undefined, cause);
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    // An old request must never render into a newly signed-in customer's UI.
    assertSameSession(token);
    if (!response.ok) {
      const status = response.status;
      const code = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN'
        : status === 404 ? 'ENDPOINT_UNAVAILABLE' : status === 405 ? 'METHOD_NOT_ALLOWED'
        : status === 409 ? 'CONFLICT' : status === 429 ? 'RATE_LIMITED'
        : status === 503 ? 'SERVICE_UNAVAILABLE' : 'API_ERROR';
      const message = status === 401 ? '请重新登录' : status === 403 ? '无权执行该操作'
        : status === 503 ? '服务暂不可用' :
        (typeof data?.error === 'string' && data.error ? data.error : '请求失败');
      throw failure(code,message,status);
    }
    if (response.status !== 204 && (!data || typeof data !== 'object' || Array.isArray(data))) {
      throw failure('INVALID_RESPONSE', '接口响应格式不正确');
    }
    return data;
  }
  const getAccount = async () => normalizeAccountSnapshot(await call('/account'));
  const getAnalytics = async () => normalizeAnalytics(await call('/account/analytics'));
  async function loadOverview() {
    const token = getToken();
    if (typeof token !== 'string' || !token) throw failure('AUTH_REQUIRED', '请先登录', 401);
    const results = await Promise.allSettled([getAccount(),getAnalytics()]);
    assertSameSession(token);
    const fatal = results.find(item => item.status === 'rejected' &&
      (item.reason?.status === 401 || item.reason?.status === 403));
    if (fatal) throw fatal.reason;
    const entry = item => item.status === 'fulfilled'
      ? {state:'ready', data:item.value, errorCode:null}
      : {state:'unavailable',data:null,errorCode:item.reason?.code || 'API_ERROR'};
    return {account:entry(results[0]),analytics:entry(results[1])};
  }
  async function getCatalog() {
    return normalizePublishedCatalog(await call('/catalog'));
  }
  async function getWatchlist() {
    return normalizeClientWatchlist(await call('/watchlist'));
  }
  async function setWatchlist(item, wantSaved) {
    if (!allowed.watchlistWrites) throw failure('FEATURE_DISABLED', '当前无法修改自选');
    const ref = identity(item);
    if (typeof wantSaved !== 'boolean') throw failure('INVALID_WATCHLIST_ACTION', '自选操作无效');
    const token = getToken();
    const same = row => row.market === ref.market && row.symbol === ref.symbol;
    // Obtain current server state first; never trust locally cached array.
    const before = await getWatchlist();
    assertSameSession(token);
    if (before.some(same) === wantSaved) return before;
    await call('/watchlist', {method:wantSaved?'POST':'DELETE',body:ref});
    assertSameSession(token, '自选结果待核对，请重新登录查看');
    let after;
    try { after = await getWatchlist(); }
    catch (cause) {
      throw failure('WATCHLIST_READBACK_FAILED', '自选操作已发送，但回读失败，请刷新列表核对', cause.status, cause);
    }
    assertSameSession(token, '自选结果待核对，请重新登录查看');
    if (after.some(same) !== wantSaved) {
      throw failure('WATCHLIST_UNCONFIRMED', '服务器尚未确认自选变更');
    }
    return after;
  }

  async function getStockHistory(item,{interval='1day',outputsize=90}={}){
    const ref=identity(item);
    if(!HISTORY_INTERVALS.has(interval)||!Number.isSafeInteger(outputsize)||outputsize<1||outputsize>500)
      throw failure('INVALID_HISTORY_OPTIONS','历史行情参数无效');
    const payload=await call('/stock-history?market='+ref.market+'&symbol='+encodeURIComponent(ref.symbol)+
      '&interval='+interval+'&outputsize='+outputsize);
    return normalizeMarketHistory(payload,ref,{interval,outputsize,nowMs:now()});
  }
  async function getMarketInstrument(item){
    const result=await getQuote(item);
    if(!nonEmptyId(result.name)||!nonEmptyId(result.mic))
      throw failure('INSTRUMENT_UNAVAILABLE','证券身份不可用',503);
    return result;
  }
  async function getPortfolio(){
    return normalizeConsistentPortfolio(await call('/account/portfolio'),{nowMs:now()});
  }
  async function getRecentOrders(){
    const snapshot=await getAccount();
    return {items:snapshot.orders,scope:'RECENT_MAX_100',
      historyComplete:false,accountId:snapshot.account.id};
  }
  async function getPrivateStorageStatus(){
    const result=shape(await call('/private-data/status'),'身份资料状态');
    if(typeof result.ready!=='boolean')throw failure('INVALID_RESPONSE','身份资料服务状态不可用');
    return {ready:result.ready};
  }
  async function readPrivateSubmission(kind,id){
    if(!['KYC','BANK_LINK'].includes(kind)||!UUID.test(id))
      throw failure('INVALID_PRIVATE_REFERENCE','身份资料编号无效');
    const result=shape(await call('/private-data?kind='+kind+'&id='+encodeURIComponent(id)),'身份资料');
    if(result.kind!==kind||!result.payload||typeof result.payload!=='object'||Array.isArray(result.payload))
      throw failure('INVALID_RESPONSE','身份资料不可用');
    return result.payload;
  }
  async function submitPrivateSubmission(kind,body){
    if(!allowed.privateDataWrites)throw failure('FEATURE_DISABLED','资料上传暂不可用');
    if(!['KYC','BANK_LINK'].includes(kind)||!body||typeof body!=='object'||Array.isArray(body)||
       (kind==='KYC'&&(!body.front||!body.back||Object.keys(body).some(k=>!['front','back'].includes(k))))||
       (kind==='BANK_LINK'&&(typeof body.bankName!=='string'||typeof body.accountNumber!=='string'||
          Object.keys(body).some(k=>!['bankName','accountNumber'].includes(k)))))
      throw failure('INVALID_PRIVATE_SUBMISSION','身份资料不完整');
    const token=getToken(),status=await getPrivateStorageStatus();
    assertSameSession(token);
    if(!status.ready)throw failure('SERVICE_UNAVAILABLE','身份资料服务暂不可用',503);
    const sent=shape(await call('/private-data?kind='+kind,{method:'POST',body}),'身份资料提交');
    assertSameSession(token);
    if(!UUID.test(sent.item?.id)||sent.item.category!==kind)
      throw failure('PRIVATE_UNCONFIRMED','资料提交无法确认');
    let items;
    try{items=await getRequests(kind)}catch(cause){
      throw failure('PRIVATE_READBACK_FAILED','资料提交后回读失败',cause.status,cause);
    }
    assertSameSession(token);
    if(!items.some(item=>item.id===sent.item.id&&item.category===kind&&
        (kind==='KYC'?item.documentsStored===true:item.detailsStored===true)))
      throw failure('PRIVATE_UNCONFIRMED','服务器未确认资料保存');
    return {item:sent.item,requests:items};
  }
  async function getInternalProducts(){
    return normalizeInternalProducts(await call('/internal-products'));
  }
  async function getInternalPurchases(){
    return normalizeInternalPurchaseAccount(await call('/internal-purchases'));
  }
  async function buyInternalProduct({termsId,termsVersion,quantity,participationPassword,idempotencyKey}){
    if(!allowed.productWrites)throw failure('FEATURE_DISABLED','理财产品购买暂不可用');
    if(!UUID.test(termsId)||integer(termsVersion,1)!==termsVersion||
       integer(quantity,1)!==quantity||quantity>1_000_000||
       typeof participationPassword!=='string'||!/^\d{6}$/.test(participationPassword))
      throw failure('INVALID_PURCHASE','购买参数无效');
    const token=getToken(),products=await getInternalProducts();
    const terms=products.find(p=>p.termsId===termsId);
    if(!terms||!terms.tradingEnabled||terms.termsVersion!==termsVersion)
      throw failure('PRODUCT_UNAVAILABLE','产品条款不可用',409);
    if(terms.itemType==='STOCK')
      throw failure('PRODUCT_STOCK_UNAVAILABLE','股票产品报价暂不可用',503);
    const data=shape(await call('/internal-purchases',{method:'POST',
      body:{termsId,termsVersion,quantity,participationPassword},key:idempotencyKey}),'理财购买');
    assertSameSession(token);
    if(!UUID.test(data.purchase?.id))throw failure('PURCHASE_UNCONFIRMED','购买状态无法确认');
    let account;
    try{account=await getInternalPurchases()}catch(cause){
      throw failure('PURCHASE_READBACK_FAILED','购买后回读失败',cause.status,cause);
    }
    assertSameSession(token);
    if(!account.purchases.some(p=>p.id===data.purchase.id&&p.terms_id===termsId&&
        integer(p.quantity,1)===quantity))throw failure('PURCHASE_UNCONFIRMED','服务器未确认购买');
    return {purchase:data.purchase,account,replayed:data.replayed===true};
  }
  async function loadTerminalData(){
    const token=getToken();
    if(typeof token!=='string'||!token)throw failure('AUTH_REQUIRED','请先登录',401);
    const names=['portfolio','account','analytics','catalog','watchlist','products',
      'purchases','support','funding','kyc','bank'];
    const results=await Promise.allSettled([getPortfolio(),getAccount(),getAnalytics(),getCatalog(),
      getWatchlist(),getInternalProducts(),getInternalPurchases(),getSupport(),
      getRequests('FUNDING'),getRequests('KYC'),getRequests('BANK_LINK')]);
    assertSameSession(token);
    const fatal=results.find(x=>x.status==='rejected'&&
      (x.reason?.status===401||x.reason?.status===403));
    if(fatal)throw fatal.reason;
    return Object.fromEntries(results.map((result,index)=>[names[index],
      result.status==='fulfilled'?{state:'ready',data:result.value,errorCode:null}:
      {state:'unavailable',data:null,errorCode:result.reason?.code||'API_ERROR'}]));
  }
  async function getQuote(item) {
    const ref = identity(item);
    return normalizeVerifiedQuote(await call('/stock-quote?market=' + ref.market + '&symbol=' + encodeURIComponent(ref.symbol)),ref,{nowMs:now()});
  }
  async function getSupport() {
    const result = shape(await call('/support'),'客服');
    if (!Array.isArray(result.messages)) throw failure('INVALID_RESPONSE', '客服记录不可用');
    return result;
  }
  async function sendSupport(message) {
    if (!allowed.supportWrites) throw failure('FEATURE_DISABLED', '当前无法提交客服消息');
    if (typeof message !== 'string' || !message.trim() || message.trim().length > 4000) {
      throw failure('INVALID_MESSAGE','消息内容无效');
    }
    const token = getToken();
    const result = shape(await call('/support',{method:'POST',body:{message:message.trim()}}),'客服发送');
    assertSameSession(token, '客服消息状态待核对，请重新登录查看');
    const id = result.message?.id;
    if (!nonEmptyId(id)) throw failure('SUPPORT_UNCONFIRMED', '消息已发送，但结果尚未确认');
    let updated;
    try { updated = await getSupport(); }
    catch (cause) { throw failure('SUPPORT_READBACK_FAILED','消息已发送，但无法确认结果，请刷新记录核对',cause.status,cause); }
    assertSameSession(token, '客服消息状态待核对，请重新登录查看');
    if (!updated.messages.some(item=>item.id===id && item.body===message.trim())) {
      throw failure('SUPPORT_UNCONFIRMED','消息已发送，但服务器未确认记录');
    }
    return updated;
  }
  async function getRequests(category) {
    if (category !== undefined && !/^[A-Z_]{2,48}$/.test(category)) throw failure('INVALID_CATEGORY','请求类型无效');
    const result = shape(await call('/requests' + (category ? '?category=' + category : '')),'业务申请');
    if (!Array.isArray(result.items)) throw failure('INVALID_RESPONSE','申请记录不可用');
    return result.items;
  }
  async function submitRequest(category,body) {
    if (!allowed.requestWrites) throw failure('FEATURE_DISABLED','当前无法提交业务申请');
    if (!/^[A-Z_]{2,48}$/.test(category) || !body || typeof body !== 'object' || Array.isArray(body)) {
      throw failure('INVALID_REQUEST','申请参数无效');
    }
    const token = getToken();
    const data = shape(await call('/requests?category=' + category,{method:'POST',body}),'业务申请');
    assertSameSession(token, '业务申请状态待核对，请重新登录查看');
    if (!nonEmptyId(data.item?.id)) throw failure('REQUEST_UNCONFIRMED','申请已提交，但结果尚未确认');
    let items;
    try { items = await getRequests(category); }
    catch (cause) { throw failure('REQUEST_READBACK_FAILED','申请已提交，但无法确认结果，请刷新记录核对',cause.status,cause); }
    assertSameSession(token, '业务申请状态待核对，请重新登录查看');
    if (!items.some(item=>item.id===data.item.id)) throw failure('REQUEST_UNCONFIRMED','申请已提交，但服务器未确认记录');
    return {item:data.item,items};
  }
  async function submitInternalOrder({side,market,symbol,quantity,idempotencyKey}) {
    if (!allowed.trading) throw failure('FEATURE_DISABLED','当前无法提交订单');
    const ref = identity({market,symbol});
    const count = integer(quantity,1);
    if (!['BUY','SELL'].includes(side) || count === null) throw failure('INVALID_ORDER','交易参数无效');
    const key = transactionKey(idempotencyKey);
    const token = getToken();
    // Price and FX are intentionally not supplied by the browser: server verifies both.
    const result = shape(await call('/orders',{method:'POST',body:{side,...ref,quantity:count},key}),'订单提交');
    assertSameSession(token, '订单状态待核对，请重新登录后查看订单');
    const verified=normalizeExecutedOrder(result,{side,...ref,quantity:count});
    const orderId=verified.order.id;
    let snapshot;
    try { snapshot = await getAccount(); }
    catch (cause) { throw failure('ORDER_READBACK_FAILED','订单已提交，但回读失败，请核对订单记录后再试',cause.status,cause); }
    assertSameSession(token, '订单状态待核对，请重新登录后查看订单');
    const committed = snapshot.orders.find(item=>item.id===orderId && item.side===side &&
      item.market===ref.market && item.symbol===ref.symbol && item.quantity===count);
    if (!committed) throw failure('ORDER_UNCONFIRMED','订单已提交，但服务器未确认成交记录');
    if (verified.order.priceCents!==committed.priceCents ||
        verified.order.amountCents!==committed.amountUsdCents) {
      throw failure('ORDER_UNCONFIRMED','订单已提交，但服务器成交金额与回读记录不一致');
    }
    return {order:committed,snapshot,receipt:verified.receipt,quote:verified.quote,replayed:verified.replayed};
  }
  return Object.freeze({getAccount,getAnalytics,loadOverview,getPortfolio,getRecentOrders,
    getCatalog,getWatchlist,setWatchlist,getQuote,getMarketInstrument,getStockHistory,
    getPrivateStorageStatus,readPrivateSubmission,submitPrivateSubmission,
    getInternalProducts,getInternalPurchases,buyInternalProduct,
    getSupport,sendSupport,getRequests,submitRequest,submitInternalOrder,loadTerminalData});
}
