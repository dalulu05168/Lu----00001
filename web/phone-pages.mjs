const array = value => Array.isArray(value) ? value : [];
const escape = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
const money = cents => cents != null && Number.isSafeInteger(Number(cents))
  ? "$" + (Number(cents) / 100).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})
  : "—";
const date = value => {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("zh-CN", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"})
    : "—";
};
const empty = message => '<p class="phone-data-empty">' + escape(message) + '</p>';
const row = (label, detail, right = "") => '<article class="phone-data-row"><div><strong>' + escape(label)
  + '</strong><small>' + escape(detail) + '</small></div>' + right + '</article>';

export function dataPanel(title, body) {
  return '<section class="phone-data-card"><h2>' + escape(title) + '</h2>' + body + '</section>';
}

export function marketPanel(instrument, quote, loading = false) {
  const symbol = instrument?.symbol || "—";
  const status = loading ? "正在读取报价…" : quote ? "只读参考报价 · " + date(quote.timestampMs) : "可信报价暂不可用";
  return '<div class="phone-market-identity"><span aria-hidden="true">' + escape(symbol.slice(0, 2))
    + '</span><div><strong>' + escape(symbol) + '</strong><small>' + escape(instrument?.name || symbol)
    + '</small></div></div><div class="phone-market-price">' + money(quote?.priceCents)
    + '</div><small class="phone-data-muted">' + escape(status) + '</small>';
}

export function productCatalog(items, action) {
  const products = array(items);
  const body = products.map((item, index) => {
    const details = [item.itemType || item.item_type, item.code || item.symbol];
    if (Number.isInteger(item.discountBps)) details.push("优惠 " + (item.discountBps / 100) + "%");
    if (Number.isInteger(item.minimumQuantity)) details.push("最低 " + item.minimumQuantity);
    if (Number.isInteger(item.stockHoldingDays) && (item.itemType || item.item_type) === "STOCK")
      details.push("持有 " + item.stockHoldingDays + " 天");
    return row(
      item.name || item.code || "产品",
      details.filter(Boolean).join(" · "),
      action ? '<div class="phone-data-action">' + action(index) + '</div>' : ""
    );
  }).join("");
  return dataPanel("内部产品和大宗交易", body || empty("尚无可参与产品或暂时无法同步"));
}

export function orderRecords(orders, ledger) {
  const trades = array(orders).map(order => ({
    type: order.side === "SELL" ? "卖出" : "买入", name: order.symbol, quantity: order.quantity, market: order.market,
    date: order.created_at ?? order.createdAt, price: order.price_cents ?? order.priceCents,
    total: order.amount_usd_cents ?? order.totalCents, status: order.status || "已记录", id: order.id
  }));
  const purchases = array(ledger?.purchases).map(order => ({
    type: "内部购买", name: order.product_code ?? order.productCode ?? "商品", quantity: order.quantity,
    date: order.created_at ?? order.createdAt, price: order.unit_price_cents, total: order.total_cents,
    status: order.status || "已记录", id: order.id, productName: order.product_name, due: order.due_at ?? order.stock_unlock_at
  }));
  const sales = array(ledger?.sales).map(order => ({
    type: "内部卖出", name: order.symbol ?? "证券", quantity: order.quantity,
    date: order.created_at ?? order.createdAt, price: order.unit_price_cents, total: order.total_cents,
    status: order.status || "已记录", id: order.id
  }));
  const settlements = array(ledger?.settlements).map(order => ({
    type: "到期返还", name: order.product_code ?? order.productCode ?? "商品", quantity: order.quantity,
    date: order.settled_at, total: order.total_cents, profit: order.profit_cents, productName: order.product_name, status: "已记录", id: order.id
  }));
  return [...trades, ...purchases, ...sales, ...settlements].sort((a, b) =>
    (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export function orderList(records, filter = "全部", {showFilters = true, title = "平台交易记录"} = {}) {
  const tabs = ["全部", "买入", "卖出"].map(value => '<button type="button" data-filter="' + value
    + '" aria-selected="' + (value === filter) + '">' + value + '</button>').join("");
  const list = records.filter(record => filter === "全部" || (filter === "买入"
    ? /买入|购买/.test(record.type) : record.type.includes("卖出"))).map(record => {
    const details = [record.type, "数量 " + (record.quantity ?? "—"), date(record.date)];
    if (record.market) details.unshift(record.market);
    if (record.productName) details.unshift(record.productName);
    if (record.due) details.push("到期 " + date(record.due));
    if (record.profit != null) details.push("收益 " + money(record.profit));
    return row(record.name || "订单", details.join(" · "), '<div class="phone-data-value"><strong>'
      + money(record.total) + '</strong><small>' + escape(record.status) + '</small></div>');
  }).join("");
  return (showFilters ? '<div class="phone-data-filters">' + tabs + '</div>' : "")
    + dataPanel(title, list || empty("当前筛选下暂无订单记录"));
}

export function accountSummary(account, updated) {
  const code = String(account?.id || "");
  return dataPanel("账户摘要", '<small class="phone-data-muted">账户编号</small><strong class="phone-account-id">'
    + escape(code ? "••••" + code.slice(-8) : "—") + '</strong><div class="phone-account-grid">'
    + '<div><small>币种</small><strong>' + escape(account?.currency || "—") + '</strong></div>'
    + '<div><small>现金</small><strong>' + money(account?.cashCents) + '</strong></div></div>'
    + '<small class="phone-data-muted">最近同步 ' + date(updated) + '</small>');
}
