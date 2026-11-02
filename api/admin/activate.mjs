import handler from "../[...path].mjs";
export default function adminactivateRoute(req,res){
  req.url="/api/admin/activate";
  return handler(req,res);
}
