# GPT Signal SaaS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-oriented GPT Signal SaaS foundation with Next.js, Supabase schema, Binance market sync, signal generation, notification records, and a conservative backtest flow.

**Architecture:** Next.js App Router serves the admin UI and route handlers. Supabase Postgres stores operational data, with SQL migrations in the repo and lazy server-side clients. The strategy engine is pure TypeScript so it can be unit-tested without Supabase or Binance.

**Tech Stack:** Next.js, React, TypeScript, Supabase JS, Vitest, Tailwind CSS, lucide-react, Binance USD-M Futures public REST.

---

## File Structure

- `package.json`: scripts and dependencies.
- `src/app`: App Router pages and API routes.
- `src/components`: reusable app shell, tables, metric cards, badges, forms.
- `src/lib/signal`: pure strategy, indicators, scoring, lifecycle, backtest helpers.
- `src/lib/binance`: Binance REST client and response normalization.
- `src/lib/supabase`: lazy server/browser Supabase clients.
- `src/lib/notifications`: email template and notification persistence helpers.
- `src/lib/sample-data`: fallback data for empty local environments.
- `supabase/migrations`: production SQL schema and RLS policies.
- `tests`: Vitest unit tests for pure signal and backtest behavior.

## Tasks

### Task 1: Scaffold App And Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `.env.example`

- [ ] Create a Next.js App Router project in place without deleting the requirement docs.
- [ ] Add scripts: `dev`, `build`, `start`, `test`, `lint`, `typecheck`.
- [ ] Install runtime dependencies and dev dependencies.
- [ ] Verify `npm run typecheck` starts and reports only expected missing implementation errors if run before later tasks.

### Task 2: Supabase Schema

**Files:**
- Create: `supabase/migrations/202606230001_initial_schema.sql`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/browser.ts`
- Create: `src/lib/database.types.ts`

- [ ] Write SQL tables from the design document.
- [ ] Enable RLS on public tables.
- [ ] Add authenticated read/write policies and no anonymous table policies.
- [ ] Add useful indexes for symbol/time/status lookups.
- [ ] Add lazy Supabase client helpers.

### Task 3: Signal Engine With Tests

**Files:**
- Create: `src/lib/signal/types.ts`
- Create: `src/lib/signal/indicators.ts`
- Create: `src/lib/signal/scoring.ts`
- Create: `src/lib/signal/engine.ts`
- Create: `tests/signal-engine.test.ts`

- [ ] Write failing tests for ATR, relative strength, data quality, no-chase, and A/S plan eligibility.
- [ ] Implement the smallest pure functions needed to pass.
- [ ] Keep Funding/OI as nullable scoring inputs rather than fake live data.
- [ ] Run `npm test -- tests/signal-engine.test.ts`.

### Task 4: Binance Sync

**Files:**
- Create: `src/lib/binance/client.ts`
- Create: `src/lib/binance/normalize.ts`
- Create: `src/app/api/jobs/sync-market/route.ts`

- [ ] Fetch klines for configured symbols and intervals from Binance USD-M Futures.
- [ ] Normalize REST arrays into typed candle objects.
- [ ] Run the pure signal engine on closed candles.
- [ ] Persist candles, opportunities, signals, notifications, and system events when Supabase env is configured.
- [ ] Return a clear JSON status when env vars are missing.

### Task 5: Admin UI

**Files:**
- Create: `src/components/app-shell.tsx`
- Create: `src/components/metric-card.tsx`
- Create: `src/components/status-badge.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/radar/page.tsx`
- Create: `src/app/signals/page.tsx`
- Create: `src/app/signals/[id]/page.tsx`
- Create: `src/app/backtests/page.tsx`
- Create: `src/app/risk/page.tsx`
- Create: `src/app/settings/page.tsx`

- [ ] Build a dark, dense, Chinese-first operator interface.
- [ ] Use sample data when Supabase is not configured or tables are empty.
- [ ] Avoid nested card layouts; use table-heavy operational views.
- [ ] Add action buttons for sync and backtest route calls.

### Task 6: Notifications And Backtest

**Files:**
- Create: `src/lib/notifications/templates.ts`
- Create: `src/lib/signal/backtest.ts`
- Create: `src/app/api/backtests/run/route.ts`
- Create: `tests/backtest.test.ts`

- [ ] Write failing tests for conservative TP/SL collision behavior and cost-adjusted final R.
- [ ] Implement notification subject/body templates from the requirement document.
- [ ] Implement conservative backtest metrics.
- [ ] Persist backtest summaries when Supabase is configured.

### Task 7: Verification And Deployment Readiness

**Files:**
- Create: `README.md`
- Create: `vercel.json`

- [ ] Document local setup, Supabase setup, Binance public data behavior, and Vercel env vars.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start local dev server and verify the dashboard loads.

## Self-Review

- The plan covers scaffolding, schema, core engine, Binance sync, UI, notifications, backtest, and verification.
- Full WebSocket ingestion, multi-exchange support, real SMTP/Gmail sending, and auto trading are intentionally excluded from this first production build.
- There are no placeholder implementation tasks; deferred items are explicitly out of scope.

