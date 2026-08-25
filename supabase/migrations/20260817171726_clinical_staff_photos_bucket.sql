-- Tarragon Health
-- Public storage bucket for clinical_staff.photo_url. The column has existed
-- since clinical_staff was created (20260712191500) but nothing has ever
-- populated or served it: no admin UI captured a photo, and no bucket
-- existed to hold one — photo_url could only ever be set by hand via SQL.
--
-- Public, not the private per-patient-folder pattern used for
-- meal-photos/lab-result-documents/vaccination-certificates: these are
-- professional headshots meant for patient-facing trust display, per
-- clinical_staff's own migration comment ("the whole point of this table is
-- patient/family-facing trust display"). ReviewedByDoctor and the admin
-- manager render photo_url directly via a plain <img src>, with no auth
-- header — a signed URL would expire and can't be cached as a plain text
-- column the way photo_url is typed, so public is the correct fit here, not
-- an oversight of the private-bucket convention used elsewhere.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-staff-photos', 'clinical-staff-photos', true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Path convention: '<organisation_id>/<uuid>.<ext>' — write access follows
-- the same private.is_org_staff gate as clinical_staff's own insert/update
-- policies. The bucket's public flag serves objects with no RLS check at
-- all via the public URL, so a select policy isn't load-bearing for
-- ReviewedByDoctor/the admin manager, but is added anyway so org staff can
-- browse the bucket's contents from the Studio.

drop policy if exists "clinical staff photo org staff insert" on storage.objects;
create policy "clinical staff photo org staff insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'clinical-staff-photos'
    and private.is_org_staff((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "clinical staff photo org staff update" on storage.objects;
create policy "clinical staff photo org staff update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'clinical-staff-photos'
    and private.is_org_staff((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'clinical-staff-photos'
    and private.is_org_staff((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "clinical staff photo org staff delete" on storage.objects;
create policy "clinical staff photo org staff delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'clinical-staff-photos'
    and private.is_org_staff((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "clinical staff photo org staff select" on storage.objects;
create policy "clinical staff photo org staff select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'clinical-staff-photos'
    and private.is_org_staff((storage.foldername(name))[1]::uuid)
  );
