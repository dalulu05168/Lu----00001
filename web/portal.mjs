/* Decorative particles travel toward the shared NuvexaPro brand, then drift.
   No credentials, auth state or API activity is handled by this file. */
const portals=document.querySelectorAll(".portal");
for(const portal of portals){
  const canvas=portal.querySelector(".portal-stars");
  const ctx=canvas?.getContext?.("2d");
  if(!ctx)continue;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true;
  const count=reduced?50:(window.innerWidth<600?125:250);
  const particles=[];
  let width=0,height=0,frame=0,raf=0;
  function resize(){
    const rect=portal.getBoundingClientRect();
    width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    const dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();
  const logo=portal.querySelector(".portal-logo");
  for(let i=0;i<count;i++){
    const x=(Math.sin(i*66.31)*43758.5453%1+1)%1,y=(Math.sin(i*17.71)*16384.245%1+1)%1;
    particles.push({x:x*width,y:y*height,originX:x*width,originY:y*height,
      phase:i*.618,shape:i%2,size:0.35+(i%6)*.22,alpha:.25+(i%7)*.09});
  }
  function tick(){
    const rect=logo?.getBoundingClientRect();
    const box=portal.getBoundingClientRect();
    const cx=rect?rect.left-box.left+rect.width/2:width/2;
    const cy=rect?rect.top-box.top+rect.height/2:height*.3;
    const elapsed=frame/60;
    const gather=Math.min(1,Math.max(0,(elapsed-.22)/2.6));
    const relax=Math.min(1,Math.max(0,(elapsed-3.5)/2));
    ctx.clearRect(0,0,width,height);
    for(const p of particles){
      const t=p.phase*6.283;
      const toX=cx+Math.sin(t)*34,toY=cy+Math.cos(t)*21;
      const converge=gather*(1-relax*.88);
      const x=p.originX*(1-converge)+toX*converge+Math.sin(elapsed*.25+t)*3;
      const y=p.originY*(1-converge)+toY*converge+Math.cos(elapsed*.22+t)*3;
      ctx.beginPath();ctx.fillStyle=p.shape?"rgba(237,187,113,"+p.alpha+")":"rgba(87,175,233,"+p.alpha+")";
      ctx.arc(x,y,p.size,0,6.283);ctx.fill();
    }
    frame++;
    if(!reduced)raf=requestAnimationFrame(tick);
  }
  tick();
  const observer=new IntersectionObserver(entries=>{
    if(entries[0].isIntersecting&&!reduced&&!raf)raf=requestAnimationFrame(tick);
    else if(!entries[0].isIntersecting&&raf){cancelAnimationFrame(raf);raf=0}
  });
  observer.observe(portal);
  window.addEventListener("resize",resize,{passive:true});
}
