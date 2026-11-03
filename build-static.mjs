import {cpSync,mkdirSync,rmSync,existsSync,statSync} from "node:fs";
import {resolve} from "node:path";
const root=process.cwd();
const out=resolve(root,"dist");
const publish=["index.html","platform.html","company.html","contact.html","legal.html","style.css","main.js","brand.png","robots.txt"];
for(const name of publish){const file=resolve(root,name);if(!existsSync(file)||!statSync(file).isFile())throw new Error("Missing website asset: "+name);}
rmSync(out,{force:true,recursive:true});
mkdirSync(out,{recursive:true});
for(const name of publish)cpSync(resolve(root,name),resolve(out,name));
console.log("Website static dist created ("+publish.length+" reviewed public assets); no client login or backend code published.");
