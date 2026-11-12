const assert=require('node:assert/strict');
// Measure visible, real controls after layout; do not infer styles from source text.
module.exports=async function designContract(page,label,selectors,{touch=false}={}){
 await page.locator(selectors[0]).evaluate(async el=>{const surface=el.closest('dialog,.cp-dialog,.cp,.pg')||el;await Promise.all(surface.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))});
 const expected='-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
 const result=await page.evaluate(selectors=>({url:location.href,sharedStyle:!!document.getElementById('cn-design-system'),bodyFont:getComputedStyle(document.body).fontFamily,items:selectors.map(selector=>{
  const el=document.querySelector(selector);if(!el)throw Error('Missing design control '+selector);
  const css=getComputedStyle(el),box=el.getBoundingClientRect();
  const matched=[];function visit(rules){for(const rule of rules){if(rule.selectorText){try{if(el.matches(rule.selectorText)&&['min-height','border-radius','font-size'].some(p=>rule.style.getPropertyValue(p)))matched.push(rule.cssText)}catch{}}else if(rule.cssRules)visit(rule.cssRules)}}for(const sheet of document.styleSheets){try{visit(sheet.cssRules)}catch{}}
  return {selector,font:css.fontFamily,size:parseFloat(css.fontSize),height:box.height,radius:parseFloat(css.borderRadius),overflow:el.scrollWidth>el.clientWidth+1,matched};
 })}),selectors);
 assert.equal(result.bodyFont,expected,label+' body font');
 for(const item of result.items){
  assert.equal(item.font,expected,label+' '+item.selector+' font');
  assert(item.size>=14,label+' '+item.selector+' unreadable type '+JSON.stringify(item));
  assert(item.height>0&&!item.overflow,label+' '+item.selector+' clipped control');
  if(item.selector.includes('button')){assert(item.height>=(touch?44:40)-.1,label+' touch target '+JSON.stringify(result));assert(item.radius>=20,label+' capsule shape '+JSON.stringify(result));}
 }
 return {label,...result};
};
