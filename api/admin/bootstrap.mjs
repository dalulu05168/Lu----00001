import handler from "../[...path].mjs";
export default function adminbootstrapRoute(req,res){
  req.url="/api/admin/bootstrap";
  return handler(req,res);
}
