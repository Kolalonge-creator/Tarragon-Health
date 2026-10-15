-- P1 (S11 to S15 end to end, plan items R1 and R0): a live canary for the clinical chain.
--
-- WHY. S11 (grading), S12 (wiring), S16 (tasks), S19 (paging) and S13 (notifications) are applied and deployed, but in
-- production they have never graded a real reading (0 triage_events, 0 clinical_tasks, 0 deliveries when this was written). A
-- chain that has never run in production can be silently broken (a stopped processor, a missing secret, a dead subscriber) and
-- every table would still just look empty. This migration adds a synthetic check that pushes known fixture readings through the
-- REAL insert path on a schedule and asserts every stage, in the manner of a heartbeat / synthetic monitor.
--
-- HOW IT STAYS AWAY FROM REAL PEOPLE (the hard part, found by reading the live functions):
--   * the legacy BP and symptom triggers (private.handle_bp_reading_red_flag, handle_emergency_event) do NOT look at is_test and
--     notify EVERY clinician profile in the patient's organisation. A fixture in the real organisation would page real doctors.
--     So the canary lives in its own synthetic organisation (type direct_consumer, metadata canary=true) with one synthetic
--     patient, one synthetic clinician and one synthetic admin. Nobody real belongs to that organisation, so the legacy alerts
--     can only reach the synthetic clinician.
--   * a BEFORE INSERT trigger on notifications turns anything addressed to a canary profile into status 'suppressed' (recorded,
--     never sent). 'suppressed' is not picked up by send-pending-notifications and is skipped by
--     escalate_unconfirmed_critical_notifications (which would otherwise hop it and end by alerting every real admin).
--   * the red fixture's page goes to the synthetic clinician through the synthetic on-call rota (is_test), is acknowledged by a
--     deferred trigger through the real public.acknowledge_page(), so private.sweep_pages() never escalates it into a real
--     sev1 incident.
--   * test isolation: profiles.is_test, clinical_staff.is_test, on_call_rota.is_test, pages.is_test, triage_events.is_test,
--     clinical_tasks.is_test are all true, so every analytics view, report and the bus lag sweep leave it out (INV-13).
--
-- WHAT IT ASSERTS, per fixture (chain_canary_fixtures; P2 adds a glucose fixture by enabling a row, no code):
--   graded -> event_delivered -> task (non-shadow amber) / page (red) -> notification (neutral) -> ack.
--   A missing or late stage fails the run and names the stage; the result row is append-only; an ops incident is raised
--   (ops_alert_incident, severity sev1 when a page fixture fails, sev2 otherwise). A stopped processor leaves no triage_event, so the
--   run fails at 'graded' (proved with a sabotage in packages/db/tests/p1_chain_canary.sql).
--   It also fails 'stale' when no run has finished for stale_after_minutes (the canary itself died).
--
-- COST. One cron job (chain-canary, minutes 11 and 41 of every hour: not a round minute, nothing per minute, one short
-- statement), two readings per run. Counted live before writing: 112 cron jobs, 7 BP readings in total.
-- Rows are is_test. chain_canary_prune() trims ONLY chain_canary_runs (30 days). The rows a run leaves in clinical tables (2 vitals_readings,
-- 1 symptom, 1 triage_event, bus events and deliveries, a legacy alert and emergency, a page, three notices, a cancelled task, audit rows)
-- are NOT pruned: triage_events is append-only and the rest follow the platform's own retention. About 48 runs a day; this is listed as an
-- open follow-up for the SR3 retention work (docs/design/S11-S15-p1-chain-closeout.md) rather than hidden.

-- 1. Configuration (versioned, one active row) ------------------------------------------------------------------------------
-- A budget that is missing or not a positive whole number would turn every time comparison into null and make the check pass silently
-- (found in review), so the database refuses such a config, the same way S19's paging_config does.
create function private.chain_canary_rules_valid(r jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select r is not null and jsonb_typeof(r) = 'object'
    and not exists (
      select 1 from unnest(array['intervalMinutes', 'gradedSeconds', 'taskSeconds', 'pageSeconds', 'notificationSeconds', 'ackSeconds',
                                 'minEvalAgeSeconds', 'staleAfterMinutes', 'rotaHours', 'retentionDays']) k
       where jsonb_typeof(r -> k) is distinct from 'number' or (r ->> k)::numeric <= 0 or (r ->> k)::numeric <> trunc((r ->> k)::numeric))
    and jsonb_typeof(r -> 'health') = 'object'
    and not exists (
      select 1 from unnest(array['minSample', 'stuckDeliverySeconds', 'readingToGradedP95Seconds', 'pageToAckP95Seconds', 'canaryStaleMinutes',
                                 'ungradedReadingMinutes', 'deadLetterWindowDays']) k
       where jsonb_typeof(r -> 'health' -> k) is distinct from 'number' or (r -> 'health' ->> k)::numeric <= 0 or (r -> 'health' ->> k)::numeric <> trunc((r -> 'health' ->> k)::numeric))
    and jsonb_typeof(r -> 'health' -> 'deadLettersMax') = 'number' and (r -> 'health' ->> 'deadLettersMax')::numeric >= 0
    and (r -> 'health' ->> 'deadLettersMax')::numeric = trunc((r -> 'health' ->> 'deadLettersMax')::numeric)
$$;

create table public.chain_canary_config (
  version        integer primary key,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (private.chain_canary_rules_valid(rules)),
  note           text,
  created_at     timestamptz not null default now()
);
create unique index chain_canary_config_one_active on public.chain_canary_config (is_active) where is_active;
alter table public.chain_canary_config enable row level security;
create policy chain_canary_config_read on public.chain_canary_config for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.chain_canary_config from public, anon, authenticated;
grant select on public.chain_canary_config to authenticated;
comment on table public.chain_canary_config is 'P1: PROPOSED budgets and thresholds for the chain canary and the chain health page. Mirrored in the registry as chain.canary_and_health (packages/shared/src/proposed-config) with a drift test. CMO owned.';

-- chain-canary-config-begin
insert into public.chain_canary_config (version, is_active, effective_from, rules, note) values
  (1, true, date '2026-10-13', '{
    "intervalMinutes": 30,
    "gradedSeconds": 180,
    "taskSeconds": 240,
    "pageSeconds": 240,
    "notificationSeconds": 300,
    "ackSeconds": 600,
    "minEvalAgeSeconds": 660,
    "staleAfterMinutes": 100,
    "rotaHours": 4,
    "retentionDays": 30,
    "health": {
      "minSample": 20,
      "stuckDeliverySeconds": 300,
      "deadLettersMax": 0,
      "readingToGradedP95Seconds": 120,
      "pageToAckP95Seconds": 600,
      "canaryStaleMinutes": 100,
      "ungradedReadingMinutes": 10,
      "deadLetterWindowDays": 14
    }
  }'::jsonb, 'P1 first version, PROPOSED (CMO). Budgets are generous on purpose: the processor runs every 15 seconds, so a healthy chain grades in well under a minute.');
-- chain-canary-config-end

create function private.chain_canary_rule(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.chain_canary_config where is_active $$;
revoke all on function private.chain_canary_rule(text) from public, anon, authenticated;

-- 2. Fixtures (data, not code) ------------------------------------------------------------------------------------------------
create table public.chain_canary_fixtures (
  code            text primary key check (code ~ '^[a-z0-9_]{3,60}$'),
  is_enabled      boolean not null default true,
  vital_type      text not null check (vital_type in ('blood_pressure', 'glucose')),
  systolic        integer,
  diastolic       integer,
  glucose_mmol_l  numeric,
  ketones_mmol_l  numeric,
  symptom_type    text,
  expect_grade    text not null check (expect_grade in ('green', 'amber', 'red')),
  expect_task_type text,
  expect_page     boolean not null default false,
  note            text,
  check ((vital_type = 'blood_pressure' and systolic is not null and diastolic is not null)
      or (vital_type = 'glucose' and glucose_mmol_l is not null))
);
alter table public.chain_canary_fixtures enable row level security;
create policy chain_canary_fixtures_read on public.chain_canary_fixtures for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.chain_canary_fixtures from public, anon, authenticated;
grant select on public.chain_canary_fixtures to authenticated;

insert into public.chain_canary_fixtures (code, is_enabled, vital_type, systolic, diastolic, glucose_mmol_l, ketones_mmol_l, symptom_type, expect_grade, expect_task_type, expect_page, note) values
  ('bp_red_chest_pain', true, 'blood_pressure', 190, 125, null, null, 'chest_pain', 'red', null, true,
   'Severe BP with a red-flag symptom: bp_care_triage BP-R1. Must grade red, page the on-call clinician, notify neutrally, be acknowledged.'),
  ('bp_amber_low_dizzy', true, 'blood_pressure', 95, 60, null, null, 'dizziness', 'amber', 'amber_bp_review', false,
   'Low BP with dizziness: BP-A3 (systolic under 100 with the dizzy symptom group; the server context maps the dizziness symptom to it). Chosen over BP-A7, which the v4 draft narrows to patients on BP medicines. Must grade amber, create a low_bp_review task (type amber_bp_review) and must NOT page.'),
  ('glucose_red_severe_hypo', false, 'glucose', null, null, 2.4, null, null, 'red', null, true,
   'HOOK for package P2 (glucose engine). Disabled until the glucose rule set grades through the same bus; then enable this row, no code change.');

-- 3. Subjects: the synthetic organisation, patient, clinician, admin ------------------------------------------------------
create table public.chain_canary_subjects (
  singleton       boolean primary key default true check (singleton),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete restrict,
  admin_id        uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now()
);
alter table public.chain_canary_subjects enable row level security;
revoke all on public.chain_canary_subjects from public, anon, authenticated;

-- Registered with the data registry (S39d requires every table with a patient_id column to be listed). It holds only the id of the one
-- synthetic canary patient, no real person, so it is kept out of any export. Added by the S11 to S15 integration pass.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
values ('chain_canary_subjects', 'patient_id', private.retention_class_for('chain_canary_subjects'), 'review', false,
        'P1 2026-10-13: the synthetic canary patient only (no real person). Not exported. Class proposed by the standing name rule; awaiting the CMO and DPO class review.')
on conflict (table_name) do nothing;

-- The under-18 dependant guard must classify every table with a patient_id column. The canary patient is synthetic and an adult.
insert into public.minor_dependant_table_policy (table_name, policy, reason)
values ('chain_canary_subjects', 'exempt', 'the synthetic canary patient only: not a real person and not a dependant')
on conflict (table_name) do update set policy = excluded.policy, reason = excluded.reason;

-- Anyone whose profile sits in the synthetic organisation. Keyed on the organisation (not the subjects row) so it is true from the moment the
-- profiles are created, before the subjects row can exist.
create function private.chain_canary_is_subject(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p join public.organisations o on o.id = p.organisation_id
                  where p.id = p_profile and o.metadata @> '{"canary": true}'::jsonb)
$$;
revoke all on function private.chain_canary_is_subject(uuid) from public, anon, authenticated;

-- Record, never send: anything for a canary profile is suppressed at insert.
create function private.chain_canary_record_only() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'pending' and private.chain_canary_is_subject(new.recipient_id) then
    new.status := 'suppressed';
    new.last_error := 'canary: recorded, never sent';
  end if;
  return new;
end $$;
revoke all on function private.chain_canary_record_only() from public, anon, authenticated;
create trigger notifications_chain_canary_record_only before insert on public.notifications
  for each row execute function private.chain_canary_record_only();

-- Creates the subjects once (idempotent). Called by the tick, never by a user.
create function private.chain_canary_ensure() returns public.chain_canary_subjects
language plpgsql security definer set search_path = ''
as $$
declare
  s public.chain_canary_subjects;
  v_org uuid; v_pat uuid; v_doc uuid; v_adm uuid;
begin
  select * into s from public.chain_canary_subjects;
  if found then return s; end if;
  perform pg_advisory_xact_lock(hashtext('chain_canary_ensure'));
  select * into s from public.chain_canary_subjects;
  if found then return s; end if;

  insert into public.organisations (name, type, metadata) values ('Tarragon canary (synthetic, no real people)', 'direct_consumer', '{"canary": true}'::jsonb)
    returning id into v_org;

  v_adm := gen_random_uuid(); v_pat := gen_random_uuid(); v_doc := gen_random_uuid();
  -- organisation and role travel in the metadata so private.handle_new_user creates each profile directly in the synthetic organisation with the
  -- right role (without them it files a patient in the real default organisation). Unconfirmed on purpose: a confirmed account triggers a programme claim.
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
  values (v_adm, 'canary-admin-' || v_adm || '@example.invalid', 'x', jsonb_build_object('organisation_id', v_org, 'role', 'admin'), '{"full_name": "Canary admin"}'),
         (v_pat, 'canary-patient-' || v_pat || '@example.invalid', 'x', jsonb_build_object('organisation_id', v_org, 'role', 'patient'), '{"full_name": "Canary patient"}'),
         (v_doc, 'canary-clinician-' || v_doc || '@example.invalid', 'x', jsonb_build_object('organisation_id', v_org, 'role', 'clinician'), '{"full_name": "Canary clinician"}');
  update public.profiles set is_test = true, is_active = true, language = 'en', date_of_birth = (current_date - interval '45 years')::date
   where id in (v_adm, v_pat, v_doc);

  -- A Member: a red event pages only a Member (two-tier model), and doctor tasks are for Members.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (v_org, v_pat, 'purchase', 'active', true);

  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, is_test)
  values (v_org, v_doc, 'Canary clinician', 'MDCN', 'CANARY-' || substr(v_doc::text, 1, 8), true, 'active',
      now(), v_adm, 'senior_medical_officer', 'employed', 2, false, true);

  insert into public.chain_canary_subjects (organisation_id, patient_id, clinician_id, admin_id) values (v_org, v_pat, v_doc, v_adm)
    returning * into s;
  return s;
end $$;
revoke all on function private.chain_canary_ensure() from public, anon, authenticated;

-- The synthetic on-call rota (is_test, so only test patients route to it). A shift of rotaHours; a new one only when none covers the next 90 minutes.
create function private.chain_canary_ensure_rota(s public.chain_canary_subjects) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_hours integer := coalesce((private.chain_canary_rule('rotaHours') #>> '{}')::integer, 4);
begin
  if exists (select 1 from public.on_call_rota r where r.organisation_id = s.organisation_id and r.is_test and r.cancelled_at is null
              and r.starts_at <= now() and r.ends_at >= now() + interval '90 minutes') then
    return;
  end if;
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, built_by, warnings, is_test)
  values (s.organisation_id, now() - interval '1 minute', now() + make_interval(hours => v_hours), s.clinician_id, null, s.admin_id, '{}', true);
  perform set_config('tarragon.lead_write', 'off', true);
end $$;
revoke all on function private.chain_canary_ensure_rota(public.chain_canary_subjects) from public, anon, authenticated;

-- The synthetic clinician acknowledges its own page when the transaction that created it commits, through the real acknowledge_page().
create function private.chain_canary_auto_ack() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_prev text := current_setting('request.jwt.claim.sub', true); v_prev_claims text := current_setting('request.jwt.claims', true);
begin
  if new.parent_page_id is null and new.to_clinician_id is not null and exists (select 1 from public.chain_canary_subjects s where s.clinician_id = new.to_clinician_id) then
    begin
      perform set_config('request.jwt.claim.sub', new.to_clinician_id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', new.to_clinician_id, 'role', 'authenticated')::text, true);
      perform public.acknowledge_page(new.id);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (new.organisation_id, 'chain_canary.ack_error', 'page', new.id, jsonb_build_object('error', sqlerrm));
      -- close it unacknowledged: the run then fails at stage 'ack' once, instead of sweep_pages raising a sev1 incident of its own for every run
      perform set_config('tarragon.paging_write', 'on', true);
      update public.pages set closed_at = now(), close_note = 'chain canary: acknowledgement failed' where id = new.id and closed_at is null;
      perform set_config('tarragon.paging_write', 'off', true);
    end;
    perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  end if;
  return null;
end $$;
revoke all on function private.chain_canary_auto_ack() from public, anon, authenticated;
create constraint trigger pages_chain_canary_auto_ack after insert on public.pages
  deferrable initially deferred for each row when (new.is_test) execute function private.chain_canary_auto_ack();

-- 4. Runs (append only) ---------------------------------------------------------------------------------------------------
create table public.chain_canary_runs (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,
  kind          text not null check (kind in ('started', 'result')),
  at            timestamptz not null default clock_timestamp(),
  config_version integer not null,
  passed        boolean,
  failed_stage  text,
  fixtures      jsonb not null default '[]'::jsonb,
  details       jsonb not null default '{}'::jsonb,
  check ((kind = 'started') = (passed is null)),
  check (passed is distinct from false or failed_stage is not null)
);
create unique index chain_canary_runs_one_of_each on public.chain_canary_runs (run_id, kind);
create index chain_canary_runs_at_idx on public.chain_canary_runs (at desc);
alter table public.chain_canary_runs enable row level security;
create policy chain_canary_runs_read on public.chain_canary_runs for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.chain_canary_runs from public, anon, authenticated;
grant select on public.chain_canary_runs to authenticated;

create function private.chain_canary_runs_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('tarragon.canary_prune', true), '') = 'on' then return old; end if;
  raise exception 'chain_canary_runs is append only' using errcode = '42501';
end $$;
create trigger chain_canary_runs_append_only before update or delete on public.chain_canary_runs
  for each row execute function private.chain_canary_runs_append_only();

-- 5. Start a run ----------------------------------------------------------------------------------------------------------
create function private.chain_canary_start() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  s public.chain_canary_subjects;
  f public.chain_canary_fixtures;
  v_run uuid := gen_random_uuid();
  v_items jsonb := '[]'::jsonb;
  v_rid uuid;
  v_sym uuid;
begin
  s := private.chain_canary_ensure();
  perform private.chain_canary_ensure_rota(s);
  -- self-heal: if the synthetic patient stopped being a Member (a lifecycle sweep ended it), restore it, or a red would take the Free path and the
  -- canary would report a page failure that is really a fixture problem.
  if not private.patient_is_member(s.patient_id) then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (s.organisation_id, s.patient_id, 'purchase', 'active', true);
  end if;
  for f in select * from public.chain_canary_fixtures where is_enabled order by code loop
    v_sym := null;
    if f.symptom_type is not null then
      insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (s.organisation_id, s.patient_id, f.symptom_type::public.symptom_type, 3) returning id into v_sym;
    end if;
    if f.vital_type = 'blood_pressure' then
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
      values (s.organisation_id, s.patient_id, 'blood_pressure', f.systolic, f.diastolic, 'manual', now()) returning id into v_rid;
    else
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, ketones_mmol_l, source, taken_at)
      values (s.organisation_id, s.patient_id, 'glucose', f.glucose_mmol_l, f.ketones_mmol_l, 'manual', now()) returning id into v_rid;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('fixture', f.code, 'reading_id', v_rid, 'symptom_id', v_sym));
  end loop;
  insert into public.chain_canary_runs (run_id, kind, config_version, fixtures)
  values (v_run, 'started', (select version from public.chain_canary_config where is_active), v_items);
  return v_run;
end $$;
revoke all on function private.chain_canary_start() from public, anon, authenticated;

-- 6. Evaluate a run -------------------------------------------------------------------------------------------------------
-- Reads what the chain did and compares the stage times with the budgets. Never fails by raising: a broken check is itself a
-- failed run ('evaluate'), because a canary that stops reporting is the failure it exists to prevent.
create function private.chain_canary_evaluate(p_run uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  st public.chain_canary_runs;
  s public.chain_canary_subjects;
  it jsonb;
  f public.chain_canary_fixtures;
  v_cfg jsonb := (select rules from public.chain_canary_config where is_active);
  rd public.vitals_readings;
  te public.triage_events;
  pg public.pages;
  v_task public.clinical_tasks;
  v_out jsonb := '[]'::jsonb;
  v_stage text; v_msg text; v_one jsonb; v_t jsonb;
  v_n integer; v_viol text[]; v_bad_keys integer;
  v_failed_stage text; v_failed_fixture text; v_sev public.ops_incident_severity := 'sev2';
  v_errs jsonb := '[]'::jsonb;
  v_task_row record;
begin
  select * into st from public.chain_canary_runs where run_id = p_run and kind = 'started';
  if not found then return null; end if;
  if exists (select 1 from public.chain_canary_runs where run_id = p_run and kind = 'result') then return null; end if;
  select * into s from public.chain_canary_subjects;
  if v_cfg is null then raise exception 'no active chain canary config'; end if;

  begin
    for it in select * from jsonb_array_elements(st.fixtures) loop
      select * into f from public.chain_canary_fixtures where code = it ->> 'fixture';
      select * into rd from public.vitals_readings where id = (it ->> 'reading_id')::uuid;
      v_stage := null; v_msg := null; v_t := '{}'::jsonb;

      select * into te from public.triage_events where trigger_type = 'observation' and trigger_id = rd.id order by shadow, created_at limit 1;
      if te.id is null then
        v_stage := 'graded'; v_msg := 'no triage event for the fixture reading: the event bus processor, the observation subscriber or the engine did not run';
      else
        v_t := v_t || jsonb_build_object('graded_seconds', round(extract(epoch from te.created_at - rd.created_at))::int, 'grade', te.grade);
        if te.created_at - rd.created_at > make_interval(secs => (v_cfg ->> 'gradedSeconds')::int) then
          v_stage := 'graded'; v_msg := format('graded after %s seconds (budget %s)', round(extract(epoch from te.created_at - rd.created_at)), v_cfg ->> 'gradedSeconds');
        elsif te.grade <> f.expect_grade then
          v_stage := 'graded_wrong_grade'; v_msg := format('fixture %s expected %s, engine said %s (rule %s v%s). If the rule set was deliberately changed, update the fixture.', f.code, f.expect_grade, te.grade, te.rule_set_code, te.rule_set_version);
        elsif te.shadow then
          v_stage := 'graded_shadow'; v_msg := 'graded by a rule set that is not approved (shadow): no task or page would be made';
        end if;
      end if;

      if v_stage is null then
        -- the bus delivered triage.graded to the task and paging subscribers
        select count(*) into v_n from public.domain_events e where e.event_type = 'triage.graded' and e.aggregate_id = te.id;
        if v_n = 0 then
          v_stage := 'event_emitted'; v_msg := 'triage.graded was not emitted for the graded event';
        else
          for v_task_row in
            select d.subscriber_key, d.status, d.last_error, d.done_at, e.created_at as ev_at
              from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
             where e.event_type = 'triage.graded' and e.aggregate_id = te.id
               and ((f.expect_task_type is not null and d.subscriber_key = 'queue.create_from_triage') or (f.expect_page and d.subscriber_key = 'paging.on_red'))
          loop
            if v_task_row.status <> 'done' then
              v_stage := 'event_delivered'; v_msg := format('subscriber %s is %s%s', v_task_row.subscriber_key, v_task_row.status, coalesce(': ' || left(v_task_row.last_error, 160), ''));
            end if;
          end loop;
        end if;
      end if;

      if v_stage is null and f.expect_task_type is not null then
        select * into v_task from public.clinical_tasks where triage_event_id = te.id and type = f.expect_task_type order by created_at limit 1;
        if v_task.id is null then
          v_stage := 'task'; v_msg := format('no %s task for the amber event', f.expect_task_type);
        else
          v_t := v_t || jsonb_build_object('task_seconds', round(extract(epoch from v_task.created_at - te.created_at))::int);
          if v_task.created_at - te.created_at > make_interval(secs => (v_cfg ->> 'taskSeconds')::int) then
            v_stage := 'task'; v_msg := format('task made after %s seconds (budget %s)', round(extract(epoch from v_task.created_at - te.created_at)), v_cfg ->> 'taskSeconds');
          end if;
        end if;
      end if;

      if v_stage is null and f.expect_page then
        select * into pg from public.pages where triage_event_id = te.id and parent_page_id is null;
        if pg.id is null then
          v_stage := 'page'; v_msg := 'a red event made no page for the on-call clinician';
        elsif pg.to_clinician_id is distinct from s.clinician_id then
          v_stage := 'page'; v_msg := 'the page went to someone other than the synthetic on-call clinician';
        else
          v_t := v_t || jsonb_build_object('page_seconds', round(extract(epoch from pg.sent_at - te.created_at))::int);
          if pg.sent_at - te.created_at > make_interval(secs => (v_cfg ->> 'pageSeconds')::int) then
            v_stage := 'page'; v_msg := format('page sent after %s seconds (budget %s)', round(extract(epoch from pg.sent_at - te.created_at)), v_cfg ->> 'pageSeconds');
          end if;
        end if;
        if v_stage is null then
          v_viol := array(select distinct unnest(private.notification_text_violations(n.payload::text))
                            from public.notifications n where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page');
          select count(distinct n.channel) into v_n from public.notifications n where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page'
             and n.content_class = 'non_clinical' and n.priority = 'critical' and n.recipient_id = s.clinician_id;
          select count(*) into v_bad_keys from public.notifications n, jsonb_object_keys(n.payload) k
           where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page' and k <> 'page_id';
          if v_n < 3 then
            v_stage := 'notification'; v_msg := format('the page made %s of its 3 critical notice rows (push, in-app, email); every channel must have one', v_n);
          elsif v_bad_keys > 0 or cardinality(v_viol) > 0 then
            v_stage := 'notification_not_neutral'; v_msg := 'the page notification payload carries more than the page id or a forbidden term (INV-07)';
          elsif exists (select 1 from public.notifications n where n.source_table = 'pages' and n.source_id = pg.id and n.template = 'on_call_page'
                          and n.created_at - pg.sent_at > make_interval(secs => (v_cfg ->> 'notificationSeconds')::int)) then
            v_stage := 'notification'; v_msg := format('a page notice was recorded more than %s seconds after the page', v_cfg ->> 'notificationSeconds');
          else
            v_t := v_t || jsonb_build_object('notifications', v_n);
          end if;
        end if;
        if v_stage is null then
          if pg.acknowledged_at is null then
            v_stage := 'ack'; v_msg := 'the synthetic clinician did not acknowledge the page (public.acknowledge_page or the page write guard is broken)';
          else
            v_t := v_t || jsonb_build_object('ack_seconds', round(extract(epoch from pg.acknowledged_at - pg.sent_at))::int);
            if pg.acknowledged_at - pg.sent_at > make_interval(secs => (v_cfg ->> 'ackSeconds')::int) then
              v_stage := 'ack'; v_msg := 'acknowledged outside the budget';
            end if;
          end if;
        end if;
      elsif v_stage is null and not f.expect_page then
        if exists (select 1 from public.pages where triage_event_id = te.id) then
          v_stage := 'unexpected_page'; v_msg := 'a non-red fixture made a page';
        end if;
      end if;

      v_one := jsonb_build_object('fixture', f.code, 'reading_id', rd.id, 'passed', v_stage is null, 'stage', v_stage, 'message', v_msg, 'timings', v_t);
      v_out := v_out || jsonb_build_array(v_one);
      if v_stage is not null and v_failed_stage is null then
        v_failed_stage := v_stage; v_failed_fixture := f.code;
      end if;
      if v_stage is not null and f.expect_page then v_sev := 'sev1'; end if;
    end loop;
  exception when others then
    v_failed_stage := 'evaluate'; v_failed_fixture := null; v_sev := 'sev2';
    v_out := v_out || jsonb_build_array(jsonb_build_object('stage', 'evaluate', 'message', 'the canary check itself failed: ' || sqlerrm));
  end;

  -- clean up so the next run starts clean: cancel its tasks, close its pages, resolve its legacy alerts. A cleanup failure is
  -- recorded, never hidden, and never turns a passed run into a failed one.
  begin
    for v_task_row in select id from public.clinical_tasks where organisation_id = s.organisation_id and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed') loop
      begin
        perform private.apply_task_transition(v_task_row.id, 'cancelled', 'lead', null, 'chain canary clean-up');
      exception when others then v_errs := v_errs || to_jsonb('task: ' || sqlerrm); end;
    end loop;
    begin
      -- every open page of the synthetic organisation, acknowledged or not: an unacknowledged one left open would be escalated by sweep_pages into
      -- a real sev1 incident of its own, one per run, instead of the single named 'ack' incident
      perform set_config('tarragon.paging_write', 'on', true);
      update public.pages set closed_at = now(), close_note = 'chain canary clean-up' where organisation_id = s.organisation_id and closed_at is null;
      perform set_config('tarragon.paging_write', 'off', true);
    exception when others then perform set_config('tarragon.paging_write', 'off', true); v_errs := v_errs || to_jsonb('page: ' || sqlerrm); end;
    begin
      update public.clinician_alerts set status = 'resolved', resolution_action = 'chain canary clean-up', resolution_outcome = 'no_action_needed'
         where organisation_id = s.organisation_id and status not in ('resolved', 'closed');
    exception when others then v_errs := v_errs || to_jsonb('alerts: ' || sqlerrm); end;
    begin
      update public.emergency_events set status = 'resolved' where organisation_id = s.organisation_id and status = 'active';
    exception when others then v_errs := v_errs || to_jsonb('emergency: ' || sqlerrm); end;
  exception when others then v_errs := v_errs || to_jsonb('cleanup: ' || sqlerrm);
  end;

  insert into public.chain_canary_runs (run_id, kind, config_version, passed, failed_stage, fixtures, details)
  values (p_run, 'result', st.config_version, v_failed_stage is null, v_failed_stage, v_out,
          jsonb_build_object('failed_fixture', v_failed_fixture, 'cleanup_errors', v_errs, 'evaluated_after_seconds', round(extract(epoch from now() - st.at))::int));

  if v_failed_stage is not null then
    perform private.ops_alert_incident('chain_canary:' || v_failed_stage,
      'Clinical chain canary missed at stage: ' || v_failed_stage,
      format('The synthetic check for the clinical chain failed at stage "%s"%s. %s Open the chain health page (/admin/ops/chain-health or /clinician/chain-health) for the timeline. Run %s.',
             v_failed_stage, coalesce(' (fixture ' || v_failed_fixture || ')', ''),
             coalesce((select string_agg(x ->> 'message', ' ') from jsonb_array_elements(v_out) x where x ->> 'message' is not null), ''), p_run),
      v_sev);
  end if;
  return v_failed_stage is null;
end $$;
revoke all on function private.chain_canary_evaluate(uuid) from public, anon, authenticated;

-- 7. The scheduled tick ---------------------------------------------------------------------------------------------------
-- One run at a time, each step guarded so a failure in one cannot stop the others or roll back the tick (found in review: an unguarded
-- evaluate would have rolled the whole tick back on every cron run and left the canary dead while the job looked healthy).
create function private.chain_canary_evaluate_safe(p_run uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.chain_canary_evaluate(p_run);
exception when others then
  begin
    insert into public.chain_canary_runs (run_id, kind, config_version, passed, failed_stage, details)
    select p_run, 'result', coalesce(s.config_version, 0), false, 'evaluate', jsonb_build_object('error', sqlerrm)
      from public.chain_canary_runs s where s.run_id = p_run and s.kind = 'started'
      and not exists (select 1 from public.chain_canary_runs x where x.run_id = p_run and x.kind = 'result');
  exception when others then null;
  end;
  begin
    perform private.ops_alert_incident('chain_canary:evaluate', 'Clinical chain canary could not be evaluated',
      'The canary run ' || p_run || ' could not be judged: ' || sqlerrm || '. Until this is fixed the chain is not being checked.', 'sev1');
  exception when others then
    raise warning 'chain canary: could not raise the evaluate incident: %', sqlerrm;
  end;
end $$;
revoke all on function private.chain_canary_evaluate_safe(uuid) from public, anon, authenticated;

create function private.chain_canary_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb := (select rules from public.chain_canary_config where is_active);
  r record;
  v_eval integer := 0; v_started uuid; v_last timestamptz; v_first_start timestamptz;
begin
  if v_cfg is null then
    perform private.ops_alert_incident('chain_canary:config', 'Clinical chain canary has no active configuration', 'chain_canary_config has no active row, so no run can be judged.', 'sev1');
    return jsonb_build_object('skipped', 'no active config');
  end if;
  if not pg_try_advisory_xact_lock(hashtext('chain_canary_tick')) then return jsonb_build_object('skipped', 'busy'); end if;

  -- the canary itself must not die quietly. Judged BEFORE this tick writes its own results, from what the previous ticks left. (The job itself
  -- dying is caught by the stale_cron rule, which does not depend on this function; this catches a tick that runs but never finishes a run.)
  begin
    select max(at) into v_last from public.chain_canary_runs where kind = 'result';
    select min(at) into v_first_start from public.chain_canary_runs where kind = 'started';
    if (v_last is not null and v_last < now() - make_interval(mins => (v_cfg ->> 'staleAfterMinutes')::int))
       or (v_last is null and v_first_start is not null and v_first_start < now() - make_interval(mins => (v_cfg ->> 'staleAfterMinutes')::int)) then
      perform private.ops_alert_incident('chain_canary:stale', 'Clinical chain canary has stopped reporting',
        format('No canary run has finished since %s although the scheduled job is running.', coalesce(v_last::text, 'the first run')), 'sev2');
    end if;
  exception when others then raise warning 'chain canary stale check failed: %', sqlerrm; end;

  -- evaluate every run that has had time to finish
  for r in select s.run_id from public.chain_canary_runs s
            where s.kind = 'started' and s.at < now() - make_interval(secs => (v_cfg ->> 'minEvalAgeSeconds')::int)
              and not exists (select 1 from public.chain_canary_runs x where x.run_id = s.run_id and x.kind = 'result') order by s.at loop
    perform private.chain_canary_evaluate_safe(r.run_id);
    v_eval := v_eval + 1;
  end loop;

  -- start the next run unless one is still waiting to be evaluated
  if not exists (select 1 from public.chain_canary_runs s where s.kind = 'started'
                  and not exists (select 1 from public.chain_canary_runs x where x.run_id = s.run_id and x.kind = 'result')) then
    begin
      v_started := private.chain_canary_start();
    exception when others then
      -- could not even start: that is a failed run, named 'start'
      declare v_id uuid := gen_random_uuid(); v_err text := sqlerrm;
      begin
        insert into public.chain_canary_runs (run_id, kind, config_version) values (v_id, 'started', (select version from public.chain_canary_config where is_active));
        insert into public.chain_canary_runs (run_id, kind, config_version, passed, failed_stage, details)
          values (v_id, 'result', (select version from public.chain_canary_config where is_active), false, 'start', jsonb_build_object('error', v_err));
        perform private.ops_alert_incident('chain_canary:start', 'Clinical chain canary could not start',
          'The synthetic reading could not be inserted: ' || v_err, 'sev1');
      exception when others then raise warning 'chain canary start failure could not be recorded: %', sqlerrm; end;
    end;
  end if;

  begin perform private.chain_canary_prune(); exception when others then raise warning 'chain canary prune failed: %', sqlerrm; end;
  return jsonb_build_object('evaluated', v_eval, 'started', v_started);
end $$;
revoke all on function private.chain_canary_tick() from public, anon, authenticated;

-- 30 days of canary history in the runs table. (triage_events is append-only and is left alone.)
create function private.chain_canary_prune() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_days integer := coalesce((private.chain_canary_rule('retentionDays') #>> '{}')::integer, 30);
begin
  perform set_config('tarragon.canary_prune', 'on', true);
  delete from public.chain_canary_runs where at < now() - make_interval(days => v_days);
  perform set_config('tarragon.canary_prune', 'off', true);
end $$;
revoke all on function private.chain_canary_prune() from public, anon, authenticated;

-- Manual run for the CMO or an admin ("run it now"): starts a run when none is waiting; the next tick judges it. Returns the run id.
create function public.chain_canary_run_now() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_run uuid;
  v_uid uuid := (select auth.uid());
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'chain_canary_not_authorised' using errcode = '42501';
  end if;
  -- the same lock the tick takes, so a click and a tick cannot both start a run
  perform pg_advisory_xact_lock(hashtext('chain_canary_tick'));
  -- never while another run is waiting to be judged: the judge cleans up the whole synthetic organisation and would cancel this run's tasks
  if exists (select 1 from public.chain_canary_runs s where s.kind = 'started'
              and not exists (select 1 from public.chain_canary_runs x where x.run_id = s.run_id and x.kind = 'result')) then
    raise exception 'a canary run is still waiting to be judged' using errcode = '22023';
  end if;
  -- the synthetic readings must not carry the clicking admin or CMO as their actor (triggers read auth.uid() for attribution)
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  v_run := private.chain_canary_start();
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform private.log_audit('chain_canary.run_now', 'chain_canary_run', v_run, '{}'::jsonb);
  return v_run;
end $$;
revoke all on function public.chain_canary_run_now() from public, anon;
grant execute on function public.chain_canary_run_now() to authenticated;

-- 8. One cron job, staggered (minutes 11 and 41) ---------------------------------------------------------------------------
-- The tick runs only once the platform holds a real (non-test) patient. A canary that checks a chain with nobody on it proves nothing, and on a
-- fresh replay (CI, a new local stack) its first tick would create the synthetic organisation and three profiles in the middle of the SQL proof
-- run, which several older proofs read as "the organisation with the most profiles" or "any other organisation".
select cron.schedule('chain-canary', '11,41 * * * *', $$select private.chain_canary_tick() where exists (select 1 from public.profiles where role = 'patient' and not is_test);$$);

do $$
begin
  if has_function_privilege('anon', 'public.chain_canary_run_now()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.chain_canary_tick()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.chain_canary_start()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.chain_canary_subjects', 'SELECT')
     or has_table_privilege('authenticated', 'public.chain_canary_runs', 'INSERT') then
    raise exception 'P1 chain canary grants are too wide';
  end if;
  if (select count(*) from cron.job where jobname = 'chain-canary') <> 1 then raise exception 'P1: the canary cron job is missing'; end if;
end $$;
