-- Proof: files a signed-in user writes straight to Storage are queued for the server check, and patients can no longer write
-- to the public patient-avatars bucket (migration 20261105120005_client_upload_checks.sql, security audit 2026-11-05 M-4/L-4).
--
--   1. An object a user wrote (owner_id set) in each of the nine covered buckets is queued 'pending'.
--   2. A service-role write (owner_id null) is not queued, nor is a user write in a bucket outside the list.
--   3. Replacing a file (new version) puts its row back to 'pending'; a metadata-only update does not; a move queues the new name.
--   4. Claim and finish are server-only: a signed-in user is refused; the service role claims, the owner filter holds, and a
--      finish after the file was replaced mid-check is dropped (so the new file is checked).
--   5. A row that keeps failing is retried hourly after five tries, never dropped. The outcome lookup returns the status.
--   6. A patient can neither insert nor update in patient-avatars, even in their own folder.
--   7. SABOTAGE: without the trigger an upload is not queued; with the old own-folder insert policy put back the patient can
--      write to the public bucket again. Both show the checks above discriminate.
-- Everything runs in one transaction and is rolled back.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to public;
insert into ids values ('a', gen_random_uuid()), ('b', gen_random_uuid());

create or replace function pg_temp.uid(p text) returns text language sql as $$ select v::text from ids where k = p $$;
grant execute on function pg_temp.uid(text) to public;

create or replace function pg_temp.status_of(p_bucket text, p_name text) returns text language sql security definer as $$
  select coalesce((select status from private.client_upload_checks where bucket_id = p_bucket and object_name = p_name), 'none')
$$;

-- 1. One user-written object per covered bucket.
insert into storage.objects (bucket_id, name, owner_id, version, metadata)
select b, pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('a'), 'v1', '{"mimetype": "image/jpeg"}'::jsonb
from unnest(array['vaccination-certificates', 'meal-photos', 'patient-documents', 'care-message-attachments',
                  'second-opinion-documents', 'child-card-photos', 'async-consult-attachments', 'clinical-staff-photos',
                  'patient-avatars']) b;
insert into results
select 'user upload queued in ' || b, 'pending', pg_temp.status_of(b, pg_temp.uid('a') || '/probe.jpg')
from unnest(array['vaccination-certificates', 'meal-photos', 'patient-documents', 'care-message-attachments',
                  'second-opinion-documents', 'child-card-photos', 'async-consult-attachments', 'clinical-staff-photos',
                  'patient-avatars']) b;

-- 2. Not queued: a service-role write, and a bucket outside the list.
insert into storage.objects (bucket_id, name, owner_id, version) values
  ('patient-documents', pg_temp.uid('a') || '/server.pdf', null, 'v1'),
  ('lab-result-documents', pg_temp.uid('a') || '/elsewhere.pdf', pg_temp.uid('a'), 'v1');
insert into results values
  ('service-role write not queued', 'none', pg_temp.status_of('patient-documents', pg_temp.uid('a') || '/server.pdf')),
  ('bucket outside the list not queued', 'none', pg_temp.status_of('lab-result-documents', pg_temp.uid('a') || '/elsewhere.pdf'));

-- 3. Replace, metadata-only update, move.
update private.client_upload_checks set status = 'clean' where bucket_id in ('meal-photos', 'patient-documents', 'vaccination-certificates');
update storage.objects set version = 'v2' where bucket_id = 'meal-photos' and name = pg_temp.uid('a') || '/probe.jpg';
update storage.objects set metadata = '{"mimetype": "image/png"}'::jsonb where bucket_id = 'patient-documents' and name = pg_temp.uid('a') || '/probe.jpg';
update storage.objects set name = pg_temp.uid('a') || '/moved.jpg' where bucket_id = 'vaccination-certificates' and name = pg_temp.uid('a') || '/probe.jpg';
insert into results values
  ('replaced file re-queued', 'pending', pg_temp.status_of('meal-photos', pg_temp.uid('a') || '/probe.jpg')),
  ('metadata-only update not re-queued', 'clean', pg_temp.status_of('patient-documents', pg_temp.uid('a') || '/probe.jpg')),
  ('moved file queued under its new name', 'pending', pg_temp.status_of('vaccination-certificates', pg_temp.uid('a') || '/moved.jpg'));

-- 4. Claim and finish.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.claim_client_upload_checks(10);
  insert into results values ('signed-in user cannot claim', 'refused', 'allowed');
exception when insufficient_privilege then
  insert into results values ('signed-in user cannot claim', 'refused', 'refused');
end $$;
do $$
begin
  perform public.finish_client_upload_check('meal-photos', 'x', 'clean');
  insert into results values ('signed-in user cannot finish', 'refused', 'allowed');
exception when insufficient_privilege then
  insert into results values ('signed-in user cannot finish', 'refused', 'refused');
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
insert into results values
  ('owner filter: another user''s object is not claimed', '0',
   (select count(*)::text from public.claim_client_upload_checks(1, 'meal-photos', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('b')))),
  ('owner filter: the writer''s object is claimed with its type', 'image/jpeg',
   (select string_agg(mimetype, ',') from public.claim_client_upload_checks(1, 'meal-photos', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('a'))));
insert into results values
  ('claimed row is checking', 'checking', pg_temp.status_of('meal-photos', pg_temp.uid('a') || '/probe.jpg'));
insert into results values
  ('finish records the outcome', 'true', public.finish_client_upload_check('meal-photos', pg_temp.uid('a') || '/probe.jpg', 'cleaned', 'photo metadata removed')::text),
  ('finished row status', 'cleaned', pg_temp.status_of('meal-photos', pg_temp.uid('a') || '/probe.jpg'));

-- Replaced while being checked: the stale result is dropped.
select count(*) from public.claim_client_upload_checks(1, 'child-card-photos', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('a'));
update storage.objects set version = 'v2' where bucket_id = 'child-card-photos' and name = pg_temp.uid('a') || '/probe.jpg';
insert into results values
  ('finish after a mid-check replace is dropped', 'false', public.finish_client_upload_check('child-card-photos', pg_temp.uid('a') || '/probe.jpg', 'clean')::text),
  ('replaced file stays pending', 'pending', pg_temp.status_of('child-card-photos', pg_temp.uid('a') || '/probe.jpg'));

-- A row that keeps failing is never given up on: after five tries it is retried hourly, not left unchecked for good.
update private.client_upload_checks set status = 'error', attempts = 5, claimed_at = now() - interval '30 minutes'
where bucket_id = 'second-opinion-documents';
update private.client_upload_checks set status = 'error', attempts = 7, claimed_at = now() - interval '2 hours'
where bucket_id = 'async-consult-attachments';
insert into results values
  ('a row past five tries waits an hour', '0',
   (select count(*)::text from public.claim_client_upload_checks(1, 'second-opinion-documents', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('a')))),
  ('a row past five tries is retried after an hour', '1',
   (select count(*)::text from public.claim_client_upload_checks(1, 'async-consult-attachments', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('a'))));

-- 5. Outcome lookup.
insert into results values
  ('outcome lookup', 'cleaned', public.client_upload_check_outcome('meal-photos', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('a'))),
  ('outcome lookup is owner-scoped', 'none', coalesce(public.client_upload_check_outcome('meal-photos', pg_temp.uid('a') || '/probe.jpg', pg_temp.uid('b')), 'none'));

-- 6. Patient writes to the public avatar bucket.
create or replace function pg_temp.try_avatar(p_name text) returns text language plpgsql as $f$
declare v_up int;
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id, version) values ('patient-avatars', p_name, pg_temp.uid('a'), 'v1');
    return 'inserted';
  exception when insufficient_privilege then
    null;
  end;
  update storage.objects set version = 'tampered' where bucket_id = 'patient-avatars' and name = pg_temp.uid('a') || '/probe.jpg';
  get diagnostics v_up = row_count;
  return 'refused/' || v_up;
end $f$;
grant execute on function pg_temp.try_avatar(text) to public;

select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('a'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results values ('patient cannot insert or update in patient-avatars', 'refused/0', pg_temp.try_avatar(pg_temp.uid('a') || '/new.jpg'));
reset role;

-- 7. Sabotage.
drop trigger queue_client_upload_check on storage.objects;
insert into storage.objects (bucket_id, name, owner_id, version) values ('meal-photos', pg_temp.uid('a') || '/unwatched.jpg', pg_temp.uid('a'), 'v1');
insert into results values ('SABOTAGE: without the trigger an upload is not queued', 'none', pg_temp.status_of('meal-photos', pg_temp.uid('a') || '/unwatched.jpg'));

create policy "patient avatar own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
set local role authenticated;
insert into results values ('SABOTAGE: with the old policy back the patient can write to the public bucket', 'inserted', pg_temp.try_avatar(pg_temp.uid('a') || '/new.jpg'));
reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as outcome from results;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', '; ') into v_fail
  from results where expected is distinct from actual;
  if v_fail is not null then
    raise exception 'client_upload_checks FAILED: %', v_fail;
  end if;
  if (select count(*) from results) <> 30 then
    raise exception 'client_upload_checks: expected 30 checks, got %', (select count(*) from results);
  end if;
end $$;

rollback;
