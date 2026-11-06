// Leave original admin login/2FA untouched; new UI follows only an established session.
if (!new URLSearchParams(location.search).has('legacy')) {
  const go=()=>{if(sessionStorage.getItem('gsp_admin_token'))location.replace('/cn-admin.html')};
  go();
  document.getElementById('adminLoginForm')?.addEventListener('submit',()=>{
    let attempts=0;
    const check=setInterval(()=>{
      if(sessionStorage.getItem('gsp_admin_token')){clearInterval(check);go();}
      else if(++attempts>75)clearInterval(check);
    },120);
  });
}
