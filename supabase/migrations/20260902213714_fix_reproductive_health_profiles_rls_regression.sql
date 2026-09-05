-- Tarragon Health — fix a live RLS regression on reproductive_health_profiles.
--
-- BACKGROUND. reproductive_health_profiles_select went through three real
-- designs before this one:
--   1. 20260724001210 (original): bare EXISTS(profile_access WHERE
--      grantee_user_id = auth.uid()) -- ANY grant, any permission_level, any
--      category.
--   2. 20260830012429: fixed to route through private.can_read_clinical(),
--      matching every other clinical table -- closed a confirmed live leak
--      (a bare view-only grant, meant only for the non-clinical
--      "appointments" tier, was reading this table regardless of the
--      patient's actual consent).
--   3. 20260830103251 / 20260830123653: can_read_clinical became category-
--      scoped (profile_access_categories) -- a caregiver now needs an
--      EXPLICIT, patient-granted 'reproductive_health' category grant (or to
--      be managing a genuinely dependent, no-login account), never a bare
--      "any relationship" match.
--
-- 20260902205428_adolescent_health_module.sql (merged minutes before this
-- migration) reverted step 3 back to step 1's shape -- the bare EXISTS(...)
-- pattern -- paired with an age-band gate (private.guardian_may_view_
-- confidential_domain) that only restricts ages 10-17. For every patient
-- OUTSIDE that band (i.e. every adult, and every child under a 'child'-band
-- dependent account), the age-band gate is unconditionally true, so the
-- effective policy is back to step 1: any profile_access grantee, at ANY
-- permission_level (including a bare, non-clinical 'view' grant), reads the
-- full reproductive health profile of any adult they have ANY relationship
-- with. This is the exact bug 20260830012429 was written to close, silently
-- reintroduced.
--
-- FIX. Route back through private.can_read_clinical(patient_id,
-- 'reproductive_health') (restoring the category-consent requirement for
-- every non-adolescent-confidentiality case) AND private.has_emergency_
-- access(patient_id, 'reproductive_health') (matching every other clinical
-- table's policy shape, even though that function currently always returns
-- false for this category by its own design -- see
-- 20260830103251's has_emergency_access), while PRESERVING the adolescent
-- confidentiality/waiver feature 20260902205713_adolescent_confidentiality_
-- waivers.sql just added: a caregiver who DOES have genuine category-scoped
-- access (can_read_clinical) is still additionally blocked from a
-- 10-17-year-old's record unless that patient explicitly waived it to them
-- (private.guardian_may_view_confidential_domain, unchanged, still called
-- with the same three arguments).
--
-- One deliberate behavioural consequence, and it is the intended one, not a
-- side effect: a genuinely dependent (no-login) account in the adolescent
-- band previously got unconditional guardian access to every category
-- including reproductive_health (the can_read_clinical dependent-account
-- bypass, restored by 20260830123653 for exactly that reason). This fix
-- means that bypass is now ALSO gated by guardian_may_view_confidential_
-- domain for this one table -- so a dependent 10-17-year-old's reproductive
-- health data becomes invisible to their guardian for the duration of
-- adolescence (no waiver is possible for a no-login account), visible again
-- once the age band becomes 'adult'. That is exactly what the adolescent
-- module's stated purpose is (49.4/49.8: adolescent sexual/reproductive-
-- health confidentiality, overriding the general dependent-account default)
-- -- not something this fix invents.
--
-- INSERT/UPDATE are UNCHANGED (still permission_level='manage' AND
-- guardian_may_edit_confidential_domain) -- they were never routed through
-- can_read_clinical at any point in this table's history (checked: neither
-- 20260830012429 nor 20260830103251 touched them), so there is no
-- regression on the write side to fix.

drop policy if exists reproductive_health_profiles_select on public.reproductive_health_profiles;
create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.has_emergency_access(patient_id, 'reproductive_health')
    or (
      private.can_read_clinical(patient_id, 'reproductive_health')
      and private.guardian_may_view_confidential_domain(
        reproductive_health_profiles.patient_id, (select auth.uid()), 'sexual_reproductive_health'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select qual into v_def
  from pg_policies
  where schemaname = 'public' and tablename = 'reproductive_health_profiles'
    and policyname = 'reproductive_health_profiles_select';

  if v_def is null or v_def not like '%can_read_clinical(%' then
    raise exception 'reproductive_health_profiles_select must be gated on can_read_clinical, got: %', v_def;
  end if;
  if v_def not like '%guardian_may_view_confidential_domain(%' then
    raise exception 'reproductive_health_profiles_select must still be gated on guardian_may_view_confidential_domain, got: %', v_def;
  end if;
  -- The specific regression this migration fixes: a bare, unqualified
  -- EXISTS over profile_access with no can_read_clinical/category gate.
  if v_def like '%exists (%select 1 from public.profile_access pa%' then
    raise exception 'reproductive_health_profiles_select still contains the ungated bare profile_access EXISTS pattern -- regression not fixed';
  end if;
end $$;
