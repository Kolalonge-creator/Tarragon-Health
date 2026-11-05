-- Proof: S4 a patient can no longer delete (or overwrite) the original file of a filed clinical report; S5 a test-account purge queues the
-- account's stored files for the Storage API sweep (migration *_clinical_file_delete_lock_and_purge_storage_queue.sql, 2026-11-05).
--
-- One rolled-back transaction.
--   A. In lab-result-documents, ecg-reports and imaging-reports, patient A uploaded two files: one a report row points at (filed) and one
--      no row points at (unfiled). A can neither update nor delete the filed one; A can update but never delete the unfiled one. The
--      referral-outcome bucket (out of scope) still lets A delete A's own upload, so the harness can see a delete succeed.
--   B. discard_unfiled_clinical_upload: service role only; true (and audited) for A's own unfiled upload; false for a filed file, a
--      care-team file, another patient's id, and a bucket outside the three.
--   C. purge_test_account queues every object in the test account's folder and every object it uploaded outside a real person's folder,
--      never a file it uploaded into a real patient's folder; storage_deletions_due lists them for the service role only; done rows leave
--      the list, failed rows stay with the error; a queued path a record points at is never offered.
--   SABOTAGE: (1) the old owner-only DELETE policy put back lets A delete the filed lab report; (2) purge_test_account without the queue
--   call queues nothing. Both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

-- storage.protect_delete refuses a direct DELETE on storage.objects unless this is set (the Storage API sets it).
select set_config('storage.allow_delete_query', 'true', true);

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's4s5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S4S5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

-- As the patient: try to update, then delete, bucket/name. Returns 'updated/deleted' row counts.
create function pg_temp.try_change(p_bucket text, p_name text) returns text language plpgsql as
$f$ declare v_up int; v_del int;
begin
  update storage.objects set metadata = '{"tampered": true}'::jsonb where bucket_id = p_bucket and name = p_name;
  get diagnostics v_up = row_count;
  delete from storage.objects where bucket_id = p_bucket and name = p_name;
  get diagnostics v_del = row_count;
  return v_up || '/' || v_del;
end $f$;
grant execute on function pg_temp.try_change(text, text) to public;

create function pg_temp.p(p_who text, p_name text) returns text language sql as $$ select pg_temp.f(p_who)::text || '/' || p_name $$;
grant execute on function pg_temp.p(text, text) to public;
grant execute on function pg_temp.f(text) to public;

do $$
declare v_org uuid; v_a uuid; v_b uuid; v_real uuid; v_t uuid; v_t2 uuid; v_ad uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'patient a', 'patient', false);
  v_b := pg_temp.mkuser(v_org, 'patient b', 'patient', false);
  v_real := pg_temp.mkuser(v_org, 'real patient', 'patient', false);
  v_t := pg_temp.mkuser(v_org, 'test patient', 'patient', true);
  v_t2 := pg_temp.mkuser(v_org, 'test patient 2', 'patient', true);
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b); perform pg_temp.setf('real', v_real);
  perform pg_temp.setf('t', v_t); perform pg_temp.setf('t2', v_t2); perform pg_temp.setf('ad', v_ad);

  -- A's files: filed + unfiled in each clinical bucket (owner A), a care-team file (owner null), and an own upload in the referral bucket.
  insert into storage.objects (bucket_id, name, owner_id)
  select b, v_a::text || '/' || k || '.pdf', case when k = 'staff' then null else v_a::text end
  from unnest(array['lab-result-documents', 'ecg-reports', 'imaging-reports']) b cross join unnest(array['filed', 'unfiled', 'staff']) k;
  insert into storage.objects (bucket_id, name, owner_id) values ('specialist-referral-outcome-documents', v_a::text || '/own.pdf', v_a::text);
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, source)
    values (v_org, v_a, v_a::text || '/filed.pdf', 'filed.pdf', 'application/pdf', 'patient');
  insert into public.ecg_report_documents (organisation_id, patient_id, file_path, source) values (v_org, v_a, v_a::text || '/filed.pdf', 'patient');
  insert into public.imaging_report_documents (organisation_id, patient_id, file_path, source) values (v_org, v_a, v_a::text || '/filed.pdf', 'patient');

  -- The test account's files: two in its own folder, one it uploaded into a REAL patient's folder, one outside any profile folder.
  insert into storage.objects (bucket_id, name, owner_id) values
    ('lab-result-documents', v_t::text || '/t1.pdf', v_t::text),
    ('ecg-reports', v_t::text || '/t2.png', null),
    ('imaging-reports', v_real::text || '/by-test.jpg', v_t::text),
    ('ecg-reports', 's4s5-misc/' || v_t::text || '.png', v_t::text),
    ('lab-result-documents', v_t2::text || '/x.pdf', v_t2::text);
end $$;

-- A. patient policies -----------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A1 A cannot update or delete the filed original in ' || b, '0/0',
  pg_temp.as_user(pg_temp.f('a'), format('select pg_temp.try_change(%L, %L)', b, pg_temp.p('a', 'filed.pdf'))))
from unnest(array['lab-result-documents', 'ecg-reports', 'imaging-reports']) b;
select pg_temp.ck('real', 'A2 A can update but not delete an unfiled own upload in ' || b, '1/0',
  pg_temp.as_user(pg_temp.f('a'), format('select pg_temp.try_change(%L, %L)', b, pg_temp.p('a', 'unfiled.pdf'))))
from unnest(array['lab-result-documents', 'ecg-reports', 'imaging-reports']) b;
select pg_temp.ck('real', 'A3 A still cannot touch the care team''s file in ' || b, '0/0',
  pg_temp.as_user(pg_temp.f('a'), format('select pg_temp.try_change(%L, %L)', b, pg_temp.p('a', 'staff.pdf'))))
from unnest(array['lab-result-documents', 'ecg-reports', 'imaging-reports']) b;
select pg_temp.ck('real', 'A4 control: the referral-outcome bucket still lets A delete A''s own upload', '1/1',
  pg_temp.as_user(pg_temp.f('a'), format('select pg_temp.try_change(%L, %L)', 'specialist-referral-outcome-documents', pg_temp.p('a', 'own.pdf'))));
select pg_temp.ck('real', 'A5 the filed files are all still there', '3',
  (select count(*)::text from storage.objects where name = pg_temp.p('a', 'filed.pdf')));

-- B. the server-side discard ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'B1 a signed-in patient cannot call the discard check', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('a'), format('select public.discard_unfiled_clinical_upload(%L, %L, %L)::text', 'lab-result-documents', pg_temp.p('a', 'unfiled.pdf'), pg_temp.f('a'))));
select pg_temp.ck('real', 'B2 service role: A''s own unfiled upload may be discarded', 'true',
  pg_temp.as_service(format('select public.discard_unfiled_clinical_upload(%L, %L, %L)::text', 'lab-result-documents', pg_temp.p('a', 'unfiled.pdf'), pg_temp.f('a'))));
select pg_temp.ck('real', 'B3 the discard is audited', '1',
  (select count(*)::text from public.audit_log where action = 'clinical_upload_discarded' and entity_id = pg_temp.f('a') and event ->> 'path' = pg_temp.p('a', 'unfiled.pdf')));
select pg_temp.ck('real', 'B4 a filed original is never discarded (' || b || ')', 'false',
  pg_temp.as_service(format('select public.discard_unfiled_clinical_upload(%L, %L, %L)::text', b, pg_temp.p('a', 'filed.pdf'), pg_temp.f('a'))))
from unnest(array['lab-result-documents', 'ecg-reports', 'imaging-reports']) b;
select pg_temp.ck('real', 'B5 a care-team file is never discarded', 'false',
  pg_temp.as_service(format('select public.discard_unfiled_clinical_upload(%L, %L, %L)::text', 'lab-result-documents', pg_temp.p('a', 'staff.pdf'), pg_temp.f('a'))));
select pg_temp.ck('real', 'B6 another patient''s id cannot discard A''s upload', 'false',
  pg_temp.as_service(format('select public.discard_unfiled_clinical_upload(%L, %L, %L)::text', 'lab-result-documents', pg_temp.p('a', 'unfiled.pdf'), pg_temp.f('b'))));
select pg_temp.ck('real', 'B7 a bucket outside the three is refused', 'false',
  pg_temp.as_service(format('select public.discard_unfiled_clinical_upload(%L, %L, %L)::text', 'specialist-referral-outcome-documents', pg_temp.p('a', 'own.pdf'), pg_temp.f('a'))));

-- C. purge queues the files -------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'C1 an admin purges the test patient and 3 files are queued', '3',
  pg_temp.as_user(pg_temp.f('ad'), format('select (public.purge_test_account(%L)) ->> ''files_queued''', pg_temp.f('t'))));
select pg_temp.ck('real', 'C2 the queue holds the own-folder files and the outside-any-folder file', 'true',
  (select (count(*) filter (where name in (pg_temp.p('t', 't1.pdf'), pg_temp.p('t', 't2.png'), 's4s5-misc/' || pg_temp.f('t')::text || '.png')) = 3)::text
   from private.storage_deletion_queue where source_id = pg_temp.f('t')));
select pg_temp.ck('real', 'C3 a file the test account put in a REAL patient''s folder is never queued', '0',
  (select count(*)::text from private.storage_deletion_queue where name = pg_temp.p('real', 'by-test.jpg')));
select pg_temp.ck('real', 'C4 the purge audit event carries the count', '3',
  (select event ->> 'files_queued' from public.audit_log where action = 'test_account_purge' and entity_id = pg_temp.f('t') order by created_at desc limit 1));
select pg_temp.ck('real', 'C5 a signed-in caller cannot list the due files', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('a'), 'select count(*)::text from public.storage_deletions_due()'));
select pg_temp.ck('real', 'C6 the service role lists the 3 due files', '3',
  pg_temp.as_service(format('select count(*)::text from public.storage_deletions_due() where name in (%L, %L, %L)',
    pg_temp.p('t', 't1.pdf'), pg_temp.p('t', 't2.png'), 's4s5-misc/' || pg_temp.f('t')::text || '.png')));
-- the sweep marks one done and one failed
do $$
declare v_done uuid; v_fail uuid;
begin
  select id into v_done from private.storage_deletion_queue where name = pg_temp.p('t', 't1.pdf');
  select id into v_fail from private.storage_deletion_queue where name = pg_temp.p('t', 't2.png');
  perform pg_temp.setf('qdone', v_done); perform pg_temp.setf('qfail', v_fail);
  perform pg_temp.as_service(format('select public.mark_storage_deletion_done(%L)::text', v_done));
  perform pg_temp.as_service(format('select public.mark_storage_deletion_done(%L, %L)::text', v_fail, 'storage said no'));
end $$;
select pg_temp.ck('real', 'C7 a removed file leaves the due list, a failed one stays with its error', 'false|true|storage said no|1',
  (select (exists (select 1 from public.storage_deletions_due() where id = pg_temp.f('qdone')))::text || '|'
       || (exists (select 1 from public.storage_deletions_due() where id = pg_temp.f('qfail')))::text || '|'
       || (select last_error || '|' || attempts from private.storage_deletion_queue where id = pg_temp.f('qfail'))));
select pg_temp.ck('real', 'C8 a signed-in caller cannot mark a deletion done', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('a'), format('select public.mark_storage_deletion_done(%L)::text', pg_temp.f('qfail'))));
insert into private.storage_deletion_queue (bucket_id, name, reason) values ('lab-result-documents', pg_temp.p('a', 'filed.pdf'), 's4s5 fixture');
select pg_temp.ck('real', 'C9 a queued path that a record points at is never offered for removal', 'false',
  (select exists (select 1 from public.storage_deletions_due(1000) where name = pg_temp.p('a', 'filed.pdf')))::text);

-- SABOTAGE -------------------------------------------------------------------------------------------------------------------------------------------------
create policy "lab result doc patient delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lab-result-documents' and (storage.foldername(name))[1] = (select auth.uid())::text and owner_id = (select auth.uid())::text);
select pg_temp.ck('sabotaged', 'SABOTAGE 1: with the owner-only DELETE policy back, A deletes the filed lab report', '0/0',
  pg_temp.as_user(pg_temp.f('a'), format('select pg_temp.try_change(%L, %L)', 'lab-result-documents', pg_temp.p('a', 'filed.pdf'))));
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.purge_test_account(uuid)'::regprocedure);
  v_def := replace(v_def, 'v_files := private.queue_storage_deletions_for_profile(p_profile, ''test_account_purge'');', 'v_files := 0;');
  execute v_def;
end $$;
select pg_temp.as_user(pg_temp.f('ad'), format('select (public.purge_test_account(%L)) ->> ''purged''', pg_temp.f('t2')));
select pg_temp.ck('sabotaged', 'SABOTAGE 2: without the queue call the purged account''s file is not queued', '1',
  (select count(*)::text from private.storage_deletion_queue where source_id = pg_temp.f('t2')));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'clinical_file_delete_lock_and_purge_storage_queue FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'real') <> 29 then
    raise exception 'clinical_file_delete_lock_and_purge_storage_queue: expected 29 checks, got %', (select count(*) from results where phase = 'real');
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase, check_name;
rollback;
