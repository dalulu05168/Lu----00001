export function optionalReason(value){
  if(value===undefined)return "";
  if(typeof value!=="string"||value.trim().length>400){
    throw Object.assign(new Error("Reason must be text of up to 400 characters"),{statusCode:400});
  }
  return value.trim();
}
