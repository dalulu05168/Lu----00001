import {Pool} from "pg";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {runMigrations} from "../src/migrations.mjs";
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
const db=new Pool({connectionString:process.env.DATABASE_URL});
try{
 await runMigrations(db,resolve(dirname(fileURLToPath(import.meta.url)),"../db"));
 console.log("Migrations completed");
}finally{await db.end();}
