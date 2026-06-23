create extension if not exists pgcrypto;

create table if not exists public.symbols (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  status text not null default 'enabled',
  pool_type text not null default 'B',
  liquidity_score numeric not null default 0,
  relative_strength_score numeric not null default 0,
  data_quality_score numeric not null default 0,
  tick_size numeric,
  step_size numeric,
  min_notional numeric,
  max_daily_alerts integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.candles (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  interval text not null,
  open_time timestamptz not null,
  close_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  quote_volume numeric not null,
  trades integer,
  taker_buy_volume numeric,
  taker_buy_quote_volume numeric,
  is_closed boolean not null default false,
  data_quality_score numeric not null default 0,
  created_at timestamptz not null default now(),
  unique(symbol, interval, open_time)
);

create table if not exists public.market_metrics (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  mark_price numeric,
  funding_rate numeric,
  funding_percentile_30d numeric,
  funding_percentile_90d numeric,
  next_funding_time timestamptz,
  open_interest numeric,
  oi_change_5m numeric,
  oi_change_15m numeric,
  oi_change_1h numeric,
  oi_percentile_30d numeric,
  volume_24h numeric,
  price_change_24h numeric,
  spread numeric,
  depth_score numeric,
  liquidation_value numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.opportunities (
  id text primary key,
  symbol text not null,
  direction text not null,
  opportunity_type text not null,
  structure_id text not null,
  lifecycle_status text not null default 'detected',
  first_detected_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  current_score numeric not null default 0,
  current_level text not null default 'C'
);

create table if not exists public.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  parameters jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  notes text
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text references public.opportunities(id) on delete set null,
  strategy_version_id uuid references public.strategy_versions(id) on delete set null,
  symbol text not null,
  direction text not null,
  signal_type text not null,
  lifecycle_status text not null,
  level text not null,
  score numeric not null,
  entry_mode text not null,
  entry_low numeric,
  entry_high numeric,
  trigger_price numeric,
  mark_price numeric,
  stop_loss numeric,
  tp1 numeric,
  tp2 numeric,
  tp3 numeric,
  theoretical_rr numeric,
  weighted_rr numeric,
  cost_adjusted_rr numeric,
  sl_distance_pct numeric,
  sl_atr_ratio numeric,
  btc_state text,
  market_regime text,
  funding_rate numeric,
  funding_percentile numeric,
  oi_change_15m numeric,
  oi_percentile numeric,
  relative_strength_score numeric,
  liquidity_score numeric,
  data_quality_score numeric,
  reasons jsonb not null default '[]'::jsonb,
  invalidation_rules jsonb not null default '[]'::jsonb,
  no_chase_rule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signal_results (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete cascade,
  entry_hit boolean not null default false,
  entry_time timestamptz,
  entry_price_actual numeric,
  max_profit_pct_10m numeric,
  max_loss_pct_10m numeric,
  max_profit_pct_30m numeric,
  max_loss_pct_30m numeric,
  max_profit_pct_1h numeric,
  max_loss_pct_1h numeric,
  max_profit_pct_4h numeric,
  max_loss_pct_4h numeric,
  mfe numeric,
  mae numeric,
  hit_tp1 boolean not null default false,
  hit_tp2 boolean not null default false,
  hit_tp3 boolean not null default false,
  hit_sl boolean not null default false,
  final_r numeric,
  final_status text,
  completed_at timestamptz
);

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid references public.strategy_versions(id) on delete set null,
  symbols text[] not null default '{}',
  start_time timestamptz,
  end_time timestamptz,
  cost_model jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete set null,
  channel text not null,
  subject text not null,
  recipient text,
  status text not null default 'queued',
  delay_ms integer,
  error_message text,
  body text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists candles_symbol_interval_time_idx on public.candles(symbol, interval, open_time desc);
create index if not exists market_metrics_symbol_time_idx on public.market_metrics(symbol, created_at desc);
create index if not exists opportunities_status_idx on public.opportunities(lifecycle_status, last_updated_at desc);
create index if not exists signals_symbol_time_idx on public.signals(symbol, created_at desc);
create index if not exists signals_level_status_idx on public.signals(level, lifecycle_status, created_at desc);
create index if not exists notifications_signal_idx on public.notifications(signal_id, created_at desc);

alter table public.symbols enable row level security;
alter table public.candles enable row level security;
alter table public.market_metrics enable row level security;
alter table public.opportunities enable row level security;
alter table public.strategy_versions enable row level security;
alter table public.signals enable row level security;
alter table public.signal_results enable row level security;
alter table public.backtest_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.system_events enable row level security;

create policy "authenticated read symbols" on public.symbols for select to authenticated using (true);
create policy "authenticated write symbols" on public.symbols for all to authenticated using (true) with check (true);
create policy "authenticated read candles" on public.candles for select to authenticated using (true);
create policy "authenticated write candles" on public.candles for all to authenticated using (true) with check (true);
create policy "authenticated read market metrics" on public.market_metrics for select to authenticated using (true);
create policy "authenticated write market metrics" on public.market_metrics for all to authenticated using (true) with check (true);
create policy "authenticated read opportunities" on public.opportunities for select to authenticated using (true);
create policy "authenticated write opportunities" on public.opportunities for all to authenticated using (true) with check (true);
create policy "authenticated read strategy versions" on public.strategy_versions for select to authenticated using (true);
create policy "authenticated write strategy versions" on public.strategy_versions for all to authenticated using (true) with check (true);
create policy "authenticated read signals" on public.signals for select to authenticated using (true);
create policy "authenticated write signals" on public.signals for all to authenticated using (true) with check (true);
create policy "authenticated read signal results" on public.signal_results for select to authenticated using (true);
create policy "authenticated write signal results" on public.signal_results for all to authenticated using (true) with check (true);
create policy "authenticated read backtest runs" on public.backtest_runs for select to authenticated using (true);
create policy "authenticated write backtest runs" on public.backtest_runs for all to authenticated using (true) with check (true);
create policy "authenticated read notifications" on public.notifications for select to authenticated using (true);
create policy "authenticated write notifications" on public.notifications for all to authenticated using (true) with check (true);
create policy "authenticated read system events" on public.system_events for select to authenticated using (true);
create policy "authenticated write system events" on public.system_events for all to authenticated using (true) with check (true);

insert into public.strategy_versions (name, version, parameters, notes)
values (
  'GPT Signal Conservative V1',
  '0.1.0',
  '{"minPlanScore":78,"minDataQuality":90,"minWeightedRr":1.3,"feeRate":0.001,"slippageRate":0.0005}'::jsonb,
  'Initial conservative SaaS strategy version.'
)
on conflict do nothing;

