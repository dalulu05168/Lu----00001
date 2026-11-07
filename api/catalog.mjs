import handler from "./[...path].mjs";
export default function route(req,res){req.url="/api/catalog";return handler(req,res);}
