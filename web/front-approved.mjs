"use strict";

window.ApprovedFront = (() => {
  const token = sessionStorage.getItem("gsp_token");
  const login = () => location.replace("/");
  if (!token) login();

  async function request(path, method = "GET", body) {
    if (!token) throw Error("Session required");
    const headers = { authorization: "Bearer " + token };
    if (body) headers["content-type"] = "application/json";
    const response = await fetch("/api" + path, {
      method, headers, cache: "no-store", body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 401) {
      sessionStorage.removeItem("gsp_token");
      login();
    }
    if (!response.ok) throw Error("Request failed");
    return response.status === 204 ? undefined : response.json();
  }

  function time(value) {
    const date = new Date(value);
    return Number.isFinite(+date)
      ? new Date(+date + 28800000).toISOString().slice(0, 16).replace("T", " ")
      : "—";
  }

  async function messages() {
    const { thread, messages: rows = [] } = await request("/support");
    return rows.map(row => ({
      me: row.senderUserId === thread?.clientId,
      t: row.body, d: time(row.createdAt)
    }));
  }

  const categories = ["FUNDING", "KYC", "BANK_LINK"];
  const types = { STOCK: "股票", FUND: "基金", IPO: "IPO", COMMODITY: "大宗商品" };
  const dollars = cents => Number(cents ?? 0) / 100;
  let pending;

  async function readWorkspace() {
    const [account, catalog, products, records, watchlist, analytics, chat, ...requests] = await Promise.all([
      request("/account"), request("/catalog"), request("/internal-products"),
      request("/internal-purchases"), request("/watchlist"), request("/account/analytics"),
      messages().catch(() => []), ...categories.map(category => request("/requests?category=" + category))
    ]);
    const names = {};
    const sec = {};
    for (const item of catalog.items ?? []) {
      names[item.symbol] = item.name;
      sec[item.symbol] = { name: item.name, type: types[item.itemType] };
    }
    for (const item of products.items ?? []) {
      names[item.code] = item.name;
      sec[item.code] = {
        name: item.name, type: types[item.itemType], discount: item.discountBps / 100,
        days: item.stockHoldingDays, min: item.minimumQuantity, needPass: item.passwordConfigured
      };
    }
    const fav = (watchlist.items ?? []).filter(item => item.market === "US").map(item => item.symbol);
    const orders = [
      ...account.orders.map(row => ({...row, code: row.symbol, total: row.amount_usd_cents})),
      ...records.purchases.map(row => ({...row, code: row.product_code, side: "BUY", price_cents: row.unit_price_cents, total: row.total_cents})),
      ...(records.sales ?? []).map(row => ({...row, code: row.symbol, side: "SELL", price_cents: row.unit_price_cents, total: row.total_cents})),
      ...(records.settlements ?? []).map(row => ({...row, code: row.product_code, side: "REDEEM", total: Number(row.total_cents) + Number(row.profit_cents), created_at: row.settled_at}))
    ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(row => ({
      s: row.code, t: { BUY: "买入", SELL: "卖出", REDEEM: "到期结算" }[row.side] ?? row.side,
      p: dollars(row.price_cents), q: Number(row.quantity), a: dollars(row.total), d: time(row.created_at)
    }));
    const holds = new Map();
    for (const item of [...account.positions, ...records.positions]) {
      const code = item.code ?? item.symbol;
      const holding = holds.get(code) ?? {s: code, q: 0, c: 0, lots: []};
      holding.q += Number(item.quantity);
      holding.c += dollars(item.cost_cents);
      if (item.manually_locked !== true && Number(item.unlocked_quantity) > 0) {
        holding.lots.push({q: Number(item.unlocked_quantity)});
      }
      holds.set(code, holding);
      if (item.name) names[code] = item.name;
    }
    const reqs = requests.flatMap((result, index) => (result.items ?? []).map(item => ({
      k: [item.kind === "WITHDRAWAL" ? "提现申请" : "充值申请", "身份资料申请", "银行卡资料"][index],
      st: item.settlementStatus === "INTERNAL_POSTED" ? "已记账" : item.status,
      a: dollars(item.amountCents), d: time(item.createdAt)
    }))).sort((a, b) => b.d.localeCompare(a.d));

    return {
      acct: String(account.account.id).slice(-8), sync: time(Date.now()) + " MYT",
      cashOverride: dollars(account.account.cashCents), realized: analytics.realizedPnlCents,
      totalCost: analytics.positionCostCents, names, sec, fav, watch: [...new Set([...fav, "AA"])],
      orders, holds: [...holds.values()], reqs, chat
    };
  }

  return {
    load() {
      pending ??= readWorkspace().finally(() => { pending = undefined; });
      return pending;
    },
    favorite(symbol, remove) {
      return request("/watchlist", remove ? "DELETE" : "POST", { market: "US", symbol });
    },
    messages,
    send: message => request("/support", "POST", { message }),
    open: section => location.assign("/?classic=1#" + section),
    async logout() {
      try {
        await request("/auth/logout", "POST");
      } finally {
        sessionStorage.removeItem("gsp_token");
        login();
      }
    }
  };
})();
