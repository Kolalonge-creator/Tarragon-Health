-- Tarragon Health: a patient can no longer delete (or overwrite) the original file of a filed clinical report, and a test-account
-- purge now removes the account's stored files instead of leaving them behind.
--
-- Security findings S4 and S5 (2026-11-05).
--
-- S4. 20261105101213 (security audit H-2) narrowed the patient UPDATE/DELETE policies on lab-result-documents, ecg-reports and
-- imaging-reports to files the patient uploaded themselves (owner_id = caller), but a patient's OWN upload is exactly the original of
-- a filed report: once lab_result_documents / ecg_report_documents / imaging_report_documents (or clinical_documents) point at it, a
-- doctor reviews it and results are read out of it. The patient could still call the Storage API directly and delete that file (the
-- row survives, pointing at nothing) or overwrite it with something else.
--   * The three patient DELETE policies are dropped outright. The app never deletes a filed upload on a patient's behalf; the only
--     patient-session deletes were clean-ups of an object the same request had just uploaded when the database insert failed. Those
--     now go through public.discard_unfiled_clinical_upload (below) and a service-role remove, from server code only
--     (apps/web/src/lib/uploads/discard-unfiled-upload.ts).
--   * The three patient UPDATE policies additionally refuse a path any record already points at (private.storage_path_in_record,
--     the same check the INSERT policies already make), so a filed original cannot be overwritten either. Nothing in the app
--     updates these objects (every upload is upsert: false, and "replace my file" uploads a NEW object).
--   * specialist-referral-outcome-documents is untouched (not part of this finding; its outcome path lives on specialist_referrals).
--
-- S5. public.purge_test_account (S39d; nightly since 20261103023236) deletes the account's rows but never its files. Five clinical
-- files from the September purge were left in storage with no row (listed in the PR, not deleted here). A storage object must be
-- removed through the Storage API, never by deleting a storage.objects row (storage.protect_delete refuses that, and it would leave
-- the bytes on hosted storage), so the purge now QUEUES the purged account's files into private.storage_deletion_queue, inside the
-- purge's own transaction. A daily Vercel cron (/api/cron/storage-deletion-sweep) reads public.storage_deletions_due(), removes each
-- file with the service role, and marks it with public.mark_storage_deletion_done(); a failure keeps the row due and is retried.
--
-- WHAT IS QUEUED, deliberately narrow: only objects whose FIRST folder is the purged account's id, and only in an allow-list of
-- buckets (private.purge_subject_buckets()) whose path layout is '<subject profile id>/...' where the subject's own rows go with the
-- account. Checked in code, 2026-11-05:
--   lab-result-documents  '<patient>/...'  patient uploads use the caller's own id and file it for themselves (patient_id = caller);
--                                            care-team / lab writes use the patient id (lib/lab-results/*, store-file.ts, classify-run.ts)
--   ecg-reports           '<patient>/...'  same (ecg-reports/actions.ts, api/mobile/ecg-report-upload)
--   imaging-reports       '<patient>/...'  same (imaging-reports/document-actions.ts)
--   skin-photos           '<subject>/...'  path is the photo's subject, even when a guardian takes it (skin-photo-actions.ts, S59)
-- NOT queued, on purpose: anything the account uploaded under someone else's folder, and every bucket whose first folder is the
-- UPLOADER rather than the subject (child-card-photos '<uploader>/<child>/...', vaccination certificates '<uploader>/<record>-...',
-- patient-documents, referral outcomes uploaded by a patient session) or an organisation (staff-signatures '<organisation>/...').
-- Purging a test caregiver or a test admin must never remove a real child's photo or a real doctor's signature, so files outside the
-- allow-list are LEFT IN PLACE: a leftover test file is harmless, a deleted real one is not. storage_deletions_due applies the same
-- allow-list again (defence in depth) and never offers a path a record points at.
--
-- purge_test_account is redefined from its LIVE body (pg_get_functiondef, 2026-11-05); the only change is the queue call and the
-- count in the audit event and result.
-- Proof: packages/db/tests/clinical_file_delete_lock_and_purge_storage_queue.sql

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S4: no patient DELETE; patient UPDATE only on an object no record points at.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  b record;
begin
  for b in
    select * from (values
      ('lab-result-documents', 'lab result doc patient'),
      ('ecg-reports',          'ecg report doc patient'),
      ('imaging-reports',      'imaging report doc patient')
    ) v(bucket, prefix)
  loop
    execute format('drop policy if exists %I on storage.objects', b.prefix || ' delete');
    execute format('drop policy if exists %I on storage.objects', b.prefix || ' update');
    execute format($p$
      create policy %I on storage.objects
        for update to authenticated
        using (
          bucket_id = %L
          and (storage.foldername(name))[1] = (select auth.uid())::text
          and owner_id = (select auth.uid())::text
          and not private.storage_path_in_record(bucket_id, name)
        )
        with check (
          bucket_id = %L
          and (storage.foldername(name))[1] = (select auth.uid())::text
          and owner_id = (select auth.uid())::text
          and not private.storage_path_in_record(bucket_id, name)
        )$p$, b.prefix || ' update', b.bucket, b.bucket);
  end loop;
end $$;

-- Older imaging names, in case any environment still carries them.
drop policy if exists "imaging report patient update" on storage.objects;
drop policy if exists "imaging report patient delete" on storage.objects;

-- The server-side clean-up of an upload whose record was never written. Service role only: the server calls it with the patient id it
-- authenticated, then removes the object with the service role only when this returns true. It refuses (false) a bucket outside the
-- three, a path outside the patient's folder, an object the patient did not upload themselves, and any path a record points at. Every
-- allowed discard is written to the audit log.
create or replace function public.discard_unfiled_clinical_upload(p_bucket text, p_name text, p_patient uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
begin
  if p_bucket is null or p_name is null or p_patient is null then return false; end if;
  if p_bucket not in ('lab-result-documents', 'ecg-reports', 'imaging-reports') then return false; end if;
  if (storage.foldername(p_name))[1] is distinct from p_patient::text then return false; end if;

  select o.owner_id into v_owner from storage.objects o where o.bucket_id = p_bucket and o.name = p_name;
  if not found then return false; end if;                       -- nothing to remove
  if v_owner is distinct from p_patient::text then return false; end if;   -- a care-team or lab file is never discarded this way
  if private.storage_path_in_record(p_bucket, p_name) then return false; end if;   -- filed: the original stays

  -- Written directly (not private.log_audit): under the service role auth.uid() and current_org_id() are null, so the row would carry
  -- no actor and no organisation. The actor is the patient whose request uploaded the file; the organisation is theirs.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select p.organisation_id, p_patient, 'clinical_upload_discarded', 'profile', p_patient,
         jsonb_build_object('bucket', p_bucket, 'path', p_name, 'reason', 'record_not_written')
  from public.profiles p where p.id = p_patient;
  return true;
end $$;
revoke all on function public.discard_unfiled_clinical_upload(text, text, uuid) from public, anon, authenticated;
grant execute on function public.discard_unfiled_clinical_upload(text, text, uuid) to service_role;
comment on function public.discard_unfiled_clinical_upload(text, text, uuid) is
  'S4: true (and audited) only when bucket/path is the patient''s own upload in lab-result-documents, ecg-reports or imaging-reports that no record points at; the caller then removes it with the service role. Service role only.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S5: the storage deletion queue and the purge that fills it.
-- ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists private.storage_deletion_queue (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text not null,
  name        text not null,
  reason      text not null,
  source_id   uuid,
  queued_at   timestamptz not null default now(),
  attempts    integer not null default 0,
  last_error  text,
  done_at     timestamptz,
  unique (bucket_id, name)
);
revoke all on private.storage_deletion_queue from public, anon, authenticated;
comment on table private.storage_deletion_queue is
  'S5: stored files to remove through the Storage API (never by deleting storage.objects rows). Filled by public.purge_test_account; drained daily by /api/cron/storage-deletion-sweep via storage_deletions_due / mark_storage_deletion_done.';

-- The buckets a purge may empty: path layout '<subject profile id>/...' (see the header for how each was checked).
create or replace function private.purge_subject_buckets()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['lab-result-documents', 'ecg-reports', 'imaging-reports', 'skin-photos']::text[] $$;
revoke all on function private.purge_subject_buckets() from public, anon, authenticated;

-- Only objects in the account's own folder, only in the allow-listed buckets. Never by owner_id: an admin's upload of a real doctor's
-- signature ('<organisation>/<uuid>.png') or a caregiver's photo of a real child ('<caregiver>/<child>/...') must survive the purge.
create or replace function private.queue_storage_deletions_for_profile(p_profile uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into private.storage_deletion_queue (bucket_id, name, reason, source_id)
  select o.bucket_id, o.name, p_reason, p_profile
  from storage.objects o
  where o.bucket_id = any (private.purge_subject_buckets())
    and (storage.foldername(o.name))[1] = p_profile::text
  on conflict (bucket_id, name) do update
    set done_at = null, last_error = null, reason = excluded.reason, source_id = excluded.source_id, queued_at = now()
    where private.storage_deletion_queue.done_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.queue_storage_deletions_for_profile(uuid, text) from public, anon, authenticated;

create or replace function public.storage_deletions_due(p_limit integer default 200)
returns table (id uuid, bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.bucket_id, q.name
  from private.storage_deletion_queue q
  where q.done_at is null
    and q.bucket_id = any (private.purge_subject_buckets())
    and not private.storage_path_in_record(q.bucket_id, q.name)
  order by q.attempts, q.queued_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;
revoke all on function public.storage_deletions_due(integer) from public, anon, authenticated;
grant execute on function public.storage_deletions_due(integer) to service_role;

create or replace function public.mark_storage_deletion_done(p_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error is null then
    update private.storage_deletion_queue set done_at = now(), attempts = attempts + 1, last_error = null where id = p_id;
  else
    update private.storage_deletion_queue set attempts = attempts + 1, last_error = left(p_error, 500) where id = p_id;
  end if;
end $$;
revoke all on function public.mark_storage_deletion_done(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_storage_deletion_done(uuid, text) to service_role;

-- purge_test_account, from its live body; queues the account's files before the auth user goes.
create or replace function public.purge_test_account(p_profile uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_is_test boolean; v_staff uuid[]; v_org uuid; tg record; v_files integer;
begin
  if not (private.is_admin() or (select auth.role()) = 'service_role' or ((select auth.role()) is null and session_user in ('postgres', 'supabase_admin'))) then raise exception 'only an admin or the service role can purge a test account' using errcode = '42501'; end if;
  if p_profile = (select auth.uid()) then raise exception 'you cannot purge your own account' using errcode = '42501'; end if;
  select is_test, organisation_id into v_is_test, v_org from public.profiles where id = p_profile;
  if not found then raise exception 'no such account' using errcode = 'P0002'; end if;
  if v_is_test is distinct from true then raise exception 'not a test account: real accounts are never deleted' using errcode = '42501'; end if;

  create temp table if not exists purge_seen (rel oid not null, id uuid not null) on commit drop;
  create temp table if not exists purge_touched (rel oid primary key) on commit drop;
  create temp table if not exists purge_disabled (rel regclass not null, trig name not null) on commit drop;
  truncate pg_temp.purge_seen, pg_temp.purge_touched, pg_temp.purge_disabled;
  select coalesce(array_agg(id), '{}') into v_staff from public.clinical_staff where profile_id = p_profile;

  -- pass 1: learn which tables will be touched, change nothing
  perform private.purge_refs('public.clinical_staff'::regclass, v_staff, false);
  perform private.purge_refs('public.profiles'::regclass, array[p_profile], false);
  insert into pg_temp.purge_touched (rel) values ('public.profiles'::regclass::oid), ('public.clinical_staff'::regclass::oid), ('public.staff_record_opens'::regclass::oid) on conflict do nothing;
  for tg in select t.tgrelid::regclass as rel, t.tgname from pg_trigger t join pg_temp.purge_touched pt on pt.rel = t.tgrelid where not t.tgisinternal and t.tgenabled = 'O' loop
    execute format('alter table %s disable trigger %I', tg.rel, tg.tgname);
    insert into pg_temp.purge_disabled values (tg.rel, tg.tgname);
  end loop;

  -- pass 2: change them (a foreign key that still points at a real patient's row stops the whole call)
  begin
  truncate pg_temp.purge_seen;
  perform private.purge_refs('public.clinical_staff'::regclass, v_staff, true);
  delete from public.clinical_staff where profile_id = p_profile;
  perform private.purge_refs('public.profiles'::regclass, array[p_profile], true);
  -- only the log of a test PATIENT being opened goes with it; the log of who a test clinician opened is kept
  delete from public.staff_record_opens where patient_id = p_profile;
  delete from public.profiles where id = p_profile;
  exception when foreign_key_violation then
    raise exception 'cannot purge: real patient records still reference this test account (%)', sqlerrm using errcode = '23503';
  end;

  for tg in select rel, trig from pg_temp.purge_disabled loop
    execute format('alter table %s enable trigger %I', tg.rel, tg.trig);
  end loop;

  -- S5: the rows are gone; queue the account's stored files for the Storage API sweep (same transaction, so a failed purge queues nothing)
  v_files := private.queue_storage_deletions_for_profile(p_profile, 'test_account_purge');

  delete from auth.users where id = p_profile;
  perform private.log_audit('test_account_purge', 'profile', p_profile, jsonb_build_object('organisation_id', v_org, 'files_queued', v_files));
  return jsonb_build_object('purged', true, 'profile', p_profile, 'files_queued', v_files);
end $function$;

-- Register the sweep in the owner registry (S80b), next to the other Vercel crons.
insert into public.automations (name, kind, schedule, source_ref) values
  ('vercel:storage-deletion-sweep', 'vercel_cron', '45 4 * * *', '/api/cron/storage-deletion-sweep')
on conflict (name) do nothing;

-- Self-checks.
do $$
declare
  v_bad text;
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('DELETE', 'ALL')
             and roles @> array['authenticated']::name[]
             and coalesce(qual, '') ~ '(lab-result-documents|ecg-reports|imaging-reports)') then
    raise exception 'S4: a patient DELETE policy remains on a clinical report bucket';
  end if;

  select string_agg(policyname, ', ') into v_bad from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE'
    and coalesce(qual, '') ~ '(lab-result-documents|ecg-reports|imaging-reports)'
    and (coalesce(qual, '') !~ 'storage_path_in_record' or coalesce(with_check, '') !~ 'storage_path_in_record' or coalesce(qual, '') !~ 'owner_id');
  if v_bad is not null then raise exception 'S4: UPDATE policies without the filed-record check: %', v_bad; end if;

  if pg_get_functiondef('private.queue_storage_deletions_for_profile(uuid, text)'::regprocedure) ~ 'owner_id' then
    raise exception 'S5: the purge queue must never select by owner_id';
  end if;

  if pg_get_functiondef('public.purge_test_account(uuid)'::regprocedure) !~ 'queue_storage_deletions_for_profile' then
    raise exception 'S5: purge_test_account does not queue the account''s files';
  end if;

  if has_function_privilege('authenticated', 'public.discard_unfiled_clinical_upload(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.discard_unfiled_clinical_upload(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.storage_deletions_due(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.storage_deletions_due(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.mark_storage_deletion_done(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_storage_deletion_done(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_storage_deletions_for_profile(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.purge_subject_buckets()', 'EXECUTE') then
    raise exception 'S4/S5: a new function is executable by a signed-in or anonymous caller';
  end if;
end $$;
