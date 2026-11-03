declare const process:{env:{EXPO_PUBLIC_PRIVACY_POLICY_URL?:string;EXPO_PUBLIC_API_BASE_URL?:string}};
export function safeHttpsUrl(raw:string|undefined):string|null{
  if(!raw||raw.trim()!==raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.username||url.password||url.hash||url.hostname==="localhost"||
       url.hostname.endsWith(".local")||url.hostname.endsWith(".example"))return null;
    return url.href;
  }catch{return null;}
}
export function privacyPolicyUrl():string|null{
  return safeHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
}
export function externalDeletionUrl():string|null{
  const base=safeHttpsUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if(!base)return null;
  const root=new URL(base);
  if(root.pathname!=="/"||root.search)return null;
  return new URL("/account-deletion",root.origin).href;
}
