alter table public.gpt_signals
  add column if not exists gross_tp1_return_pct numeric,
  add column if not exists estimated_round_trip_cost_pct numeric,
  add column if not exists estimated_net_tp1_return_pct numeric,
  add column if not exists cost_coverage_ratio numeric,
  add column if not exists superseded_at timestamptz;

alter table public.gpt_signal_results
  add column if not exists signal_type text,
  add column if not exists market_regime text,
  add column if not exists current_review_price numeric,
  add column if not exists unrealized_gross_pnl_pct numeric,
  add column if not exists unrealized_net_pnl_pct numeric,
  add column if not exists current_r numeric,
  add column if not exists superseded_at timestamptz;

create table if not exists public.gpt_signal_benchmark_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  delivery_mode text not null check (delivery_mode in ('production', 'shadow')),
  realized_component numeric not null,
  unrealized_mtm_component numeric not null,
  benchmark_equity numeric not null,
  open_reviews integer not null check (open_reviews >= 0),
  source_candle_time timestamptz
);

alter table public.gpt_signal_benchmark_snapshots enable row level security;
revoke all on table public.gpt_signal_benchmark_snapshots from anon, authenticated;
grant select, insert on table public.gpt_signal_benchmark_snapshots to service_role;

update public.gpt_signal_results result
set signal_type = coalesce(result.signal_type, signal.signal_type),
    market_regime = coalesce(result.market_regime, signal.market_regime)
from public.gpt_signals signal
where signal.id = result.signal_id
  and (result.signal_type is null or result.market_regime is null);

-- Defensive normalization for databases where the earlier draft backfill ran
-- before its superseded semantics were corrected.
update public.gpt_signals
set delivery_mode = 'shadow',
    lifecycle_status = 'archived',
    superseded_at = coalesce(superseded_at, now()),
    updated_at = now()
where symbol = 'ALT_SHORT_BASKET'
  and signal_type = 'alt_basket_short';

update public.gpt_signal_results result
set delivery_mode = 'shadow',
    completed_at = case
      when result.final_status in ('open', 'waiting_entry') then null
      else result.completed_at
    end,
    superseded_at = coalesce(result.superseded_at, now()),
    updated_at = now()
from public.gpt_signals signal
where signal.id = result.signal_id
  and signal.symbol = 'ALT_SHORT_BASKET'
  and signal.signal_type = 'alt_basket_short';

-- Existing rows remain auditable. Only active strategy rows are reclassified;
-- Main V2 and ALT Basket continue to generate/review as Shadow Only.
update public.gpt_signals
set delivery_mode = 'shadow',
    updated_at = now()
where signal_type = 'alt_basket_short'
  and delivery_mode = 'production'
  and lifecycle_status in ('planned', 'waiting_entry', 'entered', 'setup_confirmed');

update public.gpt_signals
set delivery_mode = 'shadow',
    updated_at = now()
where signal_type = 'trend_pullback'
  and strategy_version = 'v2'
  and delivery_mode = 'production'
  and lifecycle_status in ('planned', 'waiting_entry', 'entered', 'setup_confirmed');

update public.gpt_notifications notification
set status = 'failed',
    error_message = 'Cancelled by GPT-PROFIT-001-R1: Shadow signals cannot notify'
from public.gpt_signals signal
where signal.id = notification.signal_id
  and signal.delivery_mode = 'shadow'
  and notification.status = 'queued';

update public.gpt_signal_results result
set delivery_mode = 'shadow',
    updated_at = now()
from public.gpt_signals signal
where signal.id = result.signal_id
  and signal.delivery_mode = 'shadow'
  and result.completed_at is null;

create or replace function public.reject_shadow_signal_notification()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.gpt_signals signal
    where signal.id = new.signal_id
      and signal.delivery_mode = 'shadow'
  ) then
    raise exception 'Shadow signal cannot create a production notification';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_shadow_signal_notification on public.gpt_notifications;
create trigger reject_shadow_signal_notification
before insert or update on public.gpt_notifications
for each row execute function public.reject_shadow_signal_notification();

create index if not exists signal_results_edge_dimensions_idx
  on public.gpt_signal_results(strategy_version, signal_type, symbol, direction, market_regime)
  where superseded_at is null;

create index if not exists signal_results_active_review_idx
  on public.gpt_signal_results(signal_sent_at, symbol)
  where completed_at is null and superseded_at is null;

create index if not exists signal_benchmark_snapshots_mode_time_idx
  on public.gpt_signal_benchmark_snapshots(delivery_mode, snapshot_at);

create or replace view public.gpt_signal_benchmark_drawdowns
with (security_invoker = true)
as
with equity_curve as (
  select
    snapshot.id,
    snapshot.snapshot_at,
    snapshot.delivery_mode,
    snapshot.benchmark_equity,
    snapshot.source_candle_time,
    max(snapshot.benchmark_equity) over (
      partition by snapshot.delivery_mode
      order by snapshot.snapshot_at, snapshot.id
      rows between unbounded preceding and current row
    ) as equity_peak
  from public.gpt_signal_benchmark_snapshots snapshot
), ranked as (
  select
    equity_curve.*,
    row_number() over (
      partition by equity_curve.delivery_mode
      order by equity_curve.snapshot_at desc, equity_curve.id desc
    ) as latest_rank
  from equity_curve
)
select
  ranked.delivery_mode,
  count(*)::bigint as snapshot_count,
  min(ranked.snapshot_at) as tracking_started_at,
  max(
    case
      when ranked.equity_peak > 0
        then (ranked.equity_peak - ranked.benchmark_equity) / ranked.equity_peak * 100
      else 0
    end
  ) as mtm_max_drawdown_pct,
  max(ranked.benchmark_equity) filter (where ranked.latest_rank = 1) as benchmark_equity,
  max(ranked.source_candle_time) filter (where ranked.latest_rank = 1) as source_candle_time
from ranked
group by ranked.delivery_mode;

revoke all on table public.gpt_signal_benchmark_drawdowns from anon, authenticated;
grant select on table public.gpt_signal_benchmark_drawdowns to service_role;

comment on column public.gpt_signal_results.current_review_price is
  'Latest closed-candle mark used only for the hypothetical Signal Review benchmark.';

comment on column public.gpt_signal_results.unrealized_net_pnl_pct is
  'Hypothetical open-signal MTM after the same fee/slippage assumptions as settled reviews; never account PnL.';

comment on column public.gpt_signal_results.superseded_at is
  'Non-destructive archive marker. Superseded rows remain auditable but are excluded from active review and profitability evidence.';

comment on table public.gpt_signal_benchmark_snapshots is
  'Time-series hypothetical Signal Benchmark snapshots. This is not account equity, positions, or realized user PnL.';

comment on view public.gpt_signal_benchmark_drawdowns is
  'Maximum MTM drawdown calculated from benchmark equity over the complete snapshot time series for each delivery mode.';
