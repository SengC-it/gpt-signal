# GPT-PROFIT-004 Data Availability Audit

This audit is a data-foundation deliverable. It does not add a strategy, read a private Binance API, or consume any GPT-PROFIT-003 holdout.

Generated: 2026-08-30T12:09:23.768Z; source version: `binance-usdm-public-rest-v1`; requested window: 2026-07-31T11:15:00.000Z → 2026-08-30T11:15:00.000Z.

## Endpoint capability matrix

| Family | Endpoint | Public | API key | Historical lookback | Max limit | Interval | Point-in-time / backtest | Risks |
|---|---|---:|---:|---|---:|---|---|---|
| open_interest_current | `/fapi/v1/openInterest` | yes | no | current snapshot only | 1 | request | server timestamp; safe=no | not historical-safe; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| open_interest | `/futures/data/openInterestHist` | yes | no | latest 1 month | 500 | 5m | closed period timestamp; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| premium_index_current | `/fapi/v1/premiumIndex` | yes | no | current snapshot only | 1 | request | server timestamp; safe=no | not historical-safe; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| funding | `/fapi/v1/fundingRate` | yes | no | provider history; no guaranteed long-term archive | 1000 | event / typically 8h | fundingTime settlement timestamp; safe=yes | yes for settled event; rateType/revisions must be retained; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| basis | `/futures/data/basis` | yes | no | latest 30 days | 500 | 5m | period start timestamp; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| taker_flow | `/futures/data/takerlongshortRatio` | yes | no | latest 30 days | 500 | 5m | period start timestamp; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| positioning | `/futures/data/globalLongShortAccountRatio` | yes | no | latest 30 days | 500 | 5m | period start timestamp; safe=yes | yes; global account ratio only; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| top_trader_account | `/futures/data/topLongShortAccountRatio` | yes | no | latest 30 days | 500 | 5m | period start timestamp; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| top_trader_position | `/futures/data/topLongShortPositionRatio` | yes | no | latest 30 days | 500 | 5m | period start timestamp; safe=yes | provider-limited history / possible revisions; retain source timestamps; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |
| liquidation | `websocket:!forceOrder@arr` | yes | no | no public historical REST backfill; websocket forward-only | n/a | event stream | event time; safe=no | forward only; no safe historical backtest; symbol universe is fixed to currently configured symbols; delisted contracts are not inferred |

Official source URLs: [USDⓈ-M Futures market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [open interest history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), [funding history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [basis](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Basis), [taker ratio](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Taker-BuySell-Volume), [global long/short](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio), [top-trader account](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [top-trader position](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).

## Collection result

- Symbols: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, LINKUSDT, AVAXUSDT, DOGEUSDT
- Rows observed across source files: 360285; expected on fixed 5m grids where applicable: 362922; missing ratio: 0.009002.
- Consolidated point-in-time rows prepared for `gpt_derivatives_metrics`: 60760; the migration is included but not applied to Production in this Draft PR.
- Earliest metric: 2026-07-31T11:15:00.000Z; latest metric: 2026-08-30T11:15:00.000Z; common observed span: 18.895833 days; >=90d: **false**.
- Dataset hash: `35d59e2838dee1fb05e586a300ea7d3786a2be337e665f494ebd8d1e1fb307f2`; manifest sidecar is generated next to this report.
- Database status: migration included in Draft PR; not applied to Production.

| Family | Observed rows | Symbols with data | Status |
|---|---:|---:|---|
| open_interest | 60487 | 7/7 | collected / coverage-limited |
| funding | 630 | 7/7 | collected / coverage-limited |
| basis | 57346 | 7/7 | collected / coverage-limited |
| taker_flow | 60361 | 7/7 | collected / coverage-limited |
| positioning | 60487 | 7/7 | collected / coverage-limited |
| top_trader_account | 60487 | 7/7 | collected / coverage-limited |
| top_trader_position | 60487 | 7/7 | collected / coverage-limited |
| liquidation | 0 | 0/7 | INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA |

## Backtest safety decisions

- All stored observations are timestamped at or before the requested closed-period boundary. Percentiles are calculated only from observations available at that point; no future rows are interpolated or used.
- Top-trader account/position ratios are aggregate public MARKET_DATA observations and are collected without account credentials. No user account, private position, order, or user-trade endpoint is called.
- Liquidation has no reliable public historical REST series in this foundation. It is explicitly `INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA`; only a future public stream may be collected.
- Forward liquidation adapter: `src/lib/binance/liquidation-forward.ts`; it parses only live public force-order events and is marked `backtestSafe=false`.
- The configured symbol list reflects currently supported symbols and therefore does not make survivorship claims about delisted contracts. Provider retention and revisions remain part of every row's quality flags.
- A coverage span below 90 days disables the derivatives Internal Gate and any robust-edge claim. It is a legitimate `INSUFFICIENT_DERIVATIVES_HISTORY` outcome.

## Safety boundary

`PRODUCTION_SIGNAL_STRATEGIES=[]`; Main V2 and ALT Basket remain Shadow. AUTO_TRADING=false, PRIVATE_BINANCE_API=false. This foundation only persists public market-data metrics and computes research diagnostics.
