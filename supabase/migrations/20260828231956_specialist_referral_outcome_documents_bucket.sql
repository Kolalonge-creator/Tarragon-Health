insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'specialist-referral-outcome-documents',
  'specialist-referral-outcome-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "referral outcome doc patient insert" on storage.objects;
create policy "referral outcome doc patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'specialist-referral-outcome-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "referral outcome doc patient select" on storage.objects;
create policy "referral outcome doc patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'specialist-referral-outcome-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "referral outcome doc patient update" on storage.objects;
create policy "referral outcome doc patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'specialist-referral-outcome-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'specialist-referral-outcome-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "referral outcome doc patient delete" on storage.objects;
create policy "referral outcome doc patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'specialist-referral-outcome-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'specialist-referral-outcome-documents') then
    raise exception 'specialist-referral-outcome-documents bucket missing after migration';
  end if;
  raise notice 'PASS: specialist-referral-outcome-documents bucket + patient-own-folder policies present';
end $$;
