-- Tarragon Health — Operations Control Centre read surface (Module 30.3, 30.8-30.14, 30.19)
--
-- The spec lists appointment operations, referral operations, laboratory
-- operations, pharmacy operations, alert operations, support operations and
-- financial operations as seven separate monitoring screens. Building seven
-- screens for a company that has one person doing operations would produce
-- seven tabs nobody opens; the failure mode is a delayed lab result sitting
-- unseen for a week because that day's operator was looking at the pharmacy
-- tab.
--
-- So the seven domains are modelled as ONE queue of exceptions with a domain
-- filter. Every domain contributes rows in the same shape — domain, severity,
-- what is wrong, how long it has been wrong, who it affects, where to go —
-- which means one screen, one triage habit, and one place to add the eighth
-- domain later. The per-domain views the spec asks for are then a filter on
-- that queue rather than seven separate builds.
--
-- Everything here is SECURITY DEFINER and gated on private.is_analyst()
-- (analyst + super admin) or the ops.console.view capability. The queue
-- carries operational metadata — order status, ages, counts, and a patient's
-- display name where an operator has to phone them — never clinical detail.
-- A red-flag alert appears as "urgent alert unacknowledged for 3h", never as
-- the reading behind it; that stays in the clinician surfaces where the
-- attribution and audit rules already apply.

-- ---------------------------------------------------------------------------
-- 1. Permission catalogue + gate
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('ops.console.view', 'View operations console', 'Operations', 'See the Tarragon Today board, the cross-domain exception queue and system health'),
  ('support.manage',   'Manage support inbox',    'Operations', 'Triage the patient support inbox and own support exceptions')
on conflict (key) do nothing;

create or replace function private.can_view_ops_console()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_analyst() or private.has_permission('ops.console.view');
$$;

-- ---------------------------------------------------------------------------
-- 2. TARRAGON TODAY — the home board.
--
--    Every number is a count of something a person can act on today, not a
--    vanity total. "Patients" is the exception and is kept because the spec
--    asks for it and because it is the denominator for everything else.
-- ---------------------------------------------------------------------------
create or replace function public.ops_today_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_today_end   timestamptz := v_today_start + interval '1 day';
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'generated_at', now(),

    -- Scale
    'patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'active_care_programmes', (
      select count(*) from public.chronic_programme_enrolments where status = 'enrolled'
    ) + (
      select count(*) from public.preventive_programme_enrolments where status = 'enrolled'
    ),
    'active_subscriptions', (
      select count(*) from public.subscriptions where status in ('active', 'trialing')
    ),

    -- Today
    'appointments_today', (
      select count(*) from public.appointments
      where scheduled_for >= v_today_start and scheduled_for < v_today_end
        and status = 'scheduled'
    ),
    'consults_today', (
      select count(*) from public.video_consultations
      where scheduled_at >= v_today_start and scheduled_at < v_today_end
        and status = 'scheduled'
    ),

    -- Clinical work in hand
    'pending_clinical_reviews', (
      select count(*) from public.clinician_alerts where status = 'open'
    ),
    'critical_alerts', (
      select count(*) from public.clinician_alerts
      where status = 'open' and level = 'emergency'
    ),
    'alerts_past_sla', (
      select count(*) from public.clinician_alerts
      where status = 'open' and sla_due_at is not null and sla_due_at < now()
    ),
    'open_escalations', (
      select count(*) from public.escalations where status in ('open', 'under_review')
    ),

    -- Coordination
    'unresolved_referrals', (
      select count(*) from public.specialist_referrals
      where status in ('pending', 'waitlisted', 'booked')
    ),
    'laboratory_delays', (
      -- An order that has been sitting un-resulted longer than three days.
      select count(*) from public.lab_orders
      where status in ('ordered', 'sample_collected', 'processing')
        and ordered_at < now() - interval '3 days'
    ),
    'pharmacy_issues', (
      select count(*) from public.pharmacy_orders
      where status in ('requested', 'confirmed', 'dispensed', 'out_for_delivery')
        and requested_at < now() - interval '2 days'
    ),
    'pending_bookings', (
      select count(*) from public.booking_requests where status = 'requested'
    ),

    -- Support
    'support_unread', (
      select count(*) from public.support_messages
      where direction = 'inbound' and status = 'unread'
    ),

    -- Money
    'failed_payments', (
      select count(*) from public.payment_transactions
      where error is not null and created_at > now() - interval '30 days'
    ),
    'reconciliation_exceptions', (
      select count(*) from public.payment_reconciliation_flags where status = 'open'
    ),

    -- Governance
    'open_incidents', (
      select count(*) from public.ops_incidents where status <> 'closed'
    ),
    'incidents_past_sla', (
      select count(*) from public.ops_incidents
      where status <> 'closed'
        and (
          (acknowledged_at is null and ack_due_at < now())
          or (resolved_at is null and resolve_due_at < now())
        )
    ),
    'clinician_verifications_pending', (
      select count(*) from public.clinical_staff where license_verified_at is null
    )
  );
end;
$$;

comment on function public.ops_today_summary() is
  'Module 30.3 — the Tarragon Today board. Counts of actionable work only; no patient-identifying data.';

-- ---------------------------------------------------------------------------
-- 3. THE UNIFIED EXCEPTION QUEUE (Modules 30.8-30.14 in one surface)
--
--    Severity is derived from how far past its own domain's tolerance the item
--    already is, so a 6-hour-old emergency alert outranks a 5-day-old pharmacy
--    delay without an operator having to know either threshold.
-- ---------------------------------------------------------------------------
create or replace function public.ops_exception_queue(
  p_domain text default null,
  p_limit  integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not private.can_view_ops_console() then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.severity_rank, q.age_hours desc)
    from (
      select * from (
        -- ---------------------------------------------------------------
        -- ALERTS (30.12) — unacknowledged clinical alerts, worst first.
        -- ---------------------------------------------------------------
        select
          'alerts'::text                                        as domain,
          a.id                                                  as entity_id,
          'clinician_alert'::text                               as entity_type,
          case
            when a.level = 'emergency' then 'critical'
            when a.sla_due_at is not null and a.sla_due_at < now() then 'urgent'
            when a.level = 'urgent_escalation' then 'urgent'
            else 'high'
          end                                                   as severity,
          case
            when a.level = 'emergency' then 1
            when a.sla_due_at is not null and a.sla_due_at < now() then 2
            when a.level = 'urgent_escalation' then 2
            else 3
          end                                                   as severity_rank,
          a.title                                               as headline,
          case
            when a.sla_due_at is not null and a.sla_due_at < now()
              then 'Past its contact SLA and still unacknowledged.'
            else 'Awaiting clinician acknowledgement.'
          end                                                   as detail,
          p.full_name                                           as subject_name,
          a.patient_id                                          as subject_id,
          a.created_at                                          as opened_at,
          round(extract(epoch from (now() - a.created_at)) / 3600.0, 1) as age_hours,
          a.sla_due_at                                          as due_at,
          '/clinician'::text                             as href
        from public.clinician_alerts a
        left join public.profiles p on p.id = a.patient_id
        where a.status = 'open'
          and (a.level <> 'routine' or a.created_at < now() - interval '24 hours')

        union all

        -- ---------------------------------------------------------------
        -- APPOINTMENTS (30.8) — booking requests nobody has answered, and
        -- scheduled appointments whose time has passed with no outcome
        -- recorded (the no-show / never-happened gap).
        -- ---------------------------------------------------------------
        select
          'appointments', b.id, 'booking_request',
          case when b.created_at < now() - interval '48 hours' then 'urgent' else 'high' end,
          case when b.created_at < now() - interval '48 hours' then 2 else 3 end,
          'Booking request unanswered',
          'Requested ' || b.service_type || ' for ' || to_char(b.requested_date, 'DD Mon') || '.',
          p.full_name, b.profile_id, b.created_at,
          round(extract(epoch from (now() - b.created_at)) / 3600.0, 1),
          b.created_at + interval '24 hours',
          '/admin/bookings'
        from public.booking_requests b
        left join public.profiles p on p.id = b.profile_id
        where b.status = 'requested'
          and b.created_at < now() - interval '12 hours'

        union all

        select
          'appointments', ap.id, 'appointment',
          'high', 3,
          'Appointment outcome not recorded',
          'Scheduled time has passed and it is still marked scheduled — complete it or mark the no-show.',
          p.full_name, ap.patient_id, ap.scheduled_for,
          round(extract(epoch from (now() - ap.scheduled_for)) / 3600.0, 1),
          ap.scheduled_for + interval '24 hours',
          '/clinician/appointments'
        from public.appointments ap
        left join public.profiles p on p.id = ap.patient_id
        where ap.status = 'scheduled'
          and ap.scheduled_for < now() - interval '12 hours'

        union all

        -- ---------------------------------------------------------------
        -- REFERRALS (30.9) — raised but never booked, or booked with the
        -- appointment date behind us and no completion.
        -- ---------------------------------------------------------------
        select
          'referrals', r.id, 'specialist_referral',
          case when r.created_at < now() - interval '7 days' then 'urgent' else 'high' end,
          case when r.created_at < now() - interval '7 days' then 2 else 3 end,
          'Referral awaiting booking',
          r.specialist_type::text || ' referral has had no booking confirmed.',
          p.full_name, r.patient_id, r.created_at,
          round(extract(epoch from (now() - r.created_at)) / 3600.0, 1),
          r.created_at + interval '72 hours',
          '/clinician/referrals'
        from public.specialist_referrals r
        left join public.profiles p on p.id = r.patient_id
        where r.status = 'pending'
          and r.created_at < now() - interval '48 hours'

        union all

        select
          'referrals', r.id, 'specialist_referral',
          'high', 3,
          'Specialist report overdue',
          'The appointment date has passed and the referral has not been completed.',
          p.full_name, r.patient_id, r.appointment_date,
          round(extract(epoch from (now() - r.appointment_date)) / 3600.0, 1),
          r.appointment_date + interval '7 days',
          '/clinician/referrals'
        from public.specialist_referrals r
        left join public.profiles p on p.id = r.patient_id
        where r.status in ('booked', 'confirmed')
          and r.appointment_date is not null
          and r.appointment_date < now() - interval '7 days'

        union all

        -- ---------------------------------------------------------------
        -- LABORATORY (30.10) — orders stuck before a result.
        -- ---------------------------------------------------------------
        select
          'laboratory', lo.id, 'lab_order',
          case when lo.ordered_at < now() - interval '7 days' then 'urgent' else 'high' end,
          case when lo.ordered_at < now() - interval '7 days' then 2 else 3 end,
          case lo.status
            when 'ordered' then 'Sample not collected'
            when 'sample_collected' then 'Sample collected, no result'
            else 'Result delayed'
          end,
          'Lab order has been open since ' || to_char(lo.ordered_at at time zone 'Africa/Lagos', 'DD Mon') || '.',
          p.full_name, lo.patient_id, lo.ordered_at,
          round(extract(epoch from (now() - lo.ordered_at)) / 3600.0, 1),
          lo.ordered_at + interval '72 hours',
          '/clinician/orders'
        from public.lab_orders lo
        left join public.profiles p on p.id = lo.patient_id
        where lo.status in ('ordered', 'sample_collected', 'processing')
          and lo.ordered_at < now() - interval '3 days'

        union all

        -- ---------------------------------------------------------------
        -- PHARMACY (30.11) — orders that have not reached the patient.
        -- ---------------------------------------------------------------
        select
          'pharmacy', po.id, 'pharmacy_order',
          case when po.requested_at < now() - interval '5 days' then 'urgent' else 'high' end,
          case when po.requested_at < now() - interval '5 days' then 2 else 3 end,
          case po.status
            when 'requested' then 'Prescription not confirmed by pharmacy'
            when 'confirmed' then 'Confirmed but not dispensed'
            when 'dispensed' then 'Dispensed but not delivered'
            else 'Delivery in progress too long'
          end,
          'Medication order has not reached the patient.',
          p.full_name, po.patient_id, po.requested_at,
          round(extract(epoch from (now() - po.requested_at)) / 3600.0, 1),
          po.requested_at + interval '48 hours',
          '/admin/settings/partners/pharmacies'
        from public.pharmacy_orders po
        left join public.profiles p on p.id = po.patient_id
        where po.status in ('requested', 'confirmed', 'dispensed', 'out_for_delivery')
          and po.requested_at < now() - interval '2 days'

        union all

        -- ---------------------------------------------------------------
        -- SUPPORT (30.13) — an inbound message nobody has read.
        -- ---------------------------------------------------------------
        select
          'support', sm.id, 'support_message',
          case when sm.created_at < now() - interval '24 hours' then 'urgent' else 'high' end,
          case when sm.created_at < now() - interval '24 hours' then 2 else 3 end,
          'Unread patient message',
          'A patient wrote in and has had no reply.',
          p.full_name, sm.patient_id, sm.created_at,
          round(extract(epoch from (now() - sm.created_at)) / 3600.0, 1),
          sm.created_at + interval '4 hours',
          '/clinician/support-inbox'
        from public.support_messages sm
        left join public.profiles p on p.id = sm.patient_id
        where sm.direction = 'inbound'
          and sm.status = 'unread'
          and sm.created_at < now() - interval '4 hours'

        union all

        -- ---------------------------------------------------------------
        -- PAYMENTS (30.14) — reconciliation exceptions and webhook errors.
        -- ---------------------------------------------------------------
        select
          'payments', f.id, 'payment_reconciliation_flag',
          case when f.flag_type = 'amount_mismatch' then 'urgent' else 'high' end,
          case when f.flag_type = 'amount_mismatch' then 2 else 3 end,
          'Reconciliation exception: ' || replace(f.flag_type, '_', ' '),
          'Provider reference ' || f.provider_reference || ' does not match our ledger.',
          null, null, f.detected_at,
          round(extract(epoch from (now() - f.detected_at)) / 3600.0, 1),
          f.detected_at + interval '72 hours',
          '/finance/reconciliation'
        from public.payment_reconciliation_flags f
        where f.status = 'open'

        union all

        select
          'payments', pt.id, 'payment_transaction',
          'high', 3,
          'Payment webhook failed',
          'Paystack/Stripe event could not be processed: ' || left(pt.error, 120),
          null, null, pt.created_at,
          round(extract(epoch from (now() - pt.created_at)) / 3600.0, 1),
          pt.created_at + interval '24 hours',
          '/finance'
        from public.payment_transactions pt
        where pt.error is not null
          and pt.processed_at is null
          and pt.created_at > now() - interval '30 days'

        union all

        -- ---------------------------------------------------------------
        -- INCIDENTS (30.18) — anything past its own SLA.
        -- ---------------------------------------------------------------
        select
          'incidents', i.id, 'ops_incident',
          case when i.severity = 'sev1' then 'critical' else 'urgent' end,
          case when i.severity = 'sev1' then 1 else 2 end,
          i.reference || ' — ' || i.title,
          case
            when i.acknowledged_at is null then 'Not acknowledged and past its acknowledgement SLA.'
            else 'Past its resolution SLA.'
          end,
          null, null, i.detected_at,
          round(extract(epoch from (now() - i.detected_at)) / 3600.0, 1),
          case when i.acknowledged_at is null then i.ack_due_at else i.resolve_due_at end,
          '/admin/ops/incidents/' || i.id::text
        from public.ops_incidents i
        where i.status <> 'closed'
          and (
            (i.acknowledged_at is null and i.ack_due_at < now())
            or (i.resolved_at is null and i.resolve_due_at < now())
          )

        union all

        -- ---------------------------------------------------------------
        -- PROVIDERS (30.5) — clinical staff who can be routed work but whose
        -- licence has never been verified. A governance exception, and one
        -- that belongs on the same queue as everything else precisely
        -- because it is nobody's daily habit to go looking for it.
        -- ---------------------------------------------------------------
        select
          'providers', cs.id, 'clinical_staff',
          'urgent', 2,
          'Clinical staff licence unverified',
          'This staff record is active but has never had its licence verified.',
          pr.full_name, cs.profile_id, cs.created_at,
          round(extract(epoch from (now() - cs.created_at)) / 3600.0, 1),
          cs.created_at + interval '7 days',
          '/admin/settings/clinical-staff'
        from public.clinical_staff cs
        left join public.profiles pr on pr.id = cs.profile_id
        where cs.active
          and cs.license_verified_at is null
      ) src
      where p_domain is null or p_domain = 'all' or src.domain = p_domain
      order by src.severity_rank, src.age_hours desc
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$$;

comment on function public.ops_exception_queue(text, integer) is
  'Modules 30.8-30.14 as ONE queue. Every operational domain contributes rows in the same shape so a small team triages one list rather than seven dashboards. Operational metadata only — no clinical values.';

-- Counts per domain, so the console can render filter chips without pulling
-- the whole queue and counting client-side.
create or replace function public.ops_exception_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  v_rows := public.ops_exception_queue(null::text, 500);

  return jsonb_build_object(
    'total', jsonb_array_length(v_rows),
    'by_domain', coalesce((
      select jsonb_object_agg(domain, n)
      from (
        select e ->> 'domain' as domain, count(*) n
        from jsonb_array_elements(v_rows) e
        group by e ->> 'domain'
      ) t
    ), '{}'::jsonb),
    'by_severity', coalesce((
      select jsonb_object_agg(severity, n)
      from (
        select e ->> 'severity' as severity, count(*) n
        from jsonb_array_elements(v_rows) e
        group by e ->> 'severity'
      ) t
    ), '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. SYSTEM HEALTH (30.19)
--
--    Derived from what the database can actually observe about itself —
--    notification delivery, payment webhook processing, integration
--    configuration, background sweeps — rather than a table of statuses
--    somebody would have to remember to update. A status board that needs
--    manual upkeep is green on the day it matters.
-- ---------------------------------------------------------------------------
create or replace function public.ops_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_notif_total   bigint;
  v_notif_failed  bigint;
  v_notif_pending bigint;
  v_pay_total     bigint;
  v_pay_failed    bigint;
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  select count(*) filter (where created_at > now() - interval '24 hours'),
         count(*) filter (where created_at > now() - interval '24 hours' and status = 'failed'),
         count(*) filter (where status = 'pending' and created_at < now() - interval '1 hour')
    into v_notif_total, v_notif_failed, v_notif_pending
  from public.notifications;

  select count(*) filter (where created_at > now() - interval '24 hours'),
         count(*) filter (where created_at > now() - interval '24 hours' and error is not null)
    into v_pay_total, v_pay_failed
  from public.payment_transactions;

  return jsonb_build_object(
    'generated_at', now(),
    'components', jsonb_build_array(
      jsonb_build_object(
        'key', 'database',
        'label', 'Database',
        -- If this function returned at all, Postgres answered.
        'status', 'operational',
        'detail', 'Responding to queries.',
        'metric', null
      ),
      jsonb_build_object(
        'key', 'notifications',
        'label', 'Notification delivery',
        'status', case
          when v_notif_pending > 50 then 'down'
          when v_notif_total > 0 and v_notif_failed::numeric / v_notif_total > 0.2 then 'degraded'
          when v_notif_pending > 0 then 'degraded'
          else 'operational'
        end,
        'detail', case
          when v_notif_pending > 0
            then v_notif_pending || ' notification(s) stuck pending for over an hour — the send-pending-notifications function may be stale or failing.'
          when v_notif_failed > 0
            then v_notif_failed || ' of ' || v_notif_total || ' sends failed in the last 24 hours.'
          else 'All sends in the last 24 hours were accepted.'
        end,
        'metric', jsonb_build_object('sent_24h', v_notif_total, 'failed_24h', v_notif_failed, 'stuck_pending', v_notif_pending)
      ),
      jsonb_build_object(
        'key', 'payments',
        'label', 'Payment gateway',
        'status', case
          when v_pay_total > 0 and v_pay_failed::numeric / v_pay_total > 0.1 then 'degraded'
          when exists (select 1 from public.payment_reconciliation_flags where status = 'open') then 'degraded'
          else 'operational'
        end,
        'detail', case
          when v_pay_failed > 0 then v_pay_failed || ' webhook event(s) errored in the last 24 hours.'
          when exists (select 1 from public.payment_reconciliation_flags where status = 'open')
            then 'Open reconciliation exceptions are waiting on finance.'
          else 'Webhooks processing normally.'
        end,
        'metric', jsonb_build_object('events_24h', v_pay_total, 'errored_24h', v_pay_failed)
      ),
      jsonb_build_object(
        'key', 'integrations',
        'label', 'Partner integrations',
        -- partner_integrations records the outcome of its own reachability
        -- check (last_checked_at / last_check_ok). A failed check is degraded;
        -- an active integration that has NEVER been checked is also degraded,
        -- because an unverified credential is indistinguishable from a broken
        -- one until the day a patient's order depends on it.
        'status', case
          when exists (
            select 1 from public.partner_integrations
            where is_active and last_check_ok is false
          ) then 'degraded'
          when exists (
            select 1 from public.partner_integrations
            where is_active and last_checked_at is null
          ) then 'degraded'
          else 'operational'
        end,
        'detail', case
          when exists (select 1 from public.partner_integrations where is_active and last_check_ok is false)
            then (select count(*)::text from public.partner_integrations where is_active and last_check_ok is false)
                 || ' active integration(s) failed their last connection check.'
          when exists (select 1 from public.partner_integrations where is_active and last_checked_at is null)
            then (select count(*)::text from public.partner_integrations where is_active and last_checked_at is null)
                 || ' active integration(s) have never been connection-checked.'
          when exists (select 1 from public.partner_integrations where is_active)
            then 'All active integrations passed their last connection check.'
          else 'No partner integrations configured yet.'
        end,
        'metric', jsonb_build_object(
          'active', (select count(*) from public.partner_integrations where is_active),
          'failing', (select count(*) from public.partner_integrations where is_active and last_check_ok is false),
          'unchecked', (select count(*) from public.partner_integrations where is_active and last_checked_at is null)
        )
      ),
      jsonb_build_object(
        'key', 'alerts',
        'label', 'Clinical alert pipeline',
        'status', case
          when exists (
            select 1 from public.clinician_alerts
            where status = 'open' and level = 'emergency'
              and created_at < now() - interval '1 hour'
          ) then 'down'
          when exists (
            select 1 from public.clinician_alerts
            where status = 'open' and sla_due_at is not null and sla_due_at < now()
          ) then 'degraded'
          else 'operational'
        end,
        'detail', case
          when exists (
            select 1 from public.clinician_alerts
            where status = 'open' and level = 'emergency' and created_at < now() - interval '1 hour'
          ) then 'An emergency alert has been unacknowledged for over an hour.'
          else 'Alerts are being acknowledged within their SLA.'
        end,
        'metric', jsonb_build_object(
          'open', (select count(*) from public.clinician_alerts where status = 'open'),
          'past_sla', (select count(*) from public.clinician_alerts where status = 'open' and sla_due_at is not null and sla_due_at < now())
        )
      )
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants. anon inherits EXECUTE through PUBLIC — revoke FROM PUBLIC.
-- ---------------------------------------------------------------------------
revoke execute on function public.ops_today_summary() from public, anon;
revoke execute on function public.ops_exception_queue(text, integer) from public, anon;
revoke execute on function public.ops_exception_counts() from public, anon;
revoke execute on function public.ops_system_health() from public, anon;

grant execute on function public.ops_today_summary() to authenticated;
grant execute on function public.ops_exception_queue(text, integer) to authenticated;
grant execute on function public.ops_exception_counts() to authenticated;
grant execute on function public.ops_system_health() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ops_exception_queue(text, integer)', 'EXECUTE') then
    raise exception 'anon can still execute ops_exception_queue — the revoke did not take';
  end if;
  if not has_function_privilege('authenticated', 'public.ops_today_summary()', 'EXECUTE') then
    raise exception 'authenticated cannot execute ops_today_summary';
  end if;
end;
$$;
