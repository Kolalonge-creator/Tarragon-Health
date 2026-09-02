-- patient_feature_views: which registry features a patient has already been
-- shown or opened.
--
-- The only thing standing between the "you might not know this is here" card
-- (patient/feature-discovery-card.tsx) and being a nag. Without it the card
-- has no memory, so it re-suggests cycle tracking to the same woman every
-- morning forever, which is worse than never suggesting it at all.
--
-- Deliberately NOT clinical data and deliberately NOT on the is_org_staff
-- surface. This is a UI preference about what a patient has read; no
-- clinician needs it to look after anybody, and adding another table to
-- is_org_staff's ~110-table reach for a wayfinding nicety would be a real
-- widening of the PHI surface for no clinical gain. Patient-own only.

create table public.patient_feature_views (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  -- The registry's PatientFeature.id. Free text on purpose: a foreign key
  -- would need the registry mirrored into a table, and the registry is
  -- application copy that changes with a deploy, not reference data. An id
  -- that no longer exists simply stops matching anything and is inert.
  feature_id       text not null,
  -- Set when the patient actually opened the feature.
  opened_at        timestamptz,
  -- Set when they explicitly said "not for me" on the discovery card. Either
  -- column being non-null retires the suggestion; they are separate so we can
  -- tell "read it" from "sent it away", which is the difference between a
  -- feature that landed and one that misfired.
  dismissed_at     timestamptz,
  created_at       timestamptz not null default now(),

  constraint patient_feature_views_feature_id_not_blank
    check (length(trim(feature_id)) between 1 and 100)
);

-- One row per patient per feature; the app upserts on this.
create unique index patient_feature_views_patient_feature_idx
  on public.patient_feature_views (patient_id, feature_id);
create index patient_feature_views_patient_idx
  on public.patient_feature_views (patient_id);

alter table public.patient_feature_views enable row level security;

create policy patient_feature_views_select on public.patient_feature_views
  for select to authenticated
  using (patient_id = (select auth.uid()));

create policy patient_feature_views_insert on public.patient_feature_views
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy patient_feature_views_update on public.patient_feature_views
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

-- RLS restricts rows; it does not grant table-level access, and a table added
-- by a plain migration does not inherit Supabase's project-creation grant.
-- Omitting this is the failure that has silently broken access on this
-- project at least three times, and it looks like an empty result rather than
-- an error.
grant select, insert, update on public.patient_feature_views to authenticated;

-- The project's ALTER DEFAULT PRIVILEGES fix (see
-- reference_authenticated_table_grants_root_cause) grants authenticated the
-- full set on any new public table, DELETE included, so the grant above does
-- not describe the end state on its own — this revoke is what actually makes
-- it true. Un-dismissing a suggestion is an UPDATE that clears dismissed_at,
-- never a delete: keeping the row is what lets us tell "sent this away once"
-- from "never seen it", and that distinction is the whole point of the table.
revoke delete on public.patient_feature_views from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'patient_feature_views'
  ) then
    raise exception 'patient_feature_views was not created';
  end if;

  if not (
    select relrowsecurity from pg_class where oid = 'public.patient_feature_views'::regclass
  ) then
    raise exception 'patient_feature_views has RLS disabled';
  end if;

  if not has_table_privilege('authenticated', 'public.patient_feature_views', 'SELECT') then
    raise exception 'authenticated cannot read patient_feature_views';
  end if;

  if has_table_privilege('authenticated', 'public.patient_feature_views', 'DELETE') then
    raise exception 'authenticated can delete patient_feature_views rows';
  end if;

  -- anon must never reach a patient-owned table.
  if has_table_privilege('anon', 'public.patient_feature_views', 'SELECT') then
    raise exception 'anon can read patient_feature_views';
  end if;
end $$;
