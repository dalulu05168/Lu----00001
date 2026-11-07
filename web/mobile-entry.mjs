// Keep the existing login page. Only redirect after the original app.mjs
// has validated /api/account and exposed the authenticated workspace.
const gate=document.getElementById("entryGate");
const desktop=document.getElementById("overview");
function deviceMode(){
 const requested=new URLSearchParams(location.search||"").get("view");
 const preferred=["desktop","mobile"].includes(requested)?requested:sessionStorage.getItem("cn_view_mode");
 if(preferred==="desktop")return false;
 if(preferred==="mobile")return true;
 const ua=navigator.userAgent||"";
 const phone=/Android.*Mobile|iPhone|iPod|Windows Phone|Mobile Safari/i.test(ua);
 const tablet=/iPad|Tablet/i.test(ua)||(/Android/i.test(ua)&&!/Mobile/i.test(ua));
 const narrow=matchMedia("(max-width:767px)").matches;
 const touch=matchMedia("(pointer:coarse)").matches;
 return phone || (narrow&&touch&&!tablet);
}
let navigating=false;
async function routeAfterAuthentication(){
 if(navigating||!sessionStorage.getItem("gsp_token"))return;
 if(!gate||!desktop)return;
 if(!desktop.hidden&&gate.hidden){
  if(!deviceMode()){
   const qaHosts=["localhost","127.0.0.1","cn-capital-phone-qa-p6ma.onrender.com"];
   if(qaHosts.includes(location.hostname)&&!new URLSearchParams(location.search).has("classic")){
    navigating=true;
    location.replace("/front-approved.html");
   }
   return;
  }
  navigating=true;
  try{
   if(!["www.nuvexapro.com","nuvexapro.com"].includes(location.hostname)){
    location.replace("/mobile.html");return;
   }
   const response=await fetch("/api/auth/mobile-session",{method:"POST",cache:"no-store",
    headers:{authorization:"Bearer "+sessionStorage.getItem("gsp_token")}});
   if(!response.ok)throw Error("Mobile sign-in unavailable");
   const result=await response.json();
   if(result.url==="/mobile.html"){location.replace(result.url);return;}
   if(result.url!=="https://m.nuvexapro.com/"||typeof result.handoff!=="string"||
    !/^[A-Za-z0-9_-]{43}$/.test(result.handoff))throw Error("Invalid mobile destination");
   location.replace(result.url+"#handoff="+result.handoff);
  }catch{
   navigating=false;
   // The authenticated desktop workspace remains usable after a failed handoff.
   const retry=document.createElement("button");
   retry.type="button";retry.textContent="进入手机端";
   retry.addEventListener("click",()=>{retry.remove();void routeAfterAuthentication();});
   desktop.prepend(retry);
  }
 }
}
if(gate&&desktop){
 const obs=new MutationObserver(routeAfterAuthentication);
 obs.observe(gate,{attributes:true,attributeFilter:["hidden"]});
 obs.observe(desktop,{attributes:true,attributeFilter:["hidden"]});
 routeAfterAuthentication();
}
