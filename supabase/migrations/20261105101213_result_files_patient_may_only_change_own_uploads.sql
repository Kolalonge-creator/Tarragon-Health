-- Tarragon Health: a patient may change or delete only the result files they uploaded themselves.
--
-- Security audit 2026-11-05, finding H-2. Four buckets keep a patient's files under a {patient_id}/ folder:
-- lab-result-documents, ecg-reports, imaging-reports and specialist-referral-outcome-documents. The care
-- team, labs and the server write into that same folder with the service role (for example
-- lib/lab-results/store-file.ts, ecg-reports/actions.ts, imaging-reports/document-actions.ts,
-- referrals/actions.ts). The patient UPDATE and DELETE policies checked only "first folder = my user id",
-- so a patient could use the Storage API directly to overwrite a lab's report with another file, or delete
-- it, while the database row and any doctor's review still pointed at that path.
--
-- The fix: UPDATE and DELETE also require owner_id = the caller. Storage sets owner_id from the uploading
-- JWT, so a patient's own upload carries their id and a service-role upload carries none. Everything the
-- app does today still works: patient code only ever removes a path it has just uploaded (clean-up after a
-- failed insert), and the "replace my wrong file" flow uploads a NEW object rather than overwriting
-- (20260912220345). INSERT and SELECT are unchanged.
--
-- Imaging has two policy sets from two migrations (20260830003118 and 20260902215900); both are replaced.

do $$
declare
  b record;
begin
  for b in
    select * from (values
      ('lab-result-documents',                  'lab result doc patient'),
      ('ecg-reports',                           'ecg report doc patient'),
      ('imaging-reports',                       'imaging report doc patient'),
      ('specialist-referral-outcome-documents', 'referral outcome doc patient')
    ) v(bucket, prefix)
  loop
    execute format('drop policy if exists %I on storage.objects', b.prefix || ' update');
    execute format('drop policy if exists %I on storage.objects', b.prefix || ' delete');

    execute format($p$
      create policy %I on storage.objects
        for update to authenticated
        using (
          bucket_id = %L
          and (storage.foldername(name))[1] = (select auth.uid())::text
          and owner_id = (select auth.uid())::text
        )
        with check (
          bucket_id = %L
          and (storage.foldername(name))[1] = (select auth.uid())::text
          and owner_id = (select auth.uid())::text
        )$p$, b.prefix || ' update', b.bucket, b.bucket);

    execute format($p$
      create policy %I on storage.objects
        for delete to authenticated
        using (
          bucket_id = %L
          and (storage.foldername(name))[1] = (select auth.uid())::text
          and owner_id = (select auth.uid())::text
        )$p$, b.prefix || ' delete', b.bucket);
  end loop;
end $$;

-- The older imaging policy set.
drop policy if exists "imaging report patient update" on storage.objects;
drop policy if exists "imaging report patient delete" on storage.objects;

-- Prove it: every UPDATE/DELETE policy on these buckets now names owner_id, and no older one survives.
do $$
declare
  v_bad text;
begin
  select string_agg(policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE')
    and coalesce(qual, '') ~ '(lab-result-documents|ecg-reports|imaging-reports|specialist-referral-outcome-documents)'
    and coalesce(qual, '') !~ 'owner_id';
  if v_bad is not null then
    raise exception 'H-2: result-file UPDATE/DELETE policies without an owner check remain: %', v_bad;
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE')
        and coalesce(qual, '') ~ '(lab-result-documents|ecg-reports|imaging-reports|specialist-referral-outcome-documents)') <> 8 then
    raise exception 'H-2: expected exactly 8 patient UPDATE/DELETE policies on the four result buckets';
  end if;
end $$;
