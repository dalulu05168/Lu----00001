/**
 * Read-only SEC EDGAR submissions metadata client, not a price feed.
 * No real credentials, market quotes, trading or existing HTTP routes involved.
 * Only an operator-configured identifying User-Agent permits an upstream call.
 * SEC Fair Access: <=10 requests/s across *all* infrastructure; this per-instance
 * throttle is only defense-in-depth, not a substitute for a shared rate limiter.
 * https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 */
export const SEC_SUBMISSIONS_ORIGIN = 'https://data.sec.gov';
export const SEC_EDGAR_SOURCE = 'SEC EDGAR';
const PUBLIC_FORMS = new Set(['10-K', '10-Q', '8-K', '20-F', '6-K', '40-F']);
const FILING_RE = /^\d{10}-\d{2}-\d{6}$/;
const DOC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_TTL_MS = 15 * 60_000;

function unavailable() {
  return Object.assign(new Error('SEC EDGAR filings unavailable'), {statusCode: 503});
}
function invalid(message) {
  return Object.assign(new Error(message), {statusCode: 400});
}
export function normalizeEdgarCik(cik) {
  const value = typeof cik === 'number' && Number.isSafeInteger(cik) ? String(cik) : cik;
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value) || !Number(value)) {
    throw invalid('Invalid SEC CIK');
  }
  return value.padStart(10, '0');
}
function filingsFromResponse(data, cik, now) {
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.cik) ||
      data.cik !== Number(cik) || typeof data.name !== 'string' ||
      !data.name.trim() || data.name.length > 240) throw unavailable();
  const r = data.filings?.recent;
  const columns = ['accessionNumber', 'form', 'filingDate', 'primaryDocument'];
  if (!r || columns.some(k => !Array.isArray(r[k]))) throw unavailable();
  const n = r.form.length;
  if (n > 10_000 || columns.some(k => r[k].length !== n)) throw unavailable();
  const filings = [];
  for (let i = 0; i < n; i++) {
    const form = r.form[i];
    if (!PUBLIC_FORMS.has(form)) continue;
    const accession = r.accessionNumber[i];
    const document = r.primaryDocument[i];
    const filingDate = r.filingDate[i];
    if (typeof accession !== 'string' || !FILING_RE.test(accession) ||
        typeof document !== 'string' || !DOC_RE.test(document) || document.includes('..') ||
        typeof filingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;
    const filingTime = Date.parse(filingDate + 'T00:00:00Z');
    if (!Number.isFinite(filingTime) || new Date(filingTime).toISOString().slice(0,10) !== filingDate ||
        filingTime > now + 86_400_000) continue;
    // SEC archive path uses the unpadded entity CIK and accession without dashes.
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${document}`;
    filings.push(Object.freeze({form, accessionNumber: accession, filingDate, url}));
  }
  return Object.freeze({name: data.name.trim(), filings: Object.freeze(filings)});
}

/** Return metadata only. Never treat it as a quote, asset, price or trade signal. */
export function createSecEdgarClient({
  userAgent, fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  cacheTtlMs = DEFAULT_TTL_MS, minIntervalMs = 350, maxEntries = 64
} = {}) {
  if (typeof userAgent !== 'string' || userAgent.length < 16 || userAgent.length > 160 ||
      /[\r\n]/.test(userAgent) || !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(userAgent)) {
    throw new Error('SEC identifying User-Agent with operator contact email required');
  }
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof sleep !== 'function' ||
      !Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 60_000 || cacheTtlMs > 3_600_000 ||
      !Number.isSafeInteger(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 10_000 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100) {
    throw new Error('Invalid SEC client configuration');
  }
  const cache = new Map(), pending = new Map();
  let nextAllowedAt = 0;

  async function fetchFresh(cik) {
    const at = now();
    const scheduled = Math.max(at, nextAllowedAt);
    nextAllowedAt = scheduled + minIntervalMs;
    if (scheduled > at) await sleep(scheduled - at);
    try {
      const url = `${SEC_SUBMISSIONS_ORIGIN}/submissions/CIK${cik}.json`;
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(7000)
      });
      if (!res.ok || !String(res.headers?.get?.('content-type') ?? '').toLowerCase().includes('json')) throw unavailable();
      const headerLength = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(headerLength) && headerLength > MAX_RESPONSE_BYTES) throw unavailable();
      const body = await res.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw unavailable();
      const parsed = filingsFromResponse(JSON.parse(body), cik, now());
      cache.delete(cik);
      cache.set(cik, {data: parsed, fetchedAt: now()});
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return parsed;
    } catch { throw unavailable(); }
  }

  return async function getCompanyFilings(cikInput, {forms = ['10-K', '10-Q', '8-K'], limit = 12} = {}) {
    const cik = normalizeEdgarCik(cikInput);
    if (!Array.isArray(forms) || forms.length < 1 || forms.length > 6 ||
        forms.some(f => !PUBLIC_FORMS.has(f)) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw invalid('Invalid SEC filing selection');
    }
    const cached = cache.get(cik);
    let data, fetchedAt;
    if (cached && now() >= cached.fetchedAt && now() - cached.fetchedAt < cacheTtlMs) {
      data = cached.data; fetchedAt = cached.fetchedAt;
    } else {
      if (!pending.has(cik)) {
        const task = fetchFresh(cik).finally(() => pending.delete(cik));
        pending.set(cik, task);
      }
      data = await pending.get(cik);
      fetchedAt = cache.get(cik)?.fetchedAt ?? now();
    }
    const allowedForms = new Set(forms);
    return Object.freeze({
      source: SEC_EDGAR_SOURCE, dataKind: 'FILING_METADATA', cik,
      companyName: data.name, fetchedAt: new Date(fetchedAt).toISOString(),
      filings: Object.freeze(data.filings.filter(x => allowedForms.has(x.form)).slice(0, limit)),
      priceAvailable: false, orderExecutionAllowed: false
    });
  };
}