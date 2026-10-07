-- S59 part 3 of 4: photos of a visible problem for a clinician to look at (spec 12.7).
--
-- WHAT THIS IS, AND IS NOT. A patient (or the person acting for them) may send a photo of a rash, wound or eye problem for a member
-- of the care team to look at. A clinician looks at it and writes back in plain words with a next step. There is NO automated
-- scoring, classification, risk figure or "possible diagnosis" anywhere: the table has no such column (a proof scans the column list
-- and fails on any that looks like one), nothing reads the image, and the patient copy says a clinician reviews it and that it is not a
-- diagnosis. SkinVision-style skin cancer scoring is forbidden by the spec and is not built.
--
-- WHAT THIS ADDS
--   * skin_photo_policy_config (versioned, INV-16): size and type limits, how many open photos, retention, signed link lifetime.
--     Seed v1 mirrors the PROPOSED `symptom.skin_photo_policy` entry (a Jest test fails on drift). Not signed by anyone.
--   * a PRIVATE storage bucket `skin-photos` (public = false, size and type limits taken from the config). Path '<patient_id>/<uuid>.jpg'.
--     Per-patient storage RLS: the patient may READ only objects in their own folder. NO insert, update or delete policy exists for any
--     client: files are written by the server (service role) after it has stripped the image metadata, and read by a clinician only
--     through a short-lived signed link minted after the audited read below.
--   * public.skin_photos: one row per photo; consent recorded (`consent_at`, `consent_text_version`); retention recorded
--     (`retention_until`, from the config at submission, shortened or reset at review). No staff policy (INV-12): clinicians go through
--     audited functions; patients read their own rows by column grant (no internal note, no clinician id).
--   * register_skin_photo / withdraw_skin_photo (patient side); list_my_skin_photo_reviews, read_skin_photo_audited and
--     complete_skin_photo_review (clinician side, per-patient tie, reviewing tier, audited reads, a denied attempt is audited);
--     skin_photos_due_for_purge / mark_skin_photo_purged (service role only) for the retention job.
--   * the work item: a clinical task of the EXISTING type `symptom_review` with dedup key 'skin_photo_review:<id>' (no new task type, so
--     the PROPOSED task-type mirror is untouched). Task creation failure is audited and pages an incident, never silent.
--   * event skin_photo.submitted (ids only, INV-07).
--
-- NOT BUILT HERE (OQ-S59-07): the job that actually deletes expired objects from storage. Deleting storage rows from SQL leaves the file
-- behind on hosted storage, so the deletion must go through the storage API from a server job. Until it exists `retention_until` records
-- when each photo is due to go and skin_photos_due_for_purge() lists them. The checker (and so this feature) is OFF.
--
-- INV-14: register_skin_photo refuses with 42501 while symptom_checker_enabled is closed for that patient (test accounts excepted).
-- Intimate areas are deliberately not offered as a body area; the patient copy says so.
-- ROWS AFFECTED: none changed (new tables, one config row, one bucket, one event type).
-- GRANT NOTE: a new table gets an `authenticated` default grant: revoked, then only the patient columns are granted.

-- ---------------------------------------------------------------------------
-- 1. Policy config (versioned, PROPOSED)
-- ---------------------------------------------------------------------------
create table public.skin_photo_policy_config (
  version    integer primary key check (version >= 1),
  config     jsonb not null check (jsonb_typeof(config) = 'object'),
  notes      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index skin_photo_policy_config_one_active on public.skin_photo_policy_config (is_active) where is_active;
alter table public.skin_photo_policy_config enable row level security;
revoke all on public.skin_photo_policy_config from public, anon, authenticated;
create policy skin_photo_policy_config_read on public.skin_photo_policy_config for select to authenticated using (true);
grant select on public.skin_photo_policy_config to authenticated;

-- skin-photo-policy-begin
insert into public.skin_photo_policy_config (version, config, notes, is_active)
values (1, $json$
{"max_bytes": 4000000, "allowed_types": ["image/jpeg", "image/png"], "max_open_per_patient": 5, "retention_days_unreviewed": 30, "retention_days_after_review": 90, "signed_url_seconds": 60}
$json$::jsonb, 'PROPOSED, not signed. Mirrors the symptom.skin_photo_policy entry in packages/shared/src/proposed-config.', true);
-- skin-photo-policy-end

create or replace function private.skin_photo_policy() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.skin_photo_policy_config where is_active $$;
revoke all on function private.skin_photo_policy() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The private bucket (limits come from the config) and per-patient storage RLS
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'skin-photos', 'skin-photos', false, (c.config ->> 'max_bytes')::bigint,
       array(select jsonb_array_elements_text(c.config -> 'allowed_types'))
  from public.skin_photo_policy_config c where c.is_active
on conflict (id) do nothing;

-- Read only your own folder. There is deliberately NO insert, update or delete policy: the server writes and removes the files.
drop policy if exists "skin photo patient select" on storage.objects;
create policy "skin photo patient select" on storage.objects
  for select to authenticated
  using (bucket_id = 'skin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 3. The table
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('skin_photo.submitted', 'A patient sent a photo of a visible problem for the care team to look at', 'S59', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('skin_photo.submitted', 1, array['photo_id'])
on conflict (event_type, version) do nothing;

create table public.skin_photos (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  -- provenance: where the row came from and who sent it (the patient, or the carer acting for them)
  source                text not null default 'patient_upload' check (source = 'patient_upload'),
  recorded_by           uuid not null references public.profiles (id) on delete restrict,
  assessment_id         uuid references public.symptom_triage_assessments (id) on delete set null,
  storage_path          text not null unique,
  content_type          text not null,
  size_bytes            integer not null check (size_bytes > 0),
  body_area             text not null check (body_area in ('face', 'scalp', 'neck', 'chest_or_back', 'abdomen', 'arm_or_hand', 'leg_or_foot', 'eye', 'mouth_or_ear', 'other')),
  note                  text check (note is null or char_length(btrim(note)) between 1 and 500),
  -- consent: the patient was shown what happens to the photo and agreed, and which wording they agreed to
  consent_at            timestamptz not null,
  consent_text_version  text not null check (char_length(btrim(consent_text_version)) > 0),
  status                text not null default 'submitted' check (status in ('submitted', 'reviewed', 'withdrawn', 'purged')),
  policy_version        integer not null references public.skin_photo_policy_config (version) on delete restrict,
  retention_until       timestamptz not null,
  purged_at             timestamptz,
  task_id               uuid references public.clinical_tasks (id) on delete set null,
  -- the clinician's side (plain words and a next step; never a score)
  clinician_id          uuid references public.profiles (id) on delete restrict,
  clinician_next_step   public.triage_category,
  clinician_message     text check (clinician_message is null or char_length(btrim(clinician_message)) between 10 and 600),
  internal_note         text check (internal_note is null or char_length(internal_note) <= 2000),
  reviewed_at           timestamptz,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint skin_photos_path_in_patient_folder check (storage_path like patient_id::text || '/%'),
  constraint skin_photos_reviewed_is_complete check (
    status <> 'reviewed' or (clinician_id is not null and clinician_next_step is not null and clinician_message is not null and reviewed_at is not null)),
  constraint skin_photos_purged_has_time check ((status = 'purged') = (purged_at is not null))
);
create index skin_photos_patient_idx on public.skin_photos (patient_id, created_at desc);
create index skin_photos_open_idx on public.skin_photos (organisation_id, created_at) where status = 'submitted';
create index skin_photos_retention_idx on public.skin_photos (retention_until) where purged_at is null;

alter table public.skin_photos enable row level security;
revoke all on public.skin_photos from public, anon, authenticated;

-- The patient, the person who sent it, or a care-circle grantee with medical_history. NO staff policy.
create policy skin_photos_select_own on public.skin_photos
  for select to authenticated
  using (patient_id = (select auth.uid()) or recorded_by = (select auth.uid())
         or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category));
grant select (id, patient_id, assessment_id, storage_path, content_type, size_bytes, body_area, note, status, consent_at,
              retention_until, clinician_next_step, clinician_message, reviewed_at, created_at)
  on public.skin_photos to authenticated;

create trigger skin_photos_set_updated_at before update on public.skin_photos for each row execute function private.set_updated_at();

-- A reviewed photo is a clinical record: never edited or deleted by a client (status may only move on through the functions below).
create or replace function private.skin_photos_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a skin photo record cannot be deleted' using errcode = '42501';
  end if;
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.storage_path is distinct from old.storage_path or new.recorded_by is distinct from old.recorded_by
     or new.consent_at is distinct from old.consent_at then
    raise exception 'a skin photo record cannot be moved or re-consented' using errcode = '42501';
  end if;
  if old.status = 'reviewed' and (new.clinician_message is distinct from old.clinician_message or new.clinician_next_step is distinct from old.clinician_next_step
                                  or new.clinician_id is distinct from old.clinician_id or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'a completed photo review cannot be changed' using errcode = '42501';
  end if;
  if old.status in ('withdrawn', 'purged') and new.status is distinct from old.status and not (old.status = 'withdrawn' and new.status = 'purged') then
    raise exception 'a withdrawn or purged photo cannot come back' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.skin_photos_guard() from public, anon, authenticated;
create trigger skin_photos_00_guard before update or delete on public.skin_photos for each row execute function private.skin_photos_guard();

-- ---------------------------------------------------------------------------
-- 4. Patient side: register (after the server stored the stripped file), withdraw
-- ---------------------------------------------------------------------------
create or replace function private.may_act_for_photo(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_patient = (select auth.uid())
      or exists (select 1 from public.profile_access pa
                  where pa.profile_id = p_patient and pa.grantee_user_id = (select auth.uid())
                    and pa.permission_level = 'manage' and (pa.expires_at is null or pa.expires_at > now()))
$$;
revoke all on function private.may_act_for_photo(uuid) from public, anon, authenticated;

create or replace function public.register_skin_photo(
  p_patient uuid, p_storage_path text, p_body_area text, p_note text, p_consent_shown boolean, p_consent_text_version text,
  p_assessment uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pol jsonb := private.skin_photo_policy();
  v_pol_version integer;
  v_org uuid;
  v_obj record;
  v_open integer;
  v_id uuid;
  v_task uuid;
  v_test boolean;
  v_event uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_patient is null or not private.may_act_for_photo(p_patient) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if not private.go_live_open_patient('symptom_checker_enabled', p_patient) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;
  if p_consent_shown is not true or p_consent_text_version is null or char_length(btrim(p_consent_text_version)) = 0 then
    raise exception 'the person has to be shown what happens to the photo and agree' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path not like p_patient::text || '/%' then
    raise exception 'the photo is not in the patient''s folder' using errcode = '22023';
  end if;
  -- the file must really be in the private bucket, and inside the limits the config sets (the bucket enforces them too)
  select o.name, coalesce((o.metadata ->> 'size')::integer, 0) as size_bytes, o.metadata ->> 'mimetype' as mimetype
    into v_obj from storage.objects o where o.bucket_id = 'skin-photos' and o.name = p_storage_path;
  if not found then raise exception 'the photo was not stored' using errcode = '22023'; end if;
  if v_obj.size_bytes <= 0 or v_obj.size_bytes > (v_pol ->> 'max_bytes')::integer then
    raise exception 'the photo is too large' using errcode = '22023';
  end if;
  if v_obj.mimetype is null or not (v_pol -> 'allowed_types') ? v_obj.mimetype then
    raise exception 'that kind of file is not allowed' using errcode = '22023';
  end if;
  select count(*) into v_open from public.skin_photos where patient_id = p_patient and status = 'submitted';
  if v_open >= (v_pol ->> 'max_open_per_patient')::integer then
    raise exception 'too many photos are waiting to be looked at' using errcode = '22023';
  end if;
  if p_assessment is not null and not exists (select 1 from public.symptom_triage_assessments a where a.id = p_assessment and a.patient_id = p_patient) then
    raise exception 'that check is not this patient''s' using errcode = '22023';
  end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = p_patient;
  select version into v_pol_version from public.skin_photo_policy_config where is_active;

  insert into public.skin_photos
    (organisation_id, patient_id, recorded_by, assessment_id, storage_path, content_type, size_bytes, body_area, note,
     consent_at, consent_text_version, policy_version, retention_until, is_test)
  values
    (v_org, p_patient, v_uid, p_assessment, p_storage_path, v_obj.mimetype, v_obj.size_bytes, p_body_area, nullif(btrim(p_note), ''),
     now(), btrim(p_consent_text_version), v_pol_version, now() + make_interval(days => (v_pol ->> 'retention_days_unreviewed')::integer), coalesce(v_test, false))
  returning id into v_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, v_uid, 'skin_photo.submitted', 'skin_photo', v_id, jsonb_build_object('consent_text_version', btrim(p_consent_text_version)));

  -- the work item; a failure is loud, never a silent success (the photo is saved either way)
  begin
    v_task := private.create_clinical_task(p_patient, 'symptom_review', null, 'skin_photo_review:' || v_id, null, null, null);
    update public.skin_photos set task_id = v_task where id = v_id;
  exception when others then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (v_org, v_uid, 'skin_photo.task_error', 'skin_photo', v_id, jsonb_build_object('error', sqlerrm));
    perform private.page_incident(v_org, 'skin_photo_task_failed:' || v_id, 'A skin photo has no task',
      'A patient sent a photo for review and the clinical task could not be created; see audit_log action skin_photo.task_error.');
  end;
  begin
    v_event := private.emit_domain_event('skin_photo.submitted', v_org, jsonb_build_object('photo_id', v_id),
      'skin_photo.submitted:' || v_id, p_patient, 'skin_photo', v_id, 'normal');
  exception when others then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (v_org, v_uid, 'skin_photo.event_error', 'skin_photo', v_id, jsonb_build_object('error', sqlerrm));
    perform private.page_incident(v_org, 'skin_photo_event_failed:' || v_id, 'A skin photo event could not be written',
      'The photo was saved and its task raised; only the skin_photo.submitted event failed. See audit_log action skin_photo.event_error.');
  end;
  return jsonb_build_object('photo_id', v_id, 'has_task', v_task is not null, 'retention_until', now() + make_interval(days => (v_pol ->> 'retention_days_unreviewed')::integer));
end $$;
revoke all on function public.register_skin_photo(uuid, text, text, text, boolean, text, uuid) from public;
grant execute on function public.register_skin_photo(uuid, text, text, text, boolean, text, uuid) to authenticated;

-- The patient takes a photo back. The row stays (so the audit trail holds); the file is due for removal at once.
create or replace function public.withdraw_skin_photo(p_photo uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.skin_photos%rowtype;
begin
  select * into p from public.skin_photos where id = p_photo for update;
  if not found or (select auth.uid()) is null or not private.may_act_for_photo(p.patient_id) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if p.status in ('withdrawn', 'purged') then return jsonb_build_object('photo_id', p.id, 'status', p.status, 'storage_path', p.storage_path); end if;
  update public.skin_photos set status = 'withdrawn', retention_until = now() where id = p.id;
  -- an unreviewed photo's open task is no longer needed
  if p.task_id is not null and p.status = 'submitted' then
    begin
      if (select t.state::text from public.clinical_tasks t where t.id = p.task_id) in ('created', 'offered_to_lead', 'open', 'claimed', 'escalated') then
        update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = p.task_id and ended_at is null;
        perform private.apply_task_transition(p.task_id, 'cancelled', 'lead', (select auth.uid()), 'The patient withdrew the photo (' || p.id || ')');
      end if;
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (p.organisation_id, (select auth.uid()), 'skin_photo.task_cancel_error', 'skin_photo', p.id, jsonb_build_object('error', sqlerrm));
    end;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (p.organisation_id, (select auth.uid()), 'skin_photo.withdrawn', 'skin_photo', p.id, '{}'::jsonb);
  return jsonb_build_object('photo_id', p.id, 'status', 'withdrawn', 'storage_path', p.storage_path);
end $$;
revoke all on function public.withdraw_skin_photo(uuid) from public;
grant execute on function public.withdraw_skin_photo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Clinician side
-- ---------------------------------------------------------------------------
create or replace function public.list_my_skin_photo_reviews() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- queue metadata only: a patient number and a time. No body area, note, name or image until the audited read.
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'submitted_at', s.created_at, 'patient_ref', p.patient_number) order by s.created_at)
      from public.skin_photos s join public.profiles p on p.id = s.patient_id
     where s.status = 'submitted' and private.clinician_has_patient_access(s.patient_id)), '[]'::jsonb);
end $$;
revoke all on function public.list_my_skin_photo_reviews() from public;
grant execute on function public.list_my_skin_photo_reviews() to authenticated;

-- Returns the storage path only to a tied clinician, after writing the audit row; the server then mints a short-lived signed link.
create or replace function public.read_skin_photo_audited(p_photo uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.skin_photos%rowtype;
  pr public.profiles%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into s from public.skin_photos where id = p_photo;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not private.can_staff_read_clinical(s.patient_id, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(s.patient_id, array['skin_photo'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  if s.status in ('withdrawn', 'purged') then return jsonb_build_object('status', 'gone'); end if;
  select * into pr from public.profiles where id = s.patient_id;
  perform private.audit_chart_read(s.patient_id, array['skin_photo'], p_reason, 'success');
  return jsonb_build_object('status', 'ok',
    'photo', jsonb_build_object('id', s.id, 'storage_path', s.storage_path, 'body_area', s.body_area, 'note', s.note, 'photo_status', s.status,
      'submitted_at', s.created_at, 'consent_at', s.consent_at, 'clinician_next_step', s.clinician_next_step, 'clinician_message', s.clinician_message,
      'reviewed_at', s.reviewed_at, 'sent_by_carer', s.recorded_by <> s.patient_id),
    'patient', jsonb_build_object('id', pr.id, 'name', pr.full_name, 'patient_number', pr.patient_number, 'sex', pr.sex,
      'age_years', case when pr.date_of_birth is null then null else extract(year from age(current_date, pr.date_of_birth))::integer end),
    'signed_url_seconds', (private.skin_photo_policy() ->> 'signed_url_seconds')::integer);
end $$;
revoke all on function public.read_skin_photo_audited(uuid, text) from public;
grant execute on function public.read_skin_photo_audited(uuid, text) to authenticated;

create or replace function public.complete_skin_photo_review(p_photo uuid, p_next_step public.triage_category, p_message text, p_internal_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.skin_photos%rowtype;
  v_pol jsonb := private.skin_photo_policy();
begin
  if v_uid is null or not private.is_reviewing_clinician() then
    raise exception 'only a clinician at medical officer level or above can complete a photo review' using errcode = '42501';
  end if;
  select * into s from public.skin_photos where id = p_photo for update;
  if not found then raise exception 'unknown photo' using errcode = '22023'; end if;
  if s.status <> 'submitted' then raise exception 'this photo is not waiting for a review' using errcode = '22023'; end if;
  -- INV-12: only a clinician tied to this patient. Returned, not raised, so the audit row of the refusal is kept.
  if not private.clinician_has_patient_access(s.patient_id) then
    perform private.audit_chart_read(s.patient_id, array['skin_photo'], 'attempted to complete a photo review without a tie', 'denied');
    return jsonb_build_object('ok', false, 'status', 'denied');
  end if;
  if p_next_step is null or p_message is null then
    raise exception 'a next step and a message for the patient are both needed' using errcode = '22023';
  end if;
  update public.skin_photos
     set status = 'reviewed', clinician_id = v_uid, clinician_next_step = p_next_step, clinician_message = btrim(p_message),
         internal_note = nullif(btrim(p_internal_note), ''), reviewed_at = now(),
         retention_until = now() + make_interval(days => (v_pol ->> 'retention_days_after_review')::integer)
   where id = s.id;
  perform private.audit_chart_read(s.patient_id, array['skin_photo'], 'completed a photo review', 'success');
  perform private.log_audit('skin_photo.reviewed', 'skin_photo', s.id, jsonb_build_object('next_step', p_next_step));

  if s.task_id is not null then
    begin
      if exists (select 1 from public.task_claims c where c.task_id = s.task_id and c.clinician_id = v_uid and c.ended_at is null) then
        perform public.queue_complete(s.task_id, jsonb_build_object('skin_photo', s.id));
      elsif (select t.state::text from public.clinical_tasks t where t.id = s.task_id) in ('created', 'offered_to_lead', 'open', 'claimed', 'escalated') then
        update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = s.task_id and ended_at is null;
        perform private.apply_task_transition(s.task_id, 'cancelled', 'lead', v_uid, 'Photo review completed by another clinician on the care team (photo ' || s.id || ')');
      end if;
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (s.organisation_id, v_uid, 'skin_photo.task_complete_error', 'skin_photo', s.id, jsonb_build_object('task_id', s.task_id, 'error', sqlerrm));
      perform private.page_incident(s.organisation_id, 'skin_photo_task_not_closed:' || s.id, 'A completed photo review left its task open',
        'The review was saved but its clinical task could not be closed; see audit_log action skin_photo.task_complete_error.');
    end;
  end if;
  return jsonb_build_object('ok', true, 'photo_id', s.id);
end $$;
revoke all on function public.complete_skin_photo_review(uuid, public.triage_category, text, text) from public;
grant execute on function public.complete_skin_photo_review(uuid, public.triage_category, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Retention (the deletion job itself is not built, OQ-S59-07)
-- ---------------------------------------------------------------------------
create or replace function public.skin_photos_due_for_purge() returns table (id uuid, storage_path text, retention_until timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.storage_path, s.retention_until from public.skin_photos s
   where s.purged_at is null and s.status <> 'purged' and s.retention_until <= now() order by s.retention_until
$$;
create or replace function public.mark_skin_photo_purged(p_photo uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.skin_photos set status = 'purged', purged_at = now() where id = p_photo and purged_at is null and retention_until <= now();
  if not found then raise exception 'that photo is not due for removal' using errcode = '22023'; end if;
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
    select organisation_id, 'skin_photo.purged', 'skin_photo', id, '{}'::jsonb from public.skin_photos where id = p_photo;
end $$;
revoke all on function public.skin_photos_due_for_purge() from public, anon, authenticated;
revoke all on function public.mark_skin_photo_purged(uuid) from public, anon, authenticated;
grant execute on function public.skin_photos_due_for_purge() to service_role;
grant execute on function public.mark_skin_photo_purged(uuid) to service_role;

update public.go_live_guards
   set enforced_in = enforced_in || array['register_skin_photo (public function, refuses with 42501 while closed)']
 where key = 'symptom_checker_enabled'
   and not (enforced_in @> array['register_skin_photo (public function, refuses with 42501 while closed)']);

-- ---------------------------------------------------------------------------
-- 7. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'skin_photos'
              and column_name ~* '(score|probab|classif|risk|confidence|malig|cancer|diagnos|melan|lesion_type|ai_)') then
    raise exception 'S59 assertion: skin_photos has a column that looks like an automated score or classification';
  end if;
  if (select public from storage.buckets where id = 'skin-photos') is not false then
    raise exception 'S59 assertion: the skin-photos bucket is not private';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%skin photo%' and cmd <> 'SELECT') then
    raise exception 'S59 assertion: a client write policy exists on the skin-photos bucket';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'skin_photos' and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%')) then
    raise exception 'S59 assertion: a staff-wide policy exists on skin_photos';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'skin_photos') <> 1 then
    raise exception 'S59 assertion: skin_photos should have exactly one policy';
  end if;
  if has_table_privilege('authenticated', 'public.skin_photos', 'INSERT') or has_table_privilege('authenticated', 'public.skin_photos', 'UPDATE')
     or has_table_privilege('authenticated', 'public.skin_photos', 'DELETE') or has_table_privilege('authenticated', 'public.skin_photos', 'SELECT') then
    raise exception 'S59 assertion: authenticated holds a table-level grant on skin_photos';
  end if;
  if has_column_privilege('authenticated', 'public.skin_photos', 'internal_note', 'SELECT') or has_column_privilege('authenticated', 'public.skin_photos', 'clinician_id', 'SELECT') then
    raise exception 'S59 assertion: a patient can select the internal note or the clinician id';
  end if;
  if has_function_privilege('anon', 'public.register_skin_photo(uuid,text,text,text,boolean,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_skin_photo_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_skin_photo_review(uuid,public.triage_category,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_my_skin_photo_reviews()', 'EXECUTE')
     or has_function_privilege('anon', 'public.withdraw_skin_photo(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.skin_photos_due_for_purge()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.mark_skin_photo_purged(uuid)', 'EXECUTE') then
    raise exception 'S59 assertion: a skin photo function is executable by a role that must not run it';
  end if;
end $$;
