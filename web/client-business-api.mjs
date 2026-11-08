// Client-only adapter for existing authenticated platform HTTP endpoints.
// No prices, balances, fills, or P/L are synthesized in this module.
const MARKETS = new Set(['US', 'CN']);
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const MAX_QUOTE_AGE_MS = 60_000;

function failure(code, message, status, cause) {
  return Object.assign(new Error(message), {code, ...(status === undefined ? {} : {status}), ...(cause === undefined ? {} : {cause})});
}
function integer(value, min = 0) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
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
  if (!nonEmptyId(account.id) || cashCents === null || typeof account.currency !== 'string' || !account.currency) {
    throw failure('INVALID_RESPONSE', '账户余额未能确认');
  }
  if (!Array.isArray(payload.positions) || !Array.isArray(payload.orders)) {
    throw failure('INVALID_RESPONSE', '持仓或订单数据未能确认');
  }
  const positions = payload.positions.map(item => {
    const ref = identity(item);
    const quantity = integer(item.quantity, 1);
    if (quantity === null) throw failure('INVALID_RESPONSE', '持仓数量无效');
    return {...ref, quantity};
  });
  const orders = payload.orders.map(item => {
    const ref = identity(item);
    const quantity = integer(item.quantity, 1);
    const priceCents = integer(item.price_cents, 1);
    const amountUsdCents = integer(item.amount_usd_cents, 1);
    if (!nonEmptyId(item.id) || !['BUY','SELL'].includes(item.side) ||
        quantity === null || priceCents === null || amountUsdCents === null ||
        !Number.isFinite(Date.parse(item.created_at))) {
      throw failure('INVALID_RESPONSE', '订单记录无效');
    }
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

export function normalizeVerifiedQuote(payload, expected, {nowMs = Date.now(), maxAgeMs = MAX_QUOTE_AGE_MS} = {}) {
  const ref = identity(expected);
  const quote = shape(payload, '行情');
  const priceCents = integer(quote.priceCents, 1);
  const timestampMs = quote.timestampMs;
  if (quote.market !== ref.market || quote.symbol !== ref.symbol || priceCents === null ||
      quote.currency !== (ref.market === 'CN' ? 'CNY' : 'USD') ||
      !nonEmptyId(quote.source) || !Number.isFinite(timestampMs) ||
      !Number.isFinite(nowMs) || timestampMs > nowMs + 5000 || nowMs - timestampMs > maxAgeMs ||
      quote.stale === true || quote.status === 'unavailable') {
    throw failure('QUOTE_UNAVAILABLE', '当前行情不可用，请刷新后重试', 503);
  }
  // Explicit display permission is needed. Older QA /stock-quote lacks this field.
  if (quote.entitled !== true && quote.permission !== 'allowed') {
    throw failure('QUOTE_NOT_ENTITLED', '当前行情不可用，请刷新后重试', 503);
  }
  return {...ref, priceCents, currency:quote.currency, source:quote.source,
    timestampMs, stale:false};
}

export function createClientBusinessApi({getToken, fetchImpl = fetch,
  capabilities = {}, now = Date.now} = {}) {
  if (typeof getToken !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('Missing client API dependencies');
  // Must be enabled explicitly after QA/server permission verification; defaults are read-only.
  const allowed = Object.freeze({trading:capabilities.trading === true,
    supportWrites:capabilities.supportWrites === true, requestWrites:capabilities.requestWrites === true});
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
    if (!response.ok) {
      const status = response.status;
      const code = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN'
        : status === 409 ? 'CONFLICT' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'API_ERROR';
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
    const result = shape(await call('/support',{method:'POST',body:{message:message.trim()}}),'客服发送');
    const id = result.message?.id;
    if (!nonEmptyId(id)) throw failure('SUPPORT_UNCONFIRMED', '消息已发送，但结果尚未确认');
    let updated;
    try { updated = await getSupport(); }
    catch (cause) { throw failure('SUPPORT_READBACK_FAILED','消息已发送，但无法确认结果，请刷新记录核对',cause.status,cause); }
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
    const data = shape(await call('/requests?category=' + category,{method:'POST',body}),'业务申请');
    if (!nonEmptyId(data.item?.id)) throw failure('REQUEST_UNCONFIRMED','申请已提交，但结果尚未确认');
    let items;
    try { items = await getRequests(category); }
    catch (cause) { throw failure('REQUEST_READBACK_FAILED','申请已提交，但无法确认结果，请刷新记录核对',cause.status,cause); }
    if (!items.some(item=>item.id===data.item.id)) throw failure('REQUEST_UNCONFIRMED','申请已提交，但服务器未确认记录');
    return {item:data.item,items};
  }
  async function submitInternalOrder({side,market,symbol,quantity,idempotencyKey}) {
    if (!allowed.trading) throw failure('FEATURE_DISABLED','当前无法提交订单');
    const ref = identity({market,symbol});
    const count = integer(quantity,1);
    if (!['BUY','SELL'].includes(side) || count === null) throw failure('INVALID_ORDER','交易参数无效');
    const key = transactionKey(idempotencyKey);
    // Price and FX are intentionally not supplied by the browser: server verifies both.
    const result = shape(await call('/orders',{method:'POST',body:{side,...ref,quantity:count},key}),'订单提交');
    const orderId = result.order?.id;
    if (!nonEmptyId(orderId)) throw failure('ORDER_UNCONFIRMED','订单已提交，但服务器未返回订单标识');
    let snapshot;
    try { snapshot = await getAccount(); }
    catch (cause) { throw failure('ORDER_READBACK_FAILED','订单已提交，但回读失败，请核对订单记录后再试',cause.status,cause); }
    const committed = snapshot.orders.find(item=>item.id===orderId && item.side===side &&
      item.market===ref.market && item.symbol===ref.symbol && item.quantity===count);
    if (!committed) throw failure('ORDER_UNCONFIRMED','订单已提交，但服务器未确认成交记录');
    return {order:committed,snapshot,replayed:result.replayed === true};
  }
  return Object.freeze({getAccount,getAnalytics,getQuote,getSupport,sendSupport,getRequests,submitRequest,submitInternalOrder});
}
