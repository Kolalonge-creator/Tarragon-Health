-- Close the 5th recurrence of the anon-inherits-EXECUTE-via-PUBLIC bug class
-- (see feedback_supabase_anon_execute_gotcha memory + release-integrity check).
--
-- Applied live 2026-09-03 as version 20260903191308 (filename pinned to the live
-- version, per the migration-drift discipline in CLAUDE.md).
--
-- Zero-row data impact: pure privilege change, no data conversion needed.
--
-- 1) public.provision_dependent_profile_basics: the 4-arg original was locked to
--    service_role by 20260812041044_service_role_write_actor_attribution.sql, but the
--    5-arg overload added in 20260829082917_elder_proxy_dependent_provisioning.sql
--    (p_dependent_kind) never repeated the revoke, leaving the implicit PUBLIC grant.
--    Result: an anon caller holding any profile UUID could rewrite that profile's
--    date_of_birth/sex, spoof app.audit_actor_id, and flip is_dependent_account = true
--    -- and the dependent-account branch of private.can_read_clinical() then grants a
--    manage-level grantee ALL clinical categories, bypassing category consent
--    (reproductive_health included). guard_profiles_self_update does not block it
--    (its guard only fires when auth.uid() = row owner). App code calls this RPC via
--    the service-role client only (add-child-actions.ts / add-elder-actions.ts), so
--    restricting to service_role changes no behaviour.
revoke all on function public.provision_dependent_profile_basics(uuid, date, public.sex, uuid, public.dependent_kind)
  from public, anon, authenticated;

-- 2) private guardian/adolescent helpers + the dependent-transition refresher carried
--    the same implicit PUBLIC grant. anon has no USAGE on schema private, so this was
--    latent, not exploitable -- but the project standard (and the release-integrity
--    check) is per-object revoke as defense-in-depth. The deliberate `authenticated`
--    grants stay (private-schema authenticated default is intentional; 188/203 fns
--    rely on it -- see reference_private_schema_authenticated_default_is_intentional).
revoke execute on function private.adolescent_age_band(uuid) from public, anon;
revoke execute on function private.guardian_may_edit_confidential_domain(uuid) from public, anon;
revoke execute on function private.guardian_may_view_confidential_domain(uuid, uuid, text) from public, anon;
revoke execute on function private.refresh_dependent_transition_statuses() from public, anon;

do $$
declare
  v_fn text;
begin
  -- anon must not be able to execute any of the five
  foreach v_fn in array array[
    'public.provision_dependent_profile_basics(uuid, date, public.sex, uuid, public.dependent_kind)',
    'private.adolescent_age_band(uuid)',
    'private.guardian_may_edit_confidential_domain(uuid)',
    'private.guardian_may_view_confidential_domain(uuid, uuid, text)',
    'private.refresh_dependent_transition_statuses()'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'FAIL: anon can still execute %', v_fn;
    end if;
  end loop;

  -- the RPC must also be closed to authenticated (service_role-only, like its 4-arg sibling)
  if has_function_privilege('authenticated',
       'public.provision_dependent_profile_basics(uuid, date, public.sex, uuid, public.dependent_kind)',
       'EXECUTE') then
    raise exception 'FAIL: authenticated can still execute the 5-arg provision_dependent_profile_basics';
  end if;

  -- service_role must keep it (the app''s only call path), and the private helpers must
  -- keep their deliberate authenticated grants -- prove the revoke did not over-reach.
  if not has_function_privilege('service_role',
       'public.provision_dependent_profile_basics(uuid, date, public.sex, uuid, public.dependent_kind)',
       'EXECUTE') then
    raise exception 'FAIL: service_role lost execute on provision_dependent_profile_basics';
  end if;
  foreach v_fn in array array[
    'private.adolescent_age_band(uuid)',
    'private.guardian_may_edit_confidential_domain(uuid)',
    'private.guardian_may_view_confidential_domain(uuid, uuid, text)'
  ] loop
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: authenticated lost execute on % (intentional grant)', v_fn;
    end if;
  end loop;

  raise notice 'PASS: anon EXECUTE closed on all five functions; service_role/authenticated grants intact';
end $$;
