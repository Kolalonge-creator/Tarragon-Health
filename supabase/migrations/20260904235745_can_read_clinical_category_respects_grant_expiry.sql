-- Tarragon Health — private.can_read_clinical(uuid, care_access_category)
-- must honour profile_access.expires_at.
--
-- THE DEFECT. profile_access rows carry an `expires_at` column (nullable =
-- never expires). The older sibling overload,
-- private.can_read_clinical(uuid, caregiver_permission), checks it:
--
--     and (pa.expires_at is null or pa.expires_at > now())
--
-- The category-scoped overload — added by
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql
-- and repaired by 20260902231348_fix_can_read_clinical_dependent_bypass_
-- drift.sql — never did. It matches on profile_id + grantee_user_id + either
-- the dependent-account bypass or an explicit profile_access_categories row,
-- and stops there. An expired grant therefore keeps returning true forever.
--
-- WHY THIS MATTERS MORE THAN THE OVERLOAD IT SITS NEXT TO. The category
-- overload is the one the platform actually gates clinical reads on: it is
-- called from the SELECT policy of vitals_readings, medications,
-- screening_results, clinician_alerts, care_messages, the menstrual_* tables
-- and many more. So "expiry is ignored" is not a local bug in one helper, it
-- is "a time-limited caregiver grant is not, in fact, time-limited" across
-- most of the clinical surface.
--
-- CURRENTLY LATENT, DELIBERATELY FIXED ANYWAY. Checked before writing this:
-- zero rows in public.profile_access have a non-null expires_at, so nothing
-- observable changes today. The point is that the moment anyone sets one —
-- from the app, from an admin screen, from a future "grant access for 30
-- days" feature — it would silently do nothing. A consent control that is
-- wired up but inert is worse than one that is absent, because the UI
-- promises it.
--
-- SCOPE. This changes exactly one predicate. The function body is otherwise
-- reproduced verbatim from the live definition read out of
-- pg_get_functiondef (NOT from a migration file's committed text — those
-- have drifted from live on this project before). The dependent-account
-- bypass, the profile_access_categories requirement, SECURITY DEFINER,
-- STABLE, and `set search_path to ''` are all unchanged. Note this
-- deliberately does NOT add the sibling's `pa.permissions` check: the
-- category overload expresses scope through profile_access_categories, not
-- through the legacy caregiver_permission array, and conflating the two
-- would narrow live access rather than close a hole.
--
-- Nothing is granted or revoked here: replacing a function body leaves its
-- ACL intact, and this function's execute privileges are unchanged.

create or replace function private.can_read_clinical(
  p_patient uuid,
  p_category public.care_access_category
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (pa.expires_at is null or pa.expires_at > now())
      and (
        (pa.permission_level = 'manage' and p.is_dependent_account)
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- Self-assertions. "Fixed" must be provable, not hopeful.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'can_read_clinical'
    and pg_get_function_identity_arguments(p.oid) = 'p_patient uuid, p_category care_access_category';

  if v_def is null then
    raise exception 'private.can_read_clinical(uuid, care_access_category) is missing after this migration';
  end if;
  if v_def not like '%pa.expires_at is null or pa.expires_at > now()%' then
    raise exception 'the category overload still ignores profile_access.expires_at: %', v_def;
  end if;
  -- The two behaviours this migration must NOT have quietly dropped.
  if v_def not like '%p.is_dependent_account%' then
    raise exception 'the dependent-account bypass was lost — see 20260902231348, it was removed once already and had to be restored';
  end if;
  if v_def not like '%profile_access_categories%' then
    raise exception 'the category-grant requirement was lost';
  end if;
  if v_def not like '%SECURITY DEFINER%' then
    raise exception 'the function is no longer SECURITY DEFINER — RLS on profile_access would now recurse into this check';
  end if;
end $$;

-- Both overloads must now agree about expiry; if the sibling ever loses its
-- check, this catches it rather than letting the two drift apart again.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'can_read_clinical'
    and pg_get_function_identity_arguments(p.oid) = 'p_patient uuid, p_permission caregiver_permission';

  if v_def is not null and v_def not like '%pa.expires_at is null or pa.expires_at > now()%' then
    raise exception 'the caregiver_permission overload has lost its expiry check — the two overloads must not disagree';
  end if;
end $$;
