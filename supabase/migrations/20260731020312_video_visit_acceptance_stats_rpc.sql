-- Tarragon Health
-- Patient-experience review 2026-07-31: video visits are pay-first, then a
-- doctor accepts or declines within 48h -- a deliberate founder decision
-- (2026-07-23), kept as-is here. The gap this closes is purely informational:
-- before paying, a patient has zero signal about how likely/fast acceptance
-- typically is. This RPC exposes a small, honest, org-scoped rolling-30-day
-- aggregate (acceptance rate + median time-from-request-to-accept) with
-- small-cell suppression (same posture as organisations.min_cohort_size
-- elsewhere in this codebase) -- degrades to "not enough data" under 5
-- terminal outcomes rather than showing a misleadingly precise stat off a
-- tiny sample.
--
-- Only 'accepted'/'declined'/'expired' count as terminal, doctor-reviewed
-- outcomes -- 'requested'/'pending_payment'/'payment_confirmed' are still
-- in flight, 'cancelled' is patient-initiated (not a doctor decision), and
-- the newer 'alternate_proposed'/'refunded' states (added by a concurrent
-- session's alternate-time-proposal feature, 2026-07-31) are deliberately
-- left out of the denominator until their final resolution semantics are
-- settled -- this stat only speaks to the well-understood three-way
-- accept/decline/expire outcome.
--
-- Verified live (rolled-back transaction, real patient/org, status/
-- created_at/accepted_at set via UPDATE since the request table's own
-- insert-time triggers correctly reject a client-supplied initial status):
-- 0 samples -> suppressed; 3 samples -> still suppressed (below the 5
-- floor); 7 terminal (5 accepted at 30/90min, 2 declined) -> 71% acceptance,
-- 30-minute median, both correct; adding non-terminal rows (payment_
-- confirmed/alternate_proposed/cancelled) and an out-of-window 40-day-old
-- row left the sample_size/rate/median all unchanged, as designed.
create or replace function public.video_visit_acceptance_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_total int;
  v_accepted int;
  v_median_minutes numeric;
begin
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  if v_org is null then
    return jsonb_build_object('suppressed', true);
  end if;

  select count(*), count(*) filter (where status = 'accepted')
    into v_total, v_accepted
  from public.video_visit_requests
  where organisation_id = v_org
    and status in ('accepted', 'declined', 'expired')
    and created_at > now() - interval '30 days';

  if v_total < 5 then
    return jsonb_build_object('suppressed', true, 'sample_size', v_total);
  end if;

  select percentile_cont(0.5) within group (
    order by extract(epoch from (accepted_at - created_at)) / 60
  )
  into v_median_minutes
  from public.video_visit_requests
  where organisation_id = v_org
    and status = 'accepted'
    and created_at > now() - interval '30 days';

  return jsonb_build_object(
    'suppressed', false,
    'sample_size', v_total,
    'accepted_count', v_accepted,
    'acceptance_rate_pct', round((v_accepted::numeric / v_total) * 100),
    'median_minutes_to_accept', round(coalesce(v_median_minutes, 0))
  );
end;
$$;

revoke execute on function public.video_visit_acceptance_stats() from public;
revoke execute on function public.video_visit_acceptance_stats() from anon;
grant execute on function public.video_visit_acceptance_stats() to authenticated;
