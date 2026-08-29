# GPT-PROFIT-001 — Loss Containment & Edge Gate

All returns below are **Signal Review / Hypothetical Benchmark** results. They are not account returns, positions, or trading instructions.

## Validation boundary

- Data: 2025-05-07 through 2026-08-02, 451.57 days.
- Coverage: 43,352 common closed 15-minute bars across BTC, ETH, SOL, BNB, LINK, AVAX, and DOGE.
- Data-quality audit: clean, zero common gaps, zero duplicate timestamps.
- Execution: signal inputs end at the evaluation candle; review candles start strictly after it. Same-candle stop has priority.
- Costs: 0.10% fee plus 0.05% slippage per side, shared with live Signal Review.
- Selection: fixed Main V2; ALT Basket excluded because it is contained as Shadow Only.
- Promotion: at least 30 OOS settled reviews, net PnL > 0, expectancy R > 0, PF >= 1.20, no material DD deterioration, no look-ahead bias, and no leakage.

## OOS comparison

| Candidate | Trades | Settled | Wins | Win rate | Net R | Net PnL | PF | Expectancy R | Max DD R | Positive months | Symbols | Regimes | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Main V2 baseline | 1,509 | 1,498 | 999 | 66.69% | -332.57 | -764.39% | 0.391 | -0.2220 | 335.13 | 0 | 6 | 4 | FAIL |
| Cost: no filter | 1,509 | 1,498 | 999 | 66.69% | -332.57 | -764.39% | 0.391 | -0.2220 | 335.13 | 0 | 6 | 4 | FAIL |
| Cost: >= 1.0x | 1,464 | 1,453 | 999 | 68.75% | -302.76 | -744.71% | 0.414 | -0.2084 | 305.42 | 0 | 6 | 4 | FAIL |
| Cost: >= 1.5x | 1,318 | 1,307 | 905 | 69.24% | -243.41 | -678.90% | 0.459 | -0.1862 | 246.18 | 0 | 6 | 4 | FAIL |
| Cost: >= 2.0x | 1,081 | 1,071 | 739 | 69.00% | -184.18 | -589.71% | 0.497 | -0.1720 | 186.69 | 0 | 6 | 4 | FAIL |
| Concentration: top 1 | 1,198 | 1,189 | 801 | 67.37% | -253.73 | -543.69% | 0.403 | -0.2134 | 255.26 | 0 | 6 | 4 | FAIL |
| Concentration: top 2 | 1,427 | 1,418 | 950 | 67.00% | -308.93 | -700.25% | 0.396 | -0.2179 | 311.49 | 0 | 6 | 4 | FAIL |
| Concentration: top 3 | 1,492 | 1,482 | 991 | 66.87% | -326.05 | -753.60% | 0.394 | -0.2200 | 328.62 | 0 | 6 | 4 | FAIL |

The 60-day final holdout for Main V2 also failed: 445 settled, 268 wins, -134.05R, -286.64%, PF 0.305, expectancy -0.3012R, and max DD 138.06R.

No candidate passes the Promotion Gate. The cost gates reduce losses and drawdown monotonically, but all remain economically negative. Concentration top-N also remains negative. Accordingly, none is enabled in Production; concentration remains a shadow comparison and Main V2 production parameters remain unchanged.

The full machine-readable report is `gpt-profit-001-main-v2.json` in this directory.
