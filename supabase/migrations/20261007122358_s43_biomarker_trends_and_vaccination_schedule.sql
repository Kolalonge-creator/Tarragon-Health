-- S43 part 3 of 3: multi-year biomarker trends (spec 2.5) and the vaccination registry (spec 2.6).
-- Design: docs/design/S43.md. Not applied to production by the session that wrote it.
--
-- Counted first (live, read-only, 2026-10-07): vaccination_records 0 rows, vaccination_schedule_signoffs has ONE active signed row (version 1,
-- signed 2026-07-30 against the old catalogue, which lists typhoid and a single HPV dose), the daily cron vaccination-reminders-daily is live and
-- is NOT gated by that sign-off (the 2026-07-30 migration said so on purpose). The founder decided 2026-10-07: HPV two doses, typhoid not in the
-- schedule, schedule UNSIGNED, no reminders until a signed version is active.
--
-- What this does:
--   1. patient_biomarker_list() and patient_biomarker_trend(code): every released numeric result for one analyte across years, each point with the
--      laboratory's OWN reference range, the unit it was reported in (never converted, mixed units are flagged), and the care team's target when a
--      care plan names one. No "optimal" range is invented. Reads only released, non-withdrawn, non-sensitive items (INV-03, INV-04).
--   2. `immunisations`: a security_invoker view that gives vaccination_records the spec's names (batch, source, verified) without renaming a column
--      the app and eight functions already use.
--   3. vaccination_schedule_signoffs.schedule_config: the schedule as versioned data. Version 2 is inserted as an UNSIGNED draft (HPV two doses,
--      typhoid excluded, R21 as a per-state rollout). A version of 2 or higher cannot be active without a config. Nothing is signed here.
--   4. Reminders: private.queue_vaccination_reminders() is RENAMED and wrapped. The wrapper does nothing unless the active signed sign-off carries a
--      schedule_config. THIS PAUSES THE LIVE REMINDERS UNTIL THE CMO SIGNS VERSION 2 (zero patients have a vaccination record today). Recorded as OQ-S43.
--   5. immunisation.recorded on the bus for every new dose.

-- ---------------------------------------------------------------------------
-- 1. Biomarker trends
-- ---------------------------------------------------------------------------
create or replace function private.biomarker_points(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, ref_text text, flag text, source text, laboratory text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.released_at, i.value_numeric, i.unit, i.ref_low, i.ref_high,
         case when i.ref_low is not null or i.ref_high is not null then concat_ws(' to ', i.ref_low::text, i.ref_high::text) end,
         i.flag, 'lab_result'::text, null::text
    from public.lab_result_items i
    join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null
     and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
     and not i.sensitive_positive
  union all
  select l.taken_at, l.value, l.unit, l.reference_range_low, l.reference_range_high, l.reference_range_text, l.abnormal_flag::text, 'legacy_report'::text, l.laboratory
    from public.lab_analyte_readings l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null
     and l.report_status in ('final', 'corrected', 'amended')
$$;
revoke all on function private.biomarker_points(uuid, text) from public, anon, authenticated;

-- Who may read a patient's trend: the person themselves, or a caregiver the person gave the labs_results category to (explicit cast, three overloads exist).
create or replace function private.may_read_biomarkers(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and (p_patient = (select auth.uid()) or private.can_read_clinical(p_patient, 'labs_results'::public.care_access_category))
$$;
revoke all on function private.may_read_biomarkers(uuid) from public, anon, authenticated;

create or replace function public.patient_biomarker_list(p_patient uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
begin
  if not private.may_read_biomarkers(v_patient) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', c.code, 'readings', c.n, 'first_at', c.first_at, 'last_at', c.last_at,
             'latest_value', c.latest_value, 'latest_unit', c.latest_unit, 'latest_flag', c.latest_flag) order by c.last_at desc)
      from (
        select codes.code, count(*) n, min(p.taken_at) first_at, max(p.taken_at) last_at,
               (array_agg(p.value order by p.taken_at desc))[1] latest_value,
               (array_agg(p.unit order by p.taken_at desc))[1] latest_unit,
               (array_agg(p.flag order by p.taken_at desc))[1] latest_flag
          from (select i.analyte_code code from public.lab_result_items i where i.patient_id = v_patient
                union select l.code from public.lab_analyte_readings l where l.patient_id = v_patient) codes
          cross join lateral private.biomarker_points(v_patient, codes.code) p
         group by codes.code) c), '[]'::jsonb);
end;
$$;

create or replace function public.patient_biomarker_trend(p_code text, p_patient uuid default null, p_since date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_points constant integer := 500;                -- technical cap
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
  v_points jsonb;
  v_units integer;
  v_target jsonb;
begin
  if not private.may_read_biomarkers(v_patient) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_code is null or btrim(p_code) = '' or char_length(p_code) > 80 then
    raise exception 'say which result' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('taken_at', x.taken_at, 'value', x.value, 'unit', x.unit, 'ref_low', x.ref_low, 'ref_high', x.ref_high,
                   'ref_text', x.ref_text, 'flag', x.flag, 'source', x.source, 'laboratory', x.laboratory) order by x.taken_at), '[]'::jsonb),
         count(distinct nullif(lower(btrim(x.unit)), ''))
    into v_points, v_units
    from (select * from private.biomarker_points(v_patient, p_code) q
           where p_since is null or q.taken_at >= p_since::timestamptz order by q.taken_at desc limit c_max_points) x;

  -- the care team's target, only when an active care plan names this result; the label is carried so the screen cannot call it anything else
  select jsonb_build_object('min', (cp.target_ranges -> k.key ->> 'min')::numeric, 'max', (cp.target_ranges -> k.key ->> 'max')::numeric,
                            'condition', cp.condition::text, 'set_by', 'care_team')
    into v_target
    from public.care_plans cp
    cross join lateral (select key from jsonb_object_keys(coalesce(cp.target_ranges, '{}'::jsonb)) key where lower(key) = lower(p_code) limit 1) k
   where cp.patient_id = v_patient and cp.status = 'active'
   order by cp.updated_at desc limit 1;

  return jsonb_build_object('code', p_code, 'points', v_points, 'unit_mixed', coalesce(v_units, 0) > 1, 'target', v_target);
end;
$$;

revoke all on function public.patient_biomarker_list(uuid) from public, anon;
revoke all on function public.patient_biomarker_trend(text, uuid, date) from public, anon;
grant execute on function public.patient_biomarker_list(uuid) to authenticated;
grant execute on function public.patient_biomarker_trend(text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. immunisations: the spec's names over vaccination_records
-- ---------------------------------------------------------------------------
create or replace view public.immunisations with (security_invoker = true) as
select vr.id,
       vr.profile_id as patient_id,
       vc.code as vaccine_code,
       vr.dose_number,
       vr.date_administered as given_at,
       coalesce(vr.location, vr.provider) as given_where,
       vr.batch_lot_number as batch,
       case when vr.verified_by is not null then 'clinician'
            when vr.physical_certificate_path is not null then 'card_photo'
            else 'patient' end as source,
       (vr.verification_status::text = 'verified') as verified,
       vr.created_at
  from public.vaccination_records vr
  left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id;
grant select on public.immunisations to authenticated;
revoke all on public.immunisations from anon;

-- ---------------------------------------------------------------------------
-- 3. The schedule as versioned, signed data
-- ---------------------------------------------------------------------------
alter table public.vaccination_schedule_signoffs add column if not exists schedule_config jsonb;
alter table public.vaccination_schedule_signoffs drop constraint if exists vaccination_schedule_signoffs_v2_active_needs_config;
alter table public.vaccination_schedule_signoffs add constraint vaccination_schedule_signoffs_v2_active_needs_config
  check (version < 2 or not is_active or schedule_config is not null);

-- Version 2: an UNSIGNED draft (is_active false, approved_by null). The CMO reads and signs it; an agent never does.
-- The JSON between the markers is mirrored by the code registry entry immunisation.schedule and a test fails if they differ.
insert into public.vaccination_schedule_signoffs (version, notes, source_url, is_active, catalog_snapshot, schedule_config)
select 2,
       'DRAFT, UNSIGNED. Proposed from the S41-S45 CMO sign-off pack, section B. Founder decisions 2026-10-07: HPV is two doses six months apart; typhoid is not in the schedule. Items marked NV are not verified against a dated NPHCDA table; the CMO confirms or changes each before signing. Reminders stay off until this version is signed.',
       'https://www.unicef.org/nigeria/documents/nigeria-immunization-schedule',
       false,
       (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.vaccination_catalog c where c.is_active),
       -- immunisation-schedule-v2-begin
       $json$
{
  "status": "draft_unsigned",
  "country": "NG",
  "doses": [
    {"vaccine": "BCG", "catalog_code": "child_bcg", "at_weeks": [0], "evidence": "V"},
    {"vaccine": "OPV", "catalog_code": "child_opv", "at_weeks": [0, 6, 10, 14], "evidence": "V"},
    {"vaccine": "Hepatitis B birth dose", "catalog_code": "child_hep_b_birth", "at_weeks": [0], "evidence": "V", "note": "birth-dose time limit not verified"},
    {"vaccine": "Pentavalent", "catalog_code": "child_penta", "at_weeks": [6, 10, 14], "evidence": "V"},
    {"vaccine": "Pneumococcal conjugate", "catalog_code": "child_pcv", "at_weeks": [6, 10, 14], "evidence": "V"},
    {"vaccine": "Rotavirus", "catalog_code": "child_rota", "at_weeks": [6, 10, 14], "evidence": "V", "note": "three doses in the pack; the live catalogue lists two"},
    {"vaccine": "IPV", "catalog_code": "child_ipv", "at_weeks": [6, 14], "evidence": "V", "note": "two doses in the pack; the live catalogue lists one"},
    {"vaccine": "Vitamin A", "catalog_code": null, "at_weeks": [26, 52], "evidence": "V", "note": "100,000 IU at 6 months, 200,000 IU at 12 months; no catalogue entry yet"},
    {"vaccine": "Measles 1", "catalog_code": "child_measles", "at_weeks": [39], "evidence": "V"},
    {"vaccine": "Yellow fever", "catalog_code": "child_yellow_fever", "at_weeks": [39], "evidence": "V"},
    {"vaccine": "Meningitis vaccine", "catalog_code": "child_men_a", "at_weeks": [39], "evidence": "NV", "note": "product (MenAfriVac or MenFive) and routine age not verified"},
    {"vaccine": "Measles 2", "catalog_code": "child_measles", "at_weeks": [65], "evidence": "V", "note": "whether this is now MR is not verified"},
    {"vaccine": "R21 malaria", "catalog_code": null, "at_months": [5, 6, 7, 15], "evidence": "SEC", "per_state_rollout": true, "note": "phased by state since 2 Dec 2024; availability is a per-state flag, never a national rule"},
    {"vaccine": "HPV", "catalog_code": "child_hpv_girls", "age_years": {"min": 9, "max": 13}, "dose_count": 2, "dose_interval_weeks": 26, "evidence": "V", "note": "founder decision: two doses; secondary sources report single-dose policy since Oct 2023, the CMO confirms before signing"},
    {"vaccine": "Td in pregnancy", "catalog_code": null, "in_pregnancy": true, "min_doses": 2, "never_vaccinated_course_doses": 5, "evidence": "SEC", "note": "from papers, not an NPHCDA table"}
  ],
  "excluded": [
    {"code": "typhoid", "reason": "founder decision 2026-10-07: not in the schedule"}
  ]
}
$json$::jsonb -- immunisation-schedule-v2-end
where not exists (select 1 from public.vaccination_schedule_signoffs where version = 2);

-- The one question reminders and screens ask: is there a signed schedule that carries its config?
create or replace function private.vaccination_schedule_signed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.vaccination_schedule_signoffs s
                  where s.is_active and s.approved_by is not null and s.approved_at is not null and s.schedule_config is not null)
$$;
revoke all on function private.vaccination_schedule_signed() from public, anon, authenticated;

-- A readable status for the screens ("reminders start once your care team confirms the schedule"). No clinical content.
create or replace function public.vaccination_schedule_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('signed', private.vaccination_schedule_signed(),
    'version', (select s.version from public.vaccination_schedule_signoffs s where s.is_active and s.schedule_config is not null limit 1))
$$;
revoke all on function public.vaccination_schedule_status() from public, anon;
grant execute on function public.vaccination_schedule_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reminders wait for a signed schedule. Rename and wrap, so the live body is untouched and the cron command (which names the function) is too.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.queue_vaccination_reminders_when_signed()') is null then
    alter function private.queue_vaccination_reminders() rename to queue_vaccination_reminders_when_signed;
  end if;
end $$;
revoke all on function private.queue_vaccination_reminders_when_signed() from public, anon, authenticated;

create or replace function private.queue_vaccination_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.vaccination_schedule_signed() then
    return;                                                  -- no signed schedule, no reminder, no due or overdue prompt
  end if;
  perform private.queue_vaccination_reminders_when_signed();
end;
$$;
revoke all on function private.queue_vaccination_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. immunisation.recorded
-- ---------------------------------------------------------------------------
create or replace function private.emit_immunisation_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_domain_event('immunisation.recorded', new.organisation_id, jsonb_build_object('vaccination_record_id', new.id),
    'immunisation.recorded:' || new.id::text, new.profile_id, 'vaccination_record', new.id);
  return new;
end;
$$;
revoke all on function private.emit_immunisation_recorded() from public, anon, authenticated;
drop trigger if exists vaccination_records_emit_recorded on public.vaccination_records;
create trigger vaccination_records_emit_recorded after insert on public.vaccination_records
  for each row execute function private.emit_immunisation_recorded();

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.patient_biomarker_list(uuid)', 'public.patient_biomarker_trend(text, uuid, date)', 'public.vaccination_schedule_status()'] loop
    if has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') then
      raise exception 'S43 self-check: anon can execute %', v_fn;
    end if;
  end loop;
  if exists (select 1 from public.vaccination_schedule_signoffs where version = 2 and (is_active or approved_by is not null)) then
    raise exception 'S43 self-check: the version 2 schedule must be an unsigned draft';
  end if;
  if has_table_privilege('anon', 'public.immunisations', 'SELECT') then
    raise exception 'S43 self-check: anon can read immunisations';
  end if;
end $$;
