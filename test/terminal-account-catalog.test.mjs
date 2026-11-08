import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root = new URL('../',import.meta.url);

async function createTerminal(name){
  const html=await readFile(new URL('web/'+name+'.html',root),'utf8');
  const dom=new JSDOM(html,{url:'https://ui.example.test/'+name+'.html',runScripts:'outside-only',pretendToBeVisual:true});
  const inline=html.match(/<script>\s*\(function\(\)\{[\s\S]*?<\/script>/);
  assert.ok(inline,'expected terminal inline script: '+name);
  dom.window.eval(inline[0].replace(/^<script>/,'').replace(/<\/script>$/,''));
  return dom;
}

const snapshot={
  account:{id:'verified-00000001',cashCents:125000,currency:'USD'},
  positions:[{market:'US',symbol:'ABC',quantity:'2'}, {market:'CN',symbol:'ABC',quantity:'3'}],
  orders:[{market:'US',symbol:'ABC',side:'BUY',quantity:'2',price_cents:'1000',amount_usd_cents:'2000',
    created_at:'2026-11-01T02:00:00Z'},
    {market:'CN',symbol:'ABC',side:'SELL',quantity:'1',price_cents:'1300',amount_usd_cents:'1300',
    created_at:'2026-11-02T03:00:00Z'}]
};

for(const name of ['desktop','cn-terminal']){
  test(name+' renders server-only account and market-qualified instruments, and saves published catalog items',async()=>{
    const dom=await createTerminal(name),win=dom.window,document=win.document;
    try{
      assert.equal(typeof win.CN_SYNC_ACCOUNT,'function');
      assert.equal(typeof win.CN_SYNC_WATCHLIST,'function');
      assert.equal(typeof win.CN_SYNC_CATALOG,'function');
      win.CN_SYNC_ACCOUNT(snapshot);
      const holdings=document.getElementById('tb-hold').textContent;
      assert.match(holdings,/US:ABC/);
      assert.match(holdings,/CN:ABC/);
      assert.match(holdings,/2/);
      assert.match(holdings,/3/);
      const orders=document.getElementById('tb-ord').textContent;
      assert.match(orders,/US:ABC/);
      assert.match(orders,/CN:ABC/);
      assert.match(document.querySelector('[data-b="cash"]').textContent,/1,250\.00/);
      assert.equal(document.querySelectorAll('#tb-req tr').length,0);
      assert.doesNotMatch(document.querySelector('[data-b="total"]').textContent,/1,250\.00/);

      win.CN_SYNC_CATALOG([
        {market:'US',symbol:'ABC',itemType:'STOCK',name:'US name'},
        {market:'CN',symbol:'ABC',itemType:'STOCK',name:'CN name'},
        {market:'CN',symbol:'600519',itemType:'STOCK',name:'<img src=x onerror=alert(1)>'}
      ]);
      assert.equal(document.querySelectorAll('#pbody button[data-save-instrument]').length,3);
      assert.equal(document.querySelectorAll('#pbody button[data-save-instrument]:not([disabled])').length,0);
      assert.equal(document.querySelector('#pbody img'),null);
      win.CN_SYNC_WATCHLIST([]);
      assert.equal(document.querySelectorAll('#pbody button[data-save-instrument]:not([disabled])').length,3);
      const calls=[];
      win.CN_TOGGLE_WATCHLIST=async key=>{
        calls.push(key);
        win.CN_SYNC_WATCHLIST([{market:'CN',symbol:'600519'}]);
        return true;
      };
      const save=document.querySelector('#pbody button[data-save-instrument="CN:600519"]');
      assert.ok(save);
      save.click();
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(calls,['CN:600519']);
      assert.match(document.getElementById('tb-watch').textContent,/CN:600519/);
      assert.equal(document.querySelector('#pbody button[data-save-instrument="CN:600519"]').textContent.includes('已自选'),true);
      win.CN_DATA_STATUS('watchlist','暂不可用');
      assert.equal(document.querySelector('#pbody button[data-save-instrument="CN:600519"]').disabled,true);
    }finally{dom.window.close();}
  });
}
