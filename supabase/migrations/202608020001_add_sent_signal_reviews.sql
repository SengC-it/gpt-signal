alter table public.gpt_signal_results
  add column if not exists symbol text,
  add column if not exists direction text,
  add column if not exists entry_low numeric,
  add column if not exists entry_high numeric,
  add column if not exists stop_loss numeric,
  add column if not exists tp1 numeric,
  add column if not exists tp2 numeric,
  add column if not exists tp3 numeric,
  add column if not exists execution_context jsonb not null default '{}'::jsonb,
  add column if not exists signal_sent_at timestamptz,
  add column if not exists gross_r numeric,
  add column if not exists net_r numeric,
  add column if not exists gross_pnl_pct numeric,
  add column if not exists net_pnl_pct numeric,
  add column if not exists exit_price numeric,
  add column if not exists exit_time timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.gpt_signal_results
set final_status = case when entry_hit then 'open' else 'waiting_entry' end,
    completed_at = null,
    updated_at = now()
where final_status = 'expired';

alter table public.gpt_signal_results
  drop constraint if exists gpt_signal_results_signal_id_key;

alter table public.gpt_signal_results
  add constraint gpt_signal_results_signal_id_key unique (signal_id);

alter table public.gpt_signal_results
  drop constraint if exists gpt_signal_results_final_status_check;

alter table public.gpt_signal_results
  add constraint gpt_signal_results_final_status_check
  check (final_status is null or final_status in ('waiting_entry', 'open', 'hit_tp1', 'hit_tp2', 'hit_tp3', 'hit_sl'));

create index if not exists gpt_signal_results_status_idx
  on public.gpt_signal_results(final_status, signal_sent_at desc);

create index if not exists gpt_signal_results_symbol_checked_idx
  on public.gpt_signal_results(symbol, last_checked_at);

alter table public.gpt_signal_results enable row level security;
revoke all on table public.gpt_signal_results from anon, authenticated;
grant select, insert, update, delete on table public.gpt_signal_results to service_role;

with sent_notifications as (
  select distinct on (n.signal_id)
    n.signal_id,
    coalesce(n.sent_at, n.created_at) as signal_sent_at
  from public.gpt_notifications n
  where n.status = 'sent'
    and n.signal_id is not null
  order by n.signal_id, coalesce(n.sent_at, n.created_at) asc
)
insert into public.gpt_signal_results (
  signal_id,
  symbol,
  direction,
  entry_low,
  entry_high,
  stop_loss,
  tp1,
  tp2,
  tp3,
  execution_context,
  signal_sent_at,
  entry_hit,
  final_status
)
select
  s.id,
  s.symbol,
  s.direction,
  s.entry_low,
  s.entry_high,
  s.stop_loss,
  s.tp1,
  s.tp2,
  s.tp3,
  s.no_chase_rule,
  n.signal_sent_at,
  false,
  'waiting_entry'
from sent_notifications n
join public.gpt_signals s on s.id = n.signal_id
where s.entry_low is not null
  and s.entry_high is not null
  and s.stop_loss is not null
  and s.tp1 is not null
  and s.tp2 is not null
  and s.tp3 is not null
on conflict (signal_id) do nothing;

comment on table public.gpt_signal_results is
  'One immutable-price execution review per successfully sent signal. Open reviews remain open until a TP or SL is touched; no time expiry.';
