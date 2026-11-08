/**
 * Issue #42 coordination observer: reads GitHub evidence only.
 * Sole permitted write: a single github-actions[bot] evidence comment.
 */
const ISSUE=Number(process.env.COORDINATION_ISSUE||'42');
const REPO=process.env.GITHUB_REPOSITORY||'dalulu05168/Lu----00001';
const TOKEN=process.env.GITHUB_TOKEN||'';
const MARKER='<!-- gsp-cross-window-monitor:v1 -->';

export const WINDOWS=Object.freeze([
  {key:'backend',label:'后台与 2FA',ackPattern:/后台|管理后台/,branches:['dev/admin-backend-hardening-20261108']},
  {key:'frontend',label:'前台账号与 API',ackPattern:/前台.*(?:API|接口)|API.*前台/,branches:['dev/frontend-phase2-session-catalog-20261108','work/frontend-api-contract-20261108','dev/frontend-api-readback-contract-20261108']},
  {key:'ui-cleanup',label:'UI 假数据清理',ackPattern:/UI.*假数据|假数据.*清理/,branches:['work/ui-fake-data-audit-20261108']},
  {key:'market-scope',label:'US/CN 市场约束',ackPattern:/港股|马股|US.CN|市场范围/,branches:['dev/remove-hk-my-markets-20261108']},
  {key:'market-data',label:'行情接口调研',ackPattern:/市场数据|行情.*API|API.*行情/,branches:['work/market-data-api-research-20261108']},
  {key:'mobile',label:'独立手机前台',ackPattern:/手机|移动端/,branches:['work/mobile-site-implementation-20261107']},
  {key:'desktop',label:'电脑版前台',ackPattern:/电脑前台|桌面前台/,branches:['work/desktop-front-20261107']}
]);

export function discoverAcks(comments){
  return WINDOWS.map(window=>{
    const c=[...comments].reverse().find(item=>{
      const lead=String(item.body||'').trim().slice(0,240);
      return /^ACK(?:\s|[（(｜|]|$)/i.test(lead)&&window.ackPattern.test(lead);
    });
    return {key:window.key,label:window.label,commentId:c?.id??null,commentUrl:c?.html_url??null};
  });
}
export function latestCiForSha(runs,sha){
  const matching=(runs||[]).filter(run=>run.head_sha===sha)
    .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
  const run=matching[0];
  if(!run)return {state:'no-evidence',url:null};
  if(run.status!=='completed')return {state:'pending',url:run.html_url};
  return {state:run.conclusion==='success'?'ci-pass':'ci-failed',url:run.html_url};
}
export function renderDashboard({issueState,acks,branches}){
  const esc=x=>String(x??'').replace(/[|\r\n]/g,' ').replace(/[`]/g,'');
  const lines=[
    MARKER,
    '## 自动协作证据看板（只读核查）',
    '',
    '**说明：** 本评论由 GitHub Actions 按计划更新。ACK 仅证明留言存在；CI 仅证明对应提交的自动化作业结果。所有模块的真实业务验收仍需要受控 API、数据库、权限、浏览器等证据。此机制不会自动唤醒独立 GPT 窗口，也不会自动部署。',
    '',
    `- 协作 Issue #${ISSUE} 状态：**${issueState==='open'?'Open':'Closed（保留原状）'}**`,
    '- 门禁：**数据库迁移、账户/资金写入、跨分支合并、生产发布均需单独人工批准**。',
    '',
    '| 责任窗口 | 已读 ACK 证据 | 分支与最新提交 | 对应提交 CI |',
    '|---|---|---|---|'
  ];
  for(const ack of acks){
    const group=WINDOWS.find(w=>w.key===ack.key);
    const ackCell=ack.commentUrl?`[已留回执](${ack.commentUrl})`:'尚无匹配 ACK';
    const items=branches.filter(b=>group.branches.includes(b.name));
    const branchCell=items.length?items.map(b=>b.found?esc(b.name)+' @ '+esc(b.sha?.slice(0,12)):esc(b.name)+'（未找到）').join('<br>'):'未记录';
    const ciCell=items.length?items.map(b=>{
      if(!b.found)return '未知';
      if(!b.ci||b.ci.state==='no-evidence')return '未找到当前 SHA 的 CI';
      const labels={'ci-pass':'CI 通过（非业务验收）','ci-failed':'CI 未通过','pending':'CI 待完成'};
      return b.ci.url?`[${labels[b.ci.state]}](${b.ci.url})`:labels[b.ci.state];
    }).join('<br>'):'未核实';
    lines.push(`| ${esc(group.label)} | ${ackCell} | ${branchCell} | ${ciCell} |`);
  }
  lines.push('',
    '**待确认 P0：** 共享 QA 双阶段 2FA 与新后台单阶段实现冲突；Neon main 的迁移 001–005 与 QA 的另一套 001–022 不可按同编号覆盖；QA 自选市场 US/RO 与前台 US/CN 契约不一致；正式环境的部署 SHA、连接数据库、资金/审批和真实交易能力尚无完整验收。',
    '',
    '执行窗口须在开始工作、修改共享接口或请求合并前主动阅读 Issue #42，并回报：`模块 | 分支 SHA | 修改内容 | 测试命令/真实结果 | 目标数据库分支 | 部署证据 | 剩余阻断`。',
    '',
    '_这是证据索引，不是任务已完成或线上业务可用的证明。_');
  return lines.join('\n');
}
function ghHeaders(){
  return {accept:'application/vnd.github+json',authorization:`Bearer ${TOKEN}`,
    'x-github-api-version':'2022-11-28','user-agent':'gsp-cross-window-monitor','content-type':'application/json'};
}
async function gh(path,options={}){
  const res=await fetch(`https://api.github.com${path}`,{...options,headers:ghHeaders()});
  if(res.status===404&&options.allow404)return null;
  if(!res.ok)throw new Error(`GitHub request failed (${res.status}) for ${path}: ${(await res.text()).slice(0,250)}`);
  return res.status===204?null:res.json();
}
async function pages(path,limit=10){
  const all=[];
  for(let page=1;page<=limit;page++){
    const values=await gh(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
    all.push(...values);
    if(values.length<100)return all;
  }
  throw new Error(`Pagination limit exceeded for ${path}; refusing incomplete evidence`);
}
export async function monitor(){
  if(!TOKEN)throw new Error('GITHUB_TOKEN missing; refusing unauthenticated run');
  if(!/^[\w.-]+\/[\w.-]+$/.test(REPO))throw new Error('Invalid repository');
  if(!Number.isSafeInteger(ISSUE)||ISSUE<1)throw new Error('Invalid issue number');
  const root=`/repos/${REPO}`;
  const issue=await gh(`${root}/issues/${ISSUE}`);
  const comments=await pages(`${root}/issues/${ISSUE}/comments`);
  const acks=discoverAcks(comments);
  const names=[...new Set(WINDOWS.flatMap(group=>group.branches))],branches=[];
  for(const name of names){
    const branch=await gh(`${root}/branches/${encodeURIComponent(name)}`,{allow404:true});
    if(!branch){branches.push({name,found:false});continue;}
    const sha=branch.commit?.sha;
    if(!/^[0-9a-f]{40}$/.test(sha||''))throw new Error(`Invalid SHA for ${name}`);
    const runs=await gh(`${root}/actions/runs?branch=${encodeURIComponent(name)}&per_page=30`);
    branches.push({name,found:true,sha,ci:latestCiForSha(runs.workflow_runs,sha)});
  }
  const body=renderDashboard({issueState:issue.state,acks,branches});
  const prior=comments.find(x=>x.user?.login==='github-actions[bot]'&&x.body?.includes(MARKER));
  if(prior&&prior.body===body){
    process.stdout.write('Dashboard unchanged; no comment created or edited.\n');
    return {changed:false,commentId:prior.id};
  }
  const saved=prior
    ?await gh(`${root}/issues/comments/${prior.id}`,{method:'PATCH',body:JSON.stringify({body})})
    :await gh(`${root}/issues/${ISSUE}/comments`,{method:'POST',body:JSON.stringify({body})});
  process.stdout.write(`Dashboard ${prior?'updated':'created'}: ${saved.html_url}\n`);
  return {changed:true,commentId:saved.id};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  monitor().catch(e=>{console.error(e.message);process.exitCode=1;});
}
