# GPT-PROFIT-004 — Derivatives Edge Data Foundation

Result: **INSUFFICIENT_DERIVATIVES_HISTORY**

Research cutoff: 2026-08-30T00:00:00.000Z; forward validation starts: 2026-08-30T00:05:00.000Z. This is separate from GPT-PROFIT-003 Final Unseen, which remains at 0 executions.

Source observations: 226884; consolidated PIT metric rows: 60375 across 49 cache files; earliest: 2026-07-31T15:50:00.000Z; latest: 2026-08-30T11:15:00.000Z; combined selected-family history: 19.09 days; >=90d: **false**.
Family coverage (independent): open_interest=29.81d, funding=29.67d, basis=19.09d, taker_flow=29.81d, positioning=29.81d.
Price-only diagnostic events: 4086; label horizon: 96 bars; costs: fee 0.001 + slippage 0.0005 per side; same-candle priority: STOP FIRST.

## Incremental information ablation

Unconditional family columns are the comparable baseline population for that family. Conditioned columns are the deterministic score top 30% slice; deltas are conditioned minus that same-event baseline.

| Family | Base events | Base settled | Base Gross E[R] | Base Net E[R] | Base PF | Cond events | Cond settled | Cond Gross E[R] | Cond Net E[R] | Cond PF | Δ Gross E[R] | Δ Net E[R] | Δ PF | Spearman | Mono violations | Top lift | Base symbols | Cond symbols | Base months | Cond folds | Missing | Stale | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| price_only | 4086 | 4085 | -0.020808 | -1.162269 | 0.073202 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 6 | 0 | 2 | 0/0 | 0 | 0 | EVALUATED |
| open_interest | 4080 | 4079 | -0.019367 | -1.161616 | 0.073340 | 1224 | 1224 | -0.058824 | -1.020494 | 0.099541 | -0.039457 | 0.141122 | 0.026201 | -0.014944 | 1000.000000 | 0.141122 | 6 | 6 | 2 | 0/3 | 6 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| funding | 4080 | 4079 | -0.019367 | -1.161616 | 0.073340 | 1225 | 1224 | -0.008170 | -1.022038 | 0.092904 | 0.011197 | 0.139578 | 0.019564 | -0.013265 | 839.000000 | 0.139578 | 6 | 6 | 2 | 0/3 | 6 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| basis | 3304 | 3304 | -0.012712 | -1.273823 | 0.051138 | 992 | 992 | 0.030242 | -1.367825 | 0.033910 | 0.042954 | -0.094002 | -0.017228 | 0.034404 | 824.000000 | -0.094002 | 6 | 6 | 2 | 0/3 | 6 | 776 | INSUFFICIENT_DERIVATIVES_HISTORY |
| taker_flow | 4082 | 4081 | -0.019848 | -1.161881 | 0.073291 | 1225 | 1225 | -0.013878 | -1.216736 | 0.063669 | 0.005970 | -0.054855 | -0.009622 | 0.002157 | 1047.000000 | -0.054855 | 6 | 6 | 2 | 0/3 | 4 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| positioning | 4086 | 4085 | -0.020808 | -1.162269 | 0.073202 | 1256 | 1256 | -0.044586 | -1.054300 | 0.096287 | -0.023778 | 0.107969 | 0.023085 | -0.012768 | 1024.000000 | 0.107969 | 6 | 6 | 2 | 0/3 | 0 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| combined_permitted | 0 | 0 | n/a | n/a | n/a | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0/0 | 0 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |

- open_interest net-R contribution concentration: largest absolute=0.233520, largest positive=n/a; future Gate requires each <= 0.50.
- funding net-R contribution concentration: largest absolute=0.233520, largest positive=n/a; future Gate requires each <= 0.50.
- basis net-R contribution concentration: largest absolute=0.222417, largest positive=n/a; future Gate requires each <= 0.50.
- taker_flow net-R contribution concentration: largest absolute=0.233713, largest positive=n/a; future Gate requires each <= 0.50.
- positioning net-R contribution concentration: largest absolute=0.233406, largest positive=n/a; future Gate requires each <= 0.50.

Best incremental family: **none**. No candidate search was run (candidates generated: 0).

## Gate and collection

Internal Gate: **INSUFFICIENT_DERIVATIVES_HISTORY**; reasons: no family can be evaluated with >=90d coverage.

The prospective collector is enabled in the existing market sync, writes append-only `gpt_derivatives_metrics`, and is fail-soft: endpoint or table errors are returned in sync metadata without failing the candle/signal sync.

Liquidation remains `INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA`; adapterImplemented=true, runtimeCollectorEnabled=false, status=FORWARD_COLLECTOR_NOT_DEPLOYED. Top-trader account/position ratios require the optional MARKET_DATA key and are excluded when unavailable.

## Safety

Main V2 and ALT Basket remain Shadow; `PRODUCTION_SIGNAL_STRATEGIES=[]`; no Production email, account access, position control, orders, leverage, or automatic trading. AUTO_TRADING=false; PRIVATE_BINANCE_API=false.
