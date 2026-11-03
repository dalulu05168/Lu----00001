import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const admin = readFileSync(new URL("../web/admin.css",import.meta.url),"utf8");
const frontend = readFileSync(new URL("../web/styles.css",import.meta.url),"utf8");

test("administrator and client terminals use the same graphite palette",()=>{
  for(const swatch of ["#17191c","#1e2023","#363a3f","#20c88b"]){
    assert.ok(admin.includes(swatch),"admin missing "+swatch);
    assert.ok(frontend.includes(swatch),"client missing "+swatch);
  }
  for(const formerBlue of ["#0a1221","#111d31","#283750","#255aa0","#213c60","#56a7e7"]){
    assert.equal(admin.includes(formerBlue),false,"former blue color remains "+formerBlue);
  }
});

test("admin primary buttons remain readable in graphite theme",()=>{
  assert.match(admin,/\.field-grid button,button\.primary\{[^}]*background:#eceeef[^}]*color:#17191c\}/);
  assert.match(admin,/#adminPages button\[aria-current="page"\]\{[^}]*background:#2d3136/);
});

test("admin and client retain the no-bold typography and clear vector rendering requirement",()=>{
  assert.match(admin,/font-weight:400!important/);
  assert.doesNotMatch(admin,/font-weight:\s*(500|600|700|800|900)/);
  assert.match(frontend,/font-weight:\s*400\s*!important/);
  assert.match(frontend,/shape-rendering:\s*geometricPrecision/);
});
