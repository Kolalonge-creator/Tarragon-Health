-- Tarragon Health — Imaging & Diagnostic Services Engine, part 1/3: service
-- catalogue + clinician-initiated diagnostic requests.
--
-- WHY A NEW MODULE RATHER THAN EXTENDING lab_orders: imaging already lives
-- in this codebase in two places — (1) breast_imaging/abdominal_ultrasound/
-- prostate_ultrasound/echo as screen_types rows ordered through the
-- existing panel_bundles/lab_orders self-arranged-fulfilment pipeline (that
-- is CALENDAR-DRIVEN preventive screening and is untouched here), and (2)
-- ecg_report_documents (20260814193521), a genuinely separate table set for
-- the ECG upload/review workflow. Neither shape fits what this module adds:
-- a CLINICIAN-AUTHORED diagnostic order carrying an indication, a clinical
-- question and an urgency ("Echocardiogram requested" for a documented
-- reason) — not a panel/test-code selection. lab_orders has no columns for
-- that narrative, and bolting them on would blur two workflows this
-- codebase has consistently kept apart when their shape genuinely differs
-- (see ecg_report_documents' own header on why it isn't a "kind" column on
-- lab_result_documents). docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.14
-- independently names this exact gap — "a generalized imaging model... this
-- is additive and low-risk to build (mirrors the lab/ECG document
-- pattern)" — as deliberately deferred, not overlooked.
--
-- COMPLEMENTARY, NOT REPLACING: nothing here touches lab_orders,
-- screening_results, screen_types, ecg_report_documents, specialist_referrals
-- or the Appointment Engine. It reuses their conventions and enums wherever
-- the shape already matches (fulfilment_mode, lab_order_time_of_day,
-- facilities.type='radiology', the config-driven escalation_slas pathway —
-- see part 2's abnormal-result hook) rather than inventing parallel ones.
--
-- GUARDRAIL — "never patient-orderable" (Master Operating Plan §6: CT, MRI,
-- echocardiography and others "never patient-orderable, at any tier or
-- phase"): every diagnostic_requests row is clinician-authored. There is no
-- patient INSERT path anywhere in this module — a patient may only select a
-- facility/date/time preference on a request a clinician already created
-- (15.3), via the guarded RPC below, never create one. The INSERT policy
-- and the BEFORE INSERT trigger both independently enforce "an ACTIVE
-- clinical_staff row", not merely "org staff" — a Care Coordinator is org
-- staff (private.is_org_staff) but must never gain clinical ordering
-- authority (CLAUDE.md's Care Coordinator write-access rule), so is_org_staff
-- alone would be the wrong gate here.
--
-- BOOKING MODEL — deliberately NOT the new Appointment Engine
-- (public.appointments, appointment_type='imaging'): that engine's own
-- migration (20260828000528) reserves the enum value for this, but its
-- slot-generation machinery (provider_availability_rules/
-- get_available_appointment_slots) is built around a Tarragon-EMPLOYED
-- clinician's own calendar — imaging is fulfilled by external partner
-- facilities Tarragon has no calendar for (CLAUDE.md: "no owned clinics").
-- The precedent that actually fits, from the exact same day: 20260820055147
-- (lab_order_partner_visit_scheduling) explicitly rejected "a fabricated
-- real-time slot grid" for this same self-arranged-partner-visit shape in
-- favour of a coarse date + time-of-day preference a facility confirms
-- manually — "low-tech on purpose". This migration copies that shape
-- directly (same lab_order_time_of_day enum) rather than the heavier engine.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.diagnostic_modality as enum (
    'xray', 'ultrasound', 'ct', 'mri', 'ecg', 'echocardiography', 'mammography', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- Deliberately 3 values, not referral_urgency's routine/priority/urgent —
  -- this urgency must map cleanly onto clinician_alerts.level
  -- (routine/clinician_review/urgent_escalation/emergency) when an abnormal
  -- finding fires the alert in part 2.
  create type public.diagnostic_urgency as enum ('routine', 'urgent', 'emergency');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 15.5 workflow compressed to 6 observable states + cancelled. "Imaging
  -- performed" and "reporting clinician writes the report" have no separate
  -- signal from this table's own data — the report's arrival (part 2) IS the
  -- observable evidence both happened, so 'attended' -> 'reported' covers
  -- both steps of the source workflow diagram in one transition.
  create type public.diagnostic_request_status as enum (
    'requested', 'booked', 'attended', 'reported', 'reviewed', 'actioned', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Diagnostic service catalogue (15.1) — global reference data, same
-- shape/RLS posture as screen_types/lab_tests: no organisation_id,
-- authenticated-read, admin-write.
-- ---------------------------------------------------------------------------
create table public.diagnostic_service_catalogue (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique,
  name                       text not null,
  modality                   public.diagnostic_modality not null,
  description                text,
  -- Informational expected price only — self-arranged fulfilment is the
  -- default and only model here (see diagnostic_requests.fulfilment below),
  -- same as breast_imaging/abdominal_ultrasound today: the patient pays the
  -- facility directly, Tarragon collects nothing, so this is never a
  -- checkout amount.
  price_kobo                 bigint not null default 0,
  fasting_required            boolean not null default false,
  prep_instructions           text,
  medication_instructions     text,
  arrival_minutes_before      integer,
  required_documents          text[] not null default '{}',
  pregnancy_safety_question   boolean not null default false,
  turnaround_hours            integer,
  reporting_method             text,
  is_active                    boolean not null default true,
  created_at                   timestamptz not null default now()
);

comment on table public.diagnostic_service_catalogue is
  '15.1 diagnostic service catalogue. One row per orderable procedure (not per-facility like lab_tests — self-arranged is the default model, so a facility is a booking-time choice, not a catalogue dimension). price_kobo/prep fields are patient-facing guidance, not a billable amount.';
comment on column public.diagnostic_service_catalogue.pregnancy_safety_question is
  '15.4: when true, the booking UI must ask the pregnancy-safety question before confirming (relevant to X-ray/CT/some contrast studies) — a flag the booking flow reads, not itself a clinical gate.';

create index diagnostic_service_catalogue_modality_idx on public.diagnostic_service_catalogue (modality) where is_active;

alter table public.diagnostic_service_catalogue enable row level security;

create policy diagnostic_service_catalogue_select on public.diagnostic_service_catalogue
  for select to authenticated using (true);
create policy diagnostic_service_catalogue_insert on public.diagnostic_service_catalogue
  for insert to authenticated with check (private.is_admin());
create policy diagnostic_service_catalogue_update on public.diagnostic_service_catalogue
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy diagnostic_service_catalogue_delete on public.diagnostic_service_catalogue
  for delete to authenticated using (private.is_admin());

grant select on public.diagnostic_service_catalogue to authenticated;
grant insert, update, delete on public.diagnostic_service_catalogue to authenticated;

insert into public.diagnostic_service_catalogue
  (code, name, modality, description, fasting_required, prep_instructions, arrival_minutes_before, turnaround_hours, reporting_method, pregnancy_safety_question)
values
  ('xray_general', 'X-ray', 'xray', 'General plain-film X-ray, site per clinical indication.', false, 'No special preparation. Remove metal jewellery/objects near the area being imaged.', 15, 24, 'Report uploaded and reviewed by your care team', true),
  ('ultrasound_general', 'Ultrasound scan', 'ultrasound', 'Diagnostic ultrasound, site per clinical indication (distinct from the calendar-based preventive breast/abdominal/prostate screening ultrasounds).', false, 'Some scans (e.g. abdominal/pelvic) may need a full bladder or a fasting window — your care team will confirm if this applies to your scan.', 15, 24, 'Report uploaded and reviewed by your care team', true),
  ('ct_scan', 'CT scan', 'ct', 'Computed tomography, with or without contrast per clinical indication.', true, 'Fasting is required if contrast is being used — your care team will confirm. Bring any prior imaging for comparison if available.', 30, 48, 'Report uploaded and reviewed by your care team', true),
  ('mri_scan', 'MRI scan', 'mri', 'Magnetic resonance imaging, per clinical indication.', false, 'Remove all metal objects and inform the facility of any implants, pacemakers, or metal fragments before the scan.', 30, 72, 'Report uploaded and reviewed by your care team', true),
  ('ecg_diagnostic', 'ECG (12-lead)', 'ecg', 'Diagnostic 12-lead ECG, requested for a specific clinical indication (distinct from the calendar-based preventive resting ECG screen).', false, 'No special preparation.', 10, 1, 'Uploaded and reviewed by your care team; a machine-generated interpretation, if present, is never the final read', false),
  ('echocardiography', 'Echocardiogram', 'echocardiography', 'Transthoracic echocardiogram, requested for a specific clinical indication (e.g. an abnormal ECG or BP finding) — not calendar-scheduled.', false, 'No special preparation.', 15, 24, 'Report uploaded and reviewed by your care team', false),
  ('mammography_diagnostic', 'Mammogram (diagnostic)', 'mammography', 'Diagnostic mammogram requested for a specific clinical indication (distinct from the calendar-based preventive breast_imaging screen).', false, 'Avoid deodorant, powder or lotion on the chest/underarm area on the day of the scan.', 15, 48, 'Report uploaded and reviewed by your care team', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Diagnostic requests (15.2 + 15.5 workflow driver)
-- ---------------------------------------------------------------------------
create table public.diagnostic_requests (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  requested_by             uuid not null references public.clinical_staff (id) on delete restrict,
  catalogue_id              uuid references public.diagnostic_service_catalogue (id) on delete set null,
  modality                  public.diagnostic_modality not null,
  service_name               text not null,
  indication                  text not null,
  clinical_question            text,
  relevant_information         text,
  urgency                       public.diagnostic_urgency not null default 'routine',
  status                        public.diagnostic_request_status not null default 'requested',
  fulfilment                    public.fulfilment_mode not null default 'self_arranged',
  facility_id                   uuid references public.facilities (id) on delete set null,
  facility_name_freetext         text,
  scheduled_date                  date,
  preferred_time_of_day            public.lab_order_time_of_day,
  insurance_covered                 boolean,
  insurance_note                     text,
  booked_at                           timestamptz,
  attended_at                          timestamptz,
  reported_at                           timestamptz,
  reviewed_at                            timestamptz,
  actioned_at                             timestamptz,
  action_note                              text,
  cancelled_at                              timestamptz,
  cancellation_reason                        text,
  specialist_referral_id                      uuid references public.specialist_referrals (id) on delete set null,
  care_plan_id                                  uuid references public.care_plans (id) on delete set null,
  created_at                                     timestamptz not null default now(),
  updated_at                                      timestamptz not null default now(),
  constraint diagnostic_requests_cancelled_has_timestamp
    check (status <> 'cancelled' or (cancelled_at is not null and cancellation_reason is not null)),
  constraint diagnostic_requests_attended_has_timestamp
    check (status not in ('attended', 'reported', 'reviewed', 'actioned') or attended_at is not null)
);

comment on table public.diagnostic_requests is
  '15.2/15.5: a clinician-authored order for an imaging/diagnostic service (X-ray/ultrasound/CT/MRI/ECG/echo/mammography/other) — indication, clinical question, urgency, requesting clinician. Never patient-insertable (see INSERT policy + derive_diagnostic_request_attribution) — a patient may only set booking preferences on an existing request via set_diagnostic_request_booking_preference().';
comment on column public.diagnostic_requests.fulfilment is
  'Mirrors lab_orders/specialist_referrals fulfilment_mode: self_arranged (default — patient takes the request to any facility, pays directly, uploads the report) vs partner (a contracted imaging partner Tarragon routes/bills). No imaging partner is contracted today, same dormant-until-real posture as lab_orders.';

create index diagnostic_requests_patient_idx on public.diagnostic_requests (patient_id, created_at desc);
create index diagnostic_requests_org_status_idx on public.diagnostic_requests (organisation_id, status);
create index diagnostic_requests_requested_by_idx on public.diagnostic_requests (requested_by);
create index diagnostic_requests_facility_idx on public.diagnostic_requests (facility_id) where facility_id is not null;
create index diagnostic_requests_catalogue_idx on public.diagnostic_requests (catalogue_id);

create trigger diagnostic_requests_set_updated_at
  before update on public.diagnostic_requests
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. BEFORE INSERT: server-derive requested_by from an ACTIVE clinical_staff
-- row (never client-supplied, never merely "org staff" — see header).
-- ---------------------------------------------------------------------------
create or replace function private.derive_diagnostic_request_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  select id into v_staff
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff is null then
    raise exception 'Only an active clinical staff member may create a diagnostic request' using errcode = '42501';
  end if;

  new.requested_by := v_staff;
  new.status := 'requested';
  new.booked_at := null;
  new.attended_at := null;
  new.reported_at := null;
  new.reviewed_at := null;
  new.actioned_at := null;
  new.cancelled_at := null;
  new.cancellation_reason := null;

  return new;
end;
$$;

create trigger diagnostic_requests_derive_attribution
  before insert on public.diagnostic_requests
  for each row execute function private.derive_diagnostic_request_attribution();

-- ---------------------------------------------------------------------------
-- 5. BEFORE UPDATE: freeze clinician-authored facts, validate the status
-- state machine on staff-driven transitions.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_diagnostic_request_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Clinician-authored facts are immutable after creation — a correction is
  -- a new request, not a silent edit of the clinical record.
  new.organisation_id   := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.requested_by        := old.requested_by;
  new.modality             := old.modality;
  new.indication            := old.indication;
  new.created_at             := old.created_at;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    if new.cancellation_reason is null or length(btrim(new.cancellation_reason)) = 0 then
      raise exception 'A cancellation reason is required' using errcode = '23514';
    end if;
  elsif old.status = 'cancelled' then
    new.cancelled_at := old.cancelled_at;
    new.cancellation_reason := old.cancellation_reason;
  end if;

  if new.status = 'attended' and old.status not in ('attended', 'reported', 'reviewed', 'actioned') then
    new.attended_at := coalesce(new.attended_at, now());
  end if;

  if new.status = 'actioned' and old.status <> 'actioned' then
    new.actioned_at := coalesce(new.actioned_at, now());
  end if;

  return new;
end;
$$;

comment on function private.enforce_diagnostic_request_transitions() is
  'BEFORE UPDATE on diagnostic_requests. Freezes the clinician-authored order details, stamps attended_at/actioned_at/cancelled_at on the matching status transition. reported_at/reviewed_at are stamped by the diagnostic_reports triggers (part 2), not here, since those steps are driven by the report row, not a direct request UPDATE.';

create trigger diagnostic_requests_enforce_transitions
  before update on public.diagnostic_requests
  for each row execute function private.enforce_diagnostic_request_transitions();

-- ---------------------------------------------------------------------------
-- 6. RLS — patient reads own; only an active clinical_staff member creates;
-- staff manage org rows. No patient UPDATE path (booking preference goes
-- through the guarded RPC below), matching lab_orders/specialist_referrals'
-- own "patient reads own, staff manage" posture.
-- ---------------------------------------------------------------------------
alter table public.diagnostic_requests enable row level security;

create policy diagnostic_requests_select on public.diagnostic_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy diagnostic_requests_insert on public.diagnostic_requests
  for insert to authenticated
  with check (
    exists (
      select 1 from public.clinical_staff cs
      where cs.profile_id = (select auth.uid())
        and cs.organisation_id = organisation_id
        and cs.active
    )
  );

create policy diagnostic_requests_update on public.diagnostic_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy diagnostic_requests_delete on public.diagnostic_requests
  for delete to authenticated using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.diagnostic_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Patient booking preference (15.3) — facility, date, coarse time-of-day,
-- insurance note. SECURITY DEFINER because the table has no patient UPDATE
-- policy (see above); mirrors public.request_lab_order_partner_visit
-- exactly, including its "no fabricated slot grid" posture.
-- ---------------------------------------------------------------------------
create or replace function public.set_diagnostic_request_booking_preference(
  p_request_id uuid,
  p_facility_id uuid default null,
  p_facility_name_freetext text default null,
  p_scheduled_date date default null,
  p_preferred_time_of_day public.lab_order_time_of_day default null,
  p_insurance_covered boolean default null,
  p_insurance_note text default null
)
returns public.diagnostic_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.diagnostic_requests%rowtype;
begin
  select * into v_request from public.diagnostic_requests where id = p_request_id;

  if v_request.id is null then
    raise exception 'Diagnostic request not found' using errcode = '42501';
  end if;
  if v_request.patient_id is distinct from (select auth.uid()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_request.status not in ('requested', 'booked') then
    raise exception 'This request can no longer be booked (status: %)', v_request.status using errcode = '23514';
  end if;
  if p_facility_id is not null and not exists (select 1 from public.facilities where id = p_facility_id and is_active) then
    raise exception 'Facility not found or inactive' using errcode = '23514';
  end if;

  update public.diagnostic_requests
  set
    facility_id = p_facility_id,
    facility_name_freetext = p_facility_name_freetext,
    scheduled_date = p_scheduled_date,
    preferred_time_of_day = p_preferred_time_of_day,
    insurance_covered = p_insurance_covered,
    insurance_note = p_insurance_note,
    status = 'booked',
    booked_at = coalesce(booked_at, now())
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_request.organisation_id, (select auth.uid()), 'diagnostic_request.booking_preference_set',
    'diagnostic_requests', v_request.id,
    jsonb_build_object('facility_id', p_facility_id, 'scheduled_date', p_scheduled_date, 'preferred_time_of_day', p_preferred_time_of_day)
  );

  return v_request;
end;
$$;

comment on function public.set_diagnostic_request_booking_preference(uuid, uuid, text, date, public.lab_order_time_of_day, boolean, text) is
  '15.3: patient booking on an already clinician-created diagnostic_requests row — facility, date, coarse time-of-day, price context (read from the linked catalogue row client-side), insurance note. A coarse preference a facility confirms manually, not a real-time slot booking — same posture as request_lab_order_partner_visit.';

revoke all on function public.set_diagnostic_request_booking_preference(uuid, uuid, text, date, public.lab_order_time_of_day, boolean, text) from public;
grant execute on function public.set_diagnostic_request_booking_preference(uuid, uuid, text, date, public.lab_order_time_of_day, boolean, text) to authenticated;
revoke execute on function public.set_diagnostic_request_booking_preference(uuid, uuid, text, date, public.lab_order_time_of_day, boolean, text) from anon;

-- ---------------------------------------------------------------------------
-- 8. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.diagnostic_service_catalogue where is_active) < 7 then
    raise exception 'FAIL: diagnostic_service_catalogue should have >= 7 active seeded rows';
  end if;

  if not has_table_privilege('authenticated', 'public.diagnostic_requests', 'SELECT') then
    raise exception 'diagnostic_requests: authenticated SELECT grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.diagnostic_requests', 'INSERT') then
    raise exception 'diagnostic_requests: authenticated INSERT grant did not take';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diagnostic_requests' and cmd = 'UPDATE'
      and qual like '%auth.uid()%'
  ) then
    raise exception 'FAIL: diagnostic_requests UPDATE policy must be staff-only, not patient-direct';
  end if;

  if has_function_privilege('anon', 'public.set_diagnostic_request_booking_preference(uuid, uuid, text, date, public.lab_order_time_of_day, boolean, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute set_diagnostic_request_booking_preference';
  end if;

  raise notice 'PASS: diagnostic service catalogue + clinician-initiated diagnostic requests in place';
end $$;
