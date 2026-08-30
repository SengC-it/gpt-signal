# GPT-PROFIT-004 Data Availability Audit

This audit is a data-foundation deliverable. It does not add a strategy, read a private Binance API, or consume any GPT-PROFIT-003 holdout.

Generated: 2026-08-30T16:45:59.286Z; source version: `binance-usdm-public-rest-v1`; requested window: 2026-07-31T11:15:00.000Z → 2026-08-30T11:15:00.000Z.

## Endpoint capability matrix

| Family | Endpoint | Capability | Anonymous | API key | Historical lookback | Interval | Point-in-time / backtest | Risks |
|---|---|---|---:|---:|---|---|---|---|
| open_interest_current | `/fapi/v1/openInterest` | ANONYMOUS_PUBLIC | yes | no | current snapshot only | request | server timestamp; safe=no | not historical-safe; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| open_interest | `/futures/data/openInterestHist` | ANONYMOUS_PUBLIC | yes | no | latest 1 month | 5m | period start; available after period end; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| premium_index_current | `/fapi/v1/premiumIndex` | ANONYMOUS_PUBLIC | yes | no | current snapshot only | request | server timestamp; safe=no | not historical-safe; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| funding | `/fapi/v1/fundingRate` | ANONYMOUS_PUBLIC | yes | no | provider history; no guaranteed long-term archive | event / typically 8h | fundingTime settlement; available at fundingTime; safe=yes | yes for settled event; rateType/revisions must be retained; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| basis | `/futures/data/basis` | ANONYMOUS_PUBLIC | yes | no | latest 30 days | 5m | period start; available at timestamp + 5m; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| taker_flow | `/futures/data/takerlongshortRatio` | ANONYMOUS_PUBLIC | yes | no | latest 30 days | 5m | period start; available at timestamp + 5m; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| positioning | `/futures/data/globalLongShortAccountRatio` | ANONYMOUS_PUBLIC | yes | no | latest 30 days | 5m | period start; available at timestamp + 5m; safe=yes | yes; global account ratio only; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| top_trader_account | `/futures/data/topLongShortAccountRatio` | MARKET_DATA_API_KEY | no | yes | latest 30 days | 5m | period start; available at timestamp + 5m; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| top_trader_position | `/futures/data/topLongShortPositionRatio` | MARKET_DATA_API_KEY | no | yes | latest 30 days | 5m | period start; available at timestamp + 5m; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| liquidation | `websocket:!forceOrder@arr` | ANONYMOUS_PUBLIC | yes | no | no public historical REST backfill; websocket forward-only | event stream | event time; available on receipt; safe=no | forward only; no safe historical backtest; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |

### Source timing matrix

| Family | Period start | Period end | available_at | Freshness policy |
|---|---|---|---|---|
| open_interest_current | n/a | n/a | server timestamp | current snapshot is not historical-safe |
| open_interest | timestamp | timestamp + 5m | timestamp + 5m | period must be closed before PIT use |
| premium_index_current | n/a | n/a | server timestamp | current snapshot is not historical-safe |
| funding | n/a | fundingTime | fundingTime | last settled funding may persist only within funding freshness tolerance |
| basis | timestamp | timestamp + 5m | timestamp + 5m | period must be closed before PIT use |
| taker_flow | timestamp | timestamp + 5m | timestamp + 5m | period must be closed before PIT use |
| positioning | timestamp | timestamp + 5m | timestamp + 5m | period must be closed before PIT use |
| top_trader_account | timestamp | timestamp + 5m | timestamp + 5m | period must be closed before PIT use |
| top_trader_position | timestamp | timestamp + 5m | timestamp + 5m | period must be closed before PIT use |
| liquidation | n/a | n/a | receivedAt | forward-only |

Top-trader capability: **MARKET_DATA_API_KEY**; key configured: **false**; without the optional `BINANCE_MARKET_DATA_API_KEY`, status is `UNAVAILABLE_API_KEY_REQUIRED`. No key is sent to non-allowlisted endpoints.
Private/account endpoints used: **false**; private endpoint families: none.

Official source URLs: [USDⓈ-M Futures market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [open interest history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), [funding history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [basis](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Basis), [taker ratio](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Taker-BuySell-Volume), [global long/short](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio), [top-trader account](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [top-trader position](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).

## Collection result

- Symbols: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, LINKUSDT, AVAXUSDT, DOGEUSDT
- Rows observed across source files: 226884; expected on fixed 5m grids where applicable: 241948; missing ratio: 0.064865.
- Consolidated point-in-time rows prepared for `gpt_derivatives_metrics`: 60375; the migration is included but not applied to Production in this Draft PR.
- Earliest metric: 2026-07-31T15:50:00.000Z; latest metric: 2026-08-30T11:15:00.000Z; global common span (descriptive only): 19.086806 days; family gates use independent coverage.
- Dataset hash: `04b3724fedf34d35e8c6b7b0c050fd00a047185a83f830f1bddc148bf1ca5eaa`; manifest sidecar is generated next to this report.
- Database status: migration included in Draft PR; not applied to Production.

| Family | Observed rows | Calendar coverage | Symbols with data | Symbols >=90d | Missing | Stale | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| open_interest | 60095 | 29.809028d | 7/7 | 0 | 0.006481 | 0 | collected / coverage-limited |
| funding | 630 | 29.666667d | 7/7 | 0 | n/a | 0 | collected / coverage-limited |
| basis | 46079 | 19.09375d | 7/7 | 0 | 0.2382 | 0.00013 | collected / coverage-limited |
| taker_flow | 59978 | 29.809028d | 7/7 | 0 | 0.008415 | 0 | collected / coverage-limited |
| positioning | 60102 | 29.8125d | 7/7 | 0 | 0.006365 | 0 | collected / coverage-limited |
| top_trader_account | 0 | 0d | 0/7 | 0 | n/a | n/a | UNAVAILABLE_API_KEY_REQUIRED |
| top_trader_position | 0 | 0d | 0/7 | 0 | n/a | n/a | UNAVAILABLE_API_KEY_REQUIRED |
| liquidation | 0 | 0d | 0/7 | 0 | n/a | n/a | INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA |

Family coverage is independent: a DOGE basis gap does not reduce OI, funding, taker, or positioning coverage. Combined Gate coverage is the intersection of actually selected families only.
DOGE basis investigation: **SOURCE_GAP_UNRESOLVED** (observedGap=false); latest observed: 2026-08-30T11:15:00.000Z. The earlier truncation was not reproduced on the fixed-window refresh; the provider returned observations through the requested end. The historical cause of the prior gap remains unresolved.

## Backtest safety decisions

- All stored observations are timestamped at or before the requested closed-period boundary. Percentiles are calculated only from observations available at that point; no future rows are interpolated or used.
- Top-trader account/position ratios are aggregate MARKET_DATA observations. They require only the optional BINANCE_MARKET_DATA_API_KEY; without it they are explicitly unavailable rather than silently reused. No user account, private position, order, or user-trade endpoint is called.
- Liquidation has no reliable public historical REST series in this foundation. It is explicitly `INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA`; only a future public stream may be collected.
- Liquidation adapter: `src/lib/binance/liquidation-forward.ts`; adapterImplemented=true, runtimeCollectorEnabled=false, historicalBackfill=false, backtestSafe=false, status=FORWARD_COLLECTOR_NOT_DEPLOYED.
- The configured symbol list reflects currently supported symbols and therefore does not make survivorship claims about delisted contracts. Provider retention and revisions remain part of every row's quality flags.
- A coverage span below 90 days disables the derivatives Internal Gate and any robust-edge claim. It is a legitimate `INSUFFICIENT_DERIVATIVES_HISTORY` outcome.

## Safety boundary

`PRODUCTION_SIGNAL_STRATEGIES=[]`; Main V2 and ALT Basket remain Shadow. AUTO_TRADING=false, PRIVATE_BINANCE_API=false. This foundation only persists public market-data metrics and computes research diagnostics.
