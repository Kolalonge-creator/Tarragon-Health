-- ===========================================================================
-- The ops desk summary counts real work for real people only.
--
-- WHAT WAS WRONG (read live 2026-11-02; the admin console next to it reads analytics_clean and disagreed on every tile)
--   public.ops_today_summary() read public.* with no is_test and no organisation filter, and used loose predicates:
--   - patients 10 (4 real; 5 test accounts and the canary patient counted), active care programmes 9 (1 real),
--     active paid services 2 (both test purchases while the admin page says 0 paid services),
--   - critical alerts 1 and pending reviews 6 included the synthetic canary organisation's hourly emergency drill,
--   - laboratory delays 56: every one a self-arranged order the patient has not yet taken to a laboratory (never a delay),
--   - open incidents 769: status <> 'closed' counted 761 RESOLVED incidents; the true open count was 8,
--   - clinician verifications pending counted the canary test clinician.
--
-- FIX
--   Read through the analytics_clean views (WHERE NOT is_test, the same source the admin and analytics consoles use) or
--   analytics_clean.real_patient_ids where no clean view exists; count an incident as open only while it is open or
--   investigating; count a laboratory delay only for a partner-fulfilled order; exclude test clinicians.
--   Access rule, time window and every key name are unchanged, so the ops desk page needs no change.
--
-- Body redefined from the LIVE definition (pg_get_functiondef, 2026-11-02).
-- ===========================================================================

create or replace function public.ops_today_summary()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_today_end   timestamptz := v_today_start + interval '1 day';
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'generated_at', now(),

    -- Scale (real people only: analytics_clean excludes test accounts, and the canary organisation's people are all test accounts)
    'patients', (select count(*) from analytics_clean.profiles where role = 'patient' and is_active),
    'active_care_programmes', (
      select count(*) from public.chronic_programme_enrolments e
       where e.status = 'enrolled' and e.patient_id in (select patient_id from analytics_clean.real_patient_ids)
    ) + (
      select count(*) from analytics_clean.preventive_programme_enrolments where status = 'enrolled'
    ),
    'active_paid_services', (
      select count(*) from analytics_clean.service_purchases
      where status = 'active' and (expires_at is null or expires_at > now())
    ) + (
      select count(*) from analytics_clean.programme_purchases
      where status = 'active' and ends_at >= current_date
    ),

    -- Today
    'appointments_today', (
      select count(*) from analytics_clean.appointments
      where scheduled_for >= v_today_start and scheduled_for < v_today_end
        and status = 'scheduled'
    ),
    'consults_today', (
      select count(*) from public.video_consultations vc
      where vc.scheduled_at >= v_today_start and vc.scheduled_at < v_today_end
        and vc.status = 'scheduled'
        and vc.patient_id in (select patient_id from analytics_clean.real_patient_ids)
    ),

    -- Clinical work in hand
    'pending_clinical_reviews', (
      select count(*) from analytics_clean.clinician_alerts where status = 'open'
    ),
    'critical_alerts', (
      select count(*) from analytics_clean.clinician_alerts
      where status = 'open' and level = 'emergency'
    ),
    'alerts_past_sla', (
      select count(*) from analytics_clean.clinician_alerts
      where status = 'open' and sla_due_at is not null and sla_due_at < now()
    ),
    'open_escalations', (
      select count(*) from analytics_clean.escalations where status in ('open', 'under_review')
    ),

    -- Coordination
    'unresolved_referrals', (
      select count(*) from analytics_clean.specialist_referrals
      where status in ('pending', 'waitlisted', 'booked')
    ),
    -- A self-arranged order is in the patient's hands (they take the request to any laboratory); only a partner-fulfilled
    -- order can be late on Tarragon's side.
    'laboratory_delays', (
      select count(*) from analytics_clean.lab_orders
      where status in ('ordered', 'sample_collected', 'processing')
        and fulfilment is distinct from 'self_arranged'
        and ordered_at < now() - interval '3 days'
    ),
    'pharmacy_issues', (
      select count(*) from analytics_clean.pharmacy_orders
      where status in ('requested', 'confirmed', 'dispensed')
        and requested_at < now() - interval '2 days'
    ),
    'pending_bookings', (
      select count(*) from analytics_clean.booking_requests where status = 'requested'
    ),

    -- Money
    'failed_payments', (
      select count(*) from analytics_clean.payment_transactions
      where error is not null and created_at > now() - interval '30 days'
    ),
    'reconciliation_exceptions', (
      select count(*) from public.payment_reconciliation_flags where status = 'open'
    ),

    -- Governance: an incident is open while someone still has to act on it
    'open_incidents', (
      select count(*) from public.ops_incidents where status in ('open', 'investigating')
    ),
    'incidents_past_sla', (
      select count(*) from public.ops_incidents
      where status in ('open', 'investigating')
        and (
          (acknowledged_at is null and ack_due_at < now())
          or (resolved_at is null and resolve_due_at < now())
        )
    ),
    'clinician_verifications_pending', (
      select count(*) from analytics_clean.clinical_staff where license_verified_at is null
    )
  );
end;
$function$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ops_today_summary') ~ $q$status <> 'closed'$q$ then
    raise exception 'FAIL: ops_today_summary still counts resolved incidents as open';
  end if;
end $$;
