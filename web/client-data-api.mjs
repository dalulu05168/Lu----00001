// Shared authenticated data adapter for desktop and mobile terminals.
// The catalog is informational: it never supplies execution prices.
const MARKETS = new Set(["US", "CN"]);
const CODE = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;

export function normalizeInstrument(item) {
  if (!item || typeof item !== "object" || !MARKETS.has(item.market) ||
      typeof item.symbol !== "string" || !CODE.test(item.symbol)) return null;
  return {market:item.market, symbol:item.symbol};
}

export function normalizeCatalog(items) {
  if (!Array.isArray(items)) throw new Error("证券目录响应格式错误");
  return items.filter(item => item && ["STOCK","FUND","IPO"].includes(item.itemType))
    .map(item => {
      const ref = normalizeInstrument(item);
      if (!ref) return null;
      return {...ref, itemType:item.itemType,
        name:typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0,120) : ref.symbol};
    }).filter(Boolean);
}

export function normalizeWatchlist(items) {
  if (!Array.isArray(items)) throw new Error("自选列表响应格式错误");
  const seen = new Set();
  return items.map(normalizeInstrument).filter(item => {
    if (!item) return false;
    const id = item.market + ":" + item.symbol;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function requestAuthenticated(path, token, {method="GET", body, fetchImpl=fetch} = {}) {
  if (typeof token !== "string" || !token) throw Object.assign(new Error("请先登录"), {status:401});
  if (!["/account","/catalog","/watchlist"].includes(path)) throw new Error("Unsupported client data endpoint");
  const response = await fetchImpl("/api" + path,{
    method,
    headers:{"authorization":"Bearer " + token,"accept":"application/json",
      ...(body===undefined?{}:{"content-type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    cache:"no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status===401||response.status===403 ? "登录已失效，请重新登录"
      :response.status===503 ? "服务暂未就绪"
      :typeof data.error==="string" ? data.error : "数据请求失败";
    throw Object.assign(new Error(message), {status:response.status});
  }
  return data;
}

export async function readCatalog(token, fetchImpl=fetch) {
  const result=await requestAuthenticated("/catalog",token,{fetchImpl});
  return normalizeCatalog(result.items);
}
export async function readWatchlist(token, fetchImpl=fetch) {
  const result=await requestAuthenticated("/watchlist",token,{fetchImpl});
  return normalizeWatchlist(result.items);
}
export async function changeWatchlist(token, item, current, fetchImpl=fetch) {
  const ref=normalizeInstrument(item);
  if (!ref) throw new Error("无效的自选证券");
  if (!Array.isArray(current)) throw new Error("必须先同步自选列表");
  const exists=current.some(x=>x.market===ref.market&&x.symbol===ref.symbol);
  await requestAuthenticated("/watchlist",token,{method:exists?"DELETE":"POST",body:ref,fetchImpl});
  // A successful POST/DELETE acknowledges the request, not necessarily persistence.
  // Always re-read; never let the UI report saved/removed based on a local array.
  let verified;
  try {
    verified = await readWatchlist(token,fetchImpl);
  } catch (cause) {
    const error = new Error("自选请求已发送，但未能回读确认；请刷新列表核对结果");
    error.code = "WATCHLIST_READBACK_FAILED";
    error.status = cause?.status;
    throw error;
  }
  const nowExists = verified.some(item => item.market===ref.market && item.symbol===ref.symbol);
  if (nowExists===exists) {
    const error = new Error("自选请求已发送，但服务器没有确认变更；请刷新列表核对结果");
    error.code = "WATCHLIST_NOT_CONFIRMED";
    throw error;
  }
  return verified;
}
