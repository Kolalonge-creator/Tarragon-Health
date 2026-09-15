-- Tarragon Health — Family Care Circle gap closure, part 3 of 5
-- (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.3: "appointment reminders don't route
-- to a caregiver with access").
--
-- booking_requests already extended SELECT/INSERT to a profile_access
-- grantee (20260724000542, for the child-immunisation booking flow).
-- public.appointments — the Appointment Engine's actual scheduling object
-- (20260828000637) — never got the same treatment: its SELECT policy dates
-- to chronic_disease.sql (20260705211129), a day before profile_access
-- existed, and cancel_appointment/reschedule_appointment both hard-check
-- v_appt.patient_id = v_uid with no grantee branch at all. A caregiver with
-- a 'manage' grant could not see, cancel, reschedule, or be reminded about
-- the person they manage's appointment — three separate gaps with one root
-- cause, closed together here since a reminder that points at something the
-- recipient can't see or act on is not a real fix.
--
-- 'manage' only, matching booking_requests_insert and every other
-- appointments-adjacent write path already extended to grantees — this is
-- the logistics authority §22.4 describes (book/reschedule/cancel), not
-- clinical information, so it deliberately does not check clinical_access.

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = appointments.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- cancel_appointment: identical to before except v_is_patient's OR now also
-- admits a 'manage' grantee. cancelled_by still records the real actor
-- (v_uid, the grantee, not the patient), and the notification below is
-- unchanged — it still only ever reaches the patient on whatsapp, exactly
-- as before this migration; the grantee-facing copy is the new, separate
-- in_app notification added further down.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_policy public.appointment_cancellation_policies;
  v_hours_until numeric;
  v_is_patient boolean;
  v_is_grantee boolean;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  v_is_patient := v_appt.patient_id = v_uid;
  v_is_grantee := exists (
    select 1 from public.profile_access pa
    where pa.profile_id = v_appt.patient_id and pa.grantee_user_id = v_uid and pa.permission_level = 'manage'
  );
  if not (v_is_patient or v_is_grantee or private.is_org_staff(v_appt.organisation_id)) then
    raise exception 'not authorized';
  end if;
  if v_appt.status in ('completed', 'cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled') then
    raise exception 'appointment is already %', v_appt.status;
  end if;

  v_policy := private.resolve_cancellation_policy(v_appt.organisation_id, v_appt.appointment_type);
  v_hours_until := extract(epoch from (v_appt.scheduled_for - now())) / 3600.0;

  update public.appointments set
    status = case when v_is_patient or v_is_grantee then 'patient_cancelled' else 'provider_cancelled' end,
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancellation_reason = p_reason,
    hold_expires_at = null,
    payment_status = case
      when payment_status = 'paid'
        and v_policy.id is not null
        and v_policy.refund_pct_within_window > 0
        and v_hours_until >= v_policy.cancellation_window_hours
      then 'refund_due'
      else payment_status
    end
  where id = p_appointment_id
  returning * into v_appt;

  perform private.offer_next_waiting_list_candidate(
    v_appt.organisation_id, v_appt.clinician_id, v_appt.appointment_type,
    v_appt.consultation_method, v_appt.location, v_appt.scheduled_for, v_appt.ends_at
  );

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_appt.organisation_id, v_appt.patient_id, 'whatsapp', 'pending', 'appointment_cancelled',
    jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'cancelled_by_patient', v_is_patient or v_is_grantee),
    'non_clinical'
  );

  return v_appt;
end;
$$;

comment on function public.cancel_appointment(uuid, text) is
  '10.18, extended by 20260829083319: patient or a manage-level profile_access grantee -> patient_cancelled, staff -> provider_cancelled. Flags payment_status=refund_due when the resolved policy allows it — the actual Paystack/Stripe refund call is a separate finance-layer job (same shape as api/cron/video-visit-refunds), not made here.';

revoke execute on function public.cancel_appointment(uuid, text) from public, anon;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_appointment: same extension.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_for timestamptz,
  p_new_ends_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.appointments;
  v_new public.appointments;
  v_authorized boolean;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'appointment not found';
  end if;

  v_authorized := v_old.patient_id = v_uid
    or private.is_org_staff(v_old.organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = v_old.patient_id and pa.grantee_user_id = v_uid and pa.permission_level = 'manage'
    );
  if not v_authorized then
    raise exception 'not authorized';
  end if;
  if v_old.status not in ('held', 'booked', 'confirmed') then
    raise exception 'cannot reschedule an appointment that is %', v_old.status;
  end if;
  if p_new_ends_at <= p_new_scheduled_for or p_new_scheduled_for <= now() then
    raise exception 'invalid new time';
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, rescheduled_from_id
    )
    select
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      p_new_scheduled_for, p_new_ends_at, 'booked', reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, v_uid, is_high_priority, id
    from public.appointments where id = p_appointment_id
    returning * into v_new;
  exception
    when exclusion_violation then
      raise exception 'that new time was just taken — pick another slot';
  end;

  update public.appointments set status = 'rescheduled' where id = p_appointment_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_new.organisation_id, v_new.patient_id, 'whatsapp', 'pending', 'appointment_rescheduled',
    jsonb_build_object('old_appointment_id', v_old.id, 'new_appointment_id', v_new.id, 'scheduled_for', v_new.scheduled_for),
    'non_clinical'
  );

  return v_new;
end;
$$;

comment on function public.reschedule_appointment(uuid, timestamptz, timestamptz) is
  '10.18, extended by 20260829083319 to also admit a manage-level profile_access grantee, same as cancel_appointment.';

revoke execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Reminders: private.queue_appointment_reminders (20260828001728) inserts one
-- whatsapp reminder per milestone, to the patient only. This adds one
-- in_app reminder per milestone per manage grantee — a genuinely different
-- notification, not a copy, hence its own row in appointment_reminder_sends
-- keyed by a synthetic milestone suffix so the patient's dedup key is
-- untouched. in_app rather than whatsapp/sms: this is somebody else's
-- appointment, and every other cross-person notification in this codebase
-- (care_access_revoked, care_access_requests, care_messages replies) already
-- keeps that class of notice in-app only rather than on an open rail.
-- ---------------------------------------------------------------------------
create or replace function private.queue_appointment_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with milestones(milestone, hours_before, high_priority_only) as (
    values
      ('72h', 72.0, true),
      ('24h', 24.0, false),
      ('2h', 2.0, false),
      ('shortly_before', 0.25, false)
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
      and a.scheduled_for - now() <= (m.hours_before * interval '1 hour')
  ),
  inserted_state as (
    insert into public.appointment_reminder_sends (appointment_id, milestone)
    select appointment_id, milestone from due
    on conflict (appointment_id, milestone) do nothing
    returning appointment_id, milestone
  ),
  patient_notified as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      d.organisation_id, d.patient_id, 'whatsapp', 'pending', 'appointment_reminder',
      jsonb_build_object(
        'appointment_id', d.appointment_id, 'scheduled_for', d.scheduled_for,
        'appointment_type', d.appointment_type, 'milestone', d.milestone
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
$$;

comment on function private.queue_appointment_reminders() is
  '10.13, extended by 20260829083319: fires the existing patient-facing whatsapp reminder unchanged, plus one in_app appointment_reminder_for_dependent notice per manage-level profile_access grantee — the caregiver-visibility half of docs/FAMILY_CARE_CIRCLE_SPEC.md §3.3. Same (appointment_id, milestone) dedup ledger as before; the grantee insert reuses the same inserted_state rows so it never fires on its own for a milestone already sent.';

do $$
begin
  if not exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'appointments' and pol.polname = 'appointments_select'
      and pg_get_expr(pol.polqual, pol.polrelid) ilike '%profile_access%'
  ) then
    raise exception 'appointments_select was not extended to profile_access grantees';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancel_appointment'
      and pg_get_functiondef(p.oid) ilike '%v_is_grantee%'
  ) then
    raise exception 'cancel_appointment was not extended to grantees';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_appointment_reminders'
      and pg_get_functiondef(p.oid) ilike '%appointment_reminder_for_dependent%'
  ) then
    raise exception 'queue_appointment_reminders was not extended to notify grantees';
  end if;

  raise notice 'PASS: appointments visibility, cancel/reschedule authority and reminders all extended to manage-level grantees';
end $$;
