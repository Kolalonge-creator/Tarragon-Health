-- SR2 hot-path query plans on SYNTHETIC data. Run ONLY against the local stack (never production):
--   psql "$DATABASE_URL" -v n=10000   -f scripts/sr2-query-plans.sql
--   psql "$DATABASE_URL" -v n=1000000 -f scripts/sr2-query-plans.sql
-- Everything is inside one transaction that ends in ROLLBACK, so nothing persists. Triggers and foreign keys are
-- bypassed for the load (session_replication_role = replica) because the point is the read plans, not the write path.
-- The shapes below are copied from the queries the functions and edge function actually run; the source is named
-- on each block. Recorded findings: docs/design/SR2-query-plans.md.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
set local statement_timeout = 0;

-- clinical_tasks: ~1% live (open / escalated / claimed / offered), the rest closed. Source: private.queue_candidates, sweep_clinical_tasks.
insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at,
                                   state, is_test, created_at, lead_window_ends_at, claimed_by, claimed_at, claim_expires_at, completed_at, outcome)
select '00000000-0000-0000-0000-0000000000a1', (array['red_event_unacknowledged','amber_bp_review','critical_result_review','titration_signoff'])[1 + g % 4],
       1, 1 + g % 4, 1 + g % 4, ('00000000-0000-0000-0000-' || lpad((g % 50000)::text, 12, '0'))::uuid, 'senior_medical_officer',
       now() + ((g % 2000) - 1000 || ' minutes')::interval,
       case when g % 100 = 0 then (array['open','escalated','offered_to_lead','claimed'])[1 + (g / 100) % 4]::clinical_task_state else 'completed'::clinical_task_state end,
       false, now() - (g || ' seconds')::interval,
       case when g % 4 <> 0 then now() + ((g % 60) - 30 || ' minutes')::interval end,
       '00000000-0000-0000-0000-0000000000c1'::uuid, now(), now() + interval '15 minutes', now(), '{}'::jsonb
from generate_series(1, :n) g;

-- task_claims: ~100 live, the rest ended. Source: public.queue_next, private.expire_task_claims.
insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, ended_at, end_reason)
select '00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), ('00000000-0000-0000-0000-' || lpad((g % 300)::text, 12, '0'))::uuid,
       now() + ((g % 30) - 15 || ' minutes')::interval, case when g > 100 then now() - (g || ' seconds')::interval end, case when g > 100 then 'completed' end
from generate_series(1, :n) g;

-- pages: roots, ~20 open and unacknowledged. Source: private.sweep_pages.
insert into public.pages (organisation_id, patient_id, triage_event_id, role, escalation_level, config_version, sent_at, closed_at, acknowledged_at, to_clinician_id, acknowledged_by)
select '00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), gen_random_uuid(), 'primary', 0, 1, now() - (g || ' seconds')::interval,
       case when g > 20 then now() end, case when g > 20 then now() end,
       '00000000-0000-0000-0000-0000000000c1'::uuid, case when g > 20 then '00000000-0000-0000-0000-0000000000c1'::uuid end
from generate_series(1, greatest(:n / 20, 100)) g;

-- notifications: ~200 pending, the rest sent. Source: supabase/functions/send-pending-notifications/index.ts (fetch of the next batch).
insert into public.notifications (recipient_id, organisation_id, channel, status, template, payload, attempts, created_at, sent_at)
select ('00000000-0000-0000-0000-' || lpad((g % 20000)::text, 12, '0'))::uuid, '00000000-0000-0000-0000-0000000000a1',
       (array['push','email','in_app'])[1 + g % 3]::notification_channel,
       case when g <= 200 then 'pending' else 'sent' end::notification_status, 'sr2_probe', '{}'::jsonb, 0,
       now() - ((g * 3) || ' seconds')::interval, now()
from generate_series(1, :n) g;

-- vitals_readings: ~50 per patient at 1M. Source: the patient timeline and chart summary reads.
insert into public.vitals_readings (organisation_id, patient_id, vital_type, taken_at)
select '00000000-0000-0000-0000-0000000000a1', ('00000000-0000-0000-0000-' || lpad((g % 20000)::text, 12, '0'))::uuid, 'weight', now() - (g || ' minutes')::interval
from generate_series(1, :n) g;

-- lab_orders: 98% resulted, a few open. Source: lab release and awaiting-result reads.
insert into public.lab_orders (organisation_id, patient_id, status, ordered_at)
select '00000000-0000-0000-0000-0000000000a1', ('00000000-0000-0000-0000-' || lpad((g % 20000)::text, 12, '0'))::uuid,
       case when g % 50 = 0 then 'processing' else 'resulted' end::lab_order_status, now() - (g || ' minutes')::interval
from generate_series(1, :n) g;

analyze public.clinical_tasks, public.task_claims, public.pages, public.notifications, public.vitals_readings, public.lab_orders;

\echo '##### rows' :n
\echo '##### Q1 next task: eligible pool ordered by priority then due (private.queue_candidates, ordered, limit 1)'
explain (analyze, buffers, costs off, summary on)
select ct.id from public.clinical_tasks ct
 where ct.organisation_id = '00000000-0000-0000-0000-0000000000a1' and ct.is_test = false and ct.state in ('open','escalated')
 order by ct.priority_class, ct.due_at limit 1;

\echo '##### Q2 sweep: overdue open or offered tasks, OLD form (before SR2d: due_at + make_interval(...) <= now())'
explain (analyze, buffers, costs off, summary on)
select id, organisation_id from public.clinical_tasks
 where state in ('offered_to_lead','open') and due_at + make_interval(mins => 0) <= now();

\echo '##### Q2b sweep: overdue open or offered tasks, NEW form (SR2d: due_at <= now() - make_interval(...))'
explain (analyze, buffers, costs off, summary on)
select id, organisation_id from public.clinical_tasks
 where state in ('offered_to_lead','open') and due_at <= now() - make_interval(mins => 0);

\echo '##### Q3 sweep: offer window ended (sweep_clinical_tasks)'
explain (analyze, buffers, costs off, summary on)
select id from public.clinical_tasks where state = 'offered_to_lead' and lead_window_ends_at <= now();

\echo '##### Q4 sweep: amber promotion (sweep_clinical_tasks)'
explain (analyze, buffers, costs off, summary on)
select id from public.clinical_tasks
 where type = 'amber_bp_review' and priority_class = 4 and priority_class_original = 4
   and state in ('offered_to_lead','open','claimed') and due_at <= now() + make_interval(mins => 240);

\echo '##### Q5 claim expiry: leases that ran out (expire_task_claims)'
explain (analyze, buffers, costs off, summary on)
select c.id from public.task_claims c where c.ended_at is null and c.expires_at <= now();

\echo '##### Q6 queue_next: how many live claims does this clinician hold'
explain (analyze, buffers, costs off, summary on)
select count(*) from public.task_claims where clinician_id = '00000000-0000-0000-0000-000000000007' and ended_at is null;

\echo '##### Q7 red page sweep: unacknowledged roots (sweep_pages, first loop)'
explain (analyze, buffers, costs off, summary on)
select * from public.pages
 where parent_page_id is null and role = 'primary' and acknowledged_at is null and closed_at is null
   and (backup_paged_at is null or lead_alerted_at is null)
 order by sent_at;

\echo '##### Q8 notification send: next batch of pending rows (send-pending-notifications)'
explain (analyze, buffers, costs off, summary on)
select id, recipient_id, organisation_id, channel, template, payload, attempts, priority from public.notifications
 where status = 'pending' and channel in ('sms','email','voice','push') and attempts < 5 and (send_after is null or send_after <= now())
 order by created_at asc limit 50;

\echo '##### Q9 timeline / chart: latest readings for one patient'
explain (analyze, buffers, costs off, summary on)
select * from public.vitals_readings where patient_id = '00000000-0000-0000-0000-000000000042' order by taken_at desc limit 50;

\echo '##### Q10 labs: one patient''s orders, newest first'
explain (analyze, buffers, costs off, summary on)
select * from public.lab_orders where patient_id = '00000000-0000-0000-0000-000000000042' order by ordered_at desc limit 20;

\echo '##### Q11 labs: orders awaiting a result (organisation scope)'
explain (analyze, buffers, costs off, summary on)
select id from public.lab_orders where organisation_id = '00000000-0000-0000-0000-0000000000a1' and status = 'processing' order by ordered_at limit 50;

rollback;
