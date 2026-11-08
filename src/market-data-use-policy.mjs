/**
 * Read-only, fail-closed client display gate for market-data integrations.
 * NOT a grant of legal rights, a market-data adapter, or an execution-price gate.
 * Operator-supplied rights must be independently checked against provider contracts.
 * This module is intentionally not wired to orders or shared HTTP routes.
 */
const MARKETS = new Set(['US', 'CN']);
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const MAX_LIVE_AGE_MS = 60_000;

const denied = reason => Object.freeze({ allowed: false, reason, purpose: 'DISPLAY_ONLY' });

export function assessClientQuoteDisplay({ quote, rights, now = Date.now(), maxAgeMs = MAX_LIVE_AGE_MS } = {}) {
  if (!quote || typeof quote !== 'object' || !MARKETS.has(quote.market) ||
      typeof quote.symbol !== 'string' || !SYMBOL.test(quote.symbol) ||
      typeof quote.source !== 'string' || !quote.source.trim() ||
      !Number.isSafeInteger(quote.priceCents) || quote.priceCents <= 0 ||
      !Number.isFinite(quote.timestampMs)) return denied('INVALID_OR_UNSUPPORTED_QUOTE');

  // This flag may only come from server-side provider entitlements reviewed by
  // the operator. A provider token, `entitled:true` on a quote, or a widget is
  // NOT sufficient evidence of external display/re-distribution permission.
  if (!rights || rights.provider !== quote.source ||
      rights.externalClientDisplay !== true ||
      typeof rights.reviewReference !== 'string' || !rights.reviewReference.trim()) {
    return denied('EXTERNAL_DISPLAY_RIGHTS_UNVERIFIED');
  }

  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 ||
      maxAgeMs > MAX_LIVE_AGE_MS) return denied('INVALID_FRESHNESS_POLICY');

  const ageMs = now - quote.timestampMs;
  if (ageMs < -5_000 || ageMs > maxAgeMs) return denied('STALE_OR_FUTURE_QUOTE');

  return Object.freeze({
    allowed: true,
    purpose: 'DISPLAY_ONLY',
    market: quote.market,
    symbol: quote.symbol,
    source: quote.source,
    timestampMs: quote.timestampMs,
    ageMs,
    // This decision deliberately does not grant broker order execution.
    orderExecutionAllowed: false
  });
}

export function assessQuoteForOrderExecution() {
  return denied('BROKER_EXECUTION_NOT_SUPPORTED');
}