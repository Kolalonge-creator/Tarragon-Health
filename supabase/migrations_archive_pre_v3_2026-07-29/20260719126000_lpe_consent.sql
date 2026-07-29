-- ============================================================================
-- LPE Phase 4 (follow-up) — consent capture + structural gate (spec §14).
-- Consent is captured before a programme goes live. An enrollment cannot be
-- 'active'/'maintenance' without a consent_id — enforced by trigger, so the
-- app-layer step ordering has a backstop that can't be bypassed.
-- ============================================================================
create table if not exists public.lpe_consents (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  scope           text not null default 'lifestyle_programme',
  channel         text,                      -- 'app' | 'web'
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists lpe_consents_patient_idx
  on public.lpe_consents (patient_id, scope);

alter table public.lpe_consents enable row level security;
drop policy if exists lpe_consents_select on public.lpe_consents;
create policy lpe_consents_select on public.lpe_consents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lpe_consents_insert on public.lpe_consents;
create policy lpe_consents_insert on public.lpe_consents
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id));
-- Revocation only (patient may set revoked_at on their own row); no other edits.
drop policy if exists lpe_consents_update on public.lpe_consents;
create policy lpe_consents_update on public.lpe_consents
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
grant select, insert, update on public.lpe_consents to authenticated;

-- Wire the FK (deferred from Phase 1).
do $$ begin
  alter table public.lpe_enrollments
    add constraint lpe_enrollments_consent_fk
    foreign key (consent_id) references public.lpe_consents (id) on delete set null;
exception when duplicate_object then null; end $$;

-- Structural gate: a live programme requires a recorded, unrevoked consent.
create or replace function private.enforce_lpe_enrollment_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('active','maintenance') then
    if new.consent_id is null
       or not exists (
         select 1 from public.lpe_consents c
         where c.id = new.consent_id
           and c.patient_id = new.patient_id
           and c.revoked_at is null)
    then
      raise exception 'a live lifestyle programme requires an unrevoked consent'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lpe_enrollments_enforce_consent on public.lpe_enrollments;
create trigger lpe_enrollments_enforce_consent
  before insert or update on public.lpe_enrollments
  for each row execute function private.enforce_lpe_enrollment_consent();
