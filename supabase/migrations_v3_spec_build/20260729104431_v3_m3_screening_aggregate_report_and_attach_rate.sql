-- M3: screening-event aggregate report + 30-day attach-rate instrumentation (build spec v3 §8).
--
-- Two interpretation notes, ported from the parallel tarragon-control build of this same spec:
-- 1. Prevalence bands read from triage_classifications -- correct for whatever classification
--    data exists; will legitimately return empty/needs_review-only bands until M5's real engine
--    ships (a data-availability fact, not a bug -- Phase 2 §0's own "instrument first, analyse
--    later").
-- 2. "Previously undiagnosed count" has no defined meaning anywhere in Phase 1 -- read here as:
--    the participant had no enrolments row started before this screening event's held_on date,
--    i.e. they were not already an active Tarragon patient walking into this event. Closest
--    available proxy, flagged for confirmation, not asserted as authoritative.
create or replace function public.screening_event_aggregate_report(p_screening_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org_id uuid;
  v_min_cohort_size int;
  v_denominator int;
  v_held_on date;
  v_result jsonb;
begin
  if private.actor_role() not in ('clinician','coordinator','ops_admin','superadmin') then
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

revoke execute on function public.screening_event_aggregate_report from public;
grant execute on function public.screening_event_aggregate_report to authenticated, service_role;

-- Attach-rate instrumentation (§8: "the primary go-to-market metric"). If a patient attended more
-- than one screening event before eventually enrolling, only their MOST RECENT still-unconverted
-- screening_participants row is stamped -- crediting every event they ever attended would inflate
-- attach rate for all of them. Not specified in the spec; a defensible, documented tie-break.
create or replace function private.stamp_screening_conversion_on_enrolment_active() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_participant_id uuid;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select sp.id into v_participant_id
  from screening_participants sp
  join screening_events se on se.id = sp.screening_event_id
  where sp.patient_id = new.patient_id
    and sp.converted_to_enrolment_id is null
  order by se.held_on desc
  limit 1;

  if v_participant_id is not null then
    update screening_participants
    set converted_to_enrolment_id = new.id, converted_at = now()
    where id = v_participant_id;
  end if;

  return new;
end;
$$;

create trigger stamp_screening_conversion_trigger
  after insert or update of status on enrolments
  for each row execute function private.stamp_screening_conversion_on_enrolment_active();

create or replace function public.screening_event_attach_rate(p_screening_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_held_on date;
  v_total int;
  v_converted_30d int;
begin
  if private.actor_role() not in ('clinician','coordinator','ops_admin','superadmin') then
    raise exception 'Only internal staff may read screening-event attach rate.'
      using errcode = '42501';
  end if;

  select held_on into v_held_on from screening_events where id = p_screening_event_id;
  if v_held_on is null then
    raise exception 'No such screening_events row: %', p_screening_event_id;
  end if;

  select count(*) into v_total
  from screening_participants where screening_event_id = p_screening_event_id;

  select count(*) into v_converted_30d
  from screening_participants
  where screening_event_id = p_screening_event_id
    and converted_at is not null
    and converted_at::date <= v_held_on + interval '30 days';

  return jsonb_build_object(
    'screening_event_id', p_screening_event_id,
    'total_participants', v_total,
    'converted_within_30_days', v_converted_30d,
    'attach_rate', case when v_total = 0 then 0 else round(v_converted_30d::numeric / v_total, 4) end
  );
end;
$$;

revoke execute on function public.screening_event_attach_rate from public;
grant execute on function public.screening_event_attach_rate to authenticated, service_role;
