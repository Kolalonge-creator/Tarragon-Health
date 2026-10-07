-- S68f: the life-stage state machine (Module 16 function 16.11): tracking, trying, pregnant, postnatal, parenting.
--
-- THE RULE THAT SHAPES IT: a stage changes ONLY because a person (or a clinician) CONFIRMED an event: a pregnancy, a delivery, a loss, the end of
-- the postnatal period, the start or end of planning. Nothing infers a stage from a date, a missed period, a weight or an age. The app may ASK
-- ("has your baby arrived?") after a time; it never moves the stage itself. A pregnancy that is switched off in the pregnancy record without a
-- delivery or loss event does NOT move the stage; the person is asked.
--   - Transitions are data (lifecycle.rules, PROPOSED), so a stage can not be reached by a path the configuration does not list.
--   - Each change writes an append-only lifecycle_events row (who, which event, which rule version) and emits lifecycle.stage_changed (plus
--     delivery.recorded or pregnancy.loss_recorded) through the outbox.
--   - The stage switches content and thresholds: my_lifecycle() returns the content set and the blood pressure rule-set NAME for the stage. S67 reads
--     it to choose the pregnancy rule set; this migration does not touch any BP rule.
--   - Pregnancy loss: a gentle path. The stage returns to tracking and a hold date hides every baby and pregnancy content block until it passes.
--     The loss note is the person's own and is readable by nobody except the person and staff (never a caregiver, never a supporter, never a sponsor).
--     The loss copy is a placeholder in maternal_child_content (founder or CMO to write; OQ-356).
--   - Behind maternal_enabled: record_lifecycle_event refuses (55000) while the guard is off, unless the person is a test account.
--   - Adolescent gate: a caregiver branch reads lifecycle rows only with an explicit reproductive_health grant and only for an adult, as everywhere.
-- Live state read 2026-10-07: patient_pregnancy and postnatal_profiles have no rows needing conversion; lifecycle_states starts empty and a person
-- with no row is "tracking".

-- s68-config-lifecycle.rules-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('lifecycle.rules', 1, true, 'proposed', '2026-10-07', $json${"transitions":{"start_trying":{"from":["tracking"],"to":"trying"},"stop_trying":{"from":["trying"],"to":"tracking"},"pregnancy_confirmed":{"from":["tracking","trying","postnatal","parenting"],"to":"pregnant"},"delivery_recorded":{"from":["tracking","trying","pregnant"],"to":"postnatal"},"pregnancy_loss_recorded":{"from":["pregnant"],"to":"tracking"},"postnatal_period_ended":{"from":["postnatal"],"to":"parenting"},"parenting_ended":{"from":["parenting"],"to":"tracking"}},"stage_content":{"tracking":"cycle","trying":"conception","pregnant":"pregnancy","postnatal":"postnatal","parenting":"child"},"stage_bp_rule_set":{"pregnant":"pregnancy","postnatal":"postpartum"},"loss_baby_content_hold_days":90,"max_days_back":400}$json$::jsonb,
 'Founder scope S68 (16.11): transitions only on confirmed events. Stage names, the stage to content map, the rule-set names S67 reads, the 90 day hold on baby content after a loss and the 400 day look-back are proposals for the CMO and founder (OQ-356).');
-- s68-config-lifecycle.rules-end

create table public.lifecycle_states (
  patient_id       uuid primary key references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  stage            text not null default 'tracking' check (stage in ('tracking', 'trying', 'pregnant', 'postnatal', 'parenting')),
  stage_since      timestamptz not null default now(),
  baby_content_hold_until date,
  last_event_id    uuid,
  updated_at       timestamptz not null default now()
);
create index lifecycle_states_org_idx on public.lifecycle_states (organisation_id);

create table public.lifecycle_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('start_trying', 'stop_trying', 'pregnancy_confirmed', 'delivery_recorded', 'pregnancy_loss_recorded', 'postnatal_period_ended', 'parenting_ended')),
  from_stage       text not null,
  to_stage         text not null,
  occurred_on      date not null,
  cause            text not null check (cause in ('self_confirmed', 'clinician_recorded', 'pregnancy_record', 'postnatal_record')),
  recorded_by      uuid references public.profiles (id) on delete restrict,
  config_version   integer not null,
  created_at       timestamptz not null default now()
);
create index lifecycle_events_patient_idx on public.lifecycle_events (patient_id, created_at desc);

create table public.pregnancy_loss_records (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  occurred_on      date not null,
  gestation_weeks  integer check (gestation_weeks is null or gestation_weeks between 1 and 45),
  note             text check (note is null or length(note) <= 2000),
  source           text not null check (source in ('patient_entered', 'clinician_recorded')),
  recorded_by      uuid references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now()
);
create index pregnancy_loss_records_patient_idx on public.pregnancy_loss_records (patient_id);

create or replace function private.lifecycle_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger lifecycle_events_append_only before update or delete on public.lifecycle_events for each row execute function private.lifecycle_append_only();

alter table public.lifecycle_states enable row level security;
alter table public.lifecycle_events enable row level security;
alter table public.pregnancy_loss_records enable row level security;
revoke all on public.lifecycle_states, public.lifecycle_events, public.pregnancy_loss_records from public, anon, authenticated;
-- Reads only. Every write is one of the SECURITY DEFINER functions below; the loss note is deleted only through the S68g function.
grant select on public.lifecycle_states, public.lifecycle_events, public.pregnancy_loss_records to authenticated;
create policy lifecycle_states_select on public.lifecycle_states for select to authenticated
  using (patient_id = (select auth.uid()) or private.maternal_staff_may_read(patient_id, organisation_id) or private.maternal_caregiver_may_read(patient_id));
create policy lifecycle_events_select on public.lifecycle_events for select to authenticated
  using (patient_id = (select auth.uid()) or private.maternal_staff_may_read(patient_id, organisation_id) or private.maternal_caregiver_may_read(patient_id));
-- A loss is the most private of these: the person and staff only. No caregiver branch at all.
create policy pregnancy_loss_records_select on public.pregnancy_loss_records for select to authenticated
  using (patient_id = (select auth.uid()) or private.maternal_staff_may_read(patient_id, organisation_id));

-- ---------------------------------------------------------------------------
-- The one function that moves a stage. Internal: callers are record_lifecycle_event and the two record hooks.
-- ---------------------------------------------------------------------------
create or replace function private.lifecycle_apply(
  p_patient uuid, p_kind text, p_occurred_on date, p_cause text, p_recorded_by uuid, p_strict boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := private.maternal_child_rules('lifecycle.rules');
  v_ver integer := private.maternal_child_config_version('lifecycle.rules');
  v_org uuid; v_state public.lifecycle_states%rowtype; v_rule jsonb; v_to text; v_event uuid; v_hold date;
begin
  if c is null then raise exception 'lifecycle configuration is missing' using errcode = '55000'; end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then raise exception 'unknown person' using errcode = '22023'; end if;
  insert into public.lifecycle_states (patient_id, organisation_id) values (p_patient, v_org) on conflict (patient_id) do nothing;
  select * into v_state from public.lifecycle_states where patient_id = p_patient for update;
  v_rule := c -> 'transitions' -> p_kind;
  if v_rule is null then raise exception 'unknown lifecycle event' using errcode = '22023'; end if;
  if not (v_state.stage in (select jsonb_array_elements_text(v_rule -> 'from'))) then
    if p_strict then raise exception 'That change is not available from this stage' using errcode = '22023'; end if;
    return jsonb_build_object('changed', false, 'stage', v_state.stage);
  end if;
  if p_occurred_on > current_date or p_occurred_on < current_date - (c ->> 'max_days_back')::integer then
    raise exception 'The date must be today or earlier, and not too long ago' using errcode = '22023';
  end if;
  v_to := v_rule ->> 'to';
  v_hold := case when p_kind = 'pregnancy_loss_recorded' then current_date + (c ->> 'loss_baby_content_hold_days')::integer else null end;

  insert into public.lifecycle_events (organisation_id, patient_id, kind, from_stage, to_stage, occurred_on, cause, recorded_by, config_version)
  values (v_org, p_patient, p_kind, v_state.stage, v_to, p_occurred_on, p_cause, p_recorded_by, v_ver) returning id into v_event;
  update public.lifecycle_states
     set stage = v_to, stage_since = now(), last_event_id = v_event, updated_at = now(),
         baby_content_hold_until = case when p_kind = 'pregnancy_loss_recorded' then v_hold
                                        when v_to in ('pregnant', 'postnatal') then null else baby_content_hold_until end
   where patient_id = p_patient;

  perform private.emit_domain_event('lifecycle.stage_changed', v_org,
    jsonb_build_object('from_stage', v_state.stage, 'to_stage', v_to, 'cause', p_cause),
    'lifecycle.stage_changed:' || v_event, p_patient, 'lifecycle_events', v_event);
  return jsonb_build_object('changed', true, 'stage', v_to, 'event_id', v_event);
end $$;
revoke all on function private.lifecycle_apply(uuid, text, date, text, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What a person (or a clinician for a patient) calls to CONFIRM an event
-- ---------------------------------------------------------------------------
create or replace function public.record_lifecycle_event(
  p_kind text, p_occurred_on date default current_date, p_patient uuid default null,
  p_gestation_weeks integer default null, p_note text default null, p_delivery_mode text default 'unknown')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, v_uid);
  v_org uuid; v_staff boolean := false; v_res jsonb; v_cause text; v_loss uuid; v_pp uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_patient;
  if v_org is null then raise exception 'unknown person' using errcode = '22023'; end if;
  if v_patient <> v_uid then
    v_staff := private.is_org_staff(v_org) and v_org = (select organisation_id from public.profiles where id = v_uid);
    if not v_staff then raise exception 'you can only confirm this for yourself' using errcode = '42501'; end if;
  end if;
  if not private.go_live_open_patient('maternal_enabled', v_patient) then
    raise exception 'This is not open yet' using errcode = '55000', hint = 'maternal_enabled';
  end if;
  if p_delivery_mode not in ('vaginal', 'assisted', 'caesarean', 'unknown') then raise exception 'unknown delivery mode' using errcode = '22023'; end if;
  v_cause := case when v_staff then 'clinician_recorded' else 'self_confirmed' end;

  perform set_config('tarragon.lifecycle_internal', '1', true);
  v_res := private.lifecycle_apply(v_patient, p_kind, p_occurred_on, v_cause, v_uid, true);

  if p_kind = 'pregnancy_confirmed' then
    insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_patient, true)
      on conflict (patient_id) do update set is_pregnant = true;
  elsif p_kind = 'delivery_recorded' then
    insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode)
    values (v_org, v_patient, p_occurred_on, p_delivery_mode) returning id into v_pp;
    update public.patient_pregnancy set is_pregnant = false where patient_id = v_patient;
    perform private.emit_domain_event('delivery.recorded', v_org, jsonb_build_object('postnatal_profile_id', v_pp),
      'delivery.recorded:' || v_pp, v_patient, 'postnatal_profiles', v_pp);
  elsif p_kind = 'pregnancy_loss_recorded' then
    insert into public.pregnancy_loss_records (organisation_id, patient_id, occurred_on, gestation_weeks, note, source, recorded_by)
    values (v_org, v_patient, p_occurred_on, p_gestation_weeks, p_note, case when v_staff then 'clinician_recorded' else 'patient_entered' end, v_uid)
    returning id into v_loss;
    update public.patient_pregnancy set is_pregnant = false where patient_id = v_patient;
    perform private.emit_domain_event('pregnancy.loss_recorded', v_org, jsonb_build_object('loss_id', v_loss),
      'pregnancy.loss_recorded:' || v_loss, v_patient, 'pregnancy_loss_records', v_loss);
  end if;
  perform set_config('tarragon.lifecycle_internal', '', true);
  return v_res;
end $$;
revoke all on function public.record_lifecycle_event(text, date, uuid, integer, text, text) from public, anon;
grant execute on function public.record_lifecycle_event(text, date, uuid, integer, text, text) to authenticated;

-- What the app reads to switch content and thresholds. Self only.
create or replace function public.my_lifecycle()
returns table (stage text, stage_since timestamptz, content_set text, bp_rule_set text, baby_content_hidden boolean)
language sql stable security definer set search_path = '' as $$
  with c as (select private.maternal_child_rules('lifecycle.rules') as r),
       s as (select coalesce(ls.stage, 'tracking') as stage, ls.stage_since, ls.baby_content_hold_until
               from (select 1) x left join public.lifecycle_states ls on ls.patient_id = (select auth.uid()))
  select s.stage, s.stage_since, (c.r -> 'stage_content' ->> s.stage), (c.r -> 'stage_bp_rule_set' ->> s.stage),
         coalesce(s.baby_content_hold_until >= current_date, false)
    from s, c
   where (select auth.uid()) is not null
$$;
revoke all on function public.my_lifecycle() from public, anon;
grant execute on function public.my_lifecycle() to authenticated;

-- ---------------------------------------------------------------------------
-- Hooks: the two existing records that ARE confirmations. Never raise; skip when the stage does not allow it.
-- ---------------------------------------------------------------------------
create or replace function private.lifecycle_hook_pregnancy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('tarragon.lifecycle_internal', true), '') <> '' then return new; end if;
  if new.is_pregnant and (tg_op = 'INSERT' or not old.is_pregnant) then
    perform private.lifecycle_apply(new.patient_id, 'pregnancy_confirmed', current_date, 'pregnancy_record', (select auth.uid()), false);
  end if;
  return new;
end $$;
revoke all on function private.lifecycle_hook_pregnancy() from public, anon, authenticated;
create trigger patient_pregnancy_lifecycle after insert or update of is_pregnant on public.patient_pregnancy
  for each row execute function private.lifecycle_hook_pregnancy();

create or replace function private.lifecycle_hook_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('tarragon.lifecycle_internal', true), '') <> '' then return new; end if;
  perform private.lifecycle_apply(new.patient_id, 'delivery_recorded', least(new.delivery_date, current_date), 'postnatal_record', (select auth.uid()), false);
  return new;
end $$;
revoke all on function private.lifecycle_hook_delivery() from public, anon, authenticated;
create trigger postnatal_profiles_lifecycle after insert on public.postnatal_profiles
  for each row execute function private.lifecycle_hook_delivery();

do $$ begin
  if has_table_privilege('authenticated', 'public.lifecycle_states', 'INSERT') or has_table_privilege('authenticated', 'public.lifecycle_states', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pregnancy_loss_records', 'INSERT') or has_table_privilege('authenticated', 'public.pregnancy_loss_records', 'DELETE') then
    raise exception 'S68f self-check: the lifecycle tables must be read-only for signed-in roles'; end if;
  if has_function_privilege('anon', 'public.record_lifecycle_event(text,date,uuid,integer,text,text)', 'EXECUTE') or has_function_privilege('anon', 'public.my_lifecycle()', 'EXECUTE') then
    raise exception 'S68f self-check: anon can execute a lifecycle function'; end if;
end $$;
