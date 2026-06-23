# GPT Signal SaaS Design

## Goal

Build the first production-oriented GPT Signal SaaS version: a Vercel-ready Next.js admin app backed by Supabase, focused on discovering crypto futures opportunities, generating risk-aware signal plans, tracking lifecycle states, and preserving enough data for review and later strategy hardening.

## Assumptions

- The first exchange is Binance USD-M Futures public market data.
- The system does not place orders, read account balances, or require trading API keys.
- Supabase and Vercel credentials may not be available during local implementation, so the repository must include `.env.example`, database SQL, and a local development path.
- The first implementation favors a small, verifiable strategy engine over a broad but unverified strategy catalog.
- User-facing copy is Chinese-first because the requirement document and operator workflow are Chinese.

## Product Shape

The first screen is an operator dashboard, not a marketing page. The UI should feel like a professional trading operations console: dark, dense, table-driven, and optimized for scanning.

Core screens:

- Dashboard: BTC state, market regime, strategy status, today signal counts, circuit breaker status, latest signals, data quality warnings.
- Opportunity Radar: dynamic symbol pool, relative strength, volume anomaly, funding/OI placeholders, ATR state, liquidity score, pool reason.
- Signals: list by symbol, direction, level, lifecycle, score, entry zone, SL/TP, RR, and result.
- Signal Detail: reasons, invalidation rules, no-chase rule, lifecycle events, notification records, and review metrics.
- Backtest: choose strategy, symbols, range, cost model, run a conservative historical simulation, and show core metrics.
- Risk Controls: current thresholds, cooldowns, circuit breaker rules, recent signal performance.
- Settings: notification recipient placeholders, watched symbols, strategy parameters, and system health.

## Architecture

Use Next.js App Router with Route Handlers for server APIs and Server Components for read-heavy pages. Interactive controls live in client components under small islands.

Use Supabase Postgres as the production data store. Database clients must be initialized lazily in server-only helpers so builds do not crash when environment variables are absent. Tables in the public schema should have RLS enabled. Early policies can be conservative: authenticated users can read and write operational data; anonymous users cannot access tables.

Use Binance public REST from server-side jobs/API routes. A manual "sync now" action and a cron-compatible route will fetch exchange rules, candles, ticker-like metrics, and derive opportunities/signals. WebSocket ingestion is out of scope for this first production version.

## Data Model

Implement SQL for these tables:

- `symbols`
- `candles`
- `market_metrics`
- `opportunities`
- `signals`
- `signal_results`
- `strategy_versions`
- `backtest_runs`
- `notifications`
- `system_events`

Use JSONB for reasons, invalidation rules, parameters, and result summaries where the requirements call for evolving strategy details.

## Strategy Engine V1

Implement a conservative MVP engine:

- Data quality score from candle completeness, closed candle status, and recency.
- BTC market state from 1h/4h trend and ATR state.
- Relative strength versus BTC for 15m/1h/24h windows when data exists.
- Volume anomaly using current 15m quote volume versus recent average.
- ATR and structure levels from recent candles.
- Signal scoring on a 100-point model using the requirement document's weights as the public contract, with simplified internal calculations.
- Supported signal types:
  - trend pullback
  - volume breakout
  - risk anomaly
- Supported levels:
  - S: score >= 88
  - A: score 78-87
  - B: score 65-77
  - C: score 50-64
- Trading plan generation only for A/S when data quality is at least 90, weighted RR passes threshold, price is within the entry/no-chase boundary, and no circuit breaker blocks the signal.

## Notifications

Persist notification records and render email-ready Chinese templates. Actual email sending is behind an environment-controlled adapter and can be disabled locally. This avoids leaking secrets and keeps the first version safe.

## Backtesting V1

Backtesting must avoid future-looking behavior:

- Signals are evaluated only on closed candles.
- Entry is simulated from later candles.
- When TP and SL are both touched in one candle, SL wins.
- Costs include configurable round-trip fee and slippage.
- Results include trade count, win rate, avg R, profit factor, max drawdown, max losing streak, entry fill rate, no-chase rate, and execution rate.

## Security

- No service-role key in client code.
- Public `NEXT_PUBLIC_` variables are limited to Supabase URL and publishable anon key.
- Supabase server writes use server-only environment variables.
- RLS is enabled for exposed public tables.
- Admin actions are recorded in `system_events`.
- System failure defaults to not generating trade-plan signals.

## Success Criteria

- `npm run build` succeeds.
- Core engine unit tests pass.
- Database SQL can be applied to Supabase.
- The app can run locally with configured env vars.
- Dashboard and signal pages render seeded/sample data even before live cron is configured.
- The sync API can fetch Binance public candles and generate at least one persisted opportunity or a clear "no qualified signal" event.

