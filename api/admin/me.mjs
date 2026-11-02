import handler from "../[...path].mjs";
export default function me(req,res){req.url="/api/admin/me";return handler(req,res);}
