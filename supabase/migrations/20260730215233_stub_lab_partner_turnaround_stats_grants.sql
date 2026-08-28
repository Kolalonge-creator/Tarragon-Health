-- Same reasoning and same guard shape as
-- 20260730215205_stub_lab_partner_own_provider_id_grants.sql: this function's
-- name matches the `lab\_partner\_%` pattern that
-- 20260729234618_harden_is_org_staff_exclude_lab_partner.sql (which runs
-- long before this file) audits for "exactly 3" functions, so a roles.sql
-- stub (which exists before every migration, including that audit) would
-- inflate that count and fail a real, correct assertion. Timestamped one
-- second before its real consumer, 20260730215234_lab_turnaround_sla_stats.sql,
-- so it doesn't exist yet when 20260729234618 counts, and already carries
-- correct final grants by the time that migration's own CREATE OR REPLACE
-- FUNCTION runs (which preserves ACL rather than resetting it).
--
-- Guarded to be a no-op on the live project, where this function already
-- has its real working body -- never overwrite that with this stub's dummy
-- one.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'lab_partner_turnaround_stats'
  ) then
    execute $create$
      create function public.lab_partner_turnaround_stats(p_days int default 90)
      returns table (
        orders_resulted bigint,
        avg_turnaround_hours numeric,
        median_turnaround_hours numeric,
        pct_over_72h numeric
      )
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        return;
      end;
      $body$;
    $create$;

    execute 'revoke all on function public.lab_partner_turnaround_stats(int) from public';
    execute 'revoke all on function public.lab_partner_turnaround_stats(int) from anon';
    execute 'grant execute on function public.lab_partner_turnaround_stats(int) to authenticated';
  end if;
end $$;
