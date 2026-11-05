import {Pool} from "pg";
import {createApi} from "./http-api.mjs";
import {createSessionResolver} from "./auth.mjs";
import {settleDueFunds} from "./fund-maturities.mjs";
import {resolveOrderExecutionPrice,stockQuotesConfigured} from "./us-stock-quotes.mjs";

if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==="require"?{rejectUnauthorized:true}:undefined});
const resolveSession=createSessionResolver(db);
// Internal-only order ledger: no broker or exchange is ever contacted (see
// order-service.mjs/ledger.mjs). Price comes from the same free, read-only
// Finnhub feed already used for simulated buy/sell. Without a configured
// FINNHUB_API_KEY, resolveExecutionPrice stays undefined and the endpoint
// fails closed, same as before.
const resolveExecutionPrice=stockQuotesConfigured()?resolveOrderExecutionPrice:undefined;
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
