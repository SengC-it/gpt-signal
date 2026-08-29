alter table public.gpt_signals
  add column if not exists superseded_at timestamptz;

alter table public.gpt_signal_results
  add column if not exists superseded_at timestamptz;

create temporary table alt_basket_component_backfill on commit drop as
select
  gen_random_uuid() as child_signal_id,
  parent.id as parent_signal_id,
  parent.opportunity_id as parent_opportunity_id,
  parent.strategy_version_id,
  parent.strategy_version,
  'shadow'::text as delivery_mode,
  parent.level,
  parent.score,
  parent.btc_state,
  parent.market_regime,
  parent.relative_strength_score,
  parent.data_quality_score,
  parent.reasons,
  parent.invalidation_rules,
  parent.no_chase_rule,
  parent.created_at,
  upper(trim(split_part(component.raw_component, ':', 1))) as symbol,
  split_part(component.raw_component, ':', 2)::numeric as entry_price,
  coalesce(nullif(parent.no_chase_rule ->> 'takeProfitPct', '')::numeric, 6) as take_profit_pct,
  coalesce(nullif(parent.no_chase_rule ->> 'stopLossPct', '')::numeric, 5) as stop_loss_pct,
  coalesce(
    nullif(regexp_replace(parent.opportunity_id, ':shadow$', ''), ''),
    'alt_basket_short:legacy'
  )
    || ':' || upper(trim(split_part(component.raw_component, ':', 1)))
    || case when parent.delivery_mode = 'shadow' then ':shadow' else '' end as child_opportunity_id
from public.gpt_signals parent
cross join lateral regexp_split_to_table(parent.no_chase_rule ->> 'entryPrices', ',') as component(raw_component)
where parent.symbol = 'ALT_SHORT_BASKET'
  and parent.signal_type = 'alt_basket_short'
  and parent.lifecycle_status in ('planned', 'waiting_entry', 'entered', 'setup_confirmed')
  and split_part(component.raw_component, ':', 2) ~ '^[0-9]+([.][0-9]+)?$';

insert into public.gpt_opportunities (
  id,
  symbol,
  direction,
  opportunity_type,
  structure_id,
  lifecycle_status,
  first_detected_at,
  last_updated_at,
  current_score,
  current_level
)
select
  child_opportunity_id,
  symbol,
  'SHORT',
  'alt_basket_short',
  market_regime,
  'planned',
  created_at,
  now(),
  score,
  level
from alt_basket_component_backfill
on conflict (id) do update set
  lifecycle_status = excluded.lifecycle_status,
  last_updated_at = excluded.last_updated_at,
  current_score = excluded.current_score,
  current_level = excluded.current_level;

insert into public.gpt_signals (
  id,
  opportunity_id,
  strategy_version_id,
  strategy_version,
  delivery_mode,
  symbol,
  direction,
  signal_type,
  lifecycle_status,
  level,
  score,
  entry_mode,
  entry_low,
  entry_high,
  stop_loss,
  tp1,
  tp2,
  tp3,
  theoretical_rr,
  weighted_rr,
  cost_adjusted_rr,
  sl_distance_pct,
  sl_atr_ratio,
  btc_state,
  market_regime,
  relative_strength_score,
  data_quality_score,
  reasons,
  invalidation_rules,
  no_chase_rule,
  created_at,
  updated_at
)
select
  child_signal_id,
  child_opportunity_id,
  strategy_version_id,
  strategy_version,
  delivery_mode,
  symbol,
  'SHORT',
  'alt_basket_short',
  'planned',
  level,
  score,
  'confirmation_wait',
  round(entry_price, 8),
  round(entry_price, 8),
  round(entry_price * (1 + stop_loss_pct / 100), 8),
  round(entry_price * (1 - take_profit_pct / 100), 8),
  round(entry_price * (1 - take_profit_pct / 100), 8),
  round(entry_price * (1 - take_profit_pct / 100), 8),
  round(take_profit_pct / stop_loss_pct, 4),
  round(take_profit_pct / stop_loss_pct, 4),
  round(take_profit_pct / stop_loss_pct - 0.003 / (stop_loss_pct / 100), 4),
  stop_loss_pct,
  0,
  btc_state,
  market_regime,
  relative_strength_score,
  data_quality_score,
  reasons || jsonb_build_array(symbol || ' 是旧篮子信号拆分出的独立交易对记录'),
  invalidation_rules,
  no_chase_rule || jsonb_build_object(
    'basketComponent', symbol,
    'referenceEntryPrice', entry_price,
    'weightPct', round(100::numeric / count(*) over (partition by parent_signal_id), 2)
  ),
  created_at,
  now()
from alt_basket_component_backfill
on conflict (id) do nothing;

insert into public.gpt_signal_results (
  signal_id,
  strategy_version,
  strategy_family,
  delivery_mode,
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
  final_status,
  completed_at
)
select
  child.id,
  child.strategy_version,
  'alt_basket',
  child.delivery_mode,
  child.symbol,
  child.direction,
  child.entry_low,
  child.entry_high,
  child.stop_loss,
  child.tp1,
  child.tp2,
  child.tp3,
  child.no_chase_rule,
  coalesce(parent_result.signal_sent_at, child.created_at),
  false,
  'waiting_entry',
  null
from alt_basket_component_backfill backfill
join public.gpt_signals child on child.id = backfill.child_signal_id
left join public.gpt_signal_results parent_result on parent_result.signal_id = backfill.parent_signal_id
on conflict (signal_id) do nothing;

update public.gpt_signals parent
set delivery_mode = 'shadow',
    lifecycle_status = 'archived',
    superseded_at = coalesce(parent.superseded_at, now()),
    updated_at = now()
where parent.id in (
  select distinct parent_signal_id
  from alt_basket_component_backfill
);

update public.gpt_signal_results parent_result
set delivery_mode = 'shadow',
    superseded_at = coalesce(parent_result.superseded_at, now()),
    updated_at = now()
where parent_result.signal_id in (
  select distinct parent_signal_id
  from alt_basket_component_backfill
);
