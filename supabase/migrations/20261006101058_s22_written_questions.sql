-- S22 part 1: written questions to the care team (spec 8.5, 7.3 async_question, 23.16).
--
-- Founder decisions 2026-10-06: a written question is a Member benefit with a monthly allowance; the window is 24 hours
-- and a missed window returns the question to the allowance; NO text-based diagnosis (a patient who needs one is called);
-- adults only. Extends async_consults (live since 2026-07-23); nothing is rebuilt. Design: docs/design/S22.md.
--
-- What this adds
--   * written_care_config (versioned, one active row): allowance, window, follow-up, photo and notes settings (INV-16).
--   * async_consults: task link, is_test, config version, answer kind, follow-up window, window and allowance bookkeeping.
--   * async_consult_messages (the thread, append-only) and async_consult_attachments (private bucket, patient folder).
--   * The intake gate (adult, Member or a grandfathered paid credit, monthly allowance), a deterministic safety screen,
--     and an S16 clinical task per question (and per patient reply), so the clinician sees it only through the queue.
--   * answer_written_question / reply_written_question: a live claim is required; there is NO diagnosis field and the
--     clinician attests it; a call outcome creates a call task. The patient never reads or writes the table directly.
--   * A window sweep (reminder, release to the pool, CMO alert, allowance returned) that never closes or drops a question.
--   * Closing the direct staff read of the question and answer text (INV-10, INV-12). Counts still work (id, status).
--
-- Live counts when written (rolled-back read against production, 2026-10-06): see docs/BUILD-PROGRESS.md.

-- ---------------------------------------------------------------------------
-- 1. Versioned configuration (also holds the S22 notes settings, part 2)
-- ---------------------------------------------------------------------------
create table public.written_care_config (
  version        integer primary key,
  is_active      boolean not null default false,
  effective_from date not null default current_date,
  rules          jsonb not null,
  note           text,
  created_at     timestamptz not null default now()
);
create unique index written_care_config_one_active on public.written_care_config (is_active) where is_active;
alter table public.written_care_config enable row level security;
revoke all on public.written_care_config from public, anon, authenticated;

-- PROPOSED values (owner CMO); mirrored in packages/shared as `written_care.behaviour`, with a test that fails on drift.
-- written-care-config-begin
insert into public.written_care_config (version, is_active, effective_from, rules, note) values
  (1, true, '2026-10-06',
   $json${"monthlyAllowance":4,"windowMinutes":1440,"reminderPercent":75,"followUpDays":7,"maxPhotos":3,"maxPhotoBytes":8388608,"questionMinChars":10,"questionMaxChars":2000,"messageMaxChars":2000,"callDueMinutes":1440,"timezone":"Africa/Lagos","unsignedNoteReminderHours":24,"unsignedNoteLeadHours":72,"correctionResponseDays":30}$json$::jsonb,
   'S22 PROPOSED. Allowance chosen by the build at the founder''s request: about one a week beside 12 monthly calls; review after the first month of real use.');
-- written-care-config-end

create function private.written_care_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.written_care_config where is_active; $$;
revoke all on function private.written_care_setting(text) from public, anon, authenticated;

-- The one seam for "is this patient a Member" (OQ-150). Today: the legacy plan feature. The real membership build
-- replaces this body and nothing else.
create function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.patient_has_feature_access(p_patient, 'async_doctor_visit'); $$;
revoke all on function private.patient_is_member(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Task type for the call a patient is promised when a diagnosis is needed
-- ---------------------------------------------------------------------------
-- task-types-b-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('written_question_call', 1, 5, 1440, 'medical_officer', '{adult_general}', 1440, 30, true, true, '{}',
   'S22: created when a clinician answers a written question with "needs a call". A diagnosis is only ever made in a call, never in writing.');
-- task-types-b-end

-- ---------------------------------------------------------------------------
-- 3. Events (ids only, INV-07)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('async_question.submitted', 'A patient sent a written question to the care team', 'S22', false),
  ('async_question.answered', 'A clinician answered a written question or asked for more information', 'S22', false),
  ('async_question.window_missed', 'A written question passed its response window; the CMO is told and the allowance is returned', 'S22', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('async_question.submitted', 1, array['consult_id']),
  ('async_question.answered', 1, array['consult_id', 'answer_kind']),
  ('async_question.window_missed', 1, array['consult_id']);

-- ---------------------------------------------------------------------------
-- 4. async_consults grows
-- ---------------------------------------------------------------------------
alter table public.async_consults
  add column task_id               uuid references public.clinical_tasks (id) on delete set null,
  add column is_test               boolean not null default false,
  add column config_version        integer,
  add column window_minutes        integer,
  add column window_started_at     timestamptz not null default now(),
  add column answer_kind           text check (answer_kind in ('guidance', 'needs_more_information', 'needs_call')),
  add column no_diagnosis_attested boolean not null default false,
  add column follow_up_until       timestamptz,
  add column paid_with_credit      boolean not null default false,
  add column safety_flagged        boolean not null default false,
  add column reminded_at           timestamptz,
  add column window_missed_at      timestamptz,
  add column allowance_returned_at timestamptz;

comment on column public.async_consults.no_diagnosis_attested is
  'The answering clinician ticked "I have not diagnosed" (S22). A written answer is guidance only; a diagnosis is made in a call.';

create index async_consults_task_idx on public.async_consults (task_id) where task_id is not null;
create index async_consults_patient_month_idx on public.async_consults (patient_id, created_at desc);

-- A note written from a written question never carries a diagnosis (structural backstop for the founder rule).
alter table public.clinical_encounter_notes
  add constraint clinical_encounter_notes_async_no_diagnosis
  check (encounter_type <> 'async_consult' or diagnosis is null) not valid;

-- ---------------------------------------------------------------------------
-- 5. Thread and photos
-- ---------------------------------------------------------------------------
create table public.async_consult_messages (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  consult_id      uuid not null references public.async_consults (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  author_role     text not null check (author_role in ('patient', 'care_team')),
  author_id       uuid references public.profiles (id) on delete set null,
  body            text not null check (char_length(btrim(body)) between 1 and 4000),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index async_consult_messages_consult_idx on public.async_consult_messages (consult_id, created_at);
alter table public.async_consult_messages enable row level security;
revoke all on public.async_consult_messages from public, anon, authenticated;

create function private.async_consult_messages_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'a written question thread is append-only' using errcode = '42501'; end; $$;
create trigger async_consult_messages_no_change before update or delete on public.async_consult_messages
  for each row execute function private.async_consult_messages_append_only();

create table public.async_consult_attachments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  consult_id      uuid not null references public.async_consults (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  storage_path    text not null unique,
  mime_type       text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes      bigint not null check (size_bytes > 0),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index async_consult_attachments_consult_idx on public.async_consult_attachments (consult_id);
alter table public.async_consult_attachments enable row level security;
revoke all on public.async_consult_attachments from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('async-consult-attachments', 'async-consult-attachments', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

-- Patients upload into their own folder only. Staff never get a storage policy: they download through the audited server route.
drop policy if exists "async consult attachment patient insert" on storage.objects;
create policy "async consult attachment patient insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'async-consult-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "async consult attachment patient select" on storage.objects;
create policy "async consult attachment patient select" on storage.objects
  for select to authenticated
  using (bucket_id = 'async-consult-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 6. Notification templates (neutral, INV-07; in-app and push only, never SMS, INV-08)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('written_question_received', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'Your care team has your message.'),
  ('written_question_answered', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'There is a reply from your care team.'),
  ('written_question_info_needed', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Your care team has a question for you.'),
  ('written_question_window_missed', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'scheduled', 'Reply took longer than promised; the message was given back to you.'),
  ('written_question_call_planned', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Your care team will call you.'),
  ('written_question_staff_notice', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate', 'Staff notice about a written question; names nothing about the patient.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('written_question_received', 'en', 'in_app', 'Message received', 'Your care team has your message. You will hear back within the time shown on the screen.'),
  ('written_question_answered', 'en', 'in_app', 'A reply is waiting', 'Your care team has replied. Open the app to read it.'),
  ('written_question_answered', 'en', 'push', 'A reply is waiting', 'Open the app to read your reply.'),
  ('written_question_info_needed', 'en', 'in_app', 'Your care team needs a little more', 'Your care team has a question for you. Open the app to answer it.'),
  ('written_question_info_needed', 'en', 'push', 'Your care team needs a little more', 'Open the app to answer.'),
  ('written_question_window_missed', 'en', 'in_app', 'Sorry for the wait', 'This took longer than we promised. Your message is still with the team and this one will not count against your monthly messages.'),
  ('written_question_call_planned', 'en', 'in_app', 'Your care team will call you', 'Your care team would like to talk this through by phone. Keep your phone close.'),
  ('written_question_call_planned', 'en', 'push', 'Your care team will call you', 'Keep your phone close.'),
  ('written_question_staff_notice', 'en', 'in_app', 'A written message needs attention', 'A written message needs attention. Open your queue.')
on conflict (template_key, locale, channel) do nothing;

create function private.written_care_notify(p_recipient uuid, p_org uuid, p_template text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (p_org, p_recipient, 'in_app', 'pending', p_template, coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke all on function private.written_care_notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The intake gate (replaces the 2026-08-31 entitlement-or-credit trigger body)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_async_consult_entitlement_or_credit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_allow integer;
  v_used integer;
  v_start timestamptz;
  v_tz text := coalesce(private.written_care_setting('timezone') #>> '{}', 'Africa/Lagos');
begin
  new.id := coalesce(new.id, gen_random_uuid());
  select * into p from public.profiles where id = new.patient_id and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;

  -- Adults only (OQ-154). A missing date of birth cannot be checked and is let through; onboarding collects it.
  if p.date_of_birth is not null and p.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'Written questions are for adults. A parent or guardian can talk to the care team another way.'
      using errcode = 'P0001', detail = 'WRITTEN_QUESTION_ADULTS_ONLY';
  end if;
  if char_length(btrim(coalesce(new.question, ''))) < coalesce((private.written_care_setting('questionMinChars') #>> '{}')::int, 10)
     or char_length(new.question) > coalesce((private.written_care_setting('questionMaxChars') #>> '{}')::int, 2000) then
    raise exception 'The question is too short or too long.' using errcode = '22023', detail = 'WRITTEN_QUESTION_LENGTH';
  end if;

  new.is_test := coalesce(p.is_test, false);
  new.window_minutes := (private.written_care_setting('windowMinutes') #>> '{}')::int;
  new.config_version := (select version from public.written_care_config where is_active);
  new.window_started_at := now();
  new.sla_due_at := now() + make_interval(mins => new.window_minutes);

  if private.patient_is_member(new.patient_id) then
    v_allow := (private.written_care_setting('monthlyAllowance') #>> '{}')::int;
    v_start := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
    select count(*) into v_used from public.async_consults c
     where c.patient_id = new.patient_id and c.created_at >= v_start
       and c.allowance_returned_at is null and not c.paid_with_credit;
    if v_used >= v_allow then
      raise exception 'You have used your written messages for this month.'
        using errcode = 'P0001', detail = 'WRITTEN_QUESTION_ALLOWANCE_USED';
    end if;
    return new;
  end if;

  -- Not a Member: only someone who already paid for a credit before the membership model may use it (OQ-150).
  begin
    perform public.redeem_available_service_purchase(new.patient_id, 'async_consult_credit', 'async_consult', new.id);
    new.paid_with_credit := true;
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Written messages to your care team are part of Membership.'
        using errcode = 'P0001', detail = 'WRITTEN_QUESTION_MEMBERS_ONLY';
    end if;
    raise;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. After a question is sent: safety screen, task, event, receipt (nothing here may be swallowed)
-- ---------------------------------------------------------------------------
create function private.after_written_question_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task uuid;
  v_matches text[];
begin
  v_task := private.create_clinical_task(new.patient_id, 'async_question', new.window_minutes, 'async:' || new.id);
  update public.async_consults set task_id = v_task where id = new.id;

  -- Deterministic phrase screen (INV-01, no model). A hit never blocks the question; it pages like a flagged care message.
  v_matches := private.screen_care_message_for_emergency(new.question);
  if v_matches is not null and array_length(v_matches, 1) is not null then
    perform private.raise_clinician_alert(
      new.organisation_id, new.patient_id, 'emergency',
      'Priority 1: potential emergency in a written question',
      format('A written question matched the safety screen on: %s. This is an automated keyword flag, not a diagnosis. Open it from your queue and assess.', array_to_string(v_matches, ', ')),
      'clinical', 'message_safety_flag');
    update public.async_consults set safety_flagged = true where id = new.id;
  end if;

  perform private.emit_domain_event('async_question.submitted', new.organisation_id,
    jsonb_build_object('consult_id', new.id), 'async_question.submitted:' || new.id, new.patient_id, 'async_consult', new.id);
  perform private.written_care_notify(new.patient_id, new.organisation_id, 'written_question_received', jsonb_build_object('consult_id', new.id));
  return null;
end;
$$;
create trigger async_consults_after_insert_written_question
  after insert on public.async_consults
  for each row execute function private.after_written_question_insert();

-- ---------------------------------------------------------------------------
-- 9. Patient functions (the table is no longer touched directly)
-- ---------------------------------------------------------------------------
create function public.submit_written_question(p_category text, p_question text, p_duration_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_category is null or p_category not in ('medication', 'symptom', 'results', 'lifestyle', 'general') then
    raise exception 'unknown category' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'only a patient can send a written question' using errcode = '42501'; end if;
  insert into public.async_consults (id, organisation_id, patient_id, category, question, duration_note)
  values (v_id, v_org, v_uid, p_category, btrim(p_question), nullif(btrim(coalesce(p_duration_note, '')), ''));
  return v_id;
end;
$$;

create function public.attach_written_question_photo(p_consult uuid, p_path text, p_mime text, p_bytes bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.async_consults%rowtype;
  v_id uuid;
begin
  select * into c from public.async_consults where id = p_consult and patient_id = v_uid;
  if not found then raise exception 'not your question' using errcode = '42501'; end if;
  if c.status not in ('submitted', 'in_review') then raise exception 'this question is closed to photos' using errcode = 'P0001'; end if;
  if split_part(p_path, '/', 1) <> v_uid::text or split_part(p_path, '/', 2) <> p_consult::text then
    raise exception 'photo path must be in your own folder for this question' using errcode = '42501';
  end if;
  if p_bytes > (private.written_care_setting('maxPhotoBytes') #>> '{}')::bigint then
    raise exception 'photo too large' using errcode = '22023', detail = 'WRITTEN_QUESTION_PHOTO_SIZE';
  end if;
  if (select count(*) from public.async_consult_attachments where consult_id = p_consult) >= (private.written_care_setting('maxPhotos') #>> '{}')::int then
    raise exception 'too many photos' using errcode = '22023', detail = 'WRITTEN_QUESTION_PHOTO_COUNT';
  end if;
  insert into public.async_consult_attachments (organisation_id, consult_id, patient_id, storage_path, mime_type, size_bytes, is_test)
  values (c.organisation_id, c.id, v_uid, p_path, p_mime, p_bytes, c.is_test) returning id into v_id;
  return v_id;
end;
$$;

-- A reply from the patient: while the care team is waiting on them, or inside the follow-up window after an answer.
create function public.post_written_question_message(p_consult uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.async_consults%rowtype;
  v_id uuid;
  v_task uuid;
  v_matches text[];
begin
  select * into c from public.async_consults where id = p_consult and patient_id = v_uid for update;
  if not found then raise exception 'not your question' using errcode = '42501'; end if;
  if c.status = 'closed' or (c.status = 'answered' and (c.follow_up_until is null or now() > c.follow_up_until)) then
    raise exception 'The follow-up time for this message has ended.' using errcode = 'P0001', detail = 'WRITTEN_QUESTION_FOLLOW_UP_ENDED';
  end if;
  if c.status = 'submitted' then raise exception 'Your care team has not replied yet.' using errcode = 'P0001', detail = 'WRITTEN_QUESTION_NOT_REPLIED'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 or char_length(p_body) > (private.written_care_setting('messageMaxChars') #>> '{}')::int then
    raise exception 'message length' using errcode = '22023';
  end if;
  insert into public.async_consult_messages (organisation_id, consult_id, patient_id, author_role, author_id, body, is_test)
  values (c.organisation_id, c.id, v_uid, 'patient', v_uid, btrim(p_body), c.is_test) returning id into v_id;

  v_matches := private.screen_care_message_for_emergency(p_body);
  if v_matches is not null and array_length(v_matches, 1) is not null then
    perform private.raise_clinician_alert(c.organisation_id, c.patient_id, 'emergency',
      'Priority 1: potential emergency in a written message',
      format('A written message matched the safety screen on: %s. This is an automated keyword flag, not a diagnosis. Open it from your queue and assess.', array_to_string(v_matches, ', ')),
      'clinical', 'message_safety_flag');
    update public.async_consults set safety_flagged = true where id = c.id;
  end if;

  -- The care team owes a reply again: a fresh task, a fresh window. Repeated messages merge into the live task.
  v_task := private.create_clinical_task(c.patient_id, 'async_question', c.window_minutes, 'async:' || c.id || ':reply');
  update public.async_consults
     set task_id = v_task, window_started_at = now(), sla_due_at = now() + make_interval(mins => c.window_minutes),
         reminded_at = null, window_missed_at = null
   where id = c.id;
  return v_id;
end;
$$;

create function public.my_written_questions() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'category', c.category, 'question', c.question, 'status', c.status, 'answer', c.answer,
      'answer_kind', c.answer_kind, 'created_at', c.created_at, 'answered_at', c.answered_at,
      'window_due_at', c.sla_due_at, 'follow_up_until', c.follow_up_until, 'window_missed_at', c.window_missed_at,
      'photos', (select count(*) from public.async_consult_attachments a where a.consult_id = c.id),
      'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_role', m.author_role, 'body', m.body, 'created_at', m.created_at)
                                             order by m.created_at) from public.async_consult_messages m where m.consult_id = c.id), '[]'::jsonb)
    ) order by c.created_at desc)
    from public.async_consults c where c.patient_id = v_uid), '[]'::jsonb);
end;
$$;

-- What the patient may still do this month, shown before they write (no price, no balance: INV-09).
create function public.my_written_question_allowance() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tz text := coalesce(private.written_care_setting('timezone') #>> '{}', 'Africa/Lagos');
  v_start timestamptz := date_trunc('month', now() at time zone coalesce(private.written_care_setting('timezone') #>> '{}', 'Africa/Lagos')) at time zone coalesce(private.written_care_setting('timezone') #>> '{}', 'Africa/Lagos');
  v_allow integer := (private.written_care_setting('monthlyAllowance') #>> '{}')::int;
  v_used integer;
  v_member boolean;
  v_credit boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  v_member := private.patient_is_member(v_uid);
  select count(*) into v_used from public.async_consults c
   where c.patient_id = v_uid and c.created_at >= v_start and c.allowance_returned_at is null and not c.paid_with_credit;
  v_credit := not v_member and public.has_available_service_purchase(v_uid, 'async_consult_credit');
  return jsonb_build_object('is_member', v_member, 'has_credit', v_credit, 'allowance', v_allow, 'used', v_used,
    'remaining', case when v_member then greatest(v_allow - v_used, 0) else 0 end,
    'window_minutes', (private.written_care_setting('windowMinutes') #>> '{}')::int,
    'follow_up_days', (private.written_care_setting('followUpDays') #>> '{}')::int,
    'max_photos', (private.written_care_setting('maxPhotos') #>> '{}')::int,
    'max_photo_bytes', (private.written_care_setting('maxPhotoBytes') #>> '{}')::bigint);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Clinician functions: reads need a tie and are audited; answers need the live claim
-- ---------------------------------------------------------------------------
create function public.read_written_question_audited(p_consult uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.async_consults%rowtype;
begin
  select * into c from public.async_consults where id = p_consult;
  if not found or not private.clinician_has_patient_access(c.patient_id) then
    raise exception 'queue_no_claim' using errcode = '42501';
  end if;
  perform private.audit_chart_read(c.patient_id, array['written_question'], coalesce(nullif(btrim(p_reason), ''), 'written question'), 'success');
  return jsonb_build_object(
    'id', c.id, 'patient_id', c.patient_id, 'category', c.category, 'question', c.question, 'duration_note', c.duration_note,
    'status', c.status, 'task_id', c.task_id, 'window_due_at', c.sla_due_at, 'safety_flagged', c.safety_flagged,
    'answer', c.answer, 'answer_kind', c.answer_kind, 'created_at', c.created_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes) order by a.created_at)
                         from public.async_consult_attachments a where a.consult_id = c.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_role', m.author_role, 'body', m.body, 'created_at', m.created_at)
                                            order by m.created_at) from public.async_consult_messages m where m.consult_id = c.id), '[]'::jsonb));
end;
$$;

-- The written questions the signed-in clinician currently holds a live claim on (no question text: opening one is the audited read).
create function public.my_written_question_claims() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'created_at', c.created_at, 'window_due_at', c.sla_due_at,
             'safety_flagged', c.safety_flagged, 'task_id', c.task_id, 'claim_expires_at', k.expires_at,
             'is_follow_up', c.answered_at is not null or exists (select 1 from public.async_consult_messages m where m.consult_id = c.id))
           order by c.safety_flagged desc, c.sla_due_at)
      from public.task_claims k join public.async_consults c on c.task_id = k.task_id
     where k.clinician_id = v_uid and k.ended_at is null), '[]'::jsonb);
end;
$$;

-- One entry for both the first answer and a reply inside the follow-up window.
-- There is deliberately no diagnosis argument. The clinician attests; a call outcome creates a call task.
create function public.answer_written_question(p_consult uuid, p_kind text, p_body text, p_attested boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.async_consults%rowtype;
  v_first boolean;
  v_days integer := (private.written_care_setting('followUpDays') #>> '{}')::int;
  v_call uuid;
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  if p_kind not in ('guidance', 'needs_more_information', 'needs_call') then raise exception 'unknown answer kind' using errcode = '22023'; end if;
  if p_attested is not true then
    raise exception 'written_question_attest_no_diagnosis' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 10 or char_length(p_body) > 4000 then raise exception 'answer length' using errcode = '22023'; end if;
  select * into c from public.async_consults where id = p_consult for update;
  if not found or c.task_id is null then raise exception 'queue_no_claim' using errcode = '42501'; end if;
  if not exists (select 1 from public.task_claims k where k.task_id = c.task_id and k.clinician_id = v_uid and k.ended_at is null) then
    raise exception 'queue_no_claim' using errcode = '42501';
  end if;
  v_first := c.status in ('submitted', 'in_review') and c.answered_at is null;

  if v_first and p_kind <> 'needs_more_information' then
    update public.async_consults
       set status = 'answered', answer = btrim(p_body), answer_kind = p_kind, no_diagnosis_attested = true,
           follow_up_until = now() + make_interval(days => v_days), reminded_at = null
     where id = c.id;
  else
    -- first request for more information, or any reply inside the follow-up window: a message in the thread
    insert into public.async_consult_messages (organisation_id, consult_id, patient_id, author_role, author_id, body, is_test)
    values (c.organisation_id, c.id, c.patient_id, 'care_team', v_uid, btrim(p_body), c.is_test);
    -- status stays 'answered' for a follow-up (the attribution trigger freezes an answered row); a first request for
    -- more information moves submitted to in_review
    update public.async_consults
       set status = case when v_first then 'in_review' else c.status end,
           answer_kind = case when v_first then p_kind else c.answer_kind end,
           no_diagnosis_attested = true
     where id = c.id;
  end if;

  perform public.queue_complete(c.task_id, jsonb_build_object('kind', p_kind, 'consult_id', c.id, 'first', v_first));

  if p_kind = 'needs_call' then
    v_call := private.create_clinical_task(c.patient_id, 'written_question_call',
      (private.written_care_setting('callDueMinutes') #>> '{}')::int, 'async_call:' || c.id);
    perform private.written_care_notify(c.patient_id, c.organisation_id, 'written_question_call_planned', jsonb_build_object('consult_id', c.id));
  elsif p_kind = 'needs_more_information' then
    perform private.written_care_notify(c.patient_id, c.organisation_id, 'written_question_info_needed', jsonb_build_object('consult_id', c.id));
  else
    perform private.written_care_notify(c.patient_id, c.organisation_id, 'written_question_answered', jsonb_build_object('consult_id', c.id));
  end if;

  perform private.emit_domain_event('async_question.answered', c.organisation_id,
    jsonb_build_object('consult_id', c.id, 'answer_kind', p_kind),
    'async_question.answered:' || c.id || ':' || (select count(*) from public.async_consult_messages where consult_id = c.id) || ':' || p_kind,
    c.patient_id, 'async_consult', c.id);
  return jsonb_build_object('consult_id', c.id, 'kind', p_kind, 'call_task_id', v_call);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. The window sweep: remind, release, tell the CMO, return the allowance. Never closes or drops a question.
-- ---------------------------------------------------------------------------
create function private.sweep_written_question_windows() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_pct integer := (private.written_care_setting('reminderPercent') #>> '{}')::int;
  v_reminded integer := 0;
  v_missed integer := 0;
  v_errors integer := 0;
  v_claimer uuid;
  v_claim uuid;
begin
  for r in
    select c.*, t.state as task_state
      from public.async_consults c join public.clinical_tasks t on t.id = c.task_id
     where t.state not in ('completed', 'cancelled')
       and c.status in ('submitted', 'in_review', 'answered')
  loop
    begin
      -- reminder to the clinician who holds the claim, once per window
      if r.reminded_at is null and now() >= r.window_started_at + make_interval(secs => (r.window_minutes * 60 * v_pct / 100.0)::int) then
        select k.clinician_id into v_claimer from public.task_claims k where k.task_id = r.task_id and k.ended_at is null;
        if v_claimer is not null then
          perform private.written_care_notify(v_claimer, r.organisation_id, 'written_question_staff_notice', '{}'::jsonb);
        end if;
        update public.async_consults set reminded_at = now() where id = r.id;
        v_reminded := v_reminded + 1;
      end if;
      -- the window has passed
      if now() >= r.window_started_at + make_interval(mins => r.window_minutes) and r.window_missed_at is null then
        select k.id into v_claim from public.task_claims k where k.task_id = r.task_id and k.ended_at is null;
        if v_claim is not null then
          update public.task_claims set ended_at = now(), end_reason = 'expired' where id = v_claim and ended_at is null;
          if found then perform private.apply_task_transition(r.task_id, 'open', 'system', null, 'written question window missed'); end if;
        end if;
        update public.async_consults
           set window_missed_at = now(),
               allowance_returned_at = case when answered_at is null and not paid_with_credit then coalesce(allowance_returned_at, now()) else allowance_returned_at end
         where id = r.id;
        perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'A written message missed its window',
          'A written message passed its response window. It has been released to the queue.', jsonb_build_object('consult_id', r.id));
        perform private.written_care_notify(r.patient_id, r.organisation_id, 'written_question_window_missed', jsonb_build_object('consult_id', r.id));
        perform private.emit_domain_event('async_question.window_missed', r.organisation_id, jsonb_build_object('consult_id', r.id),
          'async_question.window_missed:' || r.id || ':' || extract(epoch from r.window_started_at)::bigint, r.patient_id, 'async_consult', r.id);
        v_missed := v_missed + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_written_question_windows: % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'written_question_window.error', 'async_consult', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('reminded', v_reminded, 'missed', v_missed, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_written_question_windows() from public, anon, authenticated;

do $cron$
begin
  perform cron.schedule('written-question-window-sweep', '*/5 * * * *', $c$select private.sweep_written_question_windows()$c$);
end
$cron$;

-- ---------------------------------------------------------------------------
-- 12. Close the direct reads and writes (INV-10, INV-12); counts keep working through id and status
-- ---------------------------------------------------------------------------
drop policy if exists async_consults_select on public.async_consults;
drop policy if exists async_consults_insert on public.async_consults;
drop policy if exists async_consults_update on public.async_consults;
create policy async_consults_select_staff_counts on public.async_consults
  for select to authenticated using (private.is_org_staff(organisation_id));
revoke all on public.async_consults from authenticated;
grant select (id, organisation_id, patient_id, category, status, sla_due_at, answered_at, created_at, updated_at,
              task_id, is_test, answer_kind, follow_up_until, window_started_at, window_missed_at, safety_flagged)
  on public.async_consults to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Grants and self-checks
-- ---------------------------------------------------------------------------
revoke all on function public.submit_written_question(text, text, text) from public, anon;
revoke all on function public.attach_written_question_photo(uuid, text, text, bigint) from public, anon;
revoke all on function public.post_written_question_message(uuid, text) from public, anon;
revoke all on function public.my_written_questions() from public, anon;
revoke all on function public.my_written_question_allowance() from public, anon;
revoke all on function public.read_written_question_audited(uuid, text) from public, anon;
revoke all on function public.answer_written_question(uuid, text, text, boolean) from public, anon;
revoke all on function public.my_written_question_claims() from public, anon;
grant execute on function public.my_written_question_claims() to authenticated;
grant execute on function public.submit_written_question(text, text, text) to authenticated;
grant execute on function public.attach_written_question_photo(uuid, text, text, bigint) to authenticated;
grant execute on function public.post_written_question_message(uuid, text) to authenticated;
grant execute on function public.my_written_questions() to authenticated;
grant execute on function public.my_written_question_allowance() to authenticated;
grant execute on function public.read_written_question_audited(uuid, text) to authenticated;
grant execute on function public.answer_written_question(uuid, text, text, boolean) to authenticated;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.submit_written_question(text,text,text)', 'public.attach_written_question_photo(uuid,text,text,bigint)',
    'public.post_written_question_message(uuid,text)', 'public.my_written_questions()', 'public.my_written_question_allowance()',
    'public.read_written_question_audited(uuid,text)', 'public.answer_written_question(uuid,text,text,boolean)', 'public.my_written_question_claims()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S22 assertion: anon can execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.sweep_written_question_windows()', 'private.written_care_notify(uuid,uuid,text,jsonb)',
                              'private.patient_is_member(uuid)', 'private.written_care_setting(text)'] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S22 assertion: authenticated can execute %', v_fn; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.async_consults', 'INSERT') or has_table_privilege('authenticated', 'public.async_consults', 'UPDATE') then
    raise exception 'S22 assertion: authenticated can still write async_consults directly';
  end if;
  if has_column_privilege('authenticated', 'public.async_consults', 'question', 'SELECT') or has_column_privilege('authenticated', 'public.async_consults', 'answer', 'SELECT') then
    raise exception 'S22 assertion: authenticated can still read the question or answer text directly';
  end if;
  if (select count(*) from public.written_care_config where is_active) <> 1 then raise exception 'S22 assertion: exactly one active config row'; end if;
end $$;
