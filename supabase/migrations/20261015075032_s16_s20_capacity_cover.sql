-- S16-S20 Stage 5: capacity, cover, surge, fatigue and fire drills (plan W5.1 to W5.4; CMO decisions 12, 13, 14, 15).
--
--   W5.1 Intake gate (decision 12). New care pack sales pause when lead headroom, 72 hours of rota cover or the oldest open task cross a
--        configured limit. A CMO override (reason, expiry) reopens the capacity signals but never a surge or a pause. The gate is wired
--        into the sale path as a BEFORE INSERT trigger on orders (so create_order, which other branches also replace, is not restated) and
--        it reads the go-live guard on_call_cover_ok. It ships NOT ENFORCED (capacity_cover_config v1, gate_enforce = 0): v2 turns it on
--        and is inactive and unsigned. Pilot lead cap 40 is lead_config v2, inactive and unsigned.
--   W5.2 Surge mode and pause (decisions 12, 13). CMO-set, recorded, auto-expiring. A pause stops new sales, new enrolments, bookings
--        (through clinical_operations_enabled) and the offering of routine tasks; it NEVER touches red paging, emergency guidance,
--        on-call or work already claimed. An admin can only REQUEST a pause; it lapses unless the CMO confirms in time.
--   W5.3 Hard rest rule and cover offer (decision 14). After a shift with overnight pages a clinician cannot be put on call or declare
--        queue time inside 11 hours of rest unless the CMO records an override with a written reason. After 2 or more overnight pages the
--        system offers the next shift to cover and asks for a fitness confirmation. Ships NOT ENFORCED (hard_rest_enforce = 0).
--   W5.4 Fire drills (decision 15). A monthly unannounced test page to each on-call-rostered clinician, results recorded, p50/p95 report
--        for the CMO, and an INFORMATIONAL reliability event (weight 0: never pay, never removal). Ships OFF (drill_enabled = 0).
--
-- Invariants kept: INV-05 (a red event never waits: nothing here is read by the paging engine), INV-06, INV-07 (fixed neutral notice
-- wording, no clinical words), INV-13 (is_test). Nothing here signs, activates or switches on anything. Values are PROPOSED (owner CMO).
-- Live counts before this change: no real clinician has ever had an overnight page recorded and no ops mode has existed, so no data
-- conversion is needed.

-- ---------------------------------------------------------------------------
-- 1. Configuration
-- ---------------------------------------------------------------------------
create table public.capacity_cover_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index capacity_cover_config_one_active on public.capacity_cover_config (is_active) where is_active;
create index capacity_cover_config_approved_by_idx on public.capacity_cover_config (approved_by) where approved_by is not null;

create function private.capacity_cover_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['min_lead_headroom', 'rota_horizon_hours', 'oldest_task_max_class', 'override_max_hours', 'override_reason_min_chars',
                           'surge_max_hours', 'surge_widen_min_class', 'surge_routine_window_multiplier', 'pause_max_hours', 'pause_confirm_minutes',
                           'pause_hold_min_class', 'reason_min_chars', 'rest_hours', 'rest_min_overnight_pages', 'rest_override_max_days',
                           'cover_offer_pages', 'cover_offer_lookahead_hours', 'drill_interval_days', 'drill_roster_lookahead_days', 'drill_min_gap_minutes', 'drill_busy_hours', 'drill_ack_target_seconds',
                           'drill_ack_target_pct', 'drill_missed_after_minutes', 'drill_max_per_run'] loop
    if not coalesce((r ->> k) ~ '^[0-9]+$' and (r ->> k)::integer > 0, false) then return false; end if;
  end loop;
  foreach k in array array['rota_gap_tolerance_hours', 'overnight_start_hour', 'overnight_end_hour', 'drill_hour_start', 'drill_hour_end'] loop
    if not coalesce((r ->> k) ~ '^[0-9]+$' and (r ->> k)::integer between 0 and 168, false) then return false; end if;
  end loop;
  foreach k in array array['gate_enforce', 'hard_rest_enforce', 'drill_enabled'] loop
    if not coalesce((r ->> k) in ('0', '1'), false) then return false; end if;
  end loop;
  return (r ->> 'overnight_start_hour')::integer <= 23 and (r ->> 'overnight_end_hour')::integer <= 23
     and (r ->> 'drill_hour_start')::integer < (r ->> 'drill_hour_end')::integer and (r ->> 'drill_hour_end')::integer <= 24
     and (r ->> 'drill_ack_target_pct')::integer <= 100;
exception when others then
  return false;
end;
$$;
revoke all on function private.capacity_cover_rules_valid(jsonb) from public, anon, authenticated;
alter table public.capacity_cover_config add constraint capacity_cover_config_rules_valid check (private.capacity_cover_rules_valid(rules));

-- capacity-cover-rules-begin
-- v1 is the active config and every enforcing switch is OFF (0): the gate does not close sales, the hard rest rule does not block a
-- rota change and no drill page is sent. The numbers are still PROPOSED and readable. v2 (below) is the same config with the three
-- switches ON; it is inactive and unsigned, and the CMO signs it in the sign-off hub to turn them on.
insert into public.capacity_cover_config (version, is_active, effective_from, rules) values (1, true, '2026-10-15', $json$
{
  "gate_enforce": 0,
  "min_lead_headroom": 3,
  "rota_horizon_hours": 72,
  "rota_gap_tolerance_hours": 0,
  "oldest_task_max_class": 5,
  "override_max_hours": 24,
  "override_reason_min_chars": 20,
  "reason_min_chars": 20,
  "surge_max_hours": 12,
  "surge_widen_min_class": 4,
  "surge_routine_window_multiplier": 2,
  "pause_max_hours": 24,
  "pause_confirm_minutes": 240,
  "pause_hold_min_class": 6,
  "hard_rest_enforce": 0,
  "rest_hours": 11,
  "overnight_start_hour": 22,
  "overnight_end_hour": 7,
  "rest_min_overnight_pages": 1,
  "rest_override_max_days": 3,
  "cover_offer_pages": 2,
  "cover_offer_lookahead_hours": 36,
  "drill_enabled": 0,
  "drill_interval_days": 30,
  "drill_roster_lookahead_days": 30,
  "drill_min_gap_minutes": 10,
  "drill_busy_hours": 6,
  "drill_ack_target_seconds": 300,
  "drill_ack_target_pct": 90,
  "drill_missed_after_minutes": 60,
  "drill_hour_start": 8,
  "drill_hour_end": 20,
  "drill_max_per_run": 2
}
$json$::jsonb);
-- capacity-cover-rules-end
-- capacity-cover-rules-v2-begin
insert into public.capacity_cover_config (version, is_active, effective_from, rules) values (2, false, '2026-10-15', $json$
{
  "gate_enforce": 1,
  "min_lead_headroom": 3,
  "rota_horizon_hours": 72,
  "rota_gap_tolerance_hours": 0,
  "oldest_task_max_class": 5,
  "override_max_hours": 24,
  "override_reason_min_chars": 20,
  "reason_min_chars": 20,
  "surge_max_hours": 12,
  "surge_widen_min_class": 4,
  "surge_routine_window_multiplier": 2,
  "pause_max_hours": 24,
  "pause_confirm_minutes": 240,
  "pause_hold_min_class": 6,
  "hard_rest_enforce": 1,
  "rest_hours": 11,
  "overnight_start_hour": 22,
  "overnight_end_hour": 7,
  "rest_min_overnight_pages": 1,
  "rest_override_max_days": 3,
  "cover_offer_pages": 2,
  "cover_offer_lookahead_hours": 36,
  "drill_enabled": 1,
  "drill_interval_days": 30,
  "drill_roster_lookahead_days": 30,
  "drill_min_gap_minutes": 10,
  "drill_busy_hours": 6,
  "drill_ack_target_seconds": 300,
  "drill_ack_target_pct": 90,
  "drill_missed_after_minutes": 60,
  "drill_hour_start": 8,
  "drill_hour_end": 20,
  "drill_max_per_run": 2
}
$json$::jsonb);
-- capacity-cover-rules-v2-end

alter table public.capacity_cover_config enable row level security;
create policy capacity_cover_config_read on public.capacity_cover_config for select to authenticated using (true);
revoke all on public.capacity_cover_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.capacity_cover_config from authenticated;
grant select on public.capacity_cover_config to authenticated;

-- A version that is live or signed is frozen (a new version, never an edit); the signature cannot be removed.
create function private.capacity_cover_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_active or old.approved_at is not null then
      raise exception 'capacity_cover_config version % is active or signed and cannot be deleted; draft a new version', old.version using errcode = '23514';
    end if;
    return old;
  end if;
  if (new.version is distinct from old.version or new.rules is distinct from old.rules or new.effective_from is distinct from old.effective_from)
     and (old.is_active or old.approved_at is not null) then
    raise exception 'capacity_cover_config version % is active or signed and cannot be edited; draft a new version', old.version using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed capacity_cover_config keeps its signature' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.capacity_cover_config_guard() from public, anon, authenticated;
create trigger capacity_cover_config_guard before update or delete on public.capacity_cover_config
  for each row execute function private.capacity_cover_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.capacity_cover_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

create function private.cap_rule(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::integer from public.capacity_cover_config where is_active order by version desc limit 1 $$;
revoke all on function private.cap_rule(text) from public, anon, authenticated;

-- The CMO's own act, from the sign-off hub. Nothing else calls it.
create function public.sign_capacity_cover_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.capacity_cover_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the capacity and cover configuration' using errcode = '42501'; end if;
  select * into c from public.capacity_cover_config where version = p_version for update;
  if not found then raise exception 'no such capacity and cover configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  -- the intake gate reads the on_call_cover_ok guard: with the guard off every new care pack sale would be refused the moment this is signed
  if (c.rules ->> 'gate_enforce') = '1' and not private.go_live_guard_on('on_call_cover_ok') then
    raise exception 'switch the on-call cover guard on first (it needs a rota covering the next 7 days); with it off every new care pack sale would be refused' using errcode = '23514';
  end if;
  update public.capacity_cover_config set is_active = false where is_active and version <> p_version;
  update public.capacity_cover_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'capacity_cover_config.signed', 'capacity_cover_config', c.id,
            jsonb_build_object('version', p_version));
end;
$$;
revoke all on function public.sign_capacity_cover_config(integer) from public, anon, authenticated;
grant execute on function public.sign_capacity_cover_config(integer) to authenticated;

-- Pilot lead cap (decision 12): lead_config version 2 = version 1 with max_lead_patients 40. Inactive and unsigned. Version 1 is untouched.
alter table public.lead_config
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null;
create index if not exists lead_config_approved_by_idx on public.lead_config (approved_by) where approved_by is not null;
create trigger refuse_superseded_activation before update of is_active on public.lead_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
-- lead-cap-pilot-begin
insert into public.lead_config (version, is_active, effective_from, rules)
select 2, false, '2026-10-15', jsonb_set(rules, '{max_lead_patients}', '40'::jsonb) from public.lead_config where version = 1;
-- lead-cap-pilot-end
create function public.sign_lead_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.lead_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the lead configuration' using errcode = '42501'; end if;
  select * into c from public.lead_config where version = p_version for update;
  if not found then raise exception 'no such lead configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.lead_config set is_active = false where is_active and version <> p_version;
  update public.lead_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'lead_config.signed', 'lead_config', c.id,
            jsonb_build_object('version', p_version));
end;
$$;
revoke all on function public.sign_lead_config(integer) from public, anon, authenticated;
grant execute on function public.sign_lead_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Surge, pause and intake overrides
-- ---------------------------------------------------------------------------
create table public.ops_modes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  mode            text not null check (mode in ('surge', 'pause')),
  state           text not null check (state in ('requested', 'active', 'lapsed', 'ended', 'declined')),
  reason          text not null check (char_length(btrim(reason)) > 0),
  requested_by    uuid references public.profiles (id) on delete set null,
  requested_at    timestamptz not null default now(),
  confirm_by      timestamptz,
  started_by      uuid references public.profiles (id) on delete set null,
  started_at      timestamptz,
  expires_at      timestamptz,
  ended_by        uuid references public.profiles (id) on delete set null,
  ended_at        timestamptz,
  end_kind        text check (end_kind in ('manual', 'expired', 'unconfirmed', 'declined')),
  end_note        text,
  config_version  integer not null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (state <> 'active' or (started_at is not null and expires_at is not null)),
  check (state <> 'requested' or (confirm_by is not null and mode = 'pause'))
);
create unique index ops_modes_one_active on public.ops_modes (organisation_id, mode, is_test) where state = 'active';
create unique index ops_modes_one_request on public.ops_modes (organisation_id, mode, is_test) where state = 'requested';
create index ops_modes_org_idx on public.ops_modes (organisation_id, created_at desc);
create index ops_modes_requested_by_idx on public.ops_modes (requested_by) where requested_by is not null;
create index ops_modes_started_by_idx on public.ops_modes (started_by) where started_by is not null;
create index ops_modes_ended_by_idx on public.ops_modes (ended_by) where ended_by is not null;

create table public.intake_overrides (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  reason          text not null check (char_length(btrim(reason)) > 0),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz,
  ended_by        uuid references public.profiles (id) on delete set null,
  config_version  integer not null,
  is_test         boolean not null default false,
  check (expires_at > created_at)
);
create unique index intake_overrides_one_open on public.intake_overrides (organisation_id, is_test) where ended_at is null;
create index intake_overrides_created_by_idx on public.intake_overrides (created_by) where created_by is not null;
create index intake_overrides_ended_by_idx on public.intake_overrides (ended_by) where ended_by is not null;

alter table public.ops_modes enable row level security;
alter table public.intake_overrides enable row level security;
create policy ops_modes_read on public.ops_modes for select to authenticated
  using (private.can_credential_review() and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid())));
create policy intake_overrides_read on public.intake_overrides for select to authenticated
  using (private.can_credential_review() and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid())));
revoke all on public.ops_modes, public.intake_overrides from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.ops_modes, public.intake_overrides from authenticated;
grant select on public.ops_modes, public.intake_overrides to authenticated;

-- Is a mode in force right now? Reads the clock itself (expires_at), so a dead sweep job cannot leave a pause on forever.
-- p_test picks the test or the real rows (INV-13): a test CMO's pause never touches real patients or clinicians.
create function private.ops_mode_active(p_mode text, p_org uuid default null, p_test boolean default false) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.ops_modes m
                  where m.mode = p_mode and m.state = 'active' and m.expires_at > now() and m.is_test = coalesce(p_test, false)
                    and (p_org is null or m.organisation_id = p_org))
$$;
revoke all on function private.ops_mode_active(text, uuid, boolean) from public, anon, authenticated;

-- A pause closes NEW bookings and NEW consultation requests, never care that is already paid or booked. The guard
-- clinical_operations_enabled also gates accept_video_visit_request, select_video_visit_alternate_slot, confirm_appointment_booking,
-- service_get_encounter_room and hold_appointment_slot (which a paid service purchase, a caregiver booking and a patient picking a slot a doctor
-- already offered all call): those serve a patient who has already asked, paid or been offered, so they are left exactly as they are. Only the two
-- entry points that start NEW work ask the intake variants below (live: create_followup_offer and the video visit request insert trigger). New
-- sales are held by the orders trigger below. go_live_guard_on itself is not touched, so a pause cannot reach anything else that reads it.
create function private.go_live_open_intake(p_key text, p_patient uuid default null, p_clinician uuid default null) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.go_live_open(p_key, p_patient, p_clinician)
     and not (p_key = 'clinical_operations_enabled' and p_patient is not null
              and private.ops_mode_active('pause', (select pr.organisation_id from public.profiles pr where pr.id = p_patient),
                                          coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), false)))
$$;
revoke all on function private.go_live_open_intake(text, uuid, uuid) from public, anon, authenticated;

create function private.go_live_open_patient_intake(p_key text, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.go_live_open_patient(p_key, p_patient)
     and not (p_key = 'clinical_operations_enabled' and p_patient is not null
              and private.ops_mode_active('pause', (select pr.organisation_id from public.profiles pr where pr.id = p_patient),
                                          coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), false)))
$$;
revoke all on function private.go_live_open_patient_intake(text, uuid) from public, anon, authenticated;

do $intake$
declare
  r record; v_def text; v_new text;
begin
  for r in select * from (values
      ('private.create_followup_offer(uuid,uuid,timestamptz[],text,integer)', 'private.go_live_open(''clinical_operations_enabled''', 'private.go_live_open_intake(''clinical_operations_enabled'''),
      ('private.video_visit_requests_go_live_guard()', 'private.go_live_open_patient(''clinical_operations_enabled''', 'private.go_live_open_patient_intake(''clinical_operations_enabled''')
    ) as t(fn, a, b) loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if v_def like '%go_live_open_intake%' or v_def like '%go_live_open_patient_intake%' then continue; end if;
    v_new := replace(v_def, r.a, r.b);
    if v_new = v_def then raise exception 'S20c: % no longer calls the clinical_operations_enabled guard in the expected form; patch by hand', r.fn; end if;
    execute v_new;
  end loop;
end
$intake$;

-- Surge widens who may TAKE a routine task offered to a lead. queue_candidates shows it; the claim itself is checked in apply_task_transition,
-- which still refused anyone but the named clinician, so a non-lead who picked the task would have failed on every retry. Patched from the
-- CURRENT definition: the refusal stands except while a surge is on for a routine (class widen_class or lower urgency, never red) task.
do $claim$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.apply_task_transition(uuid,public.clinical_task_state,text,uuid,text,uuid,timestamptz,jsonb)'::regprocedure);
  if v_def like '%ops_mode_active%' then return; end if;
  v_new := replace(v_def, 'if t.state = ''offered_to_lead'' and p_claimed_by is distinct from t.pushed_to and p_claimed_by is distinct from t.lead_clinician_id then',
    'if t.state = ''offered_to_lead'' and p_claimed_by is distinct from t.pushed_to and p_claimed_by is distinct from t.lead_clinician_id
       and not (t.priority_class >= coalesce(private.cap_rule(''surge_widen_min_class''), 4) and t.priority_class_original > 1
                and private.ops_mode_active(''surge'', t.organisation_id, t.is_test)) then');
  if v_new = v_def then raise exception 'S20c: apply_task_transition no longer has the offered_to_lead refusal in the expected form; patch by hand'; end if;
  execute v_new;
end
$claim$;

-- ---------------------------------------------------------------------------
-- 3. The intake gate (W5.1)
-- ---------------------------------------------------------------------------
create function private.lead_headroom(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cap integer := (private.lead_rule('max_lead_patients') #>> '{}')::integer;
  v_min public.doctor_tier := (private.lead_rule('lead_min_doctor_tier') #>> '{}')::public.doctor_tier;
  v_comps text[] := array(select jsonb_array_elements_text(private.lead_rule('required_competencies')));
  v_total integer;
  v_used integer;
begin
  -- the same population and arithmetic as public.lead_capacity_status (proved equal)
  select coalesce(sum(coalesce(cs.max_lead_patients, v_cap)), 0), coalesce(sum((select count(*) from public.lead_assignments la where la.clinician_id = cs.profile_id and la.state = 'active' and not la.is_test)), 0)
    into v_total, v_used
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.profile_id is not null and cs.active and cs.status = 'active' and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(v_min)
     and private.clinician_is_eligible(cs.profile_id)
     and not exists (select 1 from unnest(v_comps) k where not private.has_competency(cs.profile_id, k));
  return jsonb_build_object('capacity', v_total, 'in_use', v_used, 'free', greatest(v_total - v_used, 0));
end;
$$;
revoke all on function private.lead_headroom(uuid) from public, anon, authenticated;

-- The three signals and the verdict, for the real (non-test) world. Reading only; closing is decided by intake_open.
create function private.intake_gate_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  h jsonb := private.lead_headroom(p_org);
  v_free integer := (h ->> 'free')::integer;
  v_min integer := coalesce(private.cap_rule('min_lead_headroom'), 3);
  v_horizon integer := coalesce(private.cap_rule('rota_horizon_hours'), 72);
  v_tol integer := coalesce(private.cap_rule('rota_gap_tolerance_hours'), 0);
  v_maxclass integer := coalesce(private.cap_rule('oldest_task_max_class'), 5);
  v_gap numeric;
  v_breach jsonb;
  v_reasons text[] := '{}';
begin
  select coalesce(sum(extract(epoch from (gap_end - gap_start)) / 3600.0), 0) into v_gap from private.rota_gaps(p_org, now(), now() + make_interval(hours => v_horizon));
  select coalesce(jsonb_agg(b), '[]'::jsonb) into v_breach from jsonb_array_elements(private.queue_class_breaches()) b where (b ->> 'priority_class')::integer <= v_maxclass;
  if v_free < v_min then v_reasons := array_append(v_reasons, 'lead_headroom'); end if;
  if v_gap > v_tol then v_reasons := array_append(v_reasons, 'rota_coverage'); end if;
  if jsonb_array_length(v_breach) > 0 then v_reasons := array_append(v_reasons, 'oldest_task'); end if;
  return jsonb_build_object('open', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
    'lead_capacity', (h ->> 'capacity')::integer, 'lead_in_use', (h ->> 'in_use')::integer, 'lead_free', v_free, 'min_lead_headroom', v_min,
    'rota_gap_hours', round(v_gap, 1), 'rota_horizon_hours', v_horizon, 'class_breaches', v_breach);
end;
$$;
revoke all on function private.intake_gate_status(uuid) from public, anon, authenticated;

-- May a NEW sale or enrolment for this patient go ahead? Order: an active pause or surge closes it (always, enforced or not: it is an
-- explicit CMO act); a gate that is not enforced is open; otherwise a CMO override is in force, or the on_call_cover_ok guard is open and the
-- signals are clear. A test patient only ever meets a test pause or surge. Existing care is never asked this question.
create function private.intake_open(p_patient uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_test boolean;
begin
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = p_patient;
  if not found then return true; end if;
  if private.ops_mode_active('pause', v_org, v_test) or private.ops_mode_active('surge', v_org, v_test) then return false; end if;
  if v_test or coalesce(private.cap_rule('gate_enforce'), 0) <> 1 then return true; end if;
  begin
    -- a CMO override reopens the guard and the three signals together (it never reopens a pause or a surge: those were tested above)
    if exists (select 1 from public.intake_overrides o where o.organisation_id = v_org and not o.is_test and o.ended_at is null and o.expires_at > now()) then return true; end if;
    if not private.go_live_open_patient('on_call_cover_ok', p_patient) then return false; end if;
    return coalesce((private.intake_gate_status(v_org) ->> 'open')::boolean, false);
  exception when others then
    return false;   -- an enforced gate that cannot be evaluated is closed; it only ever stops NEW sales
  end;
end;
$$;
revoke all on function private.intake_open(uuid) from public, anon, authenticated;

-- Wired into the sale path as a trigger so create_order (replaced by several branches) is not restated here. Only an order for an item that
-- grants a lead clinician, for someone who has no active lead yet, is asked. An order already created is never undone, and a patient with
-- an active lead (an existing, enrolled patient) is never refused.
create function private.orders_intake_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_test boolean;
begin
  if new.beneficiary_patient_id is null then return new; end if;
  -- a pause (an explicit CMO act) holds EVERY new sale; an order already created and in payment is never undone
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = new.beneficiary_patient_id;
  if found and private.ops_mode_active('pause', v_org, v_test) then
    raise exception 'intake_paused' using errcode = 'P0001', hint = 'intake_gate';
  end if;
  if not exists (select 1 from public.catalog_items ci where ci.id = new.catalog_item_id and ci.grants_lead) then return new; end if;
  if exists (select 1 from public.lead_assignments la where la.patient_id = new.beneficiary_patient_id and la.state = 'active') then return new; end if;
  if not private.intake_open(new.beneficiary_patient_id) then
    raise exception 'intake_paused' using errcode = 'P0001', hint = 'intake_gate';
  end if;
  return new;
end;
$$;
revoke all on function private.orders_intake_gate() from public, anon, authenticated;
create trigger orders_intake_gate before insert on public.orders
  for each row execute function private.orders_intake_gate();

update public.go_live_guards
   set enforced_in = array['orders insert (the intake gate: care pack sales and new lead enrolments, only when capacity_cover_config gate_enforce = 1)'],
       not_enforced_in = 'The gate ships NOT enforced (capacity_cover_config version 1). Signing version 2 turns it on; the guard must then also be switched on. It never stops an existing patient, a payment already started, or any red paging.'
 where key = 'on_call_cover_ok';

-- ---------------------------------------------------------------------------
-- 4. Surge, pause and override functions (W5.2)
-- ---------------------------------------------------------------------------
create function private.ops_audit(p_org uuid, p_actor uuid, p_action text, p_entity text, p_id uuid, p_event jsonb) returns void
language sql security definer set search_path = ''
as $$ insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event) values (p_org, p_actor, p_action, p_entity, p_id, p_event) $$;
revoke all on function private.ops_audit(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Closes anything that ran past its time. Called by the sweep job and before every start, so a stale row never blocks a new one. It is kept
-- small on purpose (no gate evaluation) so the CMO's start button cannot fail because some other part of the system is unwell.
create function private.sweep_ops_modes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_lapsed integer := 0; v_expired integer := 0;
begin
  for r in select * from public.ops_modes where state = 'requested' and confirm_by <= now() for update skip locked loop
    update public.ops_modes set state = 'lapsed', ended_at = now(), end_kind = 'unconfirmed' where id = r.id;
    perform private.ops_audit(r.organisation_id, null, 'ops_mode.lapsed_unconfirmed', 'ops_mode', r.id, jsonb_build_object('mode', r.mode));
    perform private.credential_notify_reviewers(r.organisation_id, 'Pause request lapsed', 'A request to pause new intake was not confirmed in time and has lapsed. Nothing was paused.', jsonb_build_object('ops_mode_id', r.id), 'ops_mode');
    v_lapsed := v_lapsed + 1;
  end loop;
  for r in select * from public.ops_modes where state = 'active' and expires_at <= now() for update skip locked loop
    update public.ops_modes set state = 'lapsed', ended_at = now(), end_kind = 'expired' where id = r.id;
    perform private.ops_audit(r.organisation_id, null, 'ops_mode.expired', 'ops_mode', r.id, jsonb_build_object('mode', r.mode));
    perform private.credential_notify_reviewers(r.organisation_id, case r.mode when 'surge' then 'Surge mode ended' else 'Pause ended' end,
      case r.mode when 'surge' then 'Surge mode reached its end time and has switched off.' else 'The pause on new intake reached its end time and has switched off.' end,
      jsonb_build_object('ops_mode_id', r.id), 'ops_mode');
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('lapsed_requests', v_lapsed, 'expired', v_expired);
end;
$$;
revoke all on function private.sweep_ops_modes() from public, anon, authenticated;
select cron.schedule('ops-mode-sweep', '19-59/10 * * * *', $$ select private.sweep_ops_modes(); $$);

-- Watches the gate itself, in its own job so a fault here never touches the sweep or the CMO's buttons: opens one incident when an enforced
-- gate has closed on its own, and one when the gate cannot be evaluated at all (an enforced gate that cannot be evaluated is closed, so this
-- is how a person finds out). A failure of this job shows in record-cron-failures like any other job.
create function private.raise_intake_gate_incident() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_status jsonb; v_n integer := 0;
begin
  if coalesce(private.cap_rule('gate_enforce'), 0) <> 1 then return 0; end if;
  for r in select o.id as org from public.organisations o
            where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.active and cs.status = 'active' and not cs.is_test) loop
    if not private.go_live_guard_on('on_call_cover_ok')
       and not exists (select 1 from public.ops_incidents i where i.external_reference = 'intake_gate_guard:' || r.org and i.status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (r.org, 'clinical', 'sev3', 'New care pack sales are refused: the on-call cover guard is off',
              'The intake gate is on, but the go-live guard on_call_cover_ok is off, so every new care pack sale and enrolment is refused. Existing patients are not affected. Switch the guard on (it needs a rota covering the next 7 days) or ask the clinical lead for an override.',
              'intake_gate_guard:' || r.org, now(), now());
      v_n := v_n + 1;
    end if;
    begin
      v_status := private.intake_gate_status(r.org);
    exception when others then
      if not exists (select 1 from public.ops_incidents i where i.external_reference = 'intake_gate_error:' || r.org and i.status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values (r.org, 'technical', 'sev2', 'The intake gate cannot be evaluated',
                'New care pack sales are being refused because the gate could not read one of its signals (' || sqlstate || '). Existing patients are not affected. Check lead capacity, the on-call rota and the queue health view.',
                'intake_gate_error:' || r.org, now(), now());
        v_n := v_n + 1;
      end if;
      continue;
    end;
    if not coalesce((v_status ->> 'open')::boolean, true)
       and not exists (select 1 from public.ops_incidents i where i.external_reference = 'intake_gate:' || r.org and i.status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (r.org, 'clinical', 'sev3', 'New care pack sales paused automatically',
              'The intake gate closed because lead headroom, rota cover or the oldest open task crossed its limit. Existing patients are not affected. Open Capacity to see which signal and to record an override.',
              'intake_gate:' || r.org, now(), now());
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.raise_intake_gate_incident() from public, anon, authenticated;
select cron.schedule('intake-gate-watch', '9-59/10 * * * *', $$ select private.raise_intake_gate_incident(); $$);

create function private.cap_caller() returns table (id uuid, organisation_id uuid, is_test boolean)
language sql stable security definer set search_path = ''
as $$ select pr.id, pr.organisation_id, coalesce(pr.is_test, false) from public.profiles pr where pr.id = (select auth.uid()) $$;
revoke all on function private.cap_caller() from public, anon, authenticated;

-- The CMO starts surge mode or a pause. Hours are capped by config; a reason is required; it expires by itself.
create function public.cmo_start_ops_mode(p_mode text, p_reason text, p_hours integer) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_max integer;
  v_id uuid;
  v_ver integer;
  v_backup uuid;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can do this' using errcode = '42501'; end if;
  if p_mode not in ('surge', 'pause') then raise exception 'unknown mode' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < coalesce(private.cap_rule('reason_min_chars'), 20) then
    raise exception 'a written reason of at least % characters is required', coalesce(private.cap_rule('reason_min_chars'), 20) using errcode = '22023';
  end if;
  v_max := case p_mode when 'surge' then private.cap_rule('surge_max_hours') else private.cap_rule('pause_max_hours') end;
  if p_hours is null or p_hours < 1 or p_hours > v_max then raise exception 'choose between 1 and % hours', v_max using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('ops_mode:' || c.organisation_id));
  perform private.sweep_ops_modes();
  if exists (select 1 from public.ops_modes m where m.organisation_id = c.organisation_id and m.mode = p_mode and m.is_test = c.is_test and m.state = 'active') then
    raise exception 'that mode is already on' using errcode = '22023';
  end if;
  select version into v_ver from public.capacity_cover_config where is_active;
  -- a request waiting for this very decision is closed by the CMO acting directly
  update public.ops_modes set state = 'declined', ended_at = now(), ended_by = c.id, end_kind = 'declined', end_note = 'The chief medical officer acted directly.'
   where organisation_id = c.organisation_id and mode = p_mode and is_test = c.is_test and state = 'requested';
  insert into public.ops_modes (organisation_id, mode, state, reason, requested_by, started_by, started_at, expires_at, config_version, is_test)
  values (c.organisation_id, p_mode, 'active', btrim(p_reason), c.id, c.id, now(), now() + make_interval(hours => p_hours), v_ver, c.is_test)
  returning id into v_id;
  perform private.ops_audit(c.organisation_id, c.id, 'ops_mode.started', 'ops_mode', v_id, jsonb_build_object('mode', p_mode, 'hours', p_hours, 'reason', btrim(p_reason)));
  if p_mode = 'surge' then
    -- tell the on-call backup (decision 12); a missing rota is not an error, the CMO still has the mode on
    select r.backup_clinician_id into v_backup from public.on_call_rota r
     where r.organisation_id = c.organisation_id and r.cancelled_at is null and r.starts_at <= now() and r.ends_at > now() and r.is_test = c.is_test limit 1;
    if v_backup is not null then
      perform private.credential_notify(v_backup, c.organisation_id, 'Surge mode is on', 'The clinical lead has switched on surge mode. Routine tasks can be taken by any eligible clinician and routine times are longer. Urgent pages work as before.', jsonb_build_object('ops_mode_id', v_id, 'audience', 'surge'), false);
    end if;
  end if;
  perform private.credential_notify_reviewers(c.organisation_id, case p_mode when 'surge' then 'Surge mode started' else 'Pause on new intake started' end,
    case p_mode when 'surge' then 'Surge mode is on. New sales and enrolments are paused until it ends.' else 'New sales, enrolments and bookings are paused until it ends. Red paging and work already taken are not affected.' end,
    jsonb_build_object('ops_mode_id', v_id), 'ops_mode');
  return v_id;
end;
$$;
revoke all on function public.cmo_start_ops_mode(text, text, integer) from public, anon;
grant execute on function public.cmo_start_ops_mode(text, text, integer) to authenticated;

-- An admin can only ASK for a pause. It lapses unless the CMO confirms within pause_confirm_minutes (default 4 hours).
create function public.request_ops_pause(p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare c record; v_id uuid; v_ver integer;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.is_admin() then raise exception 'only an administrator can request a pause' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < coalesce(private.cap_rule('reason_min_chars'), 20) then
    raise exception 'a written reason of at least % characters is required', coalesce(private.cap_rule('reason_min_chars'), 20) using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ops_mode:' || c.organisation_id));
  perform private.sweep_ops_modes();
  if exists (select 1 from public.ops_modes m where m.organisation_id = c.organisation_id and m.mode = 'pause' and m.is_test = c.is_test and m.state in ('active', 'requested')) then
    raise exception 'a pause is already on or waiting for the chief medical officer' using errcode = '22023';
  end if;
  select version into v_ver from public.capacity_cover_config where is_active;
  insert into public.ops_modes (organisation_id, mode, state, reason, requested_by, confirm_by, config_version, is_test)
  values (c.organisation_id, 'pause', 'requested', btrim(p_reason), c.id, now() + make_interval(mins => private.cap_rule('pause_confirm_minutes')), v_ver, c.is_test)
  returning id into v_id;
  perform private.ops_audit(c.organisation_id, c.id, 'ops_mode.pause_requested', 'ops_mode', v_id, jsonb_build_object('reason', btrim(p_reason)));
  perform private.credential_notify_reviewers(c.organisation_id, 'Pause request waiting', 'An administrator asked to pause new intake. Open Capacity to confirm or decline before it lapses.', jsonb_build_object('ops_mode_id', v_id), 'ops_mode');
  return v_id;
end;
$$;
revoke all on function public.request_ops_pause(text) from public, anon;
grant execute on function public.request_ops_pause(text) to authenticated;

create function public.cmo_decide_ops_pause(p_id uuid, p_confirm boolean, p_hours integer default null, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare c record; m public.ops_modes%rowtype; v_hours integer;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can do this' using errcode = '42501'; end if;
  select * into m from public.ops_modes where id = p_id and organisation_id = c.organisation_id for update;
  if not found or m.mode <> 'pause' then raise exception 'unknown pause request' using errcode = 'P0002'; end if;
  if m.state <> 'requested' then raise exception 'that request is no longer waiting' using errcode = '22023'; end if;
  if m.confirm_by <= now() then
    -- the request has lapsed (the sweep records it within ten minutes); the CMO is told so, never that a pause is on
    raise exception 'that request has lapsed and nothing was paused; start a pause yourself if it is still needed' using errcode = '22023';
  end if;
  if p_confirm then
    v_hours := coalesce(p_hours, private.cap_rule('pause_max_hours'));
    if v_hours < 1 or v_hours > private.cap_rule('pause_max_hours') then raise exception 'choose between 1 and % hours', private.cap_rule('pause_max_hours') using errcode = '22023'; end if;
    update public.ops_modes set state = 'active', started_by = c.id, started_at = now(), expires_at = now() + make_interval(hours => v_hours), end_note = p_note where id = m.id;
    perform private.ops_audit(c.organisation_id, c.id, 'ops_mode.pause_confirmed', 'ops_mode', m.id, jsonb_build_object('hours', v_hours, 'requested_by', m.requested_by));
  else
    update public.ops_modes set state = 'declined', ended_at = now(), ended_by = c.id, end_kind = 'declined', end_note = p_note where id = m.id;
    perform private.ops_audit(c.organisation_id, c.id, 'ops_mode.pause_declined', 'ops_mode', m.id, jsonb_build_object('requested_by', m.requested_by));
  end if;
end;
$$;
revoke all on function public.cmo_decide_ops_pause(uuid, boolean, integer, text) from public, anon;
grant execute on function public.cmo_decide_ops_pause(uuid, boolean, integer, text) to authenticated;

create function public.cmo_end_ops_mode(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare c record; m public.ops_modes%rowtype;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can do this' using errcode = '42501'; end if;
  select * into m from public.ops_modes where id = p_id and organisation_id = c.organisation_id for update;
  if not found then raise exception 'unknown mode' using errcode = 'P0002'; end if;
  if m.state <> 'active' then raise exception 'that mode is not on' using errcode = '22023'; end if;
  update public.ops_modes set state = 'ended', ended_at = now(), ended_by = c.id, end_kind = 'manual', end_note = p_note where id = m.id;
  perform private.ops_audit(c.organisation_id, c.id, 'ops_mode.ended', 'ops_mode', m.id, jsonb_build_object('mode', m.mode));
end;
$$;
revoke all on function public.cmo_end_ops_mode(uuid, text) from public, anon;
grant execute on function public.cmo_end_ops_mode(uuid, text) to authenticated;

create function public.cmo_set_intake_override(p_reason text, p_hours integer) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare c record; v_id uuid; v_ver integer;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can do this' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < coalesce(private.cap_rule('override_reason_min_chars'), 20) then
    raise exception 'a written reason of at least % characters is required', coalesce(private.cap_rule('override_reason_min_chars'), 20) using errcode = '22023';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > private.cap_rule('override_max_hours') then raise exception 'choose between 1 and % hours', private.cap_rule('override_max_hours') using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('intake_override:' || c.organisation_id));
  update public.intake_overrides set ended_at = now(), ended_by = c.id where organisation_id = c.organisation_id and is_test = c.is_test and ended_at is null and expires_at <= now();
  if exists (select 1 from public.intake_overrides where organisation_id = c.organisation_id and is_test = c.is_test and ended_at is null) then
    raise exception 'an override is already in force' using errcode = '22023';
  end if;
  select version into v_ver from public.capacity_cover_config where is_active;
  insert into public.intake_overrides (organisation_id, reason, created_by, expires_at, config_version, is_test)
  values (c.organisation_id, btrim(p_reason), c.id, now() + make_interval(hours => p_hours), v_ver, c.is_test) returning id into v_id;
  perform private.ops_audit(c.organisation_id, c.id, 'intake_override.set', 'intake_override', v_id, jsonb_build_object('hours', p_hours, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;
revoke all on function public.cmo_set_intake_override(text, integer) from public, anon;
grant execute on function public.cmo_set_intake_override(text, integer) to authenticated;

create function public.cmo_end_intake_override(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare c record;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can do this' using errcode = '42501'; end if;
  update public.intake_overrides set ended_at = now(), ended_by = c.id where id = p_id and organisation_id = c.organisation_id and ended_at is null;
  if not found then raise exception 'unknown or finished override' using errcode = 'P0002'; end if;
  perform private.ops_audit(c.organisation_id, c.id, 'intake_override.ended', 'intake_override', p_id, '{}'::jsonb);
end;
$$;
revoke all on function public.cmo_end_intake_override(uuid) from public, anon;
grant execute on function public.cmo_end_intake_override(uuid) to authenticated;

-- What the clinical lead and ops see: the gate, the modes, the override, the recent history.
create function public.intake_gate_overview() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c record; v_gate jsonb;
begin
  select * into c from private.cap_caller();
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  -- the page that holds the CMO's controls must load even when a signal cannot be read
  begin
    v_gate := private.intake_gate_status(c.organisation_id);
  exception when others then
    v_gate := jsonb_build_object('open', false, 'unavailable', true, 'reasons', jsonb_build_array('unavailable'), 'lead_capacity', 0, 'lead_in_use', 0, 'lead_free', 0,
                                 'min_lead_headroom', coalesce(private.cap_rule('min_lead_headroom'), 3), 'rota_gap_hours', 0, 'rota_horizon_hours', coalesce(private.cap_rule('rota_horizon_hours'), 72),
                                 'class_breaches', '[]'::jsonb);
  end;
  return jsonb_build_object(
    'enforced', coalesce(private.cap_rule('gate_enforce'), 0) = 1,
    'config_version', (select version from public.capacity_cover_config where is_active),
    'guard_on', private.go_live_guard_on('on_call_cover_ok'),
    'gate', v_gate,
    'surge_active', private.ops_mode_active('surge', c.organisation_id, c.is_test),
    'pause_active', private.ops_mode_active('pause', c.organisation_id, c.is_test),
    'override', (select jsonb_build_object('id', o.id, 'reason', o.reason, 'expires_at', o.expires_at, 'created_at', o.created_at)
                   from public.intake_overrides o where o.organisation_id = c.organisation_id and o.is_test = c.is_test and o.ended_at is null and o.expires_at > now() limit 1),
    'modes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'mode', m.mode, 'state', m.state, 'reason', m.reason, 'requested_at', m.requested_at, 'confirm_by', m.confirm_by,
                       'started_at', m.started_at, 'expires_at', m.expires_at, 'ended_at', m.ended_at, 'end_kind', m.end_kind) order by m.created_at desc)
                        from (select * from public.ops_modes where organisation_id = c.organisation_id and is_test = c.is_test order by created_at desc limit 20) m), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'reason', o.reason, 'created_at', o.created_at, 'expires_at', o.expires_at, 'ended_at', o.ended_at) order by o.created_at desc)
                        from (select * from public.intake_overrides where organisation_id = c.organisation_id and is_test = c.is_test order by created_at desc limit 10) o), '[]'::jsonb),
    'limits', jsonb_build_object('surge_max_hours', private.cap_rule('surge_max_hours'), 'pause_max_hours', private.cap_rule('pause_max_hours'),
                                 'override_max_hours', private.cap_rule('override_max_hours'), 'pause_confirm_minutes', private.cap_rule('pause_confirm_minutes'),
                                 'reason_min_chars', private.cap_rule('reason_min_chars')));
end;
$$;
revoke all on function public.intake_gate_overview() from public, anon;
grant execute on function public.intake_gate_overview() to authenticated;

-- A clinician's banner: is surge or a pause on. No reasons, no names.
create function public.ops_mode_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c record;
begin
  select * into c from private.cap_caller();
  if c.id is null or not (exists (select 1 from public.clinical_staff cs where cs.profile_id = c.id) or private.is_admin()) then
    return jsonb_build_object('surge', null, 'pause', null);
  end if;
  return jsonb_build_object(
    'surge', (select m.expires_at from public.ops_modes m where m.organisation_id = c.organisation_id and m.mode = 'surge' and m.state = 'active' and m.expires_at > now() and m.is_test = c.is_test limit 1),
    'pause', (select m.expires_at from public.ops_modes m where m.organisation_id = c.organisation_id and m.mode = 'pause' and m.state = 'active' and m.expires_at > now() and m.is_test = c.is_test limit 1));
end;
$$;
revoke all on function public.ops_mode_status() from public, anon;
grant execute on function public.ops_mode_status() to authenticated;

-- The two queue seams, patched from their CURRENT definitions so nothing else in them is overwritten.
do $q$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.queue_candidates(uuid, boolean)'::regprocedure);
  if v_def like '%ops_mode_active%' then return; end if;
  v_new := replace(v_def, 'private.task_layer_setting(''handback_also_excludes_task_for'') as excl_layer',
    'private.task_layer_setting(''handback_also_excludes_task_for'') as excl_layer,
           private.ops_mode_active(''pause'', (select organisation_id from me), (select is_test from me)) as paused,
           coalesce(private.cap_rule(''pause_hold_min_class''), 6) as hold_class,
           private.ops_mode_active(''surge'', (select organisation_id from me), (select is_test from me)) as surge,
           coalesce(private.cap_rule(''surge_widen_min_class''), 4) as widen_class');
  if v_new = v_def then raise exception 'S20c: queue_candidates anchor 1 not found; patch by hand'; end if;
  v_def := v_new;
  v_new := replace(v_def, '(ct.state = ''offered_to_lead'' and p_uid in (ct.pushed_to, ct.lead_clinician_id))',
    '(ct.state = ''offered_to_lead'' and (p_uid in (ct.pushed_to, ct.lead_clinician_id)
            -- surge (decision 12): a routine task the lead has not taken can go to any eligible clinician; red is never windowed
            or (cfg.surge and ct.priority_class >= cfg.widen_class and ct.priority_class_original > 1)))');
  if v_new = v_def then raise exception 'S20c: queue_candidates anchor 2 not found; patch by hand'; end if;
  v_def := v_new;
  v_new := replace(v_def, 'and not exists (select 1 from public.clinician_conflicts c',
    '-- pause (decision 13): routine work is not OFFERED while paused; work already claimed, escalated and red is untouched
     and not (cfg.paused and ct.priority_class >= cfg.hold_class and ct.state in (''open'', ''offered_to_lead''))
     and not exists (select 1 from public.clinician_conflicts c');
  if v_new = v_def then raise exception 'S20c: queue_candidates anchor 3 not found; patch by hand'; end if;
  execute v_new;
end
$q$;

-- Surge lengthens routine response windows: the warning thresholds for routine classes are multiplied while it is on, so the watchdog and
-- the intake gate do not read an expected slowdown as a breach. It does not change any task's own due time.
create or replace function private.queue_class_breaches() returns jsonb
language sql stable security definer set search_path = ''
as $$
  with s as (select private.ops_mode_active('surge', null, false) as on_,
                    coalesce(private.cap_rule('surge_widen_min_class'), 4) as w,
                    coalesce(private.cap_rule('surge_routine_window_multiplier'), 2) as m)
  select coalesce(jsonb_agg(jsonb_build_object('priority_class', x.priority_class, 'oldest_open_minutes', x.mins, 'warn_after_minutes', x.warn)
                            order by x.priority_class), '[]'::jsonb)
    from (select ct.priority_class,
                 (extract(epoch from (now() - min(ct.created_at))) / 60)::integer as mins,
                 ((private.task_layer_setting('watchdog') -> 'class_warning_minutes' ->> ct.priority_class::text)::integer
                    * (select case when s.on_ and ct.priority_class >= s.w then s.m else 1 end from s))::integer as warn
            from public.clinical_tasks ct
           where not ct.is_test and ct.state in ('open', 'escalated')
           group by ct.priority_class) x
   where x.warn is not null and x.mins > x.warn;
$$;

-- ---------------------------------------------------------------------------
-- 5. Hard rest rule and cover offers (W5.3)
-- ---------------------------------------------------------------------------
create table public.rest_rule_overrides (
  id           uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id uuid not null references public.profiles (id) on delete cascade,
  valid_from   timestamptz not null,
  valid_to     timestamptz not null,
  reason       text not null check (char_length(btrim(reason)) > 0),
  granted_by   uuid references public.profiles (id) on delete set null,
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  is_test      boolean not null default false,
  check (valid_to > valid_from)
);
create index rest_rule_overrides_clinician_idx on public.rest_rule_overrides (clinician_id, valid_from);
create index rest_rule_overrides_org_idx on public.rest_rule_overrides (organisation_id);
create index rest_rule_overrides_granted_by_idx on public.rest_rule_overrides (granted_by) where granted_by is not null;

create table public.fatigue_cover_offers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  rota_id         uuid not null references public.on_call_rota (id) on delete cascade,
  next_rota_id    uuid not null references public.on_call_rota (id) on delete cascade,
  overnight_pages integer not null,
  state           text not null default 'offered' check (state in ('offered', 'fit_confirmed', 'cover_requested')),
  offered_at      timestamptz not null default now(),
  responded_at    timestamptz,
  note            text,
  is_test         boolean not null default false,
  unique (rota_id, clinician_id)
);
create index fatigue_cover_offers_clinician_idx on public.fatigue_cover_offers (clinician_id, offered_at desc);
create index fatigue_cover_offers_next_idx on public.fatigue_cover_offers (next_rota_id);
create index fatigue_cover_offers_org_idx on public.fatigue_cover_offers (organisation_id, offered_at desc);

alter table public.rest_rule_overrides enable row level security;
alter table public.fatigue_cover_offers enable row level security;
create policy rest_rule_overrides_read on public.rest_rule_overrides for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.can_credential_review() and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))));
create policy fatigue_cover_offers_read on public.fatigue_cover_offers for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.can_credential_review() and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))));
revoke all on public.rest_rule_overrides, public.fatigue_cover_offers from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.rest_rule_overrides, public.fatigue_cover_offers from authenticated;
grant select on public.rest_rule_overrides, public.fatigue_cover_offers to authenticated;

-- Overnight pages this clinician received between two instants (Lagos local hour inside the configured overnight window).
create function private.overnight_page_count(p_clinician uuid, p_from timestamptz, p_to timestamptz) returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from public.pages pg
   where pg.to_clinician_id = p_clinician and pg.sent_at >= p_from and pg.sent_at < p_to
     and case when coalesce(private.cap_rule('overnight_start_hour'), 22) > coalesce(private.cap_rule('overnight_end_hour'), 7)
              then extract(hour from pg.sent_at at time zone 'Africa/Lagos') >= coalesce(private.cap_rule('overnight_start_hour'), 22)
                or extract(hour from pg.sent_at at time zone 'Africa/Lagos') < coalesce(private.cap_rule('overnight_end_hour'), 7)
              else extract(hour from pg.sent_at at time zone 'Africa/Lagos') >= coalesce(private.cap_rule('overnight_start_hour'), 22)
               and extract(hour from pg.sent_at at time zone 'Africa/Lagos') < coalesce(private.cap_rule('overnight_end_hour'), 7) end
$$;
revoke all on function private.overnight_page_count(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- The earliest instant a clinician may START on call or queue time, given the shifts that just ended with overnight pages (null = no limit).
create function private.rest_rule_earliest_start(p_clinician uuid, p_start timestamptz) returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select max(r.ends_at + make_interval(hours => coalesce(private.cap_rule('rest_hours'), 11)))
    from public.on_call_rota r
   where r.cancelled_at is null and (r.primary_clinician_id = p_clinician or r.backup_clinician_id = p_clinician)
     and r.ends_at <= p_start and r.ends_at > p_start - make_interval(hours => coalesce(private.cap_rule('rest_hours'), 11))
     and private.overnight_page_count(p_clinician, r.starts_at, r.ends_at) >= coalesce(private.cap_rule('rest_min_overnight_pages'), 1)
$$;
revoke all on function private.rest_rule_earliest_start(uuid, timestamptz) from public, anon, authenticated;

-- The hard check. Does nothing unless hard_rest_enforce = 1. Only a CMO override (rest_rule_overrides) lets a start through.
create function private.rest_rule_check(p_clinician uuid, p_start timestamptz) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_earliest timestamptz; v_name text;
begin
  if coalesce(private.cap_rule('hard_rest_enforce'), 0) <> 1 then return; end if;
  v_earliest := private.rest_rule_earliest_start(p_clinician, p_start);
  if v_earliest is null or v_earliest <= p_start then return; end if;
  if exists (select 1 from public.rest_rule_overrides o where o.clinician_id = p_clinician and o.revoked_at is null and o.valid_from <= p_start and o.valid_to > p_start) then return; end if;
  select full_name into v_name from public.clinical_staff where profile_id = p_clinician;
  raise exception 'hard_rest_rule: % needs at least % hours of rest after a shift with overnight pages; the earliest start is % (only the chief medical officer can override this, with a written reason)',
    coalesce(v_name, 'this clinician'), coalesce(private.cap_rule('rest_hours'), 11), to_char(v_earliest at time zone 'Africa/Lagos', 'DD Mon HH24:MI') using errcode = '23514';
end;
$$;
revoke all on function private.rest_rule_check(uuid, timestamptz) from public, anon, authenticated;

-- Rota door: set_on_call_rota and every swap step validate through rota_validate_clinician_core. The existing core becomes *_base and the
-- new core runs it, then the rest rule. (A proof fails if a later migration replaces the core without calling the rule.)
alter function private.rota_validate_clinician_core(uuid, uuid, timestamptz, timestamptz, boolean) rename to rota_validate_clinician_core_base;
create function private.rota_validate_clinician_core(p_profile uuid, p_org uuid, p_start timestamptz, p_end timestamptz, p_objective boolean)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.rota_validate_clinician_core_base(p_profile, p_org, p_start, p_end, p_objective);
  perform private.rest_rule_check(p_profile, p_start);
end;
$$;
revoke all on function private.rota_validate_clinician_core(uuid, uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function private.rota_validate_clinician_core_base(uuid, uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;

-- Availability door: declared on-call and queue time.
create function private.availability_hard_rest() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state <> 'cancelled' and new.kind in ('on_call', 'queue') then
    perform private.rest_rule_check(new.clinician_id, new.starts_at);
  end if;
  return new;
end;
$$;
revoke all on function private.availability_hard_rest() from public, anon, authenticated;
create trigger availability_blocks_hard_rest before insert on public.availability_blocks
  for each row execute function private.availability_hard_rest();

-- Only the CMO can override, with a written reason, for a bounded window. Audited.
create function public.cmo_override_rest_rule(p_clinician uuid, p_from timestamptz, p_to timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare c record; v_id uuid; v_test boolean;
begin
  select * into c from private.cap_caller();
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can override the rest rule' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < coalesce(private.cap_rule('reason_min_chars'), 20) then
    raise exception 'a written reason of at least % characters is required', coalesce(private.cap_rule('reason_min_chars'), 20) using errcode = '22023';
  end if;
  if p_to <= p_from or p_to > p_from + make_interval(days => coalesce(private.cap_rule('rest_override_max_days'), 3)) then
    raise exception 'the override window must be at most % days', coalesce(private.cap_rule('rest_override_max_days'), 3) using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = p_clinician and organisation_id = c.organisation_id;
  if not found then raise exception 'unknown clinician' using errcode = '22023'; end if;
  insert into public.rest_rule_overrides (organisation_id, clinician_id, valid_from, valid_to, reason, granted_by, is_test)
  values (c.organisation_id, p_clinician, p_from, p_to, btrim(p_reason), c.id, v_test) returning id into v_id;
  perform private.ops_audit(c.organisation_id, c.id, 'rest_rule.overridden', 'rest_rule_override', v_id,
    jsonb_build_object('clinician_id', p_clinician, 'from', p_from, 'to', p_to, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;
revoke all on function public.cmo_override_rest_rule(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.cmo_override_rest_rule(uuid, timestamptz, timestamptz, text) to authenticated;

-- Cover offers: after cover_offer_pages or more overnight pages in one rota period, offer the next shift to be covered and ask for a
-- fitness confirmation. Neutral wording (INV-07): a count of nothing clinical, no patient, no name in the reviewer notice.
create function private.fatigue_cover_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_next uuid; v_pages integer; v_offer uuid; v_n integer := 0;
  v_need integer := coalesce(private.cap_rule('cover_offer_pages'), 2);
  v_look integer := coalesce(private.cap_rule('cover_offer_lookahead_hours'), 36);
begin
  for r in
    select o.id as rota_id, o.organisation_id, o.starts_at, o.ends_at, o.is_test, x.pid
      from public.on_call_rota o
      cross join lateral (values (o.primary_clinician_id), (o.backup_clinician_id)) x(pid)
     where o.cancelled_at is null and x.pid is not null and o.starts_at <= now() and o.ends_at > now() - make_interval(hours => v_look)
  loop
    continue when exists (select 1 from public.fatigue_cover_offers f where f.rota_id = r.rota_id and f.clinician_id = r.pid);
    v_pages := private.overnight_page_count(r.pid, r.starts_at, least(r.ends_at, now()));
    continue when v_pages < v_need;
    select n.id into v_next from public.on_call_rota n
     where n.cancelled_at is null and n.id <> r.rota_id and (n.primary_clinician_id = r.pid or n.backup_clinician_id = r.pid)
       and n.starts_at > now() and n.starts_at <= now() + make_interval(hours => v_look)
     order by n.starts_at limit 1;
    continue when v_next is null;   -- nothing to offer yet; looked at again on the next pass
    insert into public.fatigue_cover_offers (organisation_id, clinician_id, rota_id, next_rota_id, overnight_pages, is_test)
    values (r.organisation_id, r.pid, r.rota_id, v_next, v_pages, r.is_test) on conflict (rota_id, clinician_id) do nothing returning id into v_offer;
    continue when v_offer is null;
    perform private.credential_notify(r.pid, r.organisation_id, 'Cover for your next shift',
      'It has been a busy night. Your next shift can be covered if you would like that. Please open Rest and cover to confirm you are fit to work, or to ask for cover.',
      jsonb_build_object('offer_id', v_offer, 'audience', 'cover_offer'), false);
    perform private.credential_notify_reviewers(r.organisation_id, 'Cover may be needed', 'A clinician may need cover for an upcoming shift. Open Capacity to see the offer.',
      jsonb_build_object('offer_id', v_offer), 'cover_offer');
    perform private.ops_audit(r.organisation_id, null, 'cover_offer.created', 'fatigue_cover_offer', v_offer, jsonb_build_object('clinician_id', r.pid, 'overnight_pages', v_pages));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.fatigue_cover_sweep() from public, anon, authenticated;
select cron.schedule('fatigue-cover-sweep', '12,42 * * * *', $$ select private.fatigue_cover_sweep(); $$);

create function public.my_cover_offers() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'rest_hours', coalesce(private.cap_rule('rest_hours'), 11),
    'rest_enforced', coalesce(private.cap_rule('hard_rest_enforce'), 0) = 1,
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'state', f.state, 'offered_at', f.offered_at, 'responded_at', f.responded_at, 'overnight_pages', f.overnight_pages,
           'next_shift_starts_at', n.starts_at, 'next_shift_ends_at', n.ends_at) order by f.offered_at desc)
      from (select * from public.fatigue_cover_offers where clinician_id = (select auth.uid()) order by offered_at desc limit 10) f
      join public.on_call_rota n on n.id = f.next_rota_id), '[]'::jsonb))
$$;
revoke all on function public.my_cover_offers() from public, anon;
grant execute on function public.my_cover_offers() to authenticated;

create function public.respond_cover_offer(p_offer uuid, p_fit boolean, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.fatigue_cover_offers%rowtype;
begin
  perform private.uid_or_deny();
  select * into f from public.fatigue_cover_offers where id = p_offer and clinician_id = (select auth.uid()) for update;
  if not found then raise exception 'unknown offer' using errcode = 'P0002'; end if;
  if f.state <> 'offered' then raise exception 'you have already answered this' using errcode = '22023'; end if;
  update public.fatigue_cover_offers set state = case when p_fit then 'fit_confirmed' else 'cover_requested' end, responded_at = now(), note = nullif(btrim(coalesce(p_note, '')), '') where id = f.id;
  perform private.ops_audit(f.organisation_id, f.clinician_id, case when p_fit then 'cover_offer.fit_confirmed' else 'cover_offer.cover_requested' end, 'fatigue_cover_offer', f.id, '{}'::jsonb);
  if not p_fit then
    perform private.credential_notify_reviewers(f.organisation_id, 'Cover requested', 'A clinician asked for cover for an upcoming shift. Open Capacity and arrange it from the rota.', jsonb_build_object('offer_id', f.id), 'cover_offer');
  end if;
end;
$$;
revoke all on function public.respond_cover_offer(uuid, boolean, text) from public, anon;
grant execute on function public.respond_cover_offer(uuid, boolean, text) to authenticated;

create function public.cover_offers_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c record;
begin
  select * into c from private.cap_caller();
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'clinician', cs.full_name, 'state', f.state, 'offered_at', f.offered_at, 'responded_at', f.responded_at,
               'overnight_pages', f.overnight_pages, 'next_shift_starts_at', n.starts_at, 'next_shift_ends_at', n.ends_at) order by f.offered_at desc)
         from (select * from public.fatigue_cover_offers where organisation_id = c.organisation_id and is_test = c.is_test order by offered_at desc limit 30) f
         join public.on_call_rota n on n.id = f.next_rota_id
         left join public.clinical_staff cs on cs.profile_id = f.clinician_id), '[]'::jsonb),
    'rest_overrides', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'clinician', cs.full_name, 'valid_from', o.valid_from, 'valid_to', o.valid_to, 'reason', o.reason, 'granted_at', o.granted_at) order by o.granted_at desc)
         from (select * from public.rest_rule_overrides where organisation_id = c.organisation_id and is_test = c.is_test order by granted_at desc limit 20) o
         left join public.clinical_staff cs on cs.profile_id = o.clinician_id), '[]'::jsonb),
    'rest_enforced', coalesce(private.cap_rule('hard_rest_enforce'), 0) = 1,
    'rest_hours', coalesce(private.cap_rule('rest_hours'), 11));
end;
$$;
revoke all on function public.cover_offers_overview() from public, anon;
grant execute on function public.cover_offers_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Fire drills (W5.4)
-- ---------------------------------------------------------------------------
alter table public.page_tests add column drill_result_at timestamptz;

alter table public.clinician_reliability_events drop constraint clinician_reliability_events_kind_check;
alter table public.clinician_reliability_events add constraint clinician_reliability_events_kind_check
  check (kind in ('completed_on_time', 'completed_late', 'claim_expired', 'handed_back_other', 'handed_back_reasoned', 'audit_result', 'drill_result'));

-- The lead's reliability dashboard counts events per clinician; a drill result is not a reliability event for that purpose. Patched from the
-- CURRENT definition: both event counts leave out drill_result as they already leave out audit_result.
do $dash$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.reliability_dashboard(integer,integer)'::regprocedure);
  if v_def like '%drill_result%' then return; end if;
  v_new := replace(v_def, 'ev.kind <> ''audit_result''', 'ev.kind not in (''audit_result'', ''drill_result'')');
  if v_new = v_def then raise exception 'S20c: reliability_dashboard no longer filters audit_result in the expected form; patch by hand'; end if;
  execute v_new;
end
$dash$;

-- A drill result is INFORMATIONAL (Just Culture): weight 0 so it never moves the reliability score, and nothing reads it for pay or removal.
create function private.record_drill_result(p_org uuid, p_clinician uuid, p_good numeric, p_test boolean) returns void
language sql security definer set search_path = ''
as $$
  insert into public.clinician_reliability_events (organisation_id, clinician_id, kind, good, weight, config_version, is_test)
  values (p_org, p_clinician, 'drill_result', p_good, 0, coalesce((select version from public.queue_claim_config where is_active), 1), p_test)
$$;
revoke all on function private.record_drill_result(uuid, uuid, numeric, boolean) from public, anon, authenticated;

create function private.drill_ack_trigger() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'drill' and old.acknowledged_at is null and new.acknowledged_at is not null and new.drill_result_at is null then
    new.drill_result_at := now();
    perform private.record_drill_result(new.organisation_id, new.clinician_id,
      case when extract(epoch from (new.acknowledged_at - new.sent_at)) <= coalesce(private.cap_rule('drill_ack_target_seconds'), 300) then 1 else 0 end, new.is_test);
  end if;
  return new;
end;
$$;
revoke all on function private.drill_ack_trigger() from public, anon, authenticated;
create trigger page_tests_drill_ack before update of acknowledged_at on public.page_tests
  for each row execute function private.drill_ack_trigger();

create function private.send_drill_page(p_clinician uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype; v_id uuid;
begin
  select * into cs from public.clinical_staff where profile_id = p_clinician and active and status = 'active';
  if not found then return null; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, requested_by, kind, is_test)
    values (cs.organisation_id, p_clinician, null, 'drill', coalesce((select pr.is_test from public.profiles pr where pr.id = p_clinician), false))
    returning id into v_id;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.page_notify_ref(p_clinician, cs.organisation_id, 'on_call_test_page', v_id, 'page_tests');
  perform private.ops_audit(cs.organisation_id, null, 'page_test.drill_sent', 'page_test', v_id, jsonb_build_object('clinician_id', p_clinician));
  return v_id;
end;
$$;
revoke all on function private.send_drill_page(uuid) from public, anon, authenticated;

-- A drill that nobody answered within drill_missed_after_minutes is recorded as missed (informational).
create function private.settle_drill_results() returns integer
language plpgsql security definer set search_path = ''
as $$
declare t record; v_n integer := 0;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  for t in select * from public.page_tests where kind = 'drill' and acknowledged_at is null and drill_result_at is null
              and sent_at < now() - make_interval(mins => coalesce(private.cap_rule('drill_missed_after_minutes'), 60)) for update skip locked loop
    update public.page_tests set drill_result_at = now() where id = t.id;
    perform private.record_drill_result(t.organisation_id, t.clinician_id, 0, t.is_test);
    v_n := v_n + 1;
  end loop;
  perform set_config('tarragon.paging_write', 'off', true);
  return v_n;
end;
$$;
revoke all on function private.settle_drill_results() from public, anon, authenticated;

-- Hourly. Picks clinicians who are on the rota within drill_roster_lookahead_days and have had no drill for drill_interval_days, a few per run, inside
-- the daytime drill hours (Lagos). OFF unless drill_enabled = 1.
create function private.run_fire_drills() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_n integer := 0; v_hour integer;
begin
  perform private.settle_drill_results();
  if coalesce(private.cap_rule('drill_enabled'), 0) <> 1 then return 0; end if;
  v_hour := extract(hour from now() at time zone 'Africa/Lagos');
  if v_hour < private.cap_rule('drill_hour_start') or v_hour >= private.cap_rule('drill_hour_end') then return 0; end if;
  for r in
    select cs.profile_id
      from public.clinical_staff cs
     where cs.active and cs.status = 'active' and cs.profile_id is not null
       and exists (select 1 from public.on_call_rota o where o.cancelled_at is null and (o.primary_clinician_id = cs.profile_id or o.backup_clinician_id = cs.profile_id)
                      and o.ends_at > now() and o.starts_at < now() + make_interval(days => private.cap_rule('drill_roster_lookahead_days')))
       and not exists (select 1 from public.page_tests t where t.clinician_id = cs.profile_id and t.kind = 'drill' and t.sent_at > now() - make_interval(days => private.cap_rule('drill_interval_days')))
       and not exists (select 1 from public.page_tests t where t.clinician_id = cs.profile_id and t.sent_at > now() - make_interval(mins => private.cap_rule('drill_min_gap_minutes')))
       -- a drill must never compete with the real thing: nobody on leave, nobody holding a page opened in the last drill_busy_hours
       and not private.clinician_on_leave(cs.profile_id)
       and not exists (select 1 from public.pages pg where pg.to_clinician_id = cs.profile_id and pg.closed_at is null
                        and pg.sent_at > now() - make_interval(hours => private.cap_rule('drill_busy_hours')))
     order by (select max(t.sent_at) from public.page_tests t where t.clinician_id = cs.profile_id and t.kind = 'drill') nulls first, cs.profile_id
     limit private.cap_rule('drill_max_per_run')
  loop
    if private.send_drill_page(r.profile_id) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.run_fire_drills() from public, anon, authenticated;
select cron.schedule('fire-drills', '43 * * * *', $$ select private.run_fire_drills(); $$);

-- The CMO report: p50 and p95 acknowledge time and the share within target, by clinician, hour of day (Lagos) and route / device.
-- A drill nobody answered is a miss (it counts against the share, and has no time). Results are never used for pay or removal.
create function public.fire_drill_report(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c record;
  v_target integer := coalesce(private.cap_rule('drill_ack_target_seconds'), 300);
  v_pct integer := coalesce(private.cap_rule('drill_ack_target_pct'), 90);
  v_days integer := least(greatest(coalesce(p_days, 90), 1), 366);
  v jsonb;
begin
  select * into c from private.cap_caller();
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  with d as (
    select t.id, t.clinician_id, t.sent_at, t.acknowledged_at, t.drill_result_at,
           case when t.acknowledged_at is not null and (t.drill_result_at is null or t.acknowledged_at <= t.drill_result_at)
                then extract(epoch from (t.acknowledged_at - t.sent_at)) end as secs,
           (select a.channel from public.page_delivered_acks a where a.test_id = t.id order by a.acked_at limit 1) as route,
           (select s.kind from public.page_delivered_acks a join public.on_call_device_seen s on s.clinician_id = a.clinician_id and s.device_id = a.device_id
             where a.test_id = t.id order by a.acked_at limit 1) as device,
           (t.acknowledged_at is null and t.drill_result_at is null) as pending
      from public.page_tests t
     where t.kind = 'drill' and t.organisation_id = c.organisation_id and t.is_test = c.is_test and t.sent_at > now() - make_interval(days => v_days)
  ), settled as (select * from d where not pending),
  agg(grp, key, label, sent, acked, within, p50, p95) as (
    select 'overall', 'all', 'All drills', count(*), count(secs), count(*) filter (where secs <= v_target),
           percentile_cont(0.5) within group (order by secs), percentile_cont(0.95) within group (order by secs) from settled
    union all
    select 'clinician', s.clinician_id::text, coalesce(cs.full_name, 'Unknown'), count(*), count(s.secs), count(*) filter (where s.secs <= v_target),
           percentile_cont(0.5) within group (order by s.secs), percentile_cont(0.95) within group (order by s.secs)
      from settled s left join public.clinical_staff cs on cs.profile_id = s.clinician_id group by s.clinician_id, cs.full_name
    union all
    select 'hour', lpad(extract(hour from s.sent_at at time zone 'Africa/Lagos')::integer::text, 2, '0'), lpad(extract(hour from s.sent_at at time zone 'Africa/Lagos')::integer::text, 2, '0') || ':00',
           count(*), count(s.secs), count(*) filter (where s.secs <= v_target),
           percentile_cont(0.5) within group (order by s.secs), percentile_cont(0.95) within group (order by s.secs)
      from settled s group by 2, 3
    union all
    select 'route', coalesce(s.route, 'none'), coalesce(s.route, 'No receipt'), count(*), count(s.secs), count(*) filter (where s.secs <= v_target),
           percentile_cont(0.5) within group (order by s.secs), percentile_cont(0.95) within group (order by s.secs)
      from settled s group by 2, 3
    union all
    select 'device', coalesce(s.device, 'unknown'), coalesce(s.device, 'Unknown device'), count(*), count(s.secs), count(*) filter (where s.secs <= v_target),
           percentile_cont(0.5) within group (order by s.secs), percentile_cont(0.95) within group (order by s.secs)
      from settled s group by 2, 3
  )
  select jsonb_build_object(
    'days', v_days, 'target_seconds', v_target, 'target_pct', v_pct,
    'pending', (select count(*) from d where pending),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group', grp, 'key', key, 'label', label, 'sent', sent, 'acknowledged', acked, 'missed', sent - acked,
                'within_target', within, 'pct_within_target', case when sent > 0 then round(100.0 * within / sent, 1) end,
                'p50_seconds', round(p50::numeric, 1), 'p95_seconds', round(p95::numeric, 1)) order by grp, label) from agg), '[]'::jsonb),
    'meets_target', coalesce((select sent > 0 and 100.0 * within / sent >= v_pct from agg where grp = 'overall'), false))
    into v;
  return v;
end;
$$;
revoke all on function public.fire_drill_report(integer) from public, anon;
grant execute on function public.fire_drill_report(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-check: the closing assertions
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- the two rule switches ship off, v2 inactive and unsigned, the pilot cap is a separate inactive version
  if (select (rules ->> 'gate_enforce') || (rules ->> 'hard_rest_enforce') || (rules ->> 'drill_enabled') from public.capacity_cover_config where is_active) <> '000' then
    raise exception 'S20c: an enforcing switch is on in the active config';
  end if;
  if exists (select 1 from public.capacity_cover_config where version = 2 and (is_active or approved_at is not null)) then raise exception 'S20c: v2 must be inactive and unsigned'; end if;
  if (select (rules ->> 'max_lead_patients')::integer from public.lead_config where version = 2) is distinct from 40
     or exists (select 1 from public.lead_config where version = 2 and (is_active or approved_at is not null))
     or (select (rules ->> 'max_lead_patients')::integer from public.lead_config where version = 1) is distinct from 60 then
    raise exception 'S20c: lead_config pilot cap version is wrong';
  end if;
  -- no new function is executable by anon or public
  foreach f in array array[
    'public.sign_capacity_cover_config(integer)', 'public.sign_lead_config(integer)', 'public.cmo_start_ops_mode(text,text,integer)', 'public.request_ops_pause(text)',
    'public.cmo_decide_ops_pause(uuid,boolean,integer,text)', 'public.cmo_end_ops_mode(uuid,text)', 'public.cmo_set_intake_override(text,integer)',
    'public.cmo_end_intake_override(uuid)', 'public.intake_gate_overview()', 'public.ops_mode_status()', 'public.cmo_override_rest_rule(uuid,timestamptz,timestamptz,text)',
    'public.my_cover_offers()', 'public.respond_cover_offer(uuid,boolean,text)', 'public.cover_offers_overview()', 'public.fire_drill_report(integer)',
    'private.intake_open(uuid)', 'private.rest_rule_check(uuid,timestamptz)', 'private.run_fire_drills()', 'private.go_live_open_intake(text,uuid,uuid)',
    'private.go_live_open_patient_intake(text,uuid)', 'private.raise_intake_gate_incident()'] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then
      raise exception 'S20c: % is executable by anon', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.ops_modes', 'INSERT') or has_table_privilege('anon', 'public.ops_modes', 'SELECT') then raise exception 'S20c: ops_modes grants are wrong'; end if;
end
$$;
