-- S21 (part 4): the open consultation slots a patient can book (OQ-124), built from time clinicians have declared and the rota has
-- confirmed (availability_blocks, kind bookable_consultations, state confirmed). hold_appointment_slot (part 1) enforces the same
-- rule, so a slot listed here is a slot that can be held and nothing else can.
--
-- list_bookable_consult_slots(from, to, language, sex) returns jsonb: each open slot with the clinician's name, specialty, languages,
-- and whether the licence is current (and when it was last verified). It nets out: appointments that still hold the time (a hold past
-- its expiry does not), the clinician's leave or blocked time, a declared conflict with this patient, a clinician who is inactive or
-- whose licence ends before the slot does, a slot sooner than bookingLeadMinutes, and anything beyond bookingHorizonDays. A test
-- patient sees only test blocks and a real patient never does (INV-13). Times are timestamptz (display is Africa/Lagos).
-- Row counts at writing (production, 2026-10-06): availability_blocks 0, so there is nothing to convert and no slot is open until
-- clinicians declare time (S18 adds the screen and the confirmation step).

create function public.list_bookable_consult_slots(
  p_from timestamptz default null, p_to timestamptz default null, p_language text default null, p_sex text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  c jsonb := private.consult_policy();
  v_len integer;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;
  if v_org is null or c is null then return '[]'::jsonb; end if;
  v_len := (c ->> 'sessionMinutes')::integer;
  if v_len is null or v_len <= 0 then return '[]'::jsonb; end if;
  v_from := greatest(coalesce(p_from, now()), now() + ((c ->> 'bookingLeadMinutes')::integer * interval '1 minute'));
  v_to := least(coalesce(p_to, v_from + ((c ->> 'bookingHorizonDays')::integer * interval '1 day')),
                now() + ((c ->> 'bookingHorizonDays')::integer * interval '1 day'));
  if v_to <= v_from then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.slot_start, x.clinician_name), '[]'::jsonb) into v_out
  from (
    select cs.profile_id as clinician_id,
           cs.full_name as clinician_name,
           cs.specialty,
           cs.languages,
           (cs.license_verified_at is not null and (cs.license_expires_at is null or cs.license_expires_at > now())) as licence_current,
           cs.license_verified_at as licence_verified_at,
           s.slot_start, s.slot_start + (v_len * interval '1 minute') as slot_end
      from public.availability_blocks b
      join public.clinical_staff cs on cs.profile_id = b.clinician_id and cs.organisation_id = b.organisation_id and cs.active
      join public.profiles pr on pr.id = b.clinician_id
      cross join lateral generate_series(b.starts_at, b.ends_at - (v_len * interval '1 minute'), v_len * interval '1 minute') as s(slot_start)
     where b.organisation_id = v_org
       and b.kind = 'bookable_consultations'
       and b.state = 'confirmed'
       and b.is_test = v_test
       and s.slot_start >= v_from and s.slot_start < v_to
       and (cs.license_expires_at is null or cs.license_expires_at > s.slot_start + (v_len * interval '1 minute'))
       and (p_language is null or cs.languages @> array[p_language])
       and (p_sex is null or pr.sex::text = p_sex)
       and not exists (
             select 1 from public.appointments a
              where a.clinician_id = b.clinician_id
                and a.status in ('held', 'booked', 'confirmed', 'checked_in', 'in_progress')
                and not (a.status = 'held' and a.hold_expires_at < now())
                and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(s.slot_start, s.slot_start + (v_len * interval '1 minute'), '[)'))
       and not exists (
             select 1 from public.provider_time_off t
              where t.clinician_id = b.clinician_id
                and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(s.slot_start, s.slot_start + (v_len * interval '1 minute'), '[)'))
       and not exists (
             select 1 from public.clinician_conflicts cf
              where cf.clinician_id = b.clinician_id and cf.patient_id = v_uid and cf.status <> 'lifted')
     order by s.slot_start
     limit 200
  ) x;
  return v_out;
end;
$$;
revoke all on function public.list_bookable_consult_slots(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.list_bookable_consult_slots(timestamptz, timestamptz, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.list_bookable_consult_slots(timestamptz,timestamptz,text,text)', 'EXECUTE') then
    raise exception 'S21d: anon can list consultation slots';
  end if;
end $$;
