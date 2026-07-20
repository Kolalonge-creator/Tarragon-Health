-- Go-live security hardening (2026-07-20):
-- 1) These security-definer RPCs are only ever called from authenticated app surfaces
--    (patient RegionGate, admin broadcast composer, pharmacist portal). Revoke anon execute
--    so an unauthenticated caller cannot even probe them.
revoke execute on function public.region_service_available(text, text) from anon;
revoke execute on function public.admin_broadcast_audience_count(public.broadcast_audience, jsonb) from anon;
revoke execute on function public.admin_send_broadcast(uuid) from anon;
revoke execute on function public.pharmacist_orders() from anon;
revoke execute on function public.pharmacist_order_allergies(uuid) from anon;
revoke execute on function public.pharmacist_order_medications(uuid) from anon;
revoke execute on function public.pharmacist_record_dispense(uuid, text, text, date) from anon;

-- 2) Pin search_path on the one private helper missing it (advisor: function_search_path_mutable).
alter function private.lpe_review_cadence_months(public.care_plan_condition) set search_path = '';
