import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

function channels(hex) {
  return [...hex.slice(1).matchAll(/../g)].map(x=>parseInt(x[0],16)/255);
}
function luminance(hex) {
  const linear=channels(hex).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
}
function contrast(a,b) {
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
test("current dark trading workspace maintains readable text colors",async()=>{
 const css=await readFile(new URL("../web/styles.css",import.meta.url),"utf8");
 const roots=[...css.matchAll(/:root\s*\{([^}]*)\}/g)];
 assert.ok(roots.length>=2,"expected base and current theme layers");
 const root=roots.at(-1)[1];
 assert.match(root,/color-scheme:\s*dark/i);
 const colors=Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(v=>[v[1],v[2]]));
 for(const token of ["--tf-bg","--text","--muted","--tf-accent"])
   assert.match(colors[token]??"",/^#[0-9a-f]{6}$/i,"missing current theme "+token);
 assert.ok(contrast(colors["--text"],colors["--tf-bg"])>=7,"main text must satisfy enhanced text contrast");
 assert.ok(contrast(colors["--muted"],colors["--tf-bg"])>=4.5,"secondary text must satisfy normal text contrast");
 const metric=css.match(/\.metric-value\{font-weight:650;font-size:26px;color:(#[0-9a-f]{6})\}/i)?.[1];
 assert.ok(metric,"metric values must have an explicit color in the current theme");
 assert.ok(contrast(metric,colors["--tf-bg"])>=7,"metrics must remain readable");
});
