-- Found during a doctor-side platform audit 2026-09-17: 'mammography' is a
-- Sprint 1 screen_types row (20260705211237_prevention.sql, sex=female,
-- age 40-74, every 24 months) that was never deactivated when 'breast_imaging'
-- ("Breast Imaging (Ultrasound <40 / Mammography 40+)", sex=female, age 18+,
-- every 24 months) went live as its intended replacement
-- (20260811223330_activate_breast_imaging_deactivate_clinical_breast_exam.sql
-- deactivated clinical_breast_exam in the same pass but missed this one).
-- breast_imaging's own age-conditional name says it already covers the
-- 40+ population; 'mammography' is not in any panel_bundles.test_codes
-- (confirmed live — only breast_imaging is, in 'Comprehensive Screen'), so
-- it was never orderable as part of a screen, only ever reachable through
-- computeScreeningRecommendations (apps/web/src/app/(dashboard)/patient/
-- actions.ts), which drives screening_schedules purely off
-- screen_types.is_active. Net effect: every female patient 40-74 gets TWO
-- independent, identically-cadenced "due" items for what is clinically the
-- same mammogram — doubled reminders, doubled clinician worklist entries,
-- doubled screening-due activity-timeline rows.
--
-- Confirmed live before this migration: exactly 1 screening_schedules row
-- references 'mammography' (one QA fixture patient, status='pending') — a
-- pure structural fix, not a data migration with real patient impact.
-- Deactivating stops new duplicates (computeScreeningRecommendations only
-- reads is_active=true); the one existing pending row is cancelled below
-- rather than left to linger as a stale duplicate in that patient's queue.

update public.screen_types
  set is_active = false
where code = 'mammography';

update public.screening_schedules
  set status = 'cancelled',
      declined_reason = 'Superseded by breast_imaging (Ultrasound <40 / Mammography 40+), which already covers this age range — see 20260917222259.'
where screen_type_id = (select id from public.screen_types where code = 'mammography')
  and status in ('pending', 'booked');

do $$
begin
  if exists (select 1 from public.screen_types where code = 'mammography' and is_active) then
    raise exception 'FAIL: mammography should be is_active = false';
  end if;
  if not exists (select 1 from public.screen_types where code = 'breast_imaging' and is_active) then
    raise exception 'FAIL: breast_imaging should remain is_active = true';
  end if;
  if exists (
    select 1 from public.screening_schedules ss
    join public.screen_types st on st.id = ss.screen_type_id
    where st.code = 'mammography' and ss.status in ('pending', 'booked')
  ) then
    raise exception 'FAIL: no pending/booked mammography screening_schedules rows should remain';
  end if;
  raise notice 'PASS: mammography deactivated, breast_imaging remains the single active mammogram screen, orphaned pending row cancelled';
end $$;
