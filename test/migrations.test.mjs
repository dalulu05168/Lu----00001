import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/migrations.mjs";

async function withMigrations(fn) {
  const directory=await mkdtemp(join(tmpdir(),"gsp-migrate-"));
  try {
    await writeFile(join(directory,"001_init.sql"),"BEGIN;\nCREATE TABLE accounts(id bigint);\nCOMMIT;\n");
    await writeFile(join(directory,"002_sessions.sql"),"BEGIN;\nCREATE TABLE sessions(id bigint);\nCOMMIT;\n");
    await fn(directory);
  } finally {await rm(directory,{recursive:true,force:true});}
}
test("commits schema and applied marker inside one transaction per migration",async()=>withMigrations(async directory=>{
  const sql=[];
  let released=false;
  const db={connect:async()=>({
    query:async(text,params)=>{sql.push({text,params});return {rows:[]};},
    release:()=>{released=true;}
  })};
  await runMigrations(db,directory);
  assert.equal(sql.filter(q=>q.text==="BEGIN").length,2);
  assert.equal(sql.filter(q=>q.text==="COMMIT").length,2);
  for(let i=0;i<sql.length;i++){
    if(sql[i].text.startsWith("INSERT INTO schema_migrations")){
      assert.equal(sql[i+1].text,"COMMIT");
      assert.equal(sql[i-2].text,"BEGIN");
      assert.match(sql[i-1].text,/CREATE TABLE/);
    }
  }
  assert.equal(sql.at(-1).text,"SELECT pg_advisory_unlock($1)");
  assert.equal(released,true);
}));
test("failed migration rolls back and does not insert history marker",async()=>withMigrations(async directory=>{
  const sql=[];
  let released=false;
  const db={connect:async()=>({
    query:async(text)=>{sql.push(text);if(text.includes("CREATE TABLE sessions"))throw Error("DDL rejected");return {rows:[]};},
    release:()=>{released=true;}
  })};
  await assert.rejects(runMigrations(db,directory),/DDL rejected/);
  assert.equal(sql.filter(x=>x.startsWith("INSERT INTO schema_migrations")).length,1);
  assert.equal(sql.filter(x=>x==="ROLLBACK").length,1);
  assert.equal(sql.filter(x=>x==="COMMIT").length,1);
  assert.equal(sql.at(-1),"SELECT pg_advisory_unlock($1)");
  assert.equal(released,true);
}));
test("skips migrations already in schema_migrations",async()=>withMigrations(async directory=>{
  const sql=[];
  const db={connect:async()=>({
    query:async(text,params)=>{sql.push(text);return {rows:text.startsWith("SELECT filename FROM schema_migrations")&&params[0]==="001_init.sql"?[{filename:params[0]}]:[]};},
    release:()=>{}
  })};
  await runMigrations(db,directory);
  assert.equal(sql.filter(x=>x==="BEGIN").length,1);
  assert.equal(sql.filter(x=>x.startsWith("INSERT INTO schema_migrations")).length,1);
}));
