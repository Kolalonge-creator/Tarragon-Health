-- S21 (part 1): encounters, consultation rooms and events, scribe consent, consultation policy, adult-only booking,
-- policy-driven cancellation that returns the consultation credit, no-show handling, NGN 10,000 price.
--
-- Founder decisions OQ-124 to OQ-131 (2026-10-06). Design: docs/design/S21.md. Research: docs/research/S21.md.
--
--   1. consultation_policy_config: versioned PROPOSED values (mirrored in packages/shared as consultations.policy).
--      Every encounter records the version it used (INV-16).
--   2. encounters (authoritative, OQ-125), encounter_rooms (no join or host URL is ever stored; recording is
--      asserted off), encounter_events (append only), scribe_consents (OQ-38). Written only through the
--      functions below; authenticated can only read, through RLS.
--   3. Consultations are for adults only (OQ-129): hold_appointment_slot refuses a telemedicine booking for
--      anyone under the policy age, and for a patient with no date of birth (fail closed).
--   4. confirm_appointment_booking creates the encounter and room stub. cancel_appointment follows the policy:
--      a patient cancelling the window or more before, or a clinician cancelling, gets the consultation credit
--      back (un-redeemed, no stored balance, INV-09); a late patient cancel keeps it unless config says otherwise.
--   5. report_encounter_event, complete_encounter, mark_encounter_no_show, record_scribe_consent and friends.
--   6. Four new event types (owner S21); encounter.completed already exists.
--   7. video_visit_credit is NGN 10,000 (1,000,000 kobo), replacing the 5,000 placeholder (OQ-130).
--
-- Row counts at writing (production, 2026-10-06): appointments 0, availability_blocks 0, so there is nothing to
-- convert. The two bodies replaced below (hold_appointment_slot, confirm_appointment_booking,
-- cancel_appointment) repeat the live definitions read with pg_get_functiondef on 2026-10-06 plus the changes
-- marked "S21".

-- ---------------------------------------------------------------------------
-- 1. Policy config (versioned, PROPOSED)
-- ---------------------------------------------------------------------------
create table public.consultation_policy_config (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique,
  is_active  boolean not null default false,
  config     jsonb not null check (jsonb_typeof(config) = 'object'),
  note       text,
  created_at timestamptz not null default now()
);
create unique index consultation_policy_config_one_active on public.consultation_policy_config ((true)) where is_active;
comment on table public.consultation_policy_config is
  'PROPOSED consultation rules: minAgeYears, requireDateOfBirth, cancelWindowHours, lateCancelCreditReturned, holdMinutes, reconnectGraceSeconds, clinicianNoShowWaitMinutes, patientNoShowWaitMinutes, sessionMinutes, flagWindowDays. Mirrored in packages/shared proposed-config as consultations.policy. A change is a new row (INV-16).';
alter table public.consultation_policy_config enable row level security;
create policy consultation_policy_config_read on public.consultation_policy_config
  for select to authenticated using (true);
revoke all on public.consultation_policy_config from anon, public, authenticated;
grant select on public.consultation_policy_config to authenticated;
-- policy-v1-begin
insert into public.consultation_policy_config (version, is_active, config, note) values
  (1, true,
   $json${"minAgeYears":18,"requireDateOfBirth":true,"cancelWindowHours":2,"lateCancelCreditReturned":false,"holdMinutes":10,"reconnectGraceSeconds":120,"clinicianNoShowWaitMinutes":15,"patientNoShowWaitMinutes":10,"sessionMinutes":30,"flagWindowDays":3}$json$::jsonb,
   'S21 PROPOSED: adults only, full credit back when the patient cancels 2 hours or more before, clinician cancel or no-show always returns it.');
-- policy-v1-end

create function private.consult_policy() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.consultation_policy_config where is_active; $$;
revoke all on function private.consult_policy() from public, anon;
grant execute on function private.consult_policy() to authenticated;

create function private.consult_policy_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.consultation_policy_config where is_active; $$;
revoke all on function private.consult_policy_version() from public, anon;
grant execute on function private.consult_policy_version() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Age rule (OQ-129)
-- ---------------------------------------------------------------------------
create function private.patient_age_years(p_patient uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select case when date_of_birth is null then null
              else extract(year from age(current_date, date_of_birth))::integer end
    from public.profiles where id = p_patient;
$$;
revoke all on function private.patient_age_years(uuid) from public, anon, authenticated;

create function private.assert_adult_for_consultation(p_patient uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.consult_policy();
  v_min integer := coalesce((v_cfg ->> 'minAgeYears')::integer, 18);
  v_age integer := private.patient_age_years(p_patient);
begin
  if v_age is null then
    if coalesce((v_cfg ->> 'requireDateOfBirth')::boolean, true) then
      raise exception 'add your date of birth to your profile before booking a consultation' using errcode = 'P0001';
    end if;
  elsif v_age < v_min then
    raise exception 'consultations are for people aged % and over', v_min using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.assert_adult_for_consultation(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create table public.encounters (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete restrict,
  clinician_id          uuid references public.profiles (id) on delete restrict,
  type                  text not null check (type in ('video', 'audio', 'phone', 'async')),
  status                text not null default 'scheduled'
                          check (status in ('scheduled', 'waiting', 'in_progress', 'completed', 'no_show_patient', 'no_show_clinician', 'cancelled', 'failed')),
  scheduled_at          timestamptz,
  started_at            timestamptz,
  ended_at              timestamptz,
  appointment_id        uuid references public.appointments (id) on delete restrict,
  async_consult_id      uuid references public.async_consults (id) on delete restrict,
  video_consultation_id uuid references public.video_consultations (id) on delete restrict,
  service_purchase_id   uuid references public.service_purchases (id) on delete restrict,
  task_id               uuid references public.clinical_tasks (id) on delete set null,
  final_media_mode      text check (final_media_mode in ('video', 'audio_only', 'phone')),
  fallback_steps        integer not null default 0 check (fallback_steps >= 0),
  policy_version        integer not null,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at),
  check (type = 'async' or scheduled_at is not null)
);
create unique index encounters_one_per_appointment on public.encounters (appointment_id) where appointment_id is not null;
create unique index encounters_one_per_video_consultation on public.encounters (video_consultation_id) where video_consultation_id is not null;
create unique index encounters_one_per_async_consult on public.encounters (async_consult_id) where async_consult_id is not null;
create index encounters_patient_idx on public.encounters (patient_id, scheduled_at desc);
create index encounters_clinician_idx on public.encounters (clinician_id, scheduled_at) where clinician_id is not null;
create trigger encounters_set_updated_at before update on public.encounters
  for each row execute function private.set_updated_at();
comment on table public.encounters is
  'S21: the authoritative consultation record (OQ-125). clinical_encounters stays a derived projection. Written only by the S21 functions.';

-- adults only for a live consultation, however the row is created
create function private.encounters_adult_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.type in ('video', 'audio', 'phone') then
    perform private.assert_adult_for_consultation(new.patient_id);
  end if;
  return new;
end;
$$;
revoke all on function private.encounters_adult_gate() from public, anon, authenticated;
create trigger encounters_adult_gate before insert on public.encounters
  for each row execute function private.encounters_adult_gate();

create table public.encounter_rooms (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  encounter_id      uuid not null unique references public.encounters (id) on delete cascade,
  provider          text not null default 'zoom' check (provider in ('zoom', 'mock')),
  provider_room_id  text,
  state             text not null default 'pending' check (state in ('pending', 'open', 'ended', 'failed')),
  recording_enabled boolean not null default false check (recording_enabled = false),
  expires_at        timestamptz,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger encounter_rooms_set_updated_at before update on public.encounter_rooms
  for each row execute function private.set_updated_at();
comment on table public.encounter_rooms is
  'S21: provider room reference only. No join or host URL is stored (a function issues a token to the patient or assigned clinician). recording_enabled is pinned false by a CHECK (OQ-128).';

create table public.encounter_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  encounter_id    uuid not null references public.encounters (id) on delete cascade,
  kind            text not null check (kind in (
                    'room_created', 'joined', 'left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested',
                    'phone_connected', 'reconnect_grace_started', 'no_show_marked', 'completed', 'cancelled',
                    'credit_returned', 'scribe_consent_asked', 'scribe_consent_changed')),
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_role      text not null check (actor_role in ('patient', 'clinician', 'system')),
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2048),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index encounter_events_encounter_idx on public.encounter_events (encounter_id, created_at);
create function private.encounter_events_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'encounter_events is append only' using errcode = '23514'; end; $$;
revoke all on function private.encounter_events_append_only() from public, anon, authenticated;
create trigger encounter_events_append_only before update or delete on public.encounter_events
  for each row execute function private.encounter_events_append_only();
comment on table public.encounter_events is
  'S21: append-only log that drives the fallback ladder and the proof. Payload holds ids and small numbers only (mode, bitrate_kbps, quality, reason_code), never a name or a reading.';

create table public.scribe_consents (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  encounter_id    uuid not null unique references public.encounters (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  granted         boolean,
  asked_at        timestamptz not null default now(),
  answered_at     timestamptz,
  method          text not null default 'in_app' check (method = 'in_app'),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((granted is null) = (answered_at is null))
);
create trigger scribe_consents_set_updated_at before update on public.scribe_consents
  for each row execute function private.set_updated_at();
comment on table public.scribe_consents is
  'S21 (OQ-38, INV-11): the patient''s own answer to CON-001 for one consultation. granted null means asked, not yet answered. Written only by open_scribe_prompt and record_scribe_consent, which require the signed-in patient. Nothing here is ever defaulted or written for the patient.';

-- ---------------------------------------------------------------------------
-- 4. RLS and grants: read only for authenticated, every write goes through a function
-- ---------------------------------------------------------------------------
alter table public.encounters enable row level security;
alter table public.encounter_rooms enable row level security;
alter table public.encounter_events enable row level security;
alter table public.scribe_consents enable row level security;

create function private.encounter_visible(p_patient uuid, p_clinician uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
       p_patient = (select auth.uid())
    or p_clinician = (select auth.uid())
    or private.is_admin()
    or private.credential_is_cmo()
    or private.can_act_for(p_patient, 'book_appointments'::public.caregiver_permission));
$$;
revoke all on function private.encounter_visible(uuid, uuid) from public, anon;
grant execute on function private.encounter_visible(uuid, uuid) to authenticated;

create policy encounters_select on public.encounters for select to authenticated
  using (private.encounter_visible(patient_id, clinician_id));
create policy encounter_events_select on public.encounter_events for select to authenticated
  using (exists (select 1 from public.encounters e where e.id = encounter_id and private.encounter_visible(e.patient_id, e.clinician_id)));
create policy scribe_consents_select on public.scribe_consents for select to authenticated
  using (exists (select 1 from public.encounters e where e.id = encounter_id and private.encounter_visible(e.patient_id, e.clinician_id)));
-- a patient never reads the provider room reference; the assigned clinician and admin do
create policy encounter_rooms_select on public.encounter_rooms for select to authenticated
  using (exists (select 1 from public.encounters e where e.id = encounter_id
                 and (e.clinician_id = (select auth.uid()) or private.is_admin() or private.credential_is_cmo())));

revoke all on public.encounters, public.encounter_rooms, public.encounter_events, public.scribe_consents
  from anon, public, authenticated;  -- the schema's default privileges also hand authenticated every right
grant select on public.encounters, public.encounter_rooms, public.encounter_events, public.scribe_consents to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Event types (owner S21)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('encounter.scheduled', 'A consultation was booked', 'S21', false),
  ('encounter.started', 'Both sides joined a consultation', 'S21', false),
  ('encounter.fallback', 'A consultation moved to a lighter way of talking', 'S21', false),
  ('encounter.no_show', 'Someone did not attend a consultation', 'S21', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('encounter.scheduled', 1, array['encounter_id']),
  ('encounter.started', 1, array['encounter_id']),
  ('encounter.fallback', 1, array['encounter_id']),
  ('encounter.no_show', 1, array['encounter_id']);

-- ---------------------------------------------------------------------------
-- 6. Helpers
-- ---------------------------------------------------------------------------
create function private.log_encounter_event(p_encounter uuid, p_kind text, p_actor uuid, p_actor_role text, p_payload jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.encounters;
begin
  select * into e from public.encounters where id = p_encounter;
  if e.id is null then return; end if;
  insert into public.encounter_events (organisation_id, encounter_id, kind, actor_id, actor_role, payload, is_test)
  values (e.organisation_id, e.id, p_kind, p_actor, p_actor_role, coalesce(p_payload, '{}'::jsonb), e.is_test);
end;
$$;
revoke all on function private.log_encounter_event(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- gives the credit back: the redeemed service_purchases row is un-redeemed in the caller's transaction
create function private.return_consultation_credit(p_appointment uuid, p_encounter uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  update public.service_purchases
     set redeemed_at = null, redeemed_entity_type = null, redeemed_entity_id = null
   where redeemed_entity_type = 'appointment' and redeemed_entity_id = p_appointment and status = 'active';
  get diagnostics v_n = row_count;
  if v_n > 0 and p_encounter is not null then
    perform private.log_encounter_event(p_encounter, 'credit_returned', null, 'system', jsonb_build_object('reason_code', p_reason));
  end if;
  return v_n > 0;
end;
$$;
revoke all on function private.return_consultation_credit(uuid, uuid, text) from public, anon, authenticated;

create function private.ensure_encounter_for_appointment(p_appointment uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a public.appointments;
  v_id uuid;
  v_test boolean;
  v_purchase uuid;
begin
  select * into a from public.appointments where id = p_appointment;
  if a.id is null or a.consultation_method <> 'telemedicine' then
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
$$;
revoke all on function private.ensure_encounter_for_appointment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. hold_appointment_slot: S21 adds the adult-only rule for a remote consultation (live definition otherwise unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.hold_appointment_slot(
  p_organisation_id uuid, p_clinician_id uuid, p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method, p_scheduled_for timestamptz, p_ends_at timestamptz,
  p_reason text default null, p_service text default null, p_location text default null,
  p_specialist_referral_id uuid default null, p_care_plan_id uuid default null, p_patient_id uuid default null,
  p_hold_minutes integer default 10)
returns public.appointments
language plpgsql security definer set search_path = ''
as $function$
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

  -- S21 (OQ-129): a remote consultation is for adults only; fail closed when the age is unknown
  if p_consultation_method = 'telemedicine' then
    perform private.assert_adult_for_consultation(v_patient);
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

-- ---------------------------------------------------------------------------
-- 8. confirm_appointment_booking: S21 creates the encounter and room stub once a consultation is confirmed
-- ---------------------------------------------------------------------------
create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
returns public.appointments
language plpgsql security definer set search_path = ''
as $function$
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

  if v_appt.payment_status = 'pending' then
    v_product_code := case v_appt.appointment_type
      when 'telemedicine' then 'video_visit_credit'
      when 'result_interpretation' then 'result_interpretation_credit'
      else null
    end;
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
     and v_appt.appointment_type in ('telemedicine', 'result_interpretation') then
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

-- ---------------------------------------------------------------------------
-- 9. cancel_appointment: S21 policy-driven credit return for a consultation (OQ-127)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns public.appointments
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_policy public.appointment_cancellation_policies;
  v_hours_until numeric;
  v_actor_is_patient boolean;
  v_is_patient_side boolean;
  v_cfg jsonb := private.consult_policy();
  v_is_consult boolean;
  v_late boolean;
  v_return boolean := false;
  v_credit_back boolean := false;
  v_encounter uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  v_actor_is_patient := v_appt.patient_id = v_uid;
  v_is_patient_side := v_actor_is_patient;

  if not (v_is_patient_side or private.is_org_staff(v_appt.organisation_id)) then
    if private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
      v_is_patient_side := true;
    else
      raise exception 'not authorized';
    end if;
  end if;
  if v_appt.status in ('completed', 'cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled') then
    raise exception 'appointment is already %', v_appt.status;
  end if;

  v_policy := private.resolve_cancellation_policy(v_appt.organisation_id, v_appt.appointment_type);
  v_hours_until := extract(epoch from (v_appt.scheduled_for - now())) / 3600.0;

  -- S21: a remote consultation follows the consultation policy; everything else keeps the older rule
  v_is_consult := v_appt.consultation_method = 'telemedicine';
  v_late := v_hours_until < coalesce((v_cfg ->> 'cancelWindowHours')::numeric, 2);
  v_return := v_is_consult
    and v_appt.payment_status = 'paid'
    and (not v_is_patient_side or not v_late or coalesce((v_cfg ->> 'lateCancelCreditReturned')::boolean, false));

  update public.appointments set
    status = case
      when v_is_patient_side then 'patient_cancelled'::public.appointment_status
      else 'provider_cancelled'::public.appointment_status
    end,
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancellation_reason = p_reason,
    hold_expires_at = null,
    payment_status = case
      when v_return then 'refunded'::public.appointment_payment_status  -- S21: the credit went back, no money moved
      when not v_is_consult
        and payment_status = 'paid'
        and v_policy.id is not null
        and v_policy.refund_pct_within_window > 0
        and v_hours_until >= v_policy.cancellation_window_hours
      then 'refund_due'
      else payment_status
    end
  where id = p_appointment_id
  returning * into v_appt;

  if v_is_consult then
    select id into v_encounter from public.encounters where appointment_id = v_appt.id;
    if v_return then
      v_credit_back := private.return_consultation_credit(v_appt.id, v_encounter, case when v_is_patient_side then 'patient_cancelled_in_time' else 'clinician_cancelled' end);
    end if;
    if v_encounter is not null then
      update public.encounters set status = 'cancelled' where id = v_encounter and status in ('scheduled', 'waiting');
      perform private.log_encounter_event(v_encounter, 'cancelled', v_uid, case when v_is_patient_side then 'patient' else 'clinician' end,
                                          jsonb_build_object('reason_code', case when v_late then 'late' else 'in_time' end));
    end if;
    update public.video_consultations set status = 'cancelled' where id = v_appt.video_consultation_id and status = 'scheduled';
  end if;

  perform private.offer_next_waiting_list_candidate(
    v_appt.organisation_id, v_appt.clinician_id, v_appt.appointment_type,
    v_appt.consultation_method, v_appt.location, v_appt.scheduled_for, v_appt.ends_at
  );

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_cancelled',
    jsonb_build_object(
      'appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for,
      'cancelled_by_patient', v_actor_is_patient,
      'cancelled_by_caregiver', (not v_actor_is_patient) and v_is_patient_side,
      'credit_returned', v_credit_back
    ),
    'non_clinical'
  );

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', 'cancelled'));
  end if;

  return v_appt;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Patient and clinician functions
-- ---------------------------------------------------------------------------
-- the rule the patient sees before the pay button (OQ-127) and the price (OQ-130)
create function public.my_consultation_rule() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'price_kobo', (select price_kobo from public.service_products where code = 'video_visit_credit' and is_active),
    'cancel_window_hours', (private.consult_policy() ->> 'cancelWindowHours')::numeric,
    'late_cancel_credit_returned', (private.consult_policy() ->> 'lateCancelCreditReturned')::boolean,
    'min_age_years', (private.consult_policy() ->> 'minAgeYears')::integer,
    'policy_version', private.consult_policy_version());
$$;
revoke all on function public.my_consultation_rule() from public, anon;
grant execute on function public.my_consultation_rule() to authenticated;

-- lower rank is lighter: video 3, audio_only 2, phone 1
create function private.media_rank(p_mode text) returns integer
language sql immutable set search_path = ''
as $$ select case p_mode when 'video' then 3 when 'audio_only' then 2 when 'phone' then 1 else 0 end; $$;
revoke all on function private.media_rank(text) from public, anon, authenticated;

create function public.report_encounter_event(p_encounter uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns public.encounters
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  v_role text;
  v_clean jsonb := '{}'::jsonb;
  v_mode text;
  v_patient_in boolean;
  v_clinician_in boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null then raise exception 'consultation not found'; end if;
  if v_uid = e.patient_id then v_role := 'patient';
  elsif v_uid = e.clinician_id then v_role := 'clinician';
  else raise exception 'not authorized' using errcode = '42501'; end if;
  if p_kind not in ('joined', 'left', 'quality', 'mode_changed', 'phone_requested', 'reconnect_grace_started', 'fallback_offered') then
    raise exception 'that event cannot be reported from the app' using errcode = '22023';
  end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then
    raise exception 'this consultation is %', e.status;
  end if;

  -- only these keys are kept: ids and small numbers, never a name or a reading (INV-07)
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object' then
    if p_payload ? 'mode' then v_clean := v_clean || jsonb_build_object('mode', p_payload ->> 'mode'); end if;
    if p_payload ? 'quality' then v_clean := v_clean || jsonb_build_object('quality', p_payload ->> 'quality'); end if;
    if p_payload ? 'reason_code' then v_clean := v_clean || jsonb_build_object('reason_code', left(p_payload ->> 'reason_code', 40)); end if;
    if p_payload ? 'bitrate_kbps' then v_clean := v_clean || jsonb_build_object('bitrate_kbps', (p_payload ->> 'bitrate_kbps')::integer); end if;
  end if;

  if p_kind = 'mode_changed' then
    v_mode := v_clean ->> 'mode';
    if v_mode is null or private.media_rank(v_mode) = 0 then
      raise exception 'mode must be video, audio_only or phone' using errcode = '22023';
    end if;
    update public.encounters
       set final_media_mode = v_mode,
           fallback_steps = fallback_steps + case when private.media_rank(v_mode) < private.media_rank(coalesce(final_media_mode, 'video')) then 1 else 0 end
     where id = e.id
     returning * into e;
    if private.media_rank(v_mode) < 3 then
      perform private.emit_domain_event('encounter.fallback', e.organisation_id, jsonb_build_object('encounter_id', e.id),
                                        'encounter.fallback:' || e.id::text || ':' || e.fallback_steps::text, e.patient_id, 'encounter', e.id);
    end if;
  end if;

  perform private.log_encounter_event(e.id, p_kind, v_uid, v_role, v_clean);

  if p_kind = 'joined' then
    select bool_or(actor_role = 'patient'), bool_or(actor_role = 'clinician') into v_patient_in, v_clinician_in
      from public.encounter_events where encounter_id = e.id and kind = 'joined';
    if coalesce(v_patient_in, false) and coalesce(v_clinician_in, false) and e.status <> 'in_progress' then
      update public.encounters set status = 'in_progress', started_at = coalesce(started_at, now()) where id = e.id returning * into e;
      update public.appointments set status = 'in_progress' where id = e.appointment_id and status in ('confirmed', 'checked_in', 'booked');
      update public.video_consultations set status = 'started', started_at = coalesce(started_at, now())
       where id = e.video_consultation_id and status = 'scheduled';
      perform private.emit_domain_event('encounter.started', e.organisation_id, jsonb_build_object('encounter_id', e.id),
                                        'encounter.started:' || e.id::text, e.patient_id, 'encounter', e.id);
    elsif e.status = 'scheduled' then
      update public.encounters set status = 'waiting' where id = e.id returning * into e;
    end if;
  end if;

  return e;
end;
$$;
revoke all on function public.report_encounter_event(uuid, text, jsonb) from public, anon;
grant execute on function public.report_encounter_event(uuid, text, jsonb) to authenticated;

create function public.complete_encounter(p_encounter uuid) returns public.encounters
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null then raise exception 'consultation not found'; end if;
  if e.clinician_id is distinct from v_uid then raise exception 'only the clinician for this consultation can complete it' using errcode = '42501'; end if;
  if e.status <> 'in_progress' then raise exception 'this consultation is %', e.status; end if;
  update public.encounters set status = 'completed', ended_at = now() where id = e.id returning * into e;
  update public.appointments set status = 'completed', completed_at = now() where id = e.appointment_id and status = 'in_progress';
  update public.video_consultations set status = 'completed', ended_at = now() where id = e.video_consultation_id and status in ('scheduled', 'started');
  perform private.log_encounter_event(e.id, 'completed', v_uid, 'clinician', '{}'::jsonb);
  perform private.emit_domain_event('encounter.completed', e.organisation_id, jsonb_build_object('encounter_id', e.id),
                                    'encounter.completed:' || e.id::text, e.patient_id, 'encounter', e.id);
  return e;
end;
$$;
revoke all on function public.complete_encounter(uuid) from public, anon;
grant execute on function public.complete_encounter(uuid) to authenticated;

-- A patient who waited the configured minutes without the clinician marks a clinician no-show (credit back, free rebook);
-- a clinician who waited without the patient marks a patient no-show (credit kept). Server clock decides, not the caller.
create function public.mark_encounter_no_show(p_encounter uuid) returns public.encounters
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  v_cfg jsonb := private.consult_policy();
  v_role text;
  v_patient_in boolean;
  v_clinician_in boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null then raise exception 'consultation not found'; end if;
  if v_uid = e.patient_id then v_role := 'patient';
  elsif v_uid = e.clinician_id then v_role := 'clinician';
  else raise exception 'not authorized' using errcode = '42501'; end if;
  if e.status not in ('scheduled', 'waiting') then raise exception 'this consultation is %', e.status; end if;
  select coalesce(bool_or(actor_role = 'patient'), false), coalesce(bool_or(actor_role = 'clinician'), false)
    into v_patient_in, v_clinician_in
    from public.encounter_events where encounter_id = e.id and kind = 'joined';

  if v_role = 'clinician' then
    if v_patient_in then raise exception 'the patient has already joined'; end if;
    if now() < e.scheduled_at + ((v_cfg ->> 'patientNoShowWaitMinutes')::integer * interval '1 minute') then
      raise exception 'wait a little longer before marking a no-show';
    end if;
    update public.encounters set status = 'no_show_patient', ended_at = now() where id = e.id returning * into e;
    update public.appointments set status = 'no_show', no_show_marked_at = now() where id = e.appointment_id and status in ('confirmed', 'checked_in', 'booked', 'in_progress');
    update public.video_consultations set status = 'no_show' where id = e.video_consultation_id and status = 'scheduled';
  else
    if v_clinician_in then raise exception 'the clinician has already joined'; end if;
    if now() < e.scheduled_at + ((v_cfg ->> 'clinicianNoShowWaitMinutes')::integer * interval '1 minute') then
      raise exception 'wait a little longer before reporting that nobody came';
    end if;
    update public.encounters set status = 'no_show_clinician', ended_at = now() where id = e.id returning * into e;
    update public.appointments set status = 'provider_cancelled', cancelled_at = now(), cancelled_by = v_uid, cancellation_reason = 'clinician_no_show',
            payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end
     where id = e.appointment_id and status in ('confirmed', 'checked_in', 'booked', 'in_progress');
    update public.video_consultations set status = 'no_show' where id = e.video_consultation_id and status = 'scheduled';
    perform private.return_consultation_credit(e.appointment_id, e.id, 'clinician_no_show');
  end if;

  perform private.log_encounter_event(e.id, 'no_show_marked', v_uid, v_role, jsonb_build_object('reason_code', case when v_role = 'clinician' then 'patient_absent' else 'clinician_absent' end));
  perform private.emit_domain_event('encounter.no_show', e.organisation_id, jsonb_build_object('encounter_id', e.id),
                                    'encounter.no_show:' || e.id::text, e.patient_id, 'encounter', e.id);
  return e;
end;
$$;
revoke all on function public.mark_encounter_no_show(uuid) from public, anon;
grant execute on function public.mark_encounter_no_show(uuid) to authenticated;

-- CON-001: asked at the start of every consultation, answered only by the patient (INV-11, OQ-38)
create function public.open_scribe_prompt(p_encounter uuid) returns public.scribe_consents
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  c public.scribe_consents;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null or e.patient_id <> v_uid then raise exception 'not authorized' using errcode = '42501'; end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then raise exception 'this consultation is %', e.status; end if;
  insert into public.scribe_consents (organisation_id, encounter_id, patient_id, is_test)
  values (e.organisation_id, e.id, e.patient_id, e.is_test)
  on conflict (encounter_id) do nothing;
  select * into c from public.scribe_consents where encounter_id = e.id;
  perform private.log_encounter_event(e.id, 'scribe_consent_asked', v_uid, 'patient', '{}'::jsonb);
  return c;
end;
$$;
revoke all on function public.open_scribe_prompt(uuid) from public, anon;
grant execute on function public.open_scribe_prompt(uuid) to authenticated;

create function public.record_scribe_consent(p_encounter uuid, p_granted boolean) returns public.scribe_consents
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  c public.scribe_consents;
  v_prev boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_granted is null then raise exception 'an answer is required' using errcode = '22023'; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null or e.patient_id <> v_uid then raise exception 'not authorized' using errcode = '42501'; end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then raise exception 'this consultation is %', e.status; end if;
  select granted into v_prev from public.scribe_consents where encounter_id = e.id;
  insert into public.scribe_consents (organisation_id, encounter_id, patient_id, granted, answered_at, is_test)
  values (e.organisation_id, e.id, e.patient_id, p_granted, now(), e.is_test)
  on conflict (encounter_id) do update set granted = excluded.granted, answered_at = now()
  returning * into c;
  if v_prev is not null and v_prev <> p_granted then
    perform private.log_encounter_event(e.id, 'scribe_consent_changed', v_uid, 'patient', jsonb_build_object('reason_code', case when p_granted then 'granted_later' else 'withdrawn' end));
  end if;
  return c;
end;
$$;
revoke all on function public.record_scribe_consent(uuid, boolean) from public, anon;
grant execute on function public.record_scribe_consent(uuid, boolean) to authenticated;

-- the server-side precondition S23 calls before any transcription: granted, and the consultation is live
create function public.scribe_may_start(p_encounter uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.encounters e
         join public.scribe_consents c on c.encounter_id = e.id
        where e.id = p_encounter
          and e.clinician_id = (select auth.uid())
          and e.status = 'in_progress'
          and c.granted is true);
$$;
revoke all on function public.scribe_may_start(uuid) from public, anon;
grant execute on function public.scribe_may_start(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Price (OQ-130)
-- ---------------------------------------------------------------------------
update public.service_products set price_kobo = 1000000 where code = 'video_visit_credit';

-- ---------------------------------------------------------------------------
-- 12. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if (select price_kobo from public.service_products where code = 'video_visit_credit') <> 1000000 then
    raise exception 'S21: video_visit_credit price did not take';
  end if;
  select count(*) into v_n from public.event_types where owner_section = 'S21' and event_type like 'encounter.%';
  if v_n < 5 then raise exception 'S21: expected 5 encounter event types, found %', v_n; end if;
  if has_function_privilege('anon', 'public.report_encounter_event(uuid,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_scribe_consent(uuid,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_encounter_no_show(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_encounter(uuid)', 'EXECUTE') then
    raise exception 'S21: anon can execute a consultation function';
  end if;
  if has_table_privilege('authenticated', 'public.encounters', 'INSERT')
     or has_table_privilege('authenticated', 'public.scribe_consents', 'UPDATE')
     or has_table_privilege('authenticated', 'public.encounter_events', 'DELETE') then
    raise exception 'S21: authenticated can write a consultation table directly';
  end if;
end $$;
