const form=document.querySelector("#deletionForm");
const feedback=document.querySelector("#feedback");
const button=document.querySelector("#submit");
form?.addEventListener("submit",async(event)=>{
 event.preventDefault();
 if(button.disabled)return;
 const email=form.elements.namedItem("email").value.trim();
 const password=form.elements.namedItem("password").value;
 const confirmation=form.elements.namedItem("confirmation").value.trim();
 if(confirmation!=="DELETE MY ACCOUNT"){feedback.textContent="确认文字不正确。";return;}
 button.disabled=true;feedback.textContent="正在验证账户并提交申请…";
 try{
  const login=await fetch("/api/auth/login",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({email,password}),cache:"no-store",credentials:"same-origin"
  });
  if(!login.ok)throw new Error("账户验证失败，请确认邮箱和密码。");
  const data=await login.json();
  if(typeof data.token!=="string")throw new Error("未获得有效账户会话。");
  try{
   const result=await fetch("/api/account/deletion-request",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+data.token},
    body:JSON.stringify({password,confirmation}),
    cache:"no-store",credentials:"same-origin"
   });
   const body=await result.json().catch(()=>({}));
   if(!result.ok)throw new Error(body.error||"提交失败，服务器未确认。");
   feedback.textContent="注销申请已登记，当前处理状态："+body.status+"。这不代表账户数据已经删除。申请编号："+body.requestId;
   form.reset();
  }finally{
   // The token is kept only in JS memory, never localStorage or a URL.
   await fetch("/api/auth/logout",{
    method:"POST",headers:{"authorization":"Bearer "+data.token},cache:"no-store"
   }).catch(()=>{});
  }
 }catch(error){feedback.textContent=error.message||"发生错误，请重试。";}
 finally{button.disabled=false;}
});
