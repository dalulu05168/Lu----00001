import handler from "../[...path].mjs";
export default function adminloginRoute(req,res){
  req.url="/api/admin/login";
  return handler(req,res);
}
