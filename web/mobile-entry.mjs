// Keep the existing login page. Only redirect after the original app.mjs
// has validated /api/account and exposed the authenticated workspace.
const gate=document.getElementById("entryGate");
const desktop=document.getElementById("overview");
function deviceMode(){
 const preferred=sessionStorage.getItem("cn_view_mode");
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
function routeAfterAuthentication(){
 if(navigating||!deviceMode()||!sessionStorage.getItem("gsp_token"))return;
 if(!gate||!desktop)return;
 if(!desktop.hidden&&gate.hidden){
  navigating=true;
  location.replace("/mobile.html");
 }
}
if(gate&&desktop){
 const obs=new MutationObserver(routeAfterAuthentication);
 obs.observe(gate,{attributes:true,attributeFilter:["hidden"]});
 obs.observe(desktop,{attributes:true,attributeFilter:["hidden"]});
 routeAfterAuthentication();
}
