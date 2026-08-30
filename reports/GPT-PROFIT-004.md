# GPT-PROFIT-004 — Derivatives Edge Data Foundation

Result: **INSUFFICIENT_DERIVATIVES_HISTORY**

Research cutoff: 2026-08-30T00:00:00.000Z; forward validation starts: 2026-08-30T00:05:00.000Z. This is separate from GPT-PROFIT-003 Final Unseen, which remains at 0 executions.

Source observations: 360285; consolidated PIT metric rows: 60760 across 49 cache files; earliest: 2026-07-31T11:15:00.000Z; latest: 2026-08-30T11:15:00.000Z; common history: 18.90 days; >=90d: **false**.
Price-only diagnostic events: 4110; label horizon: 96 bars; costs: fee 0.001 + slippage 0.0005 per side; same-candle priority: STOP FIRST.

## Incremental information ablation

| Family | Events | Settled | Gross E[R] | Net E[R] | PF | Spearman | Δ Net E[R] | Δ PF | Symbols | Months | Fold consistency | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| price_only | 4110 | 4110 | 0.010219 | -1.116132 | 0.079921 | n/a | n/a | n/a | 6 | 2 | 0/3 | EVALUATED |
| open_interest | 4110 | 4110 | 0.010219 | -1.116132 | 0.079921 | -0.012065 | 0.000000 | 0.000000 | 6 | 2 | 0/3 | INSUFFICIENT_DERIVATIVES_HISTORY |
| funding | 4080 | 4080 | 0.012745 | -1.115252 | 0.080339 | -0.036325 | 0.000000 | 0.000000 | 6 | 2 | 0/3 | INSUFFICIENT_DERIVATIVES_HISTORY |
| basis | 4110 | 4110 | 0.010219 | -1.116132 | 0.079921 | 0.034066 | 0.000000 | 0.000000 | 6 | 2 | 0/3 | INSUFFICIENT_DERIVATIVES_HISTORY |
| taker_flow | 4110 | 4110 | 0.010219 | -1.116132 | 0.079921 | 0.033983 | 0.000000 | 0.000000 | 6 | 2 | 0/3 | INSUFFICIENT_DERIVATIVES_HISTORY |
| positioning | 4110 | 4110 | 0.010219 | -1.116132 | 0.079921 | -0.005879 | 0.000000 | 0.000000 | 6 | 2 | 0/3 | INSUFFICIENT_DERIVATIVES_HISTORY |
| combined_permitted | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 | 0 | 0/0 | INSUFFICIENT_DERIVATIVES_HISTORY |

Best incremental family: **none**. No candidate search was run (candidates generated: 0).

## Gate and collection

Internal Gate: **INSUFFICIENT_DERIVATIVES_HISTORY**; reasons: no family can be evaluated with >=90d coverage.

The prospective collector is enabled in the existing market sync, writes append-only `gpt_derivatives_metrics`, and is fail-soft: endpoint or table errors are returned in sync metadata without failing the candle/signal sync.

Liquidation remains `INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA`; the forward-only public stream adapter is available with historicalBackfill=false; top-trader account/position ratios are public aggregate observations and are retained for positioning research without account credentials.

## Safety

Main V2 and ALT Basket remain Shadow; `PRODUCTION_SIGNAL_STRATEGIES=[]`; no Production email, account access, position control, orders, leverage, or automatic trading. AUTO_TRADING=false; PRIVATE_BINANCE_API=false.
