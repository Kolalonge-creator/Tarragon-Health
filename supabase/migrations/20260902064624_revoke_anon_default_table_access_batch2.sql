-- Same gap as 20260902064509_programme_purchases_revoke_anon.sql, found by
-- proactively auditing every migration with a `has_table_privilege('anon', ...)`
-- self-check assertion for a matching explicit `revoke ... from anon` on its
-- own table, rather than waiting for CI's fresh migration replay to surface
-- them one at a time. Six more tables asserted "anon must have no access" in
-- their own closing DO block but never actually revoked it:
--   - 20260830014708_20260830150800_care_message_templates.sql
--   - 20260830014723_20260830151000_care_message_attachments.sql
--   - 20260831140512_service_products_and_purchases_core.sql (service_products)
--   - 20260831163544_chronic_programme_schedule_tables.sql
--     (chronic_programme_schedule_occurrences)
--   - 20260831165033_chronic_programme_coordinator_tasks_and_sweep.sql
--     (chronic_programme_coordinator_tasks)
--   - 20260831165944_chronic_programme_pooled_booking_and_titration.sql
--     (medication_dose_history)
--
-- All pre-existing on main-dev, not introduced by PR #345. All confirmed
-- no-ops on the live project (koiplnmbgnqnbywhpjlf) via has_table_privilege
-- before this migration ran — anon already held nothing on any of the six —
-- so this only closes the gap for a from-scratch environment (a fresh
-- `supabase db reset`, a brand-new project), matching
-- 20260902064509_programme_purchases_revoke_anon.sql's reasoning.
revoke all on public.care_message_templates from anon;
revoke all on public.care_message_attachments from anon;
revoke all on public.service_products from anon;
revoke all on public.chronic_programme_schedule_occurrences from anon;
revoke all on public.chronic_programme_coordinator_tasks from anon;
revoke all on public.medication_dose_history from anon;

do $$
begin
  if has_table_privilege('anon', 'public.care_message_templates', 'SELECT')
     or has_table_privilege('anon', 'public.care_message_attachments', 'SELECT')
     or has_table_privilege('anon', 'public.service_products', 'SELECT')
     or has_table_privilege('anon', 'public.chronic_programme_schedule_occurrences', 'SELECT')
     or has_table_privilege('anon', 'public.chronic_programme_coordinator_tasks', 'SELECT')
     or has_table_privilege('anon', 'public.medication_dose_history', 'SELECT') then
    raise exception 'FAIL: anon must have no access to one of the batch2 tables';
  end if;
  raise notice 'PASS: anon has no access to any batch2 table';
end $$;
