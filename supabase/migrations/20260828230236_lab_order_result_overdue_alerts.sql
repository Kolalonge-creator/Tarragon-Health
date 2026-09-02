-- Tarragon Health — Laboratory Engine, 14.14 (delayed result), the missing
-- half.
--
-- 20260828015618_alert_generators_previously_uncovered_types.sql added
-- private.raise_laboratory_failure_alerts(): a lab_orders row stuck in
-- 'ordered' 5+ days with no sample collected. That covers PRE-collection
-- stalling. patient_care_gaps.awaiting_result (20260803125639) separately
-- nudges the PATIENT when a self-arranged order sits at 'ordered' 21+ days
-- with nothing uploaded. Neither covers spec §14.14's actual "Expected
-- result date -> No result -> Laboratory follow-up -> Operational
-- escalation" case: a sample that HAS been collected (sample_collected /
-- processing) and never reaches resulted. That gap is closed here, now that
-- sample_collected_at (previous migration) gives a real anchor to measure
-- from.
--
-- Reuses the existing 'laboratory_failure' type_code rather than adding an
-- 17th value to the governed 16-value alert_type_code taxonomy — see the
-- previous migration's header for why that list is closed, not extended
-- casually. 72 hours is not a new number invented for this: it is the same
-- "slow" threshold lab_partner_turnaround_stats.pct_over_72h already uses
-- to flag a partner as running behind, applied here to a single order
-- instead of an aggregate.

create or replace function private.raise_lab_result_overdue_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    lo.organisation_id, lo.patient_id, 'clinician_review',
    'Lab result overdue',
    format(
      'Lab order %s (%s) has had its sample collected since %s with no result recorded — over 72 hours ago.',
      coalesce(lo.order_number, lo.id::text),
      coalesce(pb.name, 'lab test'),
      to_char(lo.sample_collected_at, 'YYYY-MM-DD HH24:MI')
    ),
    'operational', 'laboratory_failure'
  )
  from public.lab_orders lo
  left join public.panel_bundles pb on pb.id = lo.panel_bundle_id
  where lo.status in ('sample_collected', 'processing')
    and lo.sample_collected_at is not null
    and lo.sample_collected_at < now() - interval '72 hours'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'laboratory_failure' and ca.patient_id = lo.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function private.raise_lab_result_overdue_alerts() is
  'Daily sweep: a lab_orders row collected 72h+ ago that never reached resulted raises a clinician_review clinician_alerts row (8.1 laboratory_failure) — the post-collection half of §14.14''s delayed-result flow; the pre-collection half is private.raise_laboratory_failure_alerts (20260828015618).';

revoke all on function private.raise_lab_result_overdue_alerts() from public, anon;

select cron.schedule('lab-result-overdue-alerts', '45 3 * * *', $$select private.raise_lab_result_overdue_alerts()$$);
