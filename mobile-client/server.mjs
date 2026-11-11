import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const upstream=new URL(process.env.MOBILE_API_ORIGIN||'http://127.0.0.1:8931');
if(!['127.0.0.1','localhost','[::1]'].includes(upstream.hostname)||upstream.protocol!=='http:')throw Error('Only isolated loopback HTTP API allowed');
const port=Number(process.env.MOBILE_PORT||8930);
const allowed=new Set(['/api/auth/login','/api/auth/register','/api/auth/password-reset/request','/api/auth/password-reset/confirm','/api/auth/logout','/api/account','/api/catalog','/api/watchlist','/api/announcements','/api/products','/api/order-results','/api/product-settlement','/api/products/quote','/api/fund-subscriptions','/api/bulk-orders','/api/requests','/api/profile-documents','/api/support','/api/withdrawal-pin','/api/notifications']);
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(!allowed.has(url.pathname)){res.writeHead(501,{'content-type':'application/json'});res.end(JSON.stringify({error:'此接口尚未加入手机端隔离适配'}));return;}
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>6*1024*1024){res.writeHead(413);res.end();return;}chunks.push(c);}
   const headers={accept:'application/json'};for(const h of ['authorization','content-type','idempotency-key'])if(req.headers[h])headers[h]=req.headers[h];
   const r=await fetch(new URL(url.pathname+url.search,upstream),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(25000)});
   res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json','cache-control':'no-store'});res.end(Buffer.from(await r.arrayBuffer()));return;
  }
  if(url.pathname==='/'&&process.env.MOBILE_BUNDLE_INDEX){const html=await readFile(process.env.MOBILE_BUNDLE_INDEX);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);return;}
  const rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);const filename=path.resolve(root,'.'+rel);
  if(!filename.startsWith(root)||path.basename(filename).includes('.test.')||!['.html','.css','.mjs'].includes(path.extname(filename))||filename.endsWith('server.mjs')){res.writeHead(404);res.end();return;}
  const contents=await readFile(filename);res.writeHead(200,{'content-type':{'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'application/javascript; charset=utf-8'}[path.extname(filename)],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(contents);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:502,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code==='ENOENT'?'文件不存在':'隔离 API 连接失败，请启动测试服务'}));}
}).listen(port,'127.0.0.1',()=>console.log(`Mobile integration: http://127.0.0.1:${port} → ${upstream.origin}`));



