(() => {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  let feedCache, feedPending;
  const feedHosts = new WeakMap();
  async function getFeed(force) {
    if (!force && feedCache && Date.now() - feedCache.at < 60000) return feedCache.data;
    if (feedPending) return feedPending;
    feedPending = fetch('/api/news', {credentials: 'omit', cache: force ? 'reload' : 'default', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(12000)})
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!Array.isArray(data.items)) throw Error();
        feedCache = {data, at: Date.now()}; return data;
      }).finally(() => { feedPending = null; });
    return feedPending;
  }
  function articleCard(item) {
    const card = node('article', null, 'cn-news-card'), cover = node('div', null, 'cn-news-cover');
    const link = node('a', null, 'cn-news-article-link');
    link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const image = node('img'); image.alt = item.image?.alt || item.title; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
    const unavailable = () => {
      const message = node('span', '封面暂时无法加载'), retry = node('button', '重试图片'); retry.type = 'button';
      retry.onclick = () => { cover.replaceChildren(image); image.src = item.image.url; };
      cover.replaceChildren(message); if (item.image?.url) cover.append(retry);
    };
    image.onerror = unavailable;
    if (item.image?.url) { image.src = item.image.url; cover.append(image); } else unavailable();
    link.append(node('h3', item.title));
    const meta = node('div', null, 'cn-news-meta'), date = node('time'); date.dateTime = item.publishedAt;
    date.textContent = new Date(item.publishedAt).toLocaleString('zh-CN', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
    meta.append(node('span', item.source), date);
    if (item.aiAssisted) meta.append(node('span', 'AI 辅助撰写', 'cn-news-ai'));
    const content = node('div', null, 'cn-news-copy'); content.append(link, meta);
    if (item.summary) content.append(node('p', item.summary, 'cn-news-summary'));
    card.append(cover, content); return card;
  }
  function mountFeed(host) {
    if (!host || feedHosts.has(host)) return;
    feedHosts.set(host, true); host.classList.add('cn-news-feed');
    const header = node('header'), title = node('div'), refresh = node('button', '刷新新闻'); refresh.type = 'button';
    title.append(node('h2', '财经阅读'), node('p', 'FinVibe · 按原文发布日期排列'));
    header.append(title, refresh);
    const list = node('div', null, 'cn-news-cards'); list.setAttribute('aria-live', 'polite');
    host.replaceChildren(header, list);
    async function load(force = false) {
      if (refresh.disabled) return; refresh.disabled = true;
      if (!list.children.length) list.append(node('p', '正在加载新闻…', 'cn-news-state'));
      try {
        const data = await getFeed(force);
        if (!host.isConnected) return;
        list.replaceChildren(...data.items.map(articleCard));
        if (!data.items.length) list.append(node('p', '暂无可阅读内容', 'cn-news-state'));
      } catch {
        if (!host.isConnected) return;
        const retry = node('button', '重新加载'); retry.type = 'button'; retry.onclick = () => load(true);
        const state = node('div', null, 'cn-news-state'); state.setAttribute('role', 'alert');
        state.append(node('p', '新闻暂时无法加载，请稍后重试'), retry); list.replaceChildren(state);
      } finally { refresh.disabled = false; }
    }
    refresh.onclick = () => load(true); load();
    const timer = setInterval(() => {
      if (!host.isConnected) clearInterval(timer);
      else if (!document.hidden && host.getBoundingClientRect().height) load();
    }, 60000);
  }
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
  const feedStyle = node('style');
  feedStyle.textContent = '.cn-news-feed{color:#24364b;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.cn-news-feed>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0}.cn-news-feed h2{font-size:18px;line-height:1.4;margin:0;font-weight:650}.cn-news-feed header p{font-size:12px;color:#617189;margin:4px 0 0}.cn-news-feed button{font:inherit;border:1px solid #d5e1ef;border-radius:999px;background:#f4f7fb;color:#23558d;padding:7px 14px;min-height:36px;cursor:pointer;white-space:nowrap}.cn-news-feed button:disabled{opacity:.55;cursor:wait}.cn-news-cards{display:grid;gap:16px}.cn-news-card{display:block;border:1px solid #dce5ef;border-radius:16px;overflow:hidden;background:white;box-shadow:0 3px 14px #203a5a05}.cn-news-cover{aspect-ratio:16/9;overflow:hidden;background:#f0f4f8;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;color:#52677d}.cn-news-cover img{width:100%;height:100%;object-fit:cover;display:block}.cn-news-copy{padding:16px}.cn-news-article-link{color:#172b43;text-decoration:none;display:block}.cn-news-article-link:hover{color:#175db2}.cn-news-card h3{font-size:16px;line-height:1.55;letter-spacing:0;font-weight:650;margin:0;overflow-wrap:anywhere}.cn-news-meta{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px;color:#617189;margin:10px 0 0}.cn-news-ai{border-radius:999px;background:#edf3fb;padding:2px 8px}.cn-news-summary{color:#52677d;font-size:13px;line-height:1.65;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;margin:12px 0 0}.cn-news-state{text-align:center;color:#617189;padding:24px 12px}.cn-news-article-link:focus-visible,.cn-news-feed button:focus-visible{outline:2px solid #175db2;outline-offset:3px}#market-news{padding:0 16px 16px;box-sizing:border-box;overflow:auto}#mobile-news{margin:24px 0 12px}.cn-news-tools{display:flex;justify-content:flex-end;padding:12px 0 0}@media(prefers-reduced-motion:no-preference){.cn-news-card{animation:cn-news-enter .18s ease-out}@keyframes cn-news-enter{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}}';
  document.head.append(feedStyle);
  window.CNNews = {render, open, mountBulletin, mountFeed};
})();
