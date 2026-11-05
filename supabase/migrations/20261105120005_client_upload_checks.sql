-- Security audit 2026-11-05, M-4/L-4 (follow-up to PR #1749): uploads that go straight from the browser or the phone app to
-- Storage with the user's own token are now checked on the server too.
--
-- PR #1749 put every SERVER upload through prepareUpload() (apps/web/src/lib/uploads/prepare-upload.ts): the bytes must be the
-- format they claim, and JPEG/PNG/WEBP location metadata is removed. Nine buckets also take uploads written directly by a
-- client (web document capture, meal photos, care-message attachments, vaccination certificates, second-opinion documents,
-- written-question photos; on the phone, child-card photos, outside records, document capture, second opinion and the
-- written-question outbox). Rewriting those clients to go through the server would not close the gap on its own: as long as
-- the storage INSERT policy lets a patient write into their folder, anyone holding their own token can call the Storage API
-- directly, and phone builds already in the field (and the offline outbox, which replays later) keep the direct path. So the
-- check is attached to the object, not to the client:
--
--   1. private.client_upload_checks: one row per object a signed-in user wrote (owner_id set) in a covered bucket.
--   2. An AFTER INSERT/UPDATE trigger on storage.objects queues that row as 'pending'. Service-role writes (owner_id null) are
--      not queued: those are server uploads that already went through prepareUpload, including the verifier's own clean copy.
--   3. The app's verifier (apps/web/src/lib/uploads/verify-stored-upload.ts, the same prepareUpload, not a second checker)
--      claims pending rows, downloads each object, and either leaves it ('clean'), writes the metadata-free copy back
--      ('cleaned'), or moves a file whose bytes are not what it claims into the private upload-quarantine bucket
--      ('quarantined'). It runs when the client asks right after an upload (checkMyUploadAction on the web,
--      /api/mobile/upload-check on the phone), every two minutes from
--      pg_cron once the app_base_url and cron_secret Vault secrets exist, and daily from Vercel cron as a backstop.
--
-- Also: patient profile photos (public bucket) are written by the server only, at an opaque path that does not carry the
-- patient's id. All four own-folder policies on patient-avatars are dropped, so nobody can put an unchecked file into a public
-- bucket with their own token. Counted live before writing this (2026-11-05): 0 objects in patient-avatars and 0 profiles
-- with an avatar_url, so there is no existing photo under a user-id path to move and no conversion step.
--
-- Not a malware scan; that is a separate founder decision (deferred 2026-11-05).
-- Proof: packages/db/tests/client_upload_checks.sql.

-- 1. The queue ---------------------------------------------------------------------------------------------------------------

create table private.client_upload_checks (
  bucket_id text not null,
  object_name text not null,
  owner_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'checking', 'clean', 'cleaned', 'quarantined', 'gone', 'error')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  checked_at timestamptz,
  detail text,
  created_at timestamptz not null default now(),
  primary key (bucket_id, object_name)
);

create index client_upload_checks_open_idx on private.client_upload_checks (created_at)
  where status in ('pending', 'checking', 'error');

alter table private.client_upload_checks enable row level security;
revoke all on private.client_upload_checks from public, anon, authenticated;

comment on table private.client_upload_checks is
  'Security audit 2026-11-05 M-4/L-4: objects a signed-in user wrote straight to Storage, waiting for or past the server '
  'check (bytes match the type, photo location removed). Written by the storage.objects trigger and the service-role verifier only.';

-- The buckets a client can write to directly. A new bucket that takes client-direct uploads must be added here.
create or replace function private.is_client_upload_checked_bucket(p_bucket text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_bucket in (
    'vaccination-certificates',
    'meal-photos',
    'patient-documents',
    'care-message-attachments',
    'second-opinion-documents',
    'child-card-photos',
    'async-consult-attachments',
    'clinical-staff-photos',
    'patient-avatars'
  );
$$;

-- 2. The trigger -------------------------------------------------------------------------------------------------------------

create or replace function private.queue_client_upload_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is null or not private.is_client_upload_checked_bucket(new.bucket_id) then
    return null;
  end if;
  -- An update matters only when the content or the key changed (a replaced file, or a moved one).
  if tg_op = 'UPDATE'
     and new.version is not distinct from old.version
     and new.name = old.name
     and new.bucket_id = old.bucket_id then
    return null;
  end if;
  insert into private.client_upload_checks as k (bucket_id, object_name, owner_id)
  values (new.bucket_id, new.name, new.owner_id)
  on conflict (bucket_id, object_name) do update
    set status = 'pending', owner_id = excluded.owner_id, attempts = 0, claimed_at = null, checked_at = null,
        detail = null, created_at = now();
  return null;
end;
$$;

revoke all on function private.queue_client_upload_check() from public, anon, authenticated;

drop trigger if exists queue_client_upload_check on storage.objects;
-- The WHEN clause keeps every other bucket, and every service-role write, from entering the function at all.
create trigger queue_client_upload_check
  after insert or update on storage.objects
  for each row
  when (new.owner_id is not null and private.is_client_upload_checked_bucket(new.bucket_id))
  execute function private.queue_client_upload_check();

-- 3. Claim and finish (service role only) ------------------------------------------------------------------------------------

-- Pending rows, plus a row stuck in 'checking' or failed with 'error': retried after ten minutes for the first five tries,
-- then hourly for as long as it keeps failing, so no file is ever left unchecked for good. With p_bucket,
-- p_name and p_owner: only that object, and only when that user wrote it (the "check my upload now" path).
create or replace function public.claim_client_upload_checks(
  p_limit integer default 25,
  p_bucket text default null,
  p_name text default null,
  p_owner text default null
)
returns table (bucket_id text, object_name text, mimetype text, owner_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'claim_client_upload_checks is for the server only' using errcode = '42501';
  end if;
  return query
  with picked as (
    select k.bucket_id, k.object_name
    from private.client_upload_checks k
    where (p_bucket is null or (k.bucket_id = p_bucket and k.object_name = p_name and k.owner_id = p_owner))
      and (
        k.status = 'pending'
        or (k.status in ('checking', 'error')
            and k.claimed_at < now() - case when k.attempts < 5 then interval '10 minutes' else interval '1 hour' end)
      )
    order by k.created_at
    limit least(greatest(coalesce(p_limit, 25), 1), 200)
    for update skip locked
  ), claimed as (
    update private.client_upload_checks k
    set status = 'checking', claimed_at = now(), attempts = k.attempts + 1
    from picked
    where k.bucket_id = picked.bucket_id and k.object_name = picked.object_name
    returning k.bucket_id, k.object_name, k.owner_id
  )
  select c.bucket_id, c.object_name, o.metadata ->> 'mimetype', c.owner_id
  from claimed c
  left join storage.objects o on o.bucket_id = c.bucket_id and o.name = c.object_name;
end;
$$;

-- Records the outcome. Applies only while the row is still 'checking': if the user replaced the file meanwhile, the trigger
-- has put it back to 'pending' and the stale result is dropped, so the new file is checked on the next run.
create or replace function public.finish_client_upload_check(
  p_bucket text,
  p_name text,
  p_status text,
  p_detail text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'finish_client_upload_check is for the server only' using errcode = '42501';
  end if;
  if p_status not in ('clean', 'cleaned', 'quarantined', 'gone', 'error') then
    raise exception 'finish_client_upload_check: unknown outcome %', p_status using errcode = '22023';
  end if;
  update private.client_upload_checks
  set status = p_status, checked_at = now(), detail = left(p_detail, 500)
  where bucket_id = p_bucket and object_name = p_name and status = 'checking';
  get diagnostics v_rows = row_count;
  -- A refused child-card photo never arrives, so its placeholder row (written first by the phone's outbox, still
  -- 'pending_upload') is removed rather than left saying a photo is on its way. An uploaded row is never touched.
  if v_rows = 1 and p_status = 'quarantined' and p_bucket = 'child-card-photos' then
    delete from public.child_card_photos where storage_path = p_name and file_state = 'pending_upload';
  end if;
  return v_rows = 1;
end;
$$;

-- The current status for one object a given user wrote. The "check my upload now" path uses it to report a file the sweep
-- already quarantined as refused; the verifier uses it to confirm the row is still 'checking' (the user has not replaced the
-- file) right before it writes a clean copy back or removes a refused file.
create or replace function public.client_upload_check_outcome(p_bucket text, p_name text, p_owner text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'client_upload_check_outcome is for the server only' using errcode = '42501';
  end if;
  return (select k.status from private.client_upload_checks k
          where k.bucket_id = p_bucket and k.object_name = p_name and k.owner_id = p_owner);
end;
$$;

revoke all on function public.client_upload_check_outcome(text, text, text) from public, anon, authenticated;
grant execute on function public.client_upload_check_outcome(text, text, text) to service_role;

-- Statuses for a batch of objects in one bucket (only those that have a row; files from before this migration have none).
-- Server-side readers use it to withhold a file that is still waiting for its check, or was refused (it is checked inline first).
create or replace function public.client_upload_check_statuses(p_bucket text, p_names text[])
returns table (object_name text, status text, owner_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'client_upload_check_statuses is for the server only' using errcode = '42501';
  end if;
  return query
  select k.object_name, k.status, k.owner_id
  from private.client_upload_checks k
  where k.bucket_id = p_bucket and k.object_name = any (p_names);
end;
$$;

revoke all on function public.client_upload_check_statuses(text, text[]) from public, anon, authenticated;
grant execute on function public.client_upload_check_statuses(text, text[]) to service_role;

revoke all on function public.claim_client_upload_checks(integer, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_client_upload_check(text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_client_upload_checks(integer, text, text, text) to service_role;
grant execute on function public.finish_client_upload_check(text, text, text, text) to service_role;

-- 3b. A child-card photo is confirmed only once the server has cleared it ---------------------------------------------------
-- Redefined from the live body (pg_get_functiondef, 2026-11-05) with one added gate: before, the confirm step only checked
-- that the object existed, so a client that skipped the check could mark an unchecked photo 'uploaded' for the care team.
-- A photo still waiting for its check answers 55000 ("not yet"), which the phone's outbox already treats as retry-later.

create or replace function public.confirm_child_card_photo_uploaded(p_child uuid, p_client_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); v_path text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select storage_path into v_path from public.child_card_photos where patient_id = p_child and client_id = p_client_id and uploaded_by = v_uid;
  if v_path is null then raise exception 'no such photo record' using errcode = 'P0002'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'child-card-photos' and o.name = v_path) then
    raise exception 'the file has not been uploaded yet' using errcode = '55000';
  end if;
  if exists (
    select 1 from private.client_upload_checks k
    where k.bucket_id = 'child-card-photos' and k.object_name = v_path and k.status not in ('clean', 'cleaned')
  ) then
    raise exception 'the photo has not been checked yet' using errcode = '55000';
  end if;
  update public.child_card_photos set file_state = 'uploaded' where patient_id = p_child and client_id = p_client_id and file_state <> 'uploaded';
  return true;
end $function$;

-- 4. Quarantine bucket (private, no policies: service role only) ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('upload-quarantine', 'upload-quarantine', false, 16777216, null)
on conflict (id) do update set public = false;

-- 5. Every two minutes, when something is waiting and the app's address and cron secret are in Vault -------------------------
-- The founder adds two Vault secrets: app_base_url (https://app.tarragonhealth.ng) and cron_secret (the same value as the
-- app's CRON_SECRET). Until then this does nothing, and the client's own check plus the daily Vercel cron cover it.

create or replace function private.kick_client_upload_checks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if v_base is null or v_secret is null then
    return;
  end if;
  if not exists (
    select 1 from private.client_upload_checks k
    where k.status = 'pending'
       or (k.status in ('checking', 'error')
            and k.claimed_at < now() - case when k.attempts < 5 then interval '10 minutes' else interval '1 hour' end)
  ) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_base, '/') || '/api/cron/verify-client-uploads',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.kick_client_upload_checks() from public, anon, authenticated;

select cron.schedule('verify-client-uploads', '*/2 * * * *', $$select private.kick_client_upload_checks()$$);

-- 5b. Register the Vercel backstop cron in the owner registry (the vercel.json drift test reads this file) -----------------------

insert into public.automations (name, kind, schedule, source_ref) values
  ('vercel:verify-client-uploads', 'vercel_cron', '40 4 * * *', '/api/cron/verify-client-uploads')
on conflict (name) do nothing;
insert into public.automation_jobs (job_name, schedule, source)
values ('/api/cron/verify-client-uploads', '40 4 * * *', 'vercel') on conflict (job_name) do nothing;

-- 6. Profile photos: server-only writes ---------------------------------------------------------------------------------------

drop policy if exists "patient avatar own insert" on storage.objects;
drop policy if exists "patient avatar own update" on storage.objects;
drop policy if exists "patient avatar own delete" on storage.objects;
drop policy if exists "patient avatar own select" on storage.objects;

-- 7. Self-check --------------------------------------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'queue_client_upload_check' and tgrelid = 'storage.objects'::regclass) then
    raise exception 'client_upload_checks: trigger missing';
  end if;
  if has_function_privilege('anon', 'public.claim_client_upload_checks(integer, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_client_upload_checks(integer, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finish_client_upload_check(text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.client_upload_check_statuses(text, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.client_upload_check_outcome(text, text, text)', 'EXECUTE') then
    raise exception 'client_upload_checks: claim/finish must be server-only';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') like '%patient-avatars%'
  ) then
    raise exception 'client_upload_checks: patient-avatars must be server-only (no storage policies)';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') like '%upload-quarantine%'
  ) then
    raise exception 'client_upload_checks: upload-quarantine must have no policies';
  end if;
end $$;
