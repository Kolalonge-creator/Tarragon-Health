-- These 6 SECURITY DEFINER functions are internally gated (admin-only or
-- pharmacist-partner-scoped) and already safe against anon callers via NULL
-- semantics, but per the established codebase pattern, `revoke ... from public`
-- does not strip anon's default EXECUTE grant on a Postgres function in this
-- project — it must be revoked from anon explicitly (same gotcha documented
-- in migration 20260724020855). Two of these (pharmacist_order_allergies,
-- pharmacist_order_medications) return PHI, so this closes a real
-- defense-in-depth gap flagged by the security advisor, not just a lint.
revoke execute on function public.admin_broadcast_audience_count(public.broadcast_audience, jsonb) from anon;
revoke execute on function public.admin_send_broadcast(uuid) from anon;
revoke execute on function public.pharmacist_order_allergies(uuid) from anon;
revoke execute on function public.pharmacist_order_medications(uuid) from anon;
revoke execute on function public.pharmacist_orders() from anon;
revoke execute on function public.pharmacist_record_dispense(uuid, text, text, date) from anon;
