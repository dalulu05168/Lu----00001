(() => {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function render(host, {symbol = '', theme = 'light'} = {}) {
    if (!host) return;
    const key = symbol + '|' + theme;
    if (host.dataset.newsKey === key) return;
    host.dataset.newsKey = key;
    const config = {feedMode: symbol ? 'symbol' : 'all_symbols', ...(symbol ? {symbol} : {}), colorTheme: theme, isTransparent: true, displayMode: 'regular', width: '100%', height: '100%', locale: 'zh_CN'};
    const frame = node('iframe');
    frame.title = symbol ? symbol + ' 相关新闻' : '市场新闻';
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:' + (theme === 'dark' ? '#0b0b0b' : '#fff') + ';color:#718096;font:14px system-ui}.tradingview-widget-container{height:100%;display:flex;flex-direction:column}.tradingview-widget-container__widget{flex:1;min-height:0}a{color:#397bc4}</style><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget">正在加载新闻…</div><div><a target="_blank" rel="noopener" href="https://www.tradingview.com/news/">TradingView</a></div><script async src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js">' + JSON.stringify(config).replace(/</g, '\\u003c') + '</scr' + 'ipt></div></html>';
    host.replaceChildren(frame);
  }
  function open(symbol = '', theme = 'light') {
    const dialog = node('dialog', null, 'cn-news-dialog');
    dialog.dataset.theme = theme;
    const header = node('header'), title = node('h2', symbol ? '相关新闻' : '市场新闻'), close = node('button', '关闭');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭新闻');
    close.onclick = () => dialog.close();
    const host = node('div', null, 'cn-news-content');
    header.append(title, close);
    dialog.append(header, host);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    dialog.showModal();
    render(host, {symbol, theme});
    close.focus();
  }
  function mountBulletin(host) {
    let request;
    async function load() {
      if (request) return request;
      const token = localStorage.getItem('cncap.session');
      if (!token) { host.hidden = true; return; }
      request = fetch('/api/announcements', {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store'}).then(async response => {
        if (!response.ok) throw Error();
        const {item} = await response.json();
        host.replaceChildren();
        host.hidden = !item;
        if (item) host.append(node('strong', item.title), node('time', new Date(item.createdAt).toLocaleString('zh-CN')), node('p', item.body));
      }).catch(() => { host.hidden = true; }).finally(() => { request = null; });
      return request;
    }
    load();
    window.addEventListener('focus', load);
    const timer = setInterval(() => {
      if (!host.isConnected) { clearInterval(timer); window.removeEventListener('focus', load); }
      else if (!document.hidden) load();
    }, 60000);
  }
  const style = node('style');
  style.textContent = '.cn-news-dialog{width:min(760px,calc(100vw - 32px));height:min(760px,calc(100dvh - 40px));padding:0;border:1px solid #dfe6ef;border-radius:20px;color:#172332;background:#fff;box-shadow:0 20px 60px #17233230}.cn-news-dialog[open]{display:flex;flex-direction:column}.cn-news-dialog::backdrop{background:#17233266;backdrop-filter:blur(4px)}.cn-news-dialog header{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #dfe6ef}.cn-news-dialog h2{flex:1;margin:0;text-align:center;font-size:20px;padding-left:60px}.cn-news-dialog button{min-height:36px;padding:6px 18px;border-radius:999px;border:1px solid #d2dce9;color:inherit;background:#f4f7fb;cursor:pointer}.cn-news-content{flex:1;min-height:0}.cn-news-dialog[data-theme=dark]{background:#0b0b0b;color:#f3f5f8;border-color:#394353}.cn-news-dialog[data-theme=dark] button{background:#222832}.cn-bulletin{padding:14px 18px;border:1px solid #d8e5f5;border-radius:14px;background:#eff6ff;color:#172332}.cn-bulletin time{display:block;font-size:12px;color:#526277;margin-top:4px}.cn-bulletin p{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0}@media(max-width:600px){.cn-news-dialog{width:100%;height:100dvh;max-width:100%;max-height:100dvh;border-radius:0;margin:0;border:0}.cn-news-dialog header{padding-top:max(12px,env(safe-area-inset-top))}}';
  document.head.append(style);
  window.CNNews = {render, open, mountBulletin};
})();
