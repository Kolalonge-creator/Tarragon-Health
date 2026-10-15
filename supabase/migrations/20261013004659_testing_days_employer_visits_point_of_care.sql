-- Testing days, employer on-site visits and point-of-care results (two-tier model, decisions D6, C1, C6, C9 of 2026-10-08 / 2026-10-12).
--
-- What this adds
--   testing_events / _team / _bookings   one table family for both "individual testing day" (kind public_day) and
--                                        "employer on-site visit" (kind employer_visit), so check-in, specimen labelling,
--                                        point-of-care entry and release share one path.
--   poc_measurements                     height and the other station-B readings; BP, glucose, weight, pulse and oxygen
--                                        saturation are ALSO written to vitals_readings (the existing equivalent).
--   poc_panel_versions / poc_results /   urinalysis dipstick and HbA1c point-of-care results, classified in the database
--   poc_result_items                     (the client sends a value only, never a flag), held until a doctor releases them.
--   poc_ecg_recordings                   the ECG trace file plus a doctor's interpretation. Never auto-interpreted, never
--                                        auto-released: a recording always makes a clinical task for a doctor.
--
-- Why a new table family and not group screening days (20260829003735): those are a bulk-paid, voucher-per-head product
-- (one payer, a discount off a panel bundle). A Member's testing day is an entitlement use, with a capacity, a waitlist and a
-- lab order made at check-in; nothing is paid per head. The permission and staff-gating conventions are reused.
--
-- Rules honoured: INV-03 (a patient reads only released results), INV-07 (notices name no result, test or condition),
-- INV-13 (is_test carried), I9 (employer sees aggregate counts only, no cell under the min_cell rule), RLS on every table,
-- no direct writes, anon never granted. No vitamin D, ferritin or PSA at point of care (CMO C9).
--
-- Nothing here signs or activates anything: poc_panel_versions starts unsigned, so no point-of-care result auto-releases.
-- Counts before this migration: none of these tables exist (new names, checked against live 2026-10-12).


-- ---------------------------------------------------------------------------
-- 0. Permissions and helpers
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('testing_days.manage', 'Schedule testing days and employer visits', 'Operations',
   'Create and open testing days, approve venues, assign the team, schedule employer visits'),
  ('testing_days.run', 'Run a testing-day station', 'Operations',
   'Check people in (station A), enter point-of-care readings (station B), record blood draws (station C)')
on conflict (key) do nothing;

create function private.can_manage_testing_days() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_admin() or private.has_permission('testing_days.manage'); $$;
revoke all on function private.can_manage_testing_days() from public, anon, authenticated;

create function private.can_run_testing_day() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.can_manage_testing_days() or private.has_permission('testing_days.run'); $$;
revoke all on function private.can_run_testing_day() from public, anon, authenticated;

create function private.lagos_today() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Africa/Lagos')::date; $$;
revoke all on function private.lagos_today() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Events, team, bookings
-- ---------------------------------------------------------------------------
create table public.testing_events (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  kind                text not null check (kind in ('public_day', 'employer_visit')),
  status              text not null default 'scheduled'
                      check (status in ('requested', 'scheduled', 'open', 'closed', 'completed', 'cancelled')),
  event_date          date not null,
  starts_at           time,
  ends_at             time,
  venue_name          text not null check (btrim(venue_name) <> ''),
  address             text not null check (btrim(address) <> ''),
  city                text not null check (btrim(city) <> ''),
  lga                 text,
  state               text,
  capacity            integer not null check (capacity between 1 and 500),
  lab_provider_id     uuid references public.lab_providers (id) on delete restrict,
  employer_org_id     uuid references public.organisations (id) on delete restrict,
  headcount_requested integer check (headcount_requested is null or headcount_requested between 1 and 5000),
  requested_by        uuid references public.profiles (id) on delete set null,
  venue_approved_by   uuid references public.profiles (id) on delete set null,
  venue_approved_at   timestamptz,
  notes               text,
  created_by          uuid references public.profiles (id) on delete set null,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((kind = 'employer_visit') = (employer_org_id is not null)),
  check (status <> 'requested' or kind = 'employer_visit'),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  -- a day a Member can see has a lab to send the sample to and an approved venue
  check (status not in ('open', 'closed') or kind = 'employer_visit' or (lab_provider_id is not null and venue_approved_at is not null))
);
create index testing_events_date_idx on public.testing_events (event_date, status);
create index testing_events_employer_idx on public.testing_events (employer_org_id) where employer_org_id is not null;
create trigger testing_events_set_updated_at before update on public.testing_events
  for each row execute function private.set_updated_at();

create table public.testing_event_team (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.testing_events (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete restrict,
  station     text not null check (station in ('lead', 'A', 'B', 'C')),
  created_at  timestamptz not null default now(),
  unique (event_id, profile_id, station)
);

create table public.testing_event_bookings (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.testing_events (id) on delete restrict,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete restrict,
  kind             text not null check (kind in ('public_day', 'employer_visit')),
  roster_member_id uuid references public.employer_roster_members (id) on delete set null,
  state            text not null default 'confirmed'
                   check (state in ('confirmed', 'waitlisted', 'cancelled', 'checked_in', 'no_show')),
  booked_at        timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_reason text,
  rescheduled_from uuid references public.testing_event_bookings (id) on delete set null,
  checked_in_at    timestamptz,
  checked_in_by    uuid references public.profiles (id) on delete set null,
  lab_order_id     uuid references public.lab_orders (id) on delete set null,
  specimen_id      uuid references public.lab_specimens (id) on delete set null,
  blood_drawn_at   timestamptz,
  blood_drawn_by   uuid references public.profiles (id) on delete set null,
  reminder_7d_at   timestamptz,
  reminder_1d_at   timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((state = 'cancelled') = (cancelled_at is not null)),
  check (state <> 'checked_in' or (checked_in_at is not null and lab_order_id is not null and specimen_id is not null))
);
-- a person holds a place on an event once
create unique index testing_event_bookings_live_idx on public.testing_event_bookings (event_id, patient_id)
  where state in ('confirmed', 'waitlisted', 'checked_in');
-- and has one upcoming public-day place at a time (reschedule moves it)
create unique index testing_event_bookings_one_public_idx on public.testing_event_bookings (patient_id)
  where kind = 'public_day' and state in ('confirmed', 'waitlisted');
create index testing_event_bookings_event_idx on public.testing_event_bookings (event_id, state);
create trigger testing_event_bookings_set_updated_at before update on public.testing_event_bookings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Point-of-care tables
-- ---------------------------------------------------------------------------
create table public.poc_measurements (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null unique references public.testing_event_bookings (id) on delete restrict,
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete restrict,
  height_cm          numeric check (height_cm is null or height_cm between 50 and 250),
  weight_kg          numeric check (weight_kg is null or weight_kg between 2 and 400),
  bmi                numeric check (bmi is null or bmi between 8 and 100),
  pulse_bpm          integer check (pulse_bpm is null or pulse_bpm between 20 and 300),
  spo2_pct           integer check (spo2_pct is null or spo2_pct between 50 and 100),
  glucose_mmol_l     numeric check (glucose_mmol_l is null or glucose_mmol_l between 0.5 and 60),
  glucose_context    public.glucose_context,
  bp_readings        jsonb not null default '[]'::jsonb check (jsonb_typeof(bp_readings) = 'array'),
  vitals_reading_ids uuid[] not null default '{}',
  equipment          jsonb not null default '{}'::jsonb,
  entered_by         uuid references public.profiles (id) on delete set null,
  entered_at         timestamptz not null default now(),
  is_test            boolean not null default false
);

create table public.poc_panel_versions (
  id          uuid primary key default gen_random_uuid(),
  panel_code  text not null check (panel_code in ('poc_urinalysis', 'poc_hba1c')),
  version     integer not null check (version >= 1),
  is_active   boolean not null default true,
  analytes    jsonb not null check (jsonb_typeof(analytes) = 'array'),
  note        text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (panel_code, version)
);
create unique index poc_panel_versions_one_active on public.poc_panel_versions (panel_code) where is_active;

-- PROPOSED values, not signed (same status as lab_panel_versions membership_annual v1). A 10-parameter dipstick read by eye or
-- reader. "ordinal" = a reading on the strip scale; "normal" lists the readings that count as normal.
insert into public.poc_panel_versions (panel_code, version, is_active, analytes, note) values
 ('poc_urinalysis', 1, true, $json$[
  {"code":"glucose","label":"Glucose","kind":"ordinal","allowed":["negative","trace","1+","2+","3+","4+"],"normal":["negative"]},
  {"code":"bilirubin","label":"Bilirubin","kind":"ordinal","allowed":["negative","1+","2+","3+"],"normal":["negative"]},
  {"code":"ketones","label":"Ketones","kind":"ordinal","allowed":["negative","trace","1+","2+","3+"],"normal":["negative"]},
  {"code":"specific_gravity","label":"Specific gravity","kind":"numeric","unit":"","refLow":1.005,"refHigh":1.030},
  {"code":"blood","label":"Blood","kind":"ordinal","allowed":["negative","trace","1+","2+","3+"],"normal":["negative"]},
  {"code":"ph","label":"pH","kind":"numeric","unit":"","refLow":5.0,"refHigh":8.0},
  {"code":"protein","label":"Protein","kind":"ordinal","allowed":["negative","trace","1+","2+","3+","4+"],"normal":["negative","trace"]},
  {"code":"urobilinogen","label":"Urobilinogen","kind":"ordinal","allowed":["normal","1+","2+","3+","4+"],"normal":["normal"]},
  {"code":"nitrite","label":"Nitrite","kind":"ordinal","allowed":["negative","positive"],"normal":["negative"]},
  {"code":"leukocytes","label":"Leukocytes","kind":"ordinal","allowed":["negative","trace","1+","2+","3+"],"normal":["negative"]}
 ]$json$::jsonb,
 'PROPOSED 10-parameter dipstick scale and normal readings. Not signed. The CMO approves it before any urinalysis result can auto-release.'),
 ('poc_hba1c', 1, true, $json$[
  {"code":"hba1c","label":"HbA1c","kind":"numeric","unit":"%","refLow":4.0,"refHigh":5.6,"criticalHigh":14}
 ]$json$::jsonb,
 'PROPOSED. Same limits as the Membership annual panel v1 HbA1c. Not signed.');

create table public.poc_results (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete restrict,
  booking_id       uuid not null references public.testing_event_bookings (id) on delete restrict,
  kind             text not null check (kind in ('urinalysis', 'hba1c')),
  panel_version_id uuid not null references public.poc_panel_versions (id),
  release_state    text not null default 'awaiting_review' check (release_state in ('awaiting_review', 'released', 'withheld')),
  release_reason   text,
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  review_note      text,
  released_at      timestamptz,
  withheld_reason  text,
  entered_by       uuid references public.profiles (id) on delete set null,
  entered_at       timestamptz not null default now(),
  is_test          boolean not null default false,
  unique (booking_id, kind),
  check (release_state <> 'released' or (released_at is not null and release_reason is not null)),
  check (release_state <> 'withheld' or withheld_reason is not null)
);
create index poc_results_patient_idx on public.poc_results (patient_id, entered_at desc);
create index poc_results_held_idx on public.poc_results (release_state) where release_state = 'awaiting_review';

create table public.poc_result_items (
  id              uuid primary key default gen_random_uuid(),
  poc_result_id   uuid not null references public.poc_results (id),
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id),
  analyte_code    text not null,
  value_numeric   numeric,
  value_text      text,
  unit            text not null default '',
  flag            text not null check (flag in ('normal', 'abnormal', 'low', 'high', 'critical')),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (poc_result_id, analyte_code),
  check ((value_numeric is not null) <> (value_text is not null))
);

create function private.poc_result_items_append_only() returns trigger language plpgsql security definer set search_path = ''
as $$ begin raise exception 'poc_result_items_append_only' using errcode = '42501'; end; $$;
revoke all on function private.poc_result_items_append_only() from public, anon, authenticated;
create trigger poc_result_items_no_change before update or delete on public.poc_result_items
  for each row execute function private.poc_result_items_append_only();

-- The state machine for point-of-care results (INV-03). Every release passes here, whoever or whatever writes the row.
create function private.guard_poc_result() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_bad integer; v_items integer; v_ver public.poc_panel_versions%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.release_state <> 'awaiting_review' then raise exception 'poc_result_must_start_held' using errcode = '42501'; end if;
    return new;
  end if;
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.booking_id is distinct from old.booking_id or new.kind is distinct from old.kind
     or new.panel_version_id is distinct from old.panel_version_id or new.entered_at is distinct from old.entered_at then
    raise exception 'poc_result_immutable' using errcode = '42501';
  end if;
  if new.release_state = old.release_state then return new; end if;
  if old.release_state <> 'awaiting_review' then raise exception 'poc_result_final' using errcode = '42501'; end if;
  if new.release_state = 'released' then
    if new.release_reason = 'RES-001' then
      -- automatic release: only a complete all-normal result, and only once the CMO has approved BOTH this point-of-care
      -- panel and the lab panels (INV-14)
      select * into v_ver from public.poc_panel_versions where id = new.panel_version_id;
      select count(*), count(*) filter (where flag <> 'normal') into v_items, v_bad
        from public.poc_result_items where poc_result_id = new.id;
      if v_items = 0 or v_bad > 0 or v_ver.approved_at is null or not private.lab_panels_signed() then
        raise exception 'poc_result_not_auto_releasable' using errcode = '42501';
      end if;
    else
      if new.reviewed_by is null then raise exception 'poc_result_release_needs_clinician' using errcode = '42501'; end if;
      new.release_reason := 'clinician_review';
    end if;
    new.released_at := coalesce(new.released_at, now());
  elsif new.release_state = 'withheld' then
    if new.reviewed_by is null or coalesce(btrim(new.withheld_reason), '') = '' then
      raise exception 'poc_result_withhold_needs_reason' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_poc_result() from public, anon, authenticated;
create trigger poc_results_guard before insert or update on public.poc_results
  for each row execute function private.guard_poc_result();

create table public.poc_ecg_recordings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete restrict,
  booking_id        uuid not null unique references public.testing_event_bookings (id) on delete restrict,
  file_path         text not null check (btrim(file_path) <> ''),
  mime_type         text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml')),
  file_size_bytes   bigint not null check (file_size_bytes > 0 and file_size_bytes <= 20971520),
  device_label      text,
  -- whatever the machine printed on the trace. Staff and doctors see it; it is NEVER shown to the patient and never acted on.
  machine_statement text,
  recorded_by       uuid references public.profiles (id) on delete set null,
  recorded_at       timestamptz not null default now(),
  release_state     text not null default 'awaiting_interpretation'
                    check (release_state in ('awaiting_interpretation', 'released', 'withheld')),
  interpretation_class text check (interpretation_class in ('normal', 'abnormal', 'urgent')),
  interpretation    text,
  interpreted_by    uuid references public.profiles (id),
  interpreted_at    timestamptz,
  withheld_reason   text,
  is_test           boolean not null default false,
  check (release_state <> 'released' or (interpreted_by is not null and interpreted_at is not null
         and interpretation_class is not null and coalesce(btrim(interpretation), '') <> '')),
  check (release_state <> 'withheld' or withheld_reason is not null)
);

create function private.guard_poc_ecg() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.release_state <> 'awaiting_interpretation' then raise exception 'ecg_must_start_unread' using errcode = '42501'; end if;
    return new;
  end if;
  if new.patient_id is distinct from old.patient_id or new.booking_id is distinct from old.booking_id
     or new.file_path is distinct from old.file_path or new.machine_statement is distinct from old.machine_statement
     or new.recorded_at is distinct from old.recorded_at then
    raise exception 'ecg_immutable' using errcode = '42501';
  end if;
  if new.release_state <> old.release_state then
    if old.release_state <> 'awaiting_interpretation' then raise exception 'ecg_final' using errcode = '42501'; end if;
    -- there is no automatic path: a person with a clinician login wrote the interpretation (the CHECK also demands the text)
    if new.release_state = 'released' and (new.interpreted_by is null
       or not exists (select 1 from public.profiles p where p.id = new.interpreted_by and p.role = 'clinician')) then
      raise exception 'ecg_release_needs_clinician' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_poc_ecg() from public, anon, authenticated;
create trigger poc_ecg_guard before insert or update on public.poc_ecg_recordings
  for each row execute function private.guard_poc_ecg();

-- ---------------------------------------------------------------------------
-- 3. RLS: patients read only released rows; every write and every staff read goes through a checked function.
-- ---------------------------------------------------------------------------
alter table public.testing_events enable row level security;
alter table public.testing_event_team enable row level security;
alter table public.testing_event_bookings enable row level security;
alter table public.poc_measurements enable row level security;
alter table public.poc_panel_versions enable row level security;
alter table public.poc_results enable row level security;
alter table public.poc_result_items enable row level security;
alter table public.poc_ecg_recordings enable row level security;

revoke all on public.testing_events, public.testing_event_team, public.testing_event_bookings, public.poc_measurements,
  public.poc_panel_versions, public.poc_results, public.poc_result_items, public.poc_ecg_recordings from public, anon, authenticated;

create policy testing_event_bookings_own on public.testing_event_bookings for select to authenticated
  using (patient_id = (select auth.uid()));
create policy poc_measurements_own on public.poc_measurements for select to authenticated
  using (patient_id = (select auth.uid()));
create policy poc_panel_versions_read on public.poc_panel_versions for select to authenticated using (true);
create policy poc_results_released_own on public.poc_results for select to authenticated
  using (patient_id = (select auth.uid()) and release_state = 'released');
create policy poc_result_items_released_own on public.poc_result_items for select to authenticated
  using (patient_id = (select auth.uid())
         and exists (select 1 from public.poc_results r where r.id = poc_result_items.poc_result_id and r.release_state = 'released'));
-- testing_events, testing_event_team and poc_ecg_recordings have no policy: reached only through the functions below.

grant select on public.testing_event_bookings, public.poc_measurements, public.poc_panel_versions, public.poc_results,
  public.poc_result_items to authenticated;
-- events and ECG recordings: RLS on, no policy, no grant to a signed-in role

-- ---------------------------------------------------------------------------
-- 4. Task type, notices
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('ecg_interpretation', 1, 3, 1440, 'senior_medical_officer', '{result_review}', 0, 30, false, true, '{}',
   'Two-tier model: a point-of-care ECG recorded at a testing day or employer visit. A doctor reads the trace and writes the interpretation. Never auto-read, never auto-released.');

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('testing_day_confirmed',  'operational', 'routine', 'patient', array['in_app','push','email']::public.notification_channel[], 'immediate', 'Your place is held. Names no test or condition (INV-07).'),
  ('testing_day_waitlisted', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'On the waiting list. Neutral.'),
  ('testing_day_promoted',   'operational', 'routine', 'patient', array['in_app','push','email']::public.notification_channel[], 'immediate', 'A place opened and was given to you. Neutral.'),
  ('testing_day_reminder',   'operational', 'routine', 'patient', array['in_app','push','email']::public.notification_channel[], 'scheduled', 'Reminder 7 days and 1 day before. Neutral.'),
  ('testing_day_cancelled',  'operational', 'routine', 'patient', array['in_app','push','email']::public.notification_channel[], 'immediate', 'The day was cancelled or your place released. Neutral.'),
  ('poc_result_ready',       'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Something new is waiting in the app. Names no test, value or flag (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('testing_day_confirmed', 'en', 'in_app', 'Your place is held', 'Your visit is booked. Open the app for the date, the place and what to bring.'),
  ('testing_day_confirmed', 'en', 'push', 'Your place is held', 'Open the app for the date and place.'),
  ('testing_day_confirmed', 'en', 'email', 'Your place is held', 'Your visit is booked. Open the app for the date, the place and what to bring.'),
  ('testing_day_waitlisted', 'en', 'in_app', 'You are on the waiting list', 'The day is full. If a place opens we will give it to you and tell you.'),
  ('testing_day_waitlisted', 'en', 'push', 'You are on the waiting list', 'Open the app for details.'),
  ('testing_day_promoted', 'en', 'in_app', 'A place opened for you', 'A place opened and is now yours. Open the app for the date and place.'),
  ('testing_day_promoted', 'en', 'push', 'A place opened for you', 'Open the app for the date and place.'),
  ('testing_day_promoted', 'en', 'email', 'A place opened for you', 'A place opened and is now yours. Open the app for the date and place.'),
  ('testing_day_reminder', 'en', 'in_app', 'Your visit is coming up', 'A reminder about your visit. Open the app for the date and place.'),
  ('testing_day_reminder', 'en', 'push', 'Your visit is coming up', 'Open the app for the date and place.'),
  ('testing_day_reminder', 'en', 'email', 'Your visit is coming up', 'A reminder about your visit. Open the app for the date and place.'),
  ('testing_day_cancelled', 'en', 'in_app', 'Your visit has changed', 'Your booking has changed. Open the app to choose another date.'),
  ('testing_day_cancelled', 'en', 'push', 'Your visit has changed', 'Open the app to choose another date.'),
  ('testing_day_cancelled', 'en', 'email', 'Your visit has changed', 'Your booking has changed. Open the app to choose another date.'),
  ('poc_result_ready', 'en', 'in_app', 'Something is waiting for you', 'Your care team has added something to your health record. Open the app to see it.'),
  ('poc_result_ready', 'en', 'push', 'Something is waiting for you', 'Open the app to see it.')
on conflict (template_key, locale, channel) do nothing;

-- one notifier for this family: in-app always, push and email where the template lists them. Payload carries opaque ids only.
create function private.testing_notify(p_recipient uuid, p_org uuid, p_template text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_ch public.notification_channel[]; c public.notification_channel; v_email text;
begin
  select default_channels into v_ch from public.notification_templates where key = p_template;
  if v_ch is null then v_ch := array['in_app']::public.notification_channel[]; end if;
  select email into v_email from auth.users where id = p_recipient;
  foreach c in array v_ch loop
    if c = 'email' and coalesce(v_email, '') = '' then continue; end if;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (p_org, p_recipient, c, 'pending', p_template, coalesce(p_payload, '{}'::jsonb));
  end loop;
end;
$$;
revoke all on function private.testing_notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Staff: schedule events
-- ---------------------------------------------------------------------------
create function public.create_testing_event(
  p_kind text, p_event_date date, p_starts_at time, p_ends_at time, p_venue_name text, p_address text, p_city text,
  p_lga text, p_state text, p_capacity integer, p_lab_provider uuid, p_notes text default null,
  p_employer_org uuid default null, p_headcount integer default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_kind = 'public_day' and p_event_date < private.lagos_today() then raise exception 'testing_event_date_in_past' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v;
  if p_employer_org is not null and not exists (select 1 from public.organisations where id = p_employer_org) then
    raise exception 'unknown employer organisation' using errcode = '22023';
  end if;
  if p_lab_provider is not null and not exists (select 1 from public.lab_providers where id = p_lab_provider) then
    raise exception 'unknown laboratory' using errcode = '22023';
  end if;
  insert into public.testing_events (organisation_id, kind, event_date, starts_at, ends_at, venue_name, address, city, lga, state,
      capacity, lab_provider_id, notes, employer_org_id, headcount_requested, created_by, is_test)
  values (v_org, p_kind, p_event_date, p_starts_at, p_ends_at, p_venue_name, p_address, p_city, nullif(btrim(p_lga), ''),
      nullif(btrim(p_state), ''), p_capacity, p_lab_provider, p_notes, p_employer_org, p_headcount, v,
      coalesce((select is_test from public.profiles where id = v), false))
  returning id into v_id;
  perform private.log_audit('testing_event.created', 'testing_events', v_id, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

create function public.set_testing_event_team(p_event uuid, p_team jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare t jsonb;
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.testing_events where id = p_event) then raise exception 'testing_event_not_found' using errcode = '22023'; end if;
  if jsonb_typeof(p_team) <> 'array' then raise exception 'team must be a list' using errcode = '22023'; end if;
  delete from public.testing_event_team where event_id = p_event;
  for t in select * from jsonb_array_elements(p_team) loop
    insert into public.testing_event_team (event_id, profile_id, station)
    values (p_event, (t ->> 'profile_id')::uuid, t ->> 'station');
  end loop;
  perform private.log_audit('testing_event.team_set', 'testing_events', p_event, jsonb_build_object('size', jsonb_array_length(p_team)));
end;
$$;

-- staff fill in what an employer request does not carry (the lab, the real capacity, the times, a venue name); never below the seats taken
create function public.update_testing_event(p_event uuid, p_lab_provider uuid, p_capacity integer, p_starts_at time, p_ends_at time, p_venue_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.testing_events%rowtype;
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into e from public.testing_events where id = p_event for update;
  if not found or e.status not in ('requested', 'scheduled', 'open') then raise exception 'testing_event_not_found_or_not_editable' using errcode = '22023'; end if;
  if p_lab_provider is not null and not exists (select 1 from public.lab_providers where id = p_lab_provider) then
    raise exception 'unknown laboratory' using errcode = '22023';
  end if;
  if p_capacity < private.testing_seats_taken(p_event) then raise exception 'capacity_below_seats_taken' using errcode = '22023'; end if;
  update public.testing_events
     set lab_provider_id = coalesce(p_lab_provider, lab_provider_id), capacity = p_capacity,
         starts_at = coalesce(p_starts_at, starts_at), ends_at = coalesce(p_ends_at, ends_at),
         venue_name = coalesce(nullif(btrim(p_venue_name), ''), venue_name)
   where id = p_event;
  if e.status = 'open' then perform private.testing_promote_waitlist(p_event); end if;
  perform private.log_audit('testing_event.updated', 'testing_events', p_event, '{}'::jsonb);
end;
$$;

create function public.approve_testing_event_venue(p_event uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  update public.testing_events set venue_approved_by = (select auth.uid()), venue_approved_at = now()
   where id = p_event and status in ('requested', 'scheduled');
  if not found then raise exception 'testing_event_not_found_or_not_editable' using errcode = '22023'; end if;
  perform private.log_audit('testing_event.venue_approved', 'testing_events', p_event, '{}'::jsonb);
end;
$$;

-- release every live place on an event (cancel), telling each person once
create function private.testing_release_event_places(p_event uuid, p_reason text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare b public.testing_event_bookings%rowtype; n integer := 0;
begin
  for b in select * from public.testing_event_bookings where event_id = p_event and state in ('confirmed', 'waitlisted') loop
    update public.testing_event_bookings set state = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason where id = b.id;
    perform private.testing_notify(b.patient_id, b.organisation_id, 'testing_day_cancelled', jsonb_build_object('booking_id', b.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.testing_release_event_places(uuid, text) from public, anon, authenticated;

create function public.set_testing_event_status(p_event uuid, p_status text) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.testing_events%rowtype;
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into e from public.testing_events where id = p_event for update;
  if not found then raise exception 'testing_event_not_found' using errcode = '22023'; end if;
  if (e.status, p_status) not in (('requested','scheduled'), ('scheduled','open'), ('open','closed'), ('closed','open'),
      ('open','completed'), ('closed','completed'), ('scheduled','completed'), ('requested','cancelled'), ('scheduled','cancelled'),
      ('open','cancelled'), ('closed','cancelled')) then
    raise exception 'testing_event_bad_transition' using errcode = '22023';
  end if;
  if p_status = 'open' and e.kind = 'public_day' then
    if e.lab_provider_id is null or e.venue_approved_at is null then raise exception 'testing_event_needs_lab_and_venue_approval' using errcode = '22023'; end if;
    if not exists (select 1 from public.lab_providers lp where lp.id = e.lab_provider_id and lp.is_active) then
      raise exception 'testing_event_lab_not_active' using errcode = '22023';
    end if;
  end if;
  update public.testing_events set status = p_status where id = p_event;
  if p_status = 'cancelled' then perform private.testing_release_event_places(p_event, 'event_cancelled'); end if;
  if p_status = 'completed' then
    update public.testing_event_bookings set state = 'no_show' where event_id = p_event and state in ('confirmed', 'waitlisted');
  end if;
  perform private.log_audit('testing_event.status', 'testing_events', p_event, jsonb_build_object('to', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Member: list, hold a place, cancel, reschedule
-- ---------------------------------------------------------------------------
create function private.testing_seats_taken(p_event uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::integer from public.testing_event_bookings where event_id = p_event and state in ('confirmed', 'checked_in'); $$;
revoke all on function private.testing_seats_taken(uuid) from public, anon, authenticated;

create function public.list_testing_days(p_city text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.patient_is_member(v) then raise exception 'membership_required' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'event_date', e.event_date, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue_name', e.venue_name,
      'address', e.address, 'city', e.city, 'lga', e.lga, 'state', e.state,
      'seats_left', greatest(e.capacity - private.testing_seats_taken(e.id), 0),
      'full', private.testing_seats_taken(e.id) >= e.capacity,
      'my_booking_id', b.id, 'my_state', b.state) order by e.event_date, e.starts_at)
    from public.testing_events e
    left join public.testing_event_bookings b on b.event_id = e.id and b.patient_id = v and b.state in ('confirmed', 'waitlisted', 'checked_in')
    where e.kind = 'public_day' and e.status = 'open' and e.event_date >= private.lagos_today()
      and (p_city is null or lower(e.city) = lower(btrim(p_city)))
  ), '[]'::jsonb);
end;
$$;

-- the shared booking core; p_from is the booking being moved (reschedule), cancelled by the caller only after this succeeds
create function private.testing_book(p_patient uuid, p_event uuid, p_from uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare e public.testing_events%rowtype; pr public.profiles%rowtype; v_state text; v_id uuid;
begin
  select * into e from public.testing_events where id = p_event for update;
  if not found or e.kind <> 'public_day' or e.status <> 'open' or e.event_date < private.lagos_today() then
    raise exception 'testing_day_not_available' using errcode = '22023';
  end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  if not private.patient_is_member(p_patient) then raise exception 'membership_required' using errcode = '42501'; end if;
  -- idempotent: a second tap returns the same booking
  select id into v_id from public.testing_event_bookings
   where event_id = p_event and patient_id = p_patient and state in ('confirmed', 'waitlisted', 'checked_in');
  if v_id is not null then return v_id; end if;
  v_state := case when private.testing_seats_taken(p_event) < e.capacity then 'confirmed' else 'waitlisted' end;
  insert into public.testing_event_bookings (event_id, organisation_id, patient_id, kind, state, rescheduled_from, is_test)
  values (p_event, pr.organisation_id, p_patient, 'public_day', v_state, p_from, pr.is_test) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.testing_book(uuid, uuid, uuid) from public, anon, authenticated;

create function public.book_testing_day(p_event uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); v_id uuid; b public.testing_event_bookings%rowtype;
begin
  if v is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- one public-day place at a time: a different upcoming booking must be moved (reschedule) or cancelled first
  if exists (select 1 from public.testing_event_bookings x where x.patient_id = v and x.kind = 'public_day'
               and x.state in ('confirmed', 'waitlisted') and x.event_id <> p_event) then
    raise exception 'already_booked_use_reschedule' using errcode = '22023';
  end if;
  v_id := private.testing_book(v, p_event);
  select * into b from public.testing_event_bookings where id = v_id;
  if not exists (select 1 from public.notifications where recipient_id = v and template in ('testing_day_confirmed', 'testing_day_waitlisted')
                   and payload ->> 'booking_id' = v_id::text) then
    perform private.testing_notify(v, b.organisation_id,
      case when b.state = 'confirmed' then 'testing_day_confirmed' else 'testing_day_waitlisted' end, jsonb_build_object('booking_id', v_id));
  end if;
  perform private.log_audit('testing_booking.created', 'testing_event_bookings', v_id, jsonb_build_object('state', b.state));
  return jsonb_build_object('booking_id', v_id, 'state', b.state);
end;
$$;

-- give a freed place to the first person waiting
create function private.testing_promote_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.testing_events%rowtype; w public.testing_event_bookings%rowtype;
begin
  select * into e from public.testing_events where id = p_event for update;
  if not found or e.status <> 'open' then return; end if;
  while private.testing_seats_taken(p_event) < e.capacity loop
    select * into w from public.testing_event_bookings where event_id = p_event and state = 'waitlisted' order by booked_at, id limit 1;
    exit when not found;
    update public.testing_event_bookings set state = 'confirmed' where id = w.id;
    perform private.testing_notify(w.patient_id, w.organisation_id, 'testing_day_promoted', jsonb_build_object('booking_id', w.id));
  end loop;
end;
$$;
revoke all on function private.testing_promote_waitlist(uuid) from public, anon, authenticated;

create function public.cancel_testing_booking(p_booking uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare b public.testing_event_bookings%rowtype;
begin
  select * into b from public.testing_event_bookings where id = p_booking and patient_id = (select auth.uid()) for update;
  if not found then raise exception 'booking_not_found' using errcode = '22023'; end if;
  if b.state not in ('confirmed', 'waitlisted') then raise exception 'booking_not_cancellable' using errcode = '22023'; end if;
  update public.testing_event_bookings set state = 'cancelled', cancelled_at = now(),
         cancelled_reason = coalesce(nullif(btrim(p_reason), ''), 'member_cancelled') where id = p_booking;
  perform private.testing_promote_waitlist(b.event_id);
  perform private.log_audit('testing_booking.cancelled', 'testing_event_bookings', p_booking, '{}'::jsonb);
end;
$$;

-- move to another day. The new place is taken first; if it is full the old place is kept (never leave someone with nothing).
create function public.reschedule_testing_booking(p_booking uuid, p_new_event uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype; v_new uuid; n public.testing_event_bookings%rowtype;
begin
  select * into b from public.testing_event_bookings where id = p_booking and patient_id = v for update;
  if not found or b.state not in ('confirmed', 'waitlisted') then raise exception 'booking_not_cancellable' using errcode = '22023'; end if;
  if b.event_id = p_new_event then raise exception 'same_day' using errcode = '22023'; end if;
  -- release the old place first inside this transaction so the one-place index allows the new row; a full target day rolls it all back
  update public.testing_event_bookings set state = 'cancelled', cancelled_at = now(), cancelled_reason = 'rescheduled' where id = p_booking;
  v_new := private.testing_book(v, p_new_event, p_booking);
  select * into n from public.testing_event_bookings where id = v_new;
  if n.state = 'waitlisted' then
    raise exception 'new_day_full_keep_current' using errcode = '22023';
  end if;
  perform private.testing_promote_waitlist(b.event_id);
  perform private.testing_notify(v, n.organisation_id, 'testing_day_confirmed', jsonb_build_object('booking_id', v_new));
  perform private.log_audit('testing_booking.rescheduled', 'testing_event_bookings', v_new, jsonb_build_object('from', p_booking));
  return jsonb_build_object('booking_id', v_new, 'state', n.state);
end;
$$;

create function public.my_testing_bookings() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_id', b.id, 'state', b.state, 'kind', b.kind, 'event_id', e.id, 'event_date', e.event_date, 'starts_at', e.starts_at,
    'venue_name', e.venue_name, 'address', e.address, 'city', e.city, 'event_status', e.status,
    'waitlist_position', case when b.state = 'waitlisted' then
       (select count(*) from public.testing_event_bookings w where w.event_id = b.event_id and w.state = 'waitlisted'
          and (w.booked_at, w.id) <= (b.booked_at, b.id)) end)
    order by e.event_date desc), '[]'::jsonb)
  from public.testing_event_bookings b join public.testing_events e on e.id = b.event_id
  where b.patient_id = (select auth.uid());
$$;

-- reminders at 7 days and 1 day; called by the daily cron with the service role. Safe to run twice (stamps once).
create function public.send_testing_day_reminders() returns integer
language plpgsql security definer set search_path = ''
as $$
declare b public.testing_event_bookings%rowtype; n integer := 0; v_days integer;
begin
  for b in select x.* from public.testing_event_bookings x join public.testing_events e on e.id = x.event_id
            where x.state = 'confirmed' and e.status in ('open', 'closed', 'scheduled') and e.event_date > private.lagos_today() loop
    select (e.event_date - private.lagos_today()) into v_days from public.testing_events e where e.id = b.event_id;
    if v_days <= 7 and v_days > 1 and b.reminder_7d_at is null then
      update public.testing_event_bookings set reminder_7d_at = now() where id = b.id;
      perform private.testing_notify(b.patient_id, b.organisation_id, 'testing_day_reminder', jsonb_build_object('booking_id', b.id));
      n := n + 1;
    elsif v_days <= 1 and b.reminder_1d_at is null then
      update public.testing_event_bookings set reminder_1d_at = now(), reminder_7d_at = coalesce(reminder_7d_at, now()) where id = b.id;
      perform private.testing_notify(b.patient_id, b.organisation_id, 'testing_day_reminder', jsonb_build_object('booking_id', b.id));
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Station A: check-in, lab order and labelled specimen
-- ---------------------------------------------------------------------------
-- The origin guard (private.enforce_lab_order_origin) demands, for a patient_initiated order, a self-bookable bundle or a due screening
-- schedule, and for anything else a clinician in ordered_by. The Membership annual panel is neither. Its live text is read and ONE
-- clause added (so nothing else in it can drift): the annual panel passes only while check_in_testing_booking has set a
-- transaction-local setting that no table grant, policy or REST call can set.
do $$
declare
  v_def text;
  v_old constant text := E'    if new.screening_schedule_id is null then\n      raise exception ''Self-service lab orders must be linked';
  v_new constant text := E'    if new.panel_code = ''membership_annual'' and coalesce(current_setting(''tarragon.testing_day_checkin'', true), '''') = ''on'' then\n      return new;\n    end if;\n\n' || E'    if new.screening_schedule_id is null then\n      raise exception ''Self-service lab orders must be linked';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_lab_order_origin';
  if v_def is null then raise exception 'testing days: private.enforce_lab_order_origin not found'; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'testing days: expected exactly one schedule check in private.enforce_lab_order_origin';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

create function public.check_in_testing_booking(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype; e public.testing_events%rowtype;
        v_order uuid; v_spec uuid; v_num text;
begin
  if not private.can_run_testing_day() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into b from public.testing_event_bookings where id = p_booking for update;
  if not found then raise exception 'booking_not_found' using errcode = '22023'; end if;
  select * into e from public.testing_events where id = b.event_id;
  if b.state = 'checked_in' then
    select specimen_number into v_num from public.lab_specimens where id = b.specimen_id;
    return jsonb_build_object('booking_id', b.id, 'lab_order_id', b.lab_order_id, 'specimen_id', b.specimen_id, 'specimen_number', v_num, 'already', true);
  end if;
  if b.state <> 'confirmed' then raise exception 'booking_not_confirmed' using errcode = '22023'; end if;
  if e.event_date <> private.lagos_today() then raise exception 'not_the_day_of_the_event' using errcode = '22023'; end if;
  if e.status not in ('open', 'closed', 'scheduled') then raise exception 'testing_event_not_running' using errcode = '22023'; end if;
  if e.lab_provider_id is null then raise exception 'testing_event_has_no_lab' using errcode = '22023'; end if;
  if not private.patient_is_member(b.patient_id) then raise exception 'membership_required' using errcode = '42501'; end if;
  -- the annual panel is once a year: an earlier live order for it blocks a second (a cancelled order or a rejected sample does not)
  if exists (select 1 from public.lab_orders o where o.patient_id = b.patient_id and o.panel_code = 'membership_annual'
               and o.status not in ('cancelled', 'sample_rejected') and o.ordered_at > now() - interval '330 days'
               and o.id is distinct from b.lab_order_id) then
    raise exception 'annual_check_already_started' using errcode = '22023';
  end if;
  -- The order is the Membership's own annual panel, made at the desk by a function (not a clinician), so ordered_by stays empty and
  -- the origin guard is told, for this transaction only, that this is the testing-day path (see the patch above). It is inserted
  -- unpaid and then confirmed, the same two steps every partner-billed order takes (the existing triggers force the first state for a
  -- non-clinician and queue the transmission on the second): the Membership is the payment. The team couriers the tubes to the lab
  -- the same day and staff mark the order sent with the existing lab-order transmission step.
  perform set_config('tarragon.testing_day_checkin', 'on', true);
  insert into public.lab_orders (organisation_id, patient_id, provider_id, status, panel_code, fulfilment, transmission, origin,
                                 scheduled_date, courier_reference, clinical_indication)
  values (b.organisation_id, b.patient_id, e.lab_provider_id, 'pending_payment', 'membership_annual', 'partner', 'awaiting_payment',
          'patient_initiated', e.event_date, 'TD-' || substr(e.id::text, 1, 8), 'Membership annual check taken at a testing day')
  returning id into v_order;
  perform set_config('tarragon.testing_day_checkin', 'off', true);
  update public.lab_orders set status = 'payment_confirmed' where id = v_order;
  -- the trigger on the order makes the specimen row (and its SPX number) when the order becomes payable; make it only if it did not
  select id, specimen_number into v_spec, v_num from public.lab_specimens where lab_order_id = v_order order by created_at limit 1;
  if v_spec is null then
    insert into public.lab_specimens (organisation_id, lab_order_id, patient_id, provider_id)
    values (b.organisation_id, v_order, b.patient_id, e.lab_provider_id) returning id, specimen_number into v_spec, v_num;
  end if;
  update public.lab_specimens set courier_reference = 'TD-' || substr(e.id::text, 1, 8) where id = v_spec;
  update public.testing_event_bookings set state = 'checked_in', checked_in_at = now(), checked_in_by = v,
         lab_order_id = v_order, specimen_id = v_spec where id = p_booking;
  perform private.log_audit('testing_booking.checked_in', 'testing_event_bookings', p_booking,
    jsonb_build_object('lab_order_id', v_order, 'specimen_id', v_spec));
  return jsonb_build_object('booking_id', p_booking, 'lab_order_id', v_order, 'specimen_id', v_spec, 'specimen_number', v_num, 'already', false);
end;
$$;

-- Station C: the draw is recorded against the labelled specimen
create function public.record_testing_blood_draw(p_booking uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype;
begin
  if not private.can_run_testing_day() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into b from public.testing_event_bookings where id = p_booking for update;
  if not found or b.state <> 'checked_in' then raise exception 'booking_not_checked_in' using errcode = '22023'; end if;
  if b.blood_drawn_at is not null then return; end if;
  update public.testing_event_bookings set blood_drawn_at = now(), blood_drawn_by = v where id = p_booking;
  update public.lab_specimens set status = 'collected', collected_at = now() where id = b.specimen_id and status = 'pending_collection';
  update public.lab_orders set status = 'sample_collected', sample_collected_at = now() where id = b.lab_order_id and status in ('payment_confirmed', 'ordered');
  perform private.log_audit('testing_booking.blood_drawn', 'testing_event_bookings', p_booking, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Station B: measurements, then classified point-of-care results
-- ---------------------------------------------------------------------------
create function private.poc_booking_for_entry(p_booking uuid) returns public.testing_event_bookings
language plpgsql security definer set search_path = ''
as $$
declare b public.testing_event_bookings%rowtype;
begin
  if not private.can_run_testing_day() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into b from public.testing_event_bookings where id = p_booking for update;
  if not found or b.state <> 'checked_in' then raise exception 'booking_not_checked_in' using errcode = '22023'; end if;
  return b;
end;
$$;
revoke all on function private.poc_booking_for_entry(uuid) from public, anon, authenticated;

create function public.record_poc_measurements(p_booking uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype;
  v_h numeric := nullif(p_data ->> 'height_cm', '')::numeric;
  v_w numeric := nullif(p_data ->> 'weight_kg', '')::numeric;
  v_pulse integer := nullif(p_data ->> 'pulse_bpm', '')::integer;
  v_spo2 integer := nullif(p_data ->> 'spo2_pct', '')::integer;
  v_glu numeric := nullif(p_data ->> 'glucose_mmol_l', '')::numeric;
  v_ctx public.glucose_context := coalesce(nullif(p_data ->> 'glucose_context', '')::public.glucose_context, 'random');
  v_bp jsonb := coalesce(p_data -> 'bp_readings', '[]'::jsonb);
  r jsonb; v_ids uuid[] := '{}'; v_id uuid; v_bmi numeric;
begin
  b := private.poc_booking_for_entry(p_booking);
  if jsonb_typeof(v_bp) <> 'array' or jsonb_array_length(v_bp) > 5 then raise exception 'bp_readings must be a list of at most 5' using errcode = '22023'; end if;
  if exists (select 1 from public.poc_measurements where booking_id = p_booking) then raise exception 'poc_measurements_already_recorded' using errcode = '22023'; end if;
  if v_h is not null and v_w is not null then v_bmi := round(v_w / ((v_h / 100.0) ^ 2), 1); end if;

  -- blood pressure: each protocol reading is its own vitals_readings row (the existing red-flag triggers apply)
  for r in select * from jsonb_array_elements(v_bp) loop
    if (r ->> 'systolic')::integer not between 50 and 300 or (r ->> 'diastolic')::integer not between 20 and 200
       or (r ->> 'diastolic')::integer >= (r ->> 'systolic')::integer then
      raise exception 'bp_reading_out_of_range' using errcode = '22023';
    end if;
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, note,
                                        logged_by_profile_id, position, arm, cuff_type)
    values (b.organisation_id, b.patient_id, 'blood_pressure', (r ->> 'systolic')::integer, (r ->> 'diastolic')::integer, 'device', now(),
            'Taken at a testing day', v, coalesce(nullif(r ->> 'position', ''), 'seated'), nullif(r ->> 'arm', ''), 'upper_arm')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  if v_glu is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at, note, logged_by_profile_id)
    values (b.organisation_id, b.patient_id, 'glucose', v_glu, v_ctx, 'device', now(), 'Taken at a testing day', v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_w is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source, taken_at, note, logged_by_profile_id)
    values (b.organisation_id, b.patient_id, 'weight', v_w, 'device', now(), 'Taken at a testing day', v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_pulse is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at, note, logged_by_profile_id)
    values (b.organisation_id, b.patient_id, 'pulse', v_pulse, 'device', now(), 'Taken at a testing day', v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_spo2 is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at, note, logged_by_profile_id)
    values (b.organisation_id, b.patient_id, 'spo2', v_spo2, 'device', now(), 'Taken at a testing day', v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  insert into public.poc_measurements (booking_id, organisation_id, patient_id, height_cm, weight_kg, bmi, pulse_bpm, spo2_pct,
      glucose_mmol_l, glucose_context, bp_readings, vitals_reading_ids, equipment, entered_by, is_test)
  values (p_booking, b.organisation_id, b.patient_id, v_h, v_w, v_bmi, v_pulse, v_spo2, v_glu, case when v_glu is null then null else v_ctx end,
      v_bp, v_ids, coalesce(p_data -> 'equipment', '{}'::jsonb), v, b.is_test);
  perform private.log_audit('poc.measurements_recorded', 'testing_event_bookings', p_booking, jsonb_build_object('vitals_rows', coalesce(array_length(v_ids, 1), 0)));
  return jsonb_build_object('vitals_rows', coalesce(array_length(v_ids, 1), 0), 'bmi', v_bmi);
end;
$$;

-- the database is the classifier: the client sends a value, never a flag (same rule as the lab panels)
create function private.classify_poc_items(p_version uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_an jsonb; v_def jsonb; v_it jsonb; v_out jsonb := '[]'::jsonb; v_code text; v_num numeric; v_txt text; v_flag text;
begin
  select analytes into v_an from public.poc_panel_versions where id = p_version;
  if v_an is null then raise exception 'poc_panel_version_not_found' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'poc_items_required' using errcode = '22023'; end if;
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_code := v_it ->> 'analyte_code';
    select a into v_def from jsonb_array_elements(v_an) a where a ->> 'code' = v_code;
    if v_def is null then raise exception 'poc_analyte_not_in_panel' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(v_out) o where o ->> 'analyte_code' = v_code) then
      raise exception 'poc_analyte_repeated' using errcode = '22023';
    end if;
    if v_def ->> 'kind' = 'numeric' then
      if v_it ->> 'value_numeric' is null then raise exception 'poc_value_missing' using errcode = '22023'; end if;
      v_num := (v_it ->> 'value_numeric')::numeric;
      if v_num < 0 or v_num > 100000 then raise exception 'poc_value_out_of_bounds' using errcode = '22023'; end if;
      v_flag := case
        when (v_def ? 'criticalHigh') and v_num > (v_def ->> 'criticalHigh')::numeric then 'critical'
        when (v_def ? 'criticalLow') and v_num < (v_def ->> 'criticalLow')::numeric then 'critical'
        when (v_def ? 'refLow') and v_num < (v_def ->> 'refLow')::numeric then 'low'
        when (v_def ? 'refHigh') and v_num > (v_def ->> 'refHigh')::numeric then 'high'
        else 'normal' end;
      v_out := v_out || jsonb_build_object('analyte_code', v_code, 'value_numeric', v_num, 'unit', coalesce(v_def ->> 'unit', ''), 'flag', v_flag);
    else
      v_txt := lower(btrim(coalesce(v_it ->> 'value_text', '')));
      if v_txt = '' then raise exception 'poc_value_missing' using errcode = '22023'; end if;
      if not (v_def -> 'allowed') ? v_txt then raise exception 'poc_value_not_recognised' using errcode = '22023'; end if;
      v_flag := case when (v_def -> 'normal') ? v_txt then 'normal' else 'abnormal' end;
      v_out := v_out || jsonb_build_object('analyte_code', v_code, 'value_text', v_txt, 'unit', '', 'flag', v_flag);
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function private.classify_poc_items(uuid, jsonb) from public, anon, authenticated;

create function private.submit_poc_result(p_booking uuid, p_kind text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype; ver public.poc_panel_versions%rowtype;
  v_code text := case p_kind when 'urinalysis' then 'poc_urinalysis' when 'hba1c' then 'poc_hba1c' end;
  v_items jsonb; it jsonb; v_id uuid; v_bad integer; v_crit integer;
begin
  b := private.poc_booking_for_entry(p_booking);
  select * into ver from public.poc_panel_versions where panel_code = v_code and is_active;
  if not found then raise exception 'poc_panel_version_not_found' using errcode = '22023'; end if;
  if exists (select 1 from public.poc_results where booking_id = p_booking and kind = p_kind) then
    raise exception 'poc_result_already_recorded' using errcode = '22023';
  end if;
  v_items := private.classify_poc_items(ver.id, p_items);
  insert into public.poc_results (organisation_id, patient_id, booking_id, kind, panel_version_id, entered_by, is_test)
  values (b.organisation_id, b.patient_id, p_booking, p_kind, ver.id, v, b.is_test) returning id into v_id;
  for it in select * from jsonb_array_elements(v_items) loop
    insert into public.poc_result_items (poc_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, flag, is_test)
    values (v_id, b.organisation_id, b.patient_id, it ->> 'analyte_code', (it ->> 'value_numeric')::numeric, it ->> 'value_text',
            it ->> 'unit', it ->> 'flag', b.is_test);
  end loop;
  select count(*) filter (where flag <> 'normal'), count(*) filter (where flag = 'critical')
    into v_bad, v_crit from public.poc_result_items where poc_result_id = v_id;
  if v_bad = 0 and ver.approved_at is not null and private.lab_panels_signed() then
    update public.poc_results set release_state = 'released', release_reason = 'RES-001' where id = v_id;
    perform private.testing_notify(b.patient_id, b.organisation_id, 'poc_result_ready', jsonb_build_object('poc_result_id', v_id));
  else
    -- held: a doctor looks at it. Abnormal or critical, or simply unsigned ranges.
    perform private.create_clinical_task(b.patient_id, 'routine_result_review', case when v_crit > 0 then 240 else null end, 'poc_result:' || v_id);
  end if;
  perform private.log_audit('poc.result_recorded', 'poc_results', v_id, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;
revoke all on function private.submit_poc_result(uuid, text, jsonb) from public, anon, authenticated;

create function public.record_poc_urinalysis(p_booking uuid, p_items jsonb) returns uuid
language sql security definer set search_path = ''
as $$ select private.submit_poc_result(p_booking, 'urinalysis', p_items); $$;

create function public.record_poc_hba1c(p_booking uuid, p_value numeric) returns uuid
language sql security definer set search_path = ''
as $$ select private.submit_poc_result(p_booking, 'hba1c', jsonb_build_array(jsonb_build_object('analyte_code', 'hba1c', 'value_numeric', p_value))); $$;

-- ECG: the file is uploaded by the server (service role) to the private bucket poc-ecg, then registered here.
create function public.record_poc_ecg(p_booking uuid, p_file_path text, p_mime_type text, p_size bigint,
                                      p_device_label text default null, p_machine_statement text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype; v_id uuid;
begin
  b := private.poc_booking_for_entry(p_booking);
  if exists (select 1 from public.poc_ecg_recordings where booking_id = p_booking) then raise exception 'ecg_already_recorded' using errcode = '22023'; end if;
  insert into public.poc_ecg_recordings (organisation_id, patient_id, booking_id, file_path, mime_type, file_size_bytes, device_label,
      machine_statement, recorded_by, is_test)
  values (b.organisation_id, b.patient_id, p_booking, p_file_path, p_mime_type, p_size, nullif(btrim(p_device_label), ''),
      nullif(btrim(p_machine_statement), ''), v, b.is_test) returning id into v_id;
  perform private.create_clinical_task(b.patient_id, 'ecg_interpretation', null, 'poc_ecg:' || v_id);
  perform private.log_audit('poc.ecg_recorded', 'poc_ecg_recordings', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Doctors: interpret the ECG, release or withhold a held result
-- ---------------------------------------------------------------------------
create function private.poc_clinician(p_patient uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if not exists (select 1 from public.profiles where id = v and role = 'clinician') or not private.clinician_is_eligible(v) then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  -- a refusal raises, so a 'denied' audit row written here would roll back with it; the successful reads are audited instead
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function private.poc_clinician(uuid) from public, anon, authenticated;

create function private.poc_close_tasks(p_key text, p_actor uuid, p_verb text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype;
begin
  for t in select * from public.clinical_tasks where dedup_key like p_key || '%' and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed') loop
    if t.state = 'claimed' then
      if t.claimed_by = p_actor then
        perform private.apply_task_transition(t.id, 'completed', 'clinician', p_actor, null, null, null, jsonb_build_object('poc', p_verb));
      end if;
    else
      perform private.apply_task_transition(t.id, 'cancelled', 'lead', p_actor, 'The result was ' || p_verb || ' directly by a tied clinician');
    end if;
  end loop;
end;
$$;
revoke all on function private.poc_close_tasks(text, uuid, text) from public, anon, authenticated;

create function public.interpret_poc_ecg(p_recording uuid, p_class text, p_interpretation text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.poc_ecg_recordings%rowtype; v uuid;
begin
  select * into r from public.poc_ecg_recordings where id = p_recording for update;
  if not found then raise exception 'ecg_not_found' using errcode = '22023'; end if;
  v := private.poc_clinician(r.patient_id);
  if r.release_state <> 'awaiting_interpretation' then raise exception 'ecg_not_awaiting' using errcode = '22023'; end if;
  if p_class not in ('normal', 'abnormal', 'urgent') or coalesce(btrim(p_interpretation), '') = '' then
    raise exception 'ecg_interpretation_required' using errcode = '22023';
  end if;
  update public.poc_ecg_recordings set release_state = 'released', interpretation_class = p_class,
         interpretation = btrim(p_interpretation), interpreted_by = v, interpreted_at = now() where id = p_recording;
  perform private.poc_close_tasks('poc_ecg:' || p_recording, v, 'read');
  perform private.testing_notify(r.patient_id, r.organisation_id, 'poc_result_ready', jsonb_build_object('poc_ecg_id', p_recording));
  perform private.log_audit('poc.ecg_interpreted', 'poc_ecg_recordings', p_recording, jsonb_build_object('class', p_class));
end;
$$;

create function public.release_poc_result(p_result uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.poc_results%rowtype; v uuid;
begin
  select * into r from public.poc_results where id = p_result for update;
  if not found then raise exception 'poc_result_not_found' using errcode = '22023'; end if;
  v := private.poc_clinician(r.patient_id);
  if r.release_state <> 'awaiting_review' then raise exception 'poc_result_not_awaiting_review' using errcode = '22023'; end if;
  update public.poc_results set release_state = 'released', reviewed_by = v, reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_result;
  perform private.poc_close_tasks('poc_result:' || p_result, v, 'released');
  perform private.testing_notify(r.patient_id, r.organisation_id, 'poc_result_ready', jsonb_build_object('poc_result_id', p_result));
  perform private.log_audit('poc.result_released', 'poc_results', p_result, '{}'::jsonb);
end;
$$;

create function public.withhold_poc_result(p_result uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.poc_results%rowtype; v uuid;
begin
  select * into r from public.poc_results where id = p_result for update;
  if not found then raise exception 'poc_result_not_found' using errcode = '22023'; end if;
  v := private.poc_clinician(r.patient_id);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  update public.poc_results set release_state = 'withheld', reviewed_by = v, reviewed_at = now(), withheld_reason = btrim(p_reason) where id = p_result;
  perform private.poc_close_tasks('poc_result:' || p_result, v, 'withheld');
  perform private.log_audit('poc.result_withheld', 'poc_results', p_result, '{}'::jsonb);
end;
$$;

-- clinician queue: held results and unread ECGs for patients the clinician is tied to
create function public.poc_review_queue() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if not exists (select 1 from public.profiles where id = v and role = 'clinician') or not private.clinician_is_eligible(v) then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'results', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'patient_id', r.patient_id, 'full_name', (select p.full_name from public.profiles p where p.id = r.patient_id), 'kind', r.kind, 'entered_at', r.entered_at,
        'items', (select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric, 'value_text', i.value_text,
                  'unit', i.unit, 'flag', i.flag) order by i.analyte_code) from public.poc_result_items i where i.poc_result_id = r.id))
        order by r.entered_at)
      from public.poc_results r where r.release_state = 'awaiting_review' and private.clinician_has_patient_access(r.patient_id)), '[]'::jsonb),
    'ecgs', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'patient_id', e.patient_id, 'full_name', (select p.full_name from public.profiles p where p.id = e.patient_id), 'recorded_at', e.recorded_at,
        'device_label', e.device_label, 'machine_statement', e.machine_statement, 'mime_type', e.mime_type) order by e.recorded_at)
      from public.poc_ecg_recordings e where e.release_state = 'awaiting_interpretation' and private.clinician_has_patient_access(e.patient_id)), '[]'::jsonb));
end;
$$;

-- path for the server to sign a download of the trace: only a tied, eligible clinician (and the audit row says so)
create function public.poc_ecg_file_path(p_recording uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.poc_ecg_recordings%rowtype; v uuid;
begin
  select * into r from public.poc_ecg_recordings where id = p_recording;
  if not found then raise exception 'ecg_not_found' using errcode = '22023'; end if;
  v := private.poc_clinician(r.patient_id);
  perform private.audit_chart_read(r.patient_id, array['poc_ecg'], 'ECG trace opened for reading', 'success');
  return r.file_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Patient view: released results only (INV-03). The machine's own wording is never returned.
-- ---------------------------------------------------------------------------
create function public.my_poc_results() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'results', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'released_at', r.released_at,
        'items', (select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric, 'value_text', i.value_text,
                  'unit', i.unit, 'flag', i.flag) order by i.analyte_code) from public.poc_result_items i where i.poc_result_id = r.id))
        order by r.released_at desc)
      from public.poc_results r where r.patient_id = (select auth.uid()) and r.release_state = 'released'), '[]'::jsonb),
    'ecgs', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'interpreted_at', e.interpreted_at,
        'interpretation_class', e.interpretation_class, 'interpretation', e.interpretation) order by e.interpreted_at desc)
      from public.poc_ecg_recordings e where e.patient_id = (select auth.uid()) and e.release_state = 'released'), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- 11. Staff views: the event roster for the station screens
-- ---------------------------------------------------------------------------
create function public.list_testing_events_for_staff() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_run_testing_day() then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'event_date', e.event_date,
      'venue_name', e.venue_name, 'address', e.address, 'city', e.city, 'lga', e.lga, 'state', e.state, 'capacity', e.capacity,
      'lab_provider_id', e.lab_provider_id, 'employer_org_id', e.employer_org_id, 'headcount_requested', e.headcount_requested,
      'venue_approved', e.venue_approved_at is not null, 'seats_taken', private.testing_seats_taken(e.id),
      'waitlisted', (select count(*) from public.testing_event_bookings w where w.event_id = e.id and w.state = 'waitlisted'))
      order by e.event_date desc) from public.testing_events e), '[]'::jsonb);
end;
$$;

create function public.testing_event_roster(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_run_testing_day() then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'booking_id', b.id, 'state', b.state, 'patient_id', b.patient_id, 'full_name', p.full_name,
      'specimen_number', s.specimen_number, 'blood_drawn', b.blood_drawn_at is not null,
      'measurements', exists (select 1 from public.poc_measurements m where m.booking_id = b.id),
      'urinalysis', exists (select 1 from public.poc_results r where r.booking_id = b.id and r.kind = 'urinalysis'),
      'hba1c', exists (select 1 from public.poc_results r where r.booking_id = b.id and r.kind = 'hba1c'),
      'ecg', exists (select 1 from public.poc_ecg_recordings x where x.booking_id = b.id)) order by p.full_name)
    from public.testing_event_bookings b join public.profiles p on p.id = b.patient_id
    left join public.lab_specimens s on s.id = b.specimen_id
    where b.event_id = p_event and b.state <> 'cancelled'), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Employer on-site visits
-- ---------------------------------------------------------------------------
create function private.employer_admin_org() returns uuid
language sql stable security definer set search_path = ''
as $$ select organisation_id from public.profiles where id = (select auth.uid()) and role = 'corporate_admin' and is_active; $$;
revoke all on function private.employer_admin_org() from public, anon, authenticated;

create function public.request_employer_visit(p_event_date date, p_address text, p_city text, p_lga text, p_headcount integer, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); v_org uuid := private.employer_admin_org(); v_name text; v_id uuid;
begin
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_event_date < private.lagos_today() + 7 then raise exception 'visit_needs_a_week_notice' using errcode = '22023'; end if;
  select name into v_name from public.organisations where id = v_org;
  insert into public.testing_events (organisation_id, kind, status, event_date, venue_name, address, city, lga, capacity, employer_org_id,
      headcount_requested, requested_by, notes, created_by, is_test)
  values (v_org, 'employer_visit', 'requested', p_event_date, coalesce(v_name, 'Employer site'), p_address, p_city, nullif(btrim(p_lga), ''),
      greatest(least(p_headcount, 500), 1), v_org, p_headcount, v, p_notes, v, coalesce((select is_test from public.profiles where id = v), false))
  returning id into v_id;
  perform private.log_audit('employer_visit.requested', 'testing_events', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

-- staff put roster employees on the visit. Each must be a claimed, active Member; the rest are reported back by reason count, not name.
create function public.add_employer_visit_attendees(p_event uuid, p_roster_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e public.testing_events%rowtype; rid uuid; m public.employer_roster_members%rowtype; pr public.profiles%rowtype;
        v_added integer := 0; v_no_account integer := 0; v_not_member integer := 0; v_full integer := 0; v_dup integer := 0;
begin
  if not private.can_manage_testing_days() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into e from public.testing_events where id = p_event for update;
  if not found or e.kind <> 'employer_visit' or e.status not in ('scheduled', 'open') then raise exception 'visit_not_open_for_attendees' using errcode = '22023'; end if;
  foreach rid in array p_roster_ids loop
    select * into m from public.employer_roster_members where id = rid and organisation_id = e.employer_org_id;
    if not found or m.claimed_profile_id is null then v_no_account := v_no_account + 1; continue; end if;
    if not private.patient_is_member(m.claimed_profile_id) then v_not_member := v_not_member + 1; continue; end if;
    if exists (select 1 from public.testing_event_bookings b where b.event_id = p_event and b.patient_id = m.claimed_profile_id
                 and b.state in ('confirmed', 'checked_in')) then v_dup := v_dup + 1; continue; end if;
    if private.testing_seats_taken(p_event) >= e.capacity then v_full := v_full + 1; continue; end if;
    select * into pr from public.profiles where id = m.claimed_profile_id;
    insert into public.testing_event_bookings (event_id, organisation_id, patient_id, kind, roster_member_id, state, is_test)
    values (p_event, pr.organisation_id, pr.id, 'employer_visit', rid, 'confirmed', pr.is_test);
    v_added := v_added + 1;
  end loop;
  perform private.log_audit('employer_visit.attendees_added', 'testing_events', p_event, jsonb_build_object('added', v_added));
  return jsonb_build_object('added', v_added, 'no_account', v_no_account, 'not_member', v_not_member, 'full', v_full, 'already_listed', v_dup);
end;
$$;

-- aggregate-only view for the employer (I9). Any figure under the min_cell rule is returned as null with suppressed = true;
-- the headcount is the employer's own request, so it is shown as given. No name, no result, no individual status.
create function private.suppress_small(p_n bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select case when p_n >= coalesce((private.outcome_rule('min_cell') #>> '{}')::bigint, 20) then p_n else null end; $$;
revoke all on function private.suppress_small(bigint) from public, anon, authenticated;

create function public.employer_visit_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.employer_admin_org();
begin
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'status', e.status, 'event_date', e.event_date, 'city', e.city, 'address', e.address,
      'headcount_requested', e.headcount_requested,
      'registered', private.suppress_small(c.registered), 'checked_in', private.suppress_small(c.checked_in),
      'suppressed', (c.registered < coalesce((private.outcome_rule('min_cell') #>> '{}')::bigint, 20)
                     or c.checked_in < coalesce((private.outcome_rule('min_cell') #>> '{}')::bigint, 20)))
      order by e.event_date desc)
    from public.testing_events e
    cross join lateral (select count(*) filter (where b.state in ('confirmed', 'checked_in', 'no_show')) as registered,
                               count(*) filter (where b.state = 'checked_in') as checked_in
                          from public.testing_event_bookings b where b.event_id = e.id) c
    where e.kind = 'employer_visit' and e.employer_org_id = v_org), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Grants (anon never; the PUBLIC pseudo-role is revoked first)
-- ---------------------------------------------------------------------------
revoke all on function
  public.create_testing_event(text, date, time, time, text, text, text, text, text, integer, uuid, text, uuid, integer),
  public.set_testing_event_team(uuid, jsonb), public.approve_testing_event_venue(uuid), public.set_testing_event_status(uuid, text),
  public.update_testing_event(uuid, uuid, integer, time, time, text),
  public.list_testing_days(text), public.book_testing_day(uuid), public.cancel_testing_booking(uuid, text),
  public.reschedule_testing_booking(uuid, uuid), public.my_testing_bookings(), public.send_testing_day_reminders(),
  public.check_in_testing_booking(uuid), public.record_testing_blood_draw(uuid), public.record_poc_measurements(uuid, jsonb),
  public.record_poc_urinalysis(uuid, jsonb), public.record_poc_hba1c(uuid, numeric),
  public.record_poc_ecg(uuid, text, text, bigint, text, text), public.interpret_poc_ecg(uuid, text, text),
  public.release_poc_result(uuid, text), public.withhold_poc_result(uuid, text), public.poc_review_queue(),
  public.poc_ecg_file_path(uuid), public.my_poc_results(), public.list_testing_events_for_staff(), public.testing_event_roster(uuid),
  public.request_employer_visit(date, text, text, text, integer, text), public.add_employer_visit_attendees(uuid, uuid[]),
  public.employer_visit_summary()
  from public, anon;
grant execute on function
  public.create_testing_event(text, date, time, time, text, text, text, text, text, integer, uuid, text, uuid, integer),
  public.set_testing_event_team(uuid, jsonb), public.approve_testing_event_venue(uuid), public.set_testing_event_status(uuid, text),
  public.update_testing_event(uuid, uuid, integer, time, time, text),
  public.list_testing_days(text), public.book_testing_day(uuid), public.cancel_testing_booking(uuid, text),
  public.reschedule_testing_booking(uuid, uuid), public.my_testing_bookings(),
  public.check_in_testing_booking(uuid), public.record_testing_blood_draw(uuid), public.record_poc_measurements(uuid, jsonb),
  public.record_poc_urinalysis(uuid, jsonb), public.record_poc_hba1c(uuid, numeric),
  public.record_poc_ecg(uuid, text, text, bigint, text, text), public.interpret_poc_ecg(uuid, text, text),
  public.release_poc_result(uuid, text), public.withhold_poc_result(uuid, text), public.poc_review_queue(),
  public.poc_ecg_file_path(uuid), public.my_poc_results(), public.list_testing_events_for_staff(), public.testing_event_roster(uuid),
  public.request_employer_visit(date, text, text, text, integer, text), public.add_employer_visit_attendees(uuid, uuid[]),
  public.employer_visit_summary()
  to authenticated;
revoke all on function public.send_testing_day_reminders() from authenticated;
grant execute on function public.send_testing_day_reminders() to service_role;

-- private bucket for ECG traces: no policy for any signed-in role. The server writes and signs with the service role after
-- poc_ecg_file_path / record_poc_ecg have checked the caller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('poc-ecg', 'poc-ecg', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 14. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.testing_events', 'select') or has_table_privilege('authenticated', 'public.testing_events', 'select')
     or has_table_privilege('authenticated', 'public.poc_ecg_recordings', 'select')
     or has_table_privilege('authenticated', 'public.poc_results', 'insert') then
    raise exception 'testing days self-check: table grants too wide';
  end if;
  if has_function_privilege('anon', 'public.book_testing_day(uuid)', 'execute') or has_function_privilege('anon', 'public.my_poc_results()', 'execute')
     or has_function_privilege('authenticated', 'public.send_testing_day_reminders()', 'execute') then
    raise exception 'testing days self-check: function grants too wide';
  end if;
  if exists (select 1 from public.poc_panel_versions where approved_at is not null) then
    raise exception 'testing days self-check: point-of-care panels must start unsigned';
  end if;
end $$;

