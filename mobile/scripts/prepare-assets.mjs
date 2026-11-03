import {readFile,mkdir} from "node:fs/promises";
import sharp from "sharp";
const assets=new URL("../assets/",import.meta.url);
await mkdir(assets,{recursive:true});
const svg=await readFile(new URL("../assets/brand.svg",import.meta.url));
const mark=await sharp(svg).resize(610,610,{fit:"contain"}).png().toBuffer();
const center={input:mark,left:207,top:207};
await sharp({create:{width:1024,height:1024,channels:4,background:"#111722"}})
  .composite([center]).flatten({background:"#111722"}).removeAlpha().png().toFile(new URL("../assets/icon.png",import.meta.url).pathname);
await sharp({create:{width:1024,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
  .composite([center]).png().toFile(new URL("../assets/adaptive-icon.png",import.meta.url).pathname);
console.log("Prepared 1024x1024 app icons from the existing platform SVG mark.");
