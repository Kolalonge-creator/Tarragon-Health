-- WP3: the cascade-of-care report and the selection-bias panel, on top of S75.
-- Research: docs/research/competitor-review-global-2026-10.md (cascade of care, WHO HEARTS / DHIS2 terms). Design: docs/design/WP3.md.
--
-- WHAT THIS ADDS (nothing here changes a stored patient row):
--   1. outcome_cascade_config: versioned stage definitions, PROPOSED, born UNSIGNED and INACTIVE. Only the Chief Medical Officer's
--      sign_outcome_cascade_config() activates a version. Until then every cascade figure is withheld (reason awaiting_cmo_signature).
--      Mirrored in the code registry as `outcomes.cascade_rules` (drift test).
--   2. The cascade of care for hypertension and for diabetes: enrolled -> screened -> diagnosed -> on treatment -> controlled, counted
--      from real tables only. Every count goes through the S75a single minimum-cell rule (private.min_cell_floor / suppress_cell /
--      suppress_difference / suppress_groups). Test accounts are left out (INV-13). Control that cannot be read is shown as UNKNOWN, never
--      as uncontrolled and never dropped. A stage that cannot be derived honestly is listed under `not_available` with the reason.
--   3. The selection-bias panel: who is in a programme's figures against who is not, on the few attributes Tarragon holds (age band, sex,
--      baseline blood pressure band, how they joined), plus an intent-to-treat view (everyone who joined, missing shown as missing, the
--      people who dropped out shown apart) beside the completers view. Descriptive, never causal. No clinician appears anywhere.
--   4. The sponsor pilot / renewal pack carries both (sponsor audience: no attribute of a person who declined to share is ever shown).
--
-- DEFINITIONS THAT DIFFER FROM THE EXISTING S38 / S75 BP REPORT (on purpose, stated in every output):
--   * S38 judges a person against their OWN home target, else 140/90, at fixed days after joining. The cascade judges the most recent 7-day
--     home average against the fixed 140/90 line (the HEDIS CBP and national programme threshold), as at the day the report is run, so a
--     cascade controlled figure and an S38 day-90 figure are two different measures and may differ.
--   * The cascade counts every adult Member with a joining date, not only people who share group figures; for a sponsor pack it is
--     restricted to the members who agreed to share (private.sponsor_agreed_members), exactly like the sponsor figures.
--
-- Counts before this migration (live): no outcome_cascade_config table; nothing to convert.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned, unsigned)
-- ---------------------------------------------------------------------------
create table public.outcome_cascade_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  owner          text not null default 'CMO',
  effective_from date not null,
  config         jsonb not null check (jsonb_typeof(config) = 'object'),
  note           text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint outcome_cascade_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index outcome_cascade_config_one_active on public.outcome_cascade_config (is_active) where is_active;
create index outcome_cascade_config_approved_by_idx on public.outcome_cascade_config (approved_by) where approved_by is not null;
alter table public.outcome_cascade_config enable row level security;
revoke all on public.outcome_cascade_config from public, anon, authenticated;
grant select on public.outcome_cascade_config to authenticated;
create policy outcome_cascade_config_read on public.outcome_cascade_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.outcome_cascade_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'outcome_cascade_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a cascade config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'a cascade config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.outcome_cascade_config_guard() from public, anon, authenticated;
create trigger outcome_cascade_config_guard before insert or update or delete on public.outcome_cascade_config
  for each row execute function private.outcome_cascade_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.outcome_cascade_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- cascade-rules-v1-begin
insert into public.outcome_cascade_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-23', $json$
{
  "min_adult_age_years": 18,
  "exclude_pregnant": true,
  "hypertension": {
    "controlled_below": { "systolic": 140, "diastolic": 90 },
    "control_window_days": 7,
    "min_readings": 3,
    "lookback_days": 90,
    "diagnosis_icd10_prefixes": ["I10", "I11", "I12", "I13", "I15", "I16"],
    "diagnosis_statuses": ["active", "controlled", "uncontrolled"],
    "stages": [
      { "code": "enrolled", "label": "Enrolled adult Members", "definition": "Members aged 18 or over with a known date of birth and a joining date, not pregnant, not a test account." },
      { "code": "screened", "label": "Blood pressure measured", "definition": "Enrolled Members with at least one cleared blood pressure reading on the platform (home or recorded by a clinician). This is a share of enrolled Members, not screening coverage of a population." },
      { "code": "diagnosed", "label": "Hypertension on record", "definition": "Enrolled Members with an active hypertension care plan, or a hypertension entry on the problem list (ICD-10 I10 to I16) marked active, controlled or uncontrolled. Includes people with no reading yet." },
      { "code": "on_treatment", "label": "On a recorded medicine", "definition": "Diagnosed Members with at least one active, current medicine recorded under their hypertension care plan. The medicine class is not held, so this counts any medicine under that plan. Lifestyle-only treatment is not counted." },
      { "code": "controlled", "label": "Blood pressure under 140/90", "definition": "Members on treatment whose most recent 7-day home average, from at least 3 cleared readings in the last 90 days, is under 140 systolic and under 90 diastolic. Members on treatment with too few or no recent readings are shown as control unknown, not as uncontrolled." }
    ],
    "not_available": [
      { "item": "Population screening coverage", "reason": "Tarragon holds no register of the people who could have been screened, so a screened share of a population cannot be given." },
      { "item": "Undiagnosed raised blood pressure", "reason": "A raised reading in a Member with no diagnosis is followed up clinically, and the platform does not hold a confirmed-raised-without-diagnosis record to count." },
      { "item": "Prevalence", "reason": "This is a cascade of Tarragon Members, not of a population, and says nothing about how common hypertension is." }
    ]
  },
  "diabetes": {
    "controlled_hba1c_below_percent": 7.0,
    "lookback_days": 180,
    "valid_min": 3.0,
    "valid_max": 20.0,
    "diagnosis_icd10_prefixes": ["E10", "E11", "E13", "E14"],
    "diagnosis_statuses": ["active", "controlled", "uncontrolled"],
    "stages": [
      { "code": "enrolled", "label": "Enrolled adult Members", "definition": "Members aged 18 or over with a known date of birth and a joining date, not pregnant, not a test account." },
      { "code": "screened", "label": "Glucose or HbA1c measured", "definition": "Enrolled Members with at least one cleared glucose reading or an HbA1c result on the platform. This is a share of enrolled Members, not screening coverage of a population." },
      { "code": "diagnosed", "label": "Diabetes on record", "definition": "Enrolled Members with an active diabetes care plan, or a diabetes entry on the problem list (ICD-10 E10 to E14) marked active, controlled or uncontrolled. Includes people with no result yet." },
      { "code": "on_treatment", "label": "On a recorded medicine", "definition": "Diagnosed Members with at least one active, current medicine recorded under their diabetes care plan. The medicine class is not held, so this counts any medicine under that plan." },
      { "code": "controlled", "label": "HbA1c under 7.0 percent", "definition": "Members on treatment whose most recent HbA1c in the last 180 days is under 7.0 percent. Members on treatment with no recent HbA1c are shown as control unknown, not as uncontrolled. The fixed 7.0 line is used, not each person's own care-plan target." }
    ],
    "not_available": [
      { "item": "Population screening coverage", "reason": "Tarragon holds no register of the people who could have been screened, so a screened share of a population cannot be given." },
      { "item": "Undiagnosed diabetes", "reason": "The platform does not hold a record of raised glucose in a Member with no diagnosis to count." },
      { "item": "Prevalence", "reason": "This is a cascade of Tarragon Members, not of a population, and says nothing about how common diabetes is." }
    ]
  },
  "selection_panel": {
    "age_bands": [[18, 39], [40, 49], [50, 59], [60, 69], [70, 150]],
    "severe_from": { "systolic": 160, "diastolic": 100 },
    "note": "These comparisons are descriptive, not causal. They show who is in the figures and who is not, on the few details Tarragon holds. They cannot show why people joined or stayed, and they do not show that the programme caused any difference.",
    "eligible_roster_reason": "Tarragon holds no list of the people a sponsor could have enrolled, so people who were eligible but did not enrol cannot be counted. The comparison given is with other adult Members who are not in this programme's figures."
  },
  "notes": {
    "cascade": "A cascade of Tarragon Members, not of a population. It is a count of people at a point in time, not a measure of what any service did. Differences between months can come from who joined.",
    "difference_from_s38": "Control here means the most recent 7-day home average is under 140/90, as at the day the report is run. The day-90 and day-180 blood pressure reports judge each person against their own home target when they have one, at fixed days after joining. The two measures can differ."
  }
}
$json$::jsonb, 'PROPOSED, v1, UNSIGNED, INACTIVE (WP3). Owner: CMO. Cascade-of-care stage definitions, the 140/90 and 7.0 percent control lines, and the selection panel bands. Nothing shows until the CMO signs.');
-- cascade-rules-v1-end

create function public.sign_outcome_cascade_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.outcome_cascade_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the cascade of care definitions' using errcode = '42501'; end if;
  select * into c from public.outcome_cascade_config where version = p_version for update;
  if not found then raise exception 'no such cascade configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.outcome_cascade_config set is_active = false where is_active and version <> p_version;
  update public.outcome_cascade_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'outcome_cascade_config.signed',
            'outcome_cascade_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_outcome_cascade_config(integer) from public, anon, authenticated;
grant execute on function public.sign_outcome_cascade_config(integer) to authenticated;

-- The active, signed version (null while the CMO has not signed anything).
create function private.cascade_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config || jsonb_build_object('_version', version) from public.outcome_cascade_config where is_active and approved_at is not null order by version desc limit 1 $$;
revoke all on function private.cascade_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The people and their stages (one row per person; real tables only)
-- ---------------------------------------------------------------------------
-- control_state is only set for a person on treatment: 'controlled', 'uncontrolled' or 'unknown'.
create function private.cascade_people(p_condition text, p_cfg jsonb, p_patients uuid[], p_from date, p_to date)
returns table (patient_id uuid, anchor date, screened boolean, diagnosed boolean, treated boolean, control_state text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  c jsonb := p_cfg -> p_condition;
  v_age integer := (p_cfg ->> 'min_adult_age_years')::integer;
  v_excl_preg boolean := coalesce((p_cfg ->> 'exclude_pregnant')::boolean, false);
begin
  if c is null or p_condition not in ('hypertension', 'diabetes') then raise exception 'cascade_condition_unknown' using errcode = '22023'; end if;
  return query
  with scoped as (
    select p.id as pid, a.anchor as anc
      from public.profiles p
      cross join lateral (select private.outcome_anchor(p.id) as anchor) a
     where p.role = 'patient' and p.is_active and not coalesce(p.is_test, false) and p.date_of_birth is not null
       and a.anchor is not null
       and p.date_of_birth <= (a.anchor - make_interval(years => v_age))::date
       and (p_patients is null or p.id = any (p_patients))
       and (p_from is null or a.anchor >= p_from) and (p_to is null or a.anchor <= p_to)
       and not (v_excl_preg and exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p.id and pp.is_pregnant))
  ), flags as (
    select s.pid, s.anc,
      case when p_condition = 'hypertension' then
             exists (select 1 from public.vitals_readings v where v.patient_id = s.pid and v.vital_type = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
                       and v.correction_status is null and (v.validation_status = 'valid' or coalesce(v.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[]))
           else
             exists (select 1 from public.vitals_readings v where v.patient_id = s.pid and v.vital_type = 'glucose' and v.glucose_mmol_l is not null and v.correction_status is null and v.validation_status = 'valid')
             or exists (select 1 from public.lab_analyte_readings l where l.patient_id = s.pid and l.code = 'hba1c' and l.correction_status is null)
      end as scr,
      (exists (select 1 from public.care_plans cp where cp.patient_id = s.pid and cp.condition::text = p_condition and cp.status = 'active')
       or exists (select 1 from public.patient_conditions pc
                   where pc.patient_id = s.pid and pc.status::text in (select jsonb_array_elements_text(c -> 'diagnosis_statuses'))
                     and exists (select 1 from jsonb_array_elements_text(c -> 'diagnosis_icd10_prefixes') x where upper(coalesce(pc.icd10_code, '')) like x || '%'))) as dx
      from scoped s
  ), tx as (
    select f.*, (f.dx and exists (
        select 1 from public.medications m join public.care_plans cp on cp.id = m.care_plan_id
         where m.patient_id = f.pid and cp.patient_id = f.pid and cp.condition::text = p_condition and cp.status = 'active'
           and m.is_active and m.superseded_at is null and m.stopped_at is null and (m.expires_at is null or m.expires_at > now()))) as treat
      from flags f
  )
  select t.pid, t.anc, t.scr, t.dx, t.treat,
         case when not t.treat then null
              when p_condition = 'hypertension' then
                (select case when w.n >= (c ->> 'min_readings')::integer
                             then case when w.avg_s < (c #>> '{controlled_below,systolic}')::numeric and w.avg_d < (c #>> '{controlled_below,diastolic}')::numeric then 'controlled' else 'uncontrolled' end
                             else 'unknown' end
                   from (select count(*) as n, avg(r.systolic) as avg_s, avg(r.diastolic) as avg_d
                           from (select v.systolic, v.diastolic, (v.taken_at at time zone 'Africa/Lagos')::date as d
                                   from public.vitals_readings v
                                  where v.patient_id = t.pid and v.vital_type = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
                                    and v.correction_status is null and (v.validation_status = 'valid' or coalesce(v.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
                                    and (v.taken_at at time zone 'Africa/Lagos')::date >= ((now() at time zone 'Africa/Lagos')::date - (c ->> 'lookback_days')::integer)) r
                          where r.d > (select max(r2.d) from (select (v2.taken_at at time zone 'Africa/Lagos')::date as d
                                         from public.vitals_readings v2
                                        where v2.patient_id = t.pid and v2.vital_type = 'blood_pressure' and v2.systolic is not null and v2.diastolic is not null
                                          and v2.correction_status is null and (v2.validation_status = 'valid' or coalesce(v2.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
                                          and (v2.taken_at at time zone 'Africa/Lagos')::date >= ((now() at time zone 'Africa/Lagos')::date - (c ->> 'lookback_days')::integer)) r2)
                                       - (c ->> 'control_window_days')::integer) w)
              else
                (select case when l.val is null then 'unknown' when l.val < (c ->> 'controlled_hba1c_below_percent')::numeric then 'controlled' else 'uncontrolled' end
                   from (select (select x.value::numeric from public.lab_analyte_readings x
                                  where x.patient_id = t.pid and x.code = 'hba1c' and x.unit = 'percent' and x.correction_status is null
                                    and x.value between (c ->> 'valid_min')::numeric and (c ->> 'valid_max')::numeric
                                    and (x.taken_at at time zone 'Africa/Lagos')::date >= ((now() at time zone 'Africa/Lagos')::date - (c ->> 'lookback_days')::integer)
                                  order by x.taken_at desc limit 1) as val) l)
         end
    from tx t;
end $$;
revoke all on function private.cascade_people(text, jsonb, uuid[], date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stages as figures, through the single minimum-cell rule
-- ---------------------------------------------------------------------------
-- A stage shown is {code,label,definition,n,pct_of_enrolled,step_of,pct_of_step}; a stage withheld has no number at all.
-- Consecutive stages are subsets, so a small DIFFERENCE between a stage and its parent (1 to minimum-1 people) would reveal a small group:
-- the later stage is then withheld too (suppress_difference). The three control states are a partition of "on treatment" and go through
-- suppress_groups (zero is shown as zero; it is not a person).
create function private.cascade_stages_json(p_cfg jsonb, p_condition text, p_n bigint, p_scr bigint, p_dx bigint, p_tx bigint, p_ctrl bigint, p_unc bigint, p_unk bigint, p_min integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_stages jsonb := p_cfg #> array[p_condition, 'stages'];
  v_out jsonb := '[]'::jsonb;
  s jsonb; v_code text; v_n bigint; v_parent bigint; v_parent_code text; v_reason text; v_shown jsonb := '{}'::jsonb;
  v_groups jsonb; g jsonb; v_ctrl_json jsonb := '[]'::jsonb; v_nonzero jsonb;
begin
  if private.suppress_cell(p_n, null, p_min) is not null then
    return jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', p_min);
  end if;
  for s in select * from jsonb_array_elements(v_stages) loop
    v_code := s ->> 'code';
    v_n := case v_code when 'enrolled' then p_n when 'screened' then p_scr when 'diagnosed' then p_dx when 'on_treatment' then p_tx when 'controlled' then p_ctrl end;
    v_parent_code := case v_code when 'screened' then 'enrolled' when 'diagnosed' then 'enrolled' when 'on_treatment' then 'diagnosed' when 'controlled' then 'on_treatment' end;
    v_parent := case v_parent_code when 'enrolled' then p_n when 'diagnosed' then p_dx when 'on_treatment' then p_tx end;
    v_reason := null;
    if v_code <> 'enrolled' then
      if v_parent_code is not null and not (v_shown ? v_parent_code) then v_reason := 'parent_withheld';
      else v_reason := coalesce(private.suppress_cell(v_n, null, p_min), case when private.suppress_difference(v_parent, v_n, p_min) then 'small_difference' end); end if;
    end if;
    if v_reason is null then
      v_shown := v_shown || jsonb_build_object(v_code, true);
      v_out := v_out || jsonb_build_object('code', v_code, 'label', s ->> 'label', 'definition', s ->> 'definition', 'suppressed', false, 'n', v_n,
          'pct_of_enrolled', round(100.0 * v_n / nullif(p_n, 0), 1),
          'step_of', v_parent_code, 'pct_of_step', case when v_parent_code is null then null else round(100.0 * v_n / nullif(v_parent, 0), 1) end);
    else
      v_out := v_out || jsonb_build_object('code', v_code, 'label', s ->> 'label', 'definition', s ->> 'definition', 'suppressed', true, 'reason', v_reason, 'minimum', p_min);
    end if;
  end loop;

  -- Where "on treatment" is shown: how control splits (controlled / uncontrolled / unknown). Missing is shown as unknown, not dropped.
  if v_shown ? 'on_treatment' then
    v_nonzero := '[]'::jsonb;
    for g in select * from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('key', 'controlled', 'n', p_ctrl), jsonb_build_object('key', 'uncontrolled', 'n', p_unc), jsonb_build_object('key', 'unknown', 'n', p_unk))) loop
      if (g ->> 'n')::bigint > 0 then v_nonzero := v_nonzero || g; end if;
    end loop;
    v_groups := private.suppress_groups(v_nonzero, p_min);
    for g in select * from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('key', 'controlled', 'n', p_ctrl), jsonb_build_object('key', 'uncontrolled', 'n', p_unc), jsonb_build_object('key', 'unknown', 'n', p_unk))) loop
      if (g ->> 'n')::bigint = 0 then
        v_ctrl_json := v_ctrl_json || jsonb_build_object('key', g ->> 'key', 'suppressed', false, 'n', 0, 'pct_of_treated', 0);
      else
        v_ctrl_json := v_ctrl_json || coalesce(
          (select case when (x ->> 'suppressed')::boolean then jsonb_build_object('key', x ->> 'key', 'suppressed', true, 'reason', x ->> 'reason', 'minimum', p_min)
                       else jsonb_build_object('key', x ->> 'key', 'suppressed', false, 'n', (x ->> 'n')::bigint, 'pct_of_treated', round(100.0 * (x ->> 'n')::bigint / nullif(p_tx, 0), 1)) end
             from jsonb_array_elements(v_groups) x where x ->> 'key' = g ->> 'key'), '{}'::jsonb);
      end if;
    end loop;
  end if;
  return jsonb_build_object('suppressed', false, 'stages', v_out, 'control_among_treated', v_ctrl_json);
end $$;
revoke all on function private.cascade_stages_json(jsonb, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, integer) from public, anon, authenticated;

-- The whole report for one condition: the total and one row per calendar month of joining. Months go through suppress_groups on their
-- enrolled counts, so one withheld month cannot be recovered as the total minus the others.
create function private.cascade_aggregate(p_condition text, p_patients uuid[], p_from date, p_to date, p_min integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.cascade_config();
  v_min integer;
  t record; m record; v_months jsonb := '[]'::jsonb; v_groups jsonb := '[]'::jsonb; v_marked jsonb;
begin
  if v_cfg is null then
    return jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature', 'condition', p_condition);
  end if;
  v_min := greatest(private.min_cell_floor(), coalesce(p_min, 0));
  -- whole calendar months of joining, so two ranges a day apart cannot be subtracted
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  drop table if exists pg_temp._wp3_people;
  create temp table _wp3_people on commit drop as select * from private.cascade_people(p_condition, v_cfg, p_patients, p_from, p_to);

  select count(*) as n, count(*) filter (where screened) as scr, count(*) filter (where diagnosed) as dx, count(*) filter (where treated) as tx,
         count(*) filter (where control_state = 'controlled') as ctrl, count(*) filter (where control_state = 'uncontrolled') as unc,
         count(*) filter (where control_state = 'unknown') as unk
    into t from _wp3_people;

  for m in select date_trunc('month', anchor)::date as mon, count(*) as n, count(*) filter (where screened) as scr, count(*) filter (where diagnosed) as dx,
                  count(*) filter (where treated) as tx, count(*) filter (where control_state = 'controlled') as ctrl,
                  count(*) filter (where control_state = 'uncontrolled') as unc, count(*) filter (where control_state = 'unknown') as unk
             from _wp3_people group by 1 order by 1 loop
    v_groups := v_groups || jsonb_build_object('key', m.mon::text, 'n', m.n);
  end loop;
  v_marked := private.suppress_groups(v_groups, v_min);
  for m in select date_trunc('month', anchor)::date as mon, count(*) as n, count(*) filter (where screened) as scr, count(*) filter (where diagnosed) as dx,
                  count(*) filter (where treated) as tx, count(*) filter (where control_state = 'controlled') as ctrl,
                  count(*) filter (where control_state = 'uncontrolled') as unc, count(*) filter (where control_state = 'unknown') as unk
             from _wp3_people group by 1 order by 1 loop
    if coalesce((select (x ->> 'suppressed')::boolean from jsonb_array_elements(v_marked) x where x ->> 'key' = m.mon::text), true) then
      v_months := v_months || jsonb_build_object('month', m.mon, 'suppressed', true, 'reason', coalesce((select x ->> 'reason' from jsonb_array_elements(v_marked) x where x ->> 'key' = m.mon::text), 'under_minimum'), 'minimum', v_min);
    else
      v_months := v_months || jsonb_build_object('month', m.mon, 'cascade', private.cascade_stages_json(v_cfg, p_condition, m.n, m.scr, m.dx, m.tx, m.ctrl, m.unc, m.unk, v_min));
    end if;
  end loop;

  return jsonb_build_object(
    'condition', p_condition, 'config_version', (v_cfg ->> '_version')::integer, 'minimum_cell', v_min,
    'total', private.cascade_stages_json(v_cfg, p_condition, t.n, t.scr, t.dx, t.tx, t.ctrl, t.unc, t.unk, v_min),
    'by_month_of_joining', v_months,
    'not_available', v_cfg #> array[p_condition, 'not_available'],
    'note', v_cfg #>> '{notes,cascade}',
    'difference_from_bp_outcome_reports', v_cfg #>> '{notes,difference_from_s38}',
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'comparison_group', 'none',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.cascade_aggregate(text, uuid[], date, date, integer) from public, anon, authenticated;

create function public.cascade_of_care_report(p_condition text, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'outcomes_not_authorised' using errcode = '42501'; end if;
  if p_condition not in ('hypertension', 'diabetes') then raise exception 'cascade_condition_unknown' using errcode = '22023'; end if;
  v_r := private.cascade_aggregate(p_condition, null, p_from, p_to);
  perform private.log_audit('outcomes.cascade_report', 'outcome_report', null, jsonb_build_object('condition', p_condition, 'from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.cascade_of_care_report(text, date, date) from public, anon;
grant execute on function public.cascade_of_care_report(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The selection-bias panel
-- ---------------------------------------------------------------------------
-- Attributes held for a person: age band at joining, sex, baseline blood pressure band (the day-0 7-day average, S38), and how they joined.
create function private.selection_attrs(p_cfg jsonb, p_patients uuid[])
returns table (patient_id uuid, age_band text, sex text, baseline_bp text, channel text)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         coalesce((select case when (b ->> 1)::integer >= 150 then (b ->> 0) || '+' else (b ->> 0) || ' to ' || (b ->> 1) end
                     from jsonb_array_elements(p_cfg #> '{selection_panel,age_bands}') b
                    where date_part('year', age(a.anchor, p.date_of_birth))::integer between (b ->> 0)::integer and (b ->> 1)::integer limit 1), 'age not in a band'),
         coalesce(p.sex::text, 'not recorded'),
         case when s.id is null or s.bp_status = 'insufficient_data' then 'no baseline average'
              when s.bp_avg_7d_sys >= (p_cfg #>> '{selection_panel,severe_from,systolic}')::numeric or s.bp_avg_7d_dia >= (p_cfg #>> '{selection_panel,severe_from,diastolic}')::numeric then 'severe (160/100 or above)'
              when s.bp_avg_7d_sys >= (p_cfg #>> '{hypertension,controlled_below,systolic}')::numeric or s.bp_avg_7d_dia >= (p_cfg #>> '{hypertension,controlled_below,diastolic}')::numeric then 'above 140/90 up to 159/99'
              else 'under 140/90' end,
         coalesce((select m.source from public.patient_memberships m where m.patient_id = p.id order by m.starts_at limit 1),
                  case when exists (select 1 from public.entitlements e where e.patient_id = p.id and e.kind in ('membership', 'care_pack')) then 'entitlement' end, 'not recorded')
    from public.profiles p
    cross join lateral (select private.outcome_anchor(p.id) as anchor) a
    left join public.outcome_snapshots s on s.patient_id = p.id and s.pathway_code = 'bp' and s.day = 0
   where p.id = any (p_patients)
$$;
revoke all on function private.selection_attrs(jsonb, uuid[]) from public, anon, authenticated;

-- One comparison: two groups of people (as id arrays), attribute by attribute. A group below the minimum is withheld whole; inside a group
-- the categories go through suppress_groups. Percentages are of the group total and only given for a category that is shown.
create function private.selection_compare(p_cfg jsonb, p_a uuid[], p_b uuid[], p_min integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_attr text; v_out jsonb := '[]'::jsonb; v_cats jsonb; v_cat text; ga jsonb; gb jsonb; na bigint := cardinality(p_a); nb bigint := cardinality(p_b);
  ra jsonb; rb jsonb; row_a jsonb; row_b jsonb; v_ok_a boolean := private.suppress_cell(cardinality(p_a), null, p_min) is null; v_ok_b boolean := private.suppress_cell(cardinality(p_b), null, p_min) is null;
begin
  if not v_ok_a or not v_ok_b then
    return jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', p_min);
  end if;
  drop table if exists pg_temp._wp3_sel;
  create temp table _wp3_sel on commit drop as
    select 'a'::text as grp, * from private.selection_attrs(p_cfg, p_a)
    union all select 'b', * from private.selection_attrs(p_cfg, p_b);
  foreach v_attr in array array['age_band', 'sex', 'baseline_bp', 'channel'] loop
    select coalesce(jsonb_agg(distinct c), '[]'::jsonb) into v_cats from (
      select case v_attr when 'age_band' then age_band when 'sex' then sex when 'baseline_bp' then baseline_bp else channel end as c from _wp3_sel) x;
    select coalesce(jsonb_agg(jsonb_build_object('key', c, 'n', cnt)), '[]'::jsonb) into ga from (
      select case v_attr when 'age_band' then age_band when 'sex' then sex when 'baseline_bp' then baseline_bp else channel end as c, count(*) as cnt from _wp3_sel where grp = 'a' group by 1) x;
    select coalesce(jsonb_agg(jsonb_build_object('key', c, 'n', cnt)), '[]'::jsonb) into gb from (
      select case v_attr when 'age_band' then age_band when 'sex' then sex when 'baseline_bp' then baseline_bp else channel end as c, count(*) as cnt from _wp3_sel where grp = 'b' group by 1) x;
    ra := private.suppress_groups(ga, p_min);
    rb := private.suppress_groups(gb, p_min);
    v_out := v_out || jsonb_build_object('attribute', v_attr, 'categories', coalesce((
      select jsonb_agg(jsonb_build_object('category', cat,
              'group_a', case when xa is null then jsonb_build_object('suppressed', false, 'n', 0, 'pct', 0)
                              when (xa ->> 'suppressed')::boolean then jsonb_build_object('suppressed', true, 'reason', xa ->> 'reason')
                              else jsonb_build_object('suppressed', false, 'n', (xa ->> 'n')::bigint, 'pct', round(100.0 * (xa ->> 'n')::bigint / nullif(na, 0), 1)) end,
              'group_b', case when xb is null then jsonb_build_object('suppressed', false, 'n', 0, 'pct', 0)
                              when (xb ->> 'suppressed')::boolean then jsonb_build_object('suppressed', true, 'reason', xb ->> 'reason')
                              else jsonb_build_object('suppressed', false, 'n', (xb ->> 'n')::bigint, 'pct', round(100.0 * (xb ->> 'n')::bigint / nullif(nb, 0), 1)) end) order by cat)
        from (select k.value #>> '{}' as cat,
                     (select a2 from jsonb_array_elements(ra) a2 where a2 ->> 'key' = k.value #>> '{}') as xa,
                     (select b2 from jsonb_array_elements(rb) b2 where b2 ->> 'key' = k.value #>> '{}') as xb
                from jsonb_array_elements(v_cats) k) q), '[]'::jsonb));
  end loop;
  return jsonb_build_object('suppressed', false, 'group_a_total', na, 'group_b_total', nb, 'attributes', v_out);
end $$;
revoke all on function private.selection_compare(jsonb, uuid[], uuid[], integer) from public, anon, authenticated;

-- Intent-to-treat beside completers for the people in a programme's figures, at one due day.
--   everyone who joined (anchor in range, in the figures) = ITT population.
--   due: the day-D snapshot exists. measured: controlled or uncontrolled. missing: no usable reading, split into "membership ended" and "still a Member".
create function private.selection_itt(p_members uuid[], p_day integer, p_from date, p_to date, p_min integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_enrolled bigint; a record; v_ended bigint; v_active bigint; v_cohort jsonb; v_groups jsonb; v_miss jsonb := '[]'::jsonb; x jsonb;
begin
  select count(*) into v_enrolled from public.profiles p cross join lateral (select private.outcome_anchor(p.id) as anchor) q
   where p.id = any (p_members) and q.anchor is not null and (p_from is null or q.anchor >= p_from) and (p_to is null or q.anchor <= p_to);
  select count(*) as n, count(*) filter (where k.s_due = 'controlled') as ctrl, count(*) filter (where k.s_due = 'uncontrolled') as unc, count(*) filter (where k.s_due = 'insufficient_data') as ins,
         count(*) filter (where k.s_due = 'insufficient_data' and not exists (select 1 from public.patient_memberships m where m.patient_id = k.patient_id and m.state = 'active')
                                and exists (select 1 from public.patient_memberships m2 where m2.patient_id = k.patient_id)) as ended
    into a from private.v_bp_cohort_day k where k.day = p_day and k.patient_id = any (p_members) and (p_from is null or k.anchor >= p_from) and (p_to is null or k.anchor <= p_to);
  v_ended := a.ended; v_active := a.ins - a.ended;
  v_cohort := private.outcome_cohort_json(a.n::integer, a.ctrl::integer, a.unc::integer, a.ins::integer, p_min);
  if private.suppress_cell(a.n, null, p_min) is not null then
    return jsonb_build_object('day', p_day, 'suppressed', true, 'reason', 'under_minimum', 'minimum', p_min);
  end if;
  v_groups := private.suppress_groups(jsonb_build_array(
      jsonb_build_object('key', 'membership_ended', 'n', v_ended), jsonb_build_object('key', 'still_a_member_no_reading', 'n', v_active)), p_min);
  for x in select * from jsonb_array_elements(v_groups) loop
    v_miss := v_miss || case when (x ->> 'suppressed')::boolean and (x ->> 'n')::bigint > 0 then jsonb_build_object('key', x ->> 'key', 'suppressed', true, 'reason', x ->> 'reason')
                             when (x ->> 'n')::bigint = 0 then jsonb_build_object('key', x ->> 'key', 'suppressed', false, 'n', 0)
                             else jsonb_build_object('key', x ->> 'key', 'suppressed', false, 'n', (x ->> 'n')::bigint) end;
  end loop;
  return jsonb_build_object(
    'day', p_day, 'suppressed', false,
    'everyone_who_joined', case when private.suppress_cell(v_enrolled, null, p_min) is null then jsonb_build_object('suppressed', false, 'n', v_enrolled) else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', p_min) end,
    'day_not_due_yet', case when private.suppress_cell(v_enrolled, null, p_min) is null and not private.suppress_difference(v_enrolled, a.n, p_min) then jsonb_build_object('suppressed', false, 'n', v_enrolled - a.n)
                            else jsonb_build_object('suppressed', true, 'reason', 'small_difference', 'minimum', p_min) end,
    'intent_to_treat', v_cohort,
    'completers_only', jsonb_build_object('note', 'People with enough readings at the day. The rate among them leaves out everyone who stopped logging.',
        'rate_pct', v_cohort -> 'rate_among_measured_pct'),
    'missing_split', v_miss);
end $$;
revoke all on function private.selection_itt(uuid[], integer, date, date, integer) from public, anon, authenticated;

-- The panel for one programme. p_internal = true is the admin / CMO view (also compares with members who joined but did not agree to
-- share); false is the sponsor-pack view, which never shows an attribute of a person who declined.
create function private.selection_panel_build(p_cohort uuid, p_from date, p_to date, p_internal boolean, p_min integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.cascade_config();
  c public.sponsor_cohorts%rowtype; v_min integer; v_agreed uuid[]; v_a uuid[]; v_b uuid[]; v_c uuid[]; v_joined uuid[];
  v_age integer; v_joined_n integer; v_org_floor integer; d integer; v_itt jsonb := '{}'::jsonb; v_cmp jsonb := '{}'::jsonb;
begin
  if v_cfg is null then return jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature'); end if;
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  select min_cohort_size into v_org_floor from public.organisations where id = c.sponsor_org_id;
  v_min := coalesce(p_min, private.min_cell_floor(v_org_floor));
  v_age := (v_cfg ->> 'min_adult_age_years')::integer;
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  v_agreed := private.sponsor_agreed_members(p_cohort);
  -- adults with a joining date in range, not pregnant (the same scope as the cascade)
  select coalesce(array_agg(x.pid), '{}') into v_a from (select p.id as pid from public.profiles p cross join lateral (select private.outcome_anchor(p.id) as anchor) q
     where p.id = any (v_agreed) and q.anchor is not null and p.date_of_birth is not null and p.date_of_birth <= (q.anchor - make_interval(years => v_age))::date
       and (p_from is null or q.anchor >= p_from) and (p_to is null or q.anchor <= p_to) and not (coalesce((v_cfg ->> 'exclude_pregnant')::boolean, false) and exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p.id and pp.is_pregnant))) x;
  select coalesce(array_agg(pc.patient_id), '{}') into v_joined from public.profile_cohorts pc join public.profiles p on p.id = pc.patient_id
   where pc.cohort_id = p_cohort and pc.left_at is null and not pc.is_test and not coalesce(p.is_test, false) and p.is_active;
  v_joined_n := cardinality(v_joined);
  -- joined but not in the figures (internal only)
  select coalesce(array_agg(x.pid), '{}') into v_b from (select p.id as pid from public.profiles p cross join lateral (select private.outcome_anchor(p.id) as anchor) q
     where p.id = any (v_joined) and not (p.id = any (v_agreed)) and q.anchor is not null and p.date_of_birth is not null and p.date_of_birth <= (q.anchor - make_interval(years => v_age))::date
       and (p_from is null or q.anchor >= p_from) and (p_to is null or q.anchor <= p_to) and not (coalesce((v_cfg ->> 'exclude_pregnant')::boolean, false) and exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p.id and pp.is_pregnant))) x;
  -- other adult Members who are not in this programme at all
  select coalesce(array_agg(x.pid), '{}') into v_c from (select p.id as pid from public.profiles p cross join lateral (select private.outcome_anchor(p.id) as anchor) q
     where p.role = 'patient' and p.is_active and not coalesce(p.is_test, false) and not (p.id = any (v_joined)) and q.anchor is not null and p.date_of_birth is not null
       and p.date_of_birth <= (q.anchor - make_interval(years => v_age))::date and (p_from is null or q.anchor >= p_from) and (p_to is null or q.anchor <= p_to) and not (coalesce((v_cfg ->> 'exclude_pregnant')::boolean, false) and exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p.id and pp.is_pregnant))) x;

  v_cmp := jsonb_build_object('in_figures_vs_other_members',
      jsonb_build_object('group_a_is', 'Members of this programme who agreed to share group figures', 'group_b_is', 'other adult Members who are not in this programme',
                         'result', private.selection_compare(v_cfg, v_a, v_c, v_min)));
  if p_internal then
    v_cmp := v_cmp || jsonb_build_object('in_figures_vs_joined_not_agreed',
      jsonb_build_object('group_a_is', 'Members of this programme who agreed to share group figures', 'group_b_is', 'Members of this programme who joined but did not agree',
                         'result', private.selection_compare(v_cfg, v_a, v_b, v_min), 'audience', 'internal only, never in a sponsor pack'));
  else
    v_cmp := v_cmp || jsonb_build_object('in_figures_vs_joined_not_agreed',
      jsonb_build_object('withheld', true, 'reason', 'not_shown_to_sponsors'));
  end if;

  foreach d in array array[90, 180] loop
    v_itt := v_itt || jsonb_build_object('day_' || d, private.selection_itt(v_a, d, p_from, p_to, v_min));
  end loop;

  return jsonb_build_object(
    'config_version', (v_cfg ->> '_version')::integer, 'minimum_cell', v_min,
    'audience', case when p_internal then 'internal' else 'sponsor' end,
    'who_is_in_the_figures', case when private.suppress_cell(cardinality(v_a), null, v_min) is null
        then jsonb_build_object('suppressed', false, 'in_figures', cardinality(v_a)) else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'eligible_roster', jsonb_build_object('available', false, 'reason', v_cfg #>> '{selection_panel,eligible_roster_reason}'),
    'seats', case when private.suppress_cell(v_joined_n, null, v_min) is null
        then jsonb_build_object('suppressed', false, 'seats_offered', c.max_uses, 'members_joined', v_joined_n, 'take_up_pct_of_seats', round(100.0 * v_joined_n / nullif(c.max_uses, 0), 1),
                                'note', 'Seats are codes handed out, not a count of the people who were eligible.')
        else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'comparisons', v_cmp,
    'intent_to_treat_and_completers', v_itt,
    'note', v_cfg #>> '{selection_panel,note}',
    'comparison_group', 'none',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.selection_panel_build(uuid, date, date, boolean, integer) from public, anon, authenticated;

create function public.selection_panel_report(p_cohort uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'outcomes_not_authorised' using errcode = '42501'; end if;
  v_r := private.selection_panel_build(p_cohort, p_from, p_to, true);
  perform private.log_audit('outcomes.selection_panel', 'sponsor_cohort', p_cohort, jsonb_build_object('from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.selection_panel_report(uuid, date, date) from public, anon;
grant execute on function public.selection_panel_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The sponsor pilot / renewal pack carries both (replaces the S75c body; everything else in it is unchanged)
-- ---------------------------------------------------------------------------
create or replace function private.sponsor_pack_build(p_cohort uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.sponsor_cohorts%rowtype; v_members uuid[]; v_fig jsonb; v_meas jsonb := '{}'::jsonb; m text; v_signed boolean := private.outcome_measures_signed();
  v_min integer; v_doc jsonb; v_hits text[]; d integer; v_by jsonb; v_pack jsonb; v_casc jsonb; v_small boolean;
begin
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  v_members := private.sponsor_agreed_members(p_cohort);
  v_fig := private.sponsor_report_aggregate(p_cohort, p_from, p_to);
  v_min := (v_fig ->> 'minimum_cell')::integer;
  v_small := private.suppress_cell(cardinality(v_members), null, v_min) is not null;
  -- All four measures. PHQ-9 and GAD-7 reach a sponsor ONLY as suppressed group figures, through private.outcome_measure_cohort (CMO decision 2026-10-14, S75-7): never a person,
  -- never below the minimum cohort size.
  foreach m in array array['hba1c', 'weight', 'phq9', 'gad7'] loop
    if not v_signed then
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature'));
    elsif v_small then
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min));
    else
      v_by := '{}'::jsonb;
      foreach d in array array[90, 180] loop v_by := v_by || jsonb_build_object(d::text, private.outcome_measure_cohort(m, d, p_from, p_to, v_members)); end loop;
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('withheld', false, 'by_day', v_by));
    end if;
  end loop;
  -- WP3: the cascade of care (members who agreed to share only) and the selection-bias panel (sponsor audience).
  v_casc := case when v_small then jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min)
                 else jsonb_build_object('hypertension', private.cascade_aggregate('hypertension', v_members, p_from, p_to, v_min),
                                         'diabetes', private.cascade_aggregate('diabetes', v_members, p_from, p_to, v_min)) end;
  v_pack := jsonb_build_object(
    'cover', jsonb_build_object('programme', c.name, 'sponsor', v_fig #>> '{cohort,sponsor}', 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                                'range', jsonb_build_object('from', p_from, 'to', p_to), 'generated_at', now()),
    'evaluation_design', private.outcome_measure_rule('{pack,evaluation_design}') #>> '{}',
    'caveat', private.outcome_measure_rule('{pack,caveat}') #>> '{}',
    'group_figures', v_fig,
    'retention_and_engagement', case when not v_small then private.retention_aggregate(p_from, p_to, v_members)
                                     else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'clinical_measures', v_meas,
    'cascade_of_care', v_casc,
    'selection_panel', case when v_small then jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min)
                            else private.selection_panel_build(p_cohort, p_from, p_to, false, v_min) end,
    'not_a_causal_claim', true);
  v_hits := private.causal_wording_hits(private.json_text(v_pack));
  if cardinality(v_hits) > 0 then return jsonb_build_object('ok', false, 'reason', 'causal_wording', 'hits', to_jsonb(v_hits)); end if;
  return jsonb_build_object('ok', true, 'pack', v_pack, 'wording_check', jsonb_build_object('passed', true));
end $$;
revoke all on function private.sponsor_pack_build(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.cascade_of_care_report(text,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.selection_panel_report(uuid,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_outcome_cascade_config(integer)', 'EXECUTE') then
    raise exception 'WP3: anon can run a cascade report';
  end if;
  if has_table_privilege('anon', 'public.outcome_cascade_config', 'SELECT') or has_table_privilege('authenticated', 'public.outcome_cascade_config', 'INSERT,UPDATE,DELETE') then
    raise exception 'WP3: outcome_cascade_config is reachable';
  end if;
  if exists (select 1 from public.outcome_cascade_config where is_active or approved_at is not null) then
    raise exception 'WP3: a cascade config is signed or active by a migration';
  end if;
end $$;
