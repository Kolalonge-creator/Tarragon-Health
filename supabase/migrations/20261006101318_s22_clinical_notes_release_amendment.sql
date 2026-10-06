-- S22 part 2: clinical notes (spec 4.3 `notes`, 9.2, INV-10, INV-11, INV-13; docs/design/S22.md section 3).
--
-- The live table `clinical_encounter_notes` wins (OQ-23, OQ-152): its `status` (draft, finalized) is the stored state and the
-- S05 `public.notes` view shows draft / signed / amended. A finalized note is already immutable (existing trigger).
--
-- What this adds
--   * Patient access (founder decision 2026-10-06, OQ-155): the patient sees the published summary by default and may ask to
--     open a signed note; a clinician releases it or declines with a reason; a protected note (reproductive health and
--     similar) is released only by the CMO. Nothing is released automatically. The patient reads only through
--     my_released_notes(); the table still has no patient policy, so a draft can never reach a patient (INV-11).
--   * Amendments: create_note_amendment() makes a linked draft with a kind (addendum, late entry, correction) and a required
--     reason; signing it uses the existing finalize path. A finalized amendment of a released note is shown beside it.
--   * Patient correction requests: attached beside the note, answered by a clinician, never deleting anything (OQ-153).
--   * Unsigned-note reminders (config), is_test on notes (INV-13), and events note.signed / note.amended / note.released.
--
-- No row-level policies are added for patients on purpose: every patient read goes through a function that is tested.

-- ---------------------------------------------------------------------------
-- 1. Columns on the live notes table
-- ---------------------------------------------------------------------------
alter table public.clinical_encounter_notes
  add column is_test               boolean not null default false,
  add column is_protected          boolean not null default false,
  add column amendment_kind        text check (amendment_kind in ('addendum', 'late_entry', 'correction')),
  add column amendment_reason      text;
-- The kind and reason are required by create_note_amendment(), the only function that creates an amendment (no patient or
-- staff policy inserts into the table directly; S05 proofs insert amendments as the owner without them).

comment on column public.clinical_encounter_notes.is_protected is
  'Set by the author for reproductive health and similar protected content. A protected note is released to the patient only by the CMO (S22).';

-- INV-13: a note about a test patient is a test note.
create function private.stamp_note_is_test() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.is_test := coalesce((select is_test from public.profiles where id = new.patient_id), false);
  return new;
end; $$;
create trigger clinical_encounter_notes_00_is_test before insert on public.clinical_encounter_notes
  for each row execute function private.stamp_note_is_test();
-- No backfill of existing rows: updating a note row runs the signing-attribution trigger, which needs a signed-in clinician and
-- would abort this migration. Old rows keep is_test = false; metrics already filter on the patient's own is_test flag.

-- ---------------------------------------------------------------------------
-- 2. Release and correction tables (no direct grants: functions only)
-- ---------------------------------------------------------------------------
create table public.note_releases (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  note_id         uuid not null unique references public.clinical_encounter_notes (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  state           text not null check (state in ('requested', 'released', 'declined')),
  requested_at    timestamptz,
  requested_by    uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  decided_by      uuid references public.profiles (id) on delete set null,
  withhold_reason text,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (state <> 'declined' or char_length(btrim(coalesce(withhold_reason, ''))) >= 10),
  check (state = 'requested' or (decided_at is not null and decided_by is not null))
);
alter table public.note_releases enable row level security;
revoke all on public.note_releases from public, anon, authenticated;

create table public.note_correction_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  note_id           uuid not null references public.clinical_encounter_notes (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  request_text      text not null check (char_length(btrim(request_text)) between 10 and 2000),
  state             text not null default 'open' check (state in ('open', 'accepted', 'annotated', 'declined')),
  response          text,
  responded_by      uuid references public.profiles (id) on delete set null,
  responded_at      timestamptz,
  amendment_note_id uuid references public.clinical_encounter_notes (id) on delete set null,
  due_at            timestamptz not null,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check (state = 'open' or (responded_by is not null and responded_at is not null and char_length(btrim(coalesce(response, ''))) >= 10))
);
create index note_correction_requests_note_idx on public.note_correction_requests (note_id);
create unique index note_correction_requests_one_open on public.note_correction_requests (note_id, patient_id) where state = 'open';
alter table public.note_correction_requests enable row level security;
revoke all on public.note_correction_requests from public, anon, authenticated;

-- Reminder bookkeeping lives beside the note, not on it: updating a note row runs the signing-attribution trigger, which a
-- background sweep (no signed-in clinician) must never trip.
create table public.note_unsigned_reminders (
  note_id           uuid primary key references public.clinical_encounter_notes (id) on delete cascade,
  reminded_at       timestamptz,
  lead_notified_at  timestamptz
);
alter table public.note_unsigned_reminders enable row level security;
revoke all on public.note_unsigned_reminders from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Events and templates (ids only, INV-07)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('note.signed', 'A clinical note was signed (finalized)', 'S22', false),
  ('note.amended', 'A signed clinical note was amended by a new signed note', 'S22', false),
  ('note.released', 'A clinician released a signed note to the patient', 'S22', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('note.signed', 1, array['note_id']),
  ('note.amended', 1, array['note_id', 'amends_note_id']),
  ('note.released', 1, array['note_id']);

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('note_release_requested', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate', 'A patient asked to open a signed note.'),
  ('note_correction_requested', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate', 'A patient asked for a correction to a signed note.'),
  ('note_released', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'A note is now available to open.'),
  ('note_release_declined', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'The note request has an answer.'),
  ('note_correction_answered', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Your correction request has an answer.'),
  ('note_unsigned_reminder', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'scheduled', 'A note is waiting to be signed.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('note_release_requested', 'en', 'in_app', 'A patient asked to open a note', 'A patient asked to open a signed note. Open your notes to answer.'),
  ('note_correction_requested', 'en', 'in_app', 'A patient asked for a correction', 'A patient asked for a correction to a signed note. Open your notes to answer.'),
  ('note_released', 'en', 'in_app', 'A note is ready to open', 'Your care team has made a note available. Open the app to read it.'),
  ('note_released', 'en', 'push', 'A note is ready to open', 'Open the app to read it.'),
  ('note_release_declined', 'en', 'in_app', 'About your request', 'Your care team has replied to your request. Open the app to see the reply.'),
  ('note_correction_answered', 'en', 'in_app', 'About your request', 'Your care team has replied to your request. Open the app to see the reply.'),
  ('note_correction_answered', 'en', 'push', 'About your request', 'Open the app to see the reply.'),
  ('note_unsigned_reminder', 'en', 'in_app', 'A note is waiting', 'A note is waiting for your signature.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Events from the signing path (never blocks a signature: failures are logged, not raised)
-- ---------------------------------------------------------------------------
create function private.emit_note_signed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.emit_domain_event('note.signed', new.organisation_id, jsonb_build_object('note_id', new.id),
    'note.signed:' || new.id, new.patient_id, 'clinical_note', new.id);
  if new.amends_note_id is not null then
    perform private.emit_domain_event('note.amended', new.organisation_id,
      jsonb_build_object('note_id', new.id, 'amends_note_id', new.amends_note_id),
      'note.amended:' || new.id, new.patient_id, 'clinical_note', new.id);
  end if;
  return null;
exception when others then
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
  values (new.organisation_id, 'note_event.error', 'clinical_note', new.id, jsonb_build_object('error', sqlerrm));
  return null;
end;
$$;
create trigger clinical_encounter_notes_signed_event
  after update of status on public.clinical_encounter_notes
  for each row when (old.status is distinct from 'finalized' and new.status = 'finalized')
  execute function private.emit_note_signed();

-- ---------------------------------------------------------------------------
-- 5. Amendments
-- ---------------------------------------------------------------------------
create function public.create_note_amendment(p_original uuid, p_kind text, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.clinical_encounter_notes%rowtype;
  v_id uuid;
begin
  perform private.may_work_on_note(p_original);
  if p_kind not in ('addendum', 'late_entry', 'correction') then raise exception 'unknown amendment kind' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'note_amendment_reason_needed' using errcode = '22023'; end if;
  select * into o from public.clinical_encounter_notes where id = p_original;
  if o.status <> 'finalized' then raise exception 'only a signed note can be amended; edit the draft instead' using errcode = 'P0001'; end if;
  insert into public.clinical_encounter_notes
    (organisation_id, patient_id, encounter_type, reason_for_encounter, async_consult_id, video_consultation_id, escalation_id,
     clinical_encounter_id, amends_note_id, amendment_kind, amendment_reason, is_protected)
  values (o.organisation_id, o.patient_id, o.encounter_type, o.reason_for_encounter, o.async_consult_id, o.video_consultation_id,
          o.escalation_id, o.clinical_encounter_id, o.id, p_kind, btrim(p_reason), o.is_protected)
  returning id into v_id;
  perform private.audit_chart_read(o.patient_id, array['notes'], 'amend note', 'success');
  return v_id;
end;
$$;

create function public.set_note_protected(p_note uuid, p_protected boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.may_work_on_note(p_note);
  update public.clinical_encounter_notes set is_protected = coalesce(p_protected, false) where id = p_note and status = 'draft';
  if not found then raise exception 'only a draft can be marked protected' using errcode = 'P0001'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Release: the patient asks, a clinician decides; protected notes need the CMO
-- ---------------------------------------------------------------------------
create function private.note_patient_visible(p_note uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  -- A signed note the patient owns is visible when it is released itself, or when it amends (through signed, unprotected
  -- amendments only) a released note. A protected note is visible only through its OWN release, never by inheriting one:
  -- the walk upward stops at a protected note, so marking an amendment protected keeps it for the CMO to release.
  with recursive chain as (
    select n.id, n.amends_note_id, n.is_protected from public.clinical_encounter_notes n
     where n.id = p_note and n.patient_id = p_patient and n.status = 'finalized'
    union all
    select o.id, o.amends_note_id, o.is_protected from public.clinical_encounter_notes o join chain c on c.amends_note_id = o.id
     where o.status = 'finalized' and not c.is_protected
  )
  select exists (select 1 from chain c join public.note_releases r on r.note_id = c.id and r.state = 'released');
$$;
revoke all on function private.note_patient_visible(uuid, uuid) from public, anon, authenticated;

create function public.request_note_release(p_note uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  r public.note_releases%rowtype;
  v_author_profile uuid;
begin
  select * into n from public.clinical_encounter_notes where id = p_note and patient_id = v_uid and status = 'finalized';
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into r from public.note_releases where note_id = p_note;
  if found then
    if r.state = 'declined' then
      update public.note_releases set state = 'requested', requested_at = now(), requested_by = v_uid, decided_at = null, decided_by = null where id = r.id;
    else
      return;   -- already requested or released: nothing to do
    end if;
  else
    insert into public.note_releases (organisation_id, note_id, patient_id, state, requested_at, requested_by, is_test)
    values (n.organisation_id, n.id, n.patient_id, 'requested', now(), v_uid, n.is_test);
  end if;
  select cs.profile_id into v_author_profile from public.clinical_staff cs where cs.id = n.authored_by_staff;
  if v_author_profile is not null then
    perform private.written_care_notify(v_author_profile, n.organisation_id, 'note_release_requested', jsonb_build_object('note_id', n.id));
  end if;
  perform private.notify_clinical_leads(n.organisation_id, n.is_test, 'A note release was requested',
    'A patient asked to open a signed note.', jsonb_build_object('note_id', n.id), v_author_profile);
end;
$$;

create function public.decide_note_release(p_note uuid, p_release boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  v_cmo boolean;
begin
  perform private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note and status = 'finalized';
  if not found then raise exception 'only a signed note can be released' using errcode = 'P0001'; end if;
  v_cmo := exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier = 'chief_medical_officer');
  if n.is_protected and not v_cmo then raise exception 'note_release_cmo_only' using errcode = '42501'; end if;
  if p_release is not true and char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'note_withhold_reason_needed' using errcode = '22023'; end if;
  insert into public.note_releases (organisation_id, note_id, patient_id, state, decided_at, decided_by, withhold_reason, is_test)
  values (n.organisation_id, n.id, n.patient_id, case when p_release then 'released' else 'declined' end, now(), v_uid,
          case when p_release then null else btrim(p_reason) end, n.is_test)
  on conflict (note_id) do update
     set state = excluded.state, decided_at = excluded.decided_at, decided_by = excluded.decided_by, withhold_reason = excluded.withhold_reason;
  perform private.audit_chart_read(n.patient_id, array['notes'], case when p_release then 'release note' else 'withhold note' end, 'success');
  perform private.written_care_notify(n.patient_id, n.organisation_id, case when p_release then 'note_released' else 'note_release_declined' end,
                                      jsonb_build_object('note_id', n.id));
  if p_release then
    perform private.emit_domain_event('note.released', n.organisation_id, jsonb_build_object('note_id', n.id),
      'note.released:' || n.id || ':' || extract(epoch from now())::bigint, n.patient_id, 'clinical_note', n.id);
  end if;
end;
$$;

-- The patient's one read route for notes: signed AND released (itself or the original it amends). Drafts never.
create function public.my_released_notes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'amends_note_id', n.amends_note_id, 'amendment_kind', n.amendment_kind, 'amendment_reason', n.amendment_reason,
      'encounter_type', n.encounter_type, 'reason', n.reason_for_encounter, 'history', n.history,
      'examination', n.examination_findings, 'assessment', n.assessment, 'diagnosis', n.diagnosis, 'plan', n.plan,
      'follow_up', n.follow_up_instructions, 'signed_at', n.finalized_at,
      'signed_by', (select cs.full_name from public.clinical_staff cs where cs.id = n.finalized_by_staff),
      'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', cr.id, 'state', cr.state, 'request_text', cr.request_text,
                                 'response', cr.response, 'created_at', cr.created_at) order by cr.created_at)
                                 from public.note_correction_requests cr where cr.note_id = n.id), '[]'::jsonb)
    ) order by n.finalized_at desc), '[]'::jsonb)
    into v_out
    from public.clinical_encounter_notes n
   where n.patient_id = v_uid and n.status = 'finalized' and private.note_patient_visible(n.id, v_uid);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, subject_patient_id)
  select organisation_id, v_uid, 'note.patient_read', 'clinical_note', jsonb_build_object('count', jsonb_array_length(v_out)), v_uid
    from public.profiles where id = v_uid;
  return v_out;
end;
$$;

-- What the patient may ask for: every signed note's title only (no clinical text), and where its release stands.
create function public.my_note_index() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'encounter_type', n.encounter_type, 'signed_at', n.finalized_at,
             'release_state', coalesce(r.state, 'not_requested'), 'withhold_reason', case when r.state = 'declined' then r.withhold_reason end)
             order by n.finalized_at desc)
      from public.clinical_encounter_notes n left join public.note_releases r on r.note_id = n.id
     where n.patient_id = v_uid and n.status = 'finalized' and n.amends_note_id is null), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Patient correction requests: attached beside the note, answered by a clinician, nothing deleted
-- ---------------------------------------------------------------------------
create function public.request_note_correction(p_note uuid, p_text text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  v_id uuid;
  v_days integer := (private.written_care_setting('correctionResponseDays') #>> '{}')::int;
  v_author uuid;
begin
  select * into n from public.clinical_encounter_notes where id = p_note and patient_id = v_uid and status = 'finalized';
  if not found or not private.note_patient_visible(p_note, v_uid) then raise exception 'not found' using errcode = 'P0002'; end if;
  insert into public.note_correction_requests (organisation_id, note_id, patient_id, request_text, due_at, is_test)
  values (n.organisation_id, n.id, v_uid, btrim(p_text), now() + make_interval(days => v_days), n.is_test) returning id into v_id;
  select cs.profile_id into v_author from public.clinical_staff cs where cs.id = n.authored_by_staff;
  if v_author is not null then perform private.written_care_notify(v_author, n.organisation_id, 'note_correction_requested', jsonb_build_object('note_id', n.id)); end if;
  perform private.notify_clinical_leads(n.organisation_id, n.is_test, 'A note correction was requested',
    'A patient asked for a correction to a signed note.', jsonb_build_object('note_id', n.id), v_author);
  return v_id;
end;
$$;

create function public.respond_note_correction(p_request uuid, p_outcome text, p_response text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  q public.note_correction_requests%rowtype;
  v_amend uuid;
begin
  select * into q from public.note_correction_requests where id = p_request for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.may_work_on_note(q.note_id);
  if q.state <> 'open' then raise exception 'already answered' using errcode = 'P0001'; end if;
  if p_outcome not in ('accepted', 'annotated', 'declined') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_response, ''))) < 10 then raise exception 'note_correction_response_needed' using errcode = '22023'; end if;
  if p_outcome = 'accepted' then
    v_amend := public.create_note_amendment(q.note_id, 'correction', 'Patient correction request accepted: ' || left(q.request_text, 300));
  end if;
  update public.note_correction_requests
     set state = p_outcome, response = btrim(p_response), responded_by = v_uid, responded_at = now(), amendment_note_id = v_amend
   where id = q.id;
  perform private.written_care_notify(q.patient_id, q.organisation_id, 'note_correction_answered', jsonb_build_object('note_id', q.note_id));
  return v_amend;
end;
$$;

-- The clinician's own queue of open patient requests about their notes (release and correction), no clinical text.
create function public.my_note_requests() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_staff uuid := private.my_clinical_staff_id();
begin
  if v_staff is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'releases', coalesce((select jsonb_agg(jsonb_build_object('note_id', r.note_id, 'requested_at', r.requested_at, 'is_protected', n.is_protected)
                                           order by r.requested_at)
                           from public.note_releases r join public.clinical_encounter_notes n on n.id = r.note_id
                          where r.state = 'requested' and n.authored_by_staff = v_staff), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'note_id', c.note_id, 'request_text', c.request_text, 'due_at', c.due_at)
                                              order by c.created_at)
                              from public.note_correction_requests c join public.clinical_encounter_notes n on n.id = c.note_id
                             where c.state = 'open' and n.authored_by_staff = v_staff), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Unsigned drafts: a reminder to the author, then the lead. Deadlines are config, nothing is ever signed for anyone.
-- ---------------------------------------------------------------------------
create function private.sweep_unsigned_notes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_author integer := 0;
  v_lead integer := 0;
  v_errors integer := 0;
  v_h1 integer := (private.written_care_setting('unsignedNoteReminderHours') #>> '{}')::int;
  v_h2 integer := (private.written_care_setting('unsignedNoteLeadHours') #>> '{}')::int;
  v_profile uuid;
begin
  for r in select n.id, n.organisation_id, n.is_test, n.authored_by_staff, n.created_at,
                  u.reminded_at, u.lead_notified_at
             from public.clinical_encounter_notes n
             left join public.note_unsigned_reminders u on u.note_id = n.id
            where n.status = 'draft' and n.created_at <= now() - make_interval(hours => v_h1)
              and (u.reminded_at is null or u.lead_notified_at is null) loop
    begin
      select cs.profile_id into v_profile from public.clinical_staff cs where cs.id = r.authored_by_staff;
      if r.reminded_at is null then
        if v_profile is not null then perform private.written_care_notify(v_profile, r.organisation_id, 'note_unsigned_reminder', '{}'::jsonb); end if;
        insert into public.note_unsigned_reminders (note_id, reminded_at) values (r.id, now())
          on conflict (note_id) do update set reminded_at = excluded.reminded_at;
        v_author := v_author + 1;
      end if;
      if r.lead_notified_at is null and r.created_at <= now() - make_interval(hours => v_h2) then
        perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'A note has been waiting to be signed',
          'A draft note has been waiting past its signing time.', jsonb_build_object('note_id', r.id), v_profile);
        insert into public.note_unsigned_reminders (note_id, lead_notified_at) values (r.id, now())
          on conflict (note_id) do update set lead_notified_at = excluded.lead_notified_at;
        v_lead := v_lead + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_unsigned_notes: % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'unsigned_note_sweep.error', 'clinical_note', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('reminded', v_author, 'lead_notified', v_lead, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_unsigned_notes() from public, anon, authenticated;
do $cron$
begin
  perform cron.schedule('unsigned-note-sweep', '17 * * * *', $c$select private.sweep_unsigned_notes()$c$);
end
$cron$;

-- ---------------------------------------------------------------------------
-- 9. Grants and self-checks
-- ---------------------------------------------------------------------------
revoke all on function public.create_note_amendment(uuid, text, text) from public, anon;
revoke all on function public.set_note_protected(uuid, boolean) from public, anon;
revoke all on function public.request_note_release(uuid) from public, anon;
revoke all on function public.decide_note_release(uuid, boolean, text) from public, anon;
revoke all on function public.my_released_notes() from public, anon;
revoke all on function public.my_note_index() from public, anon;
revoke all on function public.request_note_correction(uuid, text) from public, anon;
revoke all on function public.respond_note_correction(uuid, text, text) from public, anon;
revoke all on function public.my_note_requests() from public, anon;
grant execute on function public.create_note_amendment(uuid, text, text) to authenticated;
grant execute on function public.set_note_protected(uuid, boolean) to authenticated;
grant execute on function public.request_note_release(uuid) to authenticated;
grant execute on function public.decide_note_release(uuid, boolean, text) to authenticated;
grant execute on function public.my_released_notes() to authenticated;
grant execute on function public.my_note_index() to authenticated;
grant execute on function public.request_note_correction(uuid, text) to authenticated;
grant execute on function public.respond_note_correction(uuid, text, text) to authenticated;
grant execute on function public.my_note_requests() to authenticated;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.create_note_amendment(uuid,text,text)', 'public.set_note_protected(uuid,boolean)', 'public.request_note_release(uuid)',
    'public.decide_note_release(uuid,boolean,text)', 'public.my_released_notes()', 'public.my_note_index()',
    'public.request_note_correction(uuid,text)', 'public.respond_note_correction(uuid,text,text)', 'public.my_note_requests()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S22 assertion: anon can execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.note_patient_visible(uuid,uuid)', 'private.sweep_unsigned_notes()'] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S22 assertion: authenticated can execute %', v_fn; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.note_releases', 'SELECT') or has_table_privilege('authenticated', 'public.note_correction_requests', 'SELECT') then
    raise exception 'S22 assertion: authenticated can read the release or correction tables directly';
  end if;
  -- INV-11: still no patient policy on the notes table itself
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clinical_encounter_notes' and 'authenticated' = any(roles)) then
    raise exception 'S22 assertion: clinical_encounter_notes has a policy for authenticated again (OQ-58, S05d)';
  end if;
end $$;
