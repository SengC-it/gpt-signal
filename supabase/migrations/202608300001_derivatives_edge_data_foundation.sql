create table if not exists public.gpt_derivatives_metrics (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  interval text not null check (interval in ('5m', '15m', '1h', '4h')),
  metric_time timestamptz not null,
  open_interest numeric,
  open_interest_value numeric,
  oi_change_5m numeric,
  oi_change_15m numeric,
  oi_change_1h numeric,
  oi_change_4h numeric,
  oi_acceleration numeric,
  oi_percentile numeric,
  funding_rate numeric,
  last_settled_funding numeric,
  funding_percentile numeric,
  funding_z_score numeric,
  funding_acceleration numeric,
  funding_extreme_positive boolean,
  funding_extreme_negative boolean,
  price_funding_divergence numeric,
  oi_funding_interaction numeric,
  next_funding_time timestamptz,
  perpetual_premium_bps numeric,
  basis_bps numeric,
  basis_rate numeric,
  basis_acceleration numeric,
  basis_percentile numeric,
  basis_expansion boolean,
  basis_contraction boolean,
  price_basis_divergence numeric,
  taker_buy_ratio numeric,
  taker_sell_ratio numeric,
  taker_imbalance numeric,
  taker_acceleration numeric,
  aggressive_flow_divergence numeric,
  global_long_short_ratio numeric,
  global_long_short_change numeric,
  top_account_long_short_ratio numeric,
  top_position_long_short_ratio numeric,
  top_account_long_short_change numeric,
  top_position_long_short_change numeric,
  positioning_divergence numeric,
  liquidation_notional numeric,
  price_change_5m numeric,
  price_oi_state text,
  source_timestamp timestamptz,
  fetched_at timestamptz not null default now(),
  data_quality_flags jsonb not null default '{}'::jsonb,
  source_endpoint text not null,
  source_version text not null,
  created_at timestamptz not null default now(),
  unique (symbol, interval, metric_time)
);

create index if not exists derivatives_metrics_symbol_time_idx
  on public.gpt_derivatives_metrics(symbol, interval, metric_time desc);

create index if not exists derivatives_metrics_source_time_idx
  on public.gpt_derivatives_metrics(source_version, fetched_at desc);

alter table public.gpt_derivatives_metrics enable row level security;
revoke all on table public.gpt_derivatives_metrics from public, anon, authenticated;
grant select, insert on table public.gpt_derivatives_metrics to service_role;

create or replace function public.reject_derivatives_metric_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'gpt_derivatives_metrics is append-only; % is not allowed', TG_OP;
end;
$$;

drop trigger if exists reject_derivatives_metric_mutation on public.gpt_derivatives_metrics;
create trigger reject_derivatives_metric_mutation
before update or delete on public.gpt_derivatives_metrics
for each row execute function public.reject_derivatives_metric_mutation();

comment on table public.gpt_derivatives_metrics is
  'Append-only, point-in-time public Binance USD-M derivatives market metrics. Never user account, user position, order, or user-trade data.';
comment on column public.gpt_derivatives_metrics.metric_time is
  'Closed 5-minute source period used for research alignment; future observations are excluded.';
comment on column public.gpt_derivatives_metrics.data_quality_flags is
  'Collection availability, timestamp alignment, missing-field, and revision-risk metadata.';
