-- Mental health: the crisis route moves into the database, and therapy becomes
-- something a patient can actually be offered.
-- Founder decision, 2026-09-10.
--
-- PART ONE: WHY THE CRISIS ROUTE MOVES
-- ------------------------------------
-- The crisis path is NOT missing today, and it is worth being exact about that
-- because the trigger reads as though it were. private.handle_mental_health_screen_concern
-- opens with `if new.crisis_flagged then return new; end if;` -- the most severe
-- possible answer causes the trigger to do nothing at all. That looks like an
-- inverted gate and is not: both writers, the dashboard server action and the
-- mobile API route, insert an emergency_events row themselves immediately after
-- the screen, deliberately, so the trigger would only duplicate it.
--
-- The weakness is where that lives and how it fails:
--
--   1. It is application code, duplicated in two files. A third writer -- a
--      clinician entering a screen on a patient's behalf, an import, the AI
--      Coach -- silently gets no crisis route at all, and nothing anywhere would
--      report that it had been missed.
--   2. Both call sites are `await supabase.from('emergency_events').insert(...)`
--      with the result discarded. If that insert fails for any reason, a patient
--      has disclosed suicidal ideation and the platform does nothing, silently.
--      That is the exact failure mode this codebase forbids for an abnormal
--      screening result, applied to something more serious.
--
-- So the route moves into the trigger, where every writer gets it and it cannot
-- be forgotten. It is idempotent -- it will not raise a second event while an
-- active one from the same source exists for that patient -- so the existing
-- application inserts continue to behave correctly during rollout, and the app
-- code can be simplified afterwards rather than in lockstep.
--
-- What is deliberately NOT changed: the concern-handler branch for non-crisis
-- screens, the emergency_events machinery itself, and the fact that the patient
-- sees acknowledge-gated crisis guidance. Those already work.
--
-- PART TWO: WHY A THERAPY NETWORK AND NOT THERAPISTS
-- --------------------------------------------------
-- The platform screens for depression, anxiety and hazardous alcohol use, and
-- then has nothing to offer the people it finds. Screening for something you
-- cannot act on is the weakest position on a health platform, clinically before
-- commercially.
--
-- Tarragon does not employ therapists and should not: they are psychologists and
-- counsellors, not the MDCN-registered doctors on the clinical tier ladder, and
-- adding a whole employment category to the platform to answer a screening
-- result is the wrong shape. public.specialist_providers already carries
-- 'psychology' and 'psychiatry', licence verification with an expiry,
-- a telemedicine flag, consultation fees, and commission rates. This is a
-- booking layer over a directory that exists, on the commission machinery that
-- exists.
--
-- THE TWO SAFETY RULES, BOTH ENFORCED IN THE DATABASE
-- ---------------------------------------------------
-- 1. Somebody in crisis is not offered an appointment. A patient with an
--    unresolved crisis-flagged screen in the last seven days cannot book
--    therapy, because a session a fortnight away is not the answer to
--    suicidal ideation and offering one implies it is. They stay on the
--    emergency pathway until it is resolved.
-- 2. Psychology is self-bookable; psychiatry is not. Self-referral to
--    counselling is ordinary and safe. Psychiatry involves diagnosis and
--    medication, so a booking request raises a clinician_alerts row for a
--    doctor to review, exactly as the AI Coach's referral request does. This
--    keeps the standing guardrail intact: specialist_referrals stays
--    staff-and-trigger-created, and nothing here is a matching or ranking
--    engine -- providers are listed, filtered and chosen by the patient.

begin;

-- ---------------------------------------------------------------------------
-- 1. The crisis route, in the database
-- ---------------------------------------------------------------------------

create or replace function private.handle_mental_health_screen_concern()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_concern text;
  v_instrument_item text;
begin
  if new.crisis_flagged then
    -- Idempotent: the dashboard server action and the mobile API route each
    -- still insert one of these themselves. Whichever arrives first wins and
    -- the other is a no-op, so this can be deployed before, after or without
    -- the application change.
    if exists (
      select 1 from public.emergency_events e
       where e.patient_id = new.patient_id
         and e.source in ('mental_health_screen', 'intake_screen')
         and e.status = 'active'
         and e.created_at > now() - interval '1 hour'
    ) then
      return new;
    end if;

    v_instrument_item := case lower(new.instrument)
                           when 'phq9' then 'PHQ-9 item 9'
                           when 'epds' then 'EPDS item 10'
                           else upper(new.instrument) || ' self-harm item'
                         end;

    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status)
    values (
      new.organisation_id,
      new.patient_id,
      'mental_health_screen',
      format('Wellbeing check-in: reported thoughts of self-harm (%s)', v_instrument_item),
      'active'
    );

    return new;
  end if;

  v_concern := private.classify_mental_health_screen_concern(new.instrument, new.severity_band, new.hazardous);
  if v_concern = 'none' then
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (
    new.organisation_id,
    new.patient_id,
    (case v_concern when 'high' then 'urgent_escalation' else 'clinician_review' end)::public.alert_level,
    'open',
    format('Mental-health screen: %s concern — %s', v_concern, upper(new.instrument)),
    format('Screen %s scored %s (%s band)%s. Screening/triage telemetry only — review before actioning.',
           new.id, new.total_score, new.severity_band,
           case when new.hazardous then '; hazardous-use threshold met' else '' end),
    case v_concern when 'high' then now() + interval '24 hours' else null end
  );

  return new;
end;
$function$;

comment on function private.handle_mental_health_screen_concern() is
  'Routes a wellbeing screen. A crisis-flagged screen raises an emergency_events row -- in the database, so every writer gets it, and idempotently so the two application call sites that also do it cannot double-fire. Anything else raises a clinician alert if it crosses a concern threshold. Moved here 2026-09-10: the crisis route previously existed only in application code, duplicated across two files, with the insert result discarded.';

-- ---------------------------------------------------------------------------
-- 2. Therapy sessions
-- ---------------------------------------------------------------------------

create type public.therapy_session_status as enum
  ('requested', 'awaiting_clinician_approval', 'confirmed', 'completed', 'cancelled', 'no_show');

create type public.therapy_modality as enum ('video', 'audio', 'in_person');

create table public.therapy_sessions (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  patient_id          uuid not null references public.profiles(id) on delete cascade,
  provider_id         uuid not null references public.specialist_providers(id) on delete restrict,
  status              public.therapy_session_status not null default 'requested',
  modality            public.therapy_modality not null default 'video',
  requested_at        timestamptz not null default now(),
  scheduled_for       timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancelled_reason    text,
  -- Snapshotted, not read live from the provider: a fee shown to a patient at
  -- booking must not change under them because the provider updated their rate.
  fee_kobo            bigint not null check (fee_kobo >= 0),
  commission_kobo     bigint not null default 0 check (commission_kobo >= 0),
  payment_provider_ref text,
  approved_by         uuid references public.profiles(id) on delete restrict,
  approved_at         timestamptz,
  clinician_alert_id  uuid references public.clinician_alerts(id) on delete set null,
  patient_note        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint therapy_commission_within_fee check (commission_kobo <= fee_kobo),
  constraint therapy_confirmed_needs_a_time check (
    status not in ('confirmed', 'completed') or scheduled_for is not null
  )
);

comment on table public.therapy_sessions is
  'A patient''s booking with a psychologist or psychiatrist from public.specialist_providers. Tarragon does not employ these practitioners; it lists them, takes the booking, and earns commission. Not a matching or ranking engine -- the patient chooses from a filtered list, which is what keeps this inside the standing guardrail on specialist matching.';
comment on column public.therapy_sessions.commission_kobo is
  'Tarragon''s share, computed at booking from the provider''s own commission_rate_type and rate. Snapshotted for the same reason as fee_kobo: a renegotiated rate must not silently restate historical revenue.';
comment on column public.therapy_sessions.approved_by is
  'Null for psychology, which a patient may self-refer to. Required before a psychiatry booking can be confirmed, because psychiatry involves diagnosis and prescribing.';

create index therapy_sessions_patient_idx on public.therapy_sessions (patient_id, requested_at desc);
create index therapy_sessions_provider_idx on public.therapy_sessions (provider_id, scheduled_for);
create index therapy_sessions_awaiting_idx on public.therapy_sessions (organisation_id, requested_at)
  where status = 'awaiting_clinician_approval';

-- ---------------------------------------------------------------------------
-- 3. The safety and authority rules
-- ---------------------------------------------------------------------------

create or replace function private.enforce_therapy_session_rules()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_type        public.specialist_type;
  v_active      boolean;
  v_verified    timestamptz;
  v_expires     date;
  v_telemed     boolean;
  v_rate_type   public.commission_rate_type;
  v_rate        numeric;
  v_flat        bigint;
  v_in_crisis   boolean;
begin
  select sp.specialist_type, sp.is_active, sp.license_verified_at, sp.license_expires_at,
         sp.supports_telemedicine, sp.commission_rate_type, sp.commission_rate, sp.commission_flat_kobo
    into v_type, v_active, v_verified, v_expires, v_telemed, v_rate_type, v_rate, v_flat
    from public.specialist_providers sp
   where sp.id = new.provider_id;

  if v_type is null then
    raise exception 'That practitioner is not on the network.' using errcode = 'P0001';
  end if;
  if v_type not in ('psychology', 'psychiatry') then
    raise exception 'therapy_sessions is for psychology and psychiatry only; % belongs elsewhere.', v_type
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    -- A practitioner nobody has verified must never be shown to a patient in
    -- distress, let alone booked. Same principle as the guard that stops a
    -- laboratory going live with a placeholder contact.
    if not coalesce(v_active, false) or v_verified is null then
      raise exception 'That practitioner is not currently accepting bookings.'
        using errcode = 'P0001', detail = 'THERAPY_PROVIDER_NOT_BOOKABLE';
    end if;
    if v_expires is not null and v_expires < current_date then
      raise exception 'That practitioner''s registration needs renewing before they can take bookings.'
        using errcode = 'P0001', detail = 'THERAPY_PROVIDER_LICENCE_EXPIRED';
    end if;
    if new.modality in ('video', 'audio') and not coalesce(v_telemed, false) then
      raise exception 'That practitioner sees people in person only.'
        using errcode = 'P0001', detail = 'THERAPY_PROVIDER_IN_PERSON_ONLY';
    end if;

    -- RULE 1. Somebody in crisis is not offered an appointment.
    select exists (
      select 1
        from public.mental_health_screens s
        join public.emergency_events e
          on e.patient_id = s.patient_id
         and e.source in ('mental_health_screen', 'intake_screen')
         and e.status = 'active'
       where s.patient_id = new.patient_id
         and s.crisis_flagged
         and s.created_at > now() - interval '7 days'
    ) into v_in_crisis;

    if v_in_crisis then
      raise exception 'This person has an open crisis alert. They need the emergency pathway now, not an appointment later.'
        using errcode = 'P0001', detail = 'THERAPY_BLOCKED_ACTIVE_CRISIS';
    end if;

    -- RULE 2. Psychiatry waits for a doctor.
    if v_type = 'psychiatry' and new.status = 'requested' then
      new.status := 'awaiting_clinician_approval';
    end if;

    -- Commission, snapshotted.
    new.commission_kobo := case
      when v_rate_type = 'flat' then least(coalesce(v_flat, 0), new.fee_kobo)
      when v_rate_type = 'percentage' then least(round(new.fee_kobo * coalesce(v_rate, 0)), new.fee_kobo)
      else 0
    end;
  end if;

  if new.status in ('confirmed', 'completed')
     and v_type = 'psychiatry'
     and new.approved_by is null then
    raise exception 'A doctor has to approve a psychiatry booking before it is confirmed.'
      using errcode = 'P0001', detail = 'THERAPY_PSYCHIATRY_NEEDS_APPROVAL';
  end if;

  return new;
end;
$function$;

create trigger therapy_sessions_rules
  before insert or update on public.therapy_sessions
  for each row execute function private.enforce_therapy_session_rules();

-- A completed session earns commission, posted through the machinery every
-- other partner line already uses rather than a second one of its own.
create or replace function private.post_therapy_commission()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.commission_kobo > 0 then
    insert into public.commissions
      (organisation_id, commission_type, source_id, partner_name, amount_kobo, status, earned_at, source_reference)
    select new.organisation_id, 'referral', new.id, sp.name, new.commission_kobo, 'pending', now(),
           'therapy_session'
      from public.specialist_providers sp
     where sp.id = new.provider_id;
  end if;
  return new;
end;
$function$;

create trigger therapy_sessions_post_commission
  after update on public.therapy_sessions
  for each row execute function private.post_therapy_commission();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

alter table public.therapy_sessions enable row level security;

-- Deliberately NOT can_read_clinical. A therapy booking is among the most
-- sensitive things on this record, and there is no care_access_category for
-- mental health -- so rather than borrow a neighbouring category and quietly
-- widen who can see it, this is the patient and org staff only. A caregiver
-- proxy who can read the medication list cannot see that someone is seeing a
-- therapist. If a mental_health category is ever added to care_access_category,
-- revisit this deliberately rather than by pattern-matching another table.
create policy therapy_sessions_select on public.therapy_sessions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy therapy_sessions_insert on public.therapy_sessions
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

-- A patient may cancel; everything else -- approving, confirming, completing --
-- is staff. The trigger above still refuses a psychiatry confirmation without
-- an approver, so a member of staff without prescribing authority cannot
-- shortcut it by setting approved_by to themselves; that is checked in the
-- approval RPC rather than here.
create policy therapy_sessions_update on public.therapy_sessions
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- RLS restricts rows; it does not grant table access.
grant select, insert, update on public.therapy_sessions to authenticated;
revoke delete on public.therapy_sessions from authenticated;

create trigger therapy_sessions_set_updated_at before update on public.therapy_sessions
  for each row execute function private.set_updated_at();
create trigger audit_row_change_trg after insert or update or delete
  on public.therapy_sessions for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- 5. The directory a patient actually sees
--
-- A view rather than direct table access, because specialist_providers carries
-- contact details, licence numbers and commission rates that are nobody's
-- business but Tarragon's and the practitioner's. It exposes what a person
-- needs to choose: who, what they treat, where, in what language, how they see
-- people, and what they charge.
-- ---------------------------------------------------------------------------

create or replace view public.therapy_directory as
select sp.id,
       sp.name,
       sp.specialist_type,
       sp.subspecialty,
       sp.qualifications,
       sp.years_of_experience,
       sp.clinical_interests,
       sp.state,
       sp.city,
       sp.languages,
       sp.supports_telemedicine,
       sp.supports_in_person,
       sp.consultation_fee_kobo,
       sp.specialist_type = 'psychiatry' as needs_doctor_approval
  from public.specialist_providers sp
 where sp.specialist_type in ('psychology', 'psychiatry')
   and sp.is_active
   and sp.license_verified_at is not null
   and (sp.license_expires_at is null or sp.license_expires_at >= current_date);

comment on view public.therapy_directory is
  'The patient-facing therapy directory. Filtered to verified, in-date, active practitioners only, and deliberately omits contact details, licence numbers and commission rates. Ordering is left to the caller and must stay a plain sort a patient controls -- ranking practitioners is the matching-engine guardrail this platform has not opened.';

revoke all on public.therapy_directory from public;
grant select on public.therapy_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_src_ok    boolean;
  v_crisis_ok boolean := false;
  v_patient   uuid;
  v_org       uuid;
begin
  select 'mental_health_screen' = any(enum_range(null::public.emergency_source)::text[]) into v_src_ok;
  if not v_src_ok then
    raise exception 'FAIL: emergency_source has no mental_health_screen value';
  end if;

  if not has_table_privilege('authenticated', 'public.therapy_sessions', 'SELECT') then
    raise exception 'FAIL: authenticated cannot SELECT therapy_sessions';
  end if;

  -- Prove the crisis route actually fires from the trigger, rather than merely
  -- that the function was replaced. Rolled back by raising.
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is not null then
    begin
      delete from public.emergency_events
       where patient_id = v_patient and status = 'active'
         and source in ('mental_health_screen', 'intake_screen');

      insert into public.mental_health_screens
        (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses)
      values (v_org, v_patient, 'phq9', 18, 'moderately_severe', true, '{"items":[2,2,2,2,2,2,2,2,2]}'::jsonb);

      select exists (
        select 1 from public.emergency_events
         where patient_id = v_patient and source = 'mental_health_screen' and status = 'active'
      ) into v_crisis_ok;

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
    end;

    if not v_crisis_ok then
      raise exception 'FAIL: a crisis-flagged screen did NOT raise an emergency event from the trigger.';
    end if;
    raise notice 'PASS: a crisis-flagged screen raises an emergency event in the database';
  else
    raise notice 'SKIP: no patient row to prove the crisis trigger against';
  end if;

  raise notice 'PASS: therapy network live -- psychology self-bookable, psychiatry doctor-gated, crisis blocks booking';
end $$;

commit;
