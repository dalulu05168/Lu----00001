import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const pages=["index.html","platform.html","company.html","contact.html","legal.html"];
const htmls=pages.map(p=>[p,readFileSync(new URL("./"+p,import.meta.url),"utf8")]);
for(const [file,html] of htmls){
 assert.match(html,/<!doctype html>/i,file+" doctype");
 assert.match(html,/<html lang="en">/i,file+" language");
 assert.match(html,/name="viewport"/i,file+" viewport");
 assert.match(html,/id="main"/,file+" main target");
 assert.match(html,/CN Capital/,file+" branding");
 assert.match(html,/src="brand.png"/,file+" original logo");
 assert.match(html,/style.css/,file+" css");
 assert.match(html,/main.js/,file+" js");
 assert.match(html,/legal.html/,file+" legal notice link");
 assert.match(html,/No live brokerage execution|No live brokerage execution|No brokerage connectivity or live execution/i,file+" scope");
 assert.ok(!/lorem ipsum|guaranteed returns|regulated investment firm|real[- ]time prices available/i.test(html),file+" forbidden claims");
 const local=[...html.matchAll(/href="([^"#][^"]*)"/g)].map(x=>x[1]).filter(x=>!x.includes(":"));
 for(const link of local){const path=link.split("#")[0];assert.ok(existsSync(new URL("./"+path,import.meta.url)),file+" broken link "+link);}
}
const app=readFileSync(new URL("./main.js",import.meta.url),"utf8");
assert.match(app,/prefers-reduced-motion/);
assert.match(app,/setAttribute\("aria-pressed"/);
assert.match(readFileSync(new URL("./style.css",import.meta.url),"utf8"),/@media\(max-width:700px\)/);
assert.ok(existsSync(new URL("./brand.png",import.meta.url)));
console.log("PASS 5 pages, original logo, navigation, accessibility hooks, market-category controls, release notices");
