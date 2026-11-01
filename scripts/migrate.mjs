import {Pool} from "pg";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {runMigrations} from "../src/migrations.mjs";
const connectionString=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!connectionString)throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED required");
const db=new Pool({connectionString});
try{
 await runMigrations(db,resolve(dirname(fileURLToPath(import.meta.url)),"../db"));
 console.log("Migrations completed");
}finally{await db.end();}
