const escape = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
const array = value => Array.isArray(value) ? value : [];

export function renderHoldings(positions, internalPositions) {
  const holdings = [
    ...array(positions).filter(position => position?.symbol),
    ...array(internalPositions).filter(position => position?.code || position?.symbol)
  ].filter(position => Number(position.quantity) > 0);
  const heading = '<div class="phone-holdings-heading"><h2>我的持仓</h2><span>' + holdings.length + '</span></div>';
  if (!holdings.length) return heading + '<div class="phone-holding-empty">账户暂无持仓记录</div>';
  const cards = holdings.map(position => {
    const symbol = position.symbol || position.code;
    const name = position.name || position.code || symbol;
    const cents = Number(position.cost_cents ?? position.costCents ?? NaN);
    const cost = Number.isSafeInteger(cents) ? "$" + (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits:2, maximumFractionDigits:2
    }) : "—";
    const quantity = Number(position.quantity).toLocaleString("en-US");
    const lock = position.item_type === "STOCK"
      ? '<small>' + (position.manually_locked ? "人工锁仓" : "持有期已满 " + escape(position.unlocked_quantity ?? 0) + " 股") + '</small>'
      : "";
    return '<article class="phone-holding-card"><div><span aria-hidden="true">' +
      escape(String(symbol).slice(0, 2)) + '</span><strong>' + escape(name) + '</strong></div><p>' +
      escape([position.market, symbol].filter(Boolean).join(" · ")) + ' · ' + escape(quantity) +
      ' 股</p><p>成本 ' + cost + '</p>' + lock + '</article>';
  }).join("");
  return heading + '<div class="phone-holdings-grid">' + cards + '</div>';
}
