-- Tarragon Health
-- Recurrence of the anon-inherits-EXECUTE-via-PUBLIC bug (see the
-- supabase-anon-execute-gotcha memory) -- found live 2026-08-30 by
-- scripts/release-integrity/check-anon-security-definer-execute.mjs, a second,
-- separate batch from the one closed the same day in
-- 20260829111514_resweep_private_schema_execute_from_public.sql. Each of these
-- 3 `private`-schema SECURITY DEFINER functions was granted EXECUTE to
-- authenticated without a preceding `revoke ... from public` first, so the
-- implicit PUBLIC-pseudo-role grant every new SECURITY DEFINER function
-- carries was never removed and `anon` inherited EXECUTE through it. `private`
-- isn't PostgREST-exposed, so this is defense-in-depth rather than a directly
-- internet-reachable breach -- except finance_post_journal, which posts real
-- financial journal entries and should be treated with real urgency
-- regardless of the exposure path.
--
-- Grants-only fix: no change to any function's logic. Those functions' own
-- migrations may still be under active development elsewhere.

revoke all on function private.care_voucher_category(p_panel_bundle_id uuid) from public, anon;
grant execute on function private.care_voucher_category(p_panel_bundle_id uuid) to authenticated;

revoke all on function private.finance_post_journal(p_entry_date date, p_currency currency, p_source text, p_source_ref text, p_memo text, p_lines jsonb, p_created_by uuid, p_apply_vat boolean) from public, anon;
grant execute on function private.finance_post_journal(p_entry_date date, p_currency currency, p_source text, p_source_ref text, p_memo text, p_lines jsonb, p_created_by uuid, p_apply_vat boolean) to authenticated;

revoke all on function private.notify_unapproved_emergency_access_grants() from public, anon;
grant execute on function private.notify_unapproved_emergency_access_grants() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.care_voucher_category(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute private.care_voucher_category';
  end if;
  raise notice 'PASS: private.care_voucher_category present, anon denied';
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.finance_post_journal(date, currency, text, text, text, jsonb, uuid, boolean)', 'EXECUTE') then
    raise exception 'anon can still execute private.finance_post_journal';
  end if;
  raise notice 'PASS: private.finance_post_journal present, anon denied';
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.notify_unapproved_emergency_access_grants()', 'EXECUTE') then
    raise exception 'anon can still execute private.notify_unapproved_emergency_access_grants';
  end if;
  raise notice 'PASS: private.notify_unapproved_emergency_access_grants present, anon denied';
end $$;
