-- S70a follow-up: three SECURITY DEFINER helpers in the private schema were executable by anon.
--
-- Found by the release-integrity job (check-anon-security-definer-execute.mjs) on 2026-10-15: private.vital_source_class(text, uuid),
-- private.vitals_impossible_reasons(vitals_readings) and private.vitals_triage_band(vitals_readings), created in 20261007123856_s70a_device_core.sql,
-- carry the implicit PUBLIC grant. Their siblings in that migration (hold_impossible_vitals, dedupe_cross_source_vitals, ...) revoke it; these three
-- were missed. They are only called from other definer-run trigger functions, so no role needs EXECUTE on them directly and no grant is added.
-- (anon inherits EXECUTE through the PUBLIC pseudo-role, so the revoke is from public, not only from anon.)
-- Idempotent. Declares no transaction (the apply workflow wraps it).

revoke all on function private.vital_source_class(text, uuid) from public, anon;
revoke all on function private.vitals_impossible_reasons(public.vitals_readings) from public, anon;
revoke all on function private.vitals_triage_band(public.vitals_readings) from public, anon;

do $$
begin
  if has_function_privilege('anon', 'private.vital_source_class(text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.vitals_impossible_reasons(public.vitals_readings)', 'EXECUTE')
     or has_function_privilege('anon', 'private.vitals_triage_band(public.vitals_readings)', 'EXECUTE') then
    raise exception 'S70a follow-up: a vitals helper is still executable by anon';
  end if;
end $$;
