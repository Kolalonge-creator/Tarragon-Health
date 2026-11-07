-- CMO Clinical Operations and Performance, slice 1 (founder decision 2026-11-07: hub + reuse, overview + patient journey first).
--
-- public.cmo_patient_journey_summary(): where every real patient stands on the care journey, for the Chief Medical Officer only.
--
-- Why a SECURITY DEFINER aggregate: since INV-12 a clinician (the CMO included) reads clinical_follow_ups and lab_result_documents
-- only for patients they are tied to, so an org-wide count read under the CMO's own RLS silently undercounts. The CMO needs the
-- population picture, not the records, so this returns COUNTS, OLDEST AGES AND MEDIANS ONLY: no patient id, name, number, result
-- or note ever leaves it. Identifiable exceptions are listed by the page under the CMO's own RLS ("patients you can open").
--
-- Gate: an active Chief Medical Officer of the caller's organisation (private.cmo_of(private.caller_org())), the same gate as
-- public.clinician_workload_dashboard. Everyone else, including administrators, ordinary clinicians, coordinators, patients and
-- anon, gets 42501. Test patients (profiles.is_test) and test follow-ups are excluded. Read-only: nothing is written.
--
-- Stage definitions (also shown on the page):
--   registered            patient account, not a test account
--   onboarded             profiles.onboarding_completed_at is set
--   coordinator           care_team_assignment.care_coordinator_id is set
--   care plan approved    a care plan in status active or completed; draft = awaiting approval
--   investigation ordered a lab order past payment (any status except pending_payment and cancelled)
--   result received       a lab order in status resulted, or a current (not replaced) result document
--   result reviewed       a current result document with reviewed_at set
--   follow-up             a clinical_follow_ups row; closed = state closed (outcome recorded, DB-enforced)
-- Medians use events completed in the last 365 days and are null when there are none.

create or replace function public.cmo_patient_journey_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_since timestamptz := now() - interval '365 days';
  v_out jsonb;
begin
  if v_uid is null or v_org is null or not private.cmo_of(v_org) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  with pts as (
    select p.id, p.created_at, p.onboarding_completed_at
      from public.profiles p
     where p.organisation_id = v_org and p.role = 'patient' and p.is_test is not true
  ),
  orders as (
    select o.patient_id, o.status, o.resulted_at,
           coalesce(o.ordered_at, o.payment_confirmed_at, o.created_at) as started_at
      from public.lab_orders o join pts on pts.id = o.patient_id
     where o.status not in ('pending_payment', 'cancelled')
  ),
  docs as (
    select d.patient_id, d.created_at, d.reviewed_at
      from public.lab_result_documents d join pts on pts.id = d.patient_id
     where d.superseded_by_document_id is null
  ),
  fus as (
    select f.patient_id, f.state, f.due_at, f.created_at, f.closed_at
      from public.clinical_follow_ups f join pts on pts.id = f.patient_id
     where f.is_test is not true
  ),
  plans as (
    select c.patient_id, c.status, c.created_at
      from public.care_plans c join pts on pts.id = c.patient_id
  ),
  coord as (
    select distinct a.patient_id from public.care_team_assignment a join pts on pts.id = a.patient_id where a.care_coordinator_id is not null
  ),
  awaiting_result as (
    select started_at from orders where status in ('payment_confirmed', 'ordered', 'sample_collected', 'sample_rejected', 'processing')
  ),
  awaiting_review as (select created_at from docs where reviewed_at is null),
  draft_plans as (
    select pl.patient_id, min(pl.created_at) as created_at from plans pl
     where pl.status = 'draft'
       and not exists (select 1 from plans x where x.patient_id = pl.patient_id and x.status in ('active', 'completed'))
     group by pl.patient_id
  ),
  open_fus as (select due_at, created_at from fus where state <> 'closed')
  select jsonb_build_object(
    'generated_at', now(),
    'stages', jsonb_build_object(
      'registered', (select count(*) from pts),
      'onboarded', (select count(*) from pts where onboarding_completed_at is not null),
      'with_coordinator', (select count(*) from coord),
      'care_plan_approved', (select count(distinct patient_id) from plans where status in ('active', 'completed')),
      'investigation_ordered', (select count(distinct patient_id) from orders),
      'result_received', (select count(distinct patient_id) from (
          select patient_id from orders where status = 'resulted' union select patient_id from docs) r),
      'result_reviewed', (select count(distinct patient_id) from docs where reviewed_at is not null),
      'follow_up_raised', (select count(distinct patient_id) from fus),
      'follow_up_all_closed', (select count(*) from (
          select patient_id from fus group by patient_id having bool_and(state = 'closed')) c)
    ),
    'awaiting', jsonb_build_object(
      'onboarding', jsonb_build_object(
          'count', (select count(*) from pts where onboarding_completed_at is null),
          'oldest_days', (select floor(extract(epoch from now() - min(created_at)) / 86400) from pts where onboarding_completed_at is null)),
      'care_plan_approval', jsonb_build_object(
          'count', (select count(*) from draft_plans),
          'oldest_days', (select floor(extract(epoch from now() - min(created_at)) / 86400) from draft_plans)),
      'investigation_result', jsonb_build_object(
          'count', (select count(*) from awaiting_result),
          'oldest_days', (select floor(extract(epoch from now() - min(started_at)) / 86400) from awaiting_result)),
      'doctor_review', jsonb_build_object(
          'count', (select count(*) from awaiting_review),
          'oldest_days', (select floor(extract(epoch from now() - min(created_at)) / 86400) from awaiting_review)),
      'follow_up_open', jsonb_build_object(
          'count', (select count(*) from open_fus),
          'oldest_days', (select floor(extract(epoch from now() - min(created_at)) / 86400) from open_fus)),
      'follow_up_overdue', jsonb_build_object(
          'count', (select count(*) from open_fus where due_at < now()),
          'oldest_days', (select floor(extract(epoch from now() - min(due_at)) / 86400) from open_fus where due_at < now())),
      'no_coordinator', jsonb_build_object(
          'count', (select count(*) from pts where not exists (select 1 from coord where coord.patient_id = pts.id)),
          'oldest_days', null)
    ),
    'median_hours', jsonb_build_object(
      'registered_to_onboarded', (select round((percentile_cont(0.5) within group (order by extract(epoch from onboarding_completed_at - created_at) / 3600.0))::numeric, 1)
          from pts where onboarding_completed_at is not null and onboarding_completed_at >= v_since),
      'ordered_to_resulted', (select round((percentile_cont(0.5) within group (order by extract(epoch from resulted_at - started_at) / 3600.0))::numeric, 1)
          from orders where resulted_at is not null and resulted_at >= v_since),
      'uploaded_to_reviewed', (select round((percentile_cont(0.5) within group (order by extract(epoch from reviewed_at - created_at) / 3600.0))::numeric, 1)
          from docs where reviewed_at is not null and reviewed_at >= v_since),
      'follow_up_raised_to_closed', (select round((percentile_cont(0.5) within group (order by extract(epoch from closed_at - created_at) / 3600.0))::numeric, 1)
          from fus where closed_at is not null and closed_at >= v_since)
    )
  ) into v_out;

  return v_out;
end;
$function$;

comment on function public.cmo_patient_journey_summary() is
  'CMO only (private.cmo_of). Org-wide patient journey counts, oldest ages and medians; no patient identity. Read-only. 2026-11-07.';

-- anon inherits EXECUTE through PUBLIC, so revoke from public (CLAUDE.md lesson), then grant to authenticated only.
revoke all on function public.cmo_patient_journey_summary() from public;
revoke all on function public.cmo_patient_journey_summary() from anon;
grant execute on function public.cmo_patient_journey_summary() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.cmo_patient_journey_summary()', 'EXECUTE') then
    raise exception 'anon can still execute public.cmo_patient_journey_summary()';
  end if;
  if not has_function_privilege('authenticated', 'public.cmo_patient_journey_summary()', 'EXECUTE') then
    raise exception 'authenticated cannot execute public.cmo_patient_journey_summary()';
  end if;
end $$;
