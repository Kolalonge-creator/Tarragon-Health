-- Tarragon Health
-- Hardening follow-up for the two notification-dedup tables added earlier in
-- this same 2026-08-26 indemnity/liability pass
-- (clinician_alert_sla_breach_notifications, clinical_staff_indemnity_lapse_notifications).
-- Both were created after alter-default-privileges (20260731232749), which
-- grants authenticated select/insert/update/delete on every NEW table by
-- default -- so despite each migration only explicitly granting SELECT, both
-- tables silently also picked up INSERT/UPDATE/DELETE table-level privileges.
-- No RLS policy admits any of those three, so no session could actually use
-- them -- this was never exploitable -- but it is not the explicit,
-- assertable "authenticated cannot even hold the privilege" posture
-- case_review_actions established and clinical_incident_reports (this same
-- pass) already followed correctly. Closing the inconsistency rather than
-- leaving two tables quietly relying on RLS alone.

revoke insert, update, delete on public.clinician_alert_sla_breach_notifications from authenticated;
revoke insert, update, delete on public.clinical_staff_indemnity_lapse_notifications from authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.clinician_alert_sla_breach_notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinician_alert_sla_breach_notifications', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinician_alert_sla_breach_notifications', 'DELETE') then
    raise exception 'FAIL: authenticated still holds a write privilege on clinician_alert_sla_breach_notifications';
  end if;

  if has_table_privilege('authenticated', 'public.clinical_staff_indemnity_lapse_notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_staff_indemnity_lapse_notifications', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_staff_indemnity_lapse_notifications', 'DELETE') then
    raise exception 'FAIL: authenticated still holds a write privilege on clinical_staff_indemnity_lapse_notifications';
  end if;

  if not has_table_privilege('authenticated', 'public.clinician_alert_sla_breach_notifications', 'SELECT') then
    raise exception 'FAIL: authenticated lost SELECT on clinician_alert_sla_breach_notifications';
  end if;
  if not has_table_privilege('authenticated', 'public.clinical_staff_indemnity_lapse_notifications', 'SELECT') then
    raise exception 'FAIL: authenticated lost SELECT on clinical_staff_indemnity_lapse_notifications';
  end if;

  raise notice 'PASS: both notification tables are select-only for authenticated, write access unaffected for the security-definer sweep functions that populate them';
end $$;
