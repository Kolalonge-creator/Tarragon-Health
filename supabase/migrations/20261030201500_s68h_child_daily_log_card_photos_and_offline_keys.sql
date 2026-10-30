-- S68b: the daily child log (one-tap feed, sleep, nappy), the paper vaccine card photo, and the idempotency keys that let the phone queue
-- the S68 writes that were online-only. NOT applied to any project by this branch.
--
-- What this adds
--   1. public.child_daily_events      append-only events about a CHILD (feed, sleep start/stop, wet/dirty nappy). Keyed on the child's profile,
--                                     so a second caregiver granted the child (never the mother) can read it. A "logged by" label is a name tag
--                                     on the entry, not an account. No update, no delete: a correction is a new row that points at the old one.
--   2. public.child_card_photos        a photo of the paper immunisation card, stored as an attachment record (private bucket child-card-photos).
--                                     No QR, no model, no reading of the image: a care team member looks at it.
--   3. client_id (+ logged_by_label)   on breastfeeding_feed_log and child_growth_measurements, so a replay of a queued write is a duplicate
--                                     (23505), never a second row. Additive; every existing row keeps working (client_id is NULL for them).
--
-- Guard: inserts into the two new tables are closed while the existing maternal_enabled go-live guard is off (private.go_live_open_patient,
-- the same call the S68 feed log makes). READS are never gated by the guard or by any plan or entitlement: a child's own history is never behind
-- a paywall or a switch. private.go_live_conditions() is untouched.
--
-- Reproductive / maternal data: nothing here is the mother's. The mother's feed log (breastfeeding_feed_log) keeps its S68e policies exactly;
-- this migration only adds two nullable columns and a partial unique index to it. The new tables carry the CHILD's data and are written fresh
-- (not copied from a reproductive sibling): the child, the people who manage the child, a second caregiver with the medical_history category on
-- the child's own grant, and org staff. Literals are cast so a later overload of can_read_clinical cannot make them ambiguous.

-- ---------------------------------------------------------------------------
-- 0. One wrapper for "may act for this child, and the child is still a minor"
-- ---------------------------------------------------------------------------
-- can_act_for alone says "this person holds a manage grant". For a child's daily log the grant must also still be over a MINOR: from 18 a
-- guardian's blanket stops (S04b-1), and a log entry written for an adult by an old grant is not covered by anything. private.is_minor_dependant is
-- not executable by the API roles (it is for SECURITY DEFINER code), so the policies call this wrapper, which is.
create function private.can_act_for_minor(p_child uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_act_for(p_child) and private.is_minor_dependant(p_child)
$$;
revoke all on function private.can_act_for_minor(uuid) from public, anon;
grant execute on function private.can_act_for_minor(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. child_daily_events
-- ---------------------------------------------------------------------------
create table public.child_daily_events (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,   -- the CHILD's profile
  client_id          uuid not null,
  kind               text not null check (kind in ('feed', 'sleep_start', 'sleep_stop', 'nappy_wet', 'nappy_dirty')),
  feed_type          text check (feed_type is null or feed_type in ('breast', 'bottle', 'other')),
  occurred_at        timestamptz not null,
  client_recorded_at timestamptz,
  corrects_id        uuid references public.child_daily_events (id) on delete restrict,
  logged_by_label    text check (logged_by_label is null or (length(logged_by_label) between 1 and 24)),
  recorded_by        uuid references public.profiles (id) on delete restrict,           -- the signed-in account whose phone it was (server-stamped)
  source             text not null default 'caregiver' check (source in ('caregiver', 'clinician_recorded')),
  created_at         timestamptz not null default now(),
  constraint child_daily_events_unique_client unique (patient_id, client_id),
  constraint child_daily_events_not_self_correcting check (corrects_id is distinct from id),
  constraint child_daily_events_feed_type_only_on_feed check (kind = 'feed' or feed_type is null)
  -- No "not in the future" CHECK on purpose: a phone clock that runs fast would fail it with 23514, which the phone's outbox treats as final, and the
  -- tap would be lost. The trigger below CLAMPS occurred_at to the server's now() instead and client_recorded_at keeps what the phone said.
);
create index child_daily_events_child_idx on public.child_daily_events (patient_id, occurred_at desc);
create index child_daily_events_org_idx on public.child_daily_events (organisation_id);
create index child_daily_events_corrects_idx on public.child_daily_events (corrects_id) where corrects_id is not null;
comment on table public.child_daily_events is
  'S68b: append-only one-tap log for a child. patient_id is the CHILD. logged_by_label is a caregiver name tag (not an account). Corrections are new rows with corrects_id. Reads are never gated by the go-live guard or a plan.';
alter table public.child_daily_events enable row level security;
revoke all on public.child_daily_events from public, anon, authenticated;   -- default privileges hand authenticated update/delete too
grant select, insert on public.child_daily_events to authenticated;          -- append-only: no update, no delete

-- Staff reads and writes follow the S39b/S39g tie (a care relationship or a logged opening), not the whole organisation: the table is registered in
-- staff_read_scope below, and the proof checks a clinician WITH a tie against one WITHOUT.
create policy child_daily_events_select on public.child_daily_events for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
  );
create policy child_daily_events_insert on public.child_daily_events for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.can_act_for_minor(patient_id)
    or private.staff_may_write(patient_id, organisation_id, 'medical_history'::public.care_access_category)
  );

create or replace function private.stamp_child_daily_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_target public.child_daily_events%rowtype;
begin
  if not private.go_live_open_patient('maternal_enabled', new.patient_id) then
    raise exception 'The daily log is not open yet' using errcode = '55000', hint = 'maternal_enabled';
  end if;
  -- The organisation comes from the child's profile, never from the phone.
  select organisation_id into v_org from public.profiles where id = new.patient_id;
  if v_org is null then raise exception 'unknown child' using errcode = '22023'; end if;
  new.organisation_id := v_org;
  -- A future time (a fast phone clock) is clamped, never refused. The phone's own claim stays in client_recorded_at.
  if new.occurred_at > now() then new.occurred_at := now(); end if;
  if v_uid is not null then
    new.recorded_by := v_uid;
    new.source := case when v_uid <> new.patient_id
                        and not exists (select 1 from public.profile_access pa where pa.profile_id = new.patient_id and pa.grantee_user_id = v_uid)
                        and private.staff_may_write(new.patient_id, v_org, 'medical_history'::public.care_access_category)
                       then 'clinician_recorded' else 'caregiver' end;
  end if;
  if new.corrects_id is not null then
    select * into v_target from public.child_daily_events where id = new.corrects_id;
    if not found or v_target.patient_id <> new.patient_id then
      raise exception 'A correction must point at an entry for the same child' using errcode = '22023';
    end if;
  end if;
  if new.logged_by_label is not null then
    new.logged_by_label := nullif(btrim(regexp_replace(regexp_replace(new.logged_by_label, '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g')), '');
  end if;
  return new;
end $$;
-- S04b-1e: a new table with a patient_id is guarded against under-18 rows by default. This one exists FOR a child, so say so (the reason is
-- on the policy row). The founder rule is "a dependant under 18 holds immunisation and preventive tracking only"; whether an infant's daily
-- feed, sleep and nappy log counts as preventive tracking is the founder's call (OQ-S68B-3). Until answered it is classified allowed, which is
-- what lets the feature work at all, and it is still closed by the maternal_enabled guard for a real person.
select private.classify_minor_dependant_table('child_daily_events', 'allowed', 'preventive tracking: an infant''s feed, sleep and nappy log kept by the parent (S68b); founder to confirm, OQ-S68B-3');

revoke all on function private.stamp_child_daily_event() from public, anon, authenticated;
create trigger child_daily_events_stamp before insert on public.child_daily_events for each row execute function private.stamp_child_daily_event();

-- ---------------------------------------------------------------------------
-- 2. child_card_photos + the private bucket
-- ---------------------------------------------------------------------------
create table public.child_card_photos (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,   -- the CHILD's profile
  client_id       uuid not null,
  storage_path    text not null,
  content_type    text not null default 'image/jpeg' check (content_type in ('image/jpeg')),
  size_bytes      integer not null check (size_bytes between 1 and 5242880),
  status          text not null default 'waiting_for_care_team' check (status in ('waiting_for_care_team', 'seen_by_care_team', 'not_readable')),
  -- The row is written BEFORE the file is uploaded (so a failed insert never leaves an orphan file in the bucket). 'pending_upload' means the row exists
  -- and the file may not; the phone retries the upload and then calls confirm_child_card_photo_uploaded. Anything that shows or fetches a photo must
  -- only use rows that are 'uploaded'.
  file_state      text not null default 'pending_upload' check (file_state in ('pending_upload', 'uploaded')),
  logged_by_label text check (logged_by_label is null or (length(logged_by_label) between 1 and 24)),
  uploaded_by     uuid references public.profiles (id) on delete restrict,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint child_card_photos_unique_client unique (patient_id, client_id),
  constraint child_card_photos_seen_has_reviewer check (status = 'waiting_for_care_team' or (reviewed_by is not null and reviewed_at is not null))
);
create index child_card_photos_child_idx on public.child_card_photos (patient_id, created_at desc);
create index child_card_photos_org_idx on public.child_card_photos (organisation_id);
comment on table public.child_card_photos is
  'S68b: a photo of the paper immunisation card (row first, file second: see file_state), an attachment record only (no OCR, no QR, no model). status waiting_for_care_team until a care team member looks; reviewed_by and reviewed_at are null until a real review exists (no review screen is built yet, see OQ-S68B-4).';
alter table public.child_card_photos enable row level security;
revoke all on public.child_card_photos from public, anon, authenticated;
grant select, insert on public.child_card_photos to authenticated;           -- staff review is a later, separate function

create policy child_card_photos_select on public.child_card_photos for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.staff_may_read(patient_id, organisation_id, 'vaccinations'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'vaccinations'::public.care_access_category)
  );
create policy child_card_photos_insert on public.child_card_photos for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.can_act_for_minor(patient_id)
  );

create or replace function private.stamp_child_card_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if not private.go_live_open_patient('maternal_enabled', new.patient_id) then
    raise exception 'The card photo is not open yet' using errcode = '55000', hint = 'maternal_enabled';
  end if;
  select organisation_id into v_org from public.profiles where id = new.patient_id;
  if v_org is null then raise exception 'unknown child' using errcode = '22023'; end if;
  new.organisation_id := v_org;
  new.uploaded_by := v_uid;
  -- A new photo always starts waiting; nobody can insert one as already reviewed.
  new.status := 'waiting_for_care_team'; new.reviewed_by := null; new.reviewed_at := null; new.file_state := 'pending_upload';
  -- The file must sit exactly where the storage policy lets this account put it: <uploader>/<child>/<client id>.jpg
  if new.storage_path is distinct from (v_uid::text || '/' || new.patient_id::text || '/' || new.client_id::text || '.jpg') then
    raise exception 'The photo path does not match the account, the child and the entry' using errcode = '22023';
  end if;
  if new.logged_by_label is not null then
    new.logged_by_label := nullif(btrim(regexp_replace(regexp_replace(new.logged_by_label, '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g')), '');
  end if;
  return new;
end $$;
revoke all on function private.stamp_child_card_photo() from public, anon, authenticated;
create trigger child_card_photos_stamp before insert on public.child_card_photos for each row execute function private.stamp_child_card_photo();

select private.classify_minor_dependant_table('child_card_photos', 'allowed', 'immunisation: a photo of the paper immunisation card (S68b)');

-- The uploader says the file is there. The function checks storage.objects itself (the caller cannot just claim it) and that the caller is the one who
-- wrote the row. Idempotent. Nothing else about the row can be changed through it.
create function public.confirm_child_card_photo_uploaded(p_child uuid, p_client_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_path text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select storage_path into v_path from public.child_card_photos where patient_id = p_child and client_id = p_client_id and uploaded_by = v_uid;
  if v_path is null then raise exception 'no such photo record' using errcode = 'P0002'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'child-card-photos' and o.name = v_path) then
    raise exception 'the file has not been uploaded yet' using errcode = '55000';
  end if;
  update public.child_card_photos set file_state = 'uploaded' where patient_id = p_child and client_id = p_client_id and file_state <> 'uploaded';
  return true;
end $$;
revoke all on function public.confirm_child_card_photo_uploaded(uuid, uuid) from public, anon;
grant execute on function public.confirm_child_card_photo_uploaded(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('child-card-photos', 'child-card-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Path: '<uploader uid>/<child profile id>/<client id>.jpg'. The uploader reads and writes only their own folder; staff never read through a
-- storage policy, a server route mints a short-lived signed URL after the table's RLS confirms the record. No update, no delete from the phone.
drop policy if exists "child card photo uploader insert" on storage.objects;
-- The second folder segment must be a child the uploader is the child or may act for (a minor they hold a manage grant over), so the bucket cannot
-- be used to park files under an arbitrary profile id. A segment that is not a uuid is refused, not an error.
create policy "child card photo uploader insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'child-card-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and case when (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then ((storage.foldername(name))[2])::uuid = (select auth.uid()) or private.can_act_for_minor(((storage.foldername(name))[2])::uuid)
             else false end
  );
drop policy if exists "child card photo uploader select" on storage.objects;
create policy "child card photo uploader select" on storage.objects for select to authenticated
  using (bucket_id = 'child-card-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 3. Idempotency keys for the S68 writes the phone could not queue before
-- ---------------------------------------------------------------------------
-- The mother's feed log is now queued from the phone too, so it has the same fast-clock hazard: its CHECK (feed_log_not_in_future, S68e) would
-- refuse a tap from a phone running more than 5 minutes ahead, as a final rejection. Same fix: clamp fed_at in the stamping trigger (S68e body
-- reproduced unchanged, plus the clamp) and drop the CHECK.
alter table public.breastfeeding_feed_log drop constraint if exists feed_log_not_in_future;
create or replace function private.stamp_feed_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' and not private.go_live_open_patient('maternal_enabled', new.patient_id) then
    raise exception 'The feed log is not open yet' using errcode = '55000', hint = 'maternal_enabled';
  end if;
  if new.fed_at > now() then new.fed_at := now(); end if;
  if tg_op = 'INSERT' and v_uid is not null then
    new.recorded_by := v_uid;
    new.source := case when v_uid = new.patient_id then 'patient_entered' else 'clinician_recorded' end;
  elsif tg_op = 'UPDATE' then
    new.recorded_by := old.recorded_by; new.source := old.source;
  end if;
  if new.child_profile_id is not null and v_uid is not null and not private.is_org_staff(new.organisation_id) and not exists (
       select 1 from public.profile_access pa where pa.profile_id = new.child_profile_id and pa.grantee_user_id = new.patient_id and pa.permission_level = 'manage') then
    raise exception 'The child profile is not one you manage' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.stamp_feed_log() from public, anon, authenticated;

alter table public.breastfeeding_feed_log
  add column client_id uuid,
  add column logged_by_label text check (logged_by_label is null or (length(logged_by_label) between 1 and 24));
create unique index breastfeeding_feed_log_client_id_uq on public.breastfeeding_feed_log (patient_id, client_id) where client_id is not null;

alter table public.child_growth_measurements
  add column client_id uuid,
  add column logged_by_label text check (logged_by_label is null or (length(logged_by_label) between 1 and 24));
create unique index child_growth_measurements_client_id_uq on public.child_growth_measurements (patient_id, client_id) where client_id is not null;

comment on column public.breastfeeding_feed_log.client_id is 'S68b: the phone''s outbox id. A replay of a queued write is a unique violation (a duplicate), never a second row. NULL for rows entered on the web or before S68b.';
comment on column public.child_growth_measurements.client_id is 'S68b: the phone''s outbox id. A replay of a queued write is a unique violation (a duplicate), never a second row. NULL for rows entered on the web or before S68b.';

-- ---------------------------------------------------------------------------
-- 4. Register the new child-keyed tables in the S39d data registry (same default classification as the S68 tables; awaiting review)
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name,
       'patient_id',
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S68b (daily child log) was added; awaiting review.'
  from unnest(array['child_daily_events', 'child_card_photos']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

-- The S39b registry: both tables are TIED (staff need a care relationship or a logged opening), so the G1 check (every patient table with a staff read
-- policy is registered) and G2 (a tied table has no plain organisation-wide staff read left) hold for them.
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('child_daily_events', 'tied', 'patient_id', 'medical_history', null),
  ('child_card_photos', 'tied', 'patient_id', 'vaccinations', null)
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.child_daily_events', 'SELECT') or has_table_privilege('anon', 'public.child_card_photos', 'SELECT') then
    raise exception 'S68b self-check: anon must not read the new tables';
  end if;
  if has_table_privilege('authenticated', 'public.child_daily_events', 'UPDATE') or has_table_privilege('authenticated', 'public.child_daily_events', 'DELETE') then
    raise exception 'S68b self-check: the daily log is append-only for every signed-in user';
  end if;
  if has_table_privilege('authenticated', 'public.child_card_photos', 'UPDATE') or has_table_privilege('authenticated', 'public.child_card_photos', 'DELETE') then
    raise exception 'S68b self-check: card photos cannot be changed or removed from the phone';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('child_daily_events', 'child_card_photos') and coalesce(qual, '') || coalesce(with_check, '') like '%private.is_org_staff(%') then
    raise exception 'S68b self-check: staff access to the child tables must use the tied helpers, not is_org_staff';
  end if;
  if has_function_privilege('anon', 'public.confirm_child_card_photo_uploaded(uuid,uuid)', 'EXECUTE') then
    raise exception 'S68b self-check: confirm_child_card_photo_uploaded must not be executable by anon';
  end if;
  if has_function_privilege('anon', 'private.can_act_for_minor(uuid)', 'EXECUTE') then
    raise exception 'S68b self-check: can_act_for_minor must not be executable by anon';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'child_daily_events' and cmd = 'SELECT' and qual ~* 'entitle|plan|subscription|go_live') <> 0 then
    raise exception 'S68b self-check: a child''s history must not be behind a plan or a guard';
  end if;
end $$;
