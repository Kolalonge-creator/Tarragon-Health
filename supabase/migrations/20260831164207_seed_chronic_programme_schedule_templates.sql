-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (seed)
--
-- Founder-confirmed schedule (2026-08-31): baseline panel week 1, recheck
-- with the SAME bundle at week 12 (ship-first default — a Clinical Director
-- can narrow the recheck bundle later via a template-row edit, no code
-- change); doctor-supported calls at weeks 4/8/12, with week 12's call
-- doubling as the programme-end review rather than a separate 4th
-- conversation. Applies identically to hypertension and diabetes.

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type, panel_bundle_code)
select cp.id, track.t, 1, 'lab_panel', bundle.code
from public.chronic_condition_programmes cp
cross join (values ('self_monitoring'::public.chronic_programme_track), ('doctor_supported')) as track(t)
join (values ('hypertension', 'hypertension_panel'), ('diabetes', 'diabetes_panel')) as bundle(programme_code, code)
  on bundle.programme_code = cp.code
where cp.code in ('hypertension', 'diabetes')
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type, panel_bundle_code)
select cp.id, track.t, 12, 'lab_panel', bundle.code
from public.chronic_condition_programmes cp
cross join (values ('self_monitoring'::public.chronic_programme_track), ('doctor_supported')) as track(t)
join (values ('hypertension', 'hypertension_panel'), ('diabetes', 'diabetes_panel')) as bundle(programme_code, code)
  on bundle.programme_code = cp.code
where cp.code in ('hypertension', 'diabetes')
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type)
select cp.id, 'self_monitoring', 12, 'programme_end_review'
from public.chronic_condition_programmes cp
where cp.code in ('hypertension', 'diabetes')
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type)
select cp.id, 'doctor_supported', wk.week_number, 'doctor_checkin'
from public.chronic_condition_programmes cp
cross join (values (4), (8), (12)) as wk(week_number)
where cp.code in ('hypertension', 'diabetes')
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

insert into public.chronic_programme_schedule_templates
  (programme_id, track, week_number, occurrence_type, notes)
select cp.id, 'doctor_supported', 12, 'programme_end_review',
  'Folded into the 3rd doctor check-in call rather than a separate 4th conversation.'
from public.chronic_condition_programmes cp
where cp.code in ('hypertension', 'diabetes')
on conflict (programme_id, track, week_number, occurrence_type) do nothing;

do $$
declare
  v_self_count integer;
  v_doctor_count integer;
begin
  select count(*) into v_self_count
  from public.chronic_programme_schedule_templates t
  join public.chronic_condition_programmes cp on cp.id = t.programme_id
  where cp.code in ('hypertension', 'diabetes') and t.track = 'self_monitoring';
  if v_self_count <> 6 then -- 2 programmes x (baseline + recheck + review)
    raise exception 'expected 6 self_monitoring template rows, got %', v_self_count;
  end if;

  select count(*) into v_doctor_count
  from public.chronic_programme_schedule_templates t
  join public.chronic_condition_programmes cp on cp.id = t.programme_id
  where cp.code in ('hypertension', 'diabetes') and t.track = 'doctor_supported';
  if v_doctor_count <> 12 then -- 2 programmes x (baseline + recheck + 3 calls + review) = 2x6
    raise exception 'expected 12 doctor_supported template rows, got %', v_doctor_count;
  end if;

  raise notice 'PASS: chronic programme schedule templates seeded for hypertension + diabetes, both tracks';
end $$;
