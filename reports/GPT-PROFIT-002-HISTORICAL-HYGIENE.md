# GPT-PROFIT-002 historical hygiene audit

This audit is read-only. No historical row was deleted or rewritten by GPT-PROFIT-002.

## Current runtime boundary

`PRODUCTION_SIGNAL_STRATEGIES` is intentionally an empty allowlist while Main V2 and ALT Basket are Shadow Only. The runtime send path now requires both `delivery_mode = production` and an explicit version in that allowlist (`canSendRuntimeNotification`). A legacy row that still says `production` therefore cannot enter the current email send path. Shadow rows continue to be blocked by the database `reject_shadow_signal_notification` trigger.

The dashboard labels rows as `current runtime Production`, `Shadow candidate`, or `historical delivery`. Historical production-delivery rows remain visible for audit, but are excluded from current Edge Evidence.

## Supabase read-only results

Project: `jfvbikivtpfjgfsnggiz` (`crypto-alerts`)

| Check | Result |
| --- | ---: |
| Active Main V2 production rows | 0 |
| Active ALT Basket production rows | 0 |
| Active Main V2 shadow rows | 142 |
| Active ALT Basket shadow rows | 6 |
| All active production rows (legacy/unknown strategy version) | 316 |
| All production rows with `strategy_version IS NULL` | 435 |
| June 2026 queued notifications (historical) | 6 |
| Queued notifications pointing to Shadow rows | 0 |
| Superseded rows stored with `final_status=open` (archived, excluded) | 1 |
| Superseded rows eligible for active review processing | 0 |
| Benchmark snapshots | 2 |
| `reject_shadow_signal_notification` trigger | present (1) |

The 316 active production rows are legacy delivery-history records (`strategy_version IS NULL`), not current runtime-enabled strategies. They are not removed because historical auditability is required. One superseded ALT parent retains `final_status=open` as stored history, but `settleOpenSignalReviews` selects `superseded_at IS NULL`, so zero superseded rows are eligible for active processing. The six June queued rows are likewise historical queue state; current sync only creates/sends notifications for newly generated records that pass the explicit production allowlist, and the allowlist is empty.

## Query

The counts above came from a single read-only `json_build_object` query over `gpt_signals`, `gpt_signal_results`, `gpt_notifications`, `gpt_signal_benchmark_snapshots`, `gpt_signal_benchmark_drawdowns`, and `pg_trigger`, using active lifecycle statuses `planned`, `waiting_entry`, `entered`, and `setup_confirmed`.

## Safety conclusion

`PRODUCTION_SIGNAL_STRATEGIES=0` is expected. Main V2 and ALT Basket continue to generate, persist, and review as Shadow; no current strategy has permission to send Production alerts. No private Binance API, account/position read, order, leverage, or position-control path was added.
