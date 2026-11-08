import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverAcks,latestCiForSha,renderDashboard,WINDOWS} from '../scripts/cross-window-monitor.mjs';

test('ACK evidence requires actual ACK prefix, not quoted instruction',()=>{
  const acks=discoverAcks([
    {id:3,body:'请后台回复 ACK',html_url:'https://example.test/3'},
    {id:5,body:'ACK | 管理后台窗口 | 已读取 Issue #42',html_url:'https://example.test/5'},
    {id:6,body:'ACK | UI 假数据清理窗口 | 无工作分支',html_url:'https://example.test/6'}
  ]);
  assert.equal(acks.find(x=>x.key==='backend').commentId,5);
  assert.equal(acks.find(x=>x.key==='ui-cleanup').commentId,6);
  assert.equal(acks.find(x=>x.key==='frontend').commentId,null);
});

test('a passing CI on an old SHA must not validate new branch head',()=>{
  const previous='a'.repeat(40),now='b'.repeat(40);
  const runs=[{head_sha:previous,status:'completed',conclusion:'success',created_at:'2026-11-08T00:01:00Z',html_url:'https://example.test/run'}];
  assert.equal(latestCiForSha(runs,now).state,'no-evidence');
  assert.equal(latestCiForSha(runs,previous).state,'ci-pass');
  assert.equal(latestCiForSha([{...runs[0],head_sha:now,conclusion:'failure'}],now).state,'ci-failed');
});

test('dashboard preserves closed state, non-acceptance and no agent wake claim',()=>{
  const acks=WINDOWS.map(w=>({key:w.key,label:w.label,commentId:null,commentUrl:null}));
  const body=renderDashboard({issueState:'closed',acks,branches:[]});
  assert.match(body,/Closed（保留原状）/);
  assert.match(body,/非业务验收|业务验收/);
  assert.match(body,/不会自动唤醒独立 GPT/);
  assert.match(body,/数据库迁移/);
});

test('dashboard deterministic for identical input',()=>{
  const args={issueState:'open',acks:WINDOWS.map(w=>({key:w.key,label:w.label,commentId:null,commentUrl:null})),branches:[]};
  assert.equal(renderDashboard(args),renderDashboard(args));
});

test('monitor creates one bot comment and skips duplicate writes',async()=>{
  const oldFetch=globalThis.fetch,oldToken=process.env.GITHUB_TOKEN,oldRepo=process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_TOKEN='local-test-only';
  process.env.GITHUB_REPOSITORY='dalulu05168/Lu----00001';
  const {monitor}=await import('../scripts/cross-window-monitor.mjs?isolated-test');
  let comment=null;
  const mutations=[];
  const sha='1'.repeat(40);
  const acknowledgment={id:10,body:'ACK | 管理后台窗口 | 已读',html_url:'https://github.com/example/issues/42#issuecomment-10',user:{login:'dalulu05168'}};
  globalThis.fetch=async(rawUrl,opts={})=>{
    const url=new URL(rawUrl),path=url.pathname,method=opts.method||'GET';
    let result;
    if(method==='GET'&&path.endsWith('/issues/42'))result={state:'closed'};
    else if(method==='GET'&&path.endsWith('/issues/42/comments'))result=comment?[acknowledgment,comment]:[acknowledgment];
    else if(method==='GET'&&path.includes('/branches/'))result={commit:{sha}};
    else if(method==='GET'&&path.endsWith('/actions/runs'))result={workflow_runs:[]};
    else if(method==='POST'&&path.endsWith('/issues/42/comments')){
      mutations.push(method);
      comment={id:123,body:JSON.parse(opts.body).body,html_url:'https://github.com/example/issues/42#issuecomment-123',user:{login:'github-actions[bot]'}};
      result=comment;
    }else throw new Error('Unexpected request: '+method+' '+path);
    return {ok:true,status:200,async json(){return result}};
  };
  try{
    const first=await monitor();
    assert.deepEqual(first,{changed:true,commentId:123});
    assert.match(comment.body,/Closed（保留原状）/);
    assert.match(comment.body,/已留回执/);
    const second=await monitor();
    assert.deepEqual(second,{changed:false,commentId:123});
    assert.deepEqual(mutations,['POST']);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=oldToken;
    if(oldRepo===undefined)delete process.env.GITHUB_REPOSITORY;else process.env.GITHUB_REPOSITORY=oldRepo;
  }
});
