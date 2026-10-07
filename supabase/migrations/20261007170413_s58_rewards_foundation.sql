-- S58 (Module 11, Rewards and engagement), migration 1 of 3: versioned configuration, reward rules, ledger provenance.
--
-- WHAT THIS DOES
--  * reward_config: versioned PROPOSED values for rewards (INV-16), same shape as learning_config. Mirrored in
--    packages/shared/src/proposed-config (a test fails if the seeds below drift).
--  * reward_rules: the spec's reward_rules (alias/extension of the old singleton wellness_points_config, which stays as the
--    legacy anchor row). Points for each earning action are DATA here instead of numbers inside trigger bodies. A rule that
--    references weight, BMI, waist, calories or any body-size idea is refused by a CHECK constraint (spec 11.3: never for body size).
--  * wellness_points_ledger gains rule_code, rule_version and event_id provenance and becomes append-only.
--
-- ROW COUNTS. Nothing is converted: reward_config and reward_rules are new (0 rows before). The ledger only gains nullable
-- columns; existing rows keep NULLs (legacy awards). Live ledger/balance counts are not read from the repo; the dry run records
-- select count(*) from wellness_points_ledger and wellness_points_balances (OQ-08 says 2 balance rows live).
--
-- Every rule seed below is status 'proposed' (founder owns the values; none is clinical, so no CMO signature is needed).

-- ---------------------------------------------------------------------------
-- 1. Body-metric guard (used by a CHECK constraint and by a scan test)
-- ---------------------------------------------------------------------------
create or replace function private.reward_text_mentions_body_metric(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(^|[^a-z])(weight|bmi|waist|hip|hips|obes[a-z]*|calor[a-z]*|kcal|kg|lbs|pounds|slim|lean|body|fat|size|shape|thin|inches)([^a-z]|$)';
$$;
revoke execute on function private.reward_text_mentions_body_metric(text) from public;
grant execute on function private.reward_text_mentions_body_metric(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Versioned configuration
-- ---------------------------------------------------------------------------
create table public.reward_config (
  id         uuid primary key default gen_random_uuid(),
  key        text not null check (key ~ '^[a-z_]+$'),
  version    integer not null check (version >= 1),
  value      jsonb not null,
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  unique (key, version)
);
alter table public.reward_config enable row level security;
revoke all on public.reward_config from public, anon, authenticated;
grant select on public.reward_config to authenticated;
create policy reward_config_read on public.reward_config for select to authenticated using (true);
comment on table public.reward_config is
  'S58: versioned PROPOSED values for Health Points. Readable by signed-in users (the phone shows tiers and how-to-earn); written only by migration or service role. A new version supersedes an older one; never edit a row.';

create or replace function private.reward_config(p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select c.value from public.reward_config c
   where c.key = p_key and c.is_active
   order by c.version desc limit 1;
$$;
revoke execute on function private.reward_config(text) from public;
grant execute on function private.reward_config(text) to authenticated, service_role;

-- rewards-seeds-begin
insert into public.reward_config (key, version, value, status, note) values
('plausible_ranges', 1, $json${"systolic":[50,260],"diastolic":[30,160],"glucose_mmol_l":[1,40],"pulse_bpm":[25,230],"temperature_c":[30,43],"spo2_pct":[50,100],"ketones_mmol_l":[0,15],"respiratory_rate_bpm":[4,60],"peak_flow_l_min":[50,900]}$json$::jsonb, 'proposed',
 'A logged reading outside these bounds is treated as a device or typing error and earns no points. Wide on purpose: a dangerous reading is still plausible and still earns normally; the triage path never reads this.'),
('daily_points_cap', 1, $json${"points":100}$json$::jsonb, 'proposed',
 'Most points one person can earn in a Lagos day across all rules, so effort stays steady and nothing can be farmed.'),
('minor_age_years', 1, $json${"years":18}$json$::jsonb, 'proposed',
 'Under this age: fixed rewards only, no tiers shown as a contest, no redemption. No variable or chance-based reward exists at any age.'),
('tiers', 1, $json${"timezone":"Africa/Lagos","carry_status_next_year":true,"tiers":[{"key":"sprout","min":0},{"key":"leaf","min":400},{"key":"branch","min":1200},{"key":"canopy","min":3000}]}$json$::jsonb, 'proposed',
 'Yearly tiers. The year counter resets each 1 January (Lagos); earned status carries through the next year, so a tier is never taken away mid-year. The spendable balance never resets.'),
('streak_grace', 1, $json${"window_days":7,"missed_days_allowed":1}$json$::jsonb, 'proposed',
 'A consistency badge tolerates this many quiet days inside its window. A streak is only ever a badge condition: no counter shows a reset and nothing notifies a missed day.'),
('leaderboards', 1, $json${"enabled":false}$json$::jsonb, 'proposed',
 'Off by default. No ranking or comparison with other people exists in the product.'),
('redemption', 1, $json${"max_share_bps":1000,"points_per_percent":100,"min_points":100}$json$::jsonb, 'proposed',
 'Checkout discount only. Points buy a PERCENTAGE of one order (points_per_percent points per 1 percent), never more than max_share_bps of the item price, so no points-to-naira rate exists anywhere (INV-09).'),
('points_redemption_cap_kobo', 1, $json$0$json$::jsonb, 'proposed',
 'F1/OQ-08: the largest discount, in integer kobo, one redemption may take off one order. 0 = redemption is switched off. The founder sets it; this migration does not.'),
('employer_aggregate', 1, $json${"min_group":10}$json$::jsonb, 'proposed',
 'Module 24 seam: an employer-style report shows counts only and suppresses any group smaller than this (I9: aggregate only).')
on conflict (key, version) do nothing;
-- rewards-seeds-end

-- ---------------------------------------------------------------------------
-- 3. Reward rules
-- ---------------------------------------------------------------------------
create table public.reward_rules (
  id              uuid primary key default gen_random_uuid(),
  code            text not null check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  version         integer not null check (version >= 1),
  trigger_event   text not null check (trigger_event ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  points          integer not null check (points between 0 and 1000),
  points_source   text not null default 'rule' check (points_source in ('rule', 'catalogue')),
  -- per_day / per_week / lifetime counts, and decay: [{"upto":n,"pct":p}, ... , {"pct":p}] by the nth award of this rule.
  caps            jsonb not null default '{}'::jsonb check (jsonb_typeof(caps) = 'object'),
  -- true for a verified clinical action (a result, a completed review, a screening result), shown first on how-to-earn.
  verified_action boolean not null default false,
  -- Only 'fixed' exists: a variable or chance-based reward is refused by the table itself (no minor can ever get one).
  reward_kind     text not null default 'fixed' check (reward_kind = 'fixed'),
  is_active       boolean not null default true,
  status          text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  description     text,
  created_at      timestamptz not null default now(),
  unique (code, version),
  check (points_source = 'catalogue' or points > 0),
  constraint reward_rules_no_body_metric check (
    not private.reward_text_mentions_body_metric(code)
    and not private.reward_text_mentions_body_metric(trigger_event)
    and not private.reward_text_mentions_body_metric(caps::text))
);
create index reward_rules_event_idx on public.reward_rules (trigger_event) where is_active;
alter table public.reward_rules enable row level security;
revoke all on public.reward_rules from public, anon, authenticated;
grant select on public.reward_rules to authenticated;
create policy reward_rules_read on public.reward_rules for select to authenticated
  using (is_active or private.is_admin());
comment on table public.reward_rules is
  'S58 (spec reward_rules): what earns Health Points. Versioned (a change is a new row); never references a body metric (CHECK); written by admin_set_reward_rule or migration only.';

-- rewards-rules-begin
insert into public.reward_rules (code, version, trigger_event, points, points_source, caps, verified_action, description)
select r->>'code', 1, r->>'trigger_event', (r->>'points')::integer, coalesce(r->>'points_source', 'rule'),
       coalesce(r->'caps', '{}'::jsonb), coalesce((r->>'verified_action')::boolean, false), r->>'description'
from jsonb_array_elements($json$[
 {"code":"vitals_logged","trigger_event":"vitals.logged","points":10,"caps":{"per_day":1},"description":"A plausible blood pressure, glucose, pulse, oxygen, temperature or similar reading logged."},
 {"code":"meal_logged","trigger_event":"meal.logged","points":10,"caps":{"per_day":1},"description":"A meal logged."},
 {"code":"adherence_checkin_completed","trigger_event":"adherence.checkin_answered","points":15,"caps":{"per_day":1},"description":"A medicine check-in answered."},
 {"code":"education_lesson_completed","trigger_event":"lesson.completed","points":20,"caps":{"per_day":3},"description":"A lesson finished."},
 {"code":"lpe_task_completed","trigger_event":"lifestyle.task_completed","points":15,"caps":{"per_day":1},"description":"A lifestyle task done."},
 {"code":"lpe_goal_achieved","trigger_event":"lifestyle.goal_achieved","points":50,"description":"A lifestyle goal reached."},
 {"code":"challenge_completed","trigger_event":"challenge.completed","points":0,"points_source":"catalogue","description":"A challenge finished. Points come from the challenge itself."},
 {"code":"wellness_class_attended","trigger_event":"class.attended","points":0,"points_source":"catalogue","caps":{"per_day":2},"description":"A class attended. Points come from the class itself."},
 {"code":"course_completed","trigger_event":"course.completed","points":40,"caps":{"lifetime":20},"verified_action":true,"description":"A learning programme finished (a programme milestone)."},
 {"code":"lab_done","trigger_event":"lab_result.released","points":30,"caps":{"per_day":1,"decay":[{"upto":2,"pct":100},{"upto":6,"pct":50},{"pct":25}]},"verified_action":true,"description":"A lab test done and its result released. Rewards doing the test, never the result."},
 {"code":"review_attended","trigger_event":"encounter.completed","points":40,"caps":{"per_day":1,"decay":[{"upto":1,"pct":100},{"upto":4,"pct":50},{"pct":25}]},"verified_action":true,"description":"A review or consultation attended."},
 {"code":"screening_done","trigger_event":"screening.completed","points":40,"caps":{"per_day":2,"decay":[{"upto":2,"pct":100},{"upto":6,"pct":50},{"pct":25}]},"verified_action":true,"description":"A screening done and recorded. Rewards doing it, never what it found."}
]$json$::jsonb) r
on conflict (code, version) do nothing;
-- rewards-rules-end

-- ---------------------------------------------------------------------------
-- 4. Ledger provenance and append-only
-- ---------------------------------------------------------------------------
alter table public.wellness_points_ledger
  add column if not exists rule_code    text,
  add column if not exists rule_version integer,
  -- 'earn' for every award (and every pre-S58 row), 'spend' for a redemption, 'release' for points returned when an order lapses.
  -- Tiers, caps and badges count only 'earn', so returned points are never counted as earning.
  add column if not exists kind         text not null default 'earn' check (kind in ('earn', 'spend', 'release')),
  add column if not exists event_id     uuid references public.domain_events (id) on delete restrict;
create index if not exists wellness_points_ledger_event_idx on public.wellness_points_ledger (event_id) where event_id is not null;

create or replace function private.wellness_points_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A profile hard delete (test-account purge) cascades here at trigger depth > 1; nothing else may change a ledger row.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'wellness_points_ledger is append-only' using errcode = 'P0001';
end;
$$;
drop trigger if exists wellness_points_ledger_append_only on public.wellness_points_ledger;
create trigger wellness_points_ledger_append_only
  before update or delete on public.wellness_points_ledger
  for each row execute function private.wellness_points_ledger_append_only();

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.reward_rules where is_active) <> 12 then raise exception 'expected 12 seeded rules'; end if;
  if (select count(*) from public.reward_config where is_active) <> 9 then raise exception 'expected 9 seeded config keys'; end if;
  begin
    insert into public.reward_rules (code, version, trigger_event, points) values ('weight_loss_bonus', 1, 'vitals.logged', 5);
    raise exception 'a body-metric rule was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.reward_rules (code, version, trigger_event, points, reward_kind) values ('mystery_bonus', 1, 'vitals.logged', 5, 'variable');
    raise exception 'a variable reward was accepted';
  exception when check_violation then null; end;
end $$;
