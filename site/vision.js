"use strict";
/* Decorative corporate design system. Figures are art, not market data. */
(() => {
  const body=document.body;
  const page=body?.dataset.page;
  if(!page)return;
  const orbital=document.querySelector(".orbit-field");
  if(orbital){
    const meridians=[34,72,116].map(rx=>'<ellipse cx="240" cy="240" rx="'+rx+'" ry="174"/>').join("");
    const parallels=[45,91,129].map(ry=>'<ellipse cx="240" cy="240" rx="174" ry="'+ry+'"/>').join("");
    const svg=document.createElement("div");
    svg.innerHTML='<svg class="orb-topology" viewBox="0 0 480 480" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="wire" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5d2a0" stop-opacity=".72"/><stop offset=".55" stop-color="#b68a4b" stop-opacity=".27"/><stop offset="1" stop-color="#9bbdbd" stop-opacity=".08"/></linearGradient><clipPath id="clipWire"><circle cx="240" cy="240" r="174"/></clipPath></defs><g stroke="url(#wire)" stroke-width=".92" clip-path="url(#clipWire)"><circle cx="240" cy="240" r="174"/>'+meridians+parallels+'<path d="M65 240H415M82 164H398M82 316H398M127 110H353M127 370H353"/></g><circle cx="240" cy="240" r="201" stroke="#d3ab77" stroke-opacity=".4" stroke-width=".75"/><circle cx="240" cy="240" r="225" stroke="#d3ab77" stroke-opacity=".17" stroke-dasharray="3 10"/><path d="M36 246C100 89 340 47 447 180" stroke="#efc689" stroke-opacity=".8" stroke-width="1.4"/><path d="M60 333C177 468 355 433 432 288" stroke="#edbd72" stroke-opacity=".63" stroke-width="1.2"/><circle cx="89" cy="143" r="3" fill="#f8d69e"/><circle cx="389" cy="336" r="2.5" fill="#ebc388"/></svg>';
    orbital.append(svg.firstChild);
    const title=document.createElement("span");
    title.className="orb-sig";title.textContent="C N  /  G L O B A L   I N T E R F A C E";
    orbital.append(title);
    const core=orbital.querySelector(".orb-core");
    if(core)core.replaceChildren();
  }
  if(page==="home"){
    const headline=document.querySelector(".hero h1");
    if(headline)headline.innerHTML='A new<br>perspective<br><em>on markets.</em>';
    const section=document.querySelector(".capabilities");
    if(section){
      const art=document.createElement("section");
      art.className="art-manifest section-shell";
      art.setAttribute("aria-label","Our design perspective");
      art.innerHTML='<div class="reveal"><span class="manifest-eyebrow">A CLEARER KIND OF VIEW / 001</span><h2>Information with<br><em>perspective.</em></h2></div><p class="reveal">Purposeful market categories and account visibility, thoughtfully organized. A design preview, not a live trading service.</p>';
      section.before(art);
    }
  }
  const hero=document.querySelector(".inner-hero");
  if(hero && page!=="home"){
    const copy=document.createElement("div");
    copy.className="inner-copy";
    while(hero.firstChild)copy.append(hero.firstChild);
    hero.append(copy);
    const labels={
      platform:["MARKET CATEGORIES / DESIGN STUDY","US · HK · CN · MY","ILLUSTRATIVE / NOT LIVE"],
      company:["OUR OPERATING PRINCIPLES","CLARITY · HONEST BOUNDARIES · CONTINUITY","A DIRECTION FOR PRODUCT DESIGN"],
      contact:["VERIFIED COMMUNICATION","CONTACT DETAILS","PENDING VERIFICATION"],
      legal:["DISCLOSURE / IMPORTANT INFORMATION","SCOPE & RESPONSIBILITY","PREVIEW / NOT AN INVESTMENT OFFER"]
    };
    const label=labels[page]||labels.legal;
    const art=document.createElement("div");
    art.className="inner-art inner-art-"+page;
    art.setAttribute("aria-label","Abstract "+page+" illustration, not live financial information");
    art.innerHTML='<span class="fig-caption">'+label[0]+'</span><div class="fig-geometry" aria-hidden="true"><i class="ring"></i><i class="ring"></i><i class="ring"></i><i class="ring"></i><span class="fig-letter">CN</span><span class="fig-lines"></span></div><span class="fig-strip"><span>'+label[1]+'</span><span>01 / 04</span></span><span class="fig-foot">'+label[2]+'</span>';
    hero.append(art);
  }
})();
