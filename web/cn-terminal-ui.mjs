// CN Capital customer UI bridge — re-parent the actual existing workflow forms.
// This file intentionally sends ZERO API requests and owns ZERO account data.
// Real submit handlers stay in /app.mjs, already bound to these original form IDs.
const $=id=>document.getElementById(id);
const dialogs=new Map();

function newButton(label,action){
 const button=document.createElement("button");
 button.type="button";button.textContent=label;button.dataset.cnAction=action;
 button.addEventListener("click",()=>openDialog(action));
 return button;
}
function openDialog(type){
 const dialog=dialogs.get(type);
 if(!dialog)return;
 const form=dialog.querySelector("form");
 if(!form)return;
 if(dialog.open)return;
 try{dialog.showModal()}catch{dialog.setAttribute("open","")}
 dialog.querySelector(".cn-dialog-close")?.focus();
}
function closeDialog(dialog){
 if(typeof dialog.close==="function"&&dialog.open)dialog.close();
 else dialog.removeAttribute("open");
}
const containers={
 funding:{title:"充值 / 提现申请",form:"fundingRequestForm",label:"充值 / 提现",hint:"已提交的申请仍由后台审核；申请记录可在账户申请中心查询。"},
 identity:{title:"身份资料审核",form:"identityUploadForm",label:"身份资料",hint:"资料安全上传是否开放以后台接口为准，未开放时只可创建审核工单。"},
 bank:{title:"银行卡 / 收付款账户",form:"bankLinkRequestForm",label:"银行卡资料",hint:"只提交平台允许的银行资料，不需要网银密码、PIN 或验证码。"}
};
function createDialog(type,config){
 const form=$(config.form);if(!form)throw new Error("Missing existing workflow form #"+config.form);
 const moving=(type==="identity")?form.closest(".service-request-form"):form;
 if(!moving)throw new Error("Original form parent missing: "+type);
 const dialog=document.createElement("dialog");dialog.className="cn-live-dialog";dialog.dataset.cnDialog=type;
 dialog.setAttribute("aria-label",config.title);
 const head=document.createElement("div");head.className="cn-dialog-head";
 const title=document.createElement("h2");title.textContent=config.title;
 const close=document.createElement("button");close.type="button";close.className="cn-dialog-close";close.textContent="×";close.setAttribute("aria-label","关闭"+config.title);
 close.addEventListener("click",()=>closeDialog(dialog));head.append(title,close);
 const body=document.createElement("div");body.className="cn-dialog-body";
 body.append(moving);
 const note=document.createElement("p");note.className="service-disclosure";note.textContent=config.hint;
 body.append(note);
 const msg=document.createElement("p");msg.className="form-feedback cn-dialog-status";msg.setAttribute("role","status");msg.setAttribute("aria-live","polite");
 body.append(msg);
 const link=document.createElement("a");link.href="#serviceRequestsPanel";link.textContent="查看申请记录";
 link.addEventListener("click",()=>closeDialog(dialog));body.append(link);
 dialog.append(head,body);
 dialog.addEventListener("click",event=>{if(event.target===dialog)closeDialog(dialog)});
 dialog.addEventListener("cancel",()=>{ /* Native Esc closes the modal; handlers remain bound. */ });
 document.body.append(dialog);
 dialogs.set(type,dialog);
 return dialog;
}
function ensureQuickActions(){
 const actions=document.querySelector("#overview .topbar .top-actions");
 if(!actions||actions.querySelector(".cn-quick-actions"))return;
 const group=document.createElement("div");group.className="cn-quick-actions";
 group.setAttribute("role","group");group.setAttribute("aria-label","账户业务快捷入口");
 for(const [type,config] of Object.entries(containers)) group.append(newButton(config.label,type));
 actions.prepend(group);
}
function watchFeedback(){
 const source=$("serviceRequestFeedback");
 if(!source||typeof MutationObserver!=="function")return;
 const observer=new MutationObserver(()=>{
  for(const dialog of dialogs.values()){
   if(!dialog.open)continue;
   const status=dialog.querySelector(".cn-dialog-status");
   if(status)status.textContent=source.textContent||"";
  }
 });
 observer.observe(source,{childList:true,characterData:true,subtree:true});
}
function run(){
 if(!document.querySelector("#overview")||!$("serviceRequestsPanel"))return;
 for(const [type,config] of Object.entries(containers))createDialog(type,config);
 ensureQuickActions();
 watchFeedback();
}
run();
