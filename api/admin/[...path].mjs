import handler from "../[...path].mjs";
export default function adminCatchall(req,res){
  return handler(req,res);
}
