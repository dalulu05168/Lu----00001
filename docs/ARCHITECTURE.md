# Architecture V1

- Markets: US, HK, CN, MY.
- Market data: licensed read-only provider integration; **not connected yet**.
- Orders: internal-only records. Never submit orders to a brokerage.
- Assets: internal account balances and positions; not real securities or withdrawable funds.
- Planned frontend: Next.js + TypeScript.
- Planned API: authenticated server-side services.
- Planned persistence: PostgreSQL with atomic ledger journal, idempotency keys and audit logs.
- FX: timestamped rates and currency-aware rounding.

## Disclosure

订单仅在本平台内部记录，不会发送至证券交易所或券商；所示持仓和资金不代表真实证券或可提现资产。
