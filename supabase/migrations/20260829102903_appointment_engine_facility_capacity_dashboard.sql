-- Tarragon Health — Appointment Engine, Phase 7 (facility capacity "today" dashboard)
--
-- 69.12 wants exactly this shape: today's available slots / booked /
-- cancelled / no-show for a facility. analytics_appointment_capacity()
-- (20260828001916) already covers a 90-day/upcoming rollup by
-- appointment_type across the whole org, gated to private.is_analyst() —
-- deliberately not reused here: 69.12's dashboard is a single facility's
-- *today*, meant for that facility's own front-desk/ops staff, not an
-- org-wide analyst console. Gated to private.is_org_staff() instead, scoped
-- to the caller's own organisation's appointments at that facility (facilities
-- itself carries no organisation_id — it's a shared directory — so the
-- multi-tenant boundary has to be enforced on the appointments side, same
-- reasoning get_facility_queue_today() already applies).
--
-- "Available slots" sums get_available_appointment_slots() over every
-- appointment_type this facility actually has a published rule for today,
-- rather than duplicating that function's netting-out-time-off-and-bookings
-- logic a second time.

create or replace function public.analytics_facility_capacity_today(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_day_start timestamptz := date_trunc('day', now());
  v_day_end timestamptz := v_day_start + interval '1 day';
  v_available integer := 0;
  v_type_count integer;
  v_type public.appointment_type;
  v_booked integer;
  v_cancelled integer;
  v_no_show integer;
  v_checked_in integer;
  v_called integer;
  v_completed integer;
begin
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  if v_org is null or not private.is_org_staff(v_org) then
    return '{}'::jsonb;
  end if;

  for v_type in
    select distinct t
    from public.provider_availability_rules r, unnest(r.appointment_types) as t
    where r.facility_id = p_facility_id and r.organisation_id = v_org and r.is_active
  loop
    select count(*) into v_type_count
    from public.get_available_appointment_slots(v_org, v_type, null, null, current_date, current_date, p_facility_id);
    v_available := v_available + coalesce(v_type_count, 0);
  end loop;

  select count(*) into v_booked
  from public.appointments
  where facility_id = p_facility_id and organisation_id = v_org
    and scheduled_for >= v_day_start and scheduled_for < v_day_end
    and status in ('booked', 'confirmed', 'checked_in', 'called', 'in_progress', 'completed');

  select count(*) into v_cancelled
  from public.appointments
  where facility_id = p_facility_id and organisation_id = v_org
    and scheduled_for >= v_day_start and scheduled_for < v_day_end
    and status in ('cancelled', 'patient_cancelled', 'provider_cancelled');

  select count(*) into v_no_show
  from public.appointments
  where facility_id = p_facility_id and organisation_id = v_org
    and scheduled_for >= v_day_start and scheduled_for < v_day_end
    and status = 'no_show';

  select count(*) into v_checked_in
  from public.appointments
  where facility_id = p_facility_id and organisation_id = v_org
    and scheduled_for >= v_day_start and scheduled_for < v_day_end
    and status = 'checked_in';

  select count(*) into v_called
  from public.appointments
  where facility_id = p_facility_id and organisation_id = v_org
    and scheduled_for >= v_day_start and scheduled_for < v_day_end
    and status = 'called';

  select count(*) into v_completed
  from public.appointments
  where facility_id = p_facility_id and organisation_id = v_org
    and scheduled_for >= v_day_start and scheduled_for < v_day_end
    and status = 'completed';

  return jsonb_build_object(
    'facility_id', p_facility_id,
    'date', current_date,
    'available_slots', v_available,
    'booked', v_booked,
    'checked_in', v_checked_in,
    'called', v_called,
    'completed', v_completed,
    'cancelled', v_cancelled,
    'no_show', v_no_show
  );
end;
$$;

comment on function public.analytics_facility_capacity_today(uuid) is
  '69.12: a facility''s own front-desk "today" snapshot — available slots, booked, checked-in, called, completed, cancelled, no-show — scoped to the caller''s organisation. Complements analytics_appointment_capacity() (org-wide, 90-day, analyst-gated) rather than duplicating it, same "two capacity pools deliberately kept separate" reasoning that function''s own comment already documents.';

revoke execute on function public.analytics_facility_capacity_today(uuid) from public, anon;
grant execute on function public.analytics_facility_capacity_today(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_facility_capacity_today(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_facility_capacity_today';
  end if;
  raise notice 'PASS: facility capacity today dashboard in place';
end $$;
