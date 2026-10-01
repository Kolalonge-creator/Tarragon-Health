-- A doctor's signature image, printed on the prescription PDF (founder request 2026-10-01).
--
-- Unlike the headshot (public bucket, meant for patient-facing display), a signature is a forgery risk: anyone who could fetch it could paste
-- it onto a document. So:
--   * the image lives in a PRIVATE bucket (staff-signatures); no patient, caregiver or pharmacist can read it, and no public URL exists;
--   * only an ADMIN (private.is_admin()) can upload, replace, read or delete an object in the bucket, for their own organisation's folder;
--   * clinical_staff.signature_path (the object path) can only be changed by an admin or by the system (a trigger enforces it; the existing
--     clinical_staff_update policy admits any org staff, which is too broad for this column);
--   * the PDF route reads the image server-side with the service role, and only AFTER the prescription has passed every issuing rule, then
--     embeds it in the PDF. The path is not in clinical_staff_directory, so no patient-facing read ever sees it.
-- Formats: PNG and JPEG only (the PDF library cannot embed WebP), 1 MB maximum.

alter table public.clinical_staff
  add column if not exists signature_path text,
  add column if not exists signature_updated_at timestamptz,
  add column if not exists signature_updated_by uuid references public.profiles (id) on delete set null;

comment on column public.clinical_staff.signature_path is
  'Object path in the private staff-signatures bucket (<organisation_id>/<uuid>.<png|jpg>). Admin-only to change. Read only server-side, to embed in a prescription PDF that has already passed its issuing rules. Never exposed through clinical_staff_directory.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-signatures', 'staff-signatures', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/png', 'image/jpeg'];

drop policy if exists "staff signature admin insert" on storage.objects;
create policy "staff signature admin insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-signatures'
    and private.is_admin()
    and (storage.foldername(name))[1] = (select private.current_org_id())::text
  );

drop policy if exists "staff signature admin update" on storage.objects;
create policy "staff signature admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'staff-signatures' and private.is_admin() and (storage.foldername(name))[1] = (select private.current_org_id())::text)
  with check (bucket_id = 'staff-signatures' and private.is_admin() and (storage.foldername(name))[1] = (select private.current_org_id())::text);

drop policy if exists "staff signature admin delete" on storage.objects;
create policy "staff signature admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-signatures' and private.is_admin() and (storage.foldername(name))[1] = (select private.current_org_id())::text);

drop policy if exists "staff signature admin select" on storage.objects;
create policy "staff signature admin select" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-signatures' and private.is_admin() and (storage.foldername(name))[1] = (select private.current_org_id())::text);

create or replace function private.guard_clinical_staff_signature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.signature_path is not distinct from old.signature_path then
    return new;
  end if;
  if tg_op = 'INSERT' and new.signature_path is null then
    return new;
  end if;
  -- the system (no signed-in user: migrations, service role) may set it; a signed-in caller must be an admin
  if (select auth.uid()) is not null and not private.is_admin() then
    raise exception 'Only an administrator can change a doctor''s signature' using errcode = '42501';
  end if;
  if new.signature_path is not null and new.signature_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg)$' then
    raise exception 'Invalid signature path' using errcode = '22023';
  end if;
  new.signature_updated_at := now();
  new.signature_updated_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists clinical_staff_guard_signature on public.clinical_staff;
create trigger clinical_staff_guard_signature
  before insert or update on public.clinical_staff
  for each row execute function private.guard_clinical_staff_signature();

revoke all on function private.guard_clinical_staff_signature() from public;
revoke all on function private.guard_clinical_staff_signature() from anon;

do $$
begin
  if (select public from storage.buckets where id = 'staff-signatures') is distinct from false then
    raise exception 'staff-signatures must be a private bucket';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'clinical_staff_directory' and column_name = 'signature_path') then
    raise exception 'signature_path must not be exposed by clinical_staff_directory';
  end if;
end $$;
