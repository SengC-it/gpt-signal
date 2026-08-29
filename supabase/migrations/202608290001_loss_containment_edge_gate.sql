alter table public.gpt_signals
  add column if not exists gross_tp1_return_pct numeric,
  add column if not exists estimated_round_trip_cost_pct numeric,
  add column if not exists estimated_net_tp1_return_pct numeric,
  add column if not exists cost_coverage_ratio numeric;

alter table public.gpt_signal_results
  add column if not exists signal_type text,
  add column if not exists market_regime text,
  add column if not exists current_review_price numeric,
  add column if not exists unrealized_gross_pnl_pct numeric,
  add column if not exists unrealized_net_pnl_pct numeric,
  add column if not exists current_r numeric;

update public.gpt_signal_results result
set signal_type = coalesce(result.signal_type, signal.signal_type),
    market_regime = coalesce(result.market_regime, signal.market_regime)
from public.gpt_signals signal
where signal.id = result.signal_id
  and (result.signal_type is null or result.market_regime is null);

-- The existing rows remain available for analytics. Only currently active ALT
-- basket reviews are reclassified so the live strategy is Shadow Only.
update public.gpt_signals
set delivery_mode = 'shadow',
    updated_at = now()
where signal_type = 'alt_basket_short'
  and delivery_mode = 'production'
  and lifecycle_status in ('planned', 'waiting_entry', 'entered', 'setup_confirmed');

update public.gpt_notifications notification
set status = 'failed',
    error_message = 'Cancelled by GPT-PROFIT-001: ALT Basket is Shadow Only'
from public.gpt_signals signal
where signal.id = notification.signal_id
  and signal.signal_type = 'alt_basket_short'
  and signal.delivery_mode = 'shadow'
  and notification.status = 'queued';

update public.gpt_signal_results result
set delivery_mode = 'shadow',
    updated_at = now()
from public.gpt_signals signal
where signal.id = result.signal_id
  and signal.signal_type = 'alt_basket_short'
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
  on public.gpt_signal_results(strategy_version, signal_type, symbol, direction, market_regime);

comment on column public.gpt_signal_results.current_review_price is
  'Latest closed-candle mark used only for the hypothetical Signal Review benchmark.';

comment on column public.gpt_signal_results.unrealized_net_pnl_pct is
  'Hypothetical open-signal MTM after the same fee/slippage assumptions as settled reviews; never account PnL.';
