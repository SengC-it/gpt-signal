# GPT-PROFIT-004 — Derivatives Edge Data Foundation

Result: **INSUFFICIENT_DERIVATIVES_HISTORY**

Research cutoff: 2026-08-30T00:00:00.000Z; forward validation starts: 2026-08-30T00:05:00.000Z. This is separate from GPT-PROFIT-003 Final Unseen, which remains at 0 executions.

Source observations: 226884; consolidated PIT metric rows: 60375 across 49 cache files; earliest: 2026-07-31T15:50:00.000Z; latest: 2026-08-30T11:15:00.000Z; overall observed history intersection: 19.09 days; selected/permitted-family intersection: n/a; overall >=90d: **false**.
Family coverage (independent): open_interest=29.81d, funding=29.67d, basis=19.09d, taker_flow=29.81d, positioning=29.81d.
Price-only diagnostic events: 4086; label horizon: 96 bars; costs: fee 0.001 + slippage 0.0005 per side; same-candle priority: STOP FIRST.

## Incremental information ablation

Unconditional family columns are the comparable baseline population for that family. Conditioned columns are the deterministic score top 30% slice; deltas are conditioned minus that same-event baseline. These diagnostics are **PRELIMINARY / NOT OOS EDGE EVIDENCE** and cannot produce a robust Gate PASS.

| Family | Base events | Base settled | Base Gross E[R] | Base Net E[R] | Base PF | Cond events | Cond settled | Cond Gross E[R] | Cond Net E[R] | Cond PF | Δ Gross E[R] | Δ Net E[R] | Δ PF | Spearman | Decile buckets | Valid buckets | Mono violations | Top lift | Base symbols | Cond symbols | Base months | Cond folds | Missing | Stale | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| price_only | 4086 | 4085 | -0.020808 | -1.162269 | 0.073202 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 10 | 0 | n/a | n/a | 6 | 0 | 2 | 0/0 | 0 | 0 | EVALUATED |
| open_interest | 4080 | 4079 | -0.019367 | -1.161616 | 0.073340 | 1224 | 1224 | -0.058824 | -1.020494 | 0.099541 | -0.039457 | 0.141122 | 0.026201 | -0.014944 | 10 | 10 | 4 | 0.141122 | 6 | 6 | 2 | 0/3 | 6 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| funding | 4080 | 4079 | -0.019367 | -1.161616 | 0.073340 | 1225 | 1224 | -0.008170 | -1.022038 | 0.092904 | 0.011197 | 0.139578 | 0.019564 | -0.013265 | 10 | 10 | 4 | 0.139578 | 6 | 6 | 2 | 0/3 | 6 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| basis | 3304 | 3304 | -0.012712 | -1.273823 | 0.051138 | 992 | 992 | 0.030242 | -1.367825 | 0.033910 | 0.042954 | -0.094002 | -0.017228 | 0.034404 | 10 | 10 | 5 | -0.094002 | 6 | 6 | 2 | 0/3 | 6 | 776 | INSUFFICIENT_DERIVATIVES_HISTORY |
| taker_flow | 4082 | 4081 | -0.019848 | -1.161881 | 0.073291 | 1225 | 1225 | -0.013878 | -1.216736 | 0.063669 | 0.005970 | -0.054855 | -0.009622 | 0.002157 | 10 | 10 | 4 | -0.054855 | 6 | 6 | 2 | 0/3 | 4 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| positioning | 4086 | 4085 | -0.020808 | -1.162269 | 0.073202 | 1256 | 1256 | -0.044586 | -1.054300 | 0.096287 | -0.023778 | 0.107969 | 0.023085 | -0.012768 | 10 | 10 | 5 | 0.107969 | 6 | 6 | 2 | 0/3 | 0 | 0 | INSUFFICIENT_DERIVATIVES_HISTORY |
| combined_permitted | 0 | 0 | n/a | n/a | n/a | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 10 | 0 | n/a | n/a | 0 | 0 | 0 | 0/0 | 0 | 0 | NOT_PERMITTED |

## Decile monotonicity

Monotonicity is evaluated across fixed ten score buckets (ascending score), not individual trade-to-trade transitions. Each bucket reports count, gross expectancy, and net expectancy; the maximum possible transition violations is nine.

### open_interest
- bucket count: 10; valid bucket count: 10; gross expectancy monotonic violations: 4.
| Bucket | Count | Gross E[R] | Net E[R] |
|---:|---:|---:|---:|
| 1 | 408 | -0.036855 | -0.832839 |
| 2 | 408 | -0.009804 | -1.024536 |
| 3 | 408 | 0.024510 | -1.074977 |
| 4 | 408 | -0.029412 | -1.389026 |
| 5 | 408 | 0.029412 | -1.403219 |
| 6 | 408 | 0.000000 | -1.504427 |
| 7 | 408 | 0.004902 | -1.324848 |
| 8 | 408 | -0.068627 | -1.210524 |
| 9 | 408 | -0.029412 | -0.974102 |
| 10 | 408 | -0.078431 | -0.876857 |

### funding
- bucket count: 10; valid bucket count: 10; gross expectancy monotonic violations: 4.
| Bucket | Count | Gross E[R] | Net E[R] |
|---:|---:|---:|---:|
| 1 | 408 | 0.034314 | -1.031633 |
| 2 | 408 | 0.009804 | -0.465106 |
| 3 | 408 | 0.024510 | -1.169242 |
| 4 | 408 | -0.063725 | -1.293838 |
| 5 | 408 | -0.049020 | -1.429054 |
| 6 | 408 | 0.014706 | -1.584376 |
| 7 | 408 | -0.137255 | -1.574574 |
| 8 | 408 | -0.031941 | -1.303577 |
| 9 | 408 | 0.098039 | -1.073805 |
| 10 | 408 | -0.093137 | -0.691303 |

### basis
- bucket count: 10; valid bucket count: 10; gross expectancy monotonic violations: 5.
| Bucket | Count | Gross E[R] | Net E[R] |
|---:|---:|---:|---:|
| 1 | 331 | -0.178248 | -1.268009 |
| 2 | 330 | 0.090909 | -1.313070 |
| 3 | 331 | -0.099698 | -1.611781 |
| 4 | 330 | -0.024242 | -1.419391 |
| 5 | 330 | 0.012121 | -0.822109 |
| 6 | 331 | 0.009063 | -0.829160 |
| 7 | 330 | -0.024242 | -1.368036 |
| 8 | 331 | 0.075529 | -1.381011 |
| 9 | 330 | 0.048485 | -1.462563 |
| 10 | 330 | -0.036364 | -1.263118 |

### taker_flow
- bucket count: 10; valid bucket count: 10; gross expectancy monotonic violations: 4.
| Bucket | Count | Gross E[R] | Net E[R] |
|---:|---:|---:|---:|
| 1 | 409 | -0.002445 | -1.449327 |
| 2 | 408 | -0.073529 | -1.296728 |
| 3 | 408 | 0.046683 | -1.015270 |
| 4 | 408 | 0.009804 | -1.037922 |
| 5 | 408 | -0.122549 | -1.149556 |
| 6 | 409 | 0.056235 | -0.948632 |
| 7 | 408 | -0.073529 | -1.071935 |
| 8 | 408 | -0.058824 | -1.129960 |
| 9 | 408 | 0.000000 | -1.206831 |
| 10 | 408 | 0.019608 | -1.312113 |

### positioning
- bucket count: 10; valid bucket count: 10; gross expectancy monotonic violations: 5.
| Bucket | Count | Gross E[R] | Net E[R] |
|---:|---:|---:|---:|
| 1 | 409 | -0.026895 | -0.831923 |
| 2 | 409 | -0.009804 | -1.054973 |
| 3 | 408 | 0.024510 | -1.140981 |
| 4 | 409 | -0.036675 | -1.362606 |
| 5 | 408 | 0.004902 | -1.650903 |
| 6 | 409 | -0.051345 | -1.203043 |
| 7 | 409 | 0.041565 | -1.238132 |
| 8 | 408 | -0.014706 | -1.126614 |
| 9 | 409 | -0.066015 | -1.104502 |
| 10 | 408 | -0.073529 | -0.909189 |

- open_interest net-R contribution concentration: largest absolute=0.233520, largest positive=n/a; future Gate requires each <= 0.50.
- funding net-R contribution concentration: largest absolute=0.233520, largest positive=n/a; future Gate requires each <= 0.50.
- basis net-R contribution concentration: largest absolute=0.222417, largest positive=n/a; future Gate requires each <= 0.50.
- taker_flow net-R contribution concentration: largest absolute=0.233713, largest positive=n/a; future Gate requires each <= 0.50.
- positioning net-R contribution concentration: largest absolute=0.233406, largest positive=n/a; future Gate requires each <= 0.50.

Best evaluated family: **none**; preliminary best family: **open_interest**. No candidate search was run (candidates generated: 0); GPT-PROFIT-004 produces no Production or Shadow candidate.

## Gate and collection

Internal Gate: **INSUFFICIENT_DERIVATIVES_HISTORY**; evidence: **INSUFFICIENT_DERIVATIVES_HISTORY**; Gate history input: n/a days; reasons: no family can be evaluated with >=90d coverage.
Single-family coverage uses the selected family's own coverage; combined coverage uses only the selected/permitted-family intersection. Robust PASS is unavailable until purged nested OOS, train-only calibration, and OOS evaluation are complete.

The prospective collector is enabled in the existing market sync, writes append-only `gpt_derivatives_metrics`, and is fail-soft: endpoint or table errors are returned in sync metadata without failing the candle/signal sync.

Liquidation remains `INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA`; adapterImplemented=true, runtimeCollectorEnabled=false, status=FORWARD_COLLECTOR_NOT_DEPLOYED. Top-trader account/position ratios require the optional MARKET_DATA key and are excluded when unavailable.

## Safety

Main V2 and ALT Basket remain Shadow; `PRODUCTION_SIGNAL_STRATEGIES=[]`; no Production email, account access, position control, orders, leverage, or automatic trading. AUTO_TRADING=false; PRIVATE_BINANCE_API=false.
