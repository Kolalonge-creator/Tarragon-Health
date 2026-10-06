-- S38c: the personal monthly progress report (Module 22.5) and risk stratification for clinician worklists (Module 22.3).
-- Builds on S38 (outcome_config, outcome_snapshots, private.outcome_anchor, private.outcome_rule) and S08 (private.weekly_adherence).
--
-- Counted first (live, 2026-10-06): 0 snapshots, 0 triage events, 7 BP readings; nothing to convert, nothing to backfill.
--
-- RISK (22.3). Deterministic points over signals the platform already holds; no model, no language model, nothing trained.
-- Two families, kept apart: deterioration (is this person getting worse) and dropout (are they slipping away). The score only
-- ORDERS outreach for a clinician who is already tied to the patient (INV-12); it never gates, denies, prices or hides care, and
-- a low score never means no contact. It reads only clinical and logging signals: never spend, orders, visits or payments (the
-- cost-as-proxy trap in Obermeyer 2019); the proof scans the function bodies for that. Every score stores its reasons. A clinician
-- may override the tier with a written reason and an expiry; the original score is never changed. Scores are append-only history,
-- one per patient per day, never shown to the patient. A fairness report shows tier mix by sex, age band and state, small groups withheld.
--
-- Only CURRENT members are scored (an ended Membership stops the score), so someone who left is never chased as "slipping away".
--
-- MONTHLY REPORT (22.5). One stored, write-once report per patient and calendar month (Lagos): readings, the person's own target
-- and where it came from, weekly averages, a direction word against last month, adherence beside it (a separate family), days logged.
-- "Not enough readings" replaces any average or trend when there are fewer than the minimum. No comparison with anyone else, no
-- ranking, no care-team activity counts (that would disclose task existence; OQ-251). Sharing with the Care Circle is S38d (OQ-252).
--
-- All thresholds are PROPOSED, owned by the CMO, versioned in risk_config and monthly_report_config (INV-16), mirrored in the
-- code registry as risk.stratification and reports.monthly.

-- 1. Configuration ---------------------------------------------------------------------------------------------------------
create table public.risk_config (
  version    integer primary key check (version >= 1),
  is_active  boolean not null default false,
  owner      text not null default 'CMO',
  config     jsonb not null check (jsonb_typeof(config) = 'object'),
  note       text,
  created_at timestamptz not null default now()
);
create unique index risk_config_one_active on public.risk_config ((true)) where is_active;
alter table public.risk_config enable row level security;
revoke all on public.risk_config from public, anon, authenticated;

-- risk-rules-begin
insert into public.risk_config (version, is_active, config, note) values (1, true, $json$
{
  "joined_min_days": 7,
  "bp_window_days": 7,
  "min_readings": 3,
  "above_target": { "systolic": 10, "diastolic": 5 },
  "well_above_target": { "systolic": 20, "diastolic": 10 },
  "rising_systolic": 10,
  "silence_days": { "medium": 5, "high": 10 },
  "adherence_low_pct": 60,
  "triage_lookback_days": 30,
  "points": {
    "deterioration": { "above_target": 25, "well_above_target": 45, "rising": 15, "red_event": 40, "amber_event": 15, "last_snapshot_uncontrolled": 15, "low_adherence": 10 },
    "dropout": { "silent_medium": 25, "silent_high": 50, "fewer_readings": 20, "low_adherence": 20, "no_readings_ever": 40 }
  },
  "tiers": { "medium_min": 30, "high_min": 60 },
  "override_max_days": 30
}
$json$::jsonb, 'PROPOSED, v1. Owner: CMO. Points are an ordering aid for outreach, not a clinical grade, and never a reason to deny care.');
-- risk-rules-end

create function private.risk_rule(p_path text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config #> p_path from public.risk_config where is_active $$;
revoke all on function private.risk_rule(text[]) from public, anon, authenticated;

create table public.monthly_report_config (
  version    integer primary key check (version >= 1),
  is_active  boolean not null default false,
  owner      text not null default 'CMO',
  config     jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now()
);
create unique index monthly_report_config_one_active on public.monthly_report_config ((true)) where is_active;
alter table public.monthly_report_config enable row level security;
revoke all on public.monthly_report_config from public, anon, authenticated;

-- monthly-report-rules-begin
insert into public.monthly_report_config (version, is_active, config) values (1, true, $json$
{
  "min_readings": 3,
  "grace_days": 2,
  "direction_threshold_systolic": 5,
  "default_target": { "systolic": 140, "diastolic": 90 }
}
$json$::jsonb);
-- monthly-report-rules-end

create function private.report_rule(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config -> p_key from public.monthly_report_config where is_active $$;
revoke all on function private.report_rule(text) from public, anon, authenticated;

-- 2. Shared helpers (the same reading rules as the outcome snapshots, so the two never disagree) ---------------------------------
create function private.patient_bp_target(p_patient uuid, out sys integer, out dia integer, out source text)
language plpgsql stable security definer set search_path = ''
as $$
declare v record;
begin
  select home_systolic, home_diastolic into v from public.patient_bp_targets
   where patient_id = p_patient and home_systolic is not null and home_diastolic is not null order by updated_at desc limit 1;
  if v.home_systolic is not null then
    sys := v.home_systolic; dia := v.home_diastolic; source := 'patient';
  else
    sys := (private.outcome_rule('default_target') ->> 'systolic')::integer;
    dia := (private.outcome_rule('default_target') ->> 'diastolic')::integer;
    source := 'default';
  end if;
end $$;
revoke all on function private.patient_bp_target(uuid) from public, anon, authenticated;

-- Readings the platform has cleared, plus readings flagged only for a missing arm or position (OQ-232). Lagos calendar dates.
create function private.bp_window_stats(p_patient uuid, p_from date, p_to date, out n integer, out days integer, out avg_sys numeric, out avg_dia numeric)
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer, count(distinct (taken_at at time zone 'Africa/Lagos')::date)::integer,
         round(avg(systolic)::numeric, 1), round(avg(diastolic)::numeric, 1)
    from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
     and (validation_status = 'valid' or coalesce(validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
     and (taken_at at time zone 'Africa/Lagos')::date between p_from and p_to
$$;
revoke all on function private.bp_window_stats(uuid, date, date) from public, anon, authenticated;

-- A person who is a member NOW (an active Membership or an active care pack / membership entitlement). Anchor alone is not enough:
-- private.outcome_anchor is the earliest start ever, so a lapsed member would otherwise be scored for "dropout" forever.
create function private.risk_is_current_member(p_patient uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m
                  where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= p_at and (m.ends_at is null or m.ends_at > p_at))
      or exists (select 1 from public.entitlements e
                  where e.patient_id = p_patient and e.kind in ('membership', 'care_pack') and e.state = 'active'
                    and e.starts_at <= p_at and (e.ends_at is null or e.ends_at > p_at))
$$;
revoke all on function private.risk_is_current_member(uuid, timestamptz) from public, anon, authenticated;

-- One open incident per failing job, kept up to date; a failure is never only a log line.
create function private.open_job_incident(p_ref text, p_title text, p_summary text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = p_summary where external_reference = p_ref and status not in ('resolved', 'closed');
  else
    select id into v_org from public.organisations order by created_at limit 1;
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (v_org, 'operational', 'sev3', p_title, p_summary, p_ref, now() + interval '1 day', now() + interval '3 days');
  end if;
end $$;
revoke all on function private.open_job_incident(text, text, text) from public, anon, authenticated;

-- 3. Risk scores -----------------------------------------------------------------------------------------------------------
create table public.risk_scores (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  model_version       integer not null references public.risk_config (version),
  computed_on         date not null,
  deterioration_risk  smallint not null check (deterioration_risk between 0 and 100),
  dropout_risk        smallint not null check (dropout_risk between 0 and 100),
  level               text not null check (level in ('low', 'medium', 'high')),
  reasons             jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  inputs              jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  computed_at         timestamptz not null default now(),
  is_test             boolean not null default false,
  unique (patient_id, computed_on)
);
create index risk_scores_latest_idx on public.risk_scores (patient_id, computed_on desc);
alter table public.risk_scores enable row level security;
revoke all on public.risk_scores from public, anon, authenticated;
comment on table public.risk_scores is
  'S38c. Deterministic, explainable, append-only. Orders outreach for a tied clinician; never shown to the patient, never gates or prices anything. No policy: reads go through clinician_risk_worklist and risk_distribution_report.';

create function private.risk_scores_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'risk_scores_append_only' using errcode = 'P0001'; end $$;
create trigger risk_scores_append_only before update on public.risk_scores
  for each row execute function private.risk_scores_append_only();
revoke all on function private.risk_scores_append_only() from public, anon, authenticated;

create table public.risk_overrides (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id     uuid not null references public.profiles (id) on delete cascade,
  set_by         uuid not null references public.profiles (id) on delete restrict,
  level          text not null check (level in ('low', 'medium', 'high')),
  reason         text not null check (char_length(btrim(reason)) >= 10),
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  check (expires_at > created_at)
);
create index risk_overrides_patient_idx on public.risk_overrides (patient_id, created_at desc);
alter table public.risk_overrides enable row level security;
revoke all on public.risk_overrides from public, anon, authenticated;

-- The score for one patient as of a date. Returns the points, the level and the reasons (keys only, no free text).
create function private.risk_compute(p_patient uuid, p_on date, out det integer, out drop_ integer, out lvl text, out reasons jsonb, out inputs jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare
  c jsonb := (select config from public.risk_config where is_active);
  v_win integer := (c ->> 'bp_window_days')::integer;
  v_minr integer := (c ->> 'min_readings')::integer;
  t record; cur record; prev record; v_last date; v_silent integer;
  v_red integer; v_amber integer; v_adh integer; v_adh_unavail boolean := false; v_snap text; v_cnt14 integer; v_cnt14p integer; v_anchor date;
  v_det integer := 0; v_drop integer := 0; r jsonb := '[]'::jsonb;
  pd jsonb := c #> '{points,deterioration}'; pp jsonb := c #> '{points,dropout}';
begin
  select * into t from private.patient_bp_target(p_patient);
  select * into cur from private.bp_window_stats(p_patient, p_on - (v_win - 1), p_on);
  select * into prev from private.bp_window_stats(p_patient, p_on - (2 * v_win - 1), p_on - v_win);
  select max((taken_at at time zone 'Africa/Lagos')::date) into v_last from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and (taken_at at time zone 'Africa/Lagos')::date <= p_on;
  v_anchor := private.outcome_anchor(p_patient);
  v_silent := case when v_last is null then null else p_on - v_last end;

  select count(*) filter (where grade = 'red'), count(*) filter (where grade = 'amber') into v_red, v_amber
    from public.triage_events
   where patient_id = p_patient and not shadow and (created_at at time zone 'Africa/Lagos')::date > p_on - (c ->> 'triage_lookback_days')::integer
     and (created_at at time zone 'Africa/Lagos')::date <= p_on;
  select bp_status into v_snap from public.outcome_snapshots
   where patient_id = p_patient and window_end <= p_on order by day desc limit 1;
  begin
    v_adh := nullif(private.weekly_adherence(p_patient, ((p_on + 1)::timestamp at time zone 'Africa/Lagos') - interval '1 second') ->> 'percent', '')::integer;
  exception when others then v_adh := null; v_adh_unavail := true; end;
  v_cnt14  := (select n from private.bp_window_stats(p_patient, p_on - 13, p_on));
  v_cnt14p := (select n from private.bp_window_stats(p_patient, p_on - 27, p_on - 14));

  -- deterioration: only from an average with enough readings behind it
  if cur.n >= v_minr then
    if cur.avg_sys >= t.sys + (c #>> '{well_above_target,systolic}')::integer or cur.avg_dia >= t.dia + (c #>> '{well_above_target,diastolic}')::integer then
      v_det := v_det + (pd ->> 'well_above_target')::integer; r := r || jsonb_build_object('key', 'bp_well_above_target', 'family', 'deterioration', 'points', (pd ->> 'well_above_target')::integer);
    elsif cur.avg_sys >= t.sys + (c #>> '{above_target,systolic}')::integer or cur.avg_dia >= t.dia + (c #>> '{above_target,diastolic}')::integer then
      v_det := v_det + (pd ->> 'above_target')::integer; r := r || jsonb_build_object('key', 'bp_above_target', 'family', 'deterioration', 'points', (pd ->> 'above_target')::integer);
    end if;
    if prev.n >= v_minr and cur.avg_sys - prev.avg_sys >= (c ->> 'rising_systolic')::integer then
      v_det := v_det + (pd ->> 'rising')::integer; r := r || jsonb_build_object('key', 'bp_rising', 'family', 'deterioration', 'points', (pd ->> 'rising')::integer);
    end if;
  end if;
  if v_red > 0 then v_det := v_det + (pd ->> 'red_event')::integer; r := r || jsonb_build_object('key', 'recent_red_event', 'family', 'deterioration', 'points', (pd ->> 'red_event')::integer);
  elsif v_amber > 0 then v_det := v_det + (pd ->> 'amber_event')::integer; r := r || jsonb_build_object('key', 'recent_amber_event', 'family', 'deterioration', 'points', (pd ->> 'amber_event')::integer); end if;
  if v_snap = 'uncontrolled' then v_det := v_det + (pd ->> 'last_snapshot_uncontrolled')::integer; r := r || jsonb_build_object('key', 'last_snapshot_uncontrolled', 'family', 'deterioration', 'points', (pd ->> 'last_snapshot_uncontrolled')::integer); end if;
  if v_adh is not null and v_adh < (c ->> 'adherence_low_pct')::integer then
    v_det := v_det + (pd ->> 'low_adherence')::integer; r := r || jsonb_build_object('key', 'low_adherence', 'family', 'deterioration', 'points', (pd ->> 'low_adherence')::integer);
    v_drop := v_drop + (pp ->> 'low_adherence')::integer; r := r || jsonb_build_object('key', 'low_adherence', 'family', 'dropout', 'points', (pp ->> 'low_adherence')::integer);
  end if;

  -- dropout: only for someone who has been a member long enough to have been expected to log
  if v_anchor is not null and p_on - v_anchor >= (c ->> 'joined_min_days')::integer then
    if v_last is null then
      v_drop := v_drop + (pp ->> 'no_readings_ever')::integer; r := r || jsonb_build_object('key', 'no_readings_ever', 'family', 'dropout', 'points', (pp ->> 'no_readings_ever')::integer);
    elsif v_silent >= (c #>> '{silence_days,high}')::integer then
      v_drop := v_drop + (pp ->> 'silent_high')::integer; r := r || jsonb_build_object('key', 'silent_long', 'family', 'dropout', 'points', (pp ->> 'silent_high')::integer);
    elsif v_silent >= (c #>> '{silence_days,medium}')::integer then
      v_drop := v_drop + (pp ->> 'silent_medium')::integer; r := r || jsonb_build_object('key', 'silent_some', 'family', 'dropout', 'points', (pp ->> 'silent_medium')::integer);
    end if;
    if v_cnt14p >= v_minr and v_cnt14 * 2 < v_cnt14p then
      v_drop := v_drop + (pp ->> 'fewer_readings')::integer; r := r || jsonb_build_object('key', 'fewer_readings', 'family', 'dropout', 'points', (pp ->> 'fewer_readings')::integer);
    end if;
  end if;

  det := least(v_det, 100); drop_ := least(v_drop, 100);
  lvl := case when greatest(det, drop_) >= (c #>> '{tiers,high_min}')::integer then 'high'
              when greatest(det, drop_) >= (c #>> '{tiers,medium_min}')::integer then 'medium' else 'low' end;
  reasons := r;
  inputs := jsonb_strip_nulls(jsonb_build_object('bp_readings_7d', cur.n, 'bp_readings_prev_7d', prev.n, 'days_since_last_reading', v_silent,
    'red_events_30d', v_red, 'amber_events_30d', v_amber, 'last_snapshot', v_snap, 'adherence_pct', v_adh, 'adherence_unavailable', case when v_adh_unavail then true end, 'readings_14d', v_cnt14, 'readings_prev_14d', v_cnt14p,
    'target_source', t.source));
end $$;
revoke all on function private.risk_compute(uuid, date) from public, anon, authenticated;

create function private.compute_risk_scores(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_on date := (p_now at time zone 'Africa/Lagos')::date;
  v_ver integer := (select version from public.risk_config where is_active);
  r record; s record; n integer := 0; v_failed integer := 0; v_last text;
begin
  -- people who have joined (same anchor as the outcome snapshots), not yet scored today; oldest score first so nobody starves
  for r in
    select p.id as patient_id, p.organisation_id, coalesce(p.is_test, false) as is_test
      from public.profiles p
     where p.role = 'patient' and p.is_active and private.risk_is_current_member(p.id, p_now)
       and not exists (select 1 from public.risk_scores x where x.patient_id = p.id and x.computed_on = v_on)
     order by (select max(computed_on) from public.risk_scores x where x.patient_id = p.id) nulls first
     limit 5000
  loop
    begin
      select * into s from private.risk_compute(r.patient_id, v_on);
      insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level, reasons, inputs, computed_at, is_test)
      values (r.organisation_id, r.patient_id, v_ver, v_on, s.det, s.drop_, s.lvl, s.reasons, s.inputs, p_now, r.is_test)
      on conflict (patient_id, computed_on) do nothing;
      n := n + 1;
    exception when others then
      v_failed := v_failed + 1; v_last := sqlerrm;
    end;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('risk-scores-failing', 'Risk scores are failing',
      v_failed || ' risk scores failed on the last run (' || left(v_last, 200) || '). Clinician worklists are ordered by older scores until it is fixed.');
  end if;
  return n;
end $$;
revoke all on function private.compute_risk_scores(timestamptz) from public, anon, authenticated;
select cron.schedule('risk-scores', '20 2 * * *', $$ select private.compute_risk_scores(); $$);

-- The tier a clinician sees: a live override if there is one, else the computed tier.
create function private.risk_effective_level(p_patient uuid, p_computed text) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select o.level from public.risk_overrides o where o.patient_id = p_patient and o.expires_at > now() order by o.created_at desc limit 1), p_computed)
$$;
revoke all on function private.risk_effective_level(uuid, text) from public, anon, authenticated;

-- 4. Clinician worklist (INV-12 tie, INV-10 audited) ------------------------------------------------------------------------
create function public.clinician_risk_worklist(p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r record; v_out jsonb := '[]'::jsonb; v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 50);
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'clinician' and is_active) then
    raise exception 'risk_not_authorised' using errcode = '42501';
  end if;
  for r in
    select s.patient_id, pr.patient_number, s.level as computed_level, private.risk_effective_level(s.patient_id, s.level) as level,
           s.deterioration_risk, s.dropout_risk, s.reasons, s.computed_on, s.model_version,
           exists (select 1 from public.risk_overrides o where o.patient_id = s.patient_id and o.expires_at > now()) as overridden
      from (select distinct on (patient_id) * from public.risk_scores where not is_test order by patient_id, computed_on desc) s
      join public.profiles pr on pr.id = s.patient_id
     where not coalesce(pr.is_test, false) and private.clinician_has_patient_access(s.patient_id)
     order by case private.risk_effective_level(s.patient_id, s.level) when 'high' then 0 when 'medium' then 1 else 2 end,
              greatest(s.deterioration_risk, s.dropout_risk) desc, s.dropout_risk desc, s.patient_id
     limit v_lim
  loop
    perform private.audit_chart_read(r.patient_id, array['risk_scores'], 'risk worklist', 'success');
    v_out := v_out || jsonb_build_array(jsonb_build_object('patient_id', r.patient_id, 'patient_number', r.patient_number, 'level', r.level,
      'computed_level', r.computed_level, 'overridden', r.overridden, 'deterioration_risk', r.deterioration_risk, 'dropout_risk', r.dropout_risk,
      'reasons', r.reasons, 'computed_on', r.computed_on, 'model_version', r.model_version));
  end loop;
  return jsonb_build_object('rows', v_out, 'note', 'Orders who to contact first. It is not a diagnosis and never a reason to withhold care; low does not mean no contact.');
end $$;
revoke all on function public.clinician_risk_worklist(integer) from public, anon;
grant execute on function public.clinician_risk_worklist(integer) to authenticated;

create function public.override_patient_risk(p_patient uuid, p_level text, p_reason text, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_max integer := (private.risk_rule(array['override_max_days']) #>> '{}')::integer; v_id uuid; v_org uuid;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'clinician' and is_active) then
    raise exception 'risk_not_authorised' using errcode = '42501';
  end if;
  -- A refusal is returned, not raised: raising would roll back the 'denied' audit row (the S05 pattern).
  if p_patient is null or not private.clinician_has_patient_access(p_patient) then
    if p_patient is not null and exists (select 1 from public.profiles where id = p_patient) then
      perform private.audit_chart_read(p_patient, array['risk_scores'], 'risk override refused', 'denied');
    end if;
    return jsonb_build_object('status', 'denied');
  end if;
  if p_level is null or p_level not in ('low', 'medium', 'high') or p_days is null or p_days < 1 or p_days > v_max then
    raise exception 'risk_override_invalid' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'risk_override_reason_required' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  insert into public.risk_overrides (organisation_id, patient_id, set_by, level, reason, expires_at)
  values (v_org, p_patient, v_uid, p_level, btrim(p_reason), now() + make_interval(days => p_days)) returning id into v_id;
  perform private.audit_chart_read(p_patient, array['risk_scores'], 'risk override set', 'success');
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;
revoke all on function public.override_patient_risk(uuid, text, text, integer) from public, anon;
grant execute on function public.override_patient_risk(uuid, text, text, integer) to authenticated;

-- 5. Fairness report (admin or CMO): tier mix by sex, age band and state, small groups withheld ---------------------------------
create function public.risk_distribution_report() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  v_out jsonb := '{}'::jsonb; d text; v_cells jsonb; v_total integer;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'risk_not_authorised' using errcode = '42501';
  end if;
  drop table if exists pg_temp._s38c_latest;
  create temp table _s38c_latest on commit drop as
    select distinct on (s.patient_id) s.patient_id, s.level,
           coalesce(p.sex::text, 'unknown') as sex, coalesce(p.state, 'unknown') as state,
           case when p.date_of_birth is null then 'unknown'
                when extract(year from age(s.computed_on, p.date_of_birth)) < 18 then 'under_18'
                else (floor(extract(year from age(s.computed_on, p.date_of_birth)) / 10) * 10)::integer::text || 's' end as age_band
      from public.risk_scores s join public.profiles p on p.id = s.patient_id
     where not s.is_test and not coalesce(p.is_test, false)
     order by s.patient_id, s.computed_on desc;
  select count(*) into v_total from _s38c_latest;
  foreach d in array array['sex', 'age_band', 'state'] loop
    execute format($q$
      with cells as (select %1$I as k, count(*) n, count(*) filter (where level = 'high') hi, count(*) filter (where level = 'medium') me, count(*) filter (where level = 'low') lo
                       from _s38c_latest group by 1),
      flagged as (select c.*, (c.n < %2$s or (c.hi between 1 and %2$s - 1) or (c.me between 1 and %2$s - 1) or (c.lo between 1 and %2$s - 1)) as small from cells c),
      nxt as (select k from flagged where not small order by n, k limit 1),
      final as (select f.*, (f.small or ((select count(*) from flagged where small) = 1 and f.k = (select k from nxt))) as sup from flagged f)
      select coalesce(jsonb_agg(case when sup then jsonb_build_object('key', k, 'suppressed', true)
                                     else jsonb_build_object('key', k, 'n', n, 'high', hi, 'medium', me, 'low', lo, 'high_pct', round(100.0 * hi / n, 1)) end order by k), '[]'::jsonb)
        from final$q$, d, v_min) into v_cells;
    v_out := v_out || jsonb_build_object(d, v_cells);
  end loop;
  perform private.log_audit('risk.distribution_report', 'risk_scores', null, '{}'::jsonb);
  return jsonb_build_object('total_scored', case when v_total >= v_min then v_total else null end, 'minimum_cell', v_min, 'by', v_out,
    'purpose', 'Checks that the ordering does not fall unevenly on one group. A group with few people is withheld, and so is the next smallest so it cannot be recovered by subtraction.',
    'not_a_causal_claim', true);
end $$;
revoke all on function public.risk_distribution_report() from public, anon;
grant execute on function public.risk_distribution_report() to authenticated;

-- 6. Monthly report ----------------------------------------------------------------------------------------------------------
create table public.monthly_reports (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  month           date not null check (month = date_trunc('month', month)::date),
  payload         jsonb not null check (jsonb_typeof(payload) = 'object'),
  config_version  integer not null references public.monthly_report_config (version),
  generated_at    timestamptz not null default now(),
  is_test         boolean not null default false,
  unique (patient_id, month)
);
alter table public.monthly_reports enable row level security;
revoke all on public.monthly_reports from public, anon, authenticated;
grant select on public.monthly_reports to authenticated;
create policy monthly_reports_own on public.monthly_reports for select to authenticated using (patient_id = (select auth.uid()));

create function private.monthly_reports_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'monthly_reports_append_only' using errcode = 'P0001'; end $$;
create trigger monthly_reports_append_only before update on public.monthly_reports
  for each row execute function private.monthly_reports_append_only();
revoke all on function private.monthly_reports_append_only() from public, anon, authenticated;

create function private.monthly_report_payload(p_patient uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_min integer := (private.report_rule('min_readings') #>> '{}')::integer;
  v_thr integer := (private.report_rule('direction_threshold_systolic') #>> '{}')::integer;
  v_from date := p_month; v_to date := (p_month + interval '1 month' - interval '1 day')::date;
  t record; m record; pm record; w jsonb := '[]'::jsonb; ws date; we date; wk record; v_dir text; v_adh jsonb; v_adh_pct integer;
  v_enough boolean;
begin
  select * into t from private.patient_bp_target(p_patient);
  select * into m from private.bp_window_stats(p_patient, v_from, v_to);
  select * into pm from private.bp_window_stats(p_patient, (p_month - interval '1 month')::date, (p_month - interval '1 day')::date);
  v_enough := m.n >= v_min;
  ws := v_from;
  while ws <= v_to loop
    we := least(ws + 6, v_to);
    select * into wk from private.bp_window_stats(p_patient, ws, we);
    w := w || jsonb_build_array(jsonb_build_object('week_start', ws, 'readings', wk.n, 'avg_systolic', case when wk.n >= v_min then wk.avg_sys end,
                                                   'avg_diastolic', case when wk.n >= v_min then wk.avg_dia end));
    ws := ws + 7;
  end loop;
  v_dir := case when not v_enough or pm.n < v_min then 'not_enough_data'
                when m.avg_sys <= pm.avg_sys - v_thr then 'lower'
                when m.avg_sys >= pm.avg_sys + v_thr then 'higher' else 'similar' end;
  -- No exception handler on purpose: this report is written once. If adherence cannot be read the report is NOT written (the job counts the
  -- failure, opens an incident and tries again tomorrow) rather than storing "nothing to show" for good.
  v_adh := private.weekly_adherence(p_patient, ((v_to + 1)::timestamp at time zone 'Africa/Lagos') - interval '1 second');
  v_adh_pct := nullif(v_adh ->> 'percent', '')::integer;
  return jsonb_build_object(
    'month', p_month, 'readings', m.n, 'days_logged', m.days, 'enough_readings', v_enough, 'minimum_readings', v_min,
    'target', jsonb_build_object('systolic', t.sys, 'diastolic', t.dia, 'source', t.source),
    'average', case when v_enough then jsonb_build_object('systolic', m.avg_sys, 'diastolic', m.avg_dia,
                      'versus_target', case when m.avg_sys < t.sys and m.avg_dia < t.dia then 'under' else 'above' end) end,
    'weeks', w, 'direction_vs_last_month', v_dir,
    'adherence_pct', v_adh_pct);
end $$;
revoke all on function private.monthly_report_payload(uuid, date) from public, anon, authenticated;

-- On or after the (grace_days + 1)th of the next month: one report per person and month, idempotent. People who joined, or who logged
-- a reading that month. Never overwrites: a report is a record of what the person was told.
create function private.generate_monthly_reports(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.report_rule('grace_days') #>> '{}')::integer;
  v_ver integer := (select version from public.monthly_report_config where is_active);
  v_month date; r record; n integer := 0; v_failed integer := 0; v_last text; v_rid uuid;
  v_latest date := (date_trunc('month', v_today) - interval '1 month')::date;
begin
  -- the month just ended, once the grace days for late-syncing readings have passed; earlier unreported months are filled too (6 back)
  for v_month in
    select (date_trunc('month', v_today) - make_interval(months => k))::date from generate_series(1, 6) k
     where (date_trunc('month', v_today) - make_interval(months => k) + interval '1 month')::date + v_grace <= v_today
  loop
    for r in
      select p.id as patient_id, p.organisation_id, coalesce(p.is_test, false) as is_test
        from public.profiles p
       where p.role = 'patient' and p.is_active
         and (private.outcome_anchor(p.id) is not null
              or exists (select 1 from public.vitals_readings v where v.patient_id = p.id and v.vital_type = 'blood_pressure'
                          and (v.taken_at at time zone 'Africa/Lagos')::date between v_month and (v_month + interval '1 month' - interval '1 day')::date))
         and (private.outcome_anchor(p.id) is null or private.outcome_anchor(p.id) <= (v_month + interval '1 month' - interval '1 day')::date)
         and not exists (select 1 from public.monthly_reports x where x.patient_id = p.id and x.month = v_month)
       limit 5000
    loop
      begin
        v_rid := null;
        insert into public.monthly_reports (organisation_id, patient_id, month, payload, config_version, is_test)
        values (r.organisation_id, r.patient_id, v_month, private.monthly_report_payload(r.patient_id, v_month), v_ver, r.is_test)
        on conflict (patient_id, month) do nothing
        returning id into v_rid;
        n := n + 1;
        -- One neutral notice, only for the month that has just closed (never for a back-filled older month): in-app and push, routine
        -- priority so quiet hours and the daily cap apply. Empty payload, so it can name no condition, reading or number (INV-07).
        -- Nothing depends on it being delivered: the report is on the page either way.
        if v_rid is not null and v_month = v_latest then
          perform private.circle_notify(r.patient_id, r.organisation_id, 'monthly_report_ready', 'monthly_reports', v_rid, array['in_app', 'push'], 'routine', r.is_test);
        end if;
      exception when others then
        v_failed := v_failed + 1; v_last := sqlerrm;
      end;
    end loop;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('monthly-reports-failing', 'Monthly progress reports are failing',
      v_failed || ' monthly reports could not be written on the last run (' || left(v_last, 200) || '). They are retried every day.');
  end if;
  return n;
end $$;
revoke all on function private.generate_monthly_reports(timestamptz) from public, anon, authenticated;
select cron.schedule('monthly-reports', '30 2 * * *', $$ select private.generate_monthly_reports(); $$);

-- The person's own reports, newest first (also readable straight from the table by RLS; this is the stable shape for the app).
create function public.my_monthly_reports(p_limit integer default 12) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('month', month, 'payload', payload) order by month desc), '[]'::jsonb)
    from (select month, payload from public.monthly_reports where patient_id = (select auth.uid()) order by month desc limit least(greatest(coalesce(p_limit, 12), 1), 24)) x
$$;
revoke all on function public.my_monthly_reports(integer) from public, anon;
grant execute on function public.my_monthly_reports(integer) to authenticated;

-- 7. Self-check ------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.risk_scores', 'SELECT') or has_table_privilege('anon', 'public.risk_scores', 'SELECT') then raise exception 'S38c: risk_scores is readable directly'; end if;
  if has_table_privilege('authenticated', 'public.risk_overrides', 'SELECT') then raise exception 'S38c: risk_overrides is readable directly'; end if;
  if has_table_privilege('authenticated', 'public.monthly_reports', 'INSERT,UPDATE,DELETE') or has_table_privilege('anon', 'public.monthly_reports', 'SELECT') then raise exception 'S38c: monthly_reports has a wrong grant'; end if;
  if has_function_privilege('anon', 'public.clinician_risk_worklist(integer)', 'EXECUTE') or has_function_privilege('anon', 'public.override_patient_risk(uuid,text,text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.risk_distribution_report()', 'EXECUTE') or has_function_privilege('anon', 'public.my_monthly_reports(integer)', 'EXECUTE') then raise exception 'S38c: anon can execute a risk or report function'; end if;
  if has_function_privilege('authenticated', 'private.open_job_incident(text,text,text)', 'EXECUTE') or has_function_privilege('authenticated', 'private.risk_is_current_member(uuid,timestamptz)', 'EXECUTE') then raise exception 'S38c: a helper is callable by users'; end if;
  if has_function_privilege('authenticated', 'private.compute_risk_scores(timestamptz)', 'EXECUTE') or has_function_privilege('authenticated', 'private.generate_monthly_reports(timestamptz)', 'EXECUTE') then raise exception 'S38c: a user can run a job'; end if;
end $$;
