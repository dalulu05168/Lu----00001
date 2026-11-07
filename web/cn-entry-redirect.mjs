// Retain existing customer login logic; redirect only when it has established a session.
if (!location.pathname.endsWith('/cn-terminal.html')) {
  const go = () => {
    const token = sessionStorage.getItem('gsp_token');
    if (token && !location.hash.includes('stay-legacy')) location.replace('/cn-terminal.html');
  };
  go();
  document.getElementById('authForm')?.addEventListener('submit', () => {
    let attempts=0;
    const check=setInterval(()=>{
      if(sessionStorage.getItem('gsp_token')){clearInterval(check);go();}
      else if(++attempts>75)clearInterval(check);
    },120);
  });
}
