-- S64b: consultation gaps (spec 15.1, 15.3, 15.4, 15.6, 15.7 and the 7-day reminder of 15.9's neighbour, the appointment engine).
-- Design note: docs/design/S64.md. Founder/CMO decisions: Q19 (licence number and checked-on date), Q23 (dietitian, pharmacist and
-- specialist bookings priced per item), OQ-133 (cash refund of a cancelled consultation stays undecided: nothing here moves money).
--
-- 1. clinical_staff.care_role (doctor, dietitian, pharmacist). A non-doctor role can only sit on the care_coordinator tier, which never
--    receives an escalation, never prescribes and never signs, so adding a dietitian cannot put a case in a dietitian's queue.
-- 2. Two per-item products (dietitian_consult_credit, pharmacist_consult_credit), seeded INACTIVE at price 0: no price has been set (OQ-S64-1),
--    and hold_appointment_slot refuses these two types while the product is inactive or unpriced (fails closed).
-- 3. private.booking_product_code(type): one map from appointment type to product, used by hold, confirm and the terms read.
-- 4. hold_appointment_slot and confirm_appointment_booking, each the LIVE definition (read with pg_get_functiondef 2026-10-07) plus marked
--    S64 changes: the new types are paid per item, booked from declared bookable time, and need a clinician of the matching care_role.
--    private.ensure_encounter_for_appointment gets the same type list so a paid dietitian or pharmacist visit gets its room.
-- 5. list_bookable_consult_slots gains specialty and role filters and returns sex, the MDCN number and the date Tarragon last checked it
--    (null unless a credential check is on record). The old five-argument function is dropped so no overload is left (CLAUDE.md lesson).
-- 6. my_booking_terms(type): price, cancel rule and refund basis ('credit', never cash) shown before payment on every booking path.
-- 7. consultation_intakes: a MANUAL structured intake. A summary exists only after the patient presses send; the assigned clinician reads
--    it through an audited function (INV-10, INV-12). No AI is involved (INV-01, INV-11). source/source_ref is the seam for a later
--    symptom-checker summary; such a row must cite its source.
-- 8. Scribe sign-off: a draft that came from the AI scribe cannot be signed until the clinician has confirmed the allergy and medicine
--    lines. Any later edit to the note text clears that confirmation. A note without the scribe is unaffected (the no-scribe path).
-- 9. specialist_referrals.facility_id (nullable FK to facilities) with a free-text fallback, set only while the referral is unsigned.
-- 10. queue_appointment_reminders: the live definition plus a 7-day milestone, sent only for a visit booked 7 or more days ahead.
--
-- Row counts at writing (production, 2026-10-07): clinical_staff 2 (both doctors), appointments of type dietitian 0, specialist_referrals with
-- a facility 0 (column is new), so no conversion step exists.

-- ---------------------------------------------------------------------------
-- 1. care_role
-- ---------------------------------------------------------------------------
alter table public.clinical_staff
  add column care_role text not null default 'doctor' check (care_role in ('doctor', 'dietitian', 'pharmacist'));
alter table public.clinical_staff
  add constraint clinical_staff_non_doctor_role_not_clinical_tier
  check (care_role = 'doctor' or coalesce(doctor_tier::text, '') = 'care_coordinator');
comment on column public.clinical_staff.care_role is
  'S64: what this person is booked as. doctor (default), dietitian or pharmacist. A non-doctor role must sit on the care_coordinator tier so auto-assignment, prescribing and signing authority never reach it.';

-- ---------------------------------------------------------------------------
-- 2 and 3. products and the one type-to-product map
-- ---------------------------------------------------------------------------
insert into public.service_products (code, name, description, price_kobo, is_active)
select v.code, v.name, v.description, 0, false
  from (values
    ('dietitian_consult_credit', 'Dietitian Consultation', 'One remote consultation with a dietitian. Priced per visit.'),
    ('pharmacist_consult_credit', 'Pharmacist Consultation', 'One remote consultation with a pharmacist. Priced per visit.')
  ) as v(code, name, description)
 where not exists (select 1 from public.service_products sp where sp.code = v.code);

create function private.booking_product_code(p_type text) returns text
language sql immutable set search_path = ''
as $$
  select case p_type
    when 'telemedicine' then 'video_visit_credit'
    when 'result_interpretation' then 'result_interpretation_credit'
    when 'dietitian' then 'dietitian_consult_credit'
    when 'pharmacist' then 'pharmacist_consult_credit'
    else null
  end;
$$;
revoke all on function private.booking_product_code(text) from public, anon, authenticated;

-- a clinician may be booked only as what they are: doctor visits with a doctor, a dietitian visit with a dietitian, and so on
create function private.clinician_matches_booking_type(p_clinician uuid, p_type text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_type = 'dietitian' then exists (select 1 from public.clinical_staff cs where cs.profile_id = p_clinician and cs.care_role = 'dietitian')
    when p_type = 'pharmacist' then exists (select 1 from public.clinical_staff cs where cs.profile_id = p_clinician and cs.care_role = 'pharmacist')
    when p_type = 'telemedicine' then not exists (select 1 from public.clinical_staff cs where cs.profile_id = p_clinician and cs.care_role <> 'doctor')
    else true
  end;
$$;
revoke all on function private.clinician_matches_booking_type(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. hold, confirm, encounter room
-- ---------------------------------------------------------------------------
create or replace function public.hold_appointment_slot(p_organisation_id uuid, p_clinician_id uuid, p_appointment_type appointment_type, p_consultation_method appointment_consultation_method, p_scheduled_for timestamp with time zone, p_ends_at timestamp with time zone, p_reason text DEFAULT NULL::text, p_service text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_specialist_referral_id uuid DEFAULT NULL::uuid, p_care_plan_id uuid DEFAULT NULL::uuid, p_patient_id uuid DEFAULT NULL::uuid, p_hold_minutes integer DEFAULT 10)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
  v_payment_status public.appointment_payment_status;
  v_result public.appointments;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_patient := coalesce(p_patient_id, v_uid);
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is distinct from p_organisation_id then
    raise exception 'not authorized for this organisation';
  end if;
  if v_patient <> v_uid
     and not private.is_org_staff(p_organisation_id)
     and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'only staff, or someone with permission to book appointments for this person, may book on their behalf';
  end if;

  -- S37 (INV-14): consultations stay closed until the clinical_operations_enabled guard is on (a test patient with a test clinician passes).
  -- A consultation is any remote clinician appointment: the two consultation types, or any type booked with the telemedicine method.
  if (p_appointment_type in ('telemedicine', 'result_interpretation') or p_consultation_method = 'telemedicine')
     and not private.go_live_open('clinical_operations_enabled', v_patient, p_clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21 (OQ-129): a remote consultation is for adults only; fail closed when the age is unknown
  if p_consultation_method = 'telemedicine' then
    perform private.assert_adult_for_consultation(v_patient);
  end if;

  -- S64 (Q23): a dietitian or pharmacist visit is a remote consultation priced per item. It is closed while its product is inactive or
  -- unpriced, and it is booked only with a clinician of that role (and a doctor visit only with a doctor).
  if p_appointment_type in ('dietitian', 'pharmacist') then
    if p_consultation_method <> 'telemedicine' then
      raise exception 'that visit is booked as a remote consultation' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.service_products sp
                    where sp.code = private.booking_product_code(p_appointment_type::text) and sp.is_active and sp.price_kobo > 0) then
      raise exception 'that visit cannot be booked yet' using errcode = 'P0001', hint = 'product_not_priced';
    end if;
  end if;
  if p_appointment_type in ('telemedicine', 'dietitian', 'pharmacist')
     and not private.clinician_matches_booking_type(p_clinician_id, p_appointment_type::text) then
    raise exception 'that clinician is not available for this kind of visit' using errcode = 'P0001';
  end if;

  -- S21 (OQ-124): a consultation is booked only from time the clinician has declared and the rota has confirmed
  -- (S64: the same single source of open time serves the dietitian and pharmacist visits)
  if p_appointment_type in ('telemedicine', 'dietitian', 'pharmacist') and not private.slot_is_open(p_clinician_id, v_patient, p_scheduled_for, p_ends_at) then
    raise exception 'that time is not open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if p_scheduled_for <= now() then
    raise exception 'that time has passed — pick another slot';
  end if;
  if p_ends_at <= p_scheduled_for then
    raise exception 'invalid time range';
  end if;

  if p_specialist_referral_id is not null then
    select (urgency in ('urgent', 'priority')) into v_is_high_priority
    from public.specialist_referrals
    where id = p_specialist_referral_id and organisation_id = p_organisation_id;
  end if;

  v_payment_status := case p_appointment_type
    when 'telemedicine' then 'pending'
    when 'result_interpretation' then 'pending'
    when 'dietitian' then 'pending'      -- S64
    when 'pharmacist' then 'pending'     -- S64
    else 'not_required'
  end;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at,
      payment_status
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (p_hold_minutes * interval '1 minute'),
      v_payment_status
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  if v_patient <> v_uid then
    perform private.log_care_access(v_patient, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_result.id, 'stage', 'held'));
  end if;

  return v_result;
end;
$function$;

create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_product_code text;
  v_consult_context public.video_consultation_context;
  v_consult_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;
  if v_appt.patient_id <> v_uid
     and not private.is_org_staff(v_appt.organisation_id)
     and not private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not authorized';
  end if;
  if v_appt.status not in ('held', 'booked') then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.status = 'held' and v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  -- S37 (INV-14): a hold made before the guard was switched off is not confirmed, and no credit is spent
  if (v_appt.appointment_type in ('telemedicine', 'result_interpretation') or v_appt.consultation_method = 'telemedicine')
     and not private.go_live_open('clinical_operations_enabled', v_appt.patient_id, v_appt.clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21: the time must still be open at the moment the credit is spent (the clinician may have cancelled the block, or gone on leave,
  -- since the hold was made). The hold itself is kept, so nothing is spent and the patient can choose again. (S64: same for the new types.)
  if v_appt.appointment_type in ('telemedicine', 'dietitian', 'pharmacist') and not private.slot_is_open(v_appt.clinician_id, v_appt.patient_id, v_appt.scheduled_for, v_appt.ends_at, true) then
    raise exception 'that time is no longer open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if v_appt.payment_status = 'pending' then
    -- S64: the product map is private.booking_product_code (telemedicine, result_interpretation, dietitian, pharmacist)
    v_product_code := private.booking_product_code(v_appt.appointment_type::text);
    if v_product_code is not null then
      begin
        perform public.redeem_available_service_purchase(
          v_appt.patient_id, v_product_code, 'appointment', v_appt.id
        );
        v_appt.payment_status := 'paid';
      exception when others then
        if sqlerrm not like 'no available%' then
          raise;
        end if;
      end;
    end if;
  end if;

  update public.appointments
    set payment_status = v_appt.payment_status,
        status = case when v_appt.payment_status in ('paid', 'not_required', 'waived')
                      then 'confirmed'::public.appointment_status
                      else 'booked'::public.appointment_status end,
        confirmed_at = case when v_appt.payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        hold_expires_at = null
    where id = p_appointment_id
    returning * into v_appt;

  if v_appt.status = 'confirmed'
     and v_appt.video_consultation_id is null
     and v_appt.appointment_type in ('telemedicine', 'result_interpretation', 'dietitian', 'pharmacist') then
    v_consult_context := case v_appt.appointment_type
      when 'result_interpretation' then 'lab_result_consult'
      else 'general_checkin'
    end;

    insert into public.video_consultations
      (organisation_id, patient_id, context, initiated_by, status, scheduled_at)
    values
      (v_appt.organisation_id, v_appt.patient_id, v_consult_context, v_appt.patient_id, 'scheduled', v_appt.scheduled_for)
    returning id into v_consult_id;

    update public.appointments set video_consultation_id = v_consult_id where id = v_appt.id
    returning * into v_appt;
  end if;

  -- S21: the authoritative encounter and its room stub
  if v_appt.status = 'confirmed' then
    perform private.ensure_encounter_for_appointment(v_appt.id);
  end if;

  if v_appt.status = 'confirmed' then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_booking_confirmation',
      jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
      'non_clinical'
    );
  end if;

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', v_appt.status::text));
  end if;

  return v_appt;
end;
$function$;

create or replace function private.ensure_encounter_for_appointment(p_appointment uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.appointments;
  v_id uuid;
  v_test boolean;
  v_purchase uuid;
begin
  select * into a from public.appointments where id = p_appointment;
  -- only the consultation types that always had a video consultation row get a room: a free booking of another type (for example
  -- 'gp') never did, and must not gain one just because it was made with the telemedicine method
  -- (S64: the paid dietitian and pharmacist visits are consultations too)
  if a.id is null or a.consultation_method <> 'telemedicine' or a.appointment_type not in ('telemedicine', 'result_interpretation', 'dietitian', 'pharmacist') then
    return null;
  end if;
  select id into v_id from public.encounters where appointment_id = a.id;
  if v_id is not null then
    return v_id;
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = a.patient_id;
  select id into v_purchase from public.service_purchases
   where redeemed_entity_type = 'appointment' and redeemed_entity_id = a.id limit 1;
  insert into public.encounters
    (organisation_id, patient_id, clinician_id, type, scheduled_at, appointment_id, video_consultation_id,
     service_purchase_id, policy_version, is_test)
  values
    (a.organisation_id, a.patient_id, a.clinician_id, 'video', a.scheduled_for, a.id, a.video_consultation_id,
     v_purchase, private.consult_policy_version(), coalesce(v_test, false))
  returning id into v_id;
  insert into public.encounter_rooms (organisation_id, encounter_id, is_test) values (a.organisation_id, v_id, coalesce(v_test, false));
  perform private.log_encounter_event(v_id, 'room_created', null, 'system', '{}'::jsonb);
  perform private.emit_domain_event('encounter.scheduled', a.organisation_id, jsonb_build_object('encounter_id', v_id),
                                    'encounter.scheduled:' || v_id::text, a.patient_id, 'encounter', v_id);
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. list_bookable_consult_slots: specialty and role filters, sex, licence number and checked-on date
-- ---------------------------------------------------------------------------
drop function public.list_bookable_consult_slots(timestamptz, timestamptz, text, text, uuid);

create function public.list_bookable_consult_slots(
  p_from timestamptz default null, p_to timestamptz default null, p_language text default null, p_sex text default null,
  p_patient uuid default null, p_specialty text default null, p_role text default 'doctor')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
  v_org uuid;
  c jsonb := private.consult_policy();
  v_len integer;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  if p_role is null or p_role not in ('doctor', 'dietitian', 'pharmacist') then return '[]'::jsonb; end if;
  -- the slots are for the person being booked: the caller, or someone they may book for (a caregiver with permission, or staff)
  v_subject := coalesce(p_patient, v_uid);
  select organisation_id into v_org from public.profiles where id = v_subject;
  if v_org is null or c is null then return '[]'::jsonb; end if;
  if v_subject <> v_uid
     and not private.is_org_staff(v_org)
     and not private.can_act_for(v_subject, 'book_appointments'::public.caregiver_permission) then
    return '[]'::jsonb;
  end if;
  -- a per-item role is listed only while its product is active and priced, so a patient is never offered a slot that cannot be held
  if p_role <> 'doctor' and not exists (
       select 1 from public.service_products sp
        where sp.code = private.booking_product_code(p_role) and sp.is_active and sp.price_kobo > 0) then
    return '[]'::jsonb;
  end if;
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
           cs.care_role,
           pr.sex::text as sex,
           -- Q19: the registration number is shown only when a credential check is on record, with the date of that check
           case when cs.credential_verified_at is not null and cs.credential_type = 'MDCN' then cs.credential_number end as mdcn_number,
           cs.credential_verified_at as licence_checked_on,
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
       and cs.care_role = p_role
       and s.slot_start >= v_from and s.slot_start < v_to
       and (p_language is null or cs.languages @> array[p_language])
       and (p_specialty is null or lower(btrim(cs.specialty)) = lower(btrim(p_specialty)))
       and (p_sex is null or pr.sex::text = p_sex)
       -- the same rule hold and confirm apply: grid, licence, leave, conflicts, test or real, lead time and horizon
       and private.slot_is_open(b.clinician_id, v_subject, s.slot_start, s.slot_start + (v_len * interval '1 minute'))
       and not exists (
             select 1 from public.appointments a
              where a.clinician_id = b.clinician_id
                and a.status in ('held', 'booked', 'confirmed', 'checked_in', 'in_progress')
                and not (a.status = 'held' and a.hold_expires_at < now())
                and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(s.slot_start, s.slot_start + (v_len * interval '1 minute'), '[)'))
     order by s.slot_start
     limit 200
  ) x;
  return v_out;
end;
$$;
revoke all on function public.list_bookable_consult_slots(timestamptz, timestamptz, text, text, uuid, text, text) from public, anon;
grant execute on function public.list_bookable_consult_slots(timestamptz, timestamptz, text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The terms a patient sees before paying, for any bookable type
-- ---------------------------------------------------------------------------
create function public.my_booking_terms(p_appointment_type text default 'telemedicine') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code text := private.booking_product_code(p_appointment_type);
  v_price bigint;
  v_cfg jsonb := private.consult_policy();
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if v_code is null then return null; end if;
  select sp.price_kobo into v_price from public.service_products sp where sp.code = v_code and sp.is_active and sp.price_kobo > 0;
  return jsonb_build_object(
    'appointment_type', p_appointment_type,
    'price_kobo', v_price,                       -- null while the product is inactive or unpriced: the screen then says it cannot be booked yet
    'bookable', v_price is not null,
    'cancel_window_hours', (v_cfg ->> 'cancelWindowHours')::numeric,
    'late_cancel_credit_returned', (v_cfg ->> 'lateCancelCreditReturned')::boolean,
    'refund_basis', 'credit',                    -- OQ-133: a cancelled visit returns the visit credit; cash is not promised
    'min_age_years', (v_cfg ->> 'minAgeYears')::integer,
    'policy_version', private.consult_policy_version());
end;
$$;
revoke all on function public.my_booking_terms(text) from public, anon;
grant execute on function public.my_booking_terms(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Manual structured intake
-- ---------------------------------------------------------------------------
create table public.consultation_intakes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  state text not null default 'draft' check (state in ('draft', 'sent')),
  source text not null default 'manual' check (source in ('manual', 'symptom_checker')),
  source_ref uuid,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  duration text check (duration is null or duration in ('today', 'few_days', 'one_to_four_weeks', 'over_a_month', 'not_sure')),
  answers jsonb not null default '{}'::jsonb,
  summary text,
  sent_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultation_intakes_one_per_appointment unique (appointment_id),
  constraint consultation_intakes_summary_only_when_sent check ((state = 'sent') = (summary is not null and sent_at is not null)),
  constraint consultation_intakes_sent_has_reason_and_duration check (state = 'draft' or (reason is not null and duration is not null)),
  constraint consultation_intakes_seam_cites_source check (source = 'manual' or source_ref is not null)
);
create index consultation_intakes_patient_idx on public.consultation_intakes (patient_id);
comment on table public.consultation_intakes is
  'S64: a patient''s own structured pre-visit answers. The summary is written by plain code (private.build_intake_summary) only when the patient sends; no AI. The assigned clinician reads it through clinician_consultation_intake (audited).';

alter table public.consultation_intakes enable row level security;
create policy consultation_intakes_patient_read on public.consultation_intakes for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission));
grant select on public.consultation_intakes to authenticated;
revoke insert, update, delete, truncate on public.consultation_intakes from authenticated, anon;

create function private.intake_answers_valid(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) <= 5
     and not exists (
       select 1 from jsonb_each(p) e
        where e.key not in ('tried_so_far', 'medicines_now', 'allergies', 'main_worry', 'question_for_visit')
           or jsonb_typeof(e.value) <> 'string'
           or char_length(btrim(e.value #>> '{}')) not between 1 and 400);
$$;
revoke all on function private.intake_answers_valid(jsonb) from public, anon, authenticated;

create function private.build_intake_summary(p_reason text, p_duration text, p_answers jsonb) returns text
language sql immutable set search_path = ''
as $$
  select concat_ws(E'\n',
    'Reason for the visit: ' || btrim(p_reason),
    'For how long: ' || case p_duration
      when 'today' then 'since today'
      when 'few_days' then 'a few days'
      when 'one_to_four_weeks' then 'one to four weeks'
      when 'over_a_month' then 'over a month'
      else 'not sure' end,
    case when p_answers ? 'tried_so_far' then 'Tried so far: ' || btrim(p_answers ->> 'tried_so_far') end,
    case when p_answers ? 'medicines_now' then 'Medicines now: ' || btrim(p_answers ->> 'medicines_now') end,
    case when p_answers ? 'allergies' then 'Allergies: ' || btrim(p_answers ->> 'allergies') end,
    case when p_answers ? 'main_worry' then 'Main worry: ' || btrim(p_answers ->> 'main_worry') end,
    case when p_answers ? 'question_for_visit' then 'Question for the visit: ' || btrim(p_answers ->> 'question_for_visit') end);
$$;
revoke all on function private.build_intake_summary(text, text, jsonb) from public, anon, authenticated;

-- a sent intake is permanent, and the row can never be moved to another patient or visit
create function private.consultation_intakes_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- a real patient's intake is never deleted (the cascade from a profile or visit stops here too); a test account's rows can be purged (INV-13)
    if old.is_test then return old; end if;
    raise exception 'a consultation intake cannot be deleted' using errcode = '42501';
  end if;
  if old.state = 'sent' then
    raise exception 'a sent intake cannot be changed' using errcode = '42501';
  end if;
  if new.patient_id <> old.patient_id or new.appointment_id <> old.appointment_id or new.organisation_id <> old.organisation_id then
    raise exception 'an intake cannot move to another patient or visit' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.consultation_intakes_guard() from public, anon, authenticated;
create trigger consultation_intakes_guard before update or delete on public.consultation_intakes
  for each row execute function private.consultation_intakes_guard();

-- the person who may answer: the patient, or someone with permission to book for them
create function private.intake_appointment_for_writer(p_appointment uuid) returns public.appointments
language plpgsql stable security definer set search_path = ''
as $$
declare a public.appointments; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_appointment;
  if a.id is null
     or (a.patient_id <> v_uid and not private.can_act_for(a.patient_id, 'book_appointments'::public.caregiver_permission)) then
    raise exception 'not authorised for this visit' using errcode = '42501';
  end if;
  if a.status not in ('booked', 'confirmed', 'checked_in') or a.ends_at <= now() then
    raise exception 'this visit is not open for an intake' using errcode = 'P0001';
  end if;
  return a;
end $$;
revoke all on function private.intake_appointment_for_writer(uuid) from public, anon, authenticated;

create function public.save_consultation_intake_draft(p_appointment uuid, p_reason text, p_duration text, p_answers jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a public.appointments;
  v_id uuid;
  v_test boolean;
begin
  a := private.intake_appointment_for_writer(p_appointment);
  if not private.intake_answers_valid(coalesce(p_answers, '{}'::jsonb)) then
    raise exception 'the answers are not in the expected shape' using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = a.patient_id;
  insert into public.consultation_intakes (organisation_id, patient_id, appointment_id, reason, duration, answers, is_test)
  values (a.organisation_id, a.patient_id, a.id, nullif(btrim(p_reason), ''), p_duration, coalesce(p_answers, '{}'::jsonb), v_test)
  on conflict (appointment_id) do update
     set reason = excluded.reason, duration = excluded.duration, answers = excluded.answers
   where public.consultation_intakes.state = 'draft'
  returning id into v_id;
  if v_id is null then
    raise exception 'this intake was already sent' using errcode = 'P0001';
  end if;
  return v_id;
end $$;
revoke all on function public.save_consultation_intake_draft(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_consultation_intake_draft(uuid, text, text, jsonb) to authenticated;

-- Pressing send is the only thing that writes the summary
create function public.send_consultation_intake(p_appointment uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  a public.appointments;
  i public.consultation_intakes;
  v_summary text;
begin
  a := private.intake_appointment_for_writer(p_appointment);
  select * into i from public.consultation_intakes where appointment_id = a.id for update;
  if i.id is null then raise exception 'save your answers first' using errcode = 'P0001'; end if;
  if i.state = 'sent' then raise exception 'this intake was already sent' using errcode = 'P0001'; end if;
  if i.reason is null or i.duration is null then
    raise exception 'say what the visit is about and for how long before sending' using errcode = 'P0001';
  end if;
  v_summary := private.build_intake_summary(i.reason, i.duration, i.answers);
  update public.consultation_intakes set state = 'sent', summary = v_summary, sent_at = now() where id = i.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, subject_patient_id)
  values (a.organisation_id, (select auth.uid()), 'consultation_intake.sent', 'consultation_intake',
          jsonb_build_object('intake_id', i.id, 'appointment_id', a.id), a.patient_id);
  return v_summary;
end $$;
revoke all on function public.send_consultation_intake(uuid) from public, anon;
grant execute on function public.send_consultation_intake(uuid) to authenticated;

-- The assigned clinician reads a SENT intake for their own encounter, and the read is audited (INV-10, INV-12).
create function public.clinician_consultation_intake(p_encounter uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  i public.consultation_intakes;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null or e.clinician_id is distinct from v_uid
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised for this consultation' using errcode = '42501';
  end if;
  select * into i from public.consultation_intakes where appointment_id = e.appointment_id and state = 'sent';
  if i.id is null then return null; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, subject_patient_id)
  values (e.organisation_id, v_uid, 'consultation_intake.clinician_read', 'consultation_intake',
          jsonb_build_object('intake_id', i.id, 'encounter_id', e.id), e.patient_id);
  return jsonb_build_object('id', i.id, 'source', i.source, 'summary', i.summary, 'sent_at', i.sent_at);
end $$;
revoke all on function public.clinician_consultation_intake(uuid) from public, anon;
grant execute on function public.clinician_consultation_intake(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Scribe sign-off: allergy and medicine lines confirmed before an AI draft can be signed
-- ---------------------------------------------------------------------------
alter table public.clinical_encounter_notes
  add column safety_lines_reviewed_at timestamptz,
  add column safety_lines_reviewed_by uuid references public.profiles (id) on delete restrict;
comment on column public.clinical_encounter_notes.safety_lines_reviewed_at is
  'S64: when the clinician confirmed the allergy and medicine lines of an AI-scribe draft. Cleared by any later edit of the note text. Signing an ai_drafted note requires it.';

create function private.clear_scribe_safety_review_on_edit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.ai_drafted and old.status = 'draft' and new.status = 'draft'
     and new.safety_lines_reviewed_at is not distinct from old.safety_lines_reviewed_at
     and (new.reason_for_encounter, new.history, new.examination_findings, new.assessment, new.diagnosis, new.plan,
          new.follow_up_instructions, new.patient_summary)
         is distinct from
         (old.reason_for_encounter, old.history, old.examination_findings, old.assessment, old.diagnosis, old.plan,
          old.follow_up_instructions, old.patient_summary) then
    new.safety_lines_reviewed_at := null;
    new.safety_lines_reviewed_by := null;
  end if;
  return new;
end $$;
revoke all on function private.clear_scribe_safety_review_on_edit() from public, anon, authenticated;
create trigger clinical_encounter_notes_clear_safety_review before update on public.clinical_encounter_notes
  for each row execute function private.clear_scribe_safety_review_on_edit();

create function private.require_scribe_safety_review_to_sign() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'finalized' and new.ai_drafted and new.safety_lines_reviewed_at is null then
    raise exception 'Confirm the allergy and medicine lines of the AI draft before signing.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.require_scribe_safety_review_to_sign() from public, anon, authenticated;
create trigger clinical_encounter_notes_scribe_safety_gate before update on public.clinical_encounter_notes
  for each row execute function private.require_scribe_safety_review_to_sign();

create function public.confirm_scribe_safety_lines(p_note uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  n record;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_patient := private.may_work_on_note(p_note);
  select status, ai_drafted, organisation_id into n from public.clinical_encounter_notes where id = p_note;
  if n.status <> 'draft' then
    raise exception 'This encounter note is finalized and cannot be edited.' using errcode = '42501';
  end if;
  if not n.ai_drafted then
    raise exception 'This note has no AI draft to review.' using errcode = 'P0001';
  end if;
  update public.clinical_encounter_notes set safety_lines_reviewed_at = now(), safety_lines_reviewed_by = v_uid where id = p_note;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, subject_patient_id)
  values (n.organisation_id, v_uid, 'scribe.safety_lines_reviewed', 'clinical_note', jsonb_build_object('note_id', p_note), v_patient);
end $$;
revoke all on function public.confirm_scribe_safety_lines(uuid) from public, anon;
grant execute on function public.confirm_scribe_safety_lines(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Referral to a named facility
-- ---------------------------------------------------------------------------
alter table public.specialist_referrals
  add column facility_id uuid references public.facilities (id) on delete restrict,
  add column facility_name_text text check (facility_name_text is null or char_length(btrim(facility_name_text)) between 1 and 200),
  add constraint specialist_referrals_one_facility_form check (num_nonnulls(facility_id, facility_name_text) <= 1);
comment on column public.specialist_referrals.facility_id is
  'S64: the directory entry the patient is referred to. Free text (facility_name_text) is the fallback for a place not in the directory; never both.';

create function public.set_referral_facility(p_referral uuid, p_facility uuid, p_free_text text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active
                  and cs.care_role = 'doctor' and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- the same visibility rule every other referral write uses (tied clinician, the writer, the assigned specialist or the referral desk);
  -- an unknown id and a referral the caller may not see are the same refusal
  perform private.may_work_on_referral(p_referral);
  select id, organisation_id, patient_id, referred_by, signed_at into r from public.specialist_referrals where id = p_referral;
  if r.signed_at is not null then
    raise exception 'a signed referral cannot be changed' using errcode = '42501';
  end if;
  if p_facility is not null and nullif(btrim(p_free_text), '') is not null then
    raise exception 'name a directory facility or type one, not both' using errcode = '22023';
  end if;
  if p_facility is not null and not exists (select 1 from public.facilities f where f.id = p_facility and f.is_active) then
    raise exception 'that facility is not in the directory' using errcode = 'P0002';
  end if;
  update public.specialist_referrals
     set facility_id = p_facility, facility_name_text = case when p_facility is null then nullif(btrim(p_free_text), '') end
   where id = p_referral;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, subject_patient_id)
  values (r.organisation_id, v_uid, 'referral.facility_set', 'specialist_referral',
          jsonb_build_object('referral_id', p_referral, 'directory_entry', p_facility is not null), r.patient_id);
end $$;
revoke all on function public.set_referral_facility(uuid, uuid, text) from public, anon;
grant execute on function public.set_referral_facility(uuid, uuid, text) to authenticated;

create or replace view public.clinical_referrals with (security_invoker = true) as
select
  r.id,
  r.organisation_id,
  r.patient_id,
  r.specialist_type as to_facility,
  r.referral_reason as reason,
  r.status::text as state,
  r.signed_by,
  r.signed_at,
  r.referred_by,
  r.created_at,
  r.facility_id,
  r.facility_name_text
from public.specialist_referrals r;

-- ---------------------------------------------------------------------------
-- 10. Reminders: a 7-day milestone for a visit booked 7 or more days ahead
-- reminder-config-begin
-- {"milestonesHoursBefore":[168,24,2],"longLeadMilestone":"7d"}
-- reminder-config-end
-- ---------------------------------------------------------------------------
create or replace function private.queue_appointment_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with milestones(milestone, hours_before, high_priority_only, long_lead_only, min_hours_before) as (
    values
      -- S64: sent only for a visit that was booked 7 or more days ahead, and only inside an 8 hour window (160 to 168 hours before), so
      -- the first run after deploy, or after a cron outage, never sends a stale "7 days" reminder for a visit that is already close
      ('7d', 168.0, false, true, 160.0),
      ('72h', 72.0, true, false, null::numeric),
      ('24h', 24.0, false, false, null::numeric),
      ('2h', 2.0, false, false, null::numeric),
      ('shortly_before', 0.25, false, false, null::numeric)
  ),
  due as (
    select
      a.id as appointment_id,
      a.organisation_id,
      a.patient_id,
      a.appointment_type,
      a.scheduled_for,
      m.milestone
    from public.appointments a
    cross join milestones m
    where a.status in ('booked', 'confirmed')
      and a.scheduled_for > now()
      and (not m.high_priority_only or a.is_high_priority)
      and (not m.long_lead_only or a.created_at <= a.scheduled_for - (m.hours_before * interval '1 hour'))
      and a.scheduled_for - now() <= (m.hours_before * interval '1 hour')
      and (m.min_hours_before is null or a.scheduled_for - now() >= (m.min_hours_before * interval '1 hour'))
  ),
  inserted_state as (
    insert into public.appointment_reminder_sends (appointment_id, milestone)
    select appointment_id, milestone from due
    on conflict (appointment_id, milestone) do nothing
    returning appointment_id, milestone
  ),
  patient_notified as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, response_options)
    select
      d.organisation_id, d.patient_id, private.patient_reminder_channel(d.patient_id), 'pending', 'appointment_reminder',
      jsonb_build_object(
        'appointment_id', d.appointment_id, 'scheduled_for', d.scheduled_for,
        'appointment_type', d.appointment_type, 'milestone', d.milestone
      ),
      jsonb_build_array(
        jsonb_build_object('label', 'Yes, I''ll be there', 'value', 'confirm'),
        jsonb_build_object('label', 'Reschedule', 'value', 'reschedule'),
        jsonb_build_object('label', 'Cancel', 'value', 'cancel'),
        jsonb_build_object('label', 'Need help', 'value', 'need_help')
      )
    from due d
    join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
    returning 1
  ),
  grantee_due as (
    select d.*, pa.grantee_user_id
    from due d
    join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
    join public.profile_access pa
      on pa.profile_id = d.patient_id and pa.permission_level = 'manage'
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  select
    gd.organisation_id, gd.grantee_user_id, 'in_app', 'pending', 'appointment_reminder_for_dependent',
    jsonb_build_object(
      'appointment_id', gd.appointment_id, 'scheduled_for', gd.scheduled_for,
      'appointment_type', gd.appointment_type, 'milestone', gd.milestone, 'patient_id', gd.patient_id
    ),
    'non_clinical'
  from grantee_due gd;
$function$;

-- ---------------------------------------------------------------------------
-- Assertions: "built" is provable
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.list_bookable_consult_slots(timestamptz,timestamptz,text,text,uuid,text,text)',
    'public.my_booking_terms(text)',
    'public.save_consultation_intake_draft(uuid,text,text,jsonb)',
    'public.send_consultation_intake(uuid)',
    'public.clinician_consultation_intake(uuid)',
    'public.confirm_scribe_safety_lines(uuid)',
    'public.set_referral_facility(uuid,uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S64: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S64: authenticated cannot execute %', v_fn; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'list_bookable_consult_slots') <> 1 then
    raise exception 'S64: list_bookable_consult_slots must have exactly one overload';
  end if;
  if has_table_privilege('authenticated', 'public.consultation_intakes', 'INSERT')
     or has_table_privilege('authenticated', 'public.consultation_intakes', 'UPDATE')
     or has_table_privilege('anon', 'public.consultation_intakes', 'SELECT') then
    raise exception 'S64: consultation_intakes grants are wrong';
  end if;
  if exists (select 1 from public.service_products where code in ('dietitian_consult_credit', 'pharmacist_consult_credit') and (is_active or price_kobo <> 0)) then
    raise exception 'S64: the per-item products must start inactive and unpriced';
  end if;
end $$;
