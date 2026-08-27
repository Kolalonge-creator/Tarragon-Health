-- Tarragon Health — patient profile picture
--
-- profiles.avatar_url: nullable, patient-set from /patient/profile. Rendered by
-- the shared Avatar component with an initials fallback wherever it's null —
-- most immediately the clinician-facing patient monitoring grid, but also any
-- future patient-facing "who am I" surface. This is a plain, publicly-served
-- profile photo (not a clinical document), so it follows the SAME public-bucket
-- pattern as clinical_staff.photo_url / 'clinical-staff-photos'
-- (20260817171726) rather than the private per-patient-folder pattern used for
-- lab-result-documents/vaccination-certificates: those hold clinical evidence
-- that must stay behind a signed URL, this is a headshot the patient themself
-- chose to make visible to their own care team.
alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-avatars', 'patient-avatars', true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Path convention: '<patient_id>/<uuid>.<ext>' — a patient may only write
-- objects under their own uid folder (self-upload only; no staff-on-behalf-of
-- upload exists for this, unlike clinical_staff photos which org staff manage).
-- The bucket's public flag serves objects with no RLS check via the public
-- URL, so a select policy isn't load-bearing for rendering, but is added
-- anyway so a patient can browse their own bucket contents from the Studio.
drop policy if exists "patient avatar own insert" on storage.objects;
create policy "patient avatar own insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'patient-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "patient avatar own update" on storage.objects;
create policy "patient avatar own update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'patient-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'patient-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "patient avatar own delete" on storage.objects;
create policy "patient avatar own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'patient-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "patient avatar own select" on storage.objects;
create policy "patient avatar own select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'patient-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
