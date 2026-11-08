// Reuse the original customer form and endpoints. The gate only changes presentation.
const loginGate = document.getElementById('cn-entry-gate');
const accountFormHost = document.getElementById('authPanel');
const feedback = document.getElementById('authFeedback');
const slot = document.getElementById('cn-entry-form-slot');
const params = new URLSearchParams(location.search);
function mountLoginGate() {
  if (params.has('legacy') || !slot || !accountFormHost || !loginGate) {
    document.body.classList.remove('cn-guest');
    return;
  }
  slot.appendChild(accountFormHost);
  if (feedback) slot.appendChild(feedback);
  loginGate.hidden = false;
  document.body.classList.add('cn-guest');
  document.body.classList.remove('cn-routing');
}
function goToCurrentUI() {
  const token = sessionStorage.getItem('gsp_token');
  if (!params.has('legacy') && token && !location.hash.includes('stay-legacy')) {
    location.replace(matchMedia('(max-width: 640px)').matches ? '/cn-mobile.html' : '/cn-terminal.html');
    return true;
  }
  return false;
}
if (!location.pathname.endsWith('/cn-terminal.html')) {
  if (!goToCurrentUI()) mountLoginGate();
  window.addEventListener('gsp:authenticated', goToCurrentUI);
  document.getElementById('authForm')?.addEventListener('submit', () => {
    let attempts=0;
    const check=setInterval(() => {
      if (goToCurrentUI() || ++attempts>100) clearInterval(check);
    },120);
  });
}
