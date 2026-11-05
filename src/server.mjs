import {Pool} from "pg";
import {createApi} from "./http-api.mjs";
import {createSessionResolver} from "./auth.mjs";
import {settleDueFunds} from "./fund-maturities.mjs";

if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==="require"?{rejectUnauthorized:true}:undefined});
const resolveSession=createSessionResolver(db);
// A licensed provider adapter is mandatory for internal order execution.
// No dummy provider is supplied and no live brokerage order API exists.
const resolveExecutionPrice=undefined;
const api=createApi({db,resolveSession,resolveExecutionPrice});
const port=Number(process.env.PORT??3001);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid PORT");
api.listen(port,"0.0.0.0",()=>console.log("API listening on port "+port));
let shuttingDown=false;
let settlementRun;
function runSettlement(){
 if(shuttingDown||settlementRun)return;
 settlementRun=settleDueFunds(db).then(({failed})=>{
  if(failed)console.error("Fund settlements pending retry:",failed);
 }).catch(()=>console.error("Fund settlement batch unavailable")).finally(()=>{settlementRun=null;});
}
const settlementTimer=setInterval(runSettlement,60000);
settlementTimer.unref();
runSettlement();
async function shutdown(){if(shuttingDown)return;shuttingDown=true;clearInterval(settlementTimer);await new Promise(resolve=>api.close(resolve));await settlementRun;await db.end();}
process.on("SIGINT",()=>{void shutdown();});process.on("SIGTERM",()=>{void shutdown();});
