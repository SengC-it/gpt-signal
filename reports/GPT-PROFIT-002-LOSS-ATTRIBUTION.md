# GPT-PROFIT-002 Loss Attribution

Discovery cutoff: 2026-08-02T03:15:00.000Z. Holdout is strictly after this timestamp and is excluded from this report's attribution and selection.

## Method

Main V2 is simulated with runtime opportunity-id and level/lifecycle dedupe, previous-closed-candle review ordering, same-symbol concurrent opportunities, closed-candle TP/SL with stop priority, 0.10% fee and 0.05% slippage per side. The baseline is discovery-only.

Baseline trades=13428, settled=13419, Net R=-2715.6867, PF=0.4356, expectancy=-0.2024R, max DD=2727.6111R.

Parity conclusion: this corrected runtime-lifecycle simulator leaves Main V2 decisively below PF 1 and zero expectancy; it does not change the previously accepted Main V2 FAIL conclusion. The discovery-only figures above are not used to promote any strategy.

For continuity, the accepted GPT-PROFIT-001-R1 parity reference remains full OOS 4,365 settled / -952.65R / PF 0.400 / -0.218R expectancy and final 60d holdout 1,398 settled / -369.23R / PF 0.341 / -0.264R expectancy.

## Five key findings

- symbol=AVAXUSDT is the largest negative Net R slice (-522.4427R, 2632 settled).
- direction=LONG is the largest negative Net R slice (-1526.1086R, 6657 settled).
- btcRegime=bear is the largest negative Net R slice (-1216.5387R, 5993 settled).
- scoreBand=86-89 is the largest negative Net R slice (-2703.1852R, 13253 settled).
- holdingDuration=4-24h is the largest negative Net R slice (-1752.0808R, 5104 settled).

## Attribution tables

### symbol

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ETHUSDT | 1897 | 1896 | -332.0804 | 0.4785 | -0.1751 | 335.1211 |
| SOLUSDT | 2290 | 2289 | -435.2374 | 0.4564 | -0.1901 | 435.7852 |
| BNBUSDT | 1577 | 1576 | -448.0606 | 0.2946 | -0.2843 | 449.023 |
| LINKUSDT | 2354 | 2352 | -480.0782 | 0.4397 | -0.2041 | 482.6088 |
| DOGEUSDT | 2675 | 2674 | -497.7875 | 0.4674 | -0.1862 | 503.625 |
| AVAXUSDT | 2635 | 2632 | -522.4427 | 0.4487 | -0.1985 | 526.1389 |

### direction

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SHORT | 6764 | 6762 | -1189.5781 | 0.4795 | -0.1759 | 1189.5781 |
| LONG | 6664 | 6657 | -1526.1086 | 0.3959 | -0.2292 | 1542.276 |

### btcRegime

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| unknown | 387 | 387 | -67.4403 | 0.4981 | -0.1743 | 79.5983 |
| sideways | 1925 | 1925 | -405.2686 | 0.4168 | -0.2105 | 407.9118 |
| bull | 5114 | 5114 | -1026.4391 | 0.4315 | -0.2007 | 1026.6288 |
| bear | 6002 | 5993 | -1216.5387 | 0.4411 | -0.203 | 1220.3038 |

### marketRegime

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| unknown_trend | 126 | 126 | -21.3289 | 0.5224 | -0.1693 | 29.6819 |
| unknown_expansion | 261 | 261 | -46.1114 | 0.4861 | -0.1767 | 49.9164 |
| bull_trend | 1293 | 1293 | -231.5014 | 0.4897 | -0.179 | 232.0603 |
| bear_trend | 1525 | 1523 | -273.0871 | 0.4972 | -0.1793 | 278.731 |
| bull_expansion | 4862 | 4862 | -998.9647 | 0.4176 | -0.2055 | 1000.9585 |
| bear_expansion | 5361 | 5354 | -1144.6931 | 0.4176 | -0.2138 | 1146.5154 |

### scoreBand

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 90+ | 166 | 166 | -12.5015 | 0.7482 | -0.0753 | 14.3047 |
| 86-89 | 13262 | 13253 | -2703.1852 | 0.4324 | -0.204 | 2714.9049 |

### relativeStrengthBand

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| <=-4% | 165 | 165 | -24.4038 | 0.5848 | -0.1479 | 24.4038 |
| >=4% | 440 | 440 | -40.8597 | 0.7 | -0.0929 | 52.09 |
| (-4,-2)% | 1050 | 1048 | -82.6103 | 0.7289 | -0.0788 | 84.3209 |
| [2,4)% | 1270 | 1270 | -255.5124 | 0.4721 | -0.2012 | 261.8472 |
| [-2,0)% | 5532 | 5532 | -1073.3085 | 0.437 | -0.194 | 1073.3085 |
| [0,2)% | 4971 | 4964 | -1238.9921 | 0.3552 | -0.2496 | 1245.3756 |

### trendAlignment

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| aligned | 7796 | 7787 | -1335.3646 | 0.4965 | -0.1715 | 1346.0667 |
| mixed | 5632 | 5632 | -1380.3221 | 0.3608 | -0.2451 | 1381.5444 |

### volatilityBand

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.75-1.24 ATR | 10 | 10 | -9.5522 | 0.0092 | -0.9552 | 9.6413 |
| 1.25-1.99 ATR | 161 | 161 | -94.769 | 0.0606 | -0.5886 | 95.0764 |
| 2+ ATR | 13257 | 13248 | -2611.3655 | 0.4445 | -0.1971 | 2623.2899 |

### costCoverageBand

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| <1x | 249 | 249 | -167.4517 | 0 | -0.6725 | 167.4517 |
| 1-1.49x | 820 | 820 | -314.4542 | 0.1141 | -0.3835 | 314.6792 |
| 1.5-1.99x | 1429 | 1429 | -369.8324 | 0.288 | -0.2588 | 371.8644 |
| 2x+ | 10930 | 10921 | -1863.9483 | 0.5056 | -0.1707 | 1875.2209 |

### slAtrRatioBand

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.75-1.24 ATR | 10 | 10 | -9.5522 | 0.0092 | -0.9552 | 9.6413 |
| 1.25-1.99 ATR | 161 | 161 | -94.769 | 0.0606 | -0.5886 | 95.0764 |
| 2+ ATR | 13257 | 13248 | -2611.3655 | 0.4445 | -0.1971 | 2623.2899 |

### entryStructure

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pullback_limit | 13428 | 13419 | -2715.6867 | 0.4356 | -0.2024 | 2727.6111 |

### holdingDuration

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| >48h | 427 | 426 | -157.791 | 0.2902 | -0.3704 | 158.0823 |
| 24-48h | 741 | 741 | -295.3088 | 0.2593 | -0.3985 | 295.8611 |
| <=4h | 7154 | 7148 | -510.5061 | 0.704 | -0.0714 | 534.5324 |
| 4-24h | 5106 | 5104 | -1752.0808 | 0.2895 | -0.3433 | 1754.4673 |

### repeatedOpportunity

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| second | 3128 | 3127 | -597.6568 | 0.4546 | -0.1911 | 600.9712 |
| third_plus | 4222 | 4217 | -661.0451 | 0.5397 | -0.1568 | 671.8509 |
| first | 6078 | 6075 | -1456.9848 | 0.3609 | -0.2398 | 1458.2506 |

### month

| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-08 | 36 | 28 | -7.0986 | 0.3195 | -0.2535 | 8.16 |
| 2026-02 | 872 | 872 | -132.4214 | 0.5317 | -0.1519 | 142.548 |
| 2026-03 | 691 | 691 | -135.2493 | 0.4448 | -0.1957 | 135.565 |
| 2025-05 | 912 | 912 | -141.573 | 0.5265 | -0.1552 | 163.4116 |
| 2026-01 | 795 | 795 | -160.2468 | 0.4214 | -0.2016 | 186.0901 |
| 2026-04 | 612 | 612 | -162.9973 | 0.3274 | -0.2663 | 164.2776 |
| 2026-07 | 641 | 640 | -173.15 | 0.3144 | -0.2705 | 174.0141 |
| 2026-05 | 701 | 701 | -185.5694 | 0.322 | -0.2647 | 187.5317 |
| 2025-07 | 1245 | 1245 | -188.192 | 0.5319 | -0.1512 | 198.8472 |
| 2025-11 | 973 | 973 | -189.5794 | 0.462 | -0.1948 | 191.5817 |
| 2026-06 | 800 | 800 | -192.3117 | 0.382 | -0.2404 | 195.7441 |
| 2025-06 | 890 | 890 | -199.9358 | 0.4083 | -0.2246 | 201.2861 |
| 2025-09 | 1030 | 1030 | -203.243 | 0.4383 | -0.1973 | 206.6394 |
| 2025-08 | 1280 | 1280 | -209.7949 | 0.5062 | -0.1639 | 219.8113 |
| 2025-12 | 783 | 783 | -214.1942 | 0.3386 | -0.2736 | 227.1698 |
| 2025-10 | 1167 | 1167 | -220.13 | 0.4712 | -0.1886 | 224.5999 |


## MFE / MAE

Hit-SL MFE thresholds: {"mfe_gte_0.25R":17.987303080178698,"mfe_gte_0.5R":0.1881025158711498,"mfe_gte_0.75R":0.14107688690336231,"mfe_gte_1R":0.07053844345168116}.

Winner distributions: {"mae":{"count":9021,"p25":0.15743020690096668,"median":0.28664960126021544,"p75":0.5059430788773549,"mean":0.3543982089834845},"mfe":{"count":9021,"p25":0.3841961896252325,"median":0.4355515322794298,"p75":0.5393306851719176,"mean":0.5038854906682076},"durationCandles":{"count":9021,"p25":4,"median":10,"p75":30,"mean":35.016849573218046}}.

Decision: BAD_ENTRY_OR_SETUP_SELECTION_MORE_LIKELY. This is an attribution heuristic, not a causal claim; early-invalidation and time-stop candidates are compared separately.

Score calibration status: SCORE_NOT_CALIBRATED. Deciles are descriptive; no minimum-score optimization was performed.

Repeated signal attribution: {"windows":[{"hours":1,"groups":{"third_plus":{"trades":2697,"settledTrades":2692,"openTrades":5,"waitingEntryTrades":0,"entryFillRate":100,"executionRate":99.81460882461994,"winRate":68.12778603268946,"wins":1834,"losses":858,"netPnlPct":-1768.5909440000023,"netR":-424.5230750000009,"profitFactor":0.5397376576776993,"expectancyR":-0.15769802191679083,"averageWinR":0.2714433751363136,"averageLossR":1.0750002622377626,"payoffRatio":0.2525054036463828,"breakevenWinRate":79.83997490858953,"maxDrawdownR":432.33707100000095,"positiveMonths":0,"symbolBreadth":6,"regimeBreadth":4,"largestSingleTradeContributionPct":0.06892030697803457,"largestSingleSymbolContributionPct":0},"second":{"trades":2762,"settledTrades":2761,"openTrades":1,"waitingEntryTrades":0,"entryFillRate":100,"executionRate":99.9637943519189,"winRate":67.83773994929373,"wins":1873,"losses":888,"netPnlPct":-1436.7026320000045,"netR":-522.3053140000002,"profitFactor":0.4635963199540857,"expectancyR":-0.18917251503078603,"averageWinR":0.2410099087026161,"averageLossR":1.0965280101351356,"payoffRatio":0.2197936637048735,"breakevenWinRate":81.98107841966524,"maxDrawdownR":526.1056540000001,"positiveMonths":1,"symbolBreadth":6,"regimeBreadth":4,"largestSingleTradeContributionPct":0.07663007140674483,"largestSingleSymbolContributionPct":0},"first":{"trades":7969,"settledTrades":7966,"openTrades":3,"waitingEntryTrades":0,"entryFillRate":100,"executionRate":99.96235412222362,"winRate":66.70851117248306,"wins":5314,"losses":2652,"netPnlPct":-3985.7969879999864,"netR":-1768.858316999999,"profitFactor":0.39332885908453963,"expectancyR":-0.22205100640220926,"averageWinR":0.2158111972149038,"averageLossR":1.0994264777526388,"payoffRatio":0.1962943421701541,"breakevenWinRate":83.59146781434545,"maxDrawdownR":1771.0469249999992,"positiveMonths":0,"symbolBreadth":6,"regimeBreadth":4,"largestSingleTradeContributionPct":0.028857518827733925,"largestSingleSymbolContributionPct":0}}},{"hours":4,"groups":{"second":{"trades":3128,"settledTrades":3127,"openTrades":1,"waitingEntryTrades":0,"entryFillRate":100,"executionRate":99.96803069053708,"winRate":68.1483850335785,"wins":2131,"losses":996,"netPnlPct":-1527.179908000004,"netR":-597.6567960000015,"profitFactor":0.45458056694035726,"expectancyR":-0.19112785289414821,"averageWinR":0.23374841295166562,"averageLossR":1.1001753654618471,"payoffRatio":0.21246468543997932,"breakevenWinRate":82.4766289697848,"maxDrawdownR":600.9711870000015,"positiveMonths":0,"symbolBreadth":6,"regimeBreadth":4,"largestSingleTradeContributionPct":0.0694448085929735,"largestSingleSymbolContributionPct":0},"third_plus":{"trades":4222,"settledTrades":4217,"openTrades":5,"waitingEntryTrades":0,"entryFillRate":100,"executionRate":99.88157271435338,"winRate":68.48470476642163,"wins":2888,"losses":1329,"netPnlPct":-2602.6614040000118,"netR":-661.0451450000006,"profitFactor":0.5397213802656018,"expectancyR":-0.15675720773061433,"averageWinR":0.26840014819944585,"averageLossR":1.080650694507148,"payoffRatio":0.2483690146720861,"breakevenWinRate":80.10451943672071,"maxDrawdownR":671.8508810000006,"positiveMonths":1,"symbolBreadth":6,"regimeBreadth":4,"largestSingleTradeContributionPct":0.04426350912870631,"largestSingleSymbolContributionPct":0},"first":{"trades":6078,"settledTrades":6075,"openTrades":3,"waitingEntryTrades":0,"entryFillRate":100,"executionRate":99.95064165844028,"winRate":65.87654320987654,"wins":4002,"losses":2073,"netPnlPct":-3061.2492519999987,"netR":-1456.9847650000036,"profitFactor":0.36091180030931713,"expectancyR":-0.23983288312757262,"averageWinR":0.20559767991004524,"averageLossR":1.0997523781958514,"payoffRatio":0.18694906597731495,"breakevenWinRate":84.24961345553744,"maxDrawdownR":1458.2506050000036,"positiveMonths":0,"symbolBreadth":6,"regimeBreadth":4,"largestSingleTradeContributionPct":0.039330365437955934,"largestSingleSymbolContributionPct":0}}}],"clusterRule":"same symbol + direction + signalType/opportunity family, consecutive signal timestamps within the window; first/second/third+ labels","noHoldoutDecisions":true}.
