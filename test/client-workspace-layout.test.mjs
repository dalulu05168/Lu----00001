import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("client list and individual customer workspace are sibling views, not nested cards",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const css=await readFile(new URL("../web/admin.css",import.meta.url),"utf8");
 const dom=new JSDOM(html);
 const doc=dom.window.document;
 const section=doc.querySelector('[data-pane="clients"]');
 const directory=doc.getElementById("clientListView");
 const workspace=doc.getElementById("clientDetail");
 assert.equal(directory.parentElement,section);
 assert.equal(workspace.parentElement,section);
 assert.equal(directory.contains(workspace),false);
 assert.equal(workspace.hidden,true);
 assert.ok(directory.querySelector("#clients"));
 assert.ok(directory.querySelector("#clientDirectorySearch"));
 assert.ok(workspace.querySelector("#clientDetailHeadline"));
 assert.ok(workspace.querySelector("#clientDetailMirror"));
 assert.ok(workspace.querySelector("#closeClientDetail"));
 for(const [tab,panel,contents] of [
  ["overview","clientOverviewPanel","#clientDetailFields"],
  ["policy","clientPolicyTabPanel","#clientPolicyArea"],
  ["requests","clientRequestsTabPanel","#clientWorkflowPanel"]
 ]){
  const button=workspace.querySelector('[data-client-tab="'+tab+'"]');
  const target=workspace.querySelector('#'+panel);
  assert.ok(button,"Missing tab "+tab);
  assert.equal(button.getAttribute("aria-controls"),panel);
  assert.ok(target.querySelector(contents),"Missing content for "+tab);
 }
 assert.match(css,/\.client-directory-row\{display:grid/);
 assert.match(css,/\.client-workspace\{margin:0;padding:0;border:0/);
 assert.match(css,/@media\(max-width:720px\)/);
 dom.window.close();
});
