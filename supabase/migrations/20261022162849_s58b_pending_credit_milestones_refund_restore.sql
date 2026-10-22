-- S58b: pending credit, a calm route for a credit that has not appeared, milestone celebrations for verified care actions, and points
-- returned when a paid order is refunded.
--
-- WHAT THIS DOES (and what it deliberately does NOT do)
--  * It does NOT add apply_points_discount / release_points_discount / reward_redemptions. The S58 migration 3 header records why
--    (2026-10-16): S71 to S73 already ship points at checkout (price_quote_calc, a single-use reduction on Tarragon's own service fee,
--    points_applied / points_reduction_kobo on the order, reserved while the order is open and unexpired, spent once on 'paid' by
--    private.orders_pricing_effects). A second redemption path would be a second place a point could become money (INV-09). The switch
--    for that path is the pricing rule points.enabled (false), untouched here.
--  * Refund gap closed: a spent-on-paid order that is later refunded now returns the points it spent (once, kind 'release'). Before this,
--    the cash came back and the points did not. Release on cancel / failure / expiry needs no row: those points were never spent (the
--    quote subtracts only the points held by an open, unexpired order).
--  * Pending credit: public.my_points_pending() lists point-earning events that the bus has recorded but not yet decided. It reads
--    only events and decisions; it invents no hold and no clearing delay.
--  * Milestones: versioned definitions (milestone_definitions, PROPOSED), an append-only milestones_achieved, evaluated from the same
--    S10 events as points, idempotent per (patient, milestone). Celebrates doing a care step, never a result and never a body measure.
--
-- ROW COUNTS. New tables, 0 rows before. No data converted. Nothing in the points ledger changes except future refund releases.
-- LIVE CHECK BEFORE APPLY: re-read pg_get_functiondef for private.orders_pricing_effects and public.points_award; this migration
-- replaces both and was written from the repository definitions (S73 and S58 migration 2).

-- ---------------------------------------------------------------------------
-- 1. Configuration (PROPOSED, mirrored in packages/shared proposed-config)
-- ---------------------------------------------------------------------------
-- rewards-s58b-seeds-begin
insert into public.reward_config (key, version, value, status, note) values
('pending_credit', 1, $json${"expected_within_minutes":15,"ask_after_minutes":120,"look_back_hours":72,"ignore_before":"2026-10-07"}$json$::jsonb, 'proposed',
 'Pending credit: an action whose points have not been decided yet is shown as on its way until expected_within_minutes, then still pending; after ask_after_minutes the screen offers the support route. look_back_hours bounds how old an undecided action can be and still be listed; ignore_before drops events older than the rewards rollout (they were never going to be decided).'),
('milestone_display', 1, $json${"show_for_hours":72,"show_to_minors":false}$json$::jsonb, 'proposed',
 'A milestone card is shown until it is dismissed, and at most this long after it was first shown. It never blocks anything and is never shown while an emergency is open. show_to_minors false (the safer default while OQ-S58b-04 is undecided): a person under minor_age_years is never shown a card; the milestone is still recorded.')
on conflict (key, version) do nothing;
-- rewards-s58b-seeds-end

-- ---------------------------------------------------------------------------
-- 2. Milestone definitions (versioned data, body-metric guard, fixed rewards only)
-- ---------------------------------------------------------------------------
create table public.milestone_definitions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  version       integer not null check (version >= 1),
  kind          text not null check (kind in ('first_event', 'adherence_window')),
  trigger_event text not null check (trigger_event ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  params        jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  is_active     boolean not null default true,
  status        text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  description   text,
  created_at    timestamptz not null default now(),
  unique (code, version),
  constraint milestone_definitions_no_body_metric check (
    not private.reward_text_mentions_body_metric(code)
    and not private.reward_text_mentions_body_metric(trigger_event)
    and not private.reward_text_mentions_body_metric(params::text))
);
create index milestone_definitions_event_idx on public.milestone_definitions (trigger_event) where is_active;
alter table public.milestone_definitions enable row level security;
revoke all on public.milestone_definitions from public, anon, authenticated;
grant select on public.milestone_definitions to authenticated;
create policy milestone_definitions_read on public.milestone_definitions for select to authenticated
  using (is_active or private.is_admin());
comment on table public.milestone_definitions is
  'S58b: which verified care actions are celebrated once. Versioned, PROPOSED, never references a body metric (CHECK). A result or a value is never a milestone: only doing the step.';

-- rewards-milestones-begin
insert into public.milestone_definitions (code, version, kind, trigger_event, params, description)
select r->>'code', 1, r->>'kind', r->>'trigger_event', coalesce(r->'params', '{}'::jsonb), r->>'description'
from jsonb_array_elements($json$[
 {"code":"first_bp_logged","kind":"first_event","trigger_event":"vitals.logged","params":{"requires":"blood_pressure"},"description":"The first blood pressure check logged. Any value counts; a result is never the point."},
 {"code":"first_glucose_logged","kind":"first_event","trigger_event":"vitals.logged","params":{"requires":"glucose"},"description":"The first glucose check logged. Any value counts."},
 {"code":"adherence_4_weeks","kind":"adherence_window","trigger_event":"adherence.checkin_answered","params":{"days":28},"description":"Four weeks of answering medicine check-ins, with the configured grace for quiet days."},
 {"code":"first_lab_done","kind":"first_event","trigger_event":"lab_result.released","params":{},"description":"The first lab test done and its result released. Rewards doing the test, never the result."},
 {"code":"first_review_attended","kind":"first_event","trigger_event":"encounter.completed","params":{},"description":"The first review or consultation attended."},
 {"code":"first_lesson_completed","kind":"first_event","trigger_event":"lesson.completed","params":{},"description":"The first lesson finished."},
 {"code":"first_course_completed","kind":"first_event","trigger_event":"course.completed","params":{},"description":"The first learning programme finished."}
]$json$::jsonb) r
on conflict (code, version) do nothing;
-- rewards-milestones-end

-- ---------------------------------------------------------------------------
-- 3. Milestones achieved (append-only; the only change ever allowed is stamping seen / dismissed once)
-- ---------------------------------------------------------------------------
create table public.milestones_achieved (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  milestone_code    text not null,
  milestone_version integer not null,
  -- null only for a silent backfill row (the person already had this step in their history before milestones existed)
  event_id          uuid references public.domain_events (id) on delete restrict,
  backfilled        boolean not null default false,
  achieved_at       timestamptz not null default now(),
  seen_at           timestamptz,
  dismissed_at      timestamptz,
  unique (patient_id, milestone_code),
  check (backfilled or event_id is not null)
);
create index milestones_achieved_patient_idx on public.milestones_achieved (patient_id, achieved_at desc);
alter table public.milestones_achieved enable row level security;
revoke all on public.milestones_achieved from public, anon, authenticated;
grant select on public.milestones_achieved to authenticated;
create policy milestones_achieved_own_read on public.milestones_achieved for select to authenticated
  using (patient_id = (select auth.uid()));
comment on table public.milestones_achieved is
  'S58b: one row per person per milestone, written only by private.milestones_evaluate_event. Append-only; seen_at and dismissed_at can be stamped once. Patient reads own rows only; no staff or caregiver policy.';

create or replace function private.milestones_achieved_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A profile hard delete (test-account purge) cascades here at trigger depth > 1; nothing else may delete a row.
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'milestones_achieved is append-only' using errcode = 'P0001';
  end if;
  if (new.id, new.organisation_id, new.patient_id, new.milestone_code, new.milestone_version, new.event_id, new.backfilled, new.achieved_at)
       is distinct from (old.id, old.organisation_id, old.patient_id, old.milestone_code, old.milestone_version, old.event_id, old.backfilled, old.achieved_at)
     or (old.seen_at is not null and new.seen_at is distinct from old.seen_at)
     or (old.dismissed_at is not null and new.dismissed_at is distinct from old.dismissed_at) then
    raise exception 'milestones_achieved is append-only' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.milestones_achieved_guard() from public, anon, authenticated;
create trigger milestones_achieved_guard
  before update or delete on public.milestones_achieved
  for each row execute function private.milestones_achieved_guard();

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S58b was added; awaiting review.'
  from unnest(array['milestones_achieved']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('milestone.achieved', 'A care-action milestone was reached (ids only)', 'S58b', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('milestone.achieved', 1, array['milestone_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Evaluation
-- ---------------------------------------------------------------------------
-- Is a reading the kind the milestone asks for, and plausible (a typo or device error is not a milestone)?
create or replace function private.milestone_reading_ok(p_event public.domain_events, p_requires text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.vitals_readings%rowtype;
  v_ranges jsonb := private.reward_config('plausible_ranges');
  v_ok boolean;
  v_key text;
  v_bounds jsonb;
begin
  if p_event.event_type <> 'vitals.logged' then return false; end if;
  select * into v from private.vitals_readings_current
   where id = (p_event.payload ->> 'vitals_id')::uuid and patient_id = p_event.patient_id;
  if not found or v_ranges is null then return false; end if;
  if v.vital_type::text in ('weight', 'waist_circumference') then return false; end if;
  -- Same rule as private.points_event_eligible: ANY implausible measured field (e.g. a pulse of 300 on a blood pressure reading) earns nothing, so it is no milestone.
  for v_key, v_bounds in select key, value from jsonb_each(v_ranges) loop
    if to_jsonb(v) ->> v_key is not null
       and ((to_jsonb(v) ->> v_key)::numeric < (v_bounds ->> 0)::numeric or (to_jsonb(v) ->> v_key)::numeric > (v_bounds ->> 1)::numeric) then
      return false;
    end if;
  end loop;
  if p_requires = 'blood_pressure' then
    v_ok := v.systolic is not null and v.diastolic is not null
      and v.systolic between (v_ranges -> 'systolic' ->> 0)::numeric and (v_ranges -> 'systolic' ->> 1)::numeric
      and v.diastolic between (v_ranges -> 'diastolic' ->> 0)::numeric and (v_ranges -> 'diastolic' ->> 1)::numeric;
  elsif p_requires = 'glucose' then
    v_ok := v.glucose_mmol_l is not null
      and v.glucose_mmol_l between (v_ranges -> 'glucose_mmol_l' ->> 0)::numeric and (v_ranges -> 'glucose_mmol_l' ->> 1)::numeric;
  else
    v_ok := false;
  end if;
  return coalesce(v_ok, false);
end;
$$;
revoke all on function private.milestone_reading_ok(public.domain_events, text) from public, anon, authenticated;

-- Four weeks of check-ins in Lagos days, with the streak grace (missed days allowed per grace window, scaled to the window).
create or replace function private.milestone_adherence_window_ok(p_patient uuid, p_days integer)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grace jsonb := private.reward_config('streak_grace');
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_allowed integer;
  v_days integer;
begin
  v_allowed := floor(p_days::numeric / greatest(1, coalesce((v_grace ->> 'window_days')::integer, 7)))::integer
               * coalesce((v_grace ->> 'missed_days_allowed')::integer, 0);
  select count(distinct (e.occurred_at at time zone 'Africa/Lagos')::date) into v_days
    from public.domain_events e
   where e.patient_id = p_patient and e.event_type = 'adherence.checkin_answered'
     and (e.occurred_at at time zone 'Africa/Lagos')::date > v_today - p_days
     and (e.occurred_at at time zone 'Africa/Lagos')::date <= v_today;
  return v_days >= greatest(1, p_days - v_allowed);
end;
$$;
revoke all on function private.milestone_adherence_window_ok(uuid, integer) from public, anon, authenticated;

-- Has this person ALREADY done this step before this event? History before the event bus counts, so source tables are read where they exist
-- (vitals_readings, lab_results, encounters); lessons and courses only exist as S33 events, so those read domain_events. A new member's first step
-- has no earlier row; an existing member's next reading does, and is not a "first".
create or replace function private.milestone_has_earlier(p_event public.domain_events, p_code text, p_requires text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cur public.vitals_readings%rowtype;
begin
  if p_event.event_type = 'vitals.logged' then
    select * into cur from private.vitals_readings_current
     where id = (p_event.payload ->> 'vitals_id')::uuid and patient_id = p_event.patient_id;
    if not found then return true; end if; -- cannot prove it is the first: do not celebrate
    return exists (
      select 1 from private.vitals_readings_current v
       where v.patient_id = p_event.patient_id and v.id <> cur.id
         and (v.created_at, v.id) < (cur.created_at, cur.id)
         and case p_requires when 'blood_pressure' then v.systolic is not null and v.diastolic is not null
                             when 'glucose' then v.glucose_mmol_l is not null else true end);
  end if;
  if p_event.event_type = 'lab_result.released' then
    if exists (select 1 from public.lab_results l where l.patient_id = p_event.patient_id and l.release_state = 'released'
                 and l.id::text is distinct from (p_event.payload ->> 'lab_result_id')
                 and l.created_at < p_event.occurred_at) then
      return true;
    end if;
  elsif p_event.event_type = 'encounter.completed' then
    if exists (select 1 from public.encounters x where x.patient_id = p_event.patient_id and x.status = 'completed'
                 and x.id::text is distinct from (p_event.payload ->> 'encounter_id')
                 and x.ended_at is not null and x.ended_at < p_event.occurred_at) then
      return true;
    end if;
  end if;
  return exists (
    select 1 from public.domain_events o
     where o.patient_id = p_event.patient_id and o.event_type = p_event.event_type and o.id <> p_event.id
       and (o.occurred_at, o.id) < (p_event.occurred_at, p_event.id));
end;
$$;
revoke all on function private.milestone_has_earlier(public.domain_events, text, text) from public, anon, authenticated;

create or replace function private.milestones_evaluate_event(p_event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.domain_events%rowtype;
  d public.milestone_definitions%rowtype;
  v_ok boolean;
  v_id uuid;
  v_n integer := 0;
begin
  select * into e from public.domain_events where id = p_event;
  if not found or e.patient_id is null then return 0; end if;

  for d in
    select distinct on (code) * from public.milestone_definitions
     where is_active and trigger_event = e.event_type
     order by code, version desc
  loop
    if exists (select 1 from public.milestones_achieved a where a.patient_id = e.patient_id and a.milestone_code = d.code) then
      continue; -- already celebrated: a replay or a later repeat does nothing
    end if;
    v_ok := case d.kind
      when 'first_event' then
        case when d.params ? 'requires' then private.milestone_reading_ok(e, d.params ->> 'requires') else true end
        and not private.milestone_has_earlier(e, d.code, d.params ->> 'requires')
      when 'adherence_window' then
        private.milestone_adherence_window_ok(e.patient_id, coalesce((d.params ->> 'days')::integer, 28))
      else false end;
    if not coalesce(v_ok, false) then continue; end if;

    insert into public.milestones_achieved (organisation_id, patient_id, milestone_code, milestone_version, event_id)
    values (e.organisation_id, e.patient_id, d.code, d.version, e.id)
    on conflict (patient_id, milestone_code) do nothing
    returning id into v_id;
    if v_id is not null then
      v_n := v_n + 1;
      perform private.emit_domain_event('milestone.achieved', e.organisation_id,
        jsonb_build_object('milestone_id', v_id), 'milestone.achieved:' || v_id, e.patient_id,
        'milestones_achieved', v_id, 'normal', null, e.id);
      v_id := null;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.milestones_evaluate_event(uuid) from public, anon, authenticated;

-- The existing handler (points.award) calls public.points_award(event_id) for every point-earning event. Milestones ride the same call so no
-- new edge handler is needed. A milestone failure is audited and never undoes or blocks the award.
create or replace function public.points_award(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points integer;
begin
  v_points := private.points_award_event(p_event_id);
  begin
    perform private.milestones_evaluate_event(p_event_id);
  exception when others then
    begin
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      select ev.organisation_id, 'milestone_event.error', 'domain_events', ev.id, jsonb_build_object('error', sqlerrm)
        from public.domain_events ev where ev.id = p_event_id;
    exception when others then
      raise warning 'milestone evaluation failed for % and could not be audited: %', p_event_id, sqlerrm;
    end;
    -- Loud, not quiet: one open incident covers every failure (page_incident_sev updates an open one instead of opening more, which is the rate limit).
    begin
      perform private.page_incident_sev(ev.organisation_id, 'milestone_event_failed', 'sev3', 'Milestone celebrations are failing',
        'A milestone could not be evaluated; see audit_log action milestone_event.error. Points were still awarded. One open incident covers all of them.')
        from public.domain_events ev where ev.id = p_event_id;
    exception when others then
      raise warning 'milestone failure incident could not be opened for %: %', p_event_id, sqlerrm;
    end;
  end;
  return v_points;
end;
$$;
revoke execute on function public.points_award(uuid) from public;
revoke execute on function public.points_award(uuid) from anon, authenticated;
grant execute on function public.points_award(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. What the person sees
-- ---------------------------------------------------------------------------
-- One calm card: the oldest milestone not dismissed, shown for at most show_for_hours after it was first shown. Nothing is returned while
-- an emergency is open (the red flow always comes first). Stamps seen_at on first return.
create or replace function public.my_pending_milestone()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hours integer := coalesce((private.reward_config('milestone_display') ->> 'show_for_hours')::integer, 72);
  m public.milestones_achieved%rowtype;
  v_cfg jsonb := private.reward_config('milestone_display');
  v_minor_years integer := coalesce((private.reward_config('minor_age_years') ->> 'years')::integer, 18);
begin
  if v_uid is null then return null; end if;
  -- Versioned switch (default off): a person under the minor age is not shown a card unless the founder turns it on. The milestone is still recorded.
  if not coalesce((v_cfg ->> 'show_to_minors')::boolean, false)
     and exists (select 1 from public.profiles p where p.id = v_uid and p.date_of_birth is not null
                  and p.date_of_birth > (now() at time zone 'Africa/Lagos')::date - make_interval(years => v_minor_years)) then
    return null;
  end if;
  if exists (select 1 from public.emergency_events x where x.patient_id = v_uid and x.status in ('active', 'acknowledged')) then
    return null;
  end if;
  select * into m from public.milestones_achieved a
   where a.patient_id = v_uid and a.dismissed_at is null
     and (a.seen_at is null or a.seen_at > now() - make_interval(hours => v_hours))
   order by a.achieved_at asc limit 1;
  if not found then return null; end if;
  if m.seen_at is null then
    update public.milestones_achieved set seen_at = now() where id = m.id;
  end if;
  return jsonb_build_object('id', m.id, 'code', m.milestone_code, 'achieved_at', m.achieved_at);
end;
$$;
revoke execute on function public.my_pending_milestone() from public, anon;
grant execute on function public.my_pending_milestone() to authenticated;

create or replace function public.dismiss_milestone(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.milestones_achieved
     set dismissed_at = coalesce(dismissed_at, now()), seen_at = coalesce(seen_at, now())
   where id = p_id and patient_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke execute on function public.dismiss_milestone(uuid) from public, anon;
grant execute on function public.dismiss_milestone(uuid) to authenticated;

-- Pending credit: point-earning actions the bus has recorded and not yet decided. Ids and rule codes only; nothing about a value.
create or replace function public.my_points_pending()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb := private.reward_config('pending_credit');
  v_within integer := coalesce((v_cfg ->> 'expected_within_minutes')::integer, 15);
  v_ask integer := coalesce((v_cfg ->> 'ask_after_minutes')::integer, 120);
  v_back integer := coalesce((v_cfg ->> 'look_back_hours')::integer, 72);
  -- Nothing recorded before the rewards rollout can ever be decided: the configured date (PROPOSED, set to the real rollout date at apply).
  v_start timestamptz := coalesce((v_cfg ->> 'ignore_before')::date::timestamptz, '-infinity'::timestamptz);
begin
  if v_uid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'event_id', x.id,
             'rule_codes', x.codes,
             'since', x.occurred_at,
             'expected_by', x.occurred_at + make_interval(mins => v_within),
             'ask_support', now() > x.occurred_at + make_interval(mins => v_ask)) order by x.occurred_at desc)
      from (
        select e.id, e.occurred_at,
               (select jsonb_agg(distinct r.code) from public.reward_rules r where r.is_active and r.trigger_event = e.event_type) as codes
          from public.domain_events e
         where e.patient_id = v_uid
           and e.occurred_at > now() - make_interval(hours => v_back)
           and e.occurred_at >= v_start
           and exists (select 1 from public.reward_rules r where r.is_active and r.trigger_event = e.event_type)
           and not exists (select 1 from public.points_award_decisions d where d.event_id = e.id)
         order by e.occurred_at desc limit 5
      ) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.my_points_pending() from public, anon;
grant execute on function public.my_points_pending() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Refund returns the points that payment spent
-- ---------------------------------------------------------------------------
-- Replaces S73's private.orders_pricing_effects: the cancelled / failed / paid branches are unchanged; a new 'refunded' branch returns the points
-- that were spent on this order, once (the ledger's unique key on patient, source and reason makes a second call a no-op). Returned points are
-- kind 'release', so tiers, caps and badges (which count only 'earn') never count them as earning, and lifetime_earned is not touched.
create or replace function private.orders_pricing_effects() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_bal public.wellness_points_balances%rowtype;
  v_spend integer;
  v_spent integer;
  v_ledger uuid;
begin
  if new.state is not distinct from old.state then return new; end if;
  if new.state in ('cancelled', 'failed') then
    update public.discount_redemptions set state = 'released', settled_at = now() where order_id = new.id and state = 'reserved';
  elsif new.state = 'paid' then
    update public.discount_redemptions set state = 'redeemed', settled_at = now() where order_id = new.id and state <> 'redeemed';
    if new.points_applied > 0 then
      select * into v_bal from public.wellness_points_balances where patient_id = new.buyer_profile_id for update;
      if found and v_bal.balance > 0 then
        v_spend := least(new.points_applied, v_bal.balance);
        update public.wellness_points_balances set balance = balance - v_spend, updated_at = now() where patient_id = new.buyer_profile_id;
        insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, source_table, source_id)
        values (v_bal.organisation_id, new.buyer_profile_id, -v_spend, v_bal.balance - v_spend, 'applied_to_order', 'orders', new.id)
        on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing;
      end if;
    end if;
  elsif new.state = 'refunded' and new.points_applied > 0 then
    select -l.points into v_spent from public.wellness_points_ledger l
     where l.patient_id = new.buyer_profile_id and l.source_table = 'orders' and l.source_id = new.id
       and l.reason = 'applied_to_order' and l.points < 0;
    if found and v_spent > 0 then
      select * into v_bal from public.wellness_points_balances where patient_id = new.buyer_profile_id for update;
      if found then
        insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, source_table, source_id, kind)
        values (v_bal.organisation_id, new.buyer_profile_id, v_spent, v_bal.balance + v_spent, 'order_refunded', 'orders', new.id, 'release')
        on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing
        returning id into v_ledger;
        if v_ledger is not null then
          update public.wellness_points_balances set balance = balance + v_spent, updated_at = now() where patient_id = new.buyer_profile_id;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.orders_pricing_effects() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6b. Silent backfill: people who already have these steps in their history never get a "first" card
-- ---------------------------------------------------------------------------
-- Rows are born dismissed and seen, flagged backfilled, with no event. Counts for the dry run: select count(*) from milestones_achieved where backfilled.
insert into public.milestones_achieved (organisation_id, patient_id, milestone_code, milestone_version, event_id, backfilled, achieved_at, seen_at, dismissed_at)
select p.organisation_id, h.patient_id, h.code, 1, null, true, now(), now(), now()
  from (
    select distinct v.patient_id, 'first_bp_logged'::text as code from private.vitals_readings_current v
     where v.systolic is not null and v.diastolic is not null and v.vital_type::text not in ('weight', 'waist_circumference')
    union
    select distinct v.patient_id, 'first_glucose_logged' from private.vitals_readings_current v
     where v.glucose_mmol_l is not null and v.vital_type::text not in ('weight', 'waist_circumference')
    union
    select distinct l.patient_id, 'first_lab_done' from public.lab_results l where l.release_state = 'released'
    union
    select distinct x.patient_id, 'first_review_attended' from public.encounters x where x.status = 'completed'
    union
    select distinct e.patient_id, 'first_lab_done' from public.domain_events e where e.event_type = 'lab_result.released' and e.patient_id is not null
    union
    select distinct e.patient_id, 'first_review_attended' from public.domain_events e where e.event_type = 'encounter.completed' and e.patient_id is not null
    union
    select distinct e.patient_id, 'first_lesson_completed' from public.domain_events e where e.event_type = 'lesson.completed' and e.patient_id is not null
    union
    select distinct e.patient_id, 'first_course_completed' from public.domain_events e where e.event_type = 'course.completed' and e.patient_id is not null
  ) h
  join public.profiles p on p.id = h.patient_id
 where p.organisation_id is not null
on conflict (patient_id, milestone_code) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.milestone_definitions where is_active) < 7 then raise exception 'expected 7 seeded milestones'; end if;
  begin
    insert into public.milestone_definitions (code, version, kind, trigger_event) values ('first_weight_loss', 1, 'first_event', 'vitals.logged');
    raise exception 'a body-metric milestone was accepted';
  exception when check_violation then null; end;
  if has_table_privilege('authenticated', 'public.milestones_achieved', 'INSERT')
     or has_table_privilege('authenticated', 'public.milestones_achieved', 'UPDATE')
     or has_table_privilege('authenticated', 'public.milestones_achieved', 'DELETE') then
    raise exception 'authenticated can write milestones_achieved';
  end if;
  if has_table_privilege('anon', 'public.milestones_achieved', 'SELECT') then raise exception 'anon can read milestones_achieved'; end if;
  if has_function_privilege('anon', 'public.my_points_pending()', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_pending_milestone()', 'EXECUTE')
     or has_function_privilege('anon', 'public.dismiss_milestone(uuid)', 'EXECUTE') then
    raise exception 'anon can execute a rewards function';
  end if;
  if has_function_privilege('authenticated', 'public.points_award(uuid)', 'EXECUTE') then raise exception 'authenticated can execute points_award'; end if;
  -- still no second redemption path and no rate
  if to_regclass('public.reward_redemptions') is not null or to_regprocedure('public.apply_points_discount(uuid,integer)') is not null then
    raise exception 'a second points redemption path exists';
  end if;
end $$;
