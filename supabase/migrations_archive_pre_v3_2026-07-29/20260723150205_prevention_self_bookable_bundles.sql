-- Prevention self-service: the Annual Health Check becomes patient-bookable.
--
-- The clinician-originated-orders gate (20260715125456) deliberately limited
-- patient self-service to the single-test bundle for a currently-due
-- screening_schedule. That guardrail stays for ad hoc tests — but it also made
-- the flagship prevention product (the Annual Health Check bundle) unbuyable
-- by the very population it exists for: healthy patients with no clinician and
-- no due schedule. This adds a narrow, DATA-DRIVEN exception: bundles
-- explicitly marked self_bookable (an admin-controlled flag, not code) may be
-- booked patient_initiated without a schedule link. Only annual_health_check
-- is flagged. This is deliberately NOT the deferred patient-initiated wellness
-- testing catalogue — individual tests still require a due screening or a
-- clinician order, and abnormal results still flow the Cat 2->1 pipeline.

alter table public.panel_bundles
  add column if not exists self_bookable boolean not null default false;

comment on column public.panel_bundles.self_bookable is
  'Patient may purchase this bundle with no due screening_schedule and no clinician order — the prevention front-door products only (Annual Health Check), never the full catalogue.';

update public.panel_bundles set self_bookable = true where code = 'annual_health_check';

create or replace function private.enforce_lab_order_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.screening_schedules%rowtype;
  v_screen_type_code text;
begin
  if new.origin = 'patient_initiated' then
    if new.ordered_by is not null then
      raise exception 'patient_initiated lab_orders cannot set ordered_by' using errcode = '23514';
    end if;

    -- Prevention front-door exception: an explicitly self-bookable bundle
    -- (annual_health_check) needs no schedule and must not carry one — the
    -- due-screening path below stays the only schedule-linked route.
    if exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.self_bookable
    ) then
      if new.screening_schedule_id is not null then
        raise exception 'Self-bookable bundles are ordered without a screening_schedule link' using errcode = '23514';
      end if;
      return new;
    end if;

    if new.screening_schedule_id is null then
      raise exception 'Self-service lab orders must be linked to a due screening_schedule — ad hoc tests require a clinician order'
        using errcode = '23514';
    end if;

    select * into v_schedule
    from public.screening_schedules
    where id = new.screening_schedule_id;

    if v_schedule.id is null or v_schedule.patient_id is distinct from new.patient_id then
      raise exception 'screening_schedule_id does not belong to this patient' using errcode = '23514';
    end if;

    if v_schedule.status not in ('pending', 'overdue') or v_schedule.due_date > current_date then
      raise exception 'This screening is not currently due for self-service booking' using errcode = '23514';
    end if;

    select code into v_screen_type_code
    from public.screen_types
    where id = v_schedule.screen_type_id;

    if not exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.test_codes = array[v_screen_type_code]
    ) then
      raise exception 'panel_bundle_id must be the single-test bundle matching the due screening' using errcode = '23514';
    end if;
  else
    if new.ordered_by is null then
      raise exception 'Non-self-service lab_orders must set ordered_by to the clinician who generated the order'
        using errcode = '23514';
    end if;

    if not exists (
      select 1 from public.clinical_staff cs
      where cs.id = new.ordered_by
        and cs.organisation_id = new.organisation_id
        and cs.active
    ) then
      raise exception 'ordered_by must reference an active clinical_staff member of the same organisation' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
