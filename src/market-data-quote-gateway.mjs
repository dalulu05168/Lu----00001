/**
 * Isolated server-side quote ingress. Does not create orders or contact a broker.
 * The provider supplies a trusted quote; rights are checked at *every* read,
 * including memory cache hits. A cache hit never extends quote freshness.
 */
const MARKETS = Object.freeze({US: 'USD', CN: 'CNY'});
const SYMBOLS = Object.freeze({US: /^[A-Z][A-Z0-9.-]{0,23}$/, CN: /^\d{6}$/});
const PURPOSES = new Set(['clientDisplay', 'internalSimulationPricing']);
const MAX_FRESHNESS_MS = 60_000;

function failure(code) { return Object.assign(new Error(code), {code, statusCode:503}); }

function validateRequest(request, purpose) {
  if (!request || typeof request !== 'object' ||
      !Object.hasOwn(MARKETS, request.market) ||
      typeof request.symbol !== 'string' || !SYMBOLS[request.market].test(request.symbol) ||
      !PURPOSES.has(purpose)) throw failure('INVALID_QUOTE_REQUEST');
  return {market:request.market, symbol:request.symbol, purpose};
}

function checkQuote(quote, request, now, maxAgeMs) {
  if (!quote || quote.market !== request.market || quote.symbol !== request.symbol ||
      quote.currency !== MARKETS[request.market] ||
      typeof quote.source !== 'string' || !quote.source.trim() ||
      !Number.isSafeInteger(quote.timestampMs) ||
      !Number.isFinite(quote.price) || quote.price <= 0 ||
      quote.status !== 'FRESH' || quote.stale !== false) throw failure('INVALID_UPSTREAM_QUOTE');
  if (request.purpose === 'internalSimulationPricing' &&
      (!Number.isSafeInteger(quote.priceCents) || quote.priceCents <= 0 ||
       Math.abs(quote.priceCents/100 - quote.price) > 0.00000001)) {
    throw failure('EXECUTION_PRICE_NOT_EXACT_CENTS');
  }
  if (quote.timestampMs > now + 5_000 || now - quote.timestampMs > maxAgeMs) {
    throw failure('QUOTE_STALE_OR_FUTURE');
  }
  return quote;
}

function verifyRights(authorizeAccess, quote, request, now) {
  let permission;
  try { permission = authorizeAccess({source:quote.source, market:quote.market,
    currency:quote.currency, purpose:request.purpose, now}); }
  catch { throw failure('DATA_RIGHTS_NOT_VERIFIED'); }
  if (permission?.provider !== quote.source || permission?.market !== quote.market ||
      permission?.currency !== quote.currency || permission?.purpose !== request.purpose ||
      permission?.allowed !== true ||
      !Number.isSafeInteger(permission.expiresAtMs) || permission.expiresAtMs < now ||
      typeof permission.reviewReference !== 'string' || !permission.reviewReference.trim()) {
    throw failure('DATA_RIGHTS_NOT_VERIFIED');
  }
  return permission;
}

export function createMarketDataQuoteGateway({provider, authorizeAccess,
  now = Date.now, maxAgeMs = MAX_FRESHNESS_MS,
  cacheTtlMs = 1000, maxCacheEntries = 500} = {}) {
  if (typeof provider?.getQuote !== 'function' || typeof authorizeAccess !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1 || maxAgeMs > MAX_FRESHNESS_MS ||
      !Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 5000 ||
      !Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 5000) {
    throw new TypeError('Invalid market data gateway configuration');
  }
  const cache = new Map();
  const pending = new Map();

  async function getQuote(request, {purpose = 'clientDisplay'} = {}) {
    const normalized = validateRequest(request, purpose);
    const key = normalized.market + ':' + normalized.symbol + ':' + purpose;
    const startedAt = now();
    if (!Number.isSafeInteger(startedAt)) throw failure('SERVER_TIME_UNAVAILABLE');
    const snapshot = cache.get(key);
    if (snapshot && startedAt >= snapshot.cachedAt && startedAt - snapshot.cachedAt <= cacheTtlMs) {
      const quote = checkQuote(snapshot.quote, normalized, startedAt, maxAgeMs);
      const rights = verifyRights(authorizeAccess, quote, normalized, startedAt);
      return Object.freeze({...quote, entitlement:Object.freeze({purpose, reviewReference:rights.reviewReference}),
        ageMs:startedAt - quote.timestampMs, checkedAtMs:startedAt});
    }
    // Unauthorized reads cannot piggyback a concurrent authorized request.
    const provisional = {source: 'Twelve Data', market:normalized.market,
      currency:MARKETS[normalized.market]};
    verifyRights(authorizeAccess, provisional, normalized, startedAt);
    let task = pending.get(key);
    if (!task) {
      task = Promise.resolve().then(()=>provider.getQuote({market:normalized.market,symbol:normalized.symbol},{purpose}));
      pending.set(key, task);
      task.finally(()=>{ if (pending.get(key) === task) pending.delete(key); }).catch(()=>{});
    }
    let quote;
    try { quote = await task; }
    catch { throw failure('UPSTREAM_QUOTE_UNAVAILABLE'); }
    const checkedAt = now();
    if (!Number.isSafeInteger(checkedAt)) throw failure('SERVER_TIME_UNAVAILABLE');
    checkQuote(quote, normalized, checkedAt, maxAgeMs);
    const rights = verifyRights(authorizeAccess, quote, normalized, checkedAt);
    if (cacheTtlMs) {
      if (!cache.has(key) && cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
      cache.set(key, {quote, cachedAt:checkedAt});
    }
    return Object.freeze({...quote,entitlement:Object.freeze({purpose,reviewReference:rights.reviewReference}),
      ageMs:checkedAt - quote.timestampMs, checkedAtMs:checkedAt});
  }
  return Object.freeze({getQuote});
}
