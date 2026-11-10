const CN_PRODUCT_MAX = BigInt(Number.MAX_SAFE_INTEGER);
function cnProductFail(message, statusCode = 400) {
  throw Object.assign(new Error(message), {statusCode});
}
function cnProductInteger(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) cnProductFail('Invalid ' + name);
  return value;
}
function cnProductId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) cnProductFail('Invalid product id');
  return value;
}
function cnProductMoney(value) {
  const amount = BigInt(value);
  if (amount < 0n || amount > CN_PRODUCT_MAX) cnProductFail('Amount overflow');
  return Number(amount);
}
async function cnProductTransaction(db, work) {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    await tx.release();
  }
}
function cnProductPublic(row) {
  return {
    id:row.id, kind:row.kind, name:row.name, status:row.status, version:row.version,
    imageUrl:row.image_data ? '/api/product-image?id=' + row.id : null,
    market:row.market, symbol:row.symbol, discountBps:row.discount_bps,
    holdingDays:row.holding_days, minQuantity:row.min_quantity,
    requiresPassword:Boolean(row.trade_password_hash),
    referencePriceCents:row.reference_price_cents == null ? null : Number(row.reference_price_cents),
    referenceTimestamp:row.reference_timestamp, instrument:row.instrument_info,
    createdAt:row.created_at, updatedAt:row.updated_at
  };
}
async function cnProductList(db, admin = false) {
  const products = (await db.query("SELECT * FROM cn_products WHERE ($1 OR status='PUBLISHED') ORDER BY created_at DESC,id LIMIT 100", [admin])).rows;
  const tiers = (await db.query("SELECT t.* FROM cn_fund_tiers t JOIN cn_products p ON p.id=t.product_id WHERE t.active AND ($1 OR p.status='PUBLISHED') ORDER BY t.principal_cents,t.holding_days", [admin])).rows;
  return products.map(row => ({
    ...cnProductPublic(row),
    tiers:tiers.filter(t => t.product_id === row.id).map(t => ({
      id:t.id, principalCents:Number(t.principal_cents), holdingDays:t.holding_days, profitBps:t.profit_bps
    }))
  }));
}
function cnProductImage(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') cnProductFail('Invalid fund image');
  const match = /^data:image\/(png|jpeg);base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || match[2].length > 2796204) cnProductFail('Invalid fund image');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) cnProductFail('Invalid fund image');
  return value;
}
async function cnProductSave(db, actor, body, resolveQuote) {
  if (actor.role !== 'MASTER') cnProductFail('Master permission required',403);
  if (!body || typeof body !== 'object' || Array.isArray(body)) cnProductFail('Invalid product');
  const previous = body.id ? (await db.query('SELECT * FROM cn_products WHERE id=$1',[cnProductId(body.id)])).rows[0] : null;
  if (body.id && !previous) cnProductFail('Product not found',404);
  const kind = body.kind || previous?.kind;
  if (!['TERM_FUND','BULK_STOCK'].includes(kind) || previous && kind !== previous.kind) cnProductFail('Invalid product kind');
  const status = body.status || previous?.status || 'DRAFT';
  if (!['DRAFT','PUBLISHED','ARCHIVED'].includes(status)) cnProductFail('Invalid product status');
  const name = String(body.name ?? previous?.name ?? '').trim();
  if (!name || name.length > 120) cnProductFail('Invalid product name');
  const image = body.image === undefined ? previous?.image_data || null : cnProductImage(body.image);
  let tiers = [], market = null, symbol = null, discount = 0, days = 0, minimum = 1, passwordHash = null, scheme = 'commodity', quote = null;
  if (kind === 'TERM_FUND') {
    if (!Array.isArray(body.tiers) || body.tiers.length < 1 || body.tiers.length > 50) cnProductFail('At least one fund tier required');
    tiers = body.tiers.map(t => ({
      principal:cnProductInteger(t.principalCents,1,Number.MAX_SAFE_INTEGER,'tier amount'),
      days:cnProductInteger(t.holdingDays,1,36500,'holding days'),
      profit:cnProductInteger(t.profitBps,0,10000,'profit ratio')
    }));
    for (const t of tiers) cnProductMoney(BigInt(t.principal) + (BigInt(t.principal) * BigInt(t.profit) + 5000n) / 10000n);
    if (new Set(tiers.map(t => t.principal + ':' + t.days)).size !== tiers.length) cnProductFail('Duplicate fund tiers');
  } else {
    market = body.market ?? previous?.market ?? 'US';
    symbol = String(body.symbol ?? previous?.symbol ?? '').trim().toUpperCase();
    if (!['US','HK','CN','MY'].includes(market) || !/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(symbol)) cnProductFail('Invalid instrument');
    discount = cnProductInteger(body.discountBps ?? previous?.discount_bps ?? 0,0,9999,'discount ratio');
    days = cnProductInteger(body.holdingDays ?? previous?.holding_days ?? 0,0,36500,'holding days');
    minimum = cnProductInteger(body.minQuantity ?? previous?.min_quantity ?? 1,1,1000000000,'minimum quantity');
    if (body.tradePassword !== undefined && body.tradePassword !== '') {
      if (typeof body.tradePassword !== 'string' || !/^\d{6}$/.test(body.tradePassword)) cnProductFail('Trading password must be six digits');
      passwordHash = await hashPassword('commodity:' + body.tradePassword);
    } else {
      passwordHash = previous?.trade_password_hash || null;
      scheme = previous?.password_scheme || 'commodity';
    }
    if (status === 'PUBLISHED') {
      if (!passwordHash) cnProductFail('Trading password required');
      if (typeof resolveQuote !== 'function') cnProductFail('Reference quote unavailable',503);
      quote = await resolveQuote({symbol,market});
      if (!quote || quote.symbol !== symbol || quote.market !== market || !Number.isSafeInteger(quote.priceCents) || quote.priceCents <= 0 || !Number.isFinite(quote.timestampMs) || quote.timestampMs>Date.now()+5000 || Date.now()-quote.timestampMs>5*86400000) cnProductFail('Reference quote unavailable',503);
    }
  }
  const id = previous?.id || randomUUID();
  return cnProductTransaction(db, async tx => {
    if (previous) {
      const locked = (await tx.query('SELECT version FROM cn_products WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!locked || locked.version !== body.version) cnProductFail('Product changed; reload and retry',409);
    }
    const saved = await tx.query(
      "INSERT INTO cn_products(id,kind,name,status,image_data,market,symbol,discount_bps,holding_days,min_quantity,trade_password_hash,password_scheme,created_by,reference_price_cents,reference_timestamp,instrument_info) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,image_data=EXCLUDED.image_data,market=EXCLUDED.market,symbol=EXCLUDED.symbol,discount_bps=EXCLUDED.discount_bps,holding_days=EXCLUDED.holding_days,min_quantity=EXCLUDED.min_quantity,trade_password_hash=EXCLUDED.trade_password_hash,password_scheme=EXCLUDED.password_scheme,reference_price_cents=COALESCE(EXCLUDED.reference_price_cents,cn_products.reference_price_cents),reference_timestamp=COALESCE(EXCLUDED.reference_timestamp,cn_products.reference_timestamp),instrument_info=COALESCE(EXCLUDED.instrument_info,cn_products.instrument_info),version=cn_products.version+1,updated_at=now() RETURNING *",
      [id,kind,name,status,image,market,symbol,discount,days,minimum,passwordHash,scheme,actor.userId,quote?.priceCents??null,quote?new Date(quote.timestampMs).toISOString():null,quote?JSON.stringify(quote):null]
    );
    if (kind === 'TERM_FUND') {
      await tx.query('UPDATE cn_fund_tiers SET active=false WHERE product_id=$1 AND active',[id]);
      for (const tier of tiers) await tx.query('INSERT INTO cn_fund_tiers(id,product_id,principal_cents,holding_days,profit_bps) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,tier.principal,tier.days,tier.profit]);
    }
    await tx.query("INSERT INTO admin_audit_log(admin_user_id,role,action,target,detail) VALUES($1,'MASTER','product.save',$2,$3::jsonb)",[actor.userId,id,JSON.stringify({kind,status,version:saved.rows[0].version})]);
    return cnProductPublic(saved.rows[0]);
  });
}
async function cnFundSubscribe(db, session, body, key) {
  cnProductId(body?.tierId);
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) cnProductFail('Idempotency key required');
  return cnProductTransaction(db, async tx => {
    const account = (await tx.query('SELECT cash_cents FROM accounts WHERE id=$1 FOR UPDATE',[session.accountId])).rows[0];
    if (!account) cnProductFail('Account not found',404);
    const prior = (await tx.query('SELECT * FROM cn_fund_contracts WHERE account_id=$1 AND idempotency_key=$2',[session.accountId,key])).rows[0];
    if (prior) {
      if (prior.tier_id !== body.tierId) cnProductFail('Idempotency key already used',409);
      return {replayed:true,contract:prior};
    }
    const tier = (await tx.query("SELECT t.*,p.name FROM cn_fund_tiers t JOIN cn_products p ON p.id=t.product_id WHERE t.id=$1 AND t.active AND p.status='PUBLISHED' AND p.kind='TERM_FUND' FOR SHARE OF t,p",[body.tierId])).rows[0];
    if (!tier) cnProductFail('Fund tier unavailable',409);
    const principal = BigInt(tier.principal_cents), profit = (principal * BigInt(tier.profit_bps) + 5000n) / 10000n;
    const cash = BigInt(account.cash_cents);
    if (cash < principal) cnProductFail('Insufficient available balance',409);
    cnProductMoney(principal + profit);
    const balance = cnProductMoney(cash-principal), id = randomUUID();
    await tx.query('UPDATE accounts SET cash_cents=$2 WHERE id=$1',[session.accountId,balance]);
    const debit = (await tx.query('INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,$2,$3) RETURNING id',[session.accountId,-Number(principal),balance])).rows[0];
    const contract = (await tx.query("INSERT INTO cn_fund_contracts(id,account_id,product_id,tier_id,idempotency_key,product_name,principal_cents,profit_cents,profit_bps,holding_days,due_at,debit_ledger_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+$10::int*interval '24 hours',$11) RETURNING *",[id,session.accountId,tier.product_id,tier.id,key,tier.name,Number(principal),Number(profit),tier.profit_bps,tier.holding_days,debit.id])).rows[0];
    return {replayed:false,contract,cashCents:balance};
  });
}
async function cnSettleFundContract(db, id) {
  const candidate = (await db.query('SELECT account_id FROM cn_fund_contracts WHERE id=$1',[id])).rows[0];
  if (!candidate) return false;
  return cnProductTransaction(db, async tx => {
    const account = (await tx.query('SELECT cash_cents FROM accounts WHERE id=$1 FOR UPDATE',[candidate.account_id])).rows[0];
    const row = (await tx.query("SELECT * FROM cn_fund_contracts WHERE id=$1 AND status='ACTIVE' AND due_at<=now() FOR UPDATE",[id])).rows[0];
    if (!row) return false;
    const total = BigInt(row.principal_cents)+BigInt(row.profit_cents);
    const balance = cnProductMoney(BigInt(account.cash_cents)+total);
    await tx.query('UPDATE accounts SET cash_cents=$2 WHERE id=$1',[row.account_id,balance]);
    const ledger = (await tx.query('INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,$2,$3) RETURNING id',[row.account_id,Number(total),balance])).rows[0];
    await tx.query("UPDATE cn_fund_contracts SET status='MATURED',matured_at=now(),return_ledger_id=$2 WHERE id=$1",[id,ledger.id]);
    await tx.query("INSERT INTO admin_audit_log(role,action,target,detail) VALUES('SYSTEM','fund.mature',$1,$2::jsonb)",[id,JSON.stringify({principalCents:Number(row.principal_cents),profitCents:Number(row.profit_cents),ledgerId:String(ledger.id)})]);
    return true;
  });
}
async function cnSettleDueFunds(db, accountId = null) {
  const due = (await db.query("SELECT id FROM cn_fund_contracts WHERE status='ACTIVE' AND due_at<=now() AND ($1::uuid IS NULL OR account_id=$1) ORDER BY due_at,id LIMIT 100",[accountId])).rows;
  let settled=0;
  for (const row of due) if (await cnSettleFundContract(db,row.id)) settled++;
  return {settled};
}
async function cnProductCustomer(db, session, write=true) {
  if (!session?.accountId || (await db.query('SELECT 1 FROM admin_roles WHERE user_id=$1',[session.userId])).rows.length) cnProductFail('Customer account required',403);
  if (write && (await db.query("SELECT 1 FROM cn_client_controls WHERE user_id=$1 AND account_type='READ_ONLY'",[session.userId])).rows.length) cnProductFail('Read-only account',403);
}
async function cnProductsRoute(req, res, route, db, session, actor, resolveQuote) {
  try {
    const query = new URL(req.url,'https://localhost').searchParams;
    if (route === '/api/product-image') {
      const row = (await db.query("SELECT image_data FROM cn_products WHERE id=$1 AND status IN ('PUBLISHED','ARCHIVED')",[cnProductId(query.get('id'))])).rows[0];
      if (!row?.image_data) return send(res,404,{error:'Image not found'});
      const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(row.image_data);
      res.writeHead(200,{'content-type':match[1],'cache-control':'public,max-age=300','x-content-type-options':'nosniff'});
      res.end(Buffer.from(match[2],'base64')); return;
    }
    if (actor) {
      if (actor.role !== 'MASTER') cnProductFail('Master permission required',403);
      if (req.method === 'GET') {
        if (query.has('identify')) {
          if (!resolveQuote) cnProductFail('Reference quote unavailable',503);
          const symbol=String(query.get('identify')).trim().toUpperCase(),market=query.get('market')||'US';
          if (!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(symbol)||!['US','HK','CN','MY'].includes(market)) cnProductFail('Invalid instrument');
          return send(res,200,await resolveQuote({symbol,market}));
        }
        if (query.has('id')) {
          const row=(await db.query('SELECT * FROM cn_products WHERE id=$1',[cnProductId(query.get('id'))])).rows[0];
          if (!row) cnProductFail('Product not found',404);
          return send(res,200,{...cnProductPublic(row),image:row.image_data});
        }
        return send(res,200,{items:await cnProductList(db,true)});
      }
      if (!['POST','PATCH'].includes(req.method)) return send(res,405,{error:'Method not allowed'});
      const body=JSON.parse(await readBody(req,4*1024*1024));
      return send(res,req.method==='POST'?201:200,await cnProductSave(db,actor,body,resolveQuote));
    }
    await cnProductCustomer(db,session,req.method!=='GET');
    if (route==='/api/products' && req.method==='GET') {
      await cnSettleDueFunds(db,session.accountId);
      const contracts=(await db.query('SELECT * FROM cn_fund_contracts WHERE account_id=$1 ORDER BY subscribed_at DESC,id LIMIT 200',[session.accountId])).rows;
      return send(res,200,{items:await cnProductList(db),contracts});
    }
    if (route==='/api/products/quote' && req.method==='GET') {
      const row=(await db.query("SELECT market,symbol FROM cn_products WHERE id=$1 AND kind='BULK_STOCK' AND status='PUBLISHED'",[cnProductId(query.get('id'))])).rows[0];
      if (!row || !resolveQuote) cnProductFail('Reference quote unavailable',503);
      return send(res,200,await resolveQuote(row));
    }
    if (route==='/api/fund-subscriptions' && req.method==='POST') {
      const body=JSON.parse(await readBody(req,8192));
      const result=await cnFundSubscribe(db,session,body,req.headers['idempotency-key']);
      return send(res,result.replayed?200:201,result);
    }
    if (route==='/api/bulk-orders' && req.method==='POST') {
      const body=JSON.parse(await readBody(req,8192));
      const item=(await db.query("SELECT * FROM cn_products WHERE id=$1 AND kind='BULK_STOCK' AND status='PUBLISHED'",[cnProductId(body?.productId)])).rows[0];
      if (!item) cnProductFail('Product unavailable',409);
      const side=body.side||'BUY';if(!['BUY','SELL'].includes(side))cnProductFail('Invalid order side');
      cnProductInteger(body.quantity,side==='BUY'?item.min_quantity:1,1000000000,'quantity');
      if (typeof body.tradePassword!=='string'||!/^\d{6}$/.test(body.tradePassword)||!await verifyPassword(item.password_scheme+':'+body.tradePassword,item.trade_password_hash)) cnProductFail('Invalid trading password',403);
      if (!resolveQuote) cnProductFail('Reference quote unavailable',503);
      const quote=await resolveQuote({symbol:item.symbol,market:item.market});
      if (!quote || quote.symbol!==item.symbol || quote.market!==item.market || !Number.isSafeInteger(quote.priceCents) || quote.priceCents<=0 || !Number.isFinite(quote.timestampMs) || quote.timestampMs>Date.now()+5000 || Date.now()-quote.timestampMs>5*86400000) cnProductFail('Reference quote unavailable',503);
      const price=side==='BUY'?Number((BigInt(quote.priceCents)*BigInt(10000-item.discount_bps)+5000n)/10000n):quote.priceCents;
      if (body.expectedVersion!==item.version || body.expectedPriceCents!==price) cnProductFail('Price changed; confirm again',409);
      if (price<=0) cnProductFail('Invalid discounted price');
      const result=await placeInternalOrder(db,session.accountId,req.headers['idempotency-key'],{market:item.market,symbol:item.symbol,side,quantity:body.quantity,priceCents:price,fxUsdMicros:1000000,bulkTerms:side==='SELL'?undefined:{id:item.id,version:item.version,minimum:item.min_quantity,holdingDays:item.holding_days,discountBps:item.discount_bps,referencePrice:quote.priceCents,referenceTimestamp:new Date(quote.timestampMs).toISOString()}},randomUUID());
      return send(res,result.replayed?200:201,result);
    }
    return send(res,405,{error:'Method not allowed'});
  } catch (error) {
    if(!error.statusCode&&/Insufficient|quantity|idempotency/i.test(error.message))error.statusCode=409;
    return send(res,error.statusCode || (error instanceof SyntaxError?400:503),{error:error.statusCode?error.message:error instanceof SyntaxError?'Invalid JSON':'Product service unavailable'});
  }
}
