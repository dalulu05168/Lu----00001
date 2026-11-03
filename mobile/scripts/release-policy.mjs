import {readFile} from "node:fs/promises";

function https(value){
  if(typeof value!=="string"||!value.trim()||value.trim()!==value)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.hash||
       url.hostname==="localhost"||url.hostname.endsWith(".example")||url.hostname.endsWith(".local"))
      return null;
    return url;
  }catch{return null;}
}
export function releaseIssues(app,env){
  const issues=[];
  const expo=app?.expo;
  if(expo?.name!=="NuvexaPro"||expo?.slug!=="nuvexapro-client")
    issues.push("Current NuvexaPro branding must remain intact for this release.");
  if(!/^([a-zA-Z][\w]*\.)+[a-zA-Z][\w]*$/.test(expo?.ios?.bundleIdentifier||""))
    issues.push("Valid iOS bundle identifier is missing.");
  if(!/^([a-zA-Z][\w]*\.)+[a-zA-Z][\w]*$/.test(expo?.android?.package||""))
    issues.push("Valid Android package identifier is missing.");
  if(!expo?.extra?.eas?.projectId)issues.push("Expo project ID has not been linked to its authorized owner.");
  const api=https(env.EXPO_PUBLIC_API_BASE_URL), privacy=https(env.EXPO_PUBLIC_PRIVACY_POLICY_URL), support=https(env.RELEASE_SUPPORT_URL);
  if(!api||api.pathname!=="/"||api.search)issues.push("EXPO_PUBLIC_API_BASE_URL must be the verified HTTPS API origin with no path or query.");
  if(!privacy)issues.push("EXPO_PUBLIC_PRIVACY_POLICY_URL must be the public, operator-approved HTTPS policy.");
  if(!support)issues.push("RELEASE_SUPPORT_URL must be the working public HTTPS support resource.");
  if(!env.RELEASE_LEGAL_ENTITY?.trim())issues.push("RELEASE_LEGAL_ENTITY must name the verified operator (not a guessed brand).");
  if(!env.RELEASE_ALLOWED_COUNTRIES?.trim())issues.push("RELEASE_ALLOWED_COUNTRIES must be authorized jurisdictions.");
  const approvals={
    RELEASE_IOS_STORE_ACCOUNT_VERIFIED:"Apple developer account and signing ownership not verified.",
    RELEASE_ANDROID_STORE_ACCOUNT_VERIFIED:"Google Play developer account and signing ownership not verified.",
    RELEASE_APP_IDS_APPROVED:"Immutable Android/iOS application identifiers not approved.",
    RELEASE_FINANCIAL_LEGAL_REVIEW:"Financial service disclosure and permissible distribution not approved.",
    RELEASE_DATA_RETENTION_APPROVED:"Privacy, retention and final erasure scope not approved.",
    RELEASE_DELETION_PROCESS_OPERATIONAL:"A real monitored and executable account erasure workflow is not in service.",
    RELEASE_PRIVACY_DISCLOSURES_APPROVED:"App Privacy and Google Data safety declarations not verified.",
    RELEASE_REVIEW_ACCOUNT_READY:"App review account credentials not configured privately in store consoles.",
    RELEASE_DEVICE_TESTS_PASSED:"iOS and Android physical-device acceptance not confirmed."
  };
  for(const [key,message]of Object.entries(approvals))
    if(env[key]!=="true")issues.push(message+" ["+key+"]");
  return issues;
}
export async function liveReleaseChecks(env,fetcher=fetch){
  const base=https(env.EXPO_PUBLIC_API_BASE_URL),privacy=https(env.EXPO_PUBLIC_PRIVACY_POLICY_URL),support=https(env.RELEASE_SUPPORT_URL);
  if(!base||!privacy||!support)throw new Error("Live checks require verified HTTPS URLs.");
  const tests=[
    {label:"Backend readiness",url:new URL("/ready",base.origin).href,type:"json"},
    {label:"External account deletion",url:new URL("/account-deletion",base.origin).href,type:"html"},
    {label:"Privacy policy",url:privacy.href,type:"legal"},
    {label:"Support resource",url:support.href,type:"legal"}
  ];
  const results=[];
  for(const t of tests){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetcher(t.url,{redirect:"follow",signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      if(t.type==="json"){
        const body=await response.json();
        if(body?.status!=="ready"||body?.database!=="connected")
          throw new Error("Database/application not ready");
      }else if(t.type==="html"){
        const html=await response.text();
        if(!html.includes("deletionForm")||!html.includes("NuvexaPro"))throw new Error("Deletion form not deployed");
      }else {
        const body=await response.text();
        if(body.trim().length<100)throw new Error("Policy/support document content is incomplete");
      }
      results.push({name:t.label,passed:true});
    }catch(e){results.push({name:t.label,passed:false,reason:e instanceof Error?e.message:String(e)});}
    finally{clearTimeout(timeout);}
  }
  return results;
}
export async function loadAppConfig(){
  return JSON.parse(await readFile(new URL("../app.json",import.meta.url),"utf8"));
}
