-- Tarragon Health — attempted anon-execute fix on the new lab_partner RPCs.
--
-- Following the pattern documented for 20260724020855/20260724163357 (revoke
-- from anon, not public). This turned out to be INEFFECTIVE here — see the
-- immediately-following migration (20260727004156), which found the real
-- cause (anon inherits via the PUBLIC pseudo-grant, not a direct grant) and
-- fixed it for real. Kept as a harmless no-op for an honest migration history
-- rather than deleted/rewritten.
revoke execute on function public.lab_partner_orders() from anon;
revoke execute on function public.lab_partner_order_patient(uuid) from anon;
revoke execute on function public.lab_partner_upload_result(uuid, text, text, text, bigint, text) from anon;
