-- Tarragon Health — Appointment Engine, Phase 4 (booking lifecycle)
--
-- 10.3/10.6/10.7 hold -> booked/confirmed -> checked-in -> in progress ->
-- completed, plus cancellation (10.18), reschedule, and the waiting-list
-- offer mechanism (10.17). Every mutation is a SECURITY DEFINER RPC — the
-- same shape as book_video_consult_slot/accept_video_visit_request — so a
-- patient never needs a direct UPDATE grant on public.appointments (the
-- existing 20260705211129 RLS already restricts insert/update to staff; a
-- patient acts exclusively through these functions).
--
-- Double-booking safety here is intentionally *not* a manual `for update`
-- lock followed by a check-then-insert: it is the appointments_no_provider_
-- overlap EXCLUDE constraint from 20260828000637, caught as exclusion_
-- violation and turned into a friendly error. The lock inside each function
-- is only to make read-then-branch logic (status checks) safe against a
-- concurrent transition of the *same* row, not to prevent double-booking.

-- ---------------------------------------------------------------------------
-- 10.18 cancellation policy — mechanism only, no invented fee amounts (see
-- CLAUDE.md: never treat a specific price/fee as current business fact).
-- ---------------------------------------------------------------------------
create table public.appointment_cancellation_policies (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid references public.organisations (id) on delete cascade,
  appointment_type          public.appointment_type,
  cancellation_window_hours integer not null default 24,
  refund_pct_within_window  numeric(5, 2) not null default 100,
  refund_pct_after_window   numeric(5, 2) not null default 0,
  no_show_fee_kobo          bigint not null default 0,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint appointment_cancellation_policies_pct_range check (
    refund_pct_within_window between 0 and 100 and refund_pct_after_window between 0 and 100
  ),
  constraint appointment_cancellation_policies_window_non_negative check (cancellation_window_hours >= 0),
  constraint appointment_cancellation_policies_fee_non_negative check (no_show_fee_kobo >= 0)
);

comment on table public.appointment_cancellation_policies is
  'organisation_id null = platform default; appointment_type null = applies to every type in that scope. Resolution order in private.resolve_cancellation_policy: org+type, org-only, type-only, global default. Seeded with one conservative global default (24h window, full refund before it, none after, no no-show fee) — real fee amounts are a founder/business decision, not made here.';

-- Four partial unique indexes rather than one coalesce-expression index:
-- casting the appointment_type enum to text inside an index expression hits
-- Postgres's "functions in index expression must be marked IMMUTABLE" rule,
-- and a sentinel enum value to avoid the cast would be uglier than this.
create unique index appointment_cancellation_policies_org_type_uidx
  on public.appointment_cancellation_policies (organisation_id, appointment_type)
  where organisation_id is not null and appointment_type is not null;
create unique index appointment_cancellation_policies_org_only_uidx
  on public.appointment_cancellation_policies (organisation_id)
  where organisation_id is not null and appointment_type is null;
create unique index appointment_cancellation_policies_type_only_uidx
  on public.appointment_cancellation_policies (appointment_type)
  where organisation_id is null and appointment_type is not null;
create unique index appointment_cancellation_policies_global_uidx
  on public.appointment_cancellation_policies ((1))
  where organisation_id is null and appointment_type is null;

create trigger appointment_cancellation_policies_set_updated_at
  before update on public.appointment_cancellation_policies
  for each row execute function private.set_updated_at();

alter table public.appointment_cancellation_policies enable row level security;

create policy appointment_cancellation_policies_select on public.appointment_cancellation_policies
  for select to authenticated using (true);
create policy appointment_cancellation_policies_insert on public.appointment_cancellation_policies
  for insert to authenticated with check (private.is_admin());
create policy appointment_cancellation_policies_update on public.appointment_cancellation_policies
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy appointment_cancellation_policies_delete on public.appointment_cancellation_policies
  for delete to authenticated using (private.is_admin());

grant select on public.appointment_cancellation_policies to authenticated;
grant insert, update, delete on public.appointment_cancellation_policies to authenticated;

insert into public.appointment_cancellation_policies (organisation_id, appointment_type, cancellation_window_hours, refund_pct_within_window, refund_pct_after_window, no_show_fee_kobo)
select null, null, 24, 100, 0, 0
where not exists (
  select 1 from public.appointment_cancellation_policies where organisation_id is null and appointment_type is null
);

create or replace function private.resolve_cancellation_policy(p_org uuid, p_type public.appointment_type)
returns public.appointment_cancellation_policies
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.appointment_cancellation_policies
  where is_active
    and (organisation_id = p_org or organisation_id is null)
    and (appointment_type = p_type or appointment_type is null)
  order by (organisation_id is not null) desc, (appointment_type is not null) desc
  limit 1;
$$;

revoke all on function private.resolve_cancellation_policy(uuid, public.appointment_type) from public, anon;

-- ---------------------------------------------------------------------------
-- 10.7 hold
-- ---------------------------------------------------------------------------
create or replace function public.hold_appointment_slot(
  p_organisation_id uuid,
  p_clinician_id uuid,
  p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method,
  p_scheduled_for timestamptz,
  p_ends_at timestamptz,
  p_reason text default null,
  p_service text default null,
  p_location text default null,
  p_specialist_referral_id uuid default null,
  p_care_plan_id uuid default null,
  p_patient_id uuid default null,
  p_hold_minutes integer default 10
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
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
  if v_patient <> v_uid and not private.is_org_staff(p_organisation_id) then
    raise exception 'only staff may book on behalf of another patient';
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

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (p_hold_minutes * interval '1 minute')
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  return v_result;
end;
$$;

comment on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer) is
  '10.6/10.7: inserts a held appointment; the appointments_no_provider_overlap EXCLUDE constraint is the actual concurrency guard, this function only turns its error into a friendly one.';

revoke execute on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10.7 confirm (held -> booked/confirmed depending on payment/eligibility)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;
  if v_appt.patient_id <> v_uid and not private.is_org_staff(v_appt.organisation_id) then
    raise exception 'not authorized';
  end if;
  if v_appt.status <> 'held' then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  update public.appointments
    set status = case when payment_status in ('paid', 'not_required', 'waived') then 'confirmed' else 'booked' end,
        confirmed_at = case when payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        hold_expires_at = null
    where id = p_appointment_id
    returning * into v_appt;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_appt.organisation_id, v_appt.patient_id, 'whatsapp', 'pending', 'appointment_booking_confirmation',
    jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
    'non_clinical'
  );

  return v_appt;
end;
$$;

revoke execute on function public.confirm_appointment_booking(uuid) from public, anon;
grant execute on function public.confirm_appointment_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10.3 checked-in / in progress / completed / no-show
-- ---------------------------------------------------------------------------
create or replace function public.advance_appointment_status(
  p_appointment_id uuid,
  p_to public.appointment_status
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_valid boolean := false;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  if p_to = 'checked_in' then
    v_valid := v_appt.status in ('booked', 'confirmed')
      and (v_appt.patient_id = v_uid or private.is_org_staff(v_appt.organisation_id));
  elsif p_to = 'in_progress' then
    v_valid := v_appt.status in ('checked_in', 'confirmed') and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'completed' then
    v_valid := v_appt.status in ('in_progress', 'checked_in', 'confirmed', 'booked') and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'no_show' then
    v_valid := v_appt.status in ('booked', 'confirmed', 'checked_in') and private.is_org_staff(v_appt.organisation_id);
  else
    raise exception 'unsupported target status: %', p_to;
  end if;

  if not v_valid then
    raise exception 'cannot move appointment from % to %', v_appt.status, p_to;
  end if;

  update public.appointments set
    status = p_to,
    checked_in_at = case when p_to = 'checked_in' then now() else checked_in_at end,
    started_at = case when p_to = 'in_progress' then now() else started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    no_show_marked_at = case when p_to = 'no_show' then now() else no_show_marked_at end
  where id = p_appointment_id
  returning * into v_appt;

  return v_appt;
end;
$$;

comment on function public.advance_appointment_status(uuid, public.appointment_status) is
  '10.3 state machine: booked/confirmed -> checked_in (patient or staff) -> in_progress -> completed (staff only), or -> no_show (staff only). Cancellation/reschedule are separate functions since they have their own side effects (refund flag, waiting-list offer).';

revoke execute on function public.advance_appointment_status(uuid, public.appointment_status) from public, anon;
grant execute on function public.advance_appointment_status(uuid, public.appointment_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 10.17 waiting-list offer — sequential single-live-offer model: only one
-- candidate ever holds the freed slot at a time, so "first accepted" needs
-- no race handling beyond the hold/EXCLUDE machinery already in place.
-- ---------------------------------------------------------------------------
create or replace function private.offer_next_waiting_list_candidate(
  p_organisation_id uuid,
  p_clinician_id uuid,
  p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method,
  p_location text,
  p_scheduled_for timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.appointment_waiting_list;
  v_offer_minutes constant integer := 30;
  v_new_appointment_id uuid;
begin
  if p_scheduled_for <= now() or p_clinician_id is null then
    return;
  end if;

  select * into v_candidate
  from public.appointment_waiting_list
  where organisation_id = p_organisation_id
    and appointment_type = p_appointment_type
    and status = 'waiting'
    and (clinician_id is null or clinician_id = p_clinician_id)
    and preferred_from <= p_scheduled_for
    and preferred_until >= p_ends_at
  order by created_at
  limit 1
  for update skip locked;

  if v_candidate.id is null then
    return;
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, location, hold_expires_at
    ) values (
      p_organisation_id, v_candidate.patient_id, p_clinician_id, p_appointment_type,
      coalesce(v_candidate.consultation_method, p_consultation_method),
      p_scheduled_for, p_ends_at, 'held', p_location, now() + (v_offer_minutes * interval '1 minute')
    )
    returning id into v_new_appointment_id;
  exception
    when exclusion_violation then
      return; -- slot was taken by a direct booking in the meantime; candidate stays waiting
  end;

  update public.appointment_waiting_list
    set status = 'offered', offered_appointment_id = v_new_appointment_id,
        offer_expires_at = now() + (v_offer_minutes * interval '1 minute')
    where id = v_candidate.id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    p_organisation_id, v_candidate.patient_id, 'whatsapp', 'pending', 'appointment_waiting_list_offer',
    jsonb_build_object(
      'waiting_list_id', v_candidate.id, 'scheduled_for', p_scheduled_for,
      'offer_expires_minutes', v_offer_minutes
    ),
    'non_clinical'
  );
end;
$$;

revoke all on function private.offer_next_waiting_list_candidate(uuid, uuid, public.appointment_type, public.appointment_consultation_method, text, timestamptz, timestamptz) from public, anon;

create or replace function public.accept_waiting_list_offer(p_waiting_list_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_wl public.appointment_waiting_list;
  v_appt public.appointments;
begin
  select * into v_wl from public.appointment_waiting_list where id = p_waiting_list_id for update;
  if v_wl.id is null then
    raise exception 'waiting list entry not found';
  end if;
  if v_wl.patient_id <> v_uid then
    raise exception 'not authorized';
  end if;
  if v_wl.status <> 'offered' or v_wl.offered_appointment_id is null then
    raise exception 'no live offer on this waiting list entry';
  end if;
  if v_wl.offer_expires_at < now() then
    raise exception 'offer has expired';
  end if;

  update public.appointment_waiting_list set status = 'accepted' where id = p_waiting_list_id;

  select * into v_appt from public.confirm_appointment_booking(v_wl.offered_appointment_id);
  return v_appt;
end;
$$;

revoke execute on function public.accept_waiting_list_offer(uuid) from public, anon;
grant execute on function public.accept_waiting_list_offer(uuid) to authenticated;

create or replace function public.cancel_waiting_list_entry(p_waiting_list_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_wl public.appointment_waiting_list;
begin
  select * into v_wl from public.appointment_waiting_list where id = p_waiting_list_id for update;
  if v_wl.id is null then
    raise exception 'waiting list entry not found';
  end if;
  if v_wl.patient_id <> v_uid and not private.is_org_staff(v_wl.organisation_id) then
    raise exception 'not authorized';
  end if;

  update public.appointment_waiting_list set status = 'cancelled' where id = p_waiting_list_id;
end;
$$;

revoke execute on function public.cancel_waiting_list_entry(uuid) from public, anon;
grant execute on function public.cancel_waiting_list_entry(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10.18 cancellation
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
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  v_is_patient := v_appt.patient_id = v_uid;
  if not (v_is_patient or private.is_org_staff(v_appt.organisation_id)) then
    raise exception 'not authorized';
  end if;
  if v_appt.status in ('completed', 'cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled') then
    raise exception 'appointment is already %', v_appt.status;
  end if;

  v_policy := private.resolve_cancellation_policy(v_appt.organisation_id, v_appt.appointment_type);
  v_hours_until := extract(epoch from (v_appt.scheduled_for - now())) / 3600.0;

  update public.appointments set
    status = case when v_is_patient then 'patient_cancelled' else 'provider_cancelled' end,
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
    jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'cancelled_by_patient', v_is_patient),
    'non_clinical'
  );

  return v_appt;
end;
$$;

comment on function public.cancel_appointment(uuid, text) is
  '10.18: patient -> patient_cancelled, staff -> provider_cancelled. Flags payment_status=refund_due when the resolved policy allows it — the actual Paystack/Stripe refund call is a separate finance-layer job (same shape as api/cron/video-visit-refunds), not made here.';

revoke execute on function public.cancel_appointment(uuid, text) from public, anon;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reschedule — a new row, old row marked 'rescheduled' and kept as history
-- (never overwritten in place), matching this codebase's convention of
-- never destroying a prior clinical/scheduling record.
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
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'appointment not found';
  end if;
  if v_old.patient_id <> v_uid and not private.is_org_staff(v_old.organisation_id) then
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

revoke execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Expiry sweeps — 10.7 (unpaid/unconfirmed hold expires, slot returns to
-- availability automatically since get_available_appointment_slots only
-- excludes non-terminal statuses) and 10.17 (an unanswered waiting-list
-- offer moves on to the next candidate).
-- ---------------------------------------------------------------------------
create or replace function private.expire_stale_appointment_holds()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.appointments
    set status = 'expired', hold_expires_at = null
    where status = 'held' and hold_expires_at < now();
$$;

revoke all on function private.expire_stale_appointment_holds() from public, anon;

create or replace function private.expire_waiting_list_offers()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  update public.appointment_waiting_list
    set status = 'expired'
    where status = 'waiting' and preferred_until < now();

  for v_row in
    select wl.id as waiting_list_id, a.id as appointment_id, a.organisation_id, a.clinician_id,
           a.appointment_type, a.consultation_method, a.location, a.scheduled_for, a.ends_at
    from public.appointment_waiting_list wl
    join public.appointments a on a.id = wl.offered_appointment_id
    where wl.status = 'offered' and wl.offer_expires_at < now()
    for update of wl, a
  loop
    update public.appointment_waiting_list set status = 'expired' where id = v_row.waiting_list_id;
    update public.appointments set status = 'expired', hold_expires_at = null
      where id = v_row.appointment_id and status = 'held';

    perform private.offer_next_waiting_list_candidate(
      v_row.organisation_id, v_row.clinician_id, v_row.appointment_type,
      v_row.consultation_method, v_row.location, v_row.scheduled_for, v_row.ends_at
    );
  end loop;
end;
$$;

revoke all on function private.expire_waiting_list_offers() from public, anon;

select cron.schedule(
  'appointment-hold-expiry',
  '*/5 * * * *',
  $$select private.expire_stale_appointment_holds();$$
);

select cron.schedule(
  'appointment-waiting-list-offer-expiry',
  '*/5 * * * *',
  $$select private.expire_waiting_list_offers();$$
);

do $$
begin
  if has_function_privilege('anon', 'public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute hold_appointment_slot';
  end if;
  if has_function_privilege('anon', 'public.cancel_appointment(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute cancel_appointment';
  end if;
  if not exists (select 1 from public.appointment_cancellation_policies where organisation_id is null and appointment_type is null) then
    raise exception 'global default cancellation policy missing';
  end if;
  raise notice 'PASS: appointment booking lifecycle RPCs in place, anon denied on all of them';
end $$;
