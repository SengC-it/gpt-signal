# GPT-PROFIT-003-R1 — Nested OOS & Entry-Edge Integrity

- Result: **NO ENTRY EDGE FOUND**
- Entry events: 105307; raw features tested: 38; outer folds: 3; inner folds/outer: 3.
- Discovery: 2025-05-09T23:45:00.000Z → 2026-08-02T03:15:00.000Z; protected Final Unseen: 2026-08-02T03:30:00.000Z → 2026-08-29T23:45:00.000Z.
- Label horizon: 96 bars; outer purge: 96; inner purge: 96; leakage assertion: true.

## Predictive versus economic score

- Predictive target: grossR / hit_tp versus hit_sl. Economic target: netR after fee/slippage. Training predictive status: **CALIBRATED**; aggregate outer OOS predictive status: **ENTRY_SCORE_NOT_CALIBRATED**.
- Gross OOS Spearman: -0.032; Net OOS Spearman: 0.204; OOS monotonic violations: 5.
- Highest score bucket gross expectancy: 0.021; Net expectancy: -0.434.

## Alias groups removed

- atr_pct / sl_distance_pct / cost_coverage_ratio → retain **atr_pct**; dropped sl_distance_pct, cost_coverage_ratio (sl_distance_pct corr=1.000; cost_coverage_ratio corr=1.000).


## Feature status

- ROBUST (56 diagnostic rows): cross_sectional_dispersion, structure_distance_rolling_high, btc_trend_4h, trend_return_1h, body_range_ratio, btc_trend_1h, expansion_ratio, close_location_value, trend_slope_short, recent_range_atr, trend_return_12h, atr_pct, sl_distance_pct, cost_coverage_ratio, btc_volatility_state, relative_strength_4h, atr_percentile, volume_percentile, volume_expansion.
- Non-predictive or unstable: UNSTABLE:trend_return_15m, UNSTABLE:trend_return_4h, UNSTABLE:trend_return_12h, UNSTABLE:trend_slope_short, UNSTABLE:trend_slope_medium, UNSTABLE:structure_distance_rolling_low, UNSTABLE:breakout_distance_atr, WEAK:retracement_ratio, UNSTABLE:structure_age, UNSTABLE:atr_pct, WEAK:compression_ratio, UNSTABLE:lower_wick_ratio, WEAK:volume_ratio, WEAK:quote_volume_ratio, WEAK:volume_percentile, UNSTABLE:volume_expansion, UNSTABLE:relative_strength_1h, UNSTABLE:relative_strength_4h, UNSTABLE:relative_strength_12h, WEAK:btc_volatility_state, UNSTABLE:breadth_bullish_pct, UNSTABLE:sl_distance_pct, NO_EDGE:estimated_round_trip_cost_pct, UNSTABLE:cost_coverage_ratio, UNSTABLE:trend_return_1h, UNSTABLE:structure_distance_rolling_high, UNSTABLE:pullback_depth_atr, NO_EDGE:structure_age, UNSTABLE:atr_percentile, UNSTABLE:expansion_ratio, UNSTABLE:body_range_ratio, WEAK:lower_wick_ratio, NO_EDGE:close_location_value, UNSTABLE:volume_ratio, UNSTABLE:quote_volume_ratio, UNSTABLE:breadth_bearish_pct, UNSTABLE:cross_sectional_dispersion, UNSTABLE:retracement_ratio, WEAK:upper_wick_ratio.

## Per-outer-fold nested artifacts

| Fold | Train/Test events | Selected features | Alias groups | Thresholds | Train Net Exp | Test Net Exp |
|---:|---:|---|---:|---|---:|---:|
| 1 | 28112/27259 | cross_sectional_dispersion, structure_distance_rolling_high, btc_trend_4h, trend_return_1h, body_range_ratio, btc_trend_1h, expansion_ratio, close_location_value | 0 | trend_pullback_continuation:55.471; breakout_retest:60.316; volatility_compression_expansion:57.510; relative_strength_continuation:52.990 | -0.636 | -0.688 |
| 2 | 55387/25017 | btc_trend_4h, trend_slope_short, recent_range_atr, trend_return_12h, atr_pct, btc_trend_1h | 1 | trend_pullback_continuation:55.251; breakout_retest:53.700; volatility_compression_expansion:54.473; relative_strength_continuation:52.884 | -0.659 | -0.817 |
| 3 | 80430/24676 | btc_trend_4h, btc_volatility_state, relative_strength_4h, body_range_ratio, trend_return_12h, atr_percentile, volume_percentile, volume_expansion | 0 | trend_pullback_continuation:56.582; breakout_retest:51.186; volatility_compression_expansion:49.734; relative_strength_continuation:53.979 | -0.710 | -0.894 |

## Nested OOS ablation

| Stage | OOS PF | Δ PF | OOS Exp R | Δ Exp R | Δ trades | Δ DD |
|---|---:|---:|---:|---:|---:|---:|
| Base setup | 0.157 | 0.000 | -0.796 | 0.000 | 0 | 0.000 |
| + trend | 0.291 | 0.134 | -0.560 | 0.237 | -59403 | -51430.262 |
| + structure | 0.133 | -0.023 | -0.850 | -0.054 | -19363 | -12307.850 |
| + volatility | 0.224 | 0.067 | -0.665 | 0.131 | -54926 | -46604.426 |
| + volume | 0.179 | 0.022 | -0.754 | 0.042 | -17260 | -16262.849 |
| + relativeStrength | 0.187 | 0.030 | -0.738 | 0.058 | -20757 | -19776.236 |
| + marketBreadth | 0.267 | 0.110 | -0.597 | 0.199 | -53008 | -46965.104 |

## Candidate OOS

| Candidate | Settled | Net R | PF | Exp R | Payoff | Max DD | Positive folds |
|---|---:|---:|---:|---:|---:|---:|---:|
| p003-r1-01-trend_pullback_continuation | 6648 | -3638.334 | 0.303 | -0.547 | 0.335 | 3638.334 | 0/3 |
| p003-r1-02-breakout_retest | 1951 | -1126.635 | 0.273 | -0.577 | 0.308 | 1127.454 | 0/3 |
| p003-r1-03-volatility_compression_expansion | 1779 | -1274.139 | 0.202 | -0.716 | 0.276 | 1274.362 | 0/3 |
| p003-r1-04-relative_strength_continuation | 10708 | -6040.137 | 0.288 | -0.564 | 0.327 | 6040.137 | 0/3 |

- Internal Gate: **FAIL** (netRPositive, profitFactor, expectancy, payoff, positiveFolds, positiveMonths, oosScoreCalibrated, oosSpearmanPositive, oosBucketDirectionConsistent, highestGrossBucketImprovesBaseline).
- R1 freeze: 898361b333e2e409d18f980015c99131c8dd5dec1081ac57b13c4a5015e66d49; Final Unseen executed=false; holdout executions=0.
- Reproducibility: main 78104f72b8cbd486a9844839c3fc807cef57643a; branch 567ae31e403949db445cc98bf3d8902a7606e4e0; parent 8cab611705578bf364dea22c3f7765af0d38ed02; script 61ed77260e37d250b5791b1ba2c360379cf8e7009ff0f3f3719e1aa85f767b7b; module 23ea92380821f64e22387d7b0b2cde6209c5578b41583c5b9c1262492548b79d; freeze 898361b333e2e409d18f980015c99131c8dd5dec1081ac57b13c4a5015e66d49; dataset c2b482d6171596aa297133a9959c50b5faaea4655036f6f17e27c41c55dcfec9.

Research-only: Main V2 and ALT Basket remain Shadow; PRODUCTION_SIGNAL_STRATEGIES=[]; no account, position, automatic order, leverage, or private Binance API access.
