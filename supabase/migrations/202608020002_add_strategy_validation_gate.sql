alter table public.gpt_signals
  add column if not exists strategy_version text,
  add column if not exists delivery_mode text not null default 'production';

alter table public.gpt_signals
  drop constraint if exists gpt_signals_delivery_mode_check;

alter table public.gpt_signals
  add constraint gpt_signals_delivery_mode_check
  check (delivery_mode in ('production', 'shadow'));

alter table public.gpt_signal_results
  add column if not exists strategy_version text,
  add column if not exists strategy_family text,
  add column if not exists delivery_mode text not null default 'production';

alter table public.gpt_signal_results
  drop constraint if exists gpt_signal_results_delivery_mode_check;

alter table public.gpt_signal_results
  add constraint gpt_signal_results_delivery_mode_check
  check (delivery_mode in ('production', 'shadow'));

create index if not exists signals_strategy_mode_time_idx
  on public.gpt_signals(strategy_version_id, delivery_mode, created_at desc);

create index if not exists signal_results_strategy_mode_time_idx
  on public.gpt_signal_results(strategy_version, delivery_mode, signal_sent_at desc);

create unique index if not exists strategy_versions_name_version_uidx
  on public.gpt_strategy_versions(name, version);

alter table public.gpt_backtest_runs
  add column if not exists strategy_version text,
  add column if not exists validation_mode text not null default 'historical',
  add column if not exists execution_policy jsonb not null default '{}'::jsonb,
  add column if not exists validation_passed boolean;

comment on column public.gpt_signals.delivery_mode is
  'production signals may notify; shadow signals are persisted for validation and must never notify.';

comment on table public.gpt_backtest_runs is
  'Immutable validation run summaries. A validation_passed value is advisory data and never grants production deployment by itself.';
