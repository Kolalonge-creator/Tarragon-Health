-- Tarragon Health — Adolescent Health module: patient-controlled
-- confidentiality waivers (follow-up to 20260902205428_adolescent_health_module.sql).
--
-- 49.13's acceptance criteria explicitly names "increasing autonomy" as a
-- goal, and 49.4 frames the adolescent themselves as one of the three
-- parties with a stake in who sees what — so the confidentiality gate
-- private.guardian_may_view_confidential_domain shipped in the prior
-- migration deliberately left room for the adolescent to choose to share a
-- domain with a specific parent/guardian, rather than the gate being a
-- one-way wall only a clinician can see through. This migration is that
-- choice, built as its own narrow table rather than by reusing
-- profile_access.clinical_access (the existing "let a grantee read my
-- clinical data" consent switch, 20260731181143):
--   - clinical_access is a single blanket switch covering six tables at once
--     (vitals_readings, care_plans, medications, screening_schedules,
--     lab_orders, patient_risk_scores) — turning it on for a parent to see
--     one adolescent-confidential domain would also hand them five other
--     tables' worth of data never asked about.
--   - clinical_access has no concept of a domain, so it cannot express "share
--     sexual health but not the rest" — exactly the kind of granular choice
--     this module needs.
--   - Reusing it would also change behaviour for every OTHER profile_access
--     relationship on the platform (eldercare, next-of-kin) that has nothing
--     to do with adolescent confidentiality.
-- A dedicated, narrowly-scoped table avoids all three problems at the cost
-- of one more table — the right trade here.

create table if not exists public.adolescent_confidentiality_waivers (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  grantee_user_id   uuid not null references public.profiles (id) on delete cascade,
  domain            text not null check (domain in ('sexual_reproductive_health', 'mental_health', 'substance_use')),
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id) on delete set null,
  constraint adolescent_confidentiality_waivers_no_self_grant check (patient_id <> grantee_user_id)
);

comment on table public.adolescent_confidentiality_waivers is
  'A patient-initiated choice to share one confidentiality-gated domain with one existing profile_access grantee (typically a parent). Only ever inserted by the patient themselves (never a parent, never staff, never "acting for") — see the insert policy and 49.13''s "increasing autonomy" framing. Revocable by the patient at any time; org staff may ALSO revoke (a safety valve if a clinician judges the sharing unsafe) but never grant on the patient''s behalf. Only wired into reproductive_health_profiles today (domain=sexual_reproductive_health) — mental_health/substance_use are reserved for whichever future confidential table needs the same choice, not yet read by any RLS policy.';

-- Only one ACTIVE waiver per (patient, grantee, domain) — revoking then
-- re-granting inserts a new row rather than un-revoking the old one, so the
-- history of every grant/revoke stays intact (append-only, same discipline
-- as safeguarding_concerns/clinician_alerts never being deleted).
create unique index if not exists adolescent_confidentiality_waivers_active_uidx
  on public.adolescent_confidentiality_waivers (patient_id, grantee_user_id, domain)
  where revoked_at is null;

create index if not exists adolescent_confidentiality_waivers_grantee_idx
  on public.adolescent_confidentiality_waivers (grantee_user_id);

alter table public.adolescent_confidentiality_waivers enable row level security;

create policy adolescent_confidentiality_waivers_select on public.adolescent_confidentiality_waivers
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or grantee_user_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- Only the patient — never "acting for" (auth.uid() stays the real caller
-- throughout the acting-for mechanism, see lib/acting/acting-for.ts, so this
-- check already excludes a supporter operating the patient's dashboard),
-- never org staff, never an admin. The grantee must already hold a
-- profile_access grant on this patient — a waiver widens what an EXISTING
-- relationship can see, it does not create a new one.
create policy adolescent_confidentiality_waivers_insert on public.adolescent_confidentiality_waivers
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and exists (
      select 1 from public.profile_access pa
      where pa.profile_id = adolescent_confidentiality_waivers.patient_id
        and pa.grantee_user_id = adolescent_confidentiality_waivers.grantee_user_id
    )
  );

-- Revoking (setting revoked_at) is the only legal update, and is allowed to
-- the patient or org staff (a clinician safety valve, see table comment) —
-- never the grantee themselves. Enforced by the trigger below, since RLS
-- alone cannot compare which specific column changed.
create policy adolescent_confidentiality_waivers_update on public.adolescent_confidentiality_waivers
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.adolescent_confidentiality_waivers to authenticated;

create or replace function private.enforce_adolescent_waiver_revoke_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.patient_id is distinct from old.patient_id
     or new.grantee_user_id is distinct from old.grantee_user_id
     or new.domain is distinct from old.domain
     or new.granted_at is distinct from old.granted_at then
    raise exception 'A waiver row may only ever be revoked (setting revoked_at) — its identity fields cannot change. To re-grant, insert a new row.'
      using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked waiver cannot be un-revoked or edited further — insert a new row to re-grant.'
      using errcode = '42501';
  end if;
  if new.revoked_at is not null and old.revoked_at is null then
    new.revoked_by := (select auth.uid());
  end if;
  return new;
end;
$$;

comment on function private.enforce_adolescent_waiver_revoke_only() is
  'RLS admits patient-or-org-staff to UPDATE broadly; this narrows it to exactly one legal transition (null -> non-null revoked_at) and stamps revoked_by from the session, never client-supplied — same "RLS admits broadly, a trigger narrows" shape as private.enforce_emergency_escalation_tier.';

drop trigger if exists adolescent_confidentiality_waivers_enforce_revoke_only on public.adolescent_confidentiality_waivers;
create trigger adolescent_confidentiality_waivers_enforce_revoke_only
  before update on public.adolescent_confidentiality_waivers
  for each row execute function private.enforce_adolescent_waiver_revoke_only();

-- ===========================================================================
-- Wire the waiver into guardian_may_view_confidential_domain
-- ===========================================================================
-- Signature change (patient-only -> patient+grantee+domain), so the old
-- 1-arg overload is dropped explicitly rather than left as dead code
-- alongside the new one. Its only callers were reproductive_health_profiles'
-- three policies (created by the prior migration, 20260902205428_adolescent_health_module.sql) — CASCADE
-- is required (a bare DROP fails with "other objects depend on it") and is
-- safe here specifically because all three of those policies are
-- unconditionally dropped-and-recreated later in this same migration (see
-- "Wire the waiver into guardian_may_view_confidential_domain" below), so
-- nothing is lost by letting the cascade take them too.
drop function if exists private.guardian_may_view_confidential_domain(uuid) cascade;

create or replace function private.guardian_may_view_confidential_domain(
  p_patient_id uuid, p_grantee_user_id uuid, p_domain text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.adolescent_age_band(p_patient_id) not in ('younger_adolescent', 'older_adolescent')
    or exists (
      select 1 from public.adolescent_confidentiality_waivers w
      where w.patient_id = p_patient_id
        and w.grantee_user_id = p_grantee_user_id
        and w.domain = p_domain
        and w.revoked_at is null
    );
$$;

comment on function private.guardian_may_view_confidential_domain(uuid, uuid, text) is
  'READ-ONLY gate. True when a profile_access grantee may SEE a CONFIDENTIAL-domain record: the patient is outside the two protected age bands, OR the patient has explicitly waived that specific domain to that specific grantee (adolescent_confidentiality_waivers). Deliberately used only in reproductive_health_profiles'' SELECT policy below, never INSERT/UPDATE — "let my parent see this" is a visibility choice, not an edit grant, so a manage-level grantee''s write access stays gated by the age band alone (see private.guardian_may_edit_confidential_domain below), unaffected by any waiver. Called directly inside an RLS clause under `authenticated` (see private.adolescent_age_band''s own comment for why this carries no explicit grant/revoke).';

-- Write-side (INSERT/UPDATE) gate: age band ONLY, never the waiver. Kept as
-- its own function rather than inlining the boolean twice, and deliberately
-- NOT named like guardian_may_view_confidential_domain so the two can never
-- be confused or accidentally swapped at a future call site.
create or replace function private.guardian_may_edit_confidential_domain(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.adolescent_age_band(p_patient_id) not in ('younger_adolescent', 'older_adolescent');
$$;

comment on function private.guardian_may_edit_confidential_domain(uuid) is
  'WRITE-side gate for a CONFIDENTIAL-domain table''s profile_access branch — age band only, no waiver escape hatch. A patient sharing read visibility of a domain with a parent (adolescent_confidentiality_waivers) never thereby grants that parent edit rights; only the patient themselves (or org staff) can ever write while the patient is in a protected age band. Same anon/authenticated privilege posture as guardian_may_view_confidential_domain — see that function''s neighbouring comment in the prior migration.';

-- ---------------------------------------------------------------------------
-- reproductive_health_profiles — SELECT is now waiver-aware; INSERT/UPDATE
-- stay age-band-only (see the two functions' comments above for why they
-- deliberately diverge).
-- ---------------------------------------------------------------------------
drop policy if exists reproductive_health_profiles_select on public.reproductive_health_profiles;
create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
      )
      and private.guardian_may_view_confidential_domain(
        reproductive_health_profiles.patient_id, (select auth.uid()), 'sexual_reproductive_health'
      )
    )
  );

drop policy if exists reproductive_health_profiles_insert on public.reproductive_health_profiles;
create policy reproductive_health_profiles_insert on public.reproductive_health_profiles
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
      )
      and private.guardian_may_edit_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

drop policy if exists reproductive_health_profiles_update on public.reproductive_health_profiles;
create policy reproductive_health_profiles_update on public.reproductive_health_profiles
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
      )
      and private.guardian_may_edit_confidential_domain(reproductive_health_profiles.patient_id)
    )
  )
  with check (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
      )
      and private.guardian_may_edit_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

-- ===========================================================================
-- Assertions — the migration is the test.
-- ===========================================================================
do $$
declare v_n int;
begin
  if to_regclass('public.adolescent_confidentiality_waivers') is null then
    raise exception 'adolescent_confidentiality_waivers was not created';
  end if;

  select count(*) into v_n from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'adolescent_confidentiality_waivers';
  if v_n <> 3 then raise exception 'expected 3 adolescent_confidentiality_waivers policies, found %', v_n; end if;

  -- Only the patient may INSERT (grant) a waiver — never org staff, never an
  -- admin bypass. is_org_staff must not appear in the insert policy at all.
  if exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'adolescent_confidentiality_waivers'
      and pol.polcmd = 'a' -- INSERT
      and (
        coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%is_org_staff%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%is_admin%'
      )
  ) then
    raise exception 'FAIL: only the patient may grant a confidentiality waiver — insert policy must not admit org staff/admin';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'adolescent_confidentiality_waivers_enforce_revoke_only'
      and tgrelid = 'public.adolescent_confidentiality_waivers'::regclass
      and not tgisinternal
  ) then
    raise exception 'adolescent_confidentiality_waivers_enforce_revoke_only trigger was not created';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guardian_may_view_confidential_domain'
      and pg_get_function_identity_arguments(p.oid) = 'p_patient_id uuid'
  ) then
    raise exception 'the old 1-arg guardian_may_view_confidential_domain overload was not dropped';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guardian_may_view_confidential_domain'
      and pg_get_function_identity_arguments(p.oid) = 'p_patient_id uuid, p_grantee_user_id uuid, p_domain text'
  ) then
    raise exception 'the new 3-arg guardian_may_view_confidential_domain overload was not created';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guardian_may_edit_confidential_domain'
  ) then
    raise exception 'private.guardian_may_edit_confidential_domain was not created';
  end if;

  -- The load-bearing invariant this migration exists to prove: sharing READ
  -- visibility (a waiver) must never also open a write path. Neither the
  -- write-gate function's body nor reproductive_health_profiles' INSERT/
  -- UPDATE policies may reference the waiver table.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guardian_may_edit_confidential_domain'
      and pg_get_functiondef(p.oid) ilike '%adolescent_confidentiality_waivers%'
  ) then
    raise exception 'FAIL: guardian_may_edit_confidential_domain must never consult adolescent_confidentiality_waivers';
  end if;
  if exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relname = 'reproductive_health_profiles'
      and pol.polcmd in ('a', 'w') -- INSERT, UPDATE
      and (
        coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%guardian_may_view_confidential_domain%'
        or coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%guardian_may_view_confidential_domain%'
      )
  ) then
    raise exception 'FAIL: reproductive_health_profiles INSERT/UPDATE must use the edit-gate, never the waiver-aware view-gate';
  end if;

  raise notice 'PASS: adolescent_confidentiality_waivers created, patient-only grant enforced, read/write confidentiality gates kept deliberately separate';
end $$;
