import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
export async function runMigrations(db,directory){
 const entries=(await readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
 const client=await db.connect();
 try{
  await client.query("SELECT pg_advisory_lock($1)",[871204]);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for(const name of entries){
   const existing=await client.query("SELECT filename FROM schema_migrations WHERE filename=$1",[name]);
   if(existing.rows.length)continue;
   const sql=await readFile(join(directory,name),"utf8");
   // Migration files are versioned trusted code, never user input.
   await client.query(sql);
   await client.query("INSERT INTO schema_migrations(filename) VALUES($1)",[name]);
  }
 }finally{
  try{await client.query("SELECT pg_advisory_unlock($1)",[871204]);}finally{client.release();}
 }
}
