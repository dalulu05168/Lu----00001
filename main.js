"use strict";
(function () {
  const menu=document.getElementById("menuToggle"),nav=document.getElementById("primaryNav");
  if(menu && nav){menu.addEventListener("click",function(){const open=menu.getAttribute("aria-expanded")!=="true";menu.setAttribute("aria-expanded",String(open));menu.setAttribute("aria-label",open?"Close navigation":"Open navigation");nav.classList.toggle("open",open);});nav.querySelectorAll("a").forEach(function(a){a.addEventListener("click",function(){nav.classList.remove("open");menu.setAttribute("aria-expanded","false");});});}
  document.querySelectorAll(".year").forEach(function(el){el.textContent=String(new Date().getFullYear());});
  const motionOK=!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveal=document.querySelectorAll(".reveal");
  if("IntersectionObserver" in window && motionOK){const observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add("visible");observer.unobserve(entry.target);}});},{threshold:.07});reveal.forEach(function(x){observer.observe(x);});}else{reveal.forEach(function(x){x.classList.add("visible");});}
  const field=document.getElementById("orbitField");
  if(field && motionOK && window.matchMedia("(pointer:fine)").matches){const target=document.querySelector(".hero-art");target.addEventListener("pointermove",function(e){const r=target.getBoundingClientRect(),x=((e.clientX-r.left)/r.width-.5)*8,y=((e.clientY-r.top)/r.height-.5)*8;field.style.transform="rotateX("+(-y)+"deg) rotateY("+x+"deg)";});target.addEventListener("pointerleave",function(){field.style.transform="";});}
  const chart=document.getElementById("chartLine"),area=document.getElementById("chartArea"),name=document.getElementById("marketName");
  const markets={US:{label:"UNITED STATES",seed:1.4},HK:{label:"HONG KONG",seed:2.6},CN:{label:"MAINLAND CHINA",seed:3.8},MY:{label:"MALAYSIA",seed:5.1}};
  function plot(code){if(!chart||!area||!name)return;const m=markets[code]||markets.US;name.textContent=m.label;const n=56,coords=[];for(let i=0;i<n;i++){const x=i*620/(n-1);const y=122-42*Math.sin(i*.13+m.seed)-21*Math.cos(i*.38+m.seed*.5)-11*Math.sin(i*.91+m.seed);coords.push([x,Math.max(32,Math.min(208,y))]);}const d=coords.map(function(p,i){return(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1);}).join(" ");chart.setAttribute("d",d);area.setAttribute("d",d+" L620 230 L0 230 Z");}
  if(chart){plot("US");document.querySelectorAll("[data-market]").forEach(function(btn){btn.addEventListener("click",function(){document.querySelectorAll("[data-market]").forEach(function(b){b.setAttribute("aria-pressed",String(b===btn));});plot(btn.dataset.market);});});}
})();
