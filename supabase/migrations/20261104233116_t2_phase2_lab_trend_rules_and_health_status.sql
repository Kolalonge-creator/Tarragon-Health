-- Tarragon Health 2.0, Phase 2 (founder brief section 5, discovery report section 6; decisions T2-06 and T2-07).
--
-- WHAT THIS DOES
--   1. public.lab_trend_rule_sets: the CMO-signed deterministic lab trend rules (registry key lab.trend_rules). Version 1 is born
--      UNSIGNED and INACTIVE (the seed is mirrored by packages/shared/src/proposed-config/lab-trend-rules-mirror.test.ts). Same shape as
--      bp_target_config: one active signed row, a signed row never changes, RLS on with no policy and no grant.
--   2. public.sign_lab_trend_rules(version): the active CMO only (42501 otherwise). Validates every value the engine reads, including that
--      the escalation pathway the rule set names resolves in the ACTIVE escalation_slas (the review window is read from there, never
--      hard-coded). public.lab_trend_rules_for_signoff(): the hub reader (CMO and admins).
--   3. private.lab_trend_evaluate(patient, config): pure deterministic evaluation over private.biomarker_points (which reads
--      private.lab_analyte_readings_current, never the base table, and leaves out sensitive positives and duplicate legacy copies):
--        trend      at least min_points results in the rule's unit inside window_months, each one moving the rule's way (when
--                   consecutive_rise_required), the change from the first to the latest meeting the rule's rise / rise percent / fall,
--                   and the latest at or above latest_at_least where the rule has one. A result can stay inside the normal range and
--                   still fire (brief 5.3: "a result can remain within range while showing a clinically meaningful change").
--        persistent the last min_points results of an analyte all outside the range printed with each result.
--      A code the patient has disputed is skipped. Results in another unit are not counted (never converted silently).
--   4. private.run_lab_trend_rules(): nightly (pg_cron 01:40 UTC, 02:40 Lagos). INERT until signed: with no active signed rule set it
--      writes one 'awaiting_signature' run row and raises nothing. When signed, one clinician_alerts row per patient per night lists every
--      trend found (type 'deterioration', category 'clinical', level from the signed rule set, sla_due_at from escalation_slas), each
--      finding recorded in public.lab_trend_detections with the rule set version and the points it read (the "interpreted" provenance).
--      Deduplicated: the same finding on the same latest result is never raised twice, and a finding whose earlier alert is still open,
--      acknowledged or snoozed is not raised again. The alert never names a diagnosis or suggests a medicine; nothing is shown to the
--      patient (detections have no policy; clinician_alerts is staff-only).
--   5. public.clinical_worklist and public.org_open_work_counts gain 'deteriorating_trends' (redefined from their live bodies, one branch
--      added). Uploads awaiting verification are already counted there ('lab_results' and 'uploaded_documents', CDE-8), so no second count.
--   6. public.patient_health_status(patient): the per-domain health status (T2-06) for the patient UI, web and mobile. Latest and previous
--      lab values with their unit, date, printed range and flag; blood pressure against the patient's own target; weight and waist; the
--      screening schedule. Every section is gated by the same access test its source table uses; a caregiver sees only what their
--      category grants allow, and sensitive screens only the patient sees. No composite score is computed anywhere.
--
-- GATES (G-01): no new guard. The rule set is on the patient-harm list (alert rules), so the CMO signature is the one gate.
-- LIVE FACTS: lab_results 0, lab_result_items 0 and lab_analyte_readings with a numeric value are test data only as of 2026-11-04, so
-- signing raises nothing for a real patient until real results arrive.

-- 1. the governed rule sets -----------------------------------------------------------------------------------------------------------
create table public.lab_trend_rule_sets (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null),
  check (jsonb_typeof(config -> 'rules') = 'array' and jsonb_typeof(config -> 'review') = 'object')
);
create unique index lab_trend_rule_sets_one_active on public.lab_trend_rule_sets (is_active) where is_active;
comment on table public.lab_trend_rule_sets is 'Platform-level governed configuration (no organisation_id, like escalation_slas and bp_target_config). T2 Phase 2: the deterministic lab trend rules. Born unsigned and inactive; signed by the Chief Medical Officer alone through public.sign_lab_trend_rules(). Until then private.run_lab_trend_rules() raises nothing.';

-- lab-trend-rules-begin
insert into public.lab_trend_rule_sets (version, is_active, config, notes)
values (1, false, $json${
 "window_months": 12,
 "min_points": 3,
 "consecutive_rise_required": true,
 "rules": [
  { "analyte": "hba1c", "unit": "%", "rise_from_first": 0.5, "latest_at_least": 5.7, "note": "ADA Standards of Care: a 0.5 point change is clinically meaningful" },
  { "analyte": "fasting_glucose", "unit": "mg/dL", "rise_from_first": 15, "latest_at_least": 100, "note": "steady rise towards the prediabetes range (ADA: 100 to 125)" },
  { "analyte": "creatinine", "unit": "mg/dL", "rise_pct_from_first": 25, "note": "KDIGO: a fall in eGFR of 25% or more is a significant change; creatinine is the panel's kidney marker" },
  { "analyte": "ldl_cholesterol", "unit": "mg/dL", "rise_from_first": 30, "note": "a rise of about 30 mg/dL moves most people up a risk band" },
  { "analyte": "haemoglobin", "unit": "g/dL", "fall_from_first": 2, "note": "a fall of 2 g/dL or more over a year needs a reason" },
  { "analyte": "potassium", "unit": "mmol/L", "rise_from_first": 0.7, "latest_at_least": 5.0, "note": "rising potassium in someone not yet out of range" }
 ],
 "persistent_out_of_range": {
  "min_points": 3,
  "analytes": ["hba1c", "fasting_glucose", "creatinine", "ldl_cholesterol", "haemoglobin", "potassium"]
 },
 "review": {
  "alert_level": "clinician_review",
  "sla_pathway": "screening_abnormal_result",
  "sla_tier": "urgent_escalation"
 }
}$json$::jsonb,
        'T2 Phase 2. PROPOSED, drafted by an agent 2026-11-04 from ADA and KDIGO guidance for the CMO. Unsigned and inactive: nothing is checked for anyone until the Chief Medical Officer signs it through public.sign_lab_trend_rules().');
-- lab-trend-rules-end

create trigger refuse_superseded_activation before update of is_active on public.lab_trend_rule_sets
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

alter table public.lab_trend_rule_sets enable row level security;
revoke all on public.lab_trend_rule_sets from public, anon, authenticated;

-- never live without a signature (the guard every governed table carries, migration 20261029213217)
create trigger zz_refuse_unsigned_activation_ins before insert on public.lab_trend_rule_sets for each row
  when (new.is_active and new.approved_by is null and new.approved_at is null)
  execute function private.refuse_unsigned_activation();
create trigger zz_refuse_unsigned_activation_upd before update of is_active, approved_at on public.lab_trend_rule_sets for each row
  when (new.is_active and new.approved_by is null and new.approved_at is null and (not old.is_active or old.approved_at is not null))
  execute function private.refuse_unsigned_activation();

create function private.lab_trend_rule_sets_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.approved_by is not null then raise exception 'a signed lab trend rule set cannot be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  if old.approved_by is not null
     and (new.config is distinct from old.config or new.approved_by is distinct from old.approved_by
          or new.approved_at is distinct from old.approved_at or new.version is distinct from old.version) then
    raise exception 'a signed lab trend rule set cannot be changed: make a new version' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.lab_trend_rule_sets_immutable() from public, anon, authenticated;
create trigger lab_trend_rule_sets_immutable before update or delete on public.lab_trend_rule_sets
  for each row execute function private.lab_trend_rule_sets_immutable();

-- what the engine found, and the run log -----------------------------------------------------------------------------------------------
create table public.lab_trend_detections (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id),
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  analyte           text not null,
  rule_kind         text not null check (rule_kind in ('trend', 'persistent_out_of_range')),
  latest_taken_at   timestamptz not null,
  rule_set_version  integer not null,
  summary           text not null,
  points            jsonb not null,
  alert_id          uuid references public.clinician_alerts (id) on delete set null,
  detected_at       timestamptz not null default now(),
  unique (patient_id, analyte, rule_kind, latest_taken_at)
);
create index lab_trend_detections_org_idx on public.lab_trend_detections (organisation_id, detected_at desc);
create index lab_trend_detections_alert_idx on public.lab_trend_detections (alert_id);
comment on table public.lab_trend_detections is 'T2 Phase 2: one row per lab trend the signed rules found, with the rule set version and the points read (the interpreted provenance). Never shown to the patient: RLS on, no policy, no grant; staff reach it through the clinician alert and the worklist.';
alter table public.lab_trend_detections enable row level security;
revoke all on public.lab_trend_detections from public, anon, authenticated;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('lab_trend_detections', 'patient_id', 'clinical_record', 'review', true, false,
        'T2 Phase 2: each lab trend the CMO-signed rules found, with the rule set version and the points read. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

create table public.lab_trend_rule_runs (
  id               uuid primary key default gen_random_uuid(),
  ran_at           timestamptz not null default now(),
  rule_set_version integer,
  outcome          text not null check (outcome in ('awaiting_signature', 'ok', 'failed')),
  patients_checked integer not null default 0,
  findings         integer not null default 0,
  alerts_raised    integer not null default 0,
  error            text
);
create index lab_trend_rule_runs_ran_at_idx on public.lab_trend_rule_runs (ran_at desc);
comment on table public.lab_trend_rule_runs is 'T2 Phase 2: one row per run of private.run_lab_trend_rules(). awaiting_signature means the rules are unsigned and nothing was checked; failed carries the error (for example no active escalation SLA for the named pathway).';
alter table public.lab_trend_rule_runs enable row level security;
revoke all on public.lab_trend_rule_runs from public, anon, authenticated;

create function private.lab_trend_rules_active() returns jsonb
language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('version', version, 'config', config) from public.lab_trend_rule_sets where is_active and approved_by is not null $$;
revoke all on function private.lab_trend_rules_active() from public, anon, authenticated;

-- 2. sign and read for the hub -------------------------------------------------------------------------------------------------------
create function private.lab_trend_rules_config_problem(c jsonb) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare r jsonb; v_kinds integer; a jsonb;
begin
  if (c ->> 'window_months') !~ '^[0-9]{1,2}$' or (c ->> 'window_months')::integer not between 1 and 36 then return 'window_months must be 1 to 36'; end if;
  if (c ->> 'min_points') !~ '^[0-9]{1,2}$' or (c ->> 'min_points')::integer not between 2 and 12 then return 'min_points must be 2 to 12'; end if;
  if jsonb_typeof(c -> 'consecutive_rise_required') <> 'boolean' then return 'consecutive_rise_required must be true or false'; end if;
  if jsonb_typeof(c -> 'rules') <> 'array' or jsonb_array_length(c -> 'rules') = 0 then return 'there must be at least one rule'; end if;
  for r in select * from jsonb_array_elements(c -> 'rules') loop
    if coalesce(r ->> 'analyte', '') !~ '^[a-z0-9_]+$' then return 'a rule has no valid analyte code'; end if;
    if coalesce(btrim(r ->> 'unit'), '') = '' then return format('rule %s has no unit', r ->> 'analyte'); end if;
    v_kinds := (case when r ? 'rise_from_first' then 1 else 0 end) + (case when r ? 'rise_pct_from_first' then 1 else 0 end)
             + (case when r ? 'fall_from_first' then 1 else 0 end);
    if v_kinds <> 1 then return format('rule %s must have exactly one of rise_from_first, rise_pct_from_first, fall_from_first', r ->> 'analyte'); end if;
    if jsonb_typeof(coalesce(r -> 'rise_from_first', r -> 'rise_pct_from_first', r -> 'fall_from_first')) <> 'number'
       or coalesce(r -> 'rise_from_first', r -> 'rise_pct_from_first', r -> 'fall_from_first')::text::numeric <= 0 then
      return format('rule %s needs a positive change', r ->> 'analyte');
    end if;
    if r ? 'latest_at_least' and jsonb_typeof(r -> 'latest_at_least') <> 'number' then return format('rule %s has a non-numeric latest_at_least', r ->> 'analyte'); end if;
  end loop;
  if c ? 'persistent_out_of_range' then
    if (c #>> '{persistent_out_of_range,min_points}') !~ '^[0-9]{1,2}$' or (c #>> '{persistent_out_of_range,min_points}')::integer not between 2 and 12 then
      return 'persistent_out_of_range.min_points must be 2 to 12';
    end if;
    if jsonb_typeof(c #> '{persistent_out_of_range,analytes}') <> 'array' then return 'persistent_out_of_range.analytes must be a list'; end if;
    for a in select * from jsonb_array_elements(c #> '{persistent_out_of_range,analytes}') loop
      if jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ '^[a-z0-9_]+$' then return 'persistent_out_of_range has an invalid analyte code'; end if;
    end loop;
  end if;
  if coalesce(c #>> '{review,alert_level}', '') not in ('routine', 'clinician_review', 'specialist_review', 'urgent_escalation') then
    return 'review.alert_level must be routine, clinician_review, specialist_review or urgent_escalation';
  end if;
  if coalesce(c #>> '{review,sla_tier}', '') not in ('routine', 'clinician_review', 'specialist_review', 'urgent_escalation', 'emergency') then
    return 'review.sla_tier is not an alert level';
  end if;
  begin
    perform private.escalation_sla_minutes(c #>> '{review,sla_pathway}', (c #>> '{review,sla_tier}')::public.alert_level);
  exception when others then
    return format('the active escalation SLAs have no window for pathway %s, tier %s', c #>> '{review,sla_pathway}', c #>> '{review,sla_tier}');
  end;
  return null;
end $$;
revoke all on function private.lab_trend_rules_config_problem(jsonb) from public, anon, authenticated;

create function public.sign_lab_trend_rules(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.lab_trend_rule_sets%rowtype; v_staff uuid; v_problem text;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then
    raise exception 'only the chief medical officer can sign the lab trend rules' using errcode = '42501';
  end if;
  select * into c from public.lab_trend_rule_sets where version = p_version for update;
  if not found then raise exception 'no such lab trend rule set version' using errcode = 'P0002'; end if;
  if c.approved_by is not null then raise exception 'that version is already signed; a change is a new version' using errcode = '23514'; end if;
  v_problem := private.lab_trend_rules_config_problem(c.config);
  if v_problem is not null then raise exception 'this version cannot be signed: %', v_problem using errcode = '22023'; end if;

  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active'
   order by cs.created_at limit 1;
  if v_staff is null then raise exception 'no active clinical staff record for the signer' using errcode = '42501'; end if;

  update public.lab_trend_rule_sets set is_active = false where is_active and version <> p_version;
  update public.lab_trend_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'lab_trend_rule_sets.signed',
            'lab_trend_rule_sets', c.id, jsonb_build_object('version', p_version, 'rules', jsonb_array_length(c.config -> 'rules')));
end $$;
revoke all on function public.sign_lab_trend_rules(integer) from public, anon, authenticated;
grant execute on function public.sign_lab_trend_rules(integer) to authenticated;

create function public.lab_trend_rules_for_signoff() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_live record; v_pending record; v_run record;
begin
  perform private.uid_or_deny();
  if not (private.credential_is_cmo() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select version, config, approved_at into v_live from public.lab_trend_rule_sets
   where is_active and approved_by is not null order by version desc limit 1;
  select version, config into v_pending from public.lab_trend_rule_sets
   where not is_active and approved_by is null and version > coalesce(v_live.version, 0)
   order by version desc limit 1;
  select ran_at, outcome, rule_set_version, patients_checked, findings, alerts_raised, error into v_run
    from public.lab_trend_rule_runs order by ran_at desc limit 1;
  return jsonb_build_object(
    'live', case when v_live.version is not null then jsonb_build_object('version', v_live.version, 'config', v_live.config, 'approved_at', v_live.approved_at) end,
    'pending', case when v_pending.version is not null then jsonb_build_object('version', v_pending.version, 'config', v_pending.config,
                    'problem', private.lab_trend_rules_config_problem(v_pending.config),
                    'sla_minutes', (select (e ->> 'sla_minutes')::integer from public.escalation_slas s, jsonb_array_elements(s.config) e
                                     where s.is_active and e ->> 'pathway' = v_pending.config #>> '{review,sla_pathway}'
                                       and e ->> 'tier' = v_pending.config #>> '{review,sla_tier}' limit 1)) end,
    'last_run', case when v_run.ran_at is not null then jsonb_build_object('ran_at', v_run.ran_at, 'outcome', v_run.outcome, 'version', v_run.rule_set_version,
                    'patients_checked', v_run.patients_checked, 'findings', v_run.findings, 'alerts_raised', v_run.alerts_raised, 'error', v_run.error) end);
end $$;
revoke all on function public.lab_trend_rules_for_signoff() from public, anon, authenticated;
grant execute on function public.lab_trend_rules_for_signoff() to authenticated;

-- 3. the deterministic evaluation ------------------------------------------------------------------------------------------------------
create function private.lab_trend_evaluate(p_patient uuid, p_config jsonb)
returns table (analyte text, rule_kind text, latest_taken_at timestamptz, summary text, points jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r jsonb; v_code text; v_vals numeric[]; v_ats timestamptz[]; v_units text[]; v_lo numeric[]; v_hi numeric[];
  n integer; i integer; v_dir integer; v_ok boolean; v_first numeric; v_last numeric; v_change numeric; v_need numeric; v_kind text;
  v_since timestamptz := now() - make_interval(months => (p_config ->> 'window_months')::integer);
  v_min integer := (p_config ->> 'min_points')::integer;
  v_consecutive boolean := coalesce((p_config ->> 'consecutive_rise_required')::boolean, true);
  v_pmin integer;
begin
  -- trends
  for r in select * from jsonb_array_elements(p_config -> 'rules') loop
    v_code := lower(r ->> 'analyte');
    if private.lab_code_disputed(p_patient, v_code) then continue; end if;
    select array_agg(b.value order by b.taken_at), array_agg(b.taken_at order by b.taken_at)
      into v_vals, v_ats
      from private.biomarker_points(p_patient, v_code) b
     where lower(btrim(b.unit)) = lower(btrim(r ->> 'unit')) and b.taken_at >= v_since and b.taken_at <= now();
    n := coalesce(cardinality(v_vals), 0);
    if n < v_min then continue; end if;
    v_dir := case when r ? 'fall_from_first' then -1 else 1 end;
    v_ok := true;
    if v_consecutive then
      for i in 2 .. n loop
        if (v_vals[i] - v_vals[i - 1]) * v_dir <= 0 then v_ok := false; exit; end if;
      end loop;
    end if;
    if not v_ok then continue; end if;
    v_first := v_vals[1]; v_last := v_vals[n];
    if r ? 'rise_pct_from_first' then
      if v_first <= 0 then continue; end if;
      v_change := (v_last - v_first) / v_first * 100; v_need := (r ->> 'rise_pct_from_first')::numeric; v_kind := 'rose by';
    elsif r ? 'fall_from_first' then
      v_change := v_first - v_last; v_need := (r ->> 'fall_from_first')::numeric; v_kind := 'fell by';
    else
      v_change := v_last - v_first; v_need := (r ->> 'rise_from_first')::numeric; v_kind := 'rose by';
    end if;
    if v_change < v_need then continue; end if;
    if r ? 'latest_at_least' and v_last < (r ->> 'latest_at_least')::numeric then continue; end if;
    analyte := v_code; rule_kind := 'trend'; latest_taken_at := v_ats[n];
    summary := format('%s %s %s%s across %s results, from %s on %s to %s on %s (%s).', v_code, v_kind, trim_scale(round(v_change, 2)),
                      case when r ? 'rise_pct_from_first' then '%' else ' ' || (r ->> 'unit') end, n,
                      trim_scale(v_first), to_char(v_ats[1] at time zone 'Africa/Lagos', 'YYYY-MM-DD'),
                      trim_scale(v_last), to_char(v_ats[n] at time zone 'Africa/Lagos', 'YYYY-MM-DD'), r ->> 'unit');
    points := (select jsonb_agg(jsonb_build_object('value', v_vals[k], 'taken_at', v_ats[k]) order by k) from generate_subscripts(v_vals, 1) k);
    return next;
  end loop;

  -- persistent abnormality: the last results all outside the range printed with each one
  if p_config ? 'persistent_out_of_range' then
    v_pmin := (p_config #>> '{persistent_out_of_range,min_points}')::integer;
    for v_code in select lower(a #>> '{}') from jsonb_array_elements(p_config #> '{persistent_out_of_range,analytes}') a loop
      if private.lab_code_disputed(p_patient, v_code) then continue; end if;
      select array_agg(x.value order by x.taken_at), array_agg(x.taken_at order by x.taken_at), array_agg(x.unit order by x.taken_at),
             array_agg(x.ref_low order by x.taken_at), array_agg(x.ref_high order by x.taken_at)
        into v_vals, v_ats, v_units, v_lo, v_hi
        from (select b.* from private.biomarker_points(p_patient, v_code) b
               where b.taken_at >= v_since and b.taken_at <= now()
               order by b.taken_at desc limit v_pmin) x;
      n := coalesce(cardinality(v_vals), 0);
      if n < v_pmin then continue; end if;
      v_ok := true;
      for i in 1 .. n loop
        if not ((v_lo[i] is not null and v_vals[i] < v_lo[i]) or (v_hi[i] is not null and v_vals[i] > v_hi[i])) then v_ok := false; exit; end if;
      end loop;
      if not v_ok then continue; end if;
      analyte := v_code; rule_kind := 'persistent_out_of_range'; latest_taken_at := v_ats[n];
      summary := format('%s was outside the range printed with each of the last %s results, the latest %s %s on %s.', v_code, n,
                        trim_scale(v_vals[n]), v_units[n], to_char(v_ats[n] at time zone 'Africa/Lagos', 'YYYY-MM-DD'));
      points := (select jsonb_agg(jsonb_build_object('value', v_vals[k], 'unit', v_units[k], 'ref_low', v_lo[k], 'ref_high', v_hi[k], 'taken_at', v_ats[k]) order by k)
                   from generate_subscripts(v_vals, 1) k);
      return next;
    end loop;
  end if;
end $$;
revoke all on function private.lab_trend_evaluate(uuid, jsonb) from public, anon, authenticated;

-- 4. the nightly run ---------------------------------------------------------------------------------------------------------------------
create function private.run_lab_trend_rules() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_active jsonb; v_config jsonb; v_version integer; v_minutes integer; v_level public.alert_level;
  v_codes text[]; p record; h record; v_alert uuid; v_lines text; v_new integer;
  v_patients integer := 0; v_findings integer := 0; v_alerts integer := 0;
begin
  v_active := private.lab_trend_rules_active();
  if v_active is null then
    insert into public.lab_trend_rule_runs (outcome) values ('awaiting_signature');
    return jsonb_build_object('outcome', 'awaiting_signature');
  end if;
  v_config := v_active -> 'config';
  v_version := (v_active ->> 'version')::integer;
  begin
    v_minutes := private.escalation_sla_minutes(v_config #>> '{review,sla_pathway}', (v_config #>> '{review,sla_tier}')::public.alert_level);
  exception when others then
    insert into public.lab_trend_rule_runs (rule_set_version, outcome, error) values (v_version, 'failed', sqlerrm);
    return jsonb_build_object('outcome', 'failed', 'error', sqlerrm);
  end;
  v_level := (v_config #>> '{review,alert_level}')::public.alert_level;
  v_codes := array(select lower(r ->> 'analyte') from jsonb_array_elements(v_config -> 'rules') r
                   union select lower(a #>> '{}') from jsonb_array_elements(coalesce(v_config #> '{persistent_out_of_range,analytes}', '[]'::jsonb)) a);

  for p in
    select pr.id, pr.organisation_id from public.profiles pr
     where pr.role = 'patient' and pr.organisation_id is not null
       and (exists (select 1 from public.lab_result_items i where i.patient_id = pr.id and lower(i.analyte_code) = any (v_codes) and i.value_numeric is not null)
            or exists (select 1 from private.lab_analyte_readings_current l where l.patient_id = pr.id and lower(l.code) = any (v_codes) and l.value is not null))
  loop
    v_patients := v_patients + 1;
    v_lines := null; v_new := 0;
    create temp table if not exists lab_trend_hits (analyte text, rule_kind text, latest_taken_at timestamptz, summary text, points jsonb) on commit drop;
    truncate lab_trend_hits;
    insert into lab_trend_hits
      select e.* from private.lab_trend_evaluate(p.id, v_config) e
       where not exists (select 1 from public.lab_trend_detections d
                          where d.patient_id = p.id and d.analyte = e.analyte and d.rule_kind = e.rule_kind
                            and (d.latest_taken_at = e.latest_taken_at
                                 or exists (select 1 from public.clinician_alerts a where a.id = d.alert_id and a.status in ('open', 'acknowledged', 'snoozed'))));
    select count(*), string_agg('- ' || summary, E'\n' order by analyte, rule_kind) into v_new, v_lines from lab_trend_hits;
    if v_new = 0 then continue; end if;

    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at, category, type_code)
    values (p.organisation_id, p.id, v_level, 'open', 'Lab trend to review',
            v_lines || E'\n' || format('Found by the signed lab trend rules, version %s. For a doctor to review: this is not a diagnosis and suggests no change to any medicine.', v_version),
            now() + make_interval(mins => v_minutes), 'clinical', 'deterioration')
    returning id into v_alert;
    insert into public.lab_trend_detections (organisation_id, patient_id, analyte, rule_kind, latest_taken_at, rule_set_version, summary, points, alert_id)
      select p.organisation_id, p.id, h2.analyte, h2.rule_kind, h2.latest_taken_at, v_version, h2.summary, h2.points, v_alert from lab_trend_hits h2;
    v_findings := v_findings + v_new;
    v_alerts := v_alerts + 1;
  end loop;

  insert into public.lab_trend_rule_runs (rule_set_version, outcome, patients_checked, findings, alerts_raised)
    values (v_version, 'ok', v_patients, v_findings, v_alerts);
  return jsonb_build_object('outcome', 'ok', 'version', v_version, 'patients_checked', v_patients, 'findings', v_findings, 'alerts_raised', v_alerts);
end $$;
revoke all on function private.run_lab_trend_rules() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lab-trend-rules-nightly') then
    perform cron.unschedule('lab-trend-rules-nightly');
  end if;
  perform cron.schedule('lab-trend-rules-nightly', '40 1 * * *', $c$ select private.run_lab_trend_rules(); $c$);
end $$;

-- 5. the clinical worklist and the organisation totals gain 'deteriorating_trends' ----------------------------------------------------------
do $$
declare
  v_list text := pg_get_functiondef('public.clinical_worklist()'::regprocedure);
  v_counts text := pg_get_functiondef('public.org_open_work_counts()'::regprocedure);
  v_anchor constant text := '), ranked as (';
  v_branch constant text := $b$    union all
    select 'deteriorating_trends', a.id, a.patient_id, 'Lab trend to review', a.created_at
      from public.clinician_alerts a where a.organisation_id = v_org and a.status in ('open', 'acknowledged', 'snoozed')
       and exists (select 1 from public.lab_trend_detections d where d.alert_id = a.id)
  ), ranked as ($b$;
  v_counts_anchor constant text := 'union all select ''async_consults''';
  v_counts_branch constant text := $b$union all select 'deteriorating_trends', count(*) from public.clinician_alerts a where a.organisation_id = v_org and a.status in ('open', 'acknowledged', 'snoozed') and exists (select 1 from public.lab_trend_detections d where d.alert_id = a.id)
    union all select 'async_consults'$b$;
begin
  if position('deteriorating_trends' in v_list) = 0 then
    if position(v_anchor in v_list) = 0 then raise exception 'clinical_worklist no longer has the shape this migration patches; re-read it'; end if;
    execute replace(v_list, v_anchor, v_branch);
  end if;
  if position('deteriorating_trends' in v_counts) = 0 then
    if position(v_counts_anchor in v_counts) = 0 then raise exception 'org_open_work_counts no longer has the shape this migration patches; re-read it'; end if;
    execute replace(v_counts, v_counts_anchor, v_counts_branch);
  end if;
end $$;

-- 6. health status by domain, for the patient UI ----------------------------------------------------------------------------------------
create function public.patient_health_status(p_patient uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
  v_self boolean; v_labs_ok boolean; v_vitals_ok boolean; v_screen_ok boolean;
  v_labs jsonb; v_vitals jsonb; v_screening jsonb; t record;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  v_self := v_patient = v_uid;
  v_labs_ok := private.may_read_biomarkers(v_patient);
  v_vitals_ok := v_self or private.can_read_clinical(v_patient, 'vitals_readings'::public.care_access_category);
  v_screen_ok := v_self or private.can_read_clinical(v_patient, 'labs_results'::public.care_access_category);
  if not (v_labs_ok or v_vitals_ok or v_screen_ok) then raise exception 'not authorised' using errcode = '42501'; end if;

  if v_labs_ok then
    select coalesce(jsonb_agg(x.j order by x.code), '[]'::jsonb) into v_labs
      from (
        select codes.code, jsonb_build_object(
                 'code', codes.code,
                 'readings', count(*),
                 'disputed', private.lab_code_disputed(v_patient, codes.code),
                 'latest_value', (array_agg(p.value order by p.taken_at desc))[1],
                 'latest_unit', (array_agg(p.unit order by p.taken_at desc))[1],
                 'latest_at', max(p.taken_at),
                 'ref_low', (array_agg(p.ref_low order by p.taken_at desc))[1],
                 'ref_high', (array_agg(p.ref_high order by p.taken_at desc))[1],
                 'ref_text', (array_agg(p.ref_text order by p.taken_at desc))[1],
                 'flag', (array_agg(p.flag order by p.taken_at desc))[1],
                 'source', (array_agg(p.source order by p.taken_at desc))[1],
                 'laboratory', (array_agg(p.laboratory order by p.taken_at desc))[1],
                 'previous_value', (array_agg(p.value order by p.taken_at desc))[2],
                 'previous_unit', (array_agg(p.unit order by p.taken_at desc))[2],
                 'previous_at', (array_agg(p.taken_at order by p.taken_at desc))[2]) j
          from (select lower(i.analyte_code) code from public.lab_result_items i where i.patient_id = v_patient
                union select lower(l.code) from private.lab_analyte_readings_current l where l.patient_id = v_patient
                union select lower(pr.code) from public.patient_reported_lab_values pr where pr.patient_id = v_patient and v_self) codes
          cross join lateral private.biomarker_points_with_reported(v_patient, codes.code, v_self) p
         group by codes.code) x;
  end if;

  if v_vitals_ok then
    select * into t from private.patient_bp_target(v_patient);
    v_vitals := jsonb_build_object(
      'blood_pressure', (select jsonb_agg(jsonb_build_object('systolic', v.systolic, 'diastolic', v.diastolic, 'taken_at', v.taken_at) order by v.taken_at desc)
                           from (select * from private.vitals_readings_current v where v.patient_id = v_patient and v.vital_type = 'blood_pressure'
                                   and v.correction_status is null and v.source <> 'wearable' and v.systolic is not null and v.diastolic is not null
                                 order by v.taken_at desc limit 2) v),
      'bp_target', jsonb_build_object('systolic', t.sys, 'diastolic', t.dia, 'source', t.source),
      'weight', (select jsonb_agg(jsonb_build_object('kg', v.weight_kg, 'taken_at', v.taken_at) order by v.taken_at desc)
                   from (select * from private.vitals_readings_current v where v.patient_id = v_patient and v.vital_type = 'weight'
                           and v.correction_status is null and v.weight_kg is not null order by v.taken_at desc limit 2) v),
      'waist', (select jsonb_agg(jsonb_build_object('cm', v.waist_cm, 'taken_at', v.taken_at) order by v.taken_at desc)
                  from (select * from private.vitals_readings_current v where v.patient_id = v_patient and v.vital_type = 'waist_circumference'
                          and v.correction_status is null and v.waist_cm is not null order by v.taken_at desc limit 2) v),
      'height_cm', (select pr.height_cm from public.profiles pr where pr.id = v_patient));
  end if;

  if v_screen_ok then
    v_screening := jsonb_build_object(
      'open', coalesce((select jsonb_agg(jsonb_build_object('name', st.name, 'status', s.status, 'due_date', s.due_date) order by s.due_date nulls last)
                          from public.screening_schedules s join public.screen_types st on st.id = s.screen_type_id
                         where s.patient_id = v_patient and s.status in ('pending', 'overdue', 'booked') and (v_self or not st.sensitive)), '[]'::jsonb),
      'completed_last_year', (select count(*) from public.screening_schedules s join public.screen_types st on st.id = s.screen_type_id
                               where s.patient_id = v_patient and s.status = 'completed' and s.updated_at > now() - interval '12 months' and (v_self or not st.sensitive)));
  end if;

  return jsonb_build_object('labs', v_labs, 'vitals', v_vitals, 'screening', v_screening);
end $$;
revoke all on function public.patient_health_status(uuid) from public, anon, authenticated;
grant execute on function public.patient_health_status(uuid) to authenticated;

-- 7. self-checks -----------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.lab_trend_rule_sets where is_active or approved_by is not null) then
    raise exception 'this migration must not sign or activate anything';
  end if;
  if has_table_privilege('authenticated', 'public.lab_trend_detections', 'SELECT') or has_table_privilege('anon', 'public.lab_trend_rule_sets', 'SELECT') then
    raise exception 'the trend tables must not be readable by a user role';
  end if;
  if has_function_privilege('anon', 'public.sign_lab_trend_rules(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.lab_trend_rules_for_signoff()', 'EXECUTE')
     or has_function_privilege('anon', 'public.patient_health_status(uuid)', 'EXECUTE') then
    raise exception 'anon can execute a trend or health-status function';
  end if;
  if has_function_privilege('authenticated', 'private.run_lab_trend_rules()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.lab_trend_evaluate(uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.lab_trend_rules_active()', 'EXECUTE') then
    raise exception 'authenticated can execute a private trend function';
  end if;
  if position('deteriorating_trends' in pg_get_functiondef('public.clinical_worklist()'::regprocedure)) = 0
     or position('deteriorating_trends' in pg_get_functiondef('public.org_open_work_counts()'::regprocedure)) = 0 then
    raise exception 'the worklist was not patched';
  end if;
  if not exists (select 1 from cron.job where jobname = 'lab-trend-rules-nightly') then raise exception 'the nightly job is not scheduled'; end if;
end $$;
