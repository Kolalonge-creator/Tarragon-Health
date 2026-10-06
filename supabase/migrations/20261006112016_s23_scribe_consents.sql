-- S23 step 1: scribe_consents table
-- Per-encounter consent record for the AI scribe (INV-11, safety case 14).
-- OQ-38 resolved: references clinical_encounter_notes directly (the note IS the encounter).

begin;

create table if not exists public.scribe_consents (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations(id) on delete restrict,
  patient_id           uuid not null references public.profiles(id) on delete restrict,
  encounter_note_id    uuid references public.clinical_encounter_notes(id) on delete restrict,
  clinician_staff_id   uuid not null references public.clinical_staff(id) on delete restrict,
  clinician_profile_id uuid not null references public.profiles(id) on delete restrict,
  granted              boolean not null,
  language             text not null check (language in ('en-NG', 'pcm')),
  recorded_at          timestamptz not null default now(),
  revoked_at           timestamptz,
  created_at           timestamptz not null default now(),

  constraint scribe_consents_revoke_only_granted
    check (revoked_at is null or granted = true)
);

comment on table public.scribe_consents is
  'Per-encounter AI scribe consent record (INV-11). Immutable once created; revoked_at is the only mutable column.';

-- Indexes
create index scribe_consents_patient_idx on public.scribe_consents(patient_id);
create index scribe_consents_encounter_note_idx on public.scribe_consents(encounter_note_id) where encounter_note_id is not null;
create index scribe_consents_org_idx on public.scribe_consents(organisation_id);

-- RLS
alter table public.scribe_consents enable row level security;

create policy scribe_consents_select_staff on public.scribe_consents
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy scribe_consents_insert_clinical on public.scribe_consents
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    and exists (
      select 1 from public.clinical_staff cs
      where cs.id = clinician_staff_id
        and cs.profile_id = auth.uid()
        and cs.active = true
    )
  );

create policy scribe_consents_update_revoke on public.scribe_consents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (
    private.is_org_staff(organisation_id)
    and granted = true
    and revoked_at is not null
  );

-- No DELETE policy: consent records are permanent

-- Grants
grant select, insert, update on public.scribe_consents to authenticated;

-- Trigger: stamp clinician_profile_id from auth.uid() on insert (server-derived, never trust client)
create or replace function private.enforce_scribe_consent_attribution()
returns trigger language plpgsql security definer as $$
begin
  new.clinician_profile_id := auth.uid();
  new.recorded_at := now();
  new.created_at := now();
  return new;
end;
$$;

create trigger scribe_consents_attribution
  before insert on public.scribe_consents
  for each row execute function private.enforce_scribe_consent_attribution();

-- Revoke anon execute on the trigger function (the PUBLIC pseudo-role gotcha)
revoke execute on function private.enforce_scribe_consent_attribution() from public;

-- ── closing assertions ──────────────────────────────────────────────

do $$
begin
  -- Table exists
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'scribe_consents'
  ) then raise exception 'scribe_consents table not created'; end if;

  -- RLS is on
  if not (select relrowsecurity from pg_class where relname = 'scribe_consents' and relnamespace = 'public'::regnamespace)
  then raise exception 'RLS not enabled on scribe_consents'; end if;

  -- authenticated has SELECT, INSERT, UPDATE
  if not has_table_privilege('authenticated', 'public.scribe_consents', 'SELECT')
  then raise exception 'authenticated lacks SELECT on scribe_consents'; end if;
  if not has_table_privilege('authenticated', 'public.scribe_consents', 'INSERT')
  then raise exception 'authenticated lacks INSERT on scribe_consents'; end if;
  if not has_table_privilege('authenticated', 'public.scribe_consents', 'UPDATE')
  then raise exception 'authenticated lacks UPDATE on scribe_consents'; end if;

  -- anon has no EXECUTE on the trigger function
  if has_function_privilege('anon', 'private.enforce_scribe_consent_attribution()', 'EXECUTE')
  then raise exception 'anon can execute enforce_scribe_consent_attribution'; end if;
end $$;

commit;
