export type Position = {market:string; symbol:string; quantity:number | string};
export type Order = {
  id:string; market:string; symbol:string; side:string; quantity:number | string;
  price_cents:number | string | null; amount_usd_cents:number | string | null; created_at:string;
};
export type Snapshot = {
  account:{id:string; cashCents:number; currency:string};
  positions:Position[]; orders:Order[]; disclosure:string;
};
export type WatchItem = {market:string; symbol:string; createdAt?:string};
export type SupportMessage = {id:string; body:string; createdAt:string; senderUserId:string};
export type SupportSnapshot = {thread:null | {id:string; status:string}; messages:SupportMessage[]};

export class ApiError extends Error {
  readonly status:number;
  constructor(message:string,status:number) { super(message); this.name="ApiError"; this.status=status; }
}
export function verifiedApiBase():string {
  const value=(process.env.EXPO_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");
  try {
    const url=new URL(value);
    if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || url.pathname!=="/") throw new Error("Invalid API URL");
    return url.origin;
  } catch {
    throw new ApiError("尚未配置经过验证的 HTTPS 服务地址，App 暂不能登录。",0);
  }
}
export async function apiRequest<T>(
  path:string,
  opts:{token?:string; method?:"GET"|"POST"|"DELETE"; body?:object}={}
):Promise<T> {
  if(!path.startsWith("/") || path.startsWith("//") || !/^\/[a-zA-Z0-9/?=&_-]+$/.test(path)) throw new ApiError("无效的 API 路径",0);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  let response:Response;
  try {
    response=await fetch(verifiedApiBase()+"/api"+path,{
      method:opts.method||"GET",
      headers:{"accept":"application/json", ...(opts.body?{"content-type":"application/json"}:{}), ...(opts.token?{"authorization":"Bearer "+opts.token}:{})},
      ...(opts.body?{body:JSON.stringify(opts.body)}:{}),
      signal:controller.signal
    });
  } catch(error) {
    if(error instanceof ApiError) throw error;
    throw new ApiError("无法连接账户服务器，请检查网络或服务器状态。",0);
  } finally { clearTimeout(timer); }
  const data=response.status===204?{}:await response.json().catch(()=>null);
  if(!response.ok) {
    const reason=typeof data?.error==="string"?data.error:"请求失败";
    if(response.status===401)throw new ApiError("登录状态已过期，请重新登录。",401);
    if(response.status===503)throw new ApiError("服务暂不可用，账户数据未更新。",503);
    throw new ApiError(reason,response.status);
  }
  return data as T;
}
export async function login(email:string,password:string):Promise<{token:string;expiresAt:string}> {
  return apiRequest("/auth/login",{method:"POST",body:{email:email.trim().toLowerCase(),password}});
}
export async function accountSnapshot(token:string):Promise<Snapshot> {
  const data=await apiRequest<Snapshot>("/account",{token});
  if(!data?.account || !Array.isArray(data.positions) || !Array.isArray(data.orders)) throw new ApiError("服务端账户数据格式不正确。",0);
  return data;
}
export async function watchlist(token:string):Promise<WatchItem[]> {
  const data=await apiRequest<{items:WatchItem[]}>("/watchlist",{token});
  if(!Array.isArray(data?.items))throw new ApiError("自选列表格式错误。",0);
  return data.items;
}
export async function changeWatchlist(token:string,item:{market:string;symbol:string},remove=false):Promise<void> {
  await apiRequest("/watchlist",{token,method:remove?"DELETE":"POST",body:item});
}
export async function support(token:string):Promise<SupportSnapshot> {
  const data=await apiRequest<SupportSnapshot>("/support",{token});
  if(!Array.isArray(data?.messages))throw new ApiError("客服消息格式错误。",0);
  return data;
}
export async function sendSupport(token:string,message:string):Promise<void> {
  await apiRequest("/support",{token,method:"POST",body:{message}});
}
export async function logout(token:string):Promise<void> {
  await apiRequest("/auth/logout",{token,method:"POST"});
}
