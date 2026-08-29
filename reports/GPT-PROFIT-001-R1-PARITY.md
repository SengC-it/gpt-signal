# GPT-PROFIT-001-R1 — Backtest ↔ Runtime Parity Audit

Date: 2026-08-30

Strategy under audit: fixed Main V2 (`v2`)

Decision scope: Signal Analysis / Shadow / Review / Validation only

## Result

Main V2 remains **FAIL** and **Shadow Only**. The parity correction materially increases the number of concurrent signals represented by the simulator, but it does not change the profitability conclusion: full OOS and the final 60-day holdout both retain `PF < 1` and negative expectancy.

The corrected machine-readable run is `reports/gpt-profit-001-main-v2-parity.json`. It used 43,352 common closed 15-minute bars covering 451.57 days, with fixed V2 parameters and no ALT candidate.

## Parity method

The audit traced the scheduled runtime path in `src/app/api/jobs/sync-market/route.ts` through signal generation, persistence dedupe, review settlement, and notification eligibility, then compared it field-by-field with `scripts/walk-forward-validation.mjs`.

| Concern | Runtime behavior | Corrected simulator behavior |
| --- | --- | --- |
| Direction | Current close versus the close ten 15m bars earlier | Same calculation |
| Signal level / plan | Shared `evaluateSignalCandidate` and fixed V2 config | Same engine and unchanged V2 config |
| Lifecycle | Persisted signal lifecycle is advanced by review settlement | Simulated latest opportunity lifecycle is advanced with the shared review engine |
| Opportunity dedupe | `symbol + direction + signalType + marketRegime + strategyVersion + 15m`, then compare latest level and lifecycle | Shared `mainOpportunityId` and `shouldCreateRuntimeSignal` helpers |
| Same-symbol open handling | Concurrent signals are allowed when opportunity identity differs or latest lifecycle differs | Concurrent signals allowed; the old per-symbol serialization was removed |
| Market regime | Closed BTC 4h candles through the evaluation time | Same closed-candle boundary and regime resolver |
| Entry / TP / SL | Generated plan persisted unchanged into review | Same generated plan passed to review |
| Same-candle priority | Stop first because OHLC ordering is unknown | Same shared `sameCandlePriority = stop` policy |
| Fees / slippage | 0.10% fee and 0.05% slippage per side | Same review rates on every simulated outcome |
| Signal cooldown | No additional runtime cooldown | Removed simulator-only optional cooldown |
| No-chase | Shared engine eligibility and plan rules | Same engine; no independent simulator override |
| Candle timing | Generate/dedupe first, then current sync settles reviews; a new signal cannot review its evaluation candle | Lifecycle at decision time includes only prior completed syncs; review starts on a later closed candle |

## Differences found and remediated

1. `nextAvailable[symbol]` forced a symbol to wait until its previous simulated trade exited. Production runtime has no equivalent same-symbol lock. This suppressed concurrent signals and understated signal count. The serializer was removed.
2. The simulator used a local `lastSignalKeys[symbol]` shortcut. Runtime dedupes the latest persisted signal within a full opportunity identity and compares `level + lifecycle_status`. Both paths now share the identity/dedupe primitives.
3. The simulator exposed an optional signal cooldown that Production does not apply. It was removed from Main parity simulation.
4. Candle chronology required an explicit ordering correction: runtime dedupe sees lifecycle through the previous completed sync because review settlement occurs after generation. The simulator now follows that ordering and never lets the evaluation candle settle the new signal.
5. Direction, score/level, regime, plan, TP/SL, conservative same-candle handling, no-chase, fee, and slippage already used shared production logic and required no parameter changes.

## Fixed Main V2 results

### Full OOS

| Metric | Before parity correction | After parity correction |
| --- | ---: | ---: |
| Settled | 1,498 | 4,365 |
| Net R | -332.57R | -952.65R |
| Profit Factor | 0.391 | 0.400 |
| Expectancy | -0.222R | -0.218R |
| Max drawdown | 335.13R | 958.60R |

### Final 60-day holdout

| Metric | Before parity correction | After parity correction |
| --- | ---: | ---: |
| Settled | 445 | 1,398 |
| Net R | -134.05R | -369.23R |
| Profit Factor | 0.305 | 0.341 |
| Expectancy | -0.301R | -0.264R |
| Max drawdown | 138.06R | 382.08R |

The increased count is expected: the corrected simulator now represents Production runtime's concurrent lifecycle semantics instead of serializing each symbol. The modest PF/expectancy movement does not approach profitability.

## Acceptance conclusion

- Main V2 FAIL conclusion: **unchanged**.
- Main V2 delivery: **Shadow Only**.
- ALT Basket delivery: **Shadow Only**.
- Production strategies enabled by this remediation: **none**.
- Short-term online profitability: not used to override long-horizon OOS evidence.
- Automatic trading, private Binance trading APIs, real-account reads, position control, leverage, merge, and Production deployment: outside scope and not performed.
