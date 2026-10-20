-- S07y: "home cuff vs clinic cuff". A clinician-only flag that the patient's own blood pressure cuff may read differently from the clinic cuff.
--
-- Cheap unvalidated cuffs are common. Beside a clinic reading (S07x record_clinic_bp_reading) the care team can hold the patient's own cuff reading in two ways:
--   (a) a SAME-VISIT pair, entered on purpose with record_cuff_check_pair (clinic reading and the patient's own cuff reading taken at the visit, plus the device label), or
--   (b) a HOME-LOG pair, made automatically when a clinic reading is recorded: the mean of the patient's own manual or device home readings within +/- windowHours of it.
-- If the own cuff reads differently from the clinic cuff by at least a configured amount, in the SAME direction, across enough pairs, a routine class 8 task
-- 'cuff_check_review' is raised for the care team ("consider a cuff check"). It is about the cuff, not a diagnosis.
--
-- NOTHING IS SWITCHED ON AND NOTHING IS SIGNED. The configuration row cuff_check_rules v1 ships UNSIGNED and INACTIVE (every number is PROPOSED; sign_cuff_check_rules() by
-- the Chief Medical Officer activates it). Two go-live guards are born OFF (INV-14): cuff_check_flag (the rule) and cuff_visit_prompt (the neutral patient line). Neither acts
-- on an unsigned configuration (INV-16). Entering a pair is never behind a guard (it only stores data), exactly like a clinic reading.
--
-- SAFETY (clinician-only): the pair and flag tables have NO patient policy; the task holds no value, no label and no pattern (INV-07); the rule never changes a medicine (INV-02).
-- The only thing a patient can ever see is cuff_visit_prompt_open(): one boolean that is true for EVERY patient with that guard open and the wording attested by the CMO. It does
-- not depend on any flag, so it cannot reveal one. The wording itself is an unsigned i18n string until the CMO records the attestation in the sign-off hub.
--
-- DESIGN: own tables (not vitals_readings), for the same reason as clinic_bp_readings (see the S07x migration): no home red-flag engine, observation event or home average sees a pair.
-- Known limit (OQ-S07Y-1): a home-log pair is made when the clinic reading is saved, so it sees home readings taken BEFORE that moment only. The same-visit pair has no such limit.
--
-- COUNTS / LIVE FACTS (2026-10-20, read-only): live ledger head 20261020173600; no table named cuff_check_*; go_live_guards has no cuff row; task_types has no cuff_check_review.

-- 1. The governed configuration (the shared single-active-row shape, signed by sign_*) ------------------------------------------------
create table public.cuff_check_rules (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create unique index cuff_check_rules_one_active on public.cuff_check_rules (is_active) where is_active;

-- cuff-check-config-begin
insert into public.cuff_check_rules (version, is_active, config, notes)
values (1, false, $json${
 "pairing": {
  "windowHours": 24,
  "minHomeReadings": 2
 },
 "difference": {
  "systolic": 10,
  "diastolic": 5
 },
 "consistency": {
  "minPairs": 3,
  "maxPairs": 5,
  "lookbackDays": 365,
  "minSharePercent": 75
 },
 "tasks": {
  "reviewDueMinutes": 10080
 }
}$json$::jsonb,
        'PROPOSED, unsigned and inactive. Every number is a proposal for the Chief Medical Officer: how far apart two cuffs may read (10 over 5 mmHg), how many pairs (3 to 5, within a year, 75 percent in one direction) and how near a home reading must be to a clinic reading (24 hours, at least 2 readings). Until sign_cuff_check_rules() is called by the CMO the rule cannot raise a task.');
-- cuff-check-config-end

create function private.cuff_check_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.cuff_check_rules where is_active and approved_by is not null $$;
revoke all on function private.cuff_check_config() from public, anon, authenticated;

create function private.cuff_check_config_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.cuff_check_rules where is_active and approved_by is not null $$;
revoke all on function private.cuff_check_config_version() from public, anon, authenticated;

create function public.sign_cuff_check_rules(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.cuff_check_rules where id = p_id) then raise exception 'Cuff check rules version not found'; end if;
  if exists (select 1 from public.cuff_check_rules where id = p_id and approved_by is not null) then
    raise exception 'this version is already signed; a change is a new version';
  end if;
  -- every key the server functions read must be present, or every later call would fail on a missing value
  perform 1 from public.cuff_check_rules c, unnest(array[
      '{pairing,windowHours}', '{pairing,minHomeReadings}', '{difference,systolic}', '{difference,diastolic}',
      '{consistency,minPairs}', '{consistency,maxPairs}', '{consistency,lookbackDays}', '{consistency,minSharePercent}', '{tasks,reviewDueMinutes}']::text[]) k
   where c.id = p_id and (c.config #> k::text[]) is null;
  if found then raise exception 'this version is missing a value the rule needs and cannot be signed'; end if;
  -- every value must be a whole number inside the range the rule can work with; the same checks the TypeScript loader makes (a signed version that never fires is a silent failure)
  perform 1 from public.cuff_check_rules c,
    (values ('{pairing,windowHours}', 1), ('{pairing,minHomeReadings}', 1), ('{difference,systolic}', 1), ('{difference,diastolic}', 1),
            ('{consistency,minPairs}', 2), ('{consistency,maxPairs}', 2), ('{consistency,lookbackDays}', 1), ('{consistency,minSharePercent}', 51), ('{tasks,reviewDueMinutes}', 1)) as k(path, lo)
   where c.id = p_id
     and (jsonb_typeof(c.config #> k.path::text[]) <> 'number' or (c.config #>> k.path::text[]) !~ '^[0-9]+$' or (c.config #>> k.path::text[])::numeric < k.lo);
  if found then raise exception 'this version has a value that is not a whole number in range and cannot be signed'; end if;
  if (select (config #>> '{consistency,maxPairs}')::int < (config #>> '{consistency,minPairs}')::int or (config #>> '{consistency,minSharePercent}')::int > 100
        from public.cuff_check_rules where id = p_id) then
    raise exception 'this version has a pair count or share that cannot work and cannot be signed';
  end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the cuff check rules'; end if;
  update public.cuff_check_rules set is_active = false where is_active and id <> p_id;
  update public.cuff_check_rules set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('cuff_check_rules.signed', 'cuff_check_rules', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_cuff_check_rules(uuid) from public, anon;
grant execute on function public.sign_cuff_check_rules(uuid) to authenticated;

alter table public.cuff_check_rules enable row level security;
-- staff only: a patient has no reason to read the thresholds of a clinician-only rule
create policy cuff_check_rules_read on public.cuff_check_rules for select to authenticated
  using (private.is_admin() or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active));
revoke all on public.cuff_check_rules from public, anon, authenticated;
grant select on public.cuff_check_rules to authenticated;

-- never activate a version older than one already signed (same guard as the other governed tables)
create trigger refuse_superseded_activation before update of is_active on public.cuff_check_rules
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- 2. Pairs and flags (append-only; written only by the functions below; NO patient policy) -----------------------------------------------
create function private.cuff_check_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
revoke all on function private.cuff_check_append_only() from public, anon, authenticated;

create table public.cuff_check_pairs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  source            text not null check (source in ('same_visit', 'home_log')),
  clinic_systolic   smallint not null check (clinic_systolic between 60 and 260),
  clinic_diastolic  smallint not null check (clinic_diastolic between 30 and 160),
  own_systolic      smallint not null check (own_systolic between 60 and 260),
  own_diastolic     smallint not null check (own_diastolic between 30 and 160),
  own_readings      smallint not null default 1 check (own_readings >= 1),
  d_systolic        smallint not null,
  d_diastolic       smallint not null,
  measured_at       timestamptz not null,
  device_label      text check (device_label is null or length(device_label) <= 80),
  clinic_reading_id uuid references public.clinic_bp_readings (id) on delete cascade,
  config_version    integer,
  recorded_by       uuid references public.profiles (id) on delete restrict,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check ((source = 'home_log') = (clinic_reading_id is not null)),
  check (d_systolic = own_systolic - clinic_systolic and d_diastolic = own_diastolic - clinic_diastolic)
);
create unique index cuff_check_pairs_one_per_clinic_reading on public.cuff_check_pairs (clinic_reading_id) where clinic_reading_id is not null;
create index cuff_check_pairs_patient_idx on public.cuff_check_pairs (patient_id, measured_at desc);
comment on table public.cuff_check_pairs is 'S07y: the patient''s own cuff beside a clinic cuff (a same-visit pair entered by the care team, or the mean of the home log around a clinic reading). Own difference = own minus clinic. Append-only, staff read only through a tie, NO patient policy.';

create table public.cuff_check_flags (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('home_higher', 'home_lower')),
  pairs_used      smallint not null check (pairs_used >= 1),
  matching        smallint not null check (matching >= 1),
  latest_pair_id  uuid not null references public.cuff_check_pairs (id) on delete cascade,
  config_version  integer not null,
  task_id         uuid references public.clinical_tasks (id) on delete set null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (latest_pair_id, kind)
);
create index cuff_check_flags_patient_idx on public.cuff_check_flags (patient_id, created_at desc);
comment on table public.cuff_check_flags is 'S07y: the own cuff reads differently from the clinic cuff across enough pairs. For the care team only: a reason to consider a cuff check, never a label, never in a notification (INV-07), never changes a medicine (INV-02). Append-only, NO patient policy.';

do $$
declare t text;
begin
  foreach t in array array['cuff_check_pairs', 'cuff_check_flags'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.cuff_check_append_only()', t || '_no_change', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.cuff_check_append_only()', t || '_no_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy cuff_check_pairs_read on public.cuff_check_pairs for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
create policy cuff_check_flags_read on public.cuff_check_flags for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('cuff_check_pairs', 'tied', 'patient_id', 'medical_history', null),
  ('cuff_check_flags', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('cuff_check_pairs', 'patient_id', 'clinical_record', 'review', false, 'S07y. PROPOSED class, to be confirmed by the CMO and DPO. Holds clinic and own-cuff readings; the DPO decides whether a subject-access request must include them (OQ-S07Y-2).'),
  ('cuff_check_flags', 'patient_id', 'clinical_record', 'review', false, 'S07y. Clinician-only working flag, never patient-facing. Not exported to the patient: the DPO decides whether a subject-access request must include it (OQ-S07Y-2).')
on conflict (table_name) do nothing;

-- 3. Task type (routine, class 8) -----------------------------------------------------------------------------------------------------------
-- task-types-s07y-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('cuff_check_review', 1, 8, 10080, 'senior_medical_officer', '{hypertension}', 1440, 30, true, true, '{}',
   'S07y: the patient''s own cuff may read differently from the clinic cuff. A routine "consider a cuff check" for the care team. Holds no reading, no label and no pattern (INV-07). Never explained to the patient by this task, never changes a medicine (INV-02).');
-- task-types-s07y-end

-- 4. The rules, in SQL. Parity with packages/clinical/src/cuff-check.ts is tested (the parity block in the proof). ---------------------------
create function private.cuff_pair_class(p_ds integer, p_dd integer, p_cfg jsonb) returns text
language sql immutable set search_path = ''
as $$
  select case
    when (p_ds >= (p_cfg -> 'difference' ->> 'systolic')::int or p_dd >= (p_cfg -> 'difference' ->> 'diastolic')::int)
     and (p_ds <= -(p_cfg -> 'difference' ->> 'systolic')::int or p_dd <= -(p_cfg -> 'difference' ->> 'diastolic')::int) then 'mixed'
    when p_ds >= (p_cfg -> 'difference' ->> 'systolic')::int or p_dd >= (p_cfg -> 'difference' ->> 'diastolic')::int then 'home_higher'
    when p_ds <= -(p_cfg -> 'difference' ->> 'systolic')::int or p_dd <= -(p_cfg -> 'difference' ->> 'diastolic')::int then 'home_lower'
    else 'agree' end
$$;
revoke all on function private.cuff_pair_class(integer, integer, jsonb) from public, anon, authenticated;

-- readings: [{s, d, at}]. Null when fewer than minHomeReadings lie within windowHours either side of the clinic reading.
create function private.cuff_home_mean(p_readings jsonb, p_clinic_at timestamptz, p_cfg jsonb) returns jsonb
language sql stable set search_path = ''
as $$
  with c as (select (p_cfg -> 'pairing' ->> 'windowHours')::int as w, (p_cfg -> 'pairing' ->> 'minHomeReadings')::int as m),
  r as (select (e ->> 's')::int as s, (e ->> 'd')::int as d, (e ->> 'at')::timestamptz as ts from jsonb_array_elements(p_readings) e),
  n as (select r.* from r, c where abs(extract(epoch from (r.ts - p_clinic_at))) <= c.w * 3600),
  agg as (select count(*)::int as cnt, round(avg(s))::int as ms, round(avg(d))::int as md from n)
  select case when agg.cnt >= c.m then jsonb_build_object('systolic', agg.ms, 'diastolic', agg.md, 'count', agg.cnt) end
    from agg, c
$$;
revoke all on function private.cuff_home_mean(jsonb, timestamptz, jsonb) from public, anon, authenticated;

-- pairs: [{at, ds, dd}] (own minus clinic). Result {kind, pairsUsed, matching}; kind is null unless consistently off in ONE direction.
create function private.cuff_check_kind(p_pairs jsonb, p_now timestamptz, p_cfg jsonb) returns jsonb
language sql stable set search_path = ''
as $$
  with c as (select (p_cfg -> 'consistency' ->> 'minPairs')::int as mn, (p_cfg -> 'consistency' ->> 'maxPairs')::int as mx,
                    (p_cfg -> 'consistency' ->> 'lookbackDays')::int as lb, (p_cfg -> 'consistency' ->> 'minSharePercent')::int as sh),
  p as (select (e ->> 'at')::timestamptz as ts, (e ->> 'ds')::int as ds, (e ->> 'dd')::int as dd from jsonb_array_elements(p_pairs) e),
  u as (select p.*, private.cuff_pair_class(p.ds, p.dd, p_cfg) as k
          from p, c where p.ts <= p_now and p_now - p.ts <= make_interval(days => c.lb)
         order by p.ts desc, p.ds desc, p.dd desc
         limit (select mx from c)),
  agg as (select count(*)::int as n, (count(*) filter (where k = 'home_higher'))::int as hi, (count(*) filter (where k = 'home_lower'))::int as lo from u),
  f as (select agg.*, c.mn, c.sh,
               (agg.hi >= c.mn and agg.hi * 100 >= c.sh * agg.n) as hi_ok,
               (agg.lo >= c.mn and agg.lo * 100 >= c.sh * agg.n) as lo_ok
          from agg, c)
  select case
    when f.n < f.mn then jsonb_build_object('kind', null, 'pairsUsed', f.n, 'matching', 0)
    when f.hi_ok and not f.lo_ok then jsonb_build_object('kind', 'home_higher', 'pairsUsed', f.n, 'matching', f.hi)
    when f.lo_ok and not f.hi_ok then jsonb_build_object('kind', 'home_lower', 'pairsUsed', f.n, 'matching', f.lo)
    else jsonb_build_object('kind', null, 'pairsUsed', f.n, 'matching', 0) end
    from f
$$;
revoke all on function private.cuff_check_kind(jsonb, timestamptz, jsonb) from public, anon, authenticated;

-- 5. Go-live guards (born OFF) ---------------------------------------------------------------------------------------------------------------
create function private.cuff_check_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_key = 'cuff_visit_prompt' then
    return jsonb_build_array(
      private.go_live_cond('visit_prompt_wording_signed', 'The Chief Medical Officer has signed the neutral patient line about bringing the cuff to a visit',
        private.go_live_attested(p_key, 'visit_prompt_wording_signed'), 'attestation', null),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  end if;
  return jsonb_build_array(
    private.go_live_cond('config_signed', 'The cuff check rules (difference, pairs, window) are signed by the Chief Medical Officer',
      exists (select 1 from public.cuff_check_rules where is_active and approved_by is not null), 'data',
      (select 'version ' || version from public.cuff_check_rules where is_active and approved_by is not null)),
    private.go_live_cond('task_type_active', 'The care-team review task type exists',
      exists (select 1 from public.task_types where code = 'cuff_check_review' and is_active and creatable), 'data', null),
    private.go_live_cond('flag_is_clinician_only', 'The cuff flag is understood to be clinician-only: no patient screen, notification or export shows it',
      private.go_live_attested(p_key, 'flag_is_clinician_only'), 'attestation', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.cuff_check_go_live_conditions(text) from public, anon, authenticated, service_role;

-- Add the branch to the CURRENT private.go_live_conditions (raises if the fall-through anchor is gone, never rewrites blindly).
do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%cuff_check_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the cuff check branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor,
    E'\n  elsif p_key in (''cuff_check_flag'', ''cuff_visit_prompt'') then\n    return private.cuff_check_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
end $$;

-- The two conditions a person records must be on the list of attestable conditions. Patched in place from the CURRENT definition.
do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor constant text := $a$('bp_pattern_flag', 'pattern_is_clinician_only'),$a$;
begin
  if position('visit_prompt_wording_signed' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $b$ ('cuff_check_flag', 'flag_is_clinician_only'), ('cuff_visit_prompt', 'visit_prompt_wording_signed'),$b$);
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('cuff_check_flag', 'Home cuff vs clinic cuff check (clinician-only flag)',
   'Raising a "consider a cuff check" task from pairs of clinic and own-cuff readings, and making home-log pairs from clinic readings',
   'The cuff check rules are signed by the Chief Medical Officer; the review task type exists; it is recorded that the flag is clinician-only',
   'cmo', array['evaluate_cuff_check', 'cuff_check_pair_from_clinic'],
   'Entering a same-visit pair or a clinic reading is never behind this guard (it only stores data). Nothing here is ever shown to the patient.'),
  ('cuff_visit_prompt', 'Neutral "bring your cuff to a visit" line for patients',
   'Showing one neutral line to every patient: bring your blood pressure cuff to your next visit so it can be checked next to ours',
   'The Chief Medical Officer has signed the exact wording (recorded in the sign-off hub)',
   'cmo', array['cuff_visit_prompt_open'],
   'The line is the same for every patient and does not depend on any flag. No patient app screen shows it until a screen is built and this guard is on.')
on conflict (key) do nothing;

-- 6. Incidents (never silent) -----------------------------------------------------------------------------------------------------------------
create function private.cuff_check_open_incident(p_patient uuid, p_state text, p_msg text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  raise warning 'cuff check rule failed for a patient: % %', p_state, p_msg;
  begin
    if not exists (select 1 from public.ops_incidents where external_reference = 'cuff_check_rule' and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values ((select organisation_id from public.profiles where id = p_patient), 'technical', 'sev3', 'The home cuff vs clinic cuff rule failed',
              format('The rule raised %s (%s). The clinician''s reading or pair was saved; only the cuff check was skipped. Every patient''s pairs are re-judged together at their next pair or clinic reading, so nobody is lost once the cause is fixed. Check task type cuff_check_review and the signed configuration.', p_state, p_msg),
              'cuff_check_rule', now(), now());
    end if;
  exception when others then
    raise warning 'could not open an incident for the cuff check rule: %', sqlerrm;
  end;
end $$;
revoke all on function private.cuff_check_open_incident(uuid, text, text) from public, anon, authenticated;

-- 7. The rule: consistently off in one direction raises ONE routine task ---------------------------------------------------------------
create function private.evaluate_cuff_check(p_patient uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_pr public.profiles%rowtype;
  v_pairs jsonb;
  v_res jsonb;
  v_kind text;
  v_latest uuid;
  v_task uuid;
  v_flag uuid := gen_random_uuid();
begin
  -- fail closed: the guard is off or the configuration is unsigned, so nothing is raised (INV-14, INV-16)
  if not private.go_live_open_patient('cuff_check_flag', p_patient) then return null; end if;
  v_cfg := private.cuff_check_config();
  if v_cfg is null then return null; end if;
  select * into v_pr from public.profiles where id = p_patient and role = 'patient';
  if not found then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('cuff_check:' || p_patient, 0));
  -- one visit is one pair: a home-log pair made around a clinic reading is not counted when a same-visit pair was entered within the same window
  select coalesce(jsonb_agg(jsonb_build_object('at', p.measured_at, 'ds', p.d_systolic, 'dd', p.d_diastolic)), '[]'::jsonb) into v_pairs
    from public.cuff_check_pairs p
   where p.patient_id = p_patient
     and not (p.source = 'home_log' and exists (
           select 1 from public.cuff_check_pairs s where s.patient_id = p.patient_id and s.source = 'same_visit'
              and abs(extract(epoch from (s.measured_at - p.measured_at))) <= (v_cfg -> 'pairing' ->> 'windowHours')::int * 3600));
  v_res := private.cuff_check_kind(v_pairs, now(), v_cfg);
  v_kind := v_res ->> 'kind';
  if v_kind is null then return null; end if;
  select id into v_latest from public.cuff_check_pairs where patient_id = p_patient order by measured_at desc, created_at desc, id limit 1;
  if exists (select 1 from public.cuff_check_flags f where f.latest_pair_id = v_latest and f.kind = v_kind) then return null; end if;
  -- the same direction is already with the care team (its task is still open): a further pair adds nothing for them to do, so no second flag
  if exists (select 1 from public.cuff_check_flags f join public.clinical_tasks t on t.id = f.task_id
              where f.patient_id = p_patient and f.kind = v_kind and t.state not in ('completed', 'cancelled')) then return null; end if;

  -- one open task per patient (the key carries no direction, so a task list never shows which way a cuff reads): a further flag merges into it
  v_task := private.create_clinical_task(p_patient, 'cuff_check_review', (v_cfg -> 'tasks' ->> 'reviewDueMinutes')::int,
    'cuff_check:' || p_patient, null, null, null);
  insert into public.cuff_check_flags (id, organisation_id, patient_id, kind, pairs_used, matching, latest_pair_id, config_version, task_id, is_test)
  values (v_flag, v_pr.organisation_id, p_patient, v_kind, (v_res ->> 'pairsUsed')::int, (v_res ->> 'matching')::int, v_latest, private.cuff_check_config_version(), v_task, coalesce(v_pr.is_test, false));
  -- No audit_log row on purpose (audit_log is readable by its actor); the flag row and its task are the record, and neither has a patient policy.
  return v_flag;
end $$;
revoke all on function private.evaluate_cuff_check(uuid) from public, anon, authenticated;

create function private.evaluate_cuff_check_safe(p_patient uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.evaluate_cuff_check(p_patient);
exception when others then
  perform private.cuff_check_open_incident(p_patient, sqlstate, sqlerrm);
end $$;
revoke all on function private.evaluate_cuff_check_safe(uuid) from public, anon, authenticated;

-- 8. Home-log pair: made when a clinic reading is saved (guard open and configuration signed only) -------------------------------------------
create function private.cuff_check_pair_from_clinic(p_clinic uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  c public.clinic_bp_readings%rowtype;
  v_cfg jsonb;
  v_readings jsonb;
  v_mean jsonb;
  v_id uuid := gen_random_uuid();
  v_w interval;
begin
  select * into c from public.clinic_bp_readings where id = p_clinic;
  if not found then return null; end if;
  if not private.go_live_open_patient('cuff_check_flag', c.patient_id) then return null; end if;
  v_cfg := private.cuff_check_config();
  if v_cfg is null then return null; end if;
  v_w := make_interval(hours => (v_cfg -> 'pairing' ->> 'windowHours')::int);
  select coalesce(jsonb_agg(jsonb_build_object('s', v.systolic, 'd', v.diastolic, 'at', v.taken_at)), '[]'::jsonb) into v_readings
    from public.vitals_readings v
   where v.patient_id = c.patient_id and v.vital_type = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
     and v.source::text in ('manual', 'device') and v.taken_at between c.measured_at - v_w and c.measured_at + v_w;
  v_mean := private.cuff_home_mean(v_readings, c.measured_at, v_cfg);
  if v_mean is null then return null; end if;
  insert into public.cuff_check_pairs (id, organisation_id, patient_id, source, clinic_systolic, clinic_diastolic, own_systolic, own_diastolic, own_readings,
      d_systolic, d_diastolic, measured_at, clinic_reading_id, config_version, recorded_by, is_test)
  values (v_id, c.organisation_id, c.patient_id, 'home_log', c.systolic, c.diastolic, (v_mean ->> 'systolic')::int, (v_mean ->> 'diastolic')::int, (v_mean ->> 'count')::int,
      (v_mean ->> 'systolic')::int - c.systolic, (v_mean ->> 'diastolic')::int - c.diastolic, c.measured_at, c.id, private.cuff_check_config_version(), c.recorded_by, c.is_test);
  return v_id;
end $$;
revoke all on function private.cuff_check_pair_from_clinic(uuid) from public, anon, authenticated;

-- A trigger on the S07x clinic reading table (additive: record_clinic_bp_reading is not edited). A failure here must never roll back the clinician's reading and never be silent.
create function private.cuff_check_on_clinic_reading() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.cuff_check_pair_from_clinic(new.id);
  exception when others then
    perform private.cuff_check_open_incident(new.patient_id, sqlstate, sqlerrm);
  end;
  perform private.evaluate_cuff_check_safe(new.patient_id);
  return new;
end $$;
revoke all on function private.cuff_check_on_clinic_reading() from public, anon, authenticated;

create trigger clinic_bp_readings_cuff_pair after insert on public.clinic_bp_readings
  for each row execute function private.cuff_check_on_clinic_reading();

-- 9. The care team enters a same-visit pair ---------------------------------------------------------------------------------------------------
create function public.record_cuff_check_pair(p_patient uuid, p_clinic_systolic integer, p_clinic_diastolic integer, p_own_systolic integer, p_own_diastolic integer,
                                              p_measured_at timestamptz, p_device_label text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_label text := nullif(btrim(p_device_label), '');
  v_id uuid := gen_random_uuid();
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles me join public.clinical_staff cs on cs.profile_id = me.id and cs.active
                  where me.id = v_me and me.role = 'clinician' and me.is_active) then
    raise exception 'only an active clinician can record a cuff check pair' using errcode = '42501';
  end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  if not private.staff_may_write(p_patient, v_org, 'medical_history'::public.care_access_category) then
    raise exception 'not tied to this patient' using errcode = '42501';
  end if;
  if p_clinic_systolic is null or p_clinic_diastolic is null or p_own_systolic is null or p_own_diastolic is null
     or p_clinic_systolic not between 60 and 260 or p_own_systolic not between 60 and 260
     or p_clinic_diastolic not between 30 and 160 or p_own_diastolic not between 30 and 160
     or p_clinic_diastolic >= p_clinic_systolic or p_own_diastolic >= p_own_systolic then
    raise exception 'that reading is not plausible' using errcode = '22023';
  end if;
  if p_measured_at is null or p_measured_at > now() + interval '5 minutes' or p_measured_at < now() - interval '365 days' then
    raise exception 'that measurement time is not usable' using errcode = '22023';
  end if;
  if v_label is not null and length(v_label) > 80 then raise exception 'that device label is too long' using errcode = '22023'; end if;
  -- a double submit is the same pair: answer with the earlier one, never a second (the table is append-only, so a duplicate could not be removed)
  select id into v_id from public.cuff_check_pairs
   where patient_id = p_patient and source = 'same_visit' and measured_at = p_measured_at and clinic_systolic = p_clinic_systolic and clinic_diastolic = p_clinic_diastolic
     and own_systolic = p_own_systolic and own_diastolic = p_own_diastolic;
  if found then return v_id; end if;
  v_id := gen_random_uuid();
  insert into public.cuff_check_pairs (id, organisation_id, patient_id, source, clinic_systolic, clinic_diastolic, own_systolic, own_diastolic, own_readings,
      d_systolic, d_diastolic, measured_at, device_label, recorded_by, is_test)
  values (v_id, v_org, p_patient, 'same_visit', p_clinic_systolic, p_clinic_diastolic, p_own_systolic, p_own_diastolic, 1,
      p_own_systolic - p_clinic_systolic, p_own_diastolic - p_clinic_diastolic, p_measured_at, v_label, v_me, coalesce(v_test, false));
  perform private.log_audit('cuff_check_pair.recorded', 'cuff_check_pairs', v_id, '{}'::jsonb);
  perform private.evaluate_cuff_check_safe(p_patient);
  return v_id;
end $$;
revoke all on function public.record_cuff_check_pair(uuid, integer, integer, integer, integer, timestamptz, text) from public, anon;
grant execute on function public.record_cuff_check_pair(uuid, integer, integer, integer, integer, timestamptz, text) to authenticated;

-- 10. The only thing a patient can ever learn: whether the neutral line may be shown. Same answer for every patient; it reads no flag. ----------------
create function public.cuff_visit_prompt_open() returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and private.go_live_open_patient('cuff_visit_prompt', (select auth.uid()))
     and private.go_live_attested('cuff_visit_prompt', 'visit_prompt_wording_signed')
$$;
revoke all on function public.cuff_visit_prompt_open() from public, anon;
grant execute on function public.cuff_visit_prompt_open() to authenticated;

-- 11. Self-check -------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if (select is_active or approved_by is not null from public.cuff_check_rules where version = 1) then
    raise exception 'S07y self-check: the seed configuration must ship unsigned and inactive';
  end if;
  if (select count(*) from public.go_live_guards where key in ('cuff_check_flag', 'cuff_visit_prompt') and not is_on) <> 2 then
    raise exception 'S07y self-check: both guards must exist and be off';
  end if;
  select count(*) into v_n from public.task_types where code = 'cuff_check_review' and priority_class = 8 and creatable;
  if v_n <> 1 then raise exception 'S07y self-check: the task type is missing'; end if;
  if has_function_privilege('anon', 'public.record_cuff_check_pair(uuid,integer,integer,integer,integer,timestamptz,text)', 'EXECUTE') then raise exception 'S07y self-check: anon can record a pair'; end if;
  if has_function_privilege('anon', 'public.cuff_visit_prompt_open()', 'EXECUTE') then raise exception 'S07y self-check: anon can read the prompt'; end if;
  if has_function_privilege('anon', 'public.sign_cuff_check_rules(uuid)', 'EXECUTE') then raise exception 'S07y self-check: anon can sign'; end if;
  if has_function_privilege('authenticated', 'private.evaluate_cuff_check(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.cuff_check_pair_from_clinic(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.cuff_check_kind(jsonb,timestamptz,jsonb)', 'EXECUTE') then
    raise exception 'S07y self-check: a signed-in user can call the rule directly';
  end if;
  if has_table_privilege('authenticated', 'public.cuff_check_pairs', 'INSERT') or has_table_privilege('authenticated', 'public.cuff_check_flags', 'INSERT')
     or has_table_privilege('anon', 'public.cuff_check_pairs', 'SELECT') or has_table_privilege('anon', 'public.cuff_check_flags', 'SELECT') then
    raise exception 'S07y self-check: table privileges are wrong';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('cuff_check_pairs', 'cuff_check_flags') and policyname not like '%\_read') <> 0 then
    raise exception 'S07y self-check: only a staff read policy may exist on the pair and flag tables';
  end if;
end $$;
