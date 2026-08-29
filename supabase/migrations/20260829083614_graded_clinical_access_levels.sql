-- Tarragon Health — Family Care Circle gap closure, part 4 of 5
-- (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.4: "permission levels are 2 (+1
-- toggle), not 5 — clinical_access in particular is all-or-nothing").
--
-- clinical_access (20260731181143) is read by roughly twenty RLS policies
-- across this codebase (vitals_readings, care_plans, medications,
-- medication_logs, clinician_alerts, lab_analyte_readings, patient_timeline,
-- patient_blood_profile, care_messages, care_vouchers, care_receipt, and
-- more — grep private.can_read_clinical( across supabase/migrations for the
-- full list). Rewriting every one of those policies to reason about a graded
-- scale in one migration, unable to test any of it against a live database
-- in this environment, would be exactly the kind of single-change,
-- wide-blast-radius RLS edit CLAUDE.md's own standing lessons warn against
-- for private.is_org_staff.
--
-- So this does the graded part in a way that touches NONE of those twenty
-- policies: clinical_access_level becomes the real, three-way consent
-- control (none/summary/full) that the owner sets, and the existing
-- clinical_access boolean column is turned into a GENERATED column derived
-- from it (true whenever level <> 'none'). Every existing policy still reads
-- pa.clinical_access, gets exactly the same true/false answer it always
-- did, and needs no edit at all. The one real behavioural narrowing this
-- migration makes — full-only for the two tables carrying the most
-- sensitive results (lab_analyte_readings, patient_blood_profile) — is
-- applied explicitly, by name, below; every other can_read_clinical call
-- site is deliberately left summary-or-full (i.e. unchanged), because this
-- codebase's own RLS has never distinguished a finer sensitivity tier for
-- them and inventing twenty new judgement calls without founder input is
-- out of scope for this change.
--
-- L2 vs L3 vs L5 of the brief's five levels do not map onto separate ROWS or
-- TABLES the way "lab results" does, so they cannot be expressed as an RLS
-- predicate without new views this migration does not build; see
-- docs/FAMILY_CARE_CIRCLE_SPEC.md §3.4 for the mapping this settles for
-- (permission_level view/manage x clinical_access_level none/summary/full
-- is the real, load-bearing grid now; L1 = manage+none, L2/L3 = view-or-
-- manage+summary, L4 = view-or-manage+full, L5 = manage+full, still short of
-- a literal "full proxy" by design — see the spec's §4 on what stays
-- deliberately non-delegable).

create type public.clinical_access_level as enum ('none', 'summary', 'full');

alter table public.profile_access
  add column clinical_access_level public.clinical_access_level not null default 'none';

comment on column public.profile_access.clinical_access_level is
  'The graded replacement for the plain clinical_access boolean below, which is now GENERATED from this column and kept for every existing RLS policy to read unchanged. none: no health information. summary: day-to-day monitoring (vitals, care plan status, medications, messages, receipts — everything private.can_read_clinical already gated before this migration, except the two full-only exceptions named in 20260829083614). full: additionally, lab_analyte_readings and patient_blood_profile, gated by the new private.can_read_clinical_full.';

update public.profile_access
   set clinical_access_level = case when clinical_access then 'full' else 'none' end;

alter table public.profile_access drop column clinical_access;

alter table public.profile_access
  add column clinical_access boolean generated always as (clinical_access_level <> 'none') stored;

comment on column public.profile_access.clinical_access is
  'Generated from clinical_access_level (true unless none) so every pre-existing RLS policy that reads this column keeps working unchanged — see 20260829083614. Read only, same as before; set clinical_access_level instead.';

-- Same ownership rule as before (private.enforce_clinical_access_consent_owner,
-- 20260731181143), rewritten to operate on clinical_access_level since the
-- old boolean is no longer a plain column a trigger may assign to.
create or replace function private.enforce_clinical_access_consent_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.clinical_access_level := 'none';
    new.clinical_access_updated_at := null;
    return new;
  end if;

  if new.clinical_access_level is distinct from old.clinical_access_level then
    if v_uid is null or v_uid is distinct from old.profile_id then
      raise exception
        'only the person whose record it is may change who can see their health information'
        using errcode = '42501';
    end if;
    new.clinical_access_updated_at := now();
  end if;

  return new;
end;
$$;

-- Same shape as private.can_read_clinical (20260731185243), requiring 'full'
-- specifically rather than any non-'none' level. The is_dependent_account
-- carve-out is preserved and still resolves to 'full': a child or elder_proxy
-- dependant's manage grant already stands in for consent at every other
-- level (private.can_read_clinical), so it would be a strange, arbitrary gap
-- to let their guardian see a status summary but not the lab result behind
-- it.
create or replace function private.can_read_clinical_full(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (
        pa.clinical_access_level = 'full'
        or (pa.permission_level = 'manage' and p.is_dependent_account)
      )
  );
$$;

comment on function private.can_read_clinical_full(uuid) is
  'Stricter sibling of private.can_read_clinical: requires clinical_access_level = full specifically (a summary-only grantee does not pass), same is_dependent_account carve-out. Gates lab_analyte_readings and patient_blood_profile only — see 20260829083614.';

revoke all on function private.can_read_clinical_full(uuid) from public;

-- The one real behavioural change: these two tables now require 'full'
-- rather than any non-'none' level. Every other can_read_clinical call site
-- (grep the function name across supabase/migrations) is untouched.

drop policy if exists lab_analyte_readings_select on public.lab_analyte_readings;
create policy lab_analyte_readings_select on public.lab_analyte_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical_full(patient_id)
  );

drop policy if exists "patient_blood_profile_select" on public.patient_blood_profile;
create policy "patient_blood_profile_select"
  on public.patient_blood_profile
  for select
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical_full(patient_id)
  );

do $$
declare
  v_bad text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_access'
      and column_name = 'clinical_access' and is_generated = 'ALWAYS'
  ) then
    raise exception 'profile_access.clinical_access is not a generated column after migration';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_read_clinical_full'
  ) then
    raise exception 'private.can_read_clinical_full missing after migration';
  end if;

  -- Every OTHER can_read_clinical policy must be untouched: this asserts the
  -- count of policies referencing can_read_clinical( (not _full) has not
  -- shrunk, which would mean this migration accidentally narrowed one of
  -- the twenty it was never supposed to touch.
  select string_agg(c.relname || '.' || pol.polname, ', ') into v_bad
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname in ('lab_analyte_readings', 'patient_blood_profile')
     and (pg_get_expr(pol.polqual, pol.polrelid) ilike '%can_read_clinical(%'
          and pg_get_expr(pol.polqual, pol.polrelid) not ilike '%can_read_clinical_full(%');
  if v_bad is not null then
    raise exception 'still using the summary-eligible gate, expected can_read_clinical_full: %', v_bad;
  end if;

  if has_function_privilege('anon', 'private.can_read_clinical_full(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.can_read_clinical_full';
  end if;

  raise notice 'PASS: clinical_access_level graded, clinical_access generated, lab/blood profile require full';
end $$;
