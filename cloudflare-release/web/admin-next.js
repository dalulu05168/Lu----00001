
(()=>{'use strict';
const $=id=>document.getElementById(id),el=(t,text,cls)=>{const n=document.createElement(t);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n},btn=(text,run,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=run;return b};
const titles={home:'工作台',accounts:'客户账户',orders:'交易订单',positions:'持仓资产',approvals:'资金审批',audit:'操作审计',products:'产品与证券',documents:'客户资料审核',support:'客服与公告',permissions:'子管理员权限',settlement:'IPO 与基金复核',mirror:'App 镜像'};
let me=null,clients=[],orders=[],positions=[],requests=[],audits=[],view='home',account=null,selectedEmail='',loadVersion=0,rows=[],schema=[],tableState={query:'',market:'',density:false,hidden:[]},selected=new Set(),activeRecord=null,confirmAction=null,posting=false;
const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Europe/Bucharest'}):'未提供';
const money=(v,c='USD')=>v==null?'未提供':Number.isSafeInteger(Number(v))?(Number(v)/100).toLocaleString('zh-CN',{style:'currency',currency:c}):'金额不可用';
const label=v=>({PENDING:'待初审',REVIEWED:'待终审',APPROVED:'已入账',REJECTED:'已驳回',BUY:'买入',SELL:'卖出',ALLOW:'允许登录',DENY:'限制登录'}[v]||v||'未提供');
function notify(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('toast').hidden=true,4500)}
async function api(path,options={}){const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{})};if(options.key)headers['Idempotency-Key']=options.key;const token=localStorage.getItem('cncap.admin.session');if(token)headers.Authorization='Bearer '+token;const r=await fetch('/api/admin/'+path,{...options,headers,cache:'no-store',signal:AbortSignal.timeout(20000)});if(r.status===401){location.assign('/login?admin=1&next=%2Fadmin-next');throw Error('登录已失效')}const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error||'请求失败'),{status:r.status});return d}
function preferences(){try{return JSON.parse(localStorage.getItem('nuvexa.admin.preferences')||'{}')}catch{return {}}}
function savePref(key,value){try{const p=preferences();p[key]=value;localStorage.setItem('nuvexa.admin.preferences',JSON.stringify(p))}catch{notify('浏览器无法保存偏好设置')}}
function recent(){const p=preferences();const pinned=(p.pins||[]).includes(view);$('pin-page').textContent=pinned?'★ 取消收藏当前页':'☆ 收藏当前页';$('pin-page').setAttribute('aria-pressed',String(pinned));$('recent').replaceChildren();for(const k of [...new Set([...(p.pins||[]),...(p.recent||[])])].filter(k=>titles[k]&&k!==view&&canOpen(k)).slice(0,7))$('recent').append(btn((p.pins||[]).includes(k)?'★ '+titles[k]:titles[k],()=>navigate(k)))}
function tag(text,tone=''){return el('span',text,'tag '+tone)}
function empty(type,title,text,run){const n=el('div',null,'empty');n.append(tag({configuration:'未配置',integration:'未接入',restricted:'权限受限',none:'无结果',error:'加载失败'}[type],type==='error'?'negative':type==='restricted'?'restricted':''),el('h3',title),el('p',text));if(run)n.append(btn({configuration:'查看配置入口',integration:'查看接入说明',none:'清除筛选',error:'重新加载'}[type],run));return n}
function loading(){const n=el('div',null,'panel');n.setAttribute('aria-busy','true');n.append(el('p','正在加载真实业务数据…'));for(let i=0;i<5;i++)n.append(el('div',null,'skeleton'));$('workspace').replaceChildren(n)}

const navGroups = [
  ['总览', ['home']],
  ['业务管理', ['accounts', 'orders', 'positions', 'approvals']],
  ['风险与市场', ['products']],
  ['运营分析', ['documents', 'support', 'settlement', 'mirror']],
  ['平台治理', ['permissions', 'audit']],
];
const iconPaths = {
  home: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  accounts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  orders: 'M3 12h4l3-7 4 14 3-7h4',
  positions: 'M3 7h18v14H3z M8 7V4h8v3 M3 13h18 M10 13v2h4v-2',
  approvals: 'M9 4H5v17h14V4h-4 M9 3h6v4H9z M8 14l3 3 5-6',
  audit: 'M13 3H5v18h14V9z M13 3v6h6 M8 13h8 M8 17h6',
  products: 'M3 3v18h18 M6 16l5-5 4 3 5-7',
  documents: 'M4 5h16v14H4z M8 15v-1a2 2 0 0 1 4 0v1 M10 11h.01 M15 10h2 M15 14h2',
  support: 'M21 11a8 8 0 0 1-8 8H7l-4 2 1-5a8 8 0 1 1 17-5z M8 11h8 M8 15h5',
  permissions: 'M15 4a5 5 0 0 0-4 8L3 20v1h4l2-2v-2h2l3-3a5 5 0 1 0 1-10z M17 8h.01',
  settlement: 'M4 20h16 M6 16v-3 M12 16V8 M18 16V4',
  mirror: 'M7 2h10v20H7z M10 18h4',
  wallet: 'M4 7h15v13H4z M4 7l12-3v3 M19 11h-5v5h5 M15 13.5h.01',
  risk: 'M12 3 3 7v5c0 5 4 8 9 10 5-2 9-5 9-10V7z M12 8v5 M12 17h.01',
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
}
function canOpen(id) {
  if (!me) return id === 'home';
  if (id === 'documents') return me.role === 'SUBADMIN';
  return !['approvals', 'products', 'permissions', 'settlement', 'support'].includes(id) || me.role === 'MASTER';
}
function drawNav() {
  const navigation = $('navigation');
  navigation.replaceChildren();
  for (const [title, pages] of navGroups) {
    const group = el('div', null, 'nav-group');
    group.append(el('div', title, 'nav-group-label'));
    for (const id of pages) {
      const button = btn(null, () => navigate(id), 'nav-item');
      button.append(icon(id), el('span', titles[id]));
      button.setAttribute('aria-label', titles[id]);
      button.title = titles[id];
      if (id === view) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'page');
      }
      if (!canOpen(id)) {
        button.disabled = true;
        button.title = id === 'documents' ? '仅所属子管理员可审核' : '需要总管理员权限';
      }
      group.append(button);
    }
    navigation.append(group);
  }
}
function dashboardPanel(title, subtitle, linkLabel, target) {
  const panel = el('section', null, 'panel dashboard-panel');
  const heading = el('header', null, 'dashboard-panel-heading');
  const text = el('div');
  text.append(el('h2', title), el('p', subtitle));
  heading.append(text);
  if (target) heading.append(btn(linkLabel + ' ›', () => navigate(target), 'dashboard-link'));
  panel.append(heading);
  return panel;
}
function dashboardEmpty(iconName, title, description) {
  const box = el('div', null, 'dashboard-empty');
  box.append(icon(iconName), el('strong', title), el('p', description));
  return box;
}


const fundingDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
});
function fundingDay(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return fundingDayFormat.format(value instanceof Date ? value : new Date(value));
}
function fundingAmount(cents) {
  const sign = cents < 0n ? '−' : '';
  const amount = cents < 0n ? -cents : cents;
  return sign + (amount / 100n).toLocaleString('en-US') + '.' + String(amount % 100n).padStart(2, '0');
}
function fundingChart(days, totals, onInspect) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 720 225');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '按入账日汇总的已入账入金与出金柱状图，金额单位 USD');
  const add = (type, attributes, value, parent = svg) => {
    const element = document.createElementNS(svg.namespaceURI, type);
    for (const [key, attr] of Object.entries(attributes)) element.setAttribute(key, attr);
    if (value) element.textContent = value;
    parent.append(element);
    return element;
  };
  const highest = [...totals.values()].flat().reduce((max, value) => value > max ? value : max, 0n);
  const max = highest > 0n ? highest : 100n;
  const xStart = 90, width = 600, baseline = 184, height = 156, step = width / days.length;
  for (let i = 0; i <= 4; i++) {
    const y = baseline - i * height / 4;
    add('line', {x1:xStart, x2:xStart+width, y1:y, y2:y, class:'funding-gridline'});
    add('text', {x:xStart-8,y:y+4,'text-anchor':'end',class:'funding-axis'}, fundingAmount(max * BigInt(i) / 4n));
  }
  days.forEach((day, index) => {
    const x = xStart + (index + .5) * step;
    if (days.length === 7 || index % 5 === 0 || index === days.length - 1) {
      add('text', {x,y:207,'text-anchor':'middle',class:'funding-axis'}, day.slice(5));
    }
    (totals.get(day) || [0n, 0n]).forEach((value, kind) => {
      if (value === 0n) return;
      const barWidth = Math.min(24, step * .35);
      const barHeight = Math.max(1, Number(value * BigInt(height * 10) / max) / 10);
      const bar = add('rect', {x:x+(kind ? 1 : -barWidth-1),y:baseline-barHeight,width:barWidth,height:barHeight,rx:2,class:kind ? 'funding-withdrawal' : 'funding-deposit'});
      add('title', {}, day + ' ' + (kind ? '出金 ' : '入金 ') + fundingAmount(value) + ' USD', bar);
    });
  });

  const guide = add('line', {y1:24,y2:baseline,class:'funding-guide',visibility:'hidden'});
  function inspect(index) {
    const x = xStart + (index + .5) * step;
    guide.setAttribute('x1',x); guide.setAttribute('x2',x);
    guide.setAttribute('visibility','visible');
    onInspect(days[index],totals.get(days[index]) || [0n,0n]);
  }
  function clear() { guide.setAttribute('visibility','hidden'); onInspect(null); }
  const targets = days.map((day,index) => {
    const [deposit,withdrawal] = totals.get(day) || [0n,0n];
    const target = add('rect', {
      x:xStart+index*step,y:20,width:step,height:baseline-20,
      fill:'transparent',class:'funding-hit-target',tabindex:index===days.length-1?'0':'-1',
      role:'button','aria-label':day+'，入金 '+fundingAmount(deposit)+' USD，出金 '+
        fundingAmount(withdrawal)+' USD，净流入 '+fundingAmount(deposit-withdrawal)+' USD'
    });
    target.addEventListener('pointerenter',()=>inspect(index));
    target.addEventListener('pointerdown',()=>inspect(index));
    target.addEventListener('focus',()=>inspect(index));
    target.addEventListener('blur',clear);
    target.addEventListener('keydown',event=>{
      if(event.key==='Escape'){clear();return;}
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next = event.key==='Home'?0:event.key==='End'?days.length-1:
        Math.max(0,Math.min(days.length-1,index+(event.key==='ArrowLeft'?-1:1)));
      target.setAttribute('tabindex','-1');
      targets[next].setAttribute('tabindex','0'); targets[next].focus();
    });
    return target;
  });
  svg.addEventListener('pointerleave',()=>{
    const focused=targets.indexOf(document.activeElement);
    if(focused>=0)inspect(focused);else clear();
  });
  return svg;
}
function renderFunding(result) {
  const panel = dashboardPanel('出入金趋势', 'USD · 布加勒斯特时间 · 所属子管理员名下客户');
  panel.classList.add('funding-panel');
  if (result.status !== 'fulfilled' || !Array.isArray(result.value.items)) {
    const failure = dashboardEmpty('risk', '资金记录加载失败', '稍后重试以刷新趋势和明细。');
    failure.append(btn('重新加载', load));
    panel.append(failure);
    return panel;
  }

  const records = result.value.items.filter(row =>
    ['DEPOSIT', 'WITHDRAW'].includes(row.kind) && /^[0-9]+$/.test(String(row.amount_cents)));
  const period = el('div', null, 'funding-period');
  period.setAttribute('aria-label', '统计时段');
  const content = el('div');
  const options = [7, 30].map(n => btn('近 ' + n + ' 天', () => render(n)));
  period.append(...options);
  panel.firstElementChild.append(period);
  panel.append(content);

  function render(length) {
    options.forEach((button, index) => button.setAttribute('aria-pressed', String(length === [7, 30][index])));
    const today = new Date(fundingDay(new Date()) + 'T00:00:00Z');
    const days = Array.from({length}, (_, index) =>
      new Date(today.getTime() - (length - index - 1) * 86400000).toISOString().slice(0, 10));
    const daySet = new Set(days);
    const totals = new Map();
    let deposits = 0n, withdrawals = 0n;
    const visible = [];
    for (const row of records) {
      const settled = row.status === 'APPROVED';
      const date = settled ? row.approved_at : row.created_at;
      const day = fundingDay(date);
      if (!daySet.has(day)) continue;
      const amount = BigInt(row.amount_cents);
      visible.push({row, date, amount});
      if (!settled) continue;
      const bucket = totals.get(day) || [0n, 0n];
      if (row.kind === 'DEPOSIT') { deposits += amount; bucket[0] += amount; }
      else { withdrawals += amount; bucket[1] += amount; }
      totals.set(day, bucket);
    }
    visible.sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
    const summary = el('dl', null, 'funding-totals');
    for (const [name, amount] of [['已入账入金', deposits], ['已入账出金', withdrawals], ['净流入', deposits-withdrawals]]) {
      const group = el('div');
      group.append(el('dt', name), el('dd', fundingAmount(amount)));
      summary.append(group);
    }
    const legend = el('div', null, 'funding-legend');
    legend.append(el('span','入金','deposit-key'),el('span','出金','withdrawal-key'),el('span','按入账日统计'));
    const chart = el('div', null, 'funding-plot');

    const tooltip=el('div',null,'funding-tooltip');
    tooltip.setAttribute('role','status'); tooltip.hidden=true;
    const chartSvg=fundingChart(days,totals,(day,amounts)=>{
      tooltip.replaceChildren(); tooltip.hidden=!day;
      if(!day)return;
      const [deposit,withdrawal]=amounts;
      tooltip.append(el('div',day,'funding-tooltip-date'));
      for(const [name,value] of [['入金',deposit],['出金',withdrawal],['净流入',deposit-withdrawal]]) {
        const row=el('div',null,'funding-tooltip-row');
        row.append(el('span',name),el('span',fundingAmount(value)+' USD'));
        tooltip.append(row);
      }
    });
    chart.append(chartSvg,tooltip);
    if (!totals.size) chart.append(el('p','该时段暂无已入账出入金。','muted funding-no-chart'));

    const detail = el('details', null, 'funding-detail');
    detail.open = true;
    detail.append(el('summary','出入金明细 · '+visible.length+' 条'),
      el('p','已入账记录按入账时间显示，其余申请按提交时间显示。','muted'));
    const grid = el('div', null, 'table-scroll funding-table');
    const table = el('table');
    const header = table.createTHead().insertRow();
    for (const name of ['时间','客户账户','方向','金额 (USD)','状态']) header.append(el('th',name));
    const body = table.createTBody();
    const pager = el('div', null, 'funding-pager');
    const previous = btn('上一页', () => show(page - 1));
    const next = btn('下一页', () => show(page + 1));
    const position = el('span');
    const pageSize = 8;
    let page = 0;
    function show(index) {
      page = index;
      body.replaceChildren();
      for (const {row,date,amount} of visible.slice(page*pageSize,(page+1)*pageSize)) {
        const tr = body.insertRow();
        for (const value of [time(date),row.email || '—',row.kind === 'DEPOSIT' ? '入金' : '出金',fundingAmount(amount),label(row.status)]) {
          tr.append(el('td',value));
        }
      }
      previous.disabled = page === 0;
      next.disabled = (page + 1) * pageSize >= visible.length;
      position.textContent = (page + 1) + ' / ' + Math.max(1,Math.ceil(visible.length/pageSize));
    }
    if (visible.length) {
      show(0);
      grid.append(table);
      detail.append(grid);
      if (visible.length > pageSize) {
        pager.append(previous,position,next);
        detail.append(pager);
      }
    } else detail.append(el('p','该时段没有出入金申请或入账记录。','muted'));
    content.replaceChildren(summary,legend,chart,detail);
  }
  render(7);
  return panel;
}

function renderDashboard(feed,funding) {
  const available = feed.status === 'fulfilled';
  const categories = {
    CASH: ['approvals', '资金审批', 'approvals', 'amber'],
    DOCUMENT: ['documents', '客户资料审核', 'documents', 'violet'],
    PRODUCT: ['risk', '基金到期处理异常', 'settlement', 'coral'],
    SUPPORT: ['support', '客户来信', 'support', 'cyan'],
  };
  const items = available ? feed.value.items.filter(item => categories[item.category] && canOpen(categories[item.category][2])) : [];
  const count = category => available ? String(items.filter(item => item.category === category).length) : '—';
  const master = me.role === 'MASTER';
  const totals = el('section', null, 'ops-totals');
  totals.setAttribute('aria-label', '当前工作量');
  for (const [name, value, detail, target] of [
    ['客户账户', String(clients.length), '当前授权范围', 'accounts'],
    master ? ['待审资金', count('CASH'), '最近 100 条通知内', 'approvals'] : ['待审资料', count('DOCUMENT'), '最近 100 条通知内', 'documents'],
    master ? ['基金处理异常', count('PRODUCT'), '最近 100 条通知内', 'settlement'] : ['订单查询', '查看', '按客户账户', 'orders'],
  ]) {
    const tile = btn(null, () => navigate(target), 'ops-total');
    tile.append(icon(target), el('span', name, 'ops-total-label'), el('span', value, 'ops-total-value'), el('small', detail));
    totals.append(tile);
  }

  const tasks = dashboardPanel('待处理', '资金审批、资料审核和异常处理', master ? '资金审批' : '资料审核', master ? 'approvals' : 'documents');
  const list = el('div', null, 'dashboard-tasks ops-task-list');
  if (!available) {
    const retry = dashboardEmpty('risk', '待办加载失败', '暂时无法读取后台通知。');
    retry.append(btn('重新加载', load));
    list.append(retry);
  } else {
    const active = items.filter(item => item.category !== 'SUPPORT');
    if (!active.length) list.append(dashboardEmpty('approvals', '暂无待办', '当前授权范围内没有待处理事项。'));
    for (const item of active.slice(0, 6)) {
      const [iconName, title, target, tone] = categories[item.category];
      const row = btn(null, () => navigate(target), 'dashboard-task');
      const marker = el('span', null, 'metric-icon metric-icon-' + tone);
      marker.append(icon(iconName));
      const copy = el('span', null, 'dashboard-task-copy');
      copy.append(el('strong', title), el('small', item.email || '—'));
      row.append(marker, copy, tag(item.status === 'FAILED' ? '处理失败' : label(item.status), tone === 'coral' ? 'negative' : 'warning'));
      list.append(row);
    }
  }
  tasks.append(list);

  const activity = dashboardPanel('客户动态', '近期客户来信');
  const messages = el('div', null, 'ops-activity');
  const latest = items.filter(item => item.category === 'SUPPORT').slice(0, 4);
  if (!available) messages.append(el('p', '暂时无法读取客户动态。', 'muted'));
  else if (!master) messages.append(el('p', '客服会话由总管理员处理。', 'muted'));
  else if (!latest.length) messages.append(el('p', '暂无客户来信。', 'muted'));
  else for (const item of latest) {
    const row = btn(null, () => navigate('support'), 'dashboard-task');
    const copy = el('span', null, 'dashboard-task-copy');
    copy.append(el('strong', '客户来信'), el('small', item.email || '—'));
    row.append(icon('support'), copy, el('span', '›'));
    messages.append(row);
  }
  activity.append(messages);

  const main = el('div', null, 'ops-dashboard');
  main.append(tasks, activity);
  const services = el('div', null, 'ops-service-line');
  services.append(el('span', '服务接入'), tag('BVB 行情待接入'), tag('US 交易时段待接入'), tag('资产与风险汇总待接入'));
  $('workspace').replaceChildren(totals, main, renderFunding(funding), services);
}

let navigationSequence=0,workspaceAnimation=null;
async function fadeWorkspace(to,duration){
 const workspace=$('workspace');workspaceAnimation?.cancel();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||!workspace.animate){workspace.style.opacity=String(to);return;}
 const animation=workspace.animate([{opacity:getComputedStyle(workspace).opacity},{opacity:to}],{duration,easing:'ease-in-out',fill:'forwards'});
 workspaceAnimation=animation;await animation.finished.catch(()=>{});
 if(workspaceAnimation===animation){workspace.style.opacity=String(to);animation.cancel();workspaceAnimation=null;}
}
async function navigate(id){
 const sequence=++navigationSequence;loadVersion++;const workspace=$('workspace');workspace.inert=true;
 try{
  if(!titles[id])id='home';
  if(me&&document.body.dataset.view)await fadeWorkspace(.2,90);
  if(sequence!==navigationSequence)return;
  if(id!=='orders'){orders=[];account=null}view=id;document.body.dataset.view=id;$('current-page').textContent=titles[id];document.body.classList.remove('menu-open');drawNav();const p=preferences();savePref('recent',[id,...(p.recent||[]).filter(x=>x!==id)].slice(0,5));recent();history.replaceState(null,'','#'+id);
  await load();if(sequence!==navigationSequence)return;
  await fadeWorkspace(1,150);
 }finally{if(sequence===navigationSequence){workspaceAnimation?.cancel();workspaceAnimation=null;workspace.style.removeProperty('opacity');workspace.inert=false;}}
}
function download(name,data){if(!data.length)return notify('当前没有可导出记录');const cell=v=>{let t=String(v??'');if([61,43,64,45,9,13].includes(t.charCodeAt(0)))t="'"+t;return '"'+t.replaceAll('"','""')+'"'};const keys=Object.keys(data[0]);const csv=String.fromCharCode(65279)+[keys.map(cell).join(','),...data.map(r=>keys.map(k=>cell(r[k])).join(','))].join(String.fromCharCode(13,10));const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=el('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function table(data,columns,kind){rows=data;schema=columns;selected.clear();const prefs=preferences()[view]||{};tableState={query:'',market:'',density:!!prefs.density,hidden:Array.isArray(prefs.hidden)?prefs.hidden:[]};const panel=el('section',null,'panel');panel.setAttribute('aria-label',titles[view]);const tools=el('div',null,'toolbar'),q=el('input');q.type='search';q.placeholder='编号、账户或 Ticker';q.setAttribute('aria-label','筛选当前列表');const market=el('select');market.setAttribute('aria-label','市场筛选');for(const [v,t]of [['','全部市场'],['US','US · 交易所未提供'],['HK','HK'],['CN','CN'],['MY','MY']]){const o=el('option',t);o.value=v;market.append(o)}if(!columns.some(([key])=>key==='market')){market.hidden=true;market.disabled=true}const density=btn('切换密度',()=>{tableState.density=!tableState.density;render()});tools.append(q,market,density,btn('保存筛选',()=>{savePref(view,{...tableState});notify('已在此浏览器保存筛选与列配置')}),btn('恢复筛选',()=>{const p=preferences()[view]||{};q.value=p.query||'';market.value=p.market||'';tableState.query=q.value;tableState.market=market.value;render()}),btn('导出已选',()=>exportRows(true)),btn('导出筛选结果',()=>exportRows(false)));
const details=el('details'),summary=el('summary','列显示设置');details.append(summary);const config=el('div',null,'column-options');for(const [key,title]of columns){const wrap=el('label'),check=el('input');check.type='checkbox';check.checked=!tableState.hidden.includes(key);check.onchange=()=>{tableState.hidden=check.checked?tableState.hidden.filter(k=>k!==key):[...tableState.hidden,key];render()};wrap.append(check,el('span',title));config.append(wrap)}details.append(config);const note=el('p',null,'table-note'),wrap=el('div',null,'table-scroll'),grid=el('table');grid.setAttribute('aria-label',titles[view]);wrap.append(grid);const update=el('p','更新时间 '+time(new Date().toISOString()),'table-note');panel.append(tools,details,note,wrap,update);$('workspace').replaceChildren(panel);q.oninput=()=>{tableState.query=q.value.trim().toLowerCase();render()};market.onchange=()=>{tableState.market=market.value;render()};function filtered(){return data.filter(r=>(!tableState.market||r.market===tableState.market)&&(!tableState.query||columns.some(([k])=>String(r[k]??'').toLowerCase().includes(tableState.query))))}
function exportRows(chosen){const values=filtered().filter(r=>!chosen||selected.has(r));download(titles[view],values.map(r=>Object.fromEntries(columns.filter(([k])=>!tableState.hidden.includes(k)).map(([k,t])=>[t,r[k]??'未提供']))))}
function render(){grid.className=tableState.density?'compact':'';grid.replaceChildren();const cols=columns.filter(([k])=>!tableState.hidden.includes(k));note.textContent='筛选：'+(tableState.query||'无关键词')+' / '+(tableState.market||'全部市场')+' · '+filtered().length+' 条 · 已选 '+selected.size+' 条';const th=el('thead'),tr=el('tr'),all=el('input');all.type='checkbox';all.setAttribute('aria-label','选择全部筛选记录');all.checked=filtered().length>0&&filtered().every(r=>selected.has(r));all.onchange=()=>{for(const r of filtered())all.checked?selected.add(r):selected.delete(r);render()};const first=el('th');first.append(all);tr.append(first);for(const [,t]of cols){const h=el('th',t);h.style.resize='horizontal';h.style.overflow='auto';h.style.minWidth='100px';tr.append(h)}tr.append(el('th','详情'));th.append(tr);const body=el('tbody');for(const r of filtered()){const row=el('tr'),pick=el('input');pick.type='checkbox';pick.checked=selected.has(r);pick.setAttribute('aria-label','选择 '+(r.id||r.email||r.symbol));pick.onchange=()=>{pick.checked?selected.add(r):selected.delete(r);render()};const td=el('td');td.append(pick);row.append(td);for(const [k]of cols){const cell=el('td');cell.textContent=r[k]??'未提供';if(['market','status','currency'].includes(k))cell.replaceChildren(tag(label(r[k]),r[k]==='US'?'US':''));row.append(cell)}const action=el('td');action.append(btn('查看详情',()=>openRecord(kind,r),'row-button'));row.append(action);body.append(row)}if(!filtered().length){const row=el('tr'),td=el('td');td.colSpan=cols.length+2;td.append(empty('none','当前条件下无记录','调整筛选条件后重试。',()=>{q.value='';market.value='';tableState.query='';tableState.market='';render()}));row.append(td);body.append(row)}grid.append(th,body)}render()}
function kv(label,value){const n=el('div',null,'kv');n.append(el('span',label),el('strong',value??'未提供'));return n}
function section(title,fields){const n=el('section');n.append(el('h3',title));for(const [k,v]of fields)n.append(kv(k,v));return n}
function showDrawer(kind,r,width=''){const d=$('detail');if(d.open)d.close();d.className='drawer '+width;$('detail-title').textContent=r.name||r.symbol||r.email||r.id||'详情';$('detail-kind').textContent=kind;$('detail-id').textContent=r.id||'编号未提供';$('detail-tags').replaceChildren(tag(r.market?r.market==='US'?'US · 交易所未提供':r.market:'市场未提供'),tag(kind==='资料'&&r.status==='PENDING'?'待审核':label(r.status)),tag(r.currency||'币种未提供'),tag('风险等级未提供'));$('detail-content').replaceChildren();$('detail-actions').replaceChildren();activeRecord={kind,r};d.showModal();const a=$('detail-actions');a.append(btn('查看审计',()=>{d.close();navigate('audit')}),btn('导出详情',()=>download(kind,[Object.fromEntries(Object.entries(r).filter(([k,v])=>!k.startsWith('_')&&!['code','inviteCode','expires_at'].includes(k)&&['string','number','boolean'].includes(typeof v)))])),btn('关闭',()=>d.close()));return $('detail-content')}
async function openRecord(kind,r){const body=showDrawer(kind,r,['订单','审批'].includes(kind)?'wide':'');if(kind==='订单'){body.append(section('订单基本信息',[['订单编号',r.id],['客户账户',selectedEmail],['Ticker',r.symbol],['ISIN','服务端未提供'],['交易所','服务端未提供，不从 US 推断 NYSE / Nasdaq'],['方向',label(r.side)],['订单类型','业务规则待确认'],['成交数量',r.quantity],['成交价格',money(r.price_cents)],['成交金额',money(r.amount_usd_cents)],['交易通道','平台内部执行，不向券商下单']]));const tl=el('ol',null,'timeline');const item=el('li','已记录内部成交');item.append(el('small',time(r.created_at)));tl.append(item);body.append(el('h3','可核验时间线'),tl,el('p','当前接口没有部分成交、外部提交和证券结算状态；不生成这些阶段。','muted'),section('资金与控制',[['风控检查结果','未提供逐项快照'],['冻结资金','普通内部成交已记账；订单冻结明细未提供'],['手续费','规则待确认，非默认零费用'],['预计结算日','规则待确认'],['失败原因','当前记录为已记账成交，未提供失败委托记录']]));for(const t of ['撤单','重试']){const b=btn(t,()=>{});b.disabled=true;b.title='现有已成交记录无此接口';$('detail-actions').prepend(b)}}
else if(kind==='账户'){body.append(section('账户资料',[['客户',r.email],['客户编号',r.id],['所属子管理员',r.subadmin_email||'总管理员范围'],['登录状态',label(r.login_policy)],['风险等级','未接入评级服务']]));if(me.role==='MASTER')$('detail-actions').prepend(btn(r.login_policy==='DENY'?'解除登录限制':'限制登录',()=>confirmControl(r),'danger-button'));$('detail-actions').prepend(btn('客户镜像与完整设置',()=>{ $('detail').close();compat('cli')}));}
else if(kind==='持仓'){body.append(section('内部记账持仓',[['账户',selectedEmail],['标的',r.symbol],['持有数量',r.quantity],['锁定数量',r.locked_quantity],['可用数量',Math.max(0,Number(r.quantity)-Number(r.locked_quantity||0))],['成本 USD',money(r.cost_cents)],['下次解锁',time(r.next_unlock_at)]]));}
else if(kind==='审批'){body.append(section('申请内容',[['审批编号',r.id],['客户',r.email],['类型',r.kind==='WITHDRAW'?'提现':'充值'],['申请金额',money(r.amountCents)],['当前节点',label(r.status)],['申请原因',r.note||'未填写']]));body.append(section('前后差异与资金影响',[['原余额','接口未提供审核时快照'],['变更方向',r.kind==='WITHDRAW'?'终审通过时扣款':'终审通过时入账'],['变更金额',money(r.amountCents)],['变更后余额','以服务端终审回执为准'],['手续费','待确认'],['预计到账','未提供'],['KYC','请使用资料审核核查，不推断认证结果'],['AML','未接入'],['复核要求',r.status==='PENDING'?'初审，尚不入账':'终审，同一管理员不能替代服务端复核规则']]));if(['PENDING','REVIEWED'].includes(r.status)&&me.role==='MASTER')for(const decision of ['REJECT','APPROVE'])$('detail-actions').prepend(btn(decision==='APPROVE'?'通过':'驳回',()=>confirmApproval(r,decision),decision==='REJECT'?'danger-button':''));if(r.rejectReason)body.append(kv('驳回原因',r.rejectReason));}
else if(kind==='价格复核'){body.append(section('发行价 / 净值',[['证券',r.symbol],['价格编号',r.id],['产品编号',r.product_id],['生效日期',r.effective_date?.slice(0,10)],['价格 USD',settlementUnits(r.unit_price_micros,6)],['复核时间',time(r.reviewed_at)],['规则','沿用现有MASTER复核规则；本轮不新增双人复核制度']]));if(!r.reviewed_at)$('detail-actions').prepend(btn('复核此价格',()=>settlementConfirm('复核发行价或净值',r.id,[['证券',r.symbol],['确认价格 USD',settlementUnits(r.unit_price_micros,6)],['影响','价格复核后可在生效日期用于现有内部认购/申赎']],{action:'review-price',terms:r.id,price:r.unit_price_micros})))}
else if(kind==='IPO配售'){body.append(section('内部IPO认购记录',[['订单',r.id],['客户',r.email],['证券',r.symbol],['状态',r.status],['申请股数',settlementUnits(r.requested_quantity_micros,6)],['录入配售股数',r.allocation_micros===null?'未录入':settlementUnits(r.allocation_micros,6)],['复核影响','按原发行价结算内部份额，未获配部分按既有规则退款；不代表券商购入或证券登记']]));if(r.status==='PENDING'){const input=el('input');input.inputMode='numeric';input.setAttribute('aria-label','配售股数');input.value=r.allocation_micros===null?'':settlementUnits(r.allocation_micros,6);body.append(el('label','录入配售股数（整数，可为0）'),input);$('detail-actions').prepend(btn('保存配售草稿',()=>{if(!/^(0|[1-9][0-9]*)$/.test(input.value))return notify('请输入非负整数股数');settlementConfirm('保存IPO配售草稿',r.id,[['原配售',r.allocation_micros===null?'未录入':settlementUnits(r.allocation_micros,6)],['新配售',input.value],['影响','仅保存草稿，不执行结算']],{action:'draft-allocation',order:r.id,shares:input.value,expectedAllocation:r.allocation_micros})}));if(r.allocation_micros!==null)$('detail-actions').prepend(btn('复核并结算配售',()=>settlementConfirm('复核并结算IPO配售',r.id,[['客户',r.email],['确认配售股数',settlementUnits(r.allocation_micros,6)],['影响','持仓入账、释放冻结及可能退款，确认后实际内部记账']],{action:'review-allocation',order:r.id,shares:settlementUnits(r.allocation_micros,6)}),'danger-button'))}}
else if(kind==='会话'){await openConversation(body,r)}
else if(kind==='子管理员'){body.append(section('子管理员权限上下文',[['账户编号',r.user_id],['邮箱',r.email],['角色','SUBADMIN（服务端固定角色）'],['二次认证',r.twofa_confirmed_at?'已开通':'未开通'],['登录限制',r.login_restricted_at?'已限制':'未限制'],['备注',r.note||'未填写'],['邀请使用次数',r.uses??'未提供']]));if(me.role==='MASTER')$('detail-actions').prepend(btn(r.login_restricted_at?'解除子管理员登录限制':'限制子管理员登录',()=>{const restricted=!r.login_restricted_at;dangerous('变更子管理员登录权限',r.user_id,[['对象',r.email],['原状态',r.login_restricted_at?'已限制':'未限制'],['新状态',restricted?'已限制':'未限制'],['影响',restricted?'撤销现有会话，不修改客户归属或资金':'恢复登录，不恢复已撤销会话'],['权限','只能管理属于当前总管理员的子账户']],async reason=>{const latest=(await api('subaccounts')).items.find(x=>x.user_id===r.user_id);if(!latest||latest.login_restricted_at!==r.login_restricted_at)throw Error('账户状态已变化，请刷新');await api('subaccounts',{method:'PATCH',body:JSON.stringify({email:r.email,action:'restriction',restricted,reason})})})}));}
else if(kind==='产品'){
body.append(section('产品与证券信息',[['产品编号',r.id],['产品名称',r.name],['产品类型',r.kind],['Ticker',r.symbol],['ISIN',r.instrument?.isin||'未提供'],['市场',r.market||'未提供'],['配置版本',r.version],['参考报价',money(r.referencePriceCents)],['报价时间',time(r.referenceTimestamp)],['最低数量',r.minQuantity],['持有天数',r.holdingDays],['折扣（基点）',r.discountBps]]));
const form=el('form'),nameLabel=el('label','产品名称'),name=el('input'),statusLabel=el('label','发布状态'),status=el('select');name.value=r.name;name.maxLength=120;name.required=true;name.setAttribute('aria-label','产品名称');status.setAttribute('aria-label','产品发布状态');for(const v of ['DRAFT','PUBLISHED','ARCHIVED']){const o=el('option',v);o.value=v;status.append(o)}status.value=r.status;nameLabel.append(name);statusLabel.append(status);form.className='native-editor';form.append(nameLabel,statusLabel);body.append(el('h3','编辑名称与发布状态'),form,el('p','配置版本由服务端校验。费率、数量、期限与完整档位编辑仍在原有配置模块。','muted'));$('detail-actions').prepend(btn('保存产品变更',()=>{if(!form.reportValidity())return;const desired={name:name.value.trim(),status:status.value};dangerous('确认产品配置变更',r.id,[['名称（原）',r.name],['名称（新）',desired.name],['状态（原）',r.status],['状态（新）',desired.status],['配置版本',r.version],['影响','上架会重新核查参考报价；不自动执行客户交易']],async reason=>{await api('products',{method:'PATCH',body:JSON.stringify({id:r.id,version:r.version,...desired,reason})})})}));$('detail-actions').prepend(btn('完整配置',()=>{$('detail').close();compat('cat')}));
if(r.tiers?.length)body.append(section('现有基金档位',r.tiers.map(t=>[t.id,money(t.principalCents)+' / '+t.holdingDays+' 天 / '+t.profitBps+' 基点'])));
}
else if(kind==='资料'){
const current=r;body.append(el('p','仅所属子管理员可以读取原始资料，明文不保存到本地存储或导出文件。','muted'),el('div',null,'skeleton'));const version=loadVersion;
try{const d=await api('profile-documents?'+new URLSearchParams({email:r.email,kind:r.kind}));if(!$('detail').open||activeRecord?.r!==current||version!==loadVersion)return;body.replaceChildren(section('审核资料',[['客户',r.email],['资料类型',r.kind==='BANK'?'银行卡':'身份证明'],['服务端版本',d.version],['当前状态','待审核']]));if(r.kind==='BANK')body.append(section('银行卡资料',[['银行名称',d.document.bankName],['尾号',d.document.last4]]));else{body.append(kv('证件姓名',d.document.fullName||'未提供'));for(const [side,title]of [['front','证件正面'],['back','证件反面']]){const url=d.document[side];if(typeof url!=='string'||!/^data:image\/(png|jpeg);base64,/.test(url))throw Error('资料图片格式不受支持');const image=el('img');image.src=url;image.alt=title;image.className='review-image';body.append(el('h3',title),image)}}
for(const status of ['REJECTED','APPROVED'])$('detail-actions').prepend(btn(status==='APPROVED'?'通过资料审核':'驳回资料',()=>dangerous(status==='APPROVED'?'通过资料审核':'驳回资料',r.id,[['客户',r.email],['资料类型',r.kind],['原状态','PENDING'],['新状态',status],['版本',d.version],['影响','变更资料审核状态，不等于 AML 或整体风控验收']],async reason=>{await api('profile-documents',{method:'PATCH',body:JSON.stringify({email:r.email,kind:r.kind,status,version:d.version,reason})})}),status==='REJECTED'?'danger-button':''));
$('detail-actions').querySelectorAll('button').forEach(b=>{if(b.textContent==='导出详情')b.disabled=true});
}catch(error){if($('detail').open&&activeRecord?.r===current)body.replaceChildren(empty('error','无法读取审核资料',error.message,()=>openRecord('资料',r)))}
}
else if(kind==='审计'){body.append(section('服务端审计',[['编号',r.id],['操作者',r.admin_email],['动作',r.action],['对象',r.target],['时间',time(r.created_at)],['原因',r.detail?.reason||'未提供']]));}}
let settlementMode='terms';
function settlementUnits(raw,scale){if(raw==null)return '未提供';try{const n=BigInt(raw),base=10n**BigInt(scale),fraction=(n%base).toString().padStart(scale,'0').replace(/0+$/,'');return (n/base).toString()+(fraction?'.'+fraction:'')}catch{return '单位数据不可用'}}
function settlementScaled(text,scale){if(!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text))throw Error('金额格式无效');const [whole,fraction='']=text.split('.');if(fraction.length>scale)throw Error('最多'+scale+'位小数');const value=(whole+fraction.padEnd(scale,'0')).replace(/^0+(?=\d)/,'');if(value.length>14||BigInt(value)<=0n)throw Error('金额超出当前接口范围');return value}
function settlementJournal(){const raw=sessionStorage.getItem('nuvexa.settlement.pending.'+me.userId);if(!raw)return null;const d=JSON.parse(raw);if(!d||typeof d.key!=='string'||d.key.length<8||d.key.length>128||!/^[a-f0-9]{64}$/.test(d.digest||''))throw Error('未决复核记录损坏，请先人工核查');return d}
async function settlementWrite(payload,reason){const store='nuvexa.settlement.pending.'+me.userId,body={...payload,reason};const canonical=JSON.stringify(body,Object.keys(body).sort());const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))).map(v=>v.toString(16).padStart(2,'0')).join('');let pending=settlementJournal(),created=!pending;if(pending&&pending.digest!==digest)throw Error('存在另一项未决复核，请先核对未决操作，不能改条件重复提交');pending=pending||{key:crypto.randomUUID(),digest};sessionStorage.setItem(store,JSON.stringify(pending));try{const result=await api('product-settlement',{method:'POST',body:JSON.stringify(body),key:pending.key});if(!result.id&&!result.saved)throw Error('缺少服务端操作回执');sessionStorage.removeItem(store);return result}catch(error){if(created&&[400,403,404,409,413,422].includes(error.status)&&!/Idempotency/i.test(error.message))sessionStorage.removeItem(store);throw error}}
function settlementConfirm(title,id,fields,payload){dangerous(title,id,fields,reason=>settlementWrite(payload,reason))}
async function reconcileSettlement(){try{const p=settlementJournal();if(!p)return notify('没有未决复核');const receipt=await api('product-settlement?'+new URLSearchParams({key:p.key}));if(receipt.found){sessionStorage.removeItem('nuvexa.settlement.pending.'+me.userId);notify('服务端已确认原操作，未重复执行');await load()}else notify('未找到已提交回执，保留原编号与原条件核查，不自动重发')}catch(e){notify(e.message)}}
function settlementForm(kind,products){const record={id:kind==='create'?'new-product':'new-price',name:kind==='create'?'新建IPO / 基金产品':'录入发行价 / 净值'};const body=showDrawer('结算配置',record,'complex'),form=el('form');form.className='native-editor';const inputs={};function field(key,label,choices){const wrap=el('label',label),i=el(choices?'select':'input');i.setAttribute('aria-label',label);i.required=true;if(choices)for(const [value,title]of choices){const o=el('option',title);o.value=value;i.append(o)}else i.maxLength=120;wrap.append(i);inputs[key]=i;form.append(wrap)}
if(kind==='create'){field('kind','产品类型',[['IPO','IPO内部认购'],['MUTUAL_FUND','普通基金']]);field('symbol','证券代码');field('name','产品名称')}else{field('product','选择结算产品',products.map(p=>[p.id,p.symbol+' · '+p.display_name]));field('date','生效日期');inputs.date.type='date';field('price','每股或份价格USD');inputs.price.inputMode='decimal'}body.append(form,el('p','所有修改沿用当前服务端内部结算规则；不新增外部券商交易。','muted'));$('detail-actions').prepend(btn('确认录入',()=>{if(!form.reportValidity())return;try{const values=Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.value.trim()]));if(kind==='create'){values.symbol=values.symbol.toUpperCase();if(!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(values.symbol))throw Error('证券代码格式无效')}else values.price=settlementScaled(values.price,6);settlementConfirm(record.name,record.id,Object.entries(values).map(([k,v])=>[k,v]),{action:kind==='create'?'create':'enter-price',...values})}catch(e){notify(e.message)}}))}
function renderSettlement(data){if(settlementMode==='terms')table(data.terms.map(r=>({...r,priceDisplay:settlementUnits(r.unit_price_micros,6),status:r.reviewed_at?'已复核':'待复核',currency:'USD'})),[['symbol','证券'],['id','价格编号'],['effective_date','生效日期'],['priceDisplay','价格USD'],['status','复核状态']],'价格复核');else table(data.orders.map(r=>({...r,requestedDisplay:settlementUnits(r.requested_quantity_micros,6),allocationDisplay:settlementUnits(r.allocation_micros,6),currency:'USD'})),[['id','订单编号'],['email','客户'],['symbol','证券'],['requestedDisplay','申请股数'],['allocationDisplay','配售股数'],['status','状态']],'IPO配售');const tools=el('div',null,'toolbar');tools.append(btn('发行价 / 净值',()=>{settlementMode='terms';renderSettlement(data)}),btn('IPO配售',()=>{settlementMode='orders';renderSettlement(data)}),btn('新建结算产品',()=>settlementForm('create',data.products)),btn('录入发行价 / 净值',()=>{if(!data.products.length)return notify('请先创建结算产品');settlementForm('price',data.products)}),btn('核对未决操作',reconcileSettlement));$('workspace').prepend(tools);}
const seenInbox=new Map();
async function openConversation(body,r){
 const record=r;const footer=$('detail-actions');footer.querySelectorAll('button').forEach(b=>{if(b.textContent==='导出详情')b.disabled=true});
 const storeKey='nuvexa.support.pending.'+me.userId+'.'+r.email;let sending=false;
 function journal(){const raw=sessionStorage.getItem(storeKey);if(!raw)return null;const value=JSON.parse(raw);if(!value||typeof value.key!=='string'||value.key.length<8||value.key.length>128||!/^[a-f0-9]{64}$/.test(value.digest||''))throw Error('未决回复记录损坏，请核查会话后处理，暂不重复发送');return value}
 const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const content=el('div',null,'conversation'),form=el('form'),text=el('textarea'),status=el('p'),send=btn('发送回复',()=>{}),verify=btn('核对未决回复',async()=>{try{const pending=journal();if(!pending)return notify('当前没有未决回复');const d=await api('support?'+new URLSearchParams({email:r.email,key:pending.key}));if(d.found){sessionStorage.removeItem(storeKey);text.value='';status.textContent='服务端已找到原回复，未重复发送。';await refresh()}else status.textContent='服务端尚未找到已提交回执。保留原文与原编号后重试，不要另建重复回复。'}catch(e){status.textContent=e.message}});
 text.required=true;text.maxLength=4000;text.rows=4;text.setAttribute('aria-label','客服回复内容');send.type='submit';form.append(el('label','回复客户（最多4000字符，编码后请求不超过8KiB）'),text,send,verify,status);status.setAttribute('role','status');body.replaceChildren(content,form);
 async function refresh(){const d=await api('support?'+new URLSearchParams({email:r.email}));if(!$('detail').open||activeRecord?.r!==record)return;content.replaceChildren();for(const item of d.items){const message=el('article',null,'message');message.append(el('small',(item.sender_role==='CLIENT'?'客户':'管理员')+' · '+time(item.created_at)),el('p',item.body));content.append(message)}if(!d.items.length)content.append(el('p','暂无会话记录','muted'));seenInbox.set(r.email,r.message_id)}
 form.onsubmit=async e=>{e.preventDefault();if(sending||!text.value.trim())return;sending=true;send.disabled=verify.disabled=true;let createdPending=false;try{const message=text.value.trim();if(new TextEncoder().encode(JSON.stringify({email:r.email,message})).length>8192)throw Object.assign(Error('回复编码后超过8KiB，请缩短内容'),{status:413});const hash=await digest(message);let pending=journal();if(pending&&pending.digest!==hash)throw Error('有上一条结果未确认的回复，请先核对未决回复，不能更换原文重复发送');if(!pending)createdPending=true;pending=pending||{key:crypto.randomUUID(),digest:hash};sessionStorage.setItem(storeKey,JSON.stringify(pending));const receipt=await api('support',{method:'POST',body:JSON.stringify({email:r.email,message}),key:pending.key});if(!receipt.id)throw Error('回复缺少服务端编号');sessionStorage.removeItem(storeKey);text.value='';status.textContent='回复已获服务端确认：'+receipt.id;await refresh()}catch(error){if(createdPending&&[400,403,404,413,422].includes(error.status)){sessionStorage.removeItem(storeKey);status.textContent=error.message+'；请求被拒绝，可修正后重新提交。'}else status.textContent=error.message+'；请先核对未决回复，避免重复发送。'}finally{sending=false;send.disabled=verify.disabled=false}};
 try{await refresh()}catch(error){content.replaceChildren(empty('error','无法读取会话',error.message,refresh))}
}
async function openAnnouncement(){const r={id:'platform',name:'平台公告',status:'读取中'};const body=showDrawer('公告',r,'complex');body.append(el('div',null,'skeleton'));try{const d=await api('announcements');if(activeRecord?.r!==r||!$('detail').open)return;body.replaceChildren(section('当前版本',[['版本',d.version||'尚未发布'],['展示状态',d.item?'已发布':'无公告'],['发布后影响','同步客户电脑与手机端']])) ;const form=el('form'),title=el('input'),text=el('textarea');title.required=true;title.maxLength=100;title.value=d.item?.title||'';title.setAttribute('aria-label','公告标题');text.required=true;text.rows=8;text.maxLength=3000;text.value=d.item?.body||'';text.setAttribute('aria-label','公告正文');form.className='native-editor';form.append(el('label','标题'),title,el('label','正文'),text);body.append(form);const save=action=>{if(action==='publish'&&!form.reportValidity())return;const values={title:title.value.trim(),body:text.value.trim()};dangerous(action==='publish'?'发布平台公告':'撤下平台公告','platform',[['原标题',d.item?.title||'无'],['新标题',action==='publish'?values.title:'无公告'],['原版本',d.version||'初始版本'],['影响','客户端公开展示内容变更；后台记录原因和版本']],async reason=>{await api('announcements',{method:'POST',body:JSON.stringify({action,version:d.version,...values,reason})})})};$('detail-actions').prepend(btn('发布公告',()=>save('publish')));const withdraw=btn('撤下公告',()=>save('withdraw'),'danger-button');withdraw.disabled=!d.item;$('detail-actions').prepend(withdraw)}catch(error){if(activeRecord?.r===r)body.replaceChildren(empty('error','无法加载公告',error.message,openAnnouncement))}}

function dangerous(title,id,fields,run){const d=$('danger');if(d.open)d.close();$('danger-form').reset();$('danger-title').textContent=title;$('danger-diff').replaceChildren(section('本次操作影响',fields));$('danger-message').textContent='请填写至少 10 个字符的原因，并输入编号：'+id;confirmAction={id,run};d.showModal()}
function confirmControl(r){const next=r.login_policy==='DENY'?'ALLOW':'DENY';dangerous('更改客户登录限制',r.id,[['客户',r.email],['原状态',label(r.login_policy)],['新状态',label(next)],['影响范围','仅登录权限，不是资金冻结或持仓冻结'],['复核人','由现有服务端权限及二次验证决定']],async reason=>{const fresh=(await api('clients')).items.find(x=>x.id===r.id);if(!fresh||fresh.login_policy!==r.login_policy)throw Error('状态已变化，请刷新后重新审核');await api('clients',{method:'PATCH',body:JSON.stringify({email:r.email,field:'login_policy',value:next,reason})})})}
function confirmApproval(r,decision){dangerous(decision==='APPROVE'?'通过资金审批':'驳回资金审批',r.id,[['客户',r.email],['当前节点',label(r.status)],['申请金额',money(r.amountCents)],['本次操作',decision==='APPROVE'?(r.status==='PENDING'?'初审通过，不立即入账':'终审，服务端核验后记账'):'驳回，不按批准入账'],['币种','USD'],['市场','申请未提供'],['复核','沿用服务端两阶段审批，不能绕过']],async reason=>{const fresh=(await api('requests')).items.find(x=>x.id===r.id);if(!fresh||fresh.status!==r.status||String(fresh.amountCents)!==String(r.amountCents))throw Error('申请已变化，请刷新，未提交当前操作');await api('requests',{method:'POST',body:JSON.stringify({id:r.id,decision,reason,expectedStatus:r.status})})})}
$('danger-form').onsubmit=async e=>{e.preventDefault();if(posting||!confirmAction)return;const f=e.currentTarget,reason=f.elements.reason.value.trim();if([...reason].length<10||f.elements.confirmation.value!==confirmAction.id){$('danger-message').textContent='原因至少 10 个字符，确认编号必须完全一致。';return}posting=true;const buttons=[...f.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await confirmAction.run(reason);$('danger').close();$('detail').close();notify('服务端已确认操作；正在刷新数据。');await load()}catch(error){$('danger-message').textContent=error.status===428?'二次验证未完成，未获服务端执行确认。':error.message+'；若网络中断，请先刷新核查记录，不要盲目重复提交。'}finally{posting=false;buttons.forEach(b=>b.disabled=false)}};


function renderClientMirror() {
  sessionStorage.setItem('cncap.admin.entry','1');
  if(!localStorage.getItem('cncap.admin.session'))localStorage.setItem('cncap.admin.session','cn-cookie-session');
  const panel=el('section',null,'panel client-mirror-panel');
  const controls=el('div',null,'toolbar');
  const select=el('select');
  select.setAttribute('aria-label','选择镜像客户');
  const placeholder=el('option','请选择客户账户');placeholder.value='';select.append(placeholder);
  for(const client of clients){const option=el('option',client.email);option.value=client.email;select.append(option);}
  const host=el('div',null,'client-mirror-content');
  const status=el('p','选择客户后打开手机前台镜像。','muted');
  status.setAttribute('role','status');
  let generation=0;
  function open() {
    const email=select.value;
    const current=++generation;
    host.replaceChildren();status.hidden=false;
    if(!email){status.textContent='选择客户后打开手机前台镜像。';return;}
    status.textContent='正在读取客户账户…';
    sessionStorage.setItem('cncap.admin.entry','1');
    const frame=el('iframe');
    frame.className='client-mirror-host';frame.title='客户手机前台镜像';
    frame.src='/admin-compat';
    frame.onload=async()=>{
      try{
        const document=frame.contentDocument;
        document.documentElement.classList.add('direct-client-mirror');
        const style=document.createElement('style');
        style.textContent='.direct-client-mirror body{margin:0!important;padding:0!important;background:#f4f6fa!important}.direct-client-mirror body>:not(dialog):not(script):not(style){display:none!important}.direct-client-mirror dialog.ops-phone{position:fixed!important;inset:8px 0 auto!important;margin:0 auto!important;width:min(390px,100%)!important;max-width:100%!important;max-height:calc(100dvh - 16px)!important}.direct-client-mirror dialog.ops-phone::backdrop{background:transparent!important}';
        document.head.append(style);
        const deadline=Date.now()+15000;
        while(!frame.contentWindow.CNAdminMirror){
          if(current!==generation||!frame.isConnected)return;
          if(Date.now()>deadline)throw Error('镜像初始化超时，请重新加载');
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        if(current!==generation||!frame.isConnected)return;
        await frame.contentWindow.CNAdminMirror.open(email);
        if(current!==generation||!frame.isConnected)return;
        status.hidden=true;
        document.querySelector('dialog.ops-phone')?.addEventListener('close',()=>{
          if(current!==generation||!frame.isConnected)return;
          select.value='';open();
        },{once:true});
      }catch(error){
        if(current!==generation||!frame.isConnected)return;
        status.hidden=false;status.textContent=error.message;
      }
    };
    host.append(frame);
  }
  select.onchange=open;
  controls.append(select,btn('重新加载镜像',open),btn('关闭镜像',()=>{select.value='';open();}));
  panel.append(controls,status,host);$('workspace').replaceChildren(panel);
}

function compat(section,title='业务配置',description='',tab) {
  const panel=el('section',null,'panel compatibility-panel');
  panel.setAttribute('aria-label',title);
  const tools=el('div',null,'compatibility-tools');
  const direct=el('a','在独立窗口打开 ↗');
  direct.href='/admin-compat'; direct.target='_blank'; direct.rel='noopener';
  tools.append(btn('返回列表',()=>load()),direct); panel.append(tools);
  if(matchMedia('(max-width:800px)').matches) {
    panel.append(el('p','完整配置请在电脑上操作。','muted'));
    $('workspace').replaceChildren(panel);return;
  }
  sessionStorage.setItem('cncap.admin.entry','1');
  if(!localStorage.getItem('cncap.admin.session'))localStorage.setItem('cncap.admin.session','cn-cookie-session');
  const frame=el('iframe');frame.className='compatibility-frame';
  frame.title=title;frame.src='/admin-compat';
  frame.onload=()=>{
    try {
      const document=frame.contentDocument;
      const style=document.createElement('style');
      style.textContent='.top{display:none!important}html,body{margin:0!important}';
      document.head.append(style);
      document.querySelector('[data-p="'+section+'"]')?.click();
      if(tab)document.querySelector('[data-t="'+tab+'"]')?.click();
    } catch {notify('配置加载失败，请使用独立窗口入口');}
  };
  panel.append(frame);$('workspace').replaceChildren(panel);
}
async function load(){const version=++loadVersion;loading();try{if(view==='home'){const [clientResult,feed,funding]=await Promise.allSettled([api('clients'),api('notifications'),api('funding-overview')]);if(version!==loadVersion)return;if(clientResult.status==='rejected')throw clientResult.reason;clients=clientResult.value.items;renderDashboard(feed,funding)}
else if(view==='mirror'){clients=(await api('clients')).items;if(version!==loadVersion)return;renderClientMirror()}
else if(view==='accounts'){clients=(await api('clients')).items;if(version!==loadVersion)return;table(clients,[['email','客户账户'],['id','客户编号'],['subadmin_email','所属子管理员'],['login_policy','登录策略'],['account_type','账户类型']],'账户')}
else if(['orders','positions'].includes(view)){clients=(await api('clients')).items;if(version!==loadVersion)return;const selector=el('select');selector.setAttribute('aria-label','选择客户账户');const none=el('option','请选择有权访问的客户');none.value='';selector.append(none);for(const c of clients){const o=el('option',c.email);o.value=c.email;selector.append(o)}if(!clients.some(client=>client.email===selectedEmail)){selectedEmail='';orders=[];account=null}selector.value=selectedEmail;selector.onchange=()=>{selectedEmail=selector.value;orders=[];account=null;load()};if(!selectedEmail){$('workspace').replaceChildren(selector,empty('none','先选择一个客户账户','订单及持仓来自该客户视图，不伪造全平台聚合。'));return}account=await api('client-view?'+new URLSearchParams({email:selectedEmail}));if(version!==loadVersion)return;orders=account.orders.map(x=>({...x,currency:'USD',status:'内部成交已记账'}));positions=account.positions.map(x=>({...x,id:x.market+':'+x.symbol,currency:'USD'}));view==='orders'?table(orders,[['id','订单编号'],['symbol','Ticker'],['market','市场'],['side','方向'],['quantity','成交数量'],['amount_usd_cents','成交金额（美分）'],['status','状态']],'订单'):table(positions,[['symbol','Ticker'],['market','市场'],['currency','账户币种'],['quantity','数量'],['locked_quantity','锁定数量'],['cost_cents','成本（美分）']],'持仓');$('workspace').prepend(selector)}
else if(view==='approvals'){requests=(await api('requests')).items;if(version!==loadVersion)return;table(requests,[['id','申请编号'],['email','客户'],['kind','申请类型'],['amountCents','金额（USD 美分）'],['status','审批节点']],'审批')}
else if(view==='settlement'){const data=await api('product-settlement');if(version!==loadVersion)return;renderSettlement(data)}
else if(view==='support'){if(me.role!=='MASTER'){$('workspace').replaceChildren(empty('restricted','客服与公告由总管理员管理','保持现有服务端角色边界，不向子管理员开放此入口。'));return}const data=await api('support/inbox');if(version!==loadVersion)return;table(data.items.map(x=>({...x,id:x.email,status:seenInbox.get(x.email)===x.message_id?'本次已查看':'本次未查看'})),[['email','客户会话'],['created_at','最近客户来信'],['status','本会话查看状态']],'会话');$('workspace').prepend(btn('平台公告',openAnnouncement));$('workspace').append(el('p','查看状态仅代表本次页面会话，未接入全团队已读同步。','muted'))}
else if(view==='permissions'){const data=await api('subaccounts');if(version!==loadVersion)return;table(data.items.map(x=>({...x,id:x.user_id,status:x.login_restricted_at?'限制登录':'正常'})),[['email','子管理员'],['user_id','账户编号'],['status','登录状态'],['uses','邀请使用次数'],['note','备注']],'子管理员');$('workspace').prepend(el('p','当前模型为MASTER / SUBADMIN及所属客户，不提供前端升权或假角色矩阵。','muted'));$('workspace').append(btn('账户开通、凭据和完整配置',()=>compat('cli','子管理员账户配置','管理账户开通和验证凭据。','t-sub')))}
else if(view==='products'){const data=await api('products');if(version!==loadVersion)return;table(data.items,[['name','产品名称'],['id','产品编号'],['symbol','Ticker'],['kind','类型'],['market','市场'],['status','状态'],['version','配置版本']],'产品');$('workspace').append(btn('新增产品及完整档位配置',()=>compat('cat')))}
else if(view==='documents'){if(me.role!=='SUBADMIN'){if(version!==loadVersion)return;$('workspace').replaceChildren(empty('restricted','资料审核由所属子管理员执行','沿用原服务端规则，总管理员不能越过客户归属直接读取原始资料。'));return}const data=await api('profile-documents');if(version!==loadVersion)return;table(data.items.map(x=>({...x,id:x.email+' / '+x.kind,documentStatus:x.status==='PENDING'?'待审核':label(x.status)})),[['email','客户'],['kind','资料类型'],['documentStatus','审核状态'],['bank_last4','银行卡尾号'],['updated_at','更新时间']],'资料')}
else if(view==='audit'){audits=(await api('audit?limit=100')).items;if(version!==loadVersion)return;table(audits,[['id','审计编号'],['action','动作'],['target','对象'],['admin_email','操作者'],['created_at','记录时间']],'审计')}
else{if(version!==loadVersion)return;compat(({products:'cat',documents:'appr',support:'cli',permissions:'cli',settlement:'cat'})[view]);if(view==='permissions')$('workspace').prepend(empty('integration','动态角色权限尚未整合','当前真实模型为 MASTER / SUBADMIN 及客户归属。附件中的三层身份和任意角色权限不能充当服务端权限。'))}}
catch(error){if(version!==loadVersion)return;$('workspace').replaceChildren(empty('error',error.status===403?'权限受限':'无法加载数据',error.message,()=>load()))}}
function search(){const query=$('command-query').value.trim().toLowerCase(),host=$('command-results');host.replaceChildren();const groups=[['页面',Object.entries(titles).filter(([id])=>canOpen(id)).map(([id,name])=>({name,id})),r=>navigate(r.id)],['账户',clients,r=>{navigate('accounts');openRecord('账户',r)}],['订单',orders,r=>openRecord('订单',r)],['审批',requests,r=>openRecord('审批',r)],['审计记录',audits,r=>openRecord('审计',r)]];for(const [name,values,run]of groups){const found=values.filter(r=>[r.id,r.name,r.email,r.symbol,r.action,r.target].some(v=>String(v||'').toLowerCase().includes(query))).slice(0,12);if(found.length){host.append(el('h3',name));for(const r of found)host.append(btn(r.name||r.email||r.symbol||r.action||r.id,()=>{$('command').close();run(r)}))}}if(!host.children.length)host.append(el('p','当前已加载数据没有结果。'))}
$('search-open').onclick=()=>{$('command').showModal();search();$('command-query').focus()};$('command-query').oninput=search;document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!$('command').open)$('search-open').click()}});document.addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(b&&!posting)$(b.dataset.close).close()});$('detail').addEventListener('close',()=>{if(!$('detail').open&&activeRecord?.kind==='资料'){$('detail-content').replaceChildren();activeRecord=null}});$('danger').addEventListener('cancel',e=>{if(posting)e.preventDefault()});$('refresh').onclick=()=>load();$('menu-toggle').onclick=()=>document.body.classList.toggle('menu-open');
$('sidebar-collapse').onclick=e=>{const collapsed=document.body.classList.toggle('sidebar-collapsed');e.currentTarget.setAttribute('aria-expanded',String(!collapsed));e.currentTarget.setAttribute('aria-label',collapsed?'展开侧栏':'收起侧栏');e.currentTarget.textContent=collapsed?'›':'‹'};$('pin-page').onclick=()=>{const p=preferences(),pins=p.pins||[];savePref('pins',pins.includes(view)?pins.filter(k=>k!==view):[...pins,view]);recent()};$('logout').onclick=async()=>{try{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'X-CN-Session-Scope':'admin',...(localStorage.getItem('cncap.admin.session')?{Authorization:'Bearer '+localStorage.getItem('cncap.admin.session')}:{})},cache:'no-store'});if(!r.ok)throw Error('退出未获确认');localStorage.removeItem('cncap.admin.session');location.assign('/login?admin=1')}catch(e){notify(e.message)}};
(async()=>{try{me=await api('me');if(!['MASTER','SUBADMIN'].includes(me.role))throw Error('无可用管理员权限');$('identity').textContent=me.role==='MASTER'?'总管理员':'子管理员';await navigate(location.hash.slice(1)||'home')}catch(e){$('workspace').replaceChildren(empty('error','无法验证管理员会话',e.message))}})();
})();
