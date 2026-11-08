import {executeLicensedInternalOrder} from "./internal-equity-execution.mjs";

/**
 * Minimal integration entrypoint for the EXISTING POST /api/orders handler.
 * The shared src/http-api.mjs owner must inject a session validated by the
 * existing authentication middleware. This module never reads client-supplied
 * account IDs or accepts executable prices from browser JSON.
 *
 * Integration: after resolving the session and JSON request body, call
 * postVerifiedInternalOrder({db,session,idempotencyKey,body,marketData,
 *   fxData,authorizeUsage,authorizeFxUsage,authorizeTradingSession,
 *   tradingEnabled:approvedServerTradingFlag})
 * and send(response.status,response.body). Do not replace other routes,
 * admin authentication, products, deposits, or customer functions.
 *
 * NO HTTP routes are registered here; no broker transports are imported.
 */
const allowedFields=new Set(["side","market","symbol","quantity"]);
const statusError=(error,statusCode)=>Object.assign(new Error(error),{statusCode});

export async function postVerifiedInternalOrder({
  db,session,idempotencyKey,body,marketData,fxData,authorizeUsage,
  authorizeFxUsage,authorizeTradingSession,tradingEnabled=false,
  now,createId,execute=executeLicensedInternalOrder
}={}) {
  if(session?.adminVerified===true)
    throw statusError("Use the administrator console",403);
  if(!session || typeof session.accountId!=="string" ||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.accountId))
    throw statusError("Authentication required",401);
  if(typeof idempotencyKey!=="string" ||
     idempotencyKey.length<8 || idempotencyKey.length>128)
    throw statusError("Invalid idempotency key",400);
  if(!body || typeof body!=="object" || Array.isArray(body) ||
     Object.keys(body).some(key=>!allowedFields.has(key)))
    throw statusError("Invalid order fields",400);
  if(typeof execute!=="function")throw new TypeError("Missing order execution service");
  const options={
    db,accountId:session.accountId,key:idempotencyKey,request:body,
    marketData,fxData,authorizeUsage,authorizeFxUsage,
    authorizeTradingSession,tradingEnabled
  };
  if(now!==undefined)options.now=now;
  if(createId!==undefined)options.createId=createId;
  const result=await execute(options);
  if(!result || typeof result.replayed!=="boolean" ||
     typeof result.order?.id!=="string" ||
     result.order.id.length===0 ||
     result.order.side!==body.side ||
     result.order.market!==body.market ||
     result.order.symbol!==body.symbol ||
     result.order.quantity!==body.quantity ||
     result.order.execution!=="INTERNAL_ONLY" ||
     !Number.isSafeInteger(result.order.amountCents) ||
     result.order.amountCents<1 ||
     !Number.isSafeInteger(result.order.priceCents) ||
     result.order.priceCents<1 ||
     !Number.isSafeInteger(result.order.fxUsdMicros) ||
     result.order.fxUsdMicros<1 ||
     !result.receipt || result.receipt.id!==result.order.id ||
     result.receipt.amountUsdCents!==result.order.amountCents)
    throw statusError("Internal order readback unavailable",503);
  return {status:result.replayed?200:201,body:result};
}
