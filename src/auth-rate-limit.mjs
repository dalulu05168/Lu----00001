// In-process throttling for credential and enrollment endpoints.
// Counters live in memory, so each server instance enforces its own limits.
// That suits the single Render web service; multi-instance or serverless
// deployments would need a shared store for the same guarantee.

const MINUTE = 60_000;

export const DEFAULT_AUTH_LIMITS = Object.freeze({
  // Failed password attempts for one account identity (email) before a lockout.
  accountFailures: { max: 8, windowMs: 15 * MINUTE },
  // Failed credential/invitation/setup attempts from one client address.
  ipFailures: { max: 50, windowMs: 15 * MINUTE },
  // All registration attempts from one client address (successful or not).
  registrations: { max: 10, windowMs: 60 * MINUTE }
});

/**
 * Client address used for throttling. Render and Vercel append the connecting
 * address to X-Forwarded-For, so the right-most entry is the one the platform
 * proxy observed; left-most entries can be supplied by the caller.
 * AUTH_CLIENT_IP_HEADER can name a header set by a trusted edge proxy
 * (for example cf-connecting-ip when Cloudflare fronts the service).
 */
export function clientAddress(req, headerName = process.env.AUTH_CLIENT_IP_HEADER) {
  const headers = req.headers ?? {};
  if (headerName) {
    const value = String(headers[headerName.toLowerCase()] ?? "").trim();
    if (value) return value.slice(0, 64);
  }
  const forwarded = String(headers["x-forwarded-for"] ?? "")
    .split(",").map(part => part.trim()).filter(Boolean);
  if (forwarded.length) return forwarded.at(-1).slice(0, 64);
  return String(req.socket?.remoteAddress ?? "unknown").slice(0, 64);
}

export function createAuthRateLimiter({ limits = DEFAULT_AUTH_LIMITS, now = Date.now, maxEntries = 20000 } = {}) {
  const buckets = new Map();

  function bucket(kind, key) {
    const id = kind + "\u0000" + key;
    const { windowMs } = limits[kind];
    const time = now();
    let entry = buckets.get(id);
    if (!entry || time - entry.start >= windowMs) {
      entry = { start: time, count: 0 };
      if (!buckets.has(id) && buckets.size >= maxEntries) prune(time);
      buckets.set(id, entry);
    }
    return entry;
  }
  function prune(time) {
    for (const [id, entry] of buckets) {
      const kind = id.slice(0, id.indexOf("\u0000"));
      if (time - entry.start >= limits[kind].windowMs) buckets.delete(id);
    }
    // Still full: drop the oldest entries rather than grow without bound.
    while (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
  }
  function retryAfter(kind, key) {
    const entry = bucket(kind, key);
    if (entry.count < limits[kind].max) return 0;
    return Math.max(1, Math.ceil((entry.start + limits[kind].windowMs - now()) / 1000));
  }

  return {
    /** Seconds to wait before another attempt, or 0 when allowed. */
    blocked(checks) {
      let wait = 0;
      for (const [kind, key] of checks) if (key) wait = Math.max(wait, retryAfter(kind, key));
      return wait;
    },
    record(checks) {
      for (const [kind, key] of checks) if (key) bucket(kind, key).count++;
    },
    reset(kind, key) {
      if (key) buckets.delete(kind + "\u0000" + key);
    }
  };
}

export function normalizedEmailKey(scope, email) {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  return value && value.length <= 254 ? scope + ":" + value : null;
}

export function sendRateLimited(res, seconds) {
  res.writeHead(429, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(seconds)
  });
  res.end(JSON.stringify({ error: "Too many attempts; retry later" }));
}
