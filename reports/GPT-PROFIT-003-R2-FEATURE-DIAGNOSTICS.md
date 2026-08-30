# GPT-PROFIT-003-R2 — Nested OOS & Entry-Edge Integrity

- Result: **NO ENTRY EDGE FOUND**
- Entry events: 105307; raw features tested: 38; outer folds: 3; inner folds/outer: 3.
- Discovery: 2025-05-09T23:45:00.000Z → 2026-08-02T03:15:00.000Z; protected Final Unseen: 2026-08-02T03:30:00.000Z → 2026-08-29T23:45:00.000Z.
- Label horizon: 96 bars; outer purge: 96; inner purge: 96; leakage assertion: true.
- Inner OOS robustness rule: INNER_OOS_ROBUST requires positive directional lift in at least 2/3 inner OOS folds, aggregate inner OOS lift > 0, acceptable monotonicity, sample >= 150, symbol breadth >= 3.

## Predictive versus economic score

- Predictive target: grossR / hit_tp versus hit_sl. Economic target: netR after fee/slippage. Training predictive status: **CALIBRATED**; aggregate outer OOS predictive status: **ENTRY_SCORE_NOT_CALIBRATED**.
- Gross OOS Spearman: -0.040; Net OOS Spearman: 0.080; OOS monotonic violations: 5.
- Highest score bucket gross expectancy: -0.041; Net expectancy: -0.595.

## Alias groups removed

- None in the selected fold feature sets.

## Feature status

- INNER_OOS_ROBUST (44 diagnostic rows): trend_alignment_long, retracement_ratio, lower_wick_ratio, pullback_depth_atr, breadth_bearish_pct, compression_ratio, structure_age, volume_percentile, trend_return_1h, relative_strength_1h, btc_trend_1h, volume_expansion, close_location_value, btc_trend_4h, trend_slope_short, trend_return_12h.
- Non-predictive or unstable: UNSTABLE:trend_return_15m, UNSTABLE:trend_return_1h, NO_EDGE:trend_return_4h, UNSTABLE:trend_return_12h, UNSTABLE:trend_slope_medium, UNSTABLE:structure_distance_rolling_high, UNSTABLE:structure_distance_rolling_low, NO_EDGE:breakout_distance_atr, UNSTABLE:atr_pct, UNSTABLE:atr_percentile, UNSTABLE:recent_range_atr, UNSTABLE:expansion_ratio, NO_EDGE:body_range_ratio, UNSTABLE:upper_wick_ratio, WEAK:volume_ratio, WEAK:quote_volume_ratio, WEAK:volume_expansion, UNSTABLE:relative_strength_1h, UNSTABLE:relative_strength_4h, UNSTABLE:btc_trend_4h, UNSTABLE:btc_volatility_state, UNSTABLE:breadth_bullish_pct, NO_EDGE:cross_sectional_dispersion, UNSTABLE:sl_distance_pct, NO_EDGE:estimated_round_trip_cost_pct, UNSTABLE:cost_coverage_ratio, UNSTABLE:trend_return_4h, UNSTABLE:trend_slope_short, UNSTABLE:breakout_distance_atr, UNSTABLE:structure_age, NO_EDGE:atr_percentile, UNSTABLE:compression_ratio, UNSTABLE:body_range_ratio, UNSTABLE:volume_ratio, UNSTABLE:quote_volume_ratio, NO_EDGE:volume_percentile, UNSTABLE:relative_strength_12h, NO_EDGE:btc_volatility_state, UNSTABLE:cross_sectional_dispersion, UNSTABLE:pullback_depth_atr, NO_EDGE:recent_range_atr, NO_EDGE:compression_ratio, WEAK:expansion_ratio, UNSTABLE:lower_wick_ratio, UNSTABLE:volume_percentile, UNSTABLE:btc_trend_1h.

## Per-outer-fold nested artifacts

| Fold | Train/Test events | Selected features | Alias groups | Thresholds | Train Net Exp | Test Net Exp |
|---:|---:|---|---:|---|---:|---:|
| 1 | 28112/27259 | trend_alignment_long, retracement_ratio, lower_wick_ratio, pullback_depth_atr, breadth_bearish_pct, compression_ratio, structure_age, volume_percentile | 0 | trend_pullback_continuation:57.719; breakout_retest:51.772; volatility_compression_expansion:58.318; relative_strength_continuation:55.423 | -0.636 | -0.688 |
| 2 | 55387/25017 | trend_return_1h, relative_strength_1h, btc_trend_1h, volume_expansion, close_location_value, pullback_depth_atr, lower_wick_ratio, retracement_ratio | 0 | trend_pullback_continuation:57.499; breakout_retest:59.580; volatility_compression_expansion:55.506; relative_strength_continuation:54.338 | -0.659 | -0.817 |
| 3 | 80430/24676 | trend_return_1h, btc_trend_4h, retracement_ratio, trend_slope_short, volume_expansion, close_location_value, trend_return_12h, relative_strength_1h | 0 | trend_pullback_continuation:57.016; breakout_retest:56.290; volatility_compression_expansion:53.046; relative_strength_continuation:53.526 | -0.710 | -0.894 |

## Nested OOS ablation

| Stage | OOS PF | Δ PF | OOS Exp R | Δ Exp R | Δ trades | Δ DD |
|---|---:|---:|---:|---:|---:|---:|
| Base setup | 0.157 | 0.000 | -0.796 | 0.000 | 0 | 0.000 |
| + trend | 0.230 | 0.073 | -0.655 | 0.141 | -46900 | -41567.406 |
| + structure | 0.185 | 0.028 | -0.747 | 0.050 | -56562 | -46028.933 |
| + volatility | 0.135 | -0.022 | -0.842 | -0.046 | -18012 | -11620.234 |
| + volume | 0.167 | 0.010 | -0.761 | 0.035 | -52428 | -42585.218 |
| + relativeStrength | 0.217 | 0.060 | -0.676 | 0.120 | -40440 | -36582.231 |
| + marketBreadth | 0.228 | 0.071 | -0.657 | 0.139 | -51458 | -44500.372 |

## Candidate OOS

| Candidate | Settled | Net R | PF | Exp R | Payoff | Max DD | Positive folds |
|---|---:|---:|---:|---:|---:|---:|---:|
| p003-r1-01-trend_pullback_continuation | 6033 | -4048.092 | 0.223 | -0.671 | 0.293 | 4048.092 | 0/3 |
| p003-r1-02-breakout_retest | 1442 | -991.563 | 0.216 | -0.688 | 0.292 | 991.563 | 0/3 |
| p003-r1-03-volatility_compression_expansion | 1586 | -1301.136 | 0.156 | -0.820 | 0.253 | 1301.136 | 0/3 |
| p003-r1-04-relative_strength_continuation | 9999 | -6887.742 | 0.213 | -0.689 | 0.288 | 6887.742 | 0/3 |

- Internal Gate: **FAIL** (netRPositive, profitFactor, expectancy, payoff, positiveFolds, positiveMonths, oosScoreCalibrated, oosSpearmanPositive, oosBucketDirectionConsistent, highestGrossBucketImprovesBaseline).
- R2 freeze: 08d7d1ea9a6df244851526c32791770cd639b9cebd8c0cc5eb6f27e5a57b9f8c; Final Unseen executed=false; holdout executions=0.
- Final Model Freeze generated=false; path=reports/GPT-PROFIT-003-FINAL-MODEL-FREEZE.json; hash=none.
- Reproducibility: main 78104f72b8cbd486a9844839c3fc807cef57643a; branch f80dc4d08190a2664407ccb3896832288a28e230; parent 567ae31e403949db445cc98bf3d8902a7606e4e0; script db628ad17076bfa44d0694bb2b16fd3cfb6b51e64589ac849c2b34941030fcc9; module 75471a26a787f69d7d14248aa99dedf1f90ddeee4a9540e2b7859ae61b97a384; freeze 08d7d1ea9a6df244851526c32791770cd639b9cebd8c0cc5eb6f27e5a57b9f8c; dataset c2b482d6171596aa297133a9959c50b5faaea4655036f6f17e27c41c55dcfec9.

Research-only: Main V2 and ALT Basket remain Shadow; PRODUCTION_SIGNAL_STRATEGIES=[]; no account, position, automatic order, leverage, or private Binance API access.
