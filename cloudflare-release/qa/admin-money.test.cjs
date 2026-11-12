const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['admin.html','admin-next.js']) {
  test(file + ' formats exact cents across the number and string contract', () => {
    const source = fs.readFileSync(path.join(__dirname,'../web',file),'utf8');
    const start = source.indexOf('function formatAdminCents(');
    assert(start >= 0);
    const end = source.indexOf('\n}',start) + 2;
    const format = vm.runInNewContext(source.slice(start,end) + '\nformatAdminCents');
    assert.equal(format('9007199254740993','en-US','USD'),'$90,071,992,547,409.93');
    assert.equal(format('9007199254740994','en-US'),'90,071,992,547,409.94');
    assert.equal(format('-1','en-US','USD'),'-$0.01');
    assert.equal(format(2,'en-US'),'0.02');
    assert.equal(format(Number.MAX_SAFE_INTEGER+1,'en-US'),'—');
  });
}
