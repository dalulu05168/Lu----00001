import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNewsService} from '../src/news-service.mjs';
const now = Date.parse('2026-11-11T12:00:00Z');
const story = (extra = {}) => ({id:1, title:'Market report', url:'https://www.finvibe.blog/blogs/report', published_at:'2026-11-11T11:00:00Z', image:{url:'https://images.pexels.com/photos/1/a.jpeg',alt:'Market'}, ai_assisted:true, ...extra});
test('one upstream request for concurrent clients, ETag revalidation and original dates retained', async () => {
  let calls=0, clock=now;
  const service=createNewsService({now:()=>clock, request:async (url,options)=>{
    calls++;assert.equal(url,'https://www.finvibe.blog/api/v1/feed?per_page=12');
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');
    if(calls===2){assert.equal(options.headers['If-None-Match'],'"v1"');return new Response(null,{status:304});}
    return Response.json({data:[story()]},{headers:{etag:'"v1"'}});
  }});
  const [first,second]=await Promise.all([service.load(),service.load()]);assert.deepEqual(first,second);assert.equal(calls,1);
  assert.equal(first.items[0].publishedAt,'2026-11-11T11:00:00.000Z');assert.equal(first.items[0].aiAssisted,true);
  clock+=61000;assert.deepEqual(await service.load(),first);assert.equal(calls,2);
});
test('reject unsafe URLs, future dates, duplicates; do not fabricate missing covers',async()=>{
  const service=createNewsService({now:()=>now,request:async()=>Response.json({data:[story(),story(),story({url:'javascript:alert(1)'}),story({url:'https://evil.test/x'}),story({url:'https://www.finvibe.blog/blogs/future',published_at:'2027-01-01'}),story({url:'https://www.finvibe.blog/blogs/no-cover',image:null}),story({url:'https://www.finvibe.blog/blogs/unsafe-cover',image:{url:'http://127.0.0.1/key'}})]})});
  const {items}=await service.load();assert.equal(items.length,3);assert.equal(items[1].image,null);assert.equal(items[2].image,null);
});
test('provider failure does not serve stale articles as freshly loaded data and can recover',async()=>{
  let clock=now,fail=false;
  const service=createNewsService({now:()=>clock,request:async()=>fail?new Response('secret provider error',{status:429}):Response.json({data:[story()]})});
  await service.load();clock+=61000;fail=true;await assert.rejects(service.load(),/News provider HTTP 429/);
  fail=false;assert.equal((await service.load()).items.length,1);
});

test('upstream redirect is rejected without following it',async()=>{
 let calls=0;const service=createNewsService({request:async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}})}});
 await assert.rejects(service.load(),/News provider HTTP 302/);assert.equal(calls,1);
});
