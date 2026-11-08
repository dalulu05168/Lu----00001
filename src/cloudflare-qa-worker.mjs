// Isolated Cloudflare QA preview entrypoint. No database or trading engine runs here.
const API_ROUTE = /^\/api(?:\/|$)/;
const BACKEND_ROUTE = /^\/(?:health|ready)$/;

function unavailable(reason = "QA backend is not configured") {
  return new Response(JSON.stringify({ error: "service_unavailable", message: reason }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function upstreamOrigin(value, publicUrl) {
  if (!value || typeof value !== "string") return null;
  try {
    const origin = new URL(value);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
        origin.pathname !== "/" || origin.search || origin.hash ||
        origin.host === publicUrl.host) return null;
    return origin;
  } catch {
    return null;
  }
}

async function serveAsset(request, env, targetPath) {
  const target = new URL(targetPath, request.url);
  const response = await env.ASSETS.fetch(new Request(target, request));
  if (targetPath !== "/login.html") return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isRead = request.method === "GET" || request.method === "HEAD";

    // Cloudflare's static asset default would otherwise serve desktop index.html at /.
    if (url.pathname === "/" && isRead) return serveAsset(request, env, "/login.html");
    if (url.pathname === "/login.html" && isRead) return serveAsset(request, env, "/login.html");
    if (url.pathname === "/mobile" && isRead) return serveAsset(request, env, "/mobile.html");
    if (url.pathname === "/admin" && isRead) return serveAsset(request, env, "/admin.html");

    if (API_ROUTE.test(url.pathname) || BACKEND_ROUTE.test(url.pathname)) {
      const origin = upstreamOrigin(env.QA_API_ORIGIN, url);
      if (!origin) return unavailable();
      // Internal orders are never enabled just because a preview UI becomes reachable.
      if (url.pathname === "/api/orders" && request.method !== "GET" &&
          env.QA_INTERNAL_ORDERS_ENABLED !== "true") {
        return unavailable("Internal orders are disabled in this preview");
      }
      const upstreamUrl = new URL(url.pathname + url.search, origin);
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cookie");
      try {
        const upstream = await fetch(new Request(upstreamUrl, {
          method: request.method,
          headers,
          body: isRead ? undefined : request.body,
          redirect: "manual",
          duplex: isRead ? undefined : "half",
        }));
        if (upstream.status >= 300 && upstream.status < 400) {
          return unavailable("Unexpected backend redirect");
        }
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete("set-cookie");
        responseHeaders.set("cache-control", "no-store");
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch {
        return unavailable("QA backend is unreachable");
      }
    }

    return env.ASSETS.fetch(request);
  },
};
