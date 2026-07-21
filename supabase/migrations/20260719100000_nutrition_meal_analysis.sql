-- Nutrition meal logging + AI photo analysis (adapted for Nigerian food).
--
-- P1 of the Omada-inspired backlog (docs/OMADA_FEATURE_PROPOSALS.md §1).
-- A patient logs a meal (optionally with a photo); a vision model estimates
-- portions/carbs grounded against a Nigerian food set. This is COACHING
-- TELEMETRY ONLY — it is never clinical, never feeds patient_risk_scores /
-- escalation / the abnormal-result pipeline, and is never attributed to a
-- doctor. Gated behind the existing `lifestyle_coaching` entitlement, so no
-- new plan-features or add-on rows are needed here.
--
-- App/web is the interface. A WhatsApp/SMS reminder to "log your meal" is
-- fine; meal entry over WhatsApp is not (Non-Negotiable Business Rules).

-- meal_type — which meal this entry is.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'meal_type') then
    create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');
  end if;
end $$;

create table if not exists public.nutrition_log_entries (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  logged_at         timestamptz not null default now(),
  meal_type         public.meal_type not null,
  description       text,
  -- Path into the private `meal-photos` storage bucket ('<patient_id>/<uuid>.<ext>').
  photo_path        text,
  -- Vision estimate, or null when no photo / the model was unavailable. Shape:
  -- { items:[{name,portion,est_carbs_g}], est_carbs_g, est_calories, confidence,
  --   model, notes }. Never a clinical value.
  ai_estimate       jsonb,
  -- Records whether the vision pass ran, so the UI can distinguish "no photo"
  -- from "model was down" without inspecting the payload.
  ai_status         text not null default 'none'
                      check (ai_status in ('none', 'estimated', 'unavailable')),
  -- The patient can confirm the estimate or override the carb figure — their
  -- own adjustment, still non-clinical.
  patient_confirmed boolean not null default false,
  confirmed_carbs_g numeric(6, 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists nutrition_log_entries_patient_idx
  on public.nutrition_log_entries (patient_id, logged_at desc);
create index if not exists nutrition_log_entries_org_idx
  on public.nutrition_log_entries (organisation_id);

drop trigger if exists nutrition_log_entries_set_updated_at on public.nutrition_log_entries;
create trigger nutrition_log_entries_set_updated_at
  before update on public.nutrition_log_entries
  for each row execute function private.set_updated_at();

alter table public.nutrition_log_entries enable row level security;

drop policy if exists nutrition_log_entries_select on public.nutrition_log_entries;
create policy nutrition_log_entries_select on public.nutrition_log_entries
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists nutrition_log_entries_insert on public.nutrition_log_entries;
create policy nutrition_log_entries_insert on public.nutrition_log_entries
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists nutrition_log_entries_update on public.nutrition_log_entries;
create policy nutrition_log_entries_update on public.nutrition_log_entries
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.nutrition_log_entries to authenticated;

-- Private meal-photo bucket. Same patient-own-folder pattern as
-- vaccination-certificates: path is '<patient_id>/<uuid>.<ext>' and a patient
-- may only touch their own folder. Org staff view via a server-minted signed
-- URL (no staff storage-select policy), same as the certificate flow.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos', 'meal-photos', false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

drop policy if exists "meal photo patient insert" on storage.objects;
create policy "meal photo patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "meal photo patient select" on storage.objects;
create policy "meal photo patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "meal photo patient update" on storage.objects;
create policy "meal photo patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "meal photo patient delete" on storage.objects;
create policy "meal photo patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
