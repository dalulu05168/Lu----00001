/**
 * Server-side US/CN equity quote ingress. No HTTP route, orders, or broker I/O.
 * The provider is a trusted adapter; authorizeAccess must consult reviewed,
 * server-owned, purpose-specific rights on every read (including cache hits).
 * This boolean policy contract is not itself evidence of an exchange license.
 */
const CURRENCIES = Object.freeze({US: 'USD', CN: 'CNY'});
const SYMBOLS = Object.freeze({US: /^[A-Z][A-Z0-9.-]{0,23}$/, CN: /^\d{6}$/});
const US_MICS = new Set(['XNAS', 'XNYS', 'XASE', 'ARCX', 'XNGS', 'XNMS', 'XNCM', 'BATS']);
const PURPOSES = new Set(['clientDisplay', 'internalSimulationPricing']);
const MAX_FRESHNESS_MS = 60_000;

function failure(code) {
  return Object.assign(new Error(code), {code, statusCode: 503});
}

function expectedMic(request) {
  if (request.market === 'US') return null;
  if (/^(60|68)/.test(request.symbol)) return 'XSHG';
  if (/^(00|30)/.test(request.symbol)) return 'XSHE';
  if (/^301/.test(request.symbol)) return 'XSHE';
  throw failure('UNSUPPORTED_CN_EQUITY');
}

function normalizeRequest(request, options) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      !Object.hasOwn(CURRENCIES, request.market) ||
      typeof request.symbol !== 'string' ||
      !SYMBOLS[request.market].test(request.symbol)) throw failure('INVALID_QUOTE_REQUEST');
  const purposeA = request.purpose;
  const purposeB = options?.purpose;
  if (purposeA != null && purposeB != null && purposeA !== purposeB) {
    throw failure('AMBIGUOUS_DATA_PURPOSE');
  }
  const purpose = purposeA ?? purposeB ?? 'clientDisplay';
  if (!PURPOSES.has(purpose)) throw failure('INVALID_QUOTE_REQUEST');
  expectedMic(request);
  return Object.freeze({market: request.market, symbol: request.symbol, purpose});
}

function checkIdentity(value, request, source, requireName = true) {
  if (!value || value.market !== request.market || value.symbol !== request.symbol ||
      value.currency !== CURRENCIES[request.market] || value.source !== source ||
      typeof value.mic !== 'string' || !(request.market === 'US'
        ? US_MICS.has(value.mic) : expectedMic(request) === value.mic) ||
      (requireName && (typeof value.name !== 'string' ||
        !value.name.trim() || value.name.length > 180))) {
    throw failure('INVALID_UPSTREAM_IDENTITY');
  }
}

function checkQuote(quote, request, source, now, maxAgeMs) {
  checkIdentity(quote, request, source);
  if (!Number.isSafeInteger(quote.timestampMs) || !Number.isFinite(quote.price) ||
      quote.price <= 0 || quote.status !== 'FRESH' || quote.stale !== false ||
      quote.entitlement?.purpose !== request.purpose ||
      typeof quote.entitlement?.reviewReference !== 'string' ||
      !quote.entitlement.reviewReference.trim()) throw failure('INVALID_UPSTREAM_QUOTE');
  if (request.purpose === 'internalSimulationPricing' &&
      (!Number.isSafeInteger(quote.priceCents) || quote.priceCents <= 0 ||
       Math.abs(quote.priceCents / 100 - quote.price) > 0.00000001)) {
    throw failure('EXECUTION_PRICE_NOT_EXACT_CENTS');
  }
  if (quote.timestampMs > now + 5_000 || now - quote.timestampMs > maxAgeMs) {
    throw failure('QUOTE_STALE_OR_FUTURE');
  }
  return quote;
}

function verifyRights(authorizeAccess, value, request, now) {
  let rights;
  try {
    rights = authorizeAccess({source: value.source, market: request.market,
      currency: CURRENCIES[request.market], purpose: request.purpose, now});
  } catch {
    throw failure('DATA_RIGHTS_NOT_VERIFIED');
  }
  if (!rights || rights.provider !== value.source ||
      rights.market !== request.market || rights.currency !== CURRENCIES[request.market] ||
      rights.purpose !== request.purpose || rights.allowed !== true ||
      !Number.isSafeInteger(rights.expiresAtMs) || rights.expiresAtMs <= now ||
      typeof rights.reviewReference !== 'string' || !rights.reviewReference.trim()) {
    throw failure('DATA_RIGHTS_NOT_VERIFIED');
  }
  // Do not launder the provider's unreviewed static "entitled:true" flag.
  if (value.entitlement && (value.entitlement.purpose !== request.purpose ||
      value.entitlement.reviewReference !== rights.reviewReference)) {
    throw failure('DATA_RIGHTS_REFERENCE_MISMATCH');
  }
  return rights;
}

function normalizeHistory(history, request, source, interval, outputsize) {
  checkIdentity(history, request, source, false);
  const tz = request.market === 'CN' ? 'Asia/Shanghai' : 'America/New_York';
  if (history.status !== 'HISTORICAL' || history.interval !== interval ||
      history.timezone !== tz || !Array.isArray(history.values) ||
      history.values.length === 0 || history.values.length > outputsize) {
    throw failure('INVALID_UPSTREAM_HISTORY');
  }
  let last = '';
  for (const bar of history.values) {
    if (typeof bar?.datetime !== 'string' || bar.datetime <= last ||
        !['open', 'high', 'low', 'close'].every(k => Number.isFinite(bar[k]) && bar[k] > 0) ||
        bar.low > Math.min(bar.open, bar.close) ||
        bar.high < Math.max(bar.open, bar.close) ||
        !Number.isSafeInteger(bar.volume) || bar.volume < 0) {
      throw failure('INVALID_UPSTREAM_HISTORY');
    }
    last = bar.datetime;
  }
  return history;
}

export function createMarketDataQuoteGateway({provider, authorizeAccess, now = Date.now,
  source = 'Twelve Data', maxAgeMs = MAX_FRESHNESS_MS, cacheTtlMs = 1000,
  maxCacheEntries = 500} = {}) {
  if (typeof provider?.getQuote !== 'function' || typeof authorizeAccess !== 'function' ||
      typeof now !== 'function' || typeof source !== 'string' || !source.trim() ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > MAX_FRESHNESS_MS ||
      !Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 5000 ||
      !Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1 ||
      maxCacheEntries > 5000) throw new TypeError('Invalid market-data gateway configuration');

  const cache = new Map();
  const pending = new Map();

  async function getQuote(request, options) {
    // Preferred API: getQuote({market,symbol,purpose}).
    // The existing trading backend uses getQuote({market,symbol},{purpose}).
    const normalized = normalizeRequest(request, options);
    const key = normalized.market + ':' + normalized.symbol + ':' + normalized.purpose;
    const start = now();
    if (!Number.isSafeInteger(start)) throw failure('SERVER_TIME_UNAVAILABLE');
    const provisional = {source, market: normalized.market, currency: CURRENCIES[normalized.market]};
    verifyRights(authorizeAccess, provisional, normalized, start);
    const snapshot = cache.get(key);
    if (snapshot && start >= snapshot.cachedAt && start - snapshot.cachedAt <= cacheTtlMs) {
      const quote = checkQuote(snapshot.quote, normalized, source, start, maxAgeMs);
      const rights = verifyRights(authorizeAccess, quote, normalized, start);
      return Object.freeze({...quote, ageMs: start - quote.timestampMs, checkedAtMs: start,
        entitlement: Object.freeze({purpose: normalized.purpose, reviewReference: rights.reviewReference})});
    }
    let task = pending.get(key);
    if (!task) {
      task = Promise.resolve().then(() => provider.getQuote(
        {market: normalized.market, symbol: normalized.symbol}, {purpose: normalized.purpose}));
      pending.set(key, task);
      task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    }
    let quote;
    try { quote = await task; }
    catch { throw failure('UPSTREAM_QUOTE_UNAVAILABLE'); }
    const checkedAt = now();
    if (!Number.isSafeInteger(checkedAt)) throw failure('SERVER_TIME_UNAVAILABLE');
    checkQuote(quote, normalized, source, checkedAt, maxAgeMs);
    const rights = verifyRights(authorizeAccess, quote, normalized, checkedAt);
    if (cacheTtlMs) {
      if (!cache.has(key) && cache.size >= maxCacheEntries) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(key, {quote, cachedAt: checkedAt});
    }
    return Object.freeze({...quote, ageMs: checkedAt - quote.timestampMs, checkedAtMs: checkedAt,
      entitlement: Object.freeze({purpose: normalized.purpose, reviewReference: rights.reviewReference})});
  }

  async function getHistory(request) {
    if (typeof provider.getHistory !== 'function') throw failure('HISTORY_PROVIDER_NOT_CONFIGURED');
    const normalized = normalizeRequest(request, {purpose: 'clientDisplay'});
    const interval = request?.interval ?? '1day';
    const outputsize = request?.outputsize ?? 90;
    if (!new Set(['1min', '5min', '15min', '1day', '1week', '1month']).has(interval) ||
        !Number.isSafeInteger(outputsize) || outputsize < 1 || outputsize > 500) {
      throw failure('INVALID_HISTORY_REQUEST');
    }
    const provisional = {source, market: normalized.market, currency: CURRENCIES[normalized.market]};
    const start = now();
    if (!Number.isSafeInteger(start)) throw failure('SERVER_TIME_UNAVAILABLE');
    verifyRights(authorizeAccess, provisional, normalized, start);
    let history;
    try {
      history = await provider.getHistory({market: normalized.market, symbol: normalized.symbol,
        interval, outputsize});
    } catch { throw failure('UPSTREAM_HISTORY_UNAVAILABLE'); }
    normalizeHistory(history, normalized, source, interval, outputsize);
    const finished = now();
    if (!Number.isSafeInteger(finished)) throw failure('SERVER_TIME_UNAVAILABLE');
    const rights = verifyRights(authorizeAccess, provisional, normalized, finished);
    return Object.freeze({...history,
      entitlement: Object.freeze({purpose: 'clientDisplay', reviewReference: rights.reviewReference}),
      checkedAtMs: finished});
  }
  return Object.freeze({getQuote, getHistory});
}
