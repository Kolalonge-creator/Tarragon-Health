-- Booking calendar (founder ask 2026-11-03): a Member can find a testing day near them, see when it opens and closes and how to
-- get there, and a doctor's bookable consultation hours can actually be confirmed so patients see times to pick.
--
-- 1. testing_events.directions: free text an admin writes (landmark, gate, floor). Venue information, never patient data.
--    Set through its own function, set_testing_event_directions, rather than a new overload of create_testing_event or
--    update_testing_event (CLAUDE.md: a new overload breaks existing bare-literal call sites).
-- 2. list_testing_days, my_testing_bookings and list_testing_events_for_staff also return directions and the closing time
--    (the patient only ever saw "from HH:MM"), and bookings return lga and state. Bodies are the LIVE definitions read with
--    pg_get_functiondef on 2026-11-03, with only those keys added; signatures unchanged so grants are kept.
-- 3. rota_overview.pending_blocks listed only declared ON-CALL blocks, so a doctor's declared bookable consultation hours had
--    no screen where an admin or the CMO could confirm them, and private.slot_is_open only offers confirmed hours. Live on
--    2026-11-03: 0 future bookable blocks, the only one ever made was confirmed by hand. Now both kinds are listed, each with
--    its kind and is_test so the screen can label them. confirm_availability_block already accepts any declared block.
-- Switches nothing on.

alter table public.testing_events
  add column directions text check (directions is null or char_length(directions) <= 500);

comment on column public.testing_events.directions is
  'How to find the venue (landmark, gate, floor), written by staff and shown to Members. Never patient data.';

create or replace function public.set_testing_event_directions(p_event uuid, p_directions text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare e public.testing_events%rowtype;
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into e from public.testing_events where id = p_event for update;
  if not found or e.status in ('completed', 'cancelled') then
    raise exception 'testing_event_not_found_or_not_editable' using errcode = '22023';
  end if;
  update public.testing_events set directions = nullif(btrim(p_directions), '') where id = p_event;
  perform private.log_audit('testing_event.directions_set', 'testing_events', p_event, '{}'::jsonb);
end;
$function$;

revoke all on function public.set_testing_event_directions(uuid, text) from public, anon;
grant execute on function public.set_testing_event_directions(uuid, text) to authenticated;

create or replace function public.list_testing_days(p_city text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.patient_is_member(v) then raise exception 'membership_required' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'event_date', e.event_date, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue_name', e.venue_name,
      'address', e.address, 'city', e.city, 'lga', e.lga, 'state', e.state, 'directions', e.directions,
      'seats_left', greatest(e.capacity - private.testing_seats_taken(e.id), 0),
      'full', private.testing_seats_taken(e.id) >= e.capacity,
      'my_booking_id', b.id, 'my_state', b.state) order by e.event_date, e.starts_at)
    from public.testing_events e
    left join public.testing_event_bookings b on b.event_id = e.id and b.patient_id = v and b.state in ('confirmed', 'waitlisted', 'checked_in')
    where e.kind = 'public_day' and e.status = 'open' and e.event_date >= private.lagos_today()
      and (p_city is null or lower(e.city) = lower(btrim(p_city)))
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.my_testing_bookings()
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_id', b.id, 'state', b.state, 'kind', b.kind, 'event_id', e.id, 'event_date', e.event_date, 'starts_at', e.starts_at,
    'ends_at', e.ends_at, 'venue_name', e.venue_name, 'address', e.address, 'city', e.city, 'lga', e.lga, 'state_name', e.state,
    'directions', e.directions, 'event_status', e.status,
    'waitlist_position', case when b.state = 'waitlisted' then
       (select count(*) from public.testing_event_bookings w where w.event_id = b.event_id and w.state = 'waitlisted'
          and (w.booked_at, w.id) <= (b.booked_at, b.id)) end)
    order by e.event_date desc), '[]'::jsonb)
  from public.testing_event_bookings b join public.testing_events e on e.id = b.event_id
  where b.patient_id = (select auth.uid());
$function$;

create or replace function public.list_testing_events_for_staff()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not private.can_run_testing_day() then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'event_date', e.event_date,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'directions', e.directions,
      'venue_name', e.venue_name, 'address', e.address, 'city', e.city, 'lga', e.lga, 'state', e.state, 'capacity', e.capacity,
      'lab_provider_id', e.lab_provider_id, 'employer_org_id', e.employer_org_id, 'headcount_requested', e.headcount_requested,
      'venue_approved', e.venue_approved_at is not null, 'seats_taken', private.testing_seats_taken(e.id),
      'waitlisted', (select count(*) from public.testing_event_bookings w where w.event_id = e.id and w.state = 'waitlisted'))
      order by e.event_date desc) from public.testing_events e), '[]'::jsonb);
end;
$function$;

create or replace function public.rota_overview(p_from timestamp with time zone default now(), p_to timestamp with time zone default null::timestamp with time zone)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_org uuid;
  v_to timestamptz := coalesce(p_to, p_from + make_interval(days => (private.lead_rule('rota_horizon_days') #>> '{}')::integer));
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  v_org := coalesce((select organisation_id from public.profiles where id = (select auth.uid())), (select id from public.organisations order by created_at limit 1));
  return jsonb_build_object(
    'status', public.on_call_cover_status(v_org),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
                'primary_id', r.primary_clinician_id, 'primary_name', (select full_name from public.clinical_staff where profile_id = r.primary_clinician_id),
                'backup_id', r.backup_clinician_id, 'backup_name', (select full_name from public.clinical_staff where profile_id = r.backup_clinician_id),
                'warnings', to_jsonb(r.warnings), 'override_reason', r.override_reason) order by r.starts_at)
                from public.on_call_rota r where r.organisation_id = v_org and r.cancelled_at is null and r.ends_at > p_from and r.starts_at < v_to), '[]'::jsonb),
    'pending_blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'clinician_id', b.clinician_id,
                'name', (select full_name from public.clinical_staff where profile_id = b.clinician_id), 'starts_at', b.starts_at, 'ends_at', b.ends_at,
                'kind', b.kind, 'is_test', b.is_test) order by b.starts_at)
                from public.availability_blocks b where b.organisation_id = v_org and b.kind in ('on_call', 'bookable_consultations')
                  and b.state = 'declared' and b.ends_at > now()), '[]'::jsonb),
    'swaps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rota_id', s.rota_id, 'role', s.role, 'state', s.state, 'reason', s.reason,
                'from_name', (select full_name from public.clinical_staff where profile_id = s.from_clinician),
                'to_name', (select full_name from public.clinical_staff where profile_id = s.to_clinician)) order by s.created_at)
                from public.rota_swaps s where s.organisation_id = v_org and s.state in ('requested', 'accepted')), '[]'::jsonb),
    'clinicians', coalesce((select jsonb_agg(jsonb_build_object('id', cs.profile_id, 'name', cs.full_name, 'employment_type', cs.employment_type) order by cs.full_name)
                from public.clinical_staff cs where cs.organisation_id = v_org and cs.profile_id is not null and cs.active and cs.status = 'active'
                  and private.has_competency(cs.profile_id, 'on_call') and private.clinician_is_eligible(cs.profile_id)), '[]'::jsonb));
end;
$function$;

do $$
begin
  if has_function_privilege('anon', 'public.set_testing_event_directions(uuid, text)', 'EXECUTE') then
    raise exception 'anon can execute set_testing_event_directions';
  end if;
  if not has_function_privilege('authenticated', 'public.set_testing_event_directions(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute set_testing_event_directions';
  end if;
  if position('bookable_consultations' in pg_get_functiondef('public.rota_overview(timestamptz, timestamptz)'::regprocedure)) = 0 then
    raise exception 'rota_overview still lists on-call blocks only';
  end if;
  if position('directions' in pg_get_functiondef('public.list_testing_days(text)'::regprocedure)) = 0 then
    raise exception 'list_testing_days does not return directions';
  end if;
end $$;
