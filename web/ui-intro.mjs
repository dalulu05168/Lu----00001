const portal = document.querySelector('#entryGate, #admin-login');
const workspace = document.querySelector('#overview, #adminWorkspace');
if (portal && workspace) {
  const intro = document.createElement('div');
  intro.className = 'ui-intro';
  intro.setAttribute('aria-hidden', 'true');
  const logo = document.createElement('img');
  logo.src = '/ui-brand.png';
  logo.alt = '';
  intro.append(logo);
  if (!portal.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.body.append(intro);
    setTimeout(() => intro.remove(), 1850);
    portal.addEventListener('focusin', () => intro.remove(), {once:true});
  }
  new MutationObserver(() => {
    if (workspace.hidden || !portal.hidden) {
      workspace.classList.remove('ui-entry');
      return;
    }
    intro.remove();
    workspace.classList.add('ui-entry');
  }).observe(workspace, {attributes:true, attributeFilter:['hidden']});
}

const phone = document.querySelector('#mirrorDialog .mirror-phone');
if (phone) {
  const fitPhone = () => {
    if (!phone.clientWidth) return;
    const availableHeight = Math.max(1, window.innerHeight - 140);
    const scale = Math.min(1, phone.clientWidth / 390, availableHeight / 844);
    phone.style.setProperty('--ui-mirror-scale', scale.toFixed(4));
  };
  new ResizeObserver(fitPhone).observe(phone);
  window.addEventListener('resize', fitPhone, {passive:true});
}
