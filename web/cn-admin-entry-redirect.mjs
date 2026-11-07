// Authenticate with the existing 2FA flow; navigate to the redesigned admin only after a session exists.
if (!new URLSearchParams(location.search).has('legacy')) {
  const go=()=>{
    if(sessionStorage.getItem('gsp_admin_token')) {
      location.replace('/cn-admin.html');
      return true;
    }
    return false;
  };
  go();
  window.addEventListener('gsp:admin-authenticated',go);
  document.getElementById('adminLoginForm')?.addEventListener('submit',()=>{
    let attempts=0;
    const check=setInterval(()=>{
      if(go()||++attempts>100)clearInterval(check);
    },120);
  });
}
