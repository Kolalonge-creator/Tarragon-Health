-- Proof: a patient may update or delete only the result files they uploaded themselves
-- (migration *_result_files_patient_may_only_change_own_uploads.sql, security audit 2026-11-05 H-2).
--
-- For each of the four buckets (lab-result-documents, ecg-reports, imaging-reports,
-- specialist-referral-outcome-documents), patient A's folder holds two objects: one A uploaded
-- (owner_id = A) and one the care team or a lab wrote with the service role (owner_id null).
--   1. A can update and delete A's own upload.
--   2. A can update and delete NEITHER the care team's file, even though it sits in A's folder.
--   3. Patient B can touch nothing in A's folder.
--   4. SABOTAGE: with the old folder-only UPDATE and DELETE policies put back on lab-result-documents, A can
--      overwrite and delete the care team's lab report again, so the checks in step 2 genuinely discriminate.
-- Everything runs in one transaction and is rolled back.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to public;
insert into ids values ('a', gen_random_uuid()), ('b', gen_random_uuid());

-- storage.protect_delete refuses direct DELETE on storage.objects unless this is set (the Storage API sets it).
select set_config('storage.allow_delete_query', 'true', true);

insert into storage.objects (bucket_id, name, owner_id)
select bucket, (select v from ids where k = 'a')::text || '/' || kind || '.pdf',
       case kind when 'own' then (select v from ids where k = 'a')::text else null end
from (values ('lab-result-documents'), ('ecg-reports'), ('imaging-reports'), ('specialist-referral-outcome-documents')) b(bucket)
cross join (values ('own'), ('staff')) k(kind);

-- A session helper: as patient p, try to update then delete bucket/kind; returns 'updated/deleted' row counts.
create or replace function pg_temp.try_change(p_bucket text, p_kind text) returns text
language plpgsql as $f$
declare v_up int; v_del int; v_name text := (select v from ids where k = 'a')::text || '/' || p_kind || '.pdf';
begin
  update storage.objects set metadata = '{"tampered": true}'::jsonb where bucket_id = p_bucket and name = v_name;
  get diagnostics v_up = row_count;
  delete from storage.objects where bucket_id = p_bucket and name = v_name;
  get diagnostics v_del = row_count;
  return v_up || '/' || v_del;
end $f$;
grant execute on function pg_temp.try_change(text, text) to public;

-- 2 and 3 first (a delete of the own file would otherwise remove it before B tries it).
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'b'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results
select 'patient B cannot touch A''s own upload in ' || bucket, '0/0', pg_temp.try_change(bucket, 'own')
from (values ('lab-result-documents'), ('ecg-reports'), ('imaging-reports'), ('specialist-referral-outcome-documents')) b(bucket);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'a'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results
select 'patient A cannot update or delete the care team''s file in ' || bucket, '0/0', pg_temp.try_change(bucket, 'staff')
from (values ('lab-result-documents'), ('ecg-reports'), ('imaging-reports'), ('specialist-referral-outcome-documents')) b(bucket);
insert into results
select 'patient A can update and delete A''s own upload in ' || bucket, '1/1', pg_temp.try_change(bucket, 'own')
from (values ('lab-result-documents'), ('ecg-reports'), ('imaging-reports'), ('specialist-referral-outcome-documents')) b(bucket);
reset role;

-- 4. Sabotage: put back the pre-fix lab-result-documents policies (folder check only).
drop policy "lab result doc patient update" on storage.objects;
drop policy "lab result doc patient delete" on storage.objects;
create policy "lab result doc patient update" on storage.objects for update to authenticated
  using (bucket_id = 'lab-result-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "lab result doc patient delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lab-result-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

set local role authenticated;
insert into results
select 'SABOTAGE: without the owner check, A can overwrite and delete the care team''s lab report', '1/1',
       pg_temp.try_change('lab-result-documents', 'staff');
reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as outcome from results;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || actual || ')', '; ') into v_fail
  from results where expected is distinct from actual;
  if v_fail is not null then
    raise exception 'result_files_patient_may_only_change_own_uploads FAILED: %', v_fail;
  end if;
  if (select count(*) from results) <> 13 then
    raise exception 'result_files_patient_may_only_change_own_uploads: expected 13 checks, got %', (select count(*) from results);
  end if;
end $$;

rollback;
