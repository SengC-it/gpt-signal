# GPT-PROFIT-003 Feature Diagnostics

- Result: **NO ENTRY EDGE FOUND**
- Discovery boundary: 2025-05-09T23:45:00.000Z → 2026-08-02T03:15:00.000Z; cutoff 2026-08-02T03:15:00.000Z
- Entry events: 105307; features tested: 38; symbols: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, LINKUSDT, AVAXUSDT, DOGEUSDT
- Protected Final Unseen: 2026-08-02T03:30:00.000Z → 2026-08-29T23:45:00.000Z; holdout executions: 0
- Status counts: ROBUST=25, WEAK=11, UNSTABLE=1, NO_EDGE=1

## Setup-family baseline

| Family | Trades | Settled | PF | Expectancy R | Net R | Win rate | Symbols |
|---|---:|---:|---:|---:|---:|---:|---:|
| trend_pullback_continuation | 32451 | 32441 | 0.187 | -0.738 | -23951.564 | 40.597% | 6 |
| breakout_retest | 9095 | 9094 | 0.155 | -0.806 | -7328.449 | 38.223% | 6 |
| volatility_compression_expansion | 9688 | 9688 | 0.127 | -0.883 | -8556.204 | 35.528% | 6 |
| relative_strength_continuation | 54073 | 54058 | 0.188 | -0.731 | -39515.753 | 41.008% | 6 |

## Top ROBUST features

| Feature | Lift | Positive folds | Symbol breadth | Violations |
|---|---:|---:|---:|---:|
| trend_return_15m | 0.139 | 3/3 | 6 | 1 |
| trend_return_1h | 0.133 | 3/3 | 6 | 1 |
| trend_return_4h | 0.531 | 3/3 | 6 | 0 |
| trend_return_12h | 0.322 | 3/3 | 6 | 1 |
| trend_slope_short | 0.174 | 3/3 | 6 | 1 |
| trend_slope_medium | 0.353 | 3/3 | 6 | 1 |
| trend_alignment_long | 0.084 | 3/3 | 6 | 1 |
| structure_distance_rolling_low | 0.748 | 3/3 | 6 | 0 |
| atr_pct | 0.988 | 3/3 | 6 | 0 |
| atr_percentile | 0.451 | 3/3 | 6 | 0 |
| recent_range_atr | 0.012 | 3/3 | 6 | 2 |
| compression_ratio | 0.246 | 3/3 | 6 | 0 |

## NO_EDGE / UNSTABLE / WEAK features

- **WEAK** structure_distance_rolling_high: lift 0.322, folds 3/3, symbols 6.
- **UNSTABLE** breakout_distance_atr: lift -0.004, folds 1/3, symbols 6.
- **WEAK** pullback_depth_atr: lift 0.149, folds 3/3, symbols 6.
- **WEAK** retracement_ratio: lift 0.139, folds 3/3, symbols 6.
- **WEAK** structure_age: lift 0.153, folds 3/3, symbols 6.
- **WEAK** expansion_ratio: lift 0.110, folds 3/3, symbols 6.
- **WEAK** lower_wick_ratio: lift 0.004, folds 2/3, symbols 6.
- **WEAK** close_location_value: lift 0.021, folds 3/3, symbols 6.
- **WEAK** volume_ratio: lift 0.090, folds 3/3, symbols 6.
- **WEAK** quote_volume_ratio: lift 0.089, folds 3/3, symbols 6.
- **WEAK** volume_expansion: lift 0.161, folds 3/3, symbols 6.
- **WEAK** breadth_bullish_pct: lift 0.056, folds 3/3, symbols 6.
- **NO_EDGE** estimated_round_trip_cost_pct: lift 0.000, folds 0/3, symbols 6.

## Ablation

| Step | Features | PF | Δ PF | Expectancy R | Δ Exp | Trades | Δ DD |
|---|---|---:|---:|---:|---:|---:|---:|
| Base setup | — | 0.156 | 0.000 | -0.797 | 0.000 | 77156 | 0.000 |
| + trend | trend_return_4h | 0.162 | 0.005 | -0.786 | 0.011 | 68263 | -7809.690 |
| + structure | structure_distance_rolling_low | 0.157 | 0.000 | -0.796 | 0.000 | 77014 | -126.570 |
| + volatility | atr_pct, atr_percentile | 0.156 | 0.000 | -0.797 | 0.000 | 77156 | 0.000 |
| + volume | — | 0.156 | 0.000 | -0.797 | 0.000 | 77156 | 0.000 |
| + relativeStrength | relative_strength_4h | 0.156 | 0.000 | -0.797 | 0.000 | 77156 | 0.000 |
| + marketBreadth | btc_volatility_state | 0.156 | 0.000 | -0.797 | 0.000 | 77156 | 0.000 |

## Entry Edge Score

- Status: **CALIBRATED**
- Selected features: atr_pct, sl_distance_pct, cost_coverage_ratio, structure_distance_rolling_low, btc_volatility_state, trend_return_4h, relative_strength_4h, atr_percentile
- Spearman: 0.485; monotonic violations: 0

| Decile | Trades | Settled | Win rate | PF | Expectancy R | Avg win | Avg loss | Payoff |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7715 | 7715 | 1.737% | 0.001 | -1.607 | 0.058 | 1.636 | 0.036 |
| 2 | 7716 | 7716 | 12.131% | 0.009 | -1.171 | 0.088 | 1.345 | 0.065 |
| 3 | 7715 | 7715 | 30.123% | 0.036 | -0.991 | 0.123 | 1.472 | 0.083 |
| 4 | 7716 | 7716 | 42.665% | 0.081 | -0.873 | 0.180 | 1.657 | 0.109 |
| 5 | 7715 | 7714 | 48.393% | 0.136 | -0.761 | 0.248 | 1.708 | 0.145 |
| 6 | 7716 | 7711 | 50.240% | 0.198 | -0.666 | 0.327 | 1.669 | 0.196 |
| 7 | 7716 | 7714 | 49.080% | 0.244 | -0.615 | 0.403 | 1.596 | 0.253 |
| 8 | 7715 | 7713 | 48.866% | 0.306 | -0.538 | 0.486 | 1.516 | 0.320 |
| 9 | 7716 | 7714 | 49.287% | 0.391 | -0.441 | 0.574 | 1.428 | 0.402 |
| 10 | 7716 | 7702 | 50.078% | 0.538 | -0.300 | 0.698 | 1.301 | 0.536 |

## Walk-forward / gate

- Candidate count: 4; Internal Gate: **FAIL** (netRPositive, profitFactor, expectancy, payoff, positiveFolds, positiveMonths).
- Final Unseen: executed=false; status=NO_CANDIDATE_FOR_FINAL_HOLDOUT; holdout executions=0.
- Reproducibility: base 78104f72b8cbd486a9844839c3fc807cef57643a; source 8cab611705578bf364dea22c3f7765af0d38ed02; script 90ce4454b9c8b58c4652c6faa65261842c9e774dc9c86e40b87fc444c992d2c6; module c818edc93add0d8a8459149634d76252fc8a46ab145be695a922e18787e03b29; freeze 27a1bfb88b420cdecb9478cd4bb6794bce4d0780387db1612011c12135887137; dataset c2b482d6171596aa297133a9959c50b5faaea4655036f6f17e27c41c55dcfec9.

Research-only boundary: Main V2 and ALT Basket remain Shadow; `PRODUCTION_SIGNAL_STRATEGIES=[]`; no automatic trading or private Binance API.
