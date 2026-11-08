/**
 * Independent US / mainland-China equities read-only market-data adapter.
 * Not wired into shared HTTP routes or order execution. No broker connectivity.
 * Operator must supply independently verified exchange/provider rights for each use.
 */
const SOURCE = 'Twelve Data';
const US_SYMBOL = /^[A-Z][A-Z0-9.-]{0,23}$/;
const CN_SYMBOL = /^\d{6}$/;
const US_MICS = new Set(['XNAS', 'XNYS', 'XASE', 'ARCX', 'XNGS', 'XNMS', 'XNCM', 'BATS']);
const INTERVALS = new Set(['1min', '5min', '15min', '1day', '1week', '1month']);
const EXCHANGE_TIMEZONES = Object.freeze({US: 'America/New_York', CN: 'Asia/Shanghai'});

function error(code) {
  return Object.assign(new Error(code), {code, statusCode: 503});
}

function instrument({market, symbol}) {
  if (market === 'US' && typeof symbol === 'string' && US_SYMBOL.test(symbol)) {
    return {market, symbol, currency: 'USD', mic: null, exchange: null};
  }
  if (market === 'CN' && typeof symbol === 'string' && CN_SYMBOL.test(symbol)) {
    // Fail closed for unsupported BSE and ambiguous securities.
    if (/^(60|68)/.test(symbol)) return {market, symbol, currency: 'CNY', mic: 'XSHG', exchange: 'SSE'};
    if (/^(00|30)/.test(symbol)) return {market, symbol, currency: 'CNY', mic: 'XSHE', exchange: 'SZSE'};
  }
  throw error('UNSUPPORTED_INSTRUMENT');
}

function authorized(rights, market, purpose) {
  const grant = rights?.[market];
  if (grant?.provider !== SOURCE || grant?.[purpose] !== true ||
      typeof grant?.reviewReference !== 'string' || !grant.reviewReference.trim()) {
    throw error('DATA_USE_RIGHTS_UNVERIFIED');
  }
  return grant;
}

function identity(body, wanted, {requireName = true} = {}) {
  const mic = String(body?.mic_code ?? '').toUpperCase();
  if (body?.symbol !== wanted.symbol || body?.currency !== wanted.currency ||
      (wanted.mic ? mic !== wanted.mic : !US_MICS.has(mic)) ||
      (requireName && (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 180))) {
    throw error('PROVIDER_IDENTITY_MISMATCH');
  }
  return {name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
    exchange: String(body.exchange || wanted.exchange || ''), mic};
}

function priceMicros(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw error('INVALID_PROVIDER_PRICE');
  const raw = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) throw error('INVALID_PROVIDER_PRICE');
  const [major, frac = ''] = raw.split('.');
  const micros = Number(major) * 1_000_000 + Number(frac.padEnd(6, '0'));
  if (!Number.isSafeInteger(micros) || micros <= 0) throw error('INVALID_PROVIDER_PRICE');
  return micros;
}

function epochMs(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw error('INVALID_QUOTE_TIMESTAMP');
  return seconds * 1000;
}

function lastQuoteTime(body) {
  // /quote.timestamp is *candle open*, not necessarily last trade.
  // Never use it as a substitute for last_quote_at.
  return epochMs(body?.last_quote_at);
}

function validAge(stamp, nowMs, maxAgeMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) ||
      maxAgeMs <= 0 || maxAgeMs > 60_000) throw error('INVALID_FRESHNESS_POLICY');
  const age = nowMs - stamp;
  if (age < -5_000 || age > maxAgeMs) throw error('STALE_OR_FUTURE_QUOTE');
  return age;
}

function floatFromMicros(micros) { return micros / 1_000_000; }
function validCount(v) {
  if (typeof v !== 'string' && typeof v !== 'number') throw error('INVALID_HISTORY_VOLUME');
  if (!/^(0|[1-9]\d*)$/.test(String(v)) || !Number.isSafeInteger(Number(v))) throw error('INVALID_HISTORY_VOLUME');
  return Number(v);
}

async function boundedJson(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) throw error('PROVIDER_RESPONSE_UNREADABLE');
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw error('PROVIDER_RESPONSE_TOO_LARGE');
      parts.push(value);
    }
  } finally { try { await reader.cancel(); } catch {} }
  const buf = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of parts) { buf.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buf)); }
  catch { throw error('PROVIDER_INVALID_JSON'); }
}

export function createTwelveDataEquities({apiKey, rights, fetchImpl = fetch, now = Date.now,
  maxQuoteAgeMs = 60_000, timeoutMs = 4_000, maxResponseBytes = 1_000_000} = {}) {
  if (typeof maxQuoteAgeMs !== 'number' || maxQuoteAgeMs <= 0 || maxQuoteAgeMs > 60_000 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 2_000_000 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw error('INVALID_ADAPTER_CONFIGURATION');
  }
  async function request(path, params) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw error('MARKET_DATA_NOT_CONFIGURED');
    const url = new URL('https://api.twelvedata.com/' + path);
    for (const [key, val] of Object.entries(params)) url.searchParams.set(key, String(val));
    // No key in URL (avoids proxy/access logs accidentally retaining it).
    let res;
    try {
      res = await fetchImpl(url, {
        headers: {Authorization: 'apikey ' + apiKey, Accept: 'application/json'},
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs)
      });
    } catch { throw error('PROVIDER_UNREACHABLE'); }
    if (res.status === 429) throw error('PROVIDER_RATE_LIMITED');
    if (!res.ok) throw error('PROVIDER_HTTP_ERROR');
    const data = await boundedJson(res, maxResponseBytes);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.status === 'error' || data.code) {
      throw error('PROVIDER_REJECTED_REQUEST');
    }
    return data;
  }

  async function getQuote({market, symbol}, {purpose = 'clientDisplay'} = {}) {
    const wanted = instrument({market, symbol});
    if (!['clientDisplay', 'internalSimulationPricing'].includes(purpose)) throw error('INVALID_DATA_PURPOSE');
    const grant = authorized(rights, market, purpose);
    const params = {symbol, interval: '1min'};
    if (wanted.mic) params.mic_code = wanted.mic;
    const data = await request('quote', params);
    const meta = identity(data, wanted);
    const price = priceMicros(data.close);
    const priceCents = price % 10_000 === 0 ? price / 10_000 : null;
    if (purpose === 'internalSimulationPricing' && priceCents === null) throw error('SUBCENT_ORDER_PRICING_UNSUPPORTED');
    const stamp = lastQuoteTime(data);
    const checkedAtMs = now();
    const ageMs = validAge(stamp, checkedAtMs, maxQuoteAgeMs);
    const previousClose = data.previous_close == null ? null : priceMicros(data.previous_close);
    return Object.freeze({status: 'FRESH', stale: false, market, symbol, ...meta,
      currency: wanted.currency, price: floatFromMicros(price), priceCents,
      previousClose: previousClose == null ? null : floatFromMicros(previousClose),
      change: previousClose == null ? null : floatFromMicros(price - previousClose),
      percentChange: previousClose == null ? null : Number(((price - previousClose) / previousClose * 100).toFixed(5)),
      timestampMs: stamp, ageMs, checkedAtMs, source: SOURCE,
      entitlement: {purpose, reviewReference: grant.reviewReference},
      executionVenue: null});
  }

  async function getHistory({market, symbol, interval = '1day', outputsize = 90}) {
    const wanted = instrument({market, symbol});
    authorized(rights, market, 'clientDisplay');
    if (!INTERVALS.has(interval) || !Number.isInteger(outputsize) || outputsize < 1 || outputsize > 500) {
      throw error('INVALID_HISTORY_OPTIONS');
    }
    const params = {symbol, interval, outputsize};
    if (wanted.mic) params.mic_code = wanted.mic;
    const data = await request('time_series', params);
    const meta = identity(data.meta, wanted, {requireName: false});
    if (data.meta?.interval !== interval || data.meta?.exchange_timezone !== EXCHANGE_TIMEZONES[market]) {
      throw error('PROVIDER_HISTORY_METADATA_MISMATCH');
    }
    if (!Array.isArray(data.values) || data.values.length === 0 || data.values.length > outputsize) {
      throw error('INVALID_HISTORY_SERIES');
    }
    const rows = data.values.map(row => {
      const dateTime = String(row?.datetime ?? '');
      const pattern = interval.includes('min') ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
      const datePart = dateTime.slice(0, 10);
      const calendarMs = Date.parse(datePart + 'T00:00:00Z');
      const validDay = Number.isFinite(calendarMs) && new Date(calendarMs).toISOString().slice(0, 10) === datePart;
      const validClock = !interval.includes('min') || (Number(dateTime.slice(11, 13)) < 24 &&
        Number(dateTime.slice(14, 16)) < 60 && Number(dateTime.slice(17, 19)) < 60);
      if (!pattern.test(dateTime) || !validDay || !validClock || calendarMs > now() + 86_400_000) {
        throw error('INVALID_HISTORY_DATE');
      }
      const openMicros = priceMicros(row.open), highMicros = priceMicros(row.high);
      const lowMicros = priceMicros(row.low), closeMicros = priceMicros(row.close);
      if (lowMicros > Math.min(openMicros, closeMicros) || highMicros < Math.max(openMicros, closeMicros)) {
        throw error('INVALID_HISTORY_OHLC');
      }
      return {datetime: dateTime, open: floatFromMicros(openMicros), high: floatFromMicros(highMicros),
        low: floatFromMicros(lowMicros), close: floatFromMicros(closeMicros), volume: validCount(row.volume)};
    }).sort((a, b) => a.datetime.localeCompare(b.datetime));
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].datetime === rows[i - 1].datetime) throw error('DUPLICATE_HISTORY_BAR');
    }
    return Object.freeze({status: 'HISTORICAL', market, symbol, ...meta, currency: wanted.currency,
      interval, timezone: data.meta.exchange_timezone,
      source: SOURCE, values: rows});
  }

  return Object.freeze({getQuote, getHistory});
}
