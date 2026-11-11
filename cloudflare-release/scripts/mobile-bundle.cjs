const fs=require('node:fs'),path=require('node:path');
// Bundle only local named ES module imports; no network or dependency installation.
module.exports=function mobileBundle(root,{production=false}={}){
 const modules=new Map(),chunks=[];
 function visit(file){
  file=path.resolve(root,file);if(!file.startsWith(path.resolve(root)+path.sep))throw Error('Module outside mobile root');
  if(modules.has(file))return modules.get(file);
  const id='__mobile'+modules.size;modules.set(file,id);
  let source=fs.readFileSync(file,'utf8'),exports=[];
  if(production){
   source=source.replace(/<div class="integration-tag">[^<]*<\/div>/g,'');
   for(const [from,to] of Object.entries({'注册测试账户':'注册账户','请输入测试邮箱':'请输入邮箱','使用隔离环境的测试账户继续。':'请输入账户信息继续。','金额和记录由隔离接口返回，不使用原型中的模拟余额。':'账户数据将在登录后加载。','NUVEXA / INTEGRATION':'NUVEXA','来源：隔离环境 /api/catalog':'目录报价','当前连接独立测试库。':'','提交至隔离接口':'提交申请','银行卡号（仅使用测试卡号）':'银行卡号','姓名（测试资料）':'姓名','接口连接失败，请检查本地隔离服务':'连接失败，请稍后重试'}))source=source.replaceAll(from,to);
  }
  source=source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,(_,names,dependency)=>{
   if(!dependency.startsWith('./'))throw Error('Nonlocal mobile import');
   const imported=visit(path.relative(root,path.resolve(path.dirname(file),dependency)));
   return 'const {'+names.replace(/\s+as\s+/g,':')+'}='+imported+';';
  });
  source=source.replace(/export\s+(async\s+)?(function|class|const|let)\s+(\w+)/g,(_,asyncWord,kind,name)=>{exports.push(name);return (asyncWord||'')+kind+' '+name});
  if(/\bimport\s|\bexport\s/.test(source))throw Error('Unsupported module syntax: '+file);
  chunks.push('const '+id+'=(()=>{'+source+'\nreturn {'+exports.join(',')+'};})();');return id;
 }
 visit('app.mjs');
 const css=['base.css','pages.css','polish.css','integration.css'].map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');
 return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>客户 App</title><style>'+css+'</style></head><body><div id="app" class="app"></div><script>'+chunks.join('\n').replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
};
