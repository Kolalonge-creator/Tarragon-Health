-- Tarragon Control — M3: screening-day aggregate report
-- Source: docs/tarragon-build-spec-v3.md §8: "Aggregate report generated
-- for the organisation at event close: prevalence bands, severe range
-- count, previously undiagnosed count, suppressed below min_cohort_size."
--
-- Two interpretation notes, documented not hidden:
--
-- 1. Prevalence bands read from triage_classifications, which nothing
--    populates yet -- the classification pipeline is M5. This function is
--    correct for whatever classification data exists (M1/M2's own test
--    fixtures manually insert triage_classifications rows the same way,
--    to prove logic ahead of the producing pipeline -- Phase 2 §0's own
--    "instrument first, analyse later"). It will legitimately return empty
--    bands until M5 ships; that's a data-availability fact, not a bug.
--
-- 2. "Previously undiagnosed count" has no defined meaning anywhere in
--    Phase 1 -- there's no "diagnosis" concept in this schema outside the
--    clinical/triage pipeline. Read here as: the participant had no
--    enrolments row started before this screening event's held_on date,
--    i.e. they were not already an active Tarragon patient walking into
--    this event. This is the closest available proxy, not a defined spec
--    term -- flagged for confirmation, not asserted as authoritative.

create or replace function private.screening_event_aggregate_report(p_screening_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_min_cohort_size int;
  v_denominator int;
  v_held_on date;
  v_result jsonb;
begin
  if private.current_role() not in ('clinician', 'coordinator', 'ops_admin', 'superadmin') then
    raise exception 'Only internal staff may generate a screening-event aggregate report.'
      using errcode = '42501';
  end if;

  select organisation_id, held_on into v_org_id, v_held_on
  from screening_events where id = p_screening_event_id;

  if v_held_on is null then
    raise exception 'No such screening_events row: %', p_screening_event_id;
  end if;

  select coalesce(min_cohort_size, 15) into v_min_cohort_size
  from organisations where id = v_org_id;
  v_min_cohort_size := coalesce(v_min_cohort_size, 15);

  select count(*) into v_denominator
  from screening_participants where screening_event_id = p_screening_event_id;

  if v_denominator < v_min_cohort_size then
    return jsonb_build_object(
      'screening_event_id', p_screening_event_id,
      'denominator', v_denominator,
      'suppressed', true,
      'reason', format('denominator %s is below organisations.min_cohort_size %s (section 13 suppression)', v_denominator, v_min_cohort_size)
    );
  end if;

  with bands as (
    select tc.classification, count(distinct tc.patient_id) as n
    from triage_classifications tc
    join readings r on r.id = tc.reading_id
    where r.screening_event_id = p_screening_event_id
    group by tc.classification
  ),
  severe as (
    select count(distinct tc.patient_id) as n
    from triage_classifications tc
    join readings r on r.id = tc.reading_id
    where r.screening_event_id = p_screening_event_id
      and tc.classification in ('urgent', 'emergency')
  ),
  undiagnosed as (
    select count(*) as n
    from screening_participants sp
    where sp.screening_event_id = p_screening_event_id
      and sp.patient_id is not null
      and not exists (
        select 1 from enrolments e
        where e.patient_id = sp.patient_id
          and e.started_at < v_held_on
      )
  )
  select jsonb_build_object(
    'screening_event_id', p_screening_event_id,
    'denominator', v_denominator,
    'suppressed', false,
    'prevalence_bands', coalesce((select jsonb_object_agg(classification, n) from bands), '{}'::jsonb),
    'severe_range_count', (select n from severe),
    'previously_undiagnosed_count', (select n from undiagnosed)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function private.screening_event_aggregate_report from public, anon;
grant execute on function private.screening_event_aggregate_report to authenticated, service_role;
