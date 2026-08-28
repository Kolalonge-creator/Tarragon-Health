-- Tarragon Health — Specialist Referral Engine, part 6/7: private storage for
-- the uploaded specialist outcome document.
--
-- Mirrors 'lab-result-documents' (20260720120100) exactly: a private bucket,
-- patient-own-folder policies for direct patient upload, and staff access
-- only through a short-lived signed URL minted server-side after an
-- RLS-confirmed row read (no storage policy for staff at all — see
-- lib/lab-results/documents.ts's signResultDocumentPath for the pattern this
-- follows). Path convention: '<patient_id>/<uuid>.<ext>', matching
-- outcome_document_path on specialist_referrals (previous migration) rather
-- than a separate documents table — one referral, one current outcome
-- document, same "enhance the existing row" choice as the rest of this
-- series.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'specialist-referral-outcome-documents',
  'specialist-referral-outcome-documents',
  false,
  10485760, -- 10 MB
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
