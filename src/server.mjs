import {Pool} from "pg";
import {createApi} from "./http-api.mjs";
import {createSessionResolver} from "./auth.mjs";
import {createReadOnlyPricingGateway} from "./market-data.mjs";

if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==="require"?{rejectUnauthorized:true}:undefined});
const resolveSession=createSessionResolver(db);
// A licensed provider adapter is mandatory for internal order execution.
// No dummy provider is supplied and no live brokerage order API exists.
const resolveExecutionPrice=undefined;
const api=createApi({db,resolveSession,resolveExecutionPrice});
const port=Number(process.env.PORT??3001);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid PORT");
api.listen(port,"127.0.0.1",()=>console.log("Development API listening on localhost:"+port));
async function shutdown(){api.close();await db.end();}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
