-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql ("B5. Retire the
-- old switch") planned to drop profile_access.clinical_access / clinical_access_updated_at,
-- their owner-guard trigger/function, and the legacy 1-arg private.can_read_clinical(uuid)
-- overload once every caller had moved onto the new category-aware
-- can_read_clinical(uuid, care_access_category) overload. Direct inspection of the live
-- project (koiplnmbgnqnbywhpjlf) found that retirement step never actually took effect --
-- the column, trigger, function, and legacy overload are all still live today, coexisting
-- with the new category-scoped surface -- and two things independently still depend on
-- that legacy surface:
--   1. 20260831161822_rewire_care_graph_and_receipts_to_service_purchases.sql (already
--      merged into main-dev) reads pa.clinical_access directly in two receipt-building
--      queries.
--   2. The in-flight Patient Identity/MPI branch (PR #377, not yet merged) builds its own
--      emergency_access_grants feature against the private.can_read_clinical(p_patient uuid)
--      1-arg signature.
-- Dropping either now would break both. Rather than leave that coexistence as an accident
-- of drift (the exact "lives without a migration record" failure mode called out in
-- CLAUDE.md), this migration makes it an explicit, tracked, idempotent guarantee: it
-- recreates the legacy column/trigger/function exactly as they exist live, so a future
-- migration replay that actually executes 103251's drop statements does not silently
-- resurrect this gap. This migration deliberately does NOT edit 103251's committed text --
-- it is already recorded as applied, and rewriting an applied migration's SQL is worse than
-- leaving a dead retirement step in place.
--
-- Follow-up owed once PR #377 is reconciled: retire profile_access.clinical_access, its
-- trigger, and the 1-arg can_read_clinical(uuid) overload for real, as its own deliberate
-- migration -- not as an accidental side effect of this chain landing first.

alter table public.profile_access
  add column if not exists clinical_access boolean not null default false,
  add column if not exists clinical_access_updated_at timestamptz;

create or replace function private.enforce_clinical_access_consent_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.clinical_access := false;
    new.clinical_access_updated_at := null;
    return new;
  end if;

  if new.clinical_access is distinct from old.clinical_access then
    if v_uid is null or v_uid is distinct from old.profile_id then
      raise exception
        'only the person whose record it is may change who can see their health information'
        using errcode = '42501';
    end if;
    new.clinical_access_updated_at := now();
  end if;

  return new;
end;
$function$;

drop trigger if exists profile_access_clinical_consent on public.profile_access;
create trigger profile_access_clinical_consent
  before insert or update on public.profile_access
  for each row execute function private.enforce_clinical_access_consent_owner();

-- Legacy 1-arg overload, unchanged from its pre-category-scoping definition: general
-- clinical access gated on the independent clinical_access boolean flag, not on any
-- specific care_access_category. This is deliberately NOT rewritten to delegate to the
-- new 2-arg overload with a default category -- that would be a real behaviour change
-- to an access-control boundary PR #377 was built against, and this migration's job is
-- compatibility, not redesign. Whether it should delegate instead is exactly the open
-- question flagged back to the founder for the #377 reconciliation.
create or replace function private.can_read_clinical(p_patient uuid)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select exists (
    select 1
    from public.profile_access pa
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and pa.clinical_access
  );
$function$;

-- The 2026-08-30 anon-execute resweep (20260830103634) closed this exact "PUBLIC pseudo-role
-- inheritance" gap for the new 2-arg overload but skipped this 1-arg one, on the (at the time
-- correct) assumption that 103251 had already dropped it. It hadn't -- see above -- so it was
-- still `anon`-callable when this migration ran. auth.uid() is null for anon, so the exists()
-- always evaluates false for that role in practice, but principle-of-least-privilege still
-- applies: close it the same way the resweep closed the others.
revoke all on function private.can_read_clinical(p_patient uuid) from public, anon;
grant execute on function private.can_read_clinical(p_patient uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
      and pg_get_function_identity_arguments(oid) = 'p_patient uuid'
  ) then
    raise exception 'legacy can_read_clinical(uuid) is missing after the compat migration';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace
      and pg_get_function_identity_arguments(oid) like '%care_access_category%'
  ) then
    raise exception 'category-aware can_read_clinical(uuid, care_access_category) is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_access' and column_name = 'clinical_access'
  ) then
    raise exception 'profile_access.clinical_access is missing after the compat migration';
  end if;
end $$;
