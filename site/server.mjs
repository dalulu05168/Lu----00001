import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
const host="0.0.0.0";
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid PORT");
const names=new Set(["index.html","platform.html","company.html","contact.html","legal.html","style.css","main.js","brand.png","robots.txt"]);
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".png":"image/png",".txt":"text/plain; charset=utf-8"};
const server=createServer(async(req,res)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Cache-Control","public, max-age=60");
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405,{"Allow":"GET, HEAD"});res.end();return;}
  let path;
  try{path=new URL(req.url||"/","http://localhost").pathname;}catch{res.writeHead(400);res.end();return;}
  const aliases={"/":"index.html","/platform":"platform.html","/company":"company.html","/contact":"contact.html","/legal":"legal.html"};
  const name=aliases[path]||path.slice(1);
  if(!names.has(name)||path.includes("%")||path.includes("\\")){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("Not found");return;}
  try{
    const data=await readFile(new URL("./"+name,import.meta.url));
    const ext=name.slice(name.lastIndexOf("."));
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Content-Length":data.length});
    res.end(req.method==="HEAD"?undefined:data);
  }catch{res.writeHead(500);res.end("Site asset unavailable");}
});
server.listen(port,host,()=>console.log("CN Capital preview listening on "+port));