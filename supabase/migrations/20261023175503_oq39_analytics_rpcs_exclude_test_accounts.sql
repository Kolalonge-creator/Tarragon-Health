-- OQ-39 / INV-13: the analytics_* RPCs ignore is_test. This migration makes test accounts invisible to them.
--
-- DESIGN (docs/design/OQ39-analytics-is-test.md). One central predicate instead of 50 edited bodies: a new schema
-- analytics_clean holds one security_invoker view per patient-bearing relation the RPCs read, each filtering test
-- accounts with the S02 convention (profiles.is_test, via NOT EXISTS so a NULL patient/actor, e.g. an anonymous page
-- view or a system audit row, is kept). Every non-exempt RPC body is then re-created from its LIVE definition with
-- public.<t> / private.<t> text-replaced by analytics_clean.<t>. Signature, return type, volatility, SECURITY DEFINER,
-- search_path = '' and grants are unchanged (CREATE OR REPLACE keeps the ACL; the grants are restated below anyway).
--
-- Counted first (live, 2026-10-23): 56 analytics_* functions in public, all SECURITY DEFINER with search_path = '', ACL
-- (postgres, authenticated, service_role) (anon none; read from proacl). 6 profiles carry is_test = true.
-- Three functions have no caller on main-dev (analytics_clinical_rule_performance, analytics_health_economics,
-- analytics_population_dataset_preview). Only analytics_clinical_rule_performance is retired below: it has no caller
-- on any branch either, and no cron job, view, policy or function body names it. The other two are called from apps code
-- on the unmerged branch origin/worktree-population-health-intelligence-gaps, so they are kept and filtered.
--
-- Also re-created because they feed an analytics_* RPC: private.refresh_analytics_snapshot_business_summary() (the
-- nightly snapshot analytics_business_summary reads; it is refreshed at the end of this migration) and
-- public.get_geo_health_aggregates() (read by analytics_population_dataset_preview).
--
-- EXEMPT, unchanged on purpose (record lookups and writers, not metrics): analytics_patient_search,
-- analytics_patient_activity, analytics_audit_log, analytics_log_patient_access, analytics_upsert_finance_input,
-- analytics_upsert_risk. Support and audit need to find a test account's own rows.
--
-- MAINTENANCE: a view freezes its column list. A column added later to one of these tables is not visible to the
-- RPCs until the view is re-created, and dropping a column the view selects fails loudly. That is intended.
-- A new analytics_* function is forced through the filter by packages/db/tests/oq39_analytics_exclude_test_data.sql.

create schema if not exists analytics_clean;
revoke all on schema analytics_clean from public, anon, authenticated;
comment on schema analytics_clean is 'OQ-39 / INV-13: test-account-free views for the analytics_* RPCs. Not exposed: no role but the owner has USAGE.';


-- One source of truth for the views: this catalogue (view name, the relation it is a filtered copy of, the full select).
-- private.rebuild_analytics_clean_views() regenerates every view from it, so a column added, dropped or retyped on a base table
-- is a one-line fix in the migration that changes the table. Owner only: closed to every API role.
create table if not exists private.analytics_clean_view_sources (
  view_name   text primary key,
  source_rel  text,          -- the relation the view filters (null when it filters a function result)
  definition  text not null  -- the select that defines the view, predicate included
);
revoke all on table private.analytics_clean_view_sources from public, anon, authenticated, service_role;
alter table private.analytics_clean_view_sources enable row level security;   -- no policy: nobody but the owner reads it (S39 catalogue wants RLS on every table)
comment on table private.analytics_clean_view_sources is 'OQ-39: source and predicate of every analytics_clean view. Edit here, then call private.rebuild_analytics_clean_views().';

create or replace function private.rebuild_analytics_clean_views()
returns int language plpgsql set search_path = '' as $f$
declare r record; n int := 0;
begin
  for r in select view_name, definition from private.analytics_clean_view_sources order by view_name loop
    execute format('create or replace view analytics_clean.%I with (security_invoker = true) as %s', r.view_name, r.definition);
    n := n + 1;
  end loop;
  -- a view that cannot be replaced in place (a base column was dropped or retyped) needs
  -- private.drop_analytics_clean_views() first, in the same migration, before the ALTER TABLE
  execute 'revoke all on all tables in schema analytics_clean from public, anon, authenticated';
  return n;
end $f$;
comment on function private.rebuild_analytics_clean_views() is 'OQ-39: (re)creates every analytics_clean view from private.analytics_clean_view_sources. Idempotent. Picks up columns ADDED to a base table. After DROP COLUMN or ALTER COLUMN TYPE call private.drop_analytics_clean_views() before the ALTER and this function after it.';

create or replace function private.drop_analytics_clean_views()
returns int language plpgsql set search_path = '' as $f$
declare r record; n int := 0;
begin
  for r in select view_name from private.analytics_clean_view_sources order by view_name loop
    execute format('drop view if exists analytics_clean.%I', r.view_name); n := n + 1;
  end loop;
  return n;
end $f$;
comment on function private.drop_analytics_clean_views() is 'OQ-39: drops every analytics_clean view so a base column can be dropped or retyped; always followed by private.rebuild_analytics_clean_views() in the same migration.';
revoke all on function private.rebuild_analytics_clean_views() from public, anon, authenticated, service_role;
revoke all on function private.drop_analytics_clean_views() from public, anon, authenticated, service_role;


insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('ai_conversations', 'public.ai_conversations', $def$
  select t.* from public.ai_conversations t where not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('appointment_waiting_list', 'public.appointment_waiting_list', $def$
  select t.* from public.appointment_waiting_list t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('appointments', 'public.appointments', $def$
  select t.* from public.appointments t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('booking_requests', 'public.booking_requests', $def$
  select t.* from public.booking_requests t where not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('care_engagement_scores', 'public.care_engagement_scores', $def$
  select t.* from public.care_engagement_scores t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('care_messages', 'public.care_messages', $def$
  select t.* from public.care_messages t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('care_plan_status_history', 'public.care_plan_status_history', $def$
  select t.* from public.care_plan_status_history t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('care_plans', 'public.care_plans', $def$
  select t.* from public.care_plans t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('care_team_assignment', 'public.care_team_assignment', $def$
  select t.* from public.care_team_assignment t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('clinical_incident_reports', 'public.clinical_incident_reports', $def$
  select t.* from public.clinical_incident_reports t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('clinical_staff', 'public.clinical_staff', $def$
  select t.* from public.clinical_staff t where not t.is_test and not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('clinician_alerts', 'public.clinician_alerts', $def$
  select t.* from public.clinician_alerts t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('commissions', 'public.commissions', $def$
  select t.* from public.commissions t where (t.commission_type is null or t.source_id is null or case t.commission_type::text when 'service_purchase' then not exists (select 1 from public.service_purchases s join public.profiles tp on tp.id = s.patient_id where s.id = t.source_id and tp.is_test) when 'lab' then not exists (select 1 from public.lab_orders s join public.profiles tp on tp.id = s.patient_id where s.id = t.source_id and tp.is_test) when 'pharmacy' then not exists (select 1 from public.pharmacy_orders s join public.profiles tp on tp.id = s.patient_id where s.id = t.source_id and tp.is_test) when 'referral' then not exists (select 1 from public.specialist_referrals s join public.profiles tp on tp.id = s.patient_id where s.id = t.source_id and tp.is_test) when 'home_visit' then true when 'delivery' then true else false end)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('complaints', 'public.complaints', $def$
  select t.* from public.complaints t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = t.created_by and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('escalations', 'public.escalations', $def$
  select t.* from public.escalations t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('facilities', 'public.facilities', $def$
  select t.* from public.facilities t where not t.is_test$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('identity_verifications', 'public.identity_verifications', $def$
  select t.* from public.identity_verifications t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('lab_orders', 'public.lab_orders', $def$
  select t.* from public.lab_orders t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('lpe_enrollments', 'public.lpe_enrollments', $def$
  select t.* from public.lpe_enrollments t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('medication_reviews', 'public.medication_reviews', $def$
  select t.* from public.medication_reviews t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('medications', 'public.medications', $def$
  select t.* from public.medications t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('notifications', 'public.notifications', $def$
  select t.* from public.notifications t where not exists (select 1 from public.profiles tp where tp.id = t.recipient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('patient_care_gaps', 'public.patient_care_gaps', $def$
  select t.* from public.patient_care_gaps t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('patient_consents', 'public.patient_consents', $def$
  select t.* from public.patient_consents t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('patient_engagement_scores', 'public.patient_engagement_scores', $def$
  select t.* from public.patient_engagement_scores t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('patient_milestones', 'public.patient_milestones', $def$
  select t.* from public.patient_milestones t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('patient_risk_scores', 'public.patient_risk_scores', $def$
  select t.* from public.patient_risk_scores t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('patient_timeline', 'public.patient_timeline', $def$
  select t.* from public.patient_timeline t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('payment_transactions', 'public.payment_transactions', $def$
  select t.* from public.payment_transactions t where (t.booking_order_type is null or t.booking_order_id is null or case t.booking_order_type::text when 'service_purchase' then not exists (select 1 from public.service_purchases s join public.profiles tp on tp.id = s.patient_id where s.id = t.booking_order_id and tp.is_test) when 'lab' then not exists (select 1 from public.lab_orders s join public.profiles tp on tp.id = s.patient_id where s.id = t.booking_order_id and tp.is_test) when 'pharmacy' then not exists (select 1 from public.pharmacy_orders s join public.profiles tp on tp.id = s.patient_id where s.id = t.booking_order_id and tp.is_test) when 'referral' then not exists (select 1 from public.specialist_referrals s join public.profiles tp on tp.id = s.patient_id where s.id = t.booking_order_id and tp.is_test) when 'home_visit' then true when 'delivery' then true else false end)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('pharmacy_orders', 'public.pharmacy_orders', $def$
  select t.* from public.pharmacy_orders t where not t.is_test and not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('prevention_risk_scores', 'public.prevention_risk_scores', $def$
  select t.* from public.prevention_risk_scores t where not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('preventive_programme_enrolments', 'public.preventive_programme_enrolments', $def$
  select t.* from public.preventive_programme_enrolments t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('profiles', 'public.profiles', $def$
  select t.* from public.profiles t where not t.is_test$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('programme_purchases', 'public.programme_purchases', $def$
  select t.* from public.programme_purchases t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('reputation_review_prompts', 'public.reputation_review_prompts', $def$
  select t.* from public.reputation_review_prompts t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('safeguarding_concerns', 'public.safeguarding_concerns', $def$
  select t.* from public.safeguarding_concerns t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('screening_results', 'public.screening_results', $def$
  select t.* from public.screening_results t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('screening_schedules', 'public.screening_schedules', $def$
  select t.* from public.screening_schedules t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('screening_upgrades', 'public.screening_upgrades', $def$
  select t.* from public.screening_upgrades t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('service_purchases', 'public.service_purchases', $def$
  select t.* from public.service_purchases t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('specialist_referrals', 'public.specialist_referrals', $def$
  select t.* from public.specialist_referrals t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('support_tickets', 'public.support_tickets', $def$
  select t.* from public.support_tickets t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = t.created_by and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('vaccination_records', 'public.vaccination_records', $def$
  select t.* from public.vaccination_records t where not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('vaccination_schedules', 'public.vaccination_schedules', $def$
  select t.* from public.vaccination_schedules t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('web_events', 'public.web_events', $def$
  select t.* from public.web_events t where not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('doctor_current_staff', 'private.doctor_current_staff', $def$
  select t.* from private.doctor_current_staff t where not exists (select 1 from public.profiles tp where tp.id = t.profile_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('doctor_paid_work', 'private.doctor_paid_work', $def$
  select t.* from private.doctor_paid_work t where not exists (select 1 from public.profiles tp where tp.id = t.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values ('real_patient_ids', null, $def$
  select r.patient_id from private.real_patient_ids() r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

select private.rebuild_analytics_clean_views();

revoke all on all tables in schema analytics_clean from public, anon, authenticated;

comment on view analytics_clean.real_patient_ids is 'private.real_patient_ids() (patients without a tarragon.test email) minus profiles.is_test.';

CREATE OR REPLACE FUNCTION public.analytics_accounting_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'revenue_recognition', (
      with paid as (
        select sp.currency::text currency,
               coalesce(sp.payable_kobo, sp.amount_kobo) amount,
               (sp.redeemed_at is not null
                 or sp.status = 'expired'
                 or (sp.expires_at is not null and sp.expires_at <= now())) delivered
        from analytics_clean.service_purchases sp
        where sp.status in ('active','expired')
        union all
        select 'NGN', pp.price_kobo,
               (pp.status in ('completed','expired') or pp.ends_at < current_date)
        from analytics_clean.programme_purchases pp
        where pp.status in ('active','completed','expired')
      )
      select jsonb_build_object(
        'billed_minor', coalesce(sum(amount),0),
        'recognized_minor', coalesce(sum(amount) filter (where delivered),0),
        'deferred_minor', coalesce(sum(amount) filter (where not delivered),0),
        'by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'billed', b, 'recognized', r, 'deferred', d) order by b desc),'[]'::jsonb)
          from (select currency, sum(amount) b,
                       coalesce(sum(amount) filter (where delivered),0) r,
                       coalesce(sum(amount) filter (where not delivered),0) d
                from paid group by currency) x)
      ) from paid
    ),
    'ar_aging', jsonb_build_object(
      'purchases_awaiting_payment', (
        select count(*) from analytics_clean.service_purchases where status = 'pending_payment'
      ) + (
        select count(*) from analytics_clean.programme_purchases where status = 'pending_payment'
      ),
      'commission_receivable_kobo', (select coalesce(sum(amount_kobo),0) from analytics_clean.commissions where status in ('pending','confirmed')),
      'aging', (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'kobo', kobo) order by ord), '[]'::jsonb)
        from (
          select bucket, ord, coalesce(sum(amount_kobo),0) kobo from (
            select amount_kobo,
              case when earned_at >= now() - interval '30 days' then '0-30 days'
                   when earned_at >= now() - interval '60 days' then '31-60 days'
                   when earned_at >= now() - interval '90 days' then '61-90 days'
                   else '90+ days' end bucket,
              case when earned_at >= now() - interval '30 days' then 1
                   when earned_at >= now() - interval '60 days' then 2
                   when earned_at >= now() - interval '90 days' then 3 else 4 end ord
            from analytics_clean.commissions where status in ('pending','confirmed')
          ) a group by bucket, ord
        ) t)
    ),
    'reconciliation', (
      select jsonb_build_object(
        -- Errored webhook rows never moved money and must not read as revenue.
        'payments_collected', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total_minor', total) order by total desc),'[]'::jsonb)
          from (select currency::text currency, sum(coalesce(amount_minor,0)) total
                from analytics_clean.payment_transactions where error is null group by currency) x),
        'refunds_minor', (select coalesce(sum(coalesce(amount_minor,0)),0) from analytics_clean.payment_transactions
                          where error is null and event_type::text ilike '%refund%')
      )
    )
  );
end;
$function$;

revoke all on function public.analytics_accounting_summary() from public, anon;

grant execute on function public.analytics_accounting_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_acquisition_funnel(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return jsonb_build_array(
    jsonb_build_object('step','Visitors','count', (select count(distinct coalesce(session_id, id::text)) from analytics_clean.web_events where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<=p_to))),
    jsonb_build_object('step','Leads','count', (select count(*) from public.leads where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))),
    jsonb_build_object('step','Signups','count', (select count(*) from analytics_clean.profiles where role='patient' and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))),
    jsonb_build_object('step','Onboarded','count', (select count(*) from analytics_clean.profiles where role='patient' and onboarding_completed_at is not null and (p_from is null or onboarding_completed_at>=p_from) and (p_to is null or onboarding_completed_at<=p_to))),
    jsonb_build_object('step','Paid','count', (
      select count(*) from (
        select patient_id from analytics_clean.service_purchases
        where status in ('active','expired')
          and (p_from is null or purchased_at>=p_from) and (p_to is null or purchased_at<=p_to)
        union
        select patient_id from analytics_clean.programme_purchases
        where status in ('active','completed','expired')
          and (p_from is null or purchased_at>=p_from) and (p_to is null or purchased_at<=p_to)
      ) t
    ))
  );
end;
$function$;

revoke all on function public.analytics_acquisition_funnel(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_acquisition_funnel(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_active_users_timeseries(p_period text DEFAULT 'day'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_period text := case when p_period in ('day','week','month') then p_period else 'day' end;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'active_users', au) order by bucket)
    from (
      select date_trunc(v_period, e.occurred_at) bucket, count(distinct e.patient_id) au
      from private.patient_engagement_events() e
      join analytics_clean.real_patient_ids rp on rp.patient_id = e.patient_id
      group by 1
    ) t
  ), '[]'::jsonb);
end; $function$;

revoke all on function public.analytics_active_users_timeseries(text) from public, anon;

grant execute on function public.analytics_active_users_timeseries(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_alert_burden()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object('per_clinician', coalesce(jsonb_agg(t), '[]'::jsonb))
    into v_result
  from (
    select
      cs.id as clinical_staff_id,
      cs.full_name,
      cs.doctor_tier,
      count(*) filter (where ca.status in ('open', 'acknowledged')) as open_owned,
      count(*) filter (where ca.status in ('open', 'acknowledged') and ca.severity >= 3) as open_owned_urgent_plus,
      round(avg(extract(epoch from (now() - ca.created_at)) / 3600) filter (where ca.status in ('open', 'acknowledged')), 1) as avg_age_hours
    from analytics_clean.clinical_staff cs
    join analytics_clean.clinician_alerts ca on ca.responsible_clinician_id = cs.id
    where cs.active
    group by cs.id, cs.full_name, cs.doctor_tier
    having count(*) filter (where ca.status in ('open', 'acknowledged')) > 0
    order by count(*) filter (where ca.status in ('open', 'acknowledged')) desc
  ) t;

  return coalesce(v_result, jsonb_build_object('per_clinician', '[]'::jsonb)) || jsonb_build_object(
    'unassigned_important_open', (
      select count(*) from analytics_clean.clinician_alerts
      where status in ('open', 'acknowledged') and severity >= 2 and responsible_clinician_id is null
    )
  );
end;
$function$;

revoke all on function public.analytics_alert_burden() from public, anon;

grant execute on function public.analytics_alert_burden() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_alert_quality(p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'total', count(*),
    'by_category', (
      select coalesce(jsonb_object_agg(category, cnt), '{}'::jsonb)
      from (select category, count(*) as cnt from analytics_clean.clinician_alerts where created_at between p_from and p_to group by category) s
    ),
    'by_severity', (
      select coalesce(jsonb_object_agg(severity, cnt), '{}'::jsonb)
      from (select severity, count(*) as cnt from analytics_clean.clinician_alerts where created_at between p_from and p_to group by severity) s
    ),
    'avg_ack_minutes', round(avg(extract(epoch from (acknowledged_at - created_at)) / 60) filter (where acknowledged_at is not null), 1),
    'avg_resolution_hours', round(avg(extract(epoch from (resolved_at - created_at)) / 3600) filter (where resolved_at is not null), 1),
    'escalation_rate_pct', round(100.0 * count(*) filter (
      where id in (select clinician_alert_id from public.clinician_alert_ack_escalations)
    ) / nullif(count(*), 0), 1),
    'duplicate_rate_pct', round(100.0 * count(*) filter (where duplicate_of is not null) / nullif(count(*), 0), 1),
    'false_positive_rate_pct', round(
      100.0 * count(*) filter (where resolution_outcome = 'false_positive')
      / nullif(count(*) filter (where resolution_outcome is not null), 0), 1
    ),
    'suppressed_count', count(*) filter (where suppressed)
  )
  into v_result
  from analytics_clean.clinician_alerts
  where created_at between p_from and p_to;

  return v_result;
end;
$function$;

revoke all on function public.analytics_alert_quality(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_alert_quality(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_appointment_capacity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  return jsonb_build_object(
    'by_appointment_type_90d', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_type', appointment_type,
        'total', total,
        'completed', completed,
        'cancelled', cancelled,
        'no_show', no_show,
        'cancellation_rate_pct', case when total > 0 then round(100.0 * cancelled / total, 1) else null end,
        'no_show_rate_pct', case when (completed + no_show) > 0 then round(100.0 * no_show / (completed + no_show), 1) else null end
      ) order by total desc), '[]'::jsonb)
      from (
        select
          appointment_type,
          count(*) as total,
          count(*) filter (where status = 'completed') as completed,
          count(*) filter (where status in ('cancelled', 'patient_cancelled', 'provider_cancelled')) as cancelled,
          count(*) filter (where status = 'no_show') as no_show
        from analytics_clean.appointments
        where created_at >= now() - interval '90 days'
        group by appointment_type
      ) t
    ),

    'upcoming_7_days_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('appointment_type', appointment_type, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (
        select appointment_type, count(*) as cnt
        from analytics_clean.appointments
        where status in ('booked', 'confirmed')
          and scheduled_for >= now() and scheduled_for < now() + interval '7 days'
        group by appointment_type
      ) t
    ),

    'waiting_list_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_type', appointment_type,
        'currently_waiting', waiting,
        'avg_wait_hours', avg_wait_hours
      ) order by waiting desc), '[]'::jsonb)
      from (
        select appointment_type,
          count(*) filter (where status = 'waiting') as waiting,
          round((avg(extract(epoch from (now() - created_at))) filter (where status = 'waiting') / 3600)::numeric, 1) as avg_wait_hours
        from analytics_clean.appointment_waiting_list
        group by appointment_type
      ) t
    ),

    'demand_by_location_90d', (
      select coalesce(jsonb_agg(jsonb_build_object('location', loc, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (
        select coalesce(location, 'Unspecified') as loc, count(*) as cnt
        from analytics_clean.appointments
        where created_at >= now() - interval '90 days'
        group by coalesce(location, 'Unspecified')
        order by count(*) desc
        limit 20
      ) t
    ),

    'avg_lead_time_days_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('appointment_type', appointment_type, 'avg_lead_time_days', avg_days) order by appointment_type), '[]'::jsonb)
      from (
        select appointment_type,
          round((avg(extract(epoch from (scheduled_for - created_at))) / 86400)::numeric, 1) as avg_days
        from analytics_clean.appointments
        where status in ('completed', 'booked', 'confirmed') and created_at >= now() - interval '90 days'
        group by appointment_type
      ) t
    )
  );
end;
$function$;

revoke all on function public.analytics_appointment_capacity() from public, anon;

grant execute on function public.analytics_appointment_capacity() to authenticated, service_role;

revoke all on function public.analytics_audit_log(text,text,uuid,timestamp with time zone,timestamp with time zone,integer,integer) from public, anon;

grant execute on function public.analytics_audit_log(text,text,uuid,timestamp with time zone,timestamp with time zone,integer,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_audit_summary(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'total', (select count(*) from (select r.* from public.audit_log r where not exists (select 1 from public.profiles tp where tp.id = r.actor_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = r.subject_patient_id and tp.is_test)) a
              where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at <= p_to)),
    'by_action', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'count', c) order by c desc), '[]'::jsonb)
      from (select action, count(*) c from (select r.* from public.audit_log r where not exists (select 1 from public.profiles tp where tp.id = r.actor_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = r.subject_patient_id and tp.is_test)) audit_log
            where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
            group by action) t),
    'by_entity', (select coalesce(jsonb_agg(jsonb_build_object('entity_type', entity_type, 'count', c) order by c desc), '[]'::jsonb)
      from (select coalesce(entity_type, 'unknown') entity_type, count(*) c from (select r.* from public.audit_log r where not exists (select 1 from public.profiles tp where tp.id = r.actor_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = r.subject_patient_id and tp.is_test)) audit_log
            where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
            group by coalesce(entity_type, 'unknown')) t),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bucket, 'YYYY-MM-DD'), 'count', c) order by bucket), '[]'::jsonb)
      from (select date_trunc('day', created_at) bucket, count(*) c from (select r.* from public.audit_log r where not exists (select 1 from public.profiles tp where tp.id = r.actor_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = r.subject_patient_id and tp.is_test)) audit_log
            where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
            group by 1) t)
  );
end;
$function$;

revoke all on function public.analytics_audit_summary(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_audit_summary(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

revoke all on function public.analytics_business_summary() from public, anon;

grant execute on function public.analytics_business_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_care_engagement_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level_counts jsonb;
  v_segment_counts jsonb;
  v_re_engaged_30d bigint;
  v_scored_patients bigint;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  with latest as (
    select distinct on (ces.patient_id) ces.patient_id, ces.engagement_level, ces.segments
    from analytics_clean.care_engagement_scores ces
    join analytics_clean.real_patient_ids rp on rp.patient_id = ces.patient_id
    order by ces.patient_id, ces.computed_at desc
  )
  select
    coalesce(jsonb_object_agg(engagement_level, level_count), '{}'::jsonb),
    count(*)
  into v_level_counts, v_scored_patients
  from (
    select engagement_level, count(*) as level_count
    from latest
    group by engagement_level
  ) t;

  with latest as (
    select distinct on (ces.patient_id) ces.patient_id, ces.segments
    from analytics_clean.care_engagement_scores ces
    join analytics_clean.real_patient_ids rp on rp.patient_id = ces.patient_id
    order by ces.patient_id, ces.computed_at desc
  ),
  expanded as (
    select unnest(segments) as segment from latest
  )
  select coalesce(jsonb_object_agg(segment, segment_count), '{}'::jsonb)
  into v_segment_counts
  from (
    select segment, count(*) as segment_count
    from expanded
    group by segment
  ) t;

  select count(*) into v_re_engaged_30d
  from analytics_clean.patient_milestones pm
  join analytics_clean.real_patient_ids rp on rp.patient_id = pm.patient_id
  where pm.milestone_type = 'engagement_recovery' and pm.achieved_at >= now() - interval '30 days';

  return jsonb_build_object(
    'scored_patients', v_scored_patients,
    'level_counts', v_level_counts,
    'segment_counts', v_segment_counts,
    're_engaged_30d', v_re_engaged_30d
  );
end;
$function$;

revoke all on function public.analytics_care_engagement_summary() from public, anon;

grant execute on function public.analytics_care_engagement_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_clinical_outcomes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'bp_control', (
      with latest as (
        select distinct on (patient_id) patient_id, systolic, diastolic
        from (select r.* from private.vitals_readings_diagnostic r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) vitals_readings_diagnostic where vital_type='blood_pressure' and systolic is not null and diastolic is not null
        order by patient_id, taken_at desc
      )
      select jsonb_build_object('total', count(*), 'controlled', count(*) filter (where systolic < 140 and diastolic < 90),
        'pct', case when count(*)=0 then 0 else round(100.0 * count(*) filter (where systolic < 140 and diastolic < 90) / count(*), 1) end)
      from latest
    ),
    'glucose_control', (
      with latest as (
        select distinct on (patient_id) patient_id, glucose_mmol_l
        from (select r.* from private.vitals_readings_diagnostic r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) vitals_readings_diagnostic where vital_type='glucose' and glucose_mmol_l is not null
        order by patient_id, taken_at desc
      )
      select jsonb_build_object('total', count(*), 'controlled', count(*) filter (where glucose_mmol_l <= 7.0),
        'pct', case when count(*)=0 then 0 else round(100.0 * count(*) filter (where glucose_mmol_l <= 7.0) / count(*), 1) end)
      from latest
    ),
    'risk_migration', (
      with ranked as (
        select patient_id,
          (case risk_level::text when 'low' then 1 when 'moderate' then 2 when 'high' then 3 when 'very_high' then 4 else 0 end) rank,
          row_number() over (partition by patient_id order by computed_at asc) rn_first,
          row_number() over (partition by patient_id order by computed_at desc) rn_last
        from analytics_clean.patient_risk_scores
      ),
      pairs as (
        select f.patient_id, f.rank first_rank, l.rank last_rank
        from (select patient_id, rank from ranked where rn_first=1) f
        join (select patient_id, rank from ranked where rn_last=1) l on l.patient_id=f.patient_id
      )
      select coalesce(jsonb_agg(jsonb_build_object('direction', direction, 'patients', c) order by direction), '[]'::jsonb)
      from (
        select case when last_rank < first_rank then 'improved' when last_rank > first_rank then 'worsened' else 'stable' end direction, count(*) c
        from pairs group by 1
      ) t
    ),
    'screening_coverage', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
      from (select status::text status, count(*) c from analytics_clean.screening_schedules group by status) t),
    'vaccination_coverage', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
      from (select status::text status, count(*) c from analytics_clean.vaccination_schedules group by status) t)
  );
end; $function$;

revoke all on function public.analytics_clinical_outcomes() from public, anon;

grant execute on function public.analytics_clinical_outcomes() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_complaints_summary(p_from timestamp with time zone DEFAULT (now() - '90 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'total', count(*),
    'open_count', count(*) filter (where status <> 'governance_review'),
    'by_category', coalesce((
      select jsonb_object_agg(category, cnt) from (
        select category, count(*) as cnt from analytics_clean.complaints
        where created_at between p_from and p_to group by category
      ) s
    ), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) as cnt from analytics_clean.complaints
        where created_at between p_from and p_to group by status
      ) s
    ), '{}'::jsonb),
    'avg_acknowledgement_minutes', (
      select round(avg(extract(epoch from (acknowledged_at - created_at)) / 60)::numeric, 1)
      from analytics_clean.complaints
      where created_at between p_from and p_to and acknowledged_at is not null
    ),
    'avg_resolution_minutes', (
      select round(avg(extract(epoch from (resolved_at - created_at)) / 60)::numeric, 1)
      from analytics_clean.complaints
      where created_at between p_from and p_to and resolved_at is not null
    ),
    'incident_escalation_count', count(*) filter (where incident_report_id is not null),
    'governance_reviewed_count', count(*) filter (where status = 'governance_review')
  ) into v_result
  from analytics_clean.complaints
  where created_at between p_from and p_to;

  return v_result;
end;
$function$;

revoke all on function public.analytics_complaints_summary(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_complaints_summary(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_deliverability(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'channel', channel, 'total', total, 'sent', sent, 'failed', failed, 'pending', pending,
        'success_pct', case when total=0 then 0 else round(100.0 * sent / total, 1) end) order by total desc), '[]'::jsonb)
      from (
        select channel::text channel, count(*) total,
          count(*) filter (
            where status in ('sent','delivered','read')
               or (channel = 'in_app' and status <> 'failed')
          ) sent,
          count(*) filter (where status='failed') failed,
          count(*) filter (where status='pending') pending
        from analytics_clean.notifications where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)
        group by channel
      ) t
    ),
    'queue_depth', (
      -- in_app has no real queue -- pending there means unread, not backlogged.
      select count(*) from analytics_clean.notifications where status='pending' and channel <> 'in_app'
    ),
    'failures', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', c) order by c desc), '[]'::jsonb)
      from (select coalesce(last_error,'unknown') reason, count(*) c from analytics_clean.notifications where status='failed' group by coalesce(last_error,'unknown')) t),
    'timeseries', (select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'sent', sent, 'failed', failed) order by bucket), '[]'::jsonb)
      from (select date_trunc('day', created_at) bucket,
        count(*) filter (where status in ('sent','delivered','read') or (channel = 'in_app' and status <> 'failed')) sent,
        count(*) filter (where status='failed') failed
        from analytics_clean.notifications where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to) group by 1) t)
  );
end; $function$;

revoke all on function public.analytics_deliverability(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_deliverability(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_disease_surveillance(p_period text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_period text := case when p_period in ('week', 'month', 'quarter') then p_period else 'month' end;
  v_step interval := case v_period
    when 'week' then interval '7 days'
    when 'quarter' then interval '3 months'
    else interval '1 month'
  end;
  v_min_changed timestamptz;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select min(changed_at) into v_min_changed from analytics_clean.care_plan_status_history;

  return jsonb_build_object(
    'period', v_period,
    'new_enrollment_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'condition', condition,
        'count', c
      ) order by bucket, condition), '[]'::jsonb)
      from (
        select date_trunc(v_period, created_at) as bucket, condition::text as condition,
               count(distinct patient_id) as c
        from analytics_clean.care_plans
        group by 1, 2
      ) t
    ),
    'prevalence_trend', case when v_min_changed is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'condition', condition,
        'count', c
      ) order by bucket, condition), '[]'::jsonb)
      from (
        select gs.bucket, sub.condition::text as condition, count(*) as c
        from generate_series(date_trunc(v_period, v_min_changed), date_trunc(v_period, now()), v_step) as gs(bucket)
        cross join lateral (
          select distinct on (csh.patient_id, csh.condition) csh.condition, csh.status
          from analytics_clean.care_plan_status_history csh
          where csh.changed_at <= gs.bucket + v_step - interval '1 microsecond'
          order by csh.patient_id, csh.condition, csh.changed_at desc
        ) sub
        where sub.status = 'active'
        group by gs.bucket, sub.condition
      ) t
    ) end,
    'risk_scoring_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'risk_level', risk_level,
        'count', c
      ) order by bucket, risk_level), '[]'::jsonb)
      from (
        select date_trunc(v_period, computed_at) as bucket, risk_level::text as risk_level, count(*) as c
        from analytics_clean.patient_risk_scores
        group by 1, 2
      ) t
    ),
    'screening_result_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'total', total,
        'abnormal', abnormal
      ) order by bucket), '[]'::jsonb)
      from (
        select date_trunc(v_period, created_at) as bucket,
               count(*) as total,
               count(*) filter (where result_status in ('abnormal', 'critical')) as abnormal
        from analytics_clean.screening_results
        group by 1
      ) t
    )
  );
end;
$function$;

revoke all on function public.analytics_disease_surveillance(text) from public, anon;

grant execute on function public.analytics_disease_surveillance(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_doctor_income(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  return (
    with w as (
      select * from analytics_clean.doctor_paid_work
       where (p_from is null or earned_at >= p_from)
         and (p_to   is null or earned_at <= p_to)
    ),
    doctor_product as (
      select doctor_profile_id, product_code, min(product_name) as product_name,
             count(*) as jobs, sum(revenue_minor)::bigint as revenue_minor
        from w
       where doctor_profile_id is not null
       group by doctor_profile_id, product_code
    )
    select jsonb_build_object(
      'by_doctor', coalesce((
        select jsonb_agg(agg.d order by agg.sort_revenue desc, agg.d->>'doctor')
        from (
          select sum(w.revenue_minor)::bigint as sort_revenue,
          jsonb_build_object(
            'doctor_profile_id', w.doctor_profile_id,
            'doctor', coalesce(cs.full_name, p.full_name, '(unnamed)'),
            'tier', cs.doctor_tier::text,
            'employment_type', cs.employment_type::text,
            'active', coalesce(cs.active, false),
            'jobs', count(*),
            'patients', count(distinct w.patient_id),
            'revenue_minor', sum(w.revenue_minor)::bigint,
            'gross_minor', sum(w.gross_minor)::bigint,
            'currency', min(w.currency),
            'mixed_currency', count(distinct w.currency) > 1,
            'first_job_at', min(w.earned_at),
            'last_job_at', max(w.earned_at),
            'by_product', (
              select jsonb_agg(jsonb_build_object(
                       'product_code', dp.product_code,
                       'product_name', dp.product_name,
                       'jobs', dp.jobs,
                       'revenue_minor', dp.revenue_minor)
                     order by dp.revenue_minor desc, dp.product_name)
              from doctor_product dp
              where dp.doctor_profile_id = w.doctor_profile_id
            )
          ) d
          from w
          left join analytics_clean.profiles p on p.id = w.doctor_profile_id
          left join analytics_clean.doctor_current_staff cs on cs.profile_id = w.doctor_profile_id
          where w.doctor_profile_id is not null
          group by w.doctor_profile_id, cs.full_name, p.full_name, cs.doctor_tier,
                   cs.employment_type, cs.active
        ) agg
      ), '[]'::jsonb),
      'unattributed', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'attribution', t.attribution,
                 'product_code', t.product_code,
                 'product_name', t.product_name,
                 'is_doctor_time', t.is_doctor_time,
                 'expected_jobs', t.expected_jobs,
                 'jobs', t.jobs,
                 'revenue_minor', t.revenue_minor)
               order by t.revenue_minor desc, t.product_name)
        from (
          select attribution, product_code, min(product_name) product_name,
                 bool_or(is_doctor_time) is_doctor_time,
                 max(expected_jobs) expected_jobs,
                 count(*) jobs, sum(revenue_minor)::bigint revenue_minor
            from w where doctor_profile_id is null
           group by attribution, product_code
        ) t
      ), '[]'::jsonb),
      'by_source', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'source', t.source, 'jobs', t.jobs, 'revenue_minor', t.revenue_minor)
               order by t.revenue_minor desc)
        from (
          select source, count(*) jobs, sum(revenue_minor)::bigint revenue_minor
            from w group by source
        ) t
      ), '[]'::jsonb),
      'totals', (
        select jsonb_build_object(
          'jobs', count(*),
          'revenue_minor', coalesce(sum(revenue_minor), 0)::bigint,
          'gross_minor', coalesce(sum(gross_minor), 0)::bigint,
          'attributed_jobs', count(*) filter (where doctor_profile_id is not null),
          'attributed_revenue_minor',
            coalesce(sum(revenue_minor) filter (where doctor_profile_id is not null), 0)::bigint,
          'doctors', count(distinct doctor_profile_id)
        ) from w
      ),
      'period', jsonb_build_object('from', p_from, 'to', p_to)
    )
  );
end;
$function$;

revoke all on function public.analytics_doctor_income(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_doctor_income(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_doctor_paid_jobs(p_doctor_profile_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'source', t.source,
             'source_id', t.source_id,
             'product_code', t.product_code,
             'product_name', t.product_name,
             'work_type', t.work_type,
             'work_status', t.work_status,
             'is_doctor_time', t.is_doctor_time,
             'attribution', t.attribution,
             'doctor_profile_id', t.doctor_profile_id,
             'doctor', t.doctor,
             'patient_number', t.patient_number,
             'earned_at', t.earned_at,
             'revenue_minor', t.revenue_minor,
             'gross_minor', t.gross_minor,
             'currency', t.currency)
           order by t.earned_at desc nulls last)
    from (
      select w.source, w.source_id, w.product_code, w.product_name, w.work_type,
             w.work_status, w.is_doctor_time, w.attribution, w.doctor_profile_id,
             coalesce(cs.full_name, p.full_name) as doctor,
             pat.patient_number,
             w.earned_at, w.revenue_minor, w.gross_minor, w.currency
        from analytics_clean.doctor_paid_work w
        left join analytics_clean.profiles p on p.id = w.doctor_profile_id
        left join analytics_clean.doctor_current_staff cs on cs.profile_id = w.doctor_profile_id
        left join analytics_clean.profiles pat on pat.id = w.patient_id
       where (p_doctor_profile_id is null or w.doctor_profile_id = p_doctor_profile_id)
         and (p_from is null or w.earned_at >= p_from)
         and (p_to   is null or w.earned_at <= p_to)
       order by w.earned_at desc nulls last
       limit greatest(1, least(coalesce(p_limit, 500), 2000))
    ) t
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_doctor_paid_jobs(uuid,timestamp with time zone,timestamp with time zone,integer) from public, anon;

grant execute on function public.analytics_doctor_paid_jobs(uuid,timestamp with time zone,timestamp with time zone,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_doctor_performance(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with doctors as (
      select p.id, coalesce(p.full_name,'(unnamed)') name, p.role::text role,
             cs.id staff_id, cs.doctor_tier::text tier
      from analytics_clean.profiles p
      left join analytics_clean.clinical_staff cs on cs.profile_id = p.id and cs.active
      where p.role = 'clinician'
    )
    select jsonb_build_object(
      'by_doctor', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'doctor', d.name, 'role', d.role, 'tier', d.tier,
          'patients_assigned', (select count(*) from analytics_clean.care_team_assignment where clinician_id = d.id),
          'escalations_reviewed', (select count(*) from analytics_clean.escalations e where e.reviewed_by = d.id
             and e.reviewed_at is not null and (p_from is null or e.reviewed_at>=p_from) and (p_to is null or e.reviewed_at<=p_to)),
          'alerts_acknowledged', (select count(*) from analytics_clean.clinician_alerts a where a.acknowledged_by = d.id
             and a.acknowledged_at is not null and (p_from is null or a.acknowledged_at>=p_from) and (p_to is null or a.acknowledged_at<=p_to)),
          'meds_confirmed', (select count(*) from analytics_clean.medications m where m.last_confirmed_by = d.staff_id),
          'reviews_completed', (select count(*) from analytics_clean.medication_reviews r where r.reviewed_by = d.staff_id and r.completed_at is not null),
          'avg_ack_minutes', (select coalesce(round(avg(extract(epoch from (acknowledged_at-created_at))/60.0)::numeric,1),0)
             from analytics_clean.clinician_alerts where acknowledged_by=d.id and acknowledged_at is not null),
          'avg_resolution_hours', (select coalesce(round(avg(extract(epoch from (reviewed_at-created_at))/3600.0)::numeric,1),0)
             from analytics_clean.escalations where reviewed_by=d.id and reviewed_at is not null),
          'sla_met_pct', (select case when count(*) filter (where sla_due_at is not null)=0 then null
             else round(100.0*count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at<=sla_due_at)
                  / count(*) filter (where sla_due_at is not null),1) end
             from analytics_clean.clinician_alerts where acknowledged_by=d.id),
          'last_active_at', greatest(
             (select max(reviewed_at) from analytics_clean.escalations where reviewed_by=d.id),
             (select max(acknowledged_at) from analytics_clean.clinician_alerts where acknowledged_by=d.id)),
          'patient_panel', (select coalesce(jsonb_agg(pn order by pn), '[]'::jsonb)
             from (select coalesce(p2.patient_number,'PT-?') pn
                   from analytics_clean.care_team_assignment cta join analytics_clean.profiles p2 on p2.id=cta.patient_id
                   where cta.clinician_id=d.id order by p2.patient_number limit 200) x)
        ) order by (select count(*) from analytics_clean.care_team_assignment where clinician_id=d.id) desc), '[]'::jsonb)
        from doctors d
      ),
      'recent_responses', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'doctor', doctor, 'patient', patient, 'type', type,
          'raised_at', raised_at, 'responded_at', responded_at, 'response_min', response_min) order by responded_at desc), '[]'::jsonb)
        from (
          select doc.name doctor, coalesce(p2.patient_number,'PT-?') patient, 'Escalation resolved' type,
                 e.created_at raised_at, e.reviewed_at responded_at,
                 round(extract(epoch from (e.reviewed_at-e.created_at))/60.0)::int response_min
          from analytics_clean.escalations e
          join doctors doc on doc.id=e.reviewed_by
          join analytics_clean.profiles p2 on p2.id=e.patient_id
          where e.reviewed_at is not null and (p_from is null or e.reviewed_at>=p_from) and (p_to is null or e.reviewed_at<=p_to)
          union all
          select doc.name, coalesce(p2.patient_number,'PT-?'), 'Alert acknowledged',
                 a.created_at, a.acknowledged_at,
                 round(extract(epoch from (a.acknowledged_at-a.created_at))/60.0)::int
          from analytics_clean.clinician_alerts a
          join doctors doc on doc.id=a.acknowledged_by
          join analytics_clean.profiles p2 on p2.id=a.patient_id
          where a.acknowledged_at is not null and (p_from is null or a.acknowledged_at>=p_from) and (p_to is null or a.acknowledged_at<=p_to)
          order by responded_at desc limit 100
        ) t
      )
    )
  );
end; $function$;

revoke all on function public.analytics_doctor_performance(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_doctor_performance(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_engagement_outcome_correlation()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with latest_tier as (
      select distinct on (s.patient_id) s.patient_id, s.tier
      from analytics_clean.patient_engagement_scores s
      join analytics_clean.real_patient_ids rp on rp.patient_id = s.patient_id
      order by s.patient_id, s.computed_at desc
    ),
    latest_bp as (
      select distinct on (r.patient_id) r.patient_id, r.risk_level
      from analytics_clean.patient_risk_scores r
      where r.score_type = 'bp_control'
      order by r.patient_id, r.computed_at desc
    ),
    joined as (
      select t.tier, b.risk_level
      from latest_tier t
      join latest_bp b on b.patient_id = t.patient_id
    )
    select jsonb_agg(jsonb_build_object(
      'tier', tier,
      'cohort_size', cohort_size,
      'bp_in_range_count', bp_in_range_count
    ))
    from (
      select tier, count(*) as cohort_size,
             count(*) filter (where risk_level = 'low') as bp_in_range_count
      from joined
      group by tier
    ) grouped
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_engagement_outcome_correlation() from public, anon;

grant execute on function public.analytics_engagement_outcome_correlation() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_engagement_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_dau bigint; v_wau bigint; v_mau bigint;
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  select count(distinct e.patient_id) into v_dau
    from private.patient_engagement_events() e
    join analytics_clean.real_patient_ids rp on rp.patient_id = e.patient_id
    where e.occurred_at >= now() - interval '1 day';
  select count(distinct e.patient_id) into v_wau
    from private.patient_engagement_events() e
    join analytics_clean.real_patient_ids rp on rp.patient_id = e.patient_id
    where e.occurred_at >= now() - interval '7 days';
  select count(distinct e.patient_id) into v_mau
    from private.patient_engagement_events() e
    join analytics_clean.real_patient_ids rp on rp.patient_id = e.patient_id
    where e.occurred_at >= now() - interval '30 days';
  return jsonb_build_object(
    'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
    'stickiness', case when v_mau = 0 then 0 else round(100.0 * v_dau / v_mau, 1) end
  );
end; $function$;

revoke all on function public.analytics_engagement_summary() from public, anon;

grant execute on function public.analytics_engagement_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_escalation_quality(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'funnel', jsonb_build_object(
      'abnormal_results', (select count(*) from analytics_clean.screening_results where result_status in ('abnormal','critical') and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)),
      'alerts_raised', (select count(*) from analytics_clean.clinician_alerts where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)),
      'escalations', (select count(*) from analytics_clean.escalations where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)),
      'resolved', (select count(*) from analytics_clean.escalations where status='resolved' and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))
    ),
    'sla', (
      select jsonb_build_object(
        'total', count(*) filter (where sla_due_at is not null),
        'met', count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at <= sla_due_at),
        'breached', count(*) filter (where sla_due_at is not null and (acknowledged_at > sla_due_at or (acknowledged_at is null and sla_due_at < now()))),
        'pct_met', case when count(*) filter (where sla_due_at is not null)=0 then 0
          else round(100.0 * count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at <= sla_due_at) / count(*) filter (where sla_due_at is not null), 1) end
      )
      from analytics_clean.clinician_alerts where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)
    ),
    'avg_ack_minutes', (select coalesce(round(avg(extract(epoch from (acknowledged_at - created_at))/60.0)::numeric, 1), 0) from analytics_clean.clinician_alerts where acknowledged_at is not null),
    'avg_resolution_hours', (select coalesce(round(avg(extract(epoch from (reviewed_at - created_at))/3600.0)::numeric, 1), 0) from analytics_clean.escalations where reviewed_at is not null),
    'open_alerts', (select count(*) from analytics_clean.clinician_alerts where status='open'),
    'overdue_alerts', (select count(*) from analytics_clean.clinician_alerts where status='open' and sla_due_at is not null and sla_due_at < now())
  );
end; $function$;

revoke all on function public.analytics_escalation_quality(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_escalation_quality(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_executive_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'active_patients', (select count(*) from analytics_clean.profiles where role = 'patient' and is_active),
    'active_care_programmes', (select count(distinct patient_id) from analytics_clean.care_plans where status = 'active'),
    'appointments_90d', (
      select jsonb_build_object(
        'booked', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'no_show', count(*) filter (where status = 'no_show')
      )
      from analytics_clean.appointments
      where scheduled_for >= now() - interval '90 days'
    ),
    'referrals', jsonb_build_object(
      'open', (select count(*) from analytics_clean.specialist_referrals where status not in ('completed', 'closed', 'declined', 'draft')),
      'overdue', (select count(*) from analytics_clean.patient_care_gaps where gap_type = 'overdue_referral')
    ),
    'lab_orders_by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
      from (select status::text status, count(*) c from analytics_clean.lab_orders group by status) t
    ),
    'clinical_alerts', jsonb_build_object(
      'open', (select count(*) from analytics_clean.clinician_alerts where status = 'open'),
      'critical', (select count(*) from analytics_clean.clinician_alerts where status = 'open' and severity = 4)
    ),
    'care_gaps_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('gap_type', gap_type, 'count', c) order by c desc), '[]'::jsonb)
      from (select gap_type, count(*) c from analytics_clean.patient_care_gaps group by gap_type) t
    )
  );
end;
$function$;

revoke all on function public.analytics_executive_summary() from public, anon;

grant execute on function public.analytics_executive_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_facility_engagement()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'total_facilities', (select count(*) from analytics_clean.facilities),
    'active_facilities', (select count(*) from analytics_clean.facilities where is_active),
    'total_bookings', (select count(*) from analytics_clean.booking_requests),
    'facilities_with_usage', (
      select count(distinct facility_id) from (
        select facility_id from analytics_clean.booking_requests where facility_id is not null
        union select facility_id from analytics_clean.lab_orders where facility_id is not null
      ) u
    ),
    'by_facility', (
      with usage as (
        select facility_id, profile_id user_id from analytics_clean.booking_requests where facility_id is not null
        union all
        select facility_id, patient_id from analytics_clean.lab_orders where facility_id is not null
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'facility', name, 'type', type, 'state', state,
        'users', users, 'interactions', interactions) order by interactions desc, users desc), '[]'::jsonb)
      from (
        select f.name, f.type::text type, coalesce(f.state,'Unknown') state,
               count(distinct u.user_id) users, count(u.user_id) interactions
        from analytics_clean.facilities f
        left join usage u on u.facility_id = f.id
        group by f.id, f.name, f.type, f.state
      ) t
    ),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'facilities', c) order by c desc), '[]'::jsonb)
      from (select type::text type, count(*) c from analytics_clean.facilities group by type) t),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'facilities', c) order by c desc), '[]'::jsonb)
      from (select coalesce(state,'Unknown') state, count(*) c from analytics_clean.facilities group by coalesce(state,'Unknown')) t),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service_type', service_type, 'bookings', c) order by c desc), '[]'::jsonb)
      from (select service_type::text service_type, count(*) c from analytics_clean.booking_requests group by service_type) t)
  );
end; $function$;

revoke all on function public.analytics_facility_engagement() from public, anon;

grant execute on function public.analytics_facility_engagement() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_feature_adoption()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return jsonb_build_array(
    jsonb_build_object('feature','Vitals logging','patients',
      (select count(distinct v.patient_id) from (select r.* from private.vitals_readings_current r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) v
       join analytics_clean.real_patient_ids rp on rp.patient_id = v.patient_id)),
    jsonb_build_object('feature','AI health coach','patients',
      (select count(distinct a.profile_id) from analytics_clean.ai_conversations a
       join analytics_clean.real_patient_ids rp on rp.patient_id = a.profile_id)),
    jsonb_build_object('feature','Care plans','patients',
      (select count(distinct c.patient_id) from analytics_clean.care_plans c
       join analytics_clean.real_patient_ids rp on rp.patient_id = c.patient_id)),
    jsonb_build_object('feature','Medications','patients',
      (select count(distinct m.patient_id) from analytics_clean.medications m
       join analytics_clean.real_patient_ids rp on rp.patient_id = m.patient_id)),
    jsonb_build_object('feature','Vaccinations','patients',
      (select count(distinct vr.profile_id) from analytics_clean.vaccination_records vr
       join analytics_clean.real_patient_ids rp on rp.patient_id = vr.profile_id)),
    jsonb_build_object('feature','Screenings','patients',
      (select count(distinct s.patient_id) from analytics_clean.screening_schedules s
       join analytics_clean.real_patient_ids rp on rp.patient_id = s.patient_id)),
    jsonb_build_object('feature','Lifestyle coaching','patients',
      (select count(distinct l.patient_id) from analytics_clean.lpe_enrollments l
       join analytics_clean.real_patient_ids rp on rp.patient_id = l.patient_id)),
    jsonb_build_object('feature','Preventive programmes','patients',
      (select count(distinct pp.patient_id) from analytics_clean.preventive_programme_enrolments pp
       join analytics_clean.real_patient_ids rp on rp.patient_id = pp.patient_id))
  );
end; $function$;

revoke all on function public.analytics_feature_adoption() from public, anon;

grant execute on function public.analytics_feature_adoption() to authenticated, service_role;

revoke all on function public.analytics_finance_inputs() from public, anon;

grant execute on function public.analytics_finance_inputs() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_financial_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_paying_patients int;
  v_repeat_patients int;
  v_paid_purchases  int;
  v_revenue_kobo    bigint;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select count(*), coalesce(sum(coalesce(sp.payable_kobo, sp.amount_kobo)), 0)
    into v_paid_purchases, v_revenue_kobo
    from analytics_clean.service_purchases sp
    where sp.status in ('active', 'expired');

  select count(*), count(*) filter (where n > 1)
    into v_paying_patients, v_repeat_patients
    from (
      select sp.patient_id, count(*) n
      from analytics_clean.service_purchases sp
      where sp.status in ('active', 'expired')
      group by sp.patient_id
    ) t;

  return jsonb_build_object(
    -- Revenue actually collected, per currency, across both paid surfaces.
    'revenue_by_currency', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total_minor', total)
                                order by currency), '[]'::jsonb)
      from (
        select currency, sum(total)::bigint total from (
          select sp.currency::text currency,
                 coalesce(sp.payable_kobo, sp.amount_kobo) total
          from analytics_clean.service_purchases sp
          where sp.status in ('active', 'expired')
          union all
          select 'NGN', pp.price_kobo
          from analytics_clean.programme_purchases pp
          where pp.status in ('active', 'completed', 'expired')
        ) u group by currency
      ) t
    ),
    'revenue_total_kobo', v_revenue_kobo
      + coalesce((select sum(pp.price_kobo) from analytics_clean.programme_purchases pp
                  where pp.status in ('active', 'completed', 'expired')), 0),
    'revenue_30d_kobo', coalesce((
      select sum(coalesce(sp.payable_kobo, sp.amount_kobo)) from analytics_clean.service_purchases sp
      where sp.status in ('active', 'expired') and sp.purchased_at >= now() - interval '30 days'
    ), 0) + coalesce((
      select sum(pp.price_kobo) from analytics_clean.programme_purchases pp
      where pp.status in ('active', 'completed', 'expired') and pp.purchased_at >= now() - interval '30 days'
    ), 0),
    'revenue_90d_kobo', coalesce((
      select sum(coalesce(sp.payable_kobo, sp.amount_kobo)) from analytics_clean.service_purchases sp
      where sp.status in ('active', 'expired') and sp.purchased_at >= now() - interval '90 days'
    ), 0) + coalesce((
      select sum(pp.price_kobo) from analytics_clean.programme_purchases pp
      where pp.status in ('active', 'completed', 'expired') and pp.purchased_at >= now() - interval '90 days'
    ), 0),
    'paid_purchases', v_paid_purchases
      + coalesce((select count(*) from analytics_clean.programme_purchases pp
                  where pp.status in ('active', 'completed', 'expired')), 0),
    'purchases_awaiting_payment', (
      select count(*) from analytics_clean.service_purchases where status = 'pending_payment'
    ) + (
      select count(*) from analytics_clean.programme_purchases where status = 'pending_payment'
    ),
    'paying_patients', v_paying_patients,
    -- Share of paying patients who came back and bought a second time. This is
    -- the pay-per-service analogue of retention; it is not a churn rate and is
    -- not comparable to one.
    'repeat_rate_pct', case when v_paying_patients = 0 then 0
                            else round(100.0 * v_repeat_patients / v_paying_patients, 1) end,
    'avg_purchase_kobo', case when v_paid_purchases = 0 then 0
                              else round(v_revenue_kobo::numeric / v_paid_purchases) end,
    'commissions', jsonb_build_object(
      'total_kobo', (select coalesce(sum(amount_kobo),0)::bigint from analytics_clean.commissions),
      'pending_kobo', (select coalesce(sum(amount_kobo),0)::bigint from analytics_clean.commissions where status in ('pending','confirmed')),
      'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'total_kobo', total, 'count', c) order by status), '[]'::jsonb)
        from (select status::text status, sum(amount_kobo)::bigint total, count(*) c from analytics_clean.commissions group by status) t),
      'by_type', (select coalesce(jsonb_agg(jsonb_build_object('type', commission_type, 'total_kobo', total) order by commission_type), '[]'::jsonb)
        from (select commission_type::text commission_type, sum(amount_kobo)::bigint total from analytics_clean.commissions group by commission_type) t)
    ),
    'receivables_kobo', (select coalesce(sum(amount_kobo),0)::bigint from analytics_clean.commissions where status in ('pending','confirmed'))
  );
end;
$function$;

revoke all on function public.analytics_financial_summary() from public, anon;

grant execute on function public.analytics_financial_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_governance_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'clinical', jsonb_build_object(
      'staff_total', (select count(*) from analytics_clean.clinical_staff),
      'staff_verified', (select count(*) from analytics_clean.clinical_staff where license_verified_at is not null),
      'staff_unverified_active', (select count(*) from analytics_clean.clinical_staff where active and license_verified_at is null),
      'verification_pct', (select case when count(*)=0 then 0 else round(100.0*count(*) filter (where license_verified_at is not null)/count(*),1) end from analytics_clean.clinical_staff),
      'tier_unassigned', (select count(*) from analytics_clean.clinical_staff where active and doctor_tier is null),
      'indemnity_covered', (select count(*) from analytics_clean.clinical_staff where indemnity_expires_at >= now()),
      'indemnity_expiring_30d', (select count(*) from analytics_clean.clinical_staff where indemnity_expires_at >= now() and indemnity_expires_at < now() + interval '30 days'),
      'indemnity_expired', (select count(*) from analytics_clean.clinical_staff where indemnity_expires_at is not null and indemnity_expires_at < now()),
      'indemnity_exempt', (select count(*) from analytics_clean.clinical_staff where indemnity_exempt),
      'protocols_total', (select count(distinct protocol_id) from public.protocol_versions),
      'protocols_signed', (select count(*) from public.protocol_versions where approved_at is not null)
    ),
    'privacy', jsonb_build_object(
      'patients_total', (select count(*) from analytics_clean.profiles where role='patient'),
      'kyc_verified', (select count(distinct patient_id) from analytics_clean.identity_verifications where status='verified'),
      'kyc_pending', (select count(distinct patient_id) from analytics_clean.identity_verifications where status='pending'),
      'consent_coverage', (
        select coalesce(jsonb_agg(jsonb_build_object('consent_type', consent_type, 'accepted', accepted, 'total', total,
          'pct', case when total=0 then 0 else round(100.0*accepted/total,1) end) order by consent_type), '[]'::jsonb)
        from (
          select cv.consent_type::text consent_type, count(distinct pc.patient_id) accepted,
            (select count(*) from analytics_clean.profiles where role='patient') total
          from public.consent_versions cv
          left join analytics_clean.patient_consents pc on pc.consent_version_id = cv.id
          where cv.is_current
          group by cv.consent_type, cv.id
        ) t
      )
    ),
    'security', jsonb_build_object(
      'audit_events_30d', (select count(*) from (select r.* from public.audit_log r where not exists (select 1 from public.profiles tp where tp.id = r.actor_id and tp.is_test) and not exists (select 1 from public.profiles tp where tp.id = r.subject_patient_id and tp.is_test)) audit_log where created_at >= now() - interval '30 days'),
      'admin_accounts', (select count(*) from analytics_clean.profiles where role='admin'),
      'analyst_accounts', (select count(*) from analytics_clean.profiles where role='analyst')
    ),
    'risk', jsonb_build_object(
      'open', (select count(*) from public.risk_register where status <> 'closed'),
      'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
        from (select status, count(*) c from public.risk_register group by status) t),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', c) order by c desc), '[]'::jsonb)
        from (select category, count(*) c from public.risk_register group by category) t)
    )
  );
end; $function$;

revoke all on function public.analytics_governance_summary() from public, anon;

grant execute on function public.analytics_governance_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_growth_timeseries(p_period text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_period text := case when p_period in ('day','week','month') then p_period else 'month' end;
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bucket', to_char(bucket, 'YYYY-MM-DD'),
      'signups', signups,
      'new_purchases', new_purchases
    ) order by bucket)
    from (
      select bucket, sum(signups)::bigint signups, sum(purchases)::bigint new_purchases
      from (
        select date_trunc(v_period, created_at) bucket, 1 signups, 0 purchases from analytics_clean.profiles
        union all
        select date_trunc(v_period, coalesce(purchased_at, created_at)), 0, 1
          from analytics_clean.service_purchases where status in ('active','expired')
        union all
        select date_trunc(v_period, coalesce(purchased_at, created_at)), 0, 1
          from analytics_clean.programme_purchases where status in ('active','completed','expired')
      ) u
      group by bucket
    ) t
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_growth_timeseries(text) from public, anon;

grant execute on function public.analytics_growth_timeseries(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_health_economics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_per_catch_kobo bigint;
  v_abnormal_catches integer;
  v_enrolled_patients integer;
  v_controlled_patients integer;
  v_estimated_avoided_kobo bigint;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select estimated_cost_avoided_per_abnormal_catch_kobo into v_per_catch_kobo
  from public.cohort_cost_model_constants
  where organisation_id is null;
  v_per_catch_kobo := coalesce(v_per_catch_kobo, 0);

  select count(*) into v_abnormal_catches
  from analytics_clean.screening_results sr
  where sr.result_status in ('abnormal', 'critical')
    and exists (
      select 1 from analytics_clean.care_plans cp
      where cp.patient_id = sr.patient_id
        and cp.status = 'active'
        and cp.created_at >= sr.created_at
    );

  select count(distinct patient_id) into v_enrolled_patients
  from analytics_clean.care_plans
  where status = 'active';

  select coalesce(sum((elem->>'controlled')::integer), 0) into v_controlled_patients
  from jsonb_array_elements(public.analytics_programme_funnel()) elem
  where elem->>'controlled' is not null;

  v_estimated_avoided_kobo := v_abnormal_catches::bigint * v_per_catch_kobo;

  return jsonb_build_object(
    'is_estimate', true,
    'per_catch_kobo', v_per_catch_kobo,
    'abnormal_catches', v_abnormal_catches,
    'estimated_cost_avoided_kobo', v_estimated_avoided_kobo,
    'enrolled_patients', v_enrolled_patients,
    'cost_per_patient_kobo', case when v_enrolled_patients > 0
      then round(v_estimated_avoided_kobo::numeric / v_enrolled_patients) else null end,
    'controlled_patients_denominator', v_controlled_patients,
    'cost_per_controlled_patient_kobo', case when v_controlled_patients > 0
      then round(v_estimated_avoided_kobo::numeric / v_controlled_patients) else null end
  );
end;
$function$;

revoke all on function public.analytics_health_economics() from public, anon;

grant execute on function public.analytics_health_economics() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_investor_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rev_30 bigint; v_rev_prior_30 bigint; v_rev_90 bigint; v_rev_12m bigint;
  v_growth numeric; v_paying int; v_repeat int; v_arppu numeric;
  fi public.platform_finance_inputs%rowtype;
  v_cac numeric; v_new_cust int; v_margin numeric;
  v_net_burn numeric; v_runway numeric; v_rule40 numeric;
  v_cur_month date := date_trunc('month', now())::date;
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  select
    coalesce(sum(amount) filter (where at >= now() - interval '30 days'), 0),
    coalesce(sum(amount) filter (where at >= now() - interval '60 days' and at < now() - interval '30 days'), 0),
    coalesce(sum(amount) filter (where at >= now() - interval '90 days'), 0),
    coalesce(sum(amount) filter (where at >= now() - interval '12 months'), 0)
  into v_rev_30, v_rev_prior_30, v_rev_90, v_rev_12m
  from (
    select coalesce(sp.purchased_at, sp.created_at) at,
           coalesce(sp.payable_kobo, sp.amount_kobo) amount
    from analytics_clean.service_purchases sp where sp.status in ('active','expired')
    union all
    select coalesce(pp.purchased_at, pp.created_at), pp.price_kobo
    from analytics_clean.programme_purchases pp where pp.status in ('active','completed','expired')
  ) r;

  v_growth := case when v_rev_prior_30 = 0 then 0
                   else round(100.0 * (v_rev_30 - v_rev_prior_30) / v_rev_prior_30, 1) end;

  select count(*), count(*) filter (where n > 1) into v_paying, v_repeat
  from (
    select patient_id, count(*) n from (
      select patient_id from analytics_clean.service_purchases where status in ('active','expired')
      union all
      select patient_id from analytics_clean.programme_purchases where status in ('active','completed','expired')
    ) x group by patient_id
  ) t;

  v_arppu := case when v_paying = 0 then 0 else round(v_rev_12m::numeric / v_paying) end;

  select * into fi from public.platform_finance_inputs where currency='NGN' order by period_month desc limit 1;
  v_margin := coalesce(fi.gross_margin_pct, 0);

  select count(*) into v_new_cust from (
    select patient_id from analytics_clean.service_purchases
      where status in ('active','expired') and purchased_at >= v_cur_month
    union
    select patient_id from analytics_clean.programme_purchases
      where status in ('active','completed','expired') and purchased_at >= v_cur_month
  ) t;
  if fi.new_customers is not null then v_new_cust := fi.new_customers; end if;

  v_cac := case when coalesce(fi.marketing_spend_minor,0) = 0 or v_new_cust = 0 then null
                else round(fi.marketing_spend_minor::numeric / v_new_cust, 0) end;
  -- Fixed: null (not a computed negative) until a finance-inputs row exists.
  v_net_burn := case when fi.id is null then null
                     else coalesce(fi.operating_expense_minor,0) + coalesce(fi.marketing_spend_minor,0) - v_rev_30 end;
  v_runway := case when fi.id is null or v_net_burn <= 0 then null
                   else round(coalesce(fi.cash_balance_minor,0)::numeric / v_net_burn, 1) end;
  v_rule40 := v_growth + v_margin;

  return jsonb_build_object(
    'revenue_30d_minor', v_rev_30,
    'revenue_90d_minor', v_rev_90,
    'revenue_12m_minor', v_rev_12m,
    'mom_growth_pct', v_growth,
    'paying_patients', v_paying,
    'repeat_rate_pct', case when v_paying = 0 then 0 else round(100.0 * v_repeat / v_paying, 1) end,
    'arppu_minor', v_arppu,
    'revenue_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(bucket,'YYYY-MM'),
        'revenue_minor', revenue,
        'purchases', purchases,
        'paying_patients', patients) order by bucket), '[]'::jsonb)
      from (
        select date_trunc('month', at) bucket, sum(amount)::bigint revenue,
               count(*) purchases, count(distinct patient_id) patients
        from (
          select coalesce(sp.purchased_at, sp.created_at) at, sp.patient_id,
                 coalesce(sp.payable_kobo, sp.amount_kobo) amount
          from analytics_clean.service_purchases sp where sp.status in ('active','expired')
          union all
          select coalesce(pp.purchased_at, pp.created_at), pp.patient_id, pp.price_kobo
          from analytics_clean.programme_purchases pp where pp.status in ('active','completed','expired')
        ) r group by 1
      ) m
    ),
    'concentration', (
      select coalesce(jsonb_agg(jsonb_build_object('product', name, 'revenue_minor', rev, 'pct',
        case when v_rev_12m = 0 then 0 else round(100.0 * rev / v_rev_12m, 1) end) order by rev desc), '[]'::jsonb)
      from (
        select p.name, sum(coalesce(sp.payable_kobo, sp.amount_kobo))::bigint rev
        from analytics_clean.service_purchases sp
        join public.service_products p on p.id = sp.service_product_id
        where sp.status in ('active','expired')
          and coalesce(sp.purchased_at, sp.created_at) >= now() - interval '12 months'
        group by p.name
        union all
        select '12-Week Doctor-Supported Programme', sum(pp.price_kobo)::bigint
        from analytics_clean.programme_purchases pp
        where pp.status in ('active','completed','expired')
          and coalesce(pp.purchased_at, pp.created_at) >= now() - interval '12 months'
        having count(*) > 0
      ) t
    ),
    'unit_economics', jsonb_build_object(
      'inputs_present', fi.id is not null,
      'gross_margin_pct', v_margin,
      'cac_minor', v_cac,
      'rule_of_40', v_rule40,
      'net_burn_minor', v_net_burn,
      'runway_months', v_runway,
      'new_customers', v_new_cust
    )
  );
end;
$function$;

revoke all on function public.analytics_investor_summary() from public, anon;

grant execute on function public.analytics_investor_summary() to authenticated, service_role;

revoke all on function public.analytics_log_patient_access(uuid,text) from public, anon;

grant execute on function public.analytics_log_patient_access(uuid,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_operations_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'target_ratio', 120,
    'clinician_load', (
      select coalesce(jsonb_agg(jsonb_build_object('clinician', name, 'tier', tier, 'patients', patients) order by patients desc), '[]'::jsonb)
      from (
        select coalesce(cs.full_name, p.full_name, 'Unknown') name, cs.doctor_tier::text tier, count(*) patients
        from analytics_clean.care_team_assignment cta
        left join analytics_clean.profiles p on p.id = cta.clinician_id
        left join analytics_clean.clinical_staff cs on cs.profile_id = cta.clinician_id
        group by coalesce(cs.full_name, p.full_name, 'Unknown'), cs.doctor_tier
      ) t
    ),
    'over_target', (select count(*) from (select cta.clinician_id, count(*) c from analytics_clean.care_team_assignment cta group by cta.clinician_id having count(*) > 120) x),
    'escalation_queue', (select coalesce(jsonb_agg(jsonb_build_object('level', level, 'open', c) order by c desc), '[]'::jsonb)
      from (select level::text level, count(*) c from analytics_clean.clinician_alerts where status='open' group by level) t),
    'orders', jsonb_build_object(
      'lab', (select jsonb_build_object('total', count(*), 'completed', count(*) filter (where resulted_at is not null),
        'avg_turnaround_hours', coalesce(round(avg(extract(epoch from (resulted_at - ordered_at))/3600.0) filter (where resulted_at is not null and ordered_at is not null)::numeric, 1), 0))
        from analytics_clean.lab_orders),
      'pharmacy', (select jsonb_build_object('total', count(*), 'dispensed', count(*) filter (where status = 'dispensed'))
        from analytics_clean.pharmacy_orders),
      'referral', (select jsonb_build_object('total', count(*), 'confirmed', count(*) filter (where booking_confirmed_at is not null)) from analytics_clean.specialist_referrals)
    )
  );
end; $function$;

revoke all on function public.analytics_operations_summary() from public, anon;

grant execute on function public.analytics_operations_summary() to authenticated, service_role;

revoke all on function public.analytics_patient_activity(uuid) from public, anon;

grant execute on function public.analytics_patient_activity(uuid) to authenticated, service_role;

revoke all on function public.analytics_patient_search(text) from public, anon;

grant execute on function public.analytics_patient_search(text) to authenticated, service_role;

revoke all on function public.analytics_population_dataset_preview() from public, anon;

grant execute on function public.analytics_population_dataset_preview() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_population_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'total_patients', (select count(*) from analytics_clean.profiles where role = 'patient'),
    'condition_prevalence', (select coalesce(jsonb_agg(jsonb_build_object('condition', condition, 'patients', c) order by c desc), '[]'::jsonb)
      from (select condition::text condition, count(distinct patient_id) c from analytics_clean.care_plans where status = 'active' group by condition) t),
    'risk_distribution', (select coalesce(jsonb_agg(jsonb_build_object('risk_level', risk_level, 'patients', c) order by c desc), '[]'::jsonb)
      from (
        select risk_level::text risk_level, count(*) c
        from (select distinct on (patient_id) patient_id, risk_level from analytics_clean.patient_risk_scores order by patient_id, computed_at desc) latest
        group by risk_level
      ) t),
    'screening_counts', jsonb_build_object(
      'total', (select count(*) from analytics_clean.screening_results),
      'abnormal', (select count(*) from analytics_clean.screening_results where result_status in ('abnormal','critical'))
    ),
    'abnormal_screening_rate', (select case when count(*) = 0 then 0
      else round(100.0 * count(*) filter (where result_status in ('abnormal','critical')) / count(*), 1) end
      from analytics_clean.screening_results),
    'care_gaps', (select coalesce(jsonb_agg(jsonb_build_object('gap_type', gap_type, 'count', c) order by c desc), '[]'::jsonb)
      from (select gap_type::text gap_type, count(*) c from analytics_clean.patient_care_gaps group by gap_type) t),
    'age_bands', (select coalesce(jsonb_agg(jsonb_build_object('band', band, 'count', c) order by ord), '[]'::jsonb)
      from (
        select band, ord, count(*) c
        from (
          select
            case when age < 18 then '0-17' when age < 30 then '18-29' when age < 45 then '30-44'
                 when age < 60 then '45-59' when age < 75 then '60-74' else '75+' end band,
            case when age < 18 then 1 when age < 30 then 2 when age < 45 then 3
                 when age < 60 then 4 when age < 75 then 5 else 6 end ord
          from (select extract(year from age(date_of_birth))::int age from analytics_clean.profiles
                where role = 'patient' and date_of_birth is not null) a
        ) x group by band, ord
      ) t),
    'sex_distribution', (select coalesce(jsonb_agg(jsonb_build_object('sex', sex, 'count', c) order by sex), '[]'::jsonb)
      from (select coalesce(sex::text, 'unknown') sex, count(*) c from analytics_clean.profiles where role = 'patient' group by coalesce(sex::text, 'unknown')) t)
  );
end;
$function$;

revoke all on function public.analytics_population_summary() from public, anon;

grant execute on function public.analytics_population_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_programme_funnel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    with enrolled as (
      select distinct condition, patient_id
      from analytics_clean.care_plans
      where status = 'active'
    ),
    recent_activity as (
      select distinct patient_id
      from (select r.* from private.vitals_readings_diagnostic r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) vitals_readings_diagnostic
      where taken_at >= now() - interval '90 days'
    ),
    latest_bp as (
      select distinct on (patient_id) patient_id, systolic, diastolic
      from (select r.* from private.vitals_readings_diagnostic r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) vitals_readings_diagnostic
      where vital_type = 'blood_pressure'
        and systolic is not null and diastolic is not null
        and taken_at >= now() - interval '90 days'
      order by patient_id, taken_at desc
    ),
    latest_glucose as (
      select distinct on (patient_id) patient_id, glucose_mmol_l
      from (select r.* from private.vitals_readings_diagnostic r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) vitals_readings_diagnostic
      where vital_type = 'glucose'
        and glucose_mmol_l is not null
        and taken_at >= now() - interval '90 days'
      order by patient_id, taken_at desc
    ),
    per_condition as (
      select
        e.condition::text as condition,
        count(distinct e.patient_id) as enrolled,
        count(distinct e.patient_id) filter (where ra.patient_id is not null) as monitoring,
        count(distinct e.patient_id) filter (where ra.patient_id is null) as lost_to_follow_up,
        count(distinct bp.patient_id) filter (
          where e.condition = 'hypertension' and bp.systolic < 140 and bp.diastolic < 90
        ) as controlled_bp,
        count(distinct bp.patient_id) filter (
          where e.condition = 'hypertension' and (bp.systolic >= 140 or bp.diastolic >= 90)
        ) as uncontrolled_bp,
        count(distinct gl.patient_id) filter (
          where e.condition = 'diabetes' and gl.glucose_mmol_l <= 7.0
        ) as controlled_glucose,
        count(distinct gl.patient_id) filter (
          where e.condition = 'diabetes' and gl.glucose_mmol_l > 7.0
        ) as uncontrolled_glucose
      from enrolled e
      left join recent_activity ra on ra.patient_id = e.patient_id
      left join latest_bp bp on bp.patient_id = e.patient_id
      left join latest_glucose gl on gl.patient_id = e.patient_id
      group by e.condition
    )
    select jsonb_agg(jsonb_build_object(
      'condition', condition,
      'enrolled', enrolled,
      'monitoring', monitoring,
      'lost_to_follow_up', lost_to_follow_up,
      'controlled', case
        when condition = 'hypertension' then controlled_bp
        when condition = 'diabetes' then controlled_glucose
        else null
      end,
      'uncontrolled', case
        when condition = 'hypertension' then uncontrolled_bp
        when condition = 'diabetes' then uncontrolled_glucose
        else null
      end
    ) order by enrolled desc)
    from per_condition
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_programme_funnel() from public, anon;

grant execute on function public.analytics_programme_funnel() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_provider_capacity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  return jsonb_build_object(
    'by_specialty', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'specialist_type', p.specialist_type,
        'active_providers', p.active_providers,
        'total_providers', p.total_providers,
        'waitlisted_referrals', coalesce(w.waitlisted, 0),
        'avg_current_wait_hours', w.avg_current_wait_hours
      ) order by coalesce(w.waitlisted, 0) desc, p.specialist_type), '[]'::jsonb)
      from (
        select specialist_type,
               count(*) filter (where is_active) as active_providers,
               count(*) as total_providers
        from public.specialist_providers
        group by specialist_type
      ) p
      left join (
        select sr.specialist_type,
               count(*) filter (where sr.status = 'waitlisted') as waitlisted,
               round(avg(extract(epoch from (now() - sr.waitlisted_at)) / 3600)
                 filter (where sr.status = 'waitlisted'), 1) as avg_current_wait_hours
        from analytics_clean.specialist_referrals sr
        group by sr.specialist_type
      ) w on w.specialist_type = p.specialist_type
    ),

    'by_specialty_state', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'specialist_type', specialist_type,
        'state', state,
        'active_providers', active_providers
      ) order by specialist_type, state), '[]'::jsonb)
      from (
        select specialist_type, coalesce(state, 'Unknown') as state,
               count(*) filter (where is_active) as active_providers
        from public.specialist_providers
        group by specialist_type, coalesce(state, 'Unknown')
      ) t
    ),

    'zero_active_provider_specialties', (
      select coalesce(jsonb_agg(specialist_type order by specialist_type), '[]'::jsonb)
      from (
        select specialist_type
        from public.specialist_providers
        group by specialist_type
        having count(*) filter (where is_active) = 0
      ) z
    ),

    'recent_booking_turnaround', (
      select jsonb_build_object(
        'window_days', 90,
        'booked_referrals', count(*),
        'avg_hours_to_booking', round(avg(extract(epoch from (booking_confirmed_at - created_at)) / 3600), 1)
      )
      from analytics_clean.specialist_referrals
      where booking_confirmed_at is not null
        and created_at >= now() - interval '90 days'
    ),

    'video_slot_utilisation_next_7_days', (
      select jsonb_build_object(
        'total_slots', count(*),
        'booked_slots', count(*) filter (where booked_consultation_id is not null)
      )
      from public.consult_availability_slots
      where slot_start >= now() and slot_start < now() + interval '7 days'
    )
  );
end;
$function$;

revoke all on function public.analytics_provider_capacity() from public, anon;

grant execute on function public.analytics_provider_capacity() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_referral_turnaround()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    with booked as (
      select specialist_type,
        extract(epoch from (booking_confirmed_at - created_at)) / 3600.0 as hours_to_booking
      from analytics_clean.specialist_referrals
      where created_at >= now() - interval '90 days'
        and booking_confirmed_at is not null
    ),
    treated as (
      select specialist_type,
        extract(epoch from (treatment_plan_received_at - created_at)) / 3600.0 as hours_to_treatment
      from analytics_clean.specialist_referrals
      where created_at >= now() - interval '90 days'
        and treatment_plan_received_at is not null
    ),
    totals as (
      select specialist_type, count(*) total
      from analytics_clean.specialist_referrals
      where created_at >= now() - interval '90 days'
      group by specialist_type
    )
    select jsonb_agg(jsonb_build_object(
      'specialist_type', tt.specialist_type::text,
      'referrals_90d', tt.total,
      'avg_hours_to_booking', (select round(avg(hours_to_booking)::numeric, 1) from booked b where b.specialist_type = tt.specialist_type),
      'median_hours_to_booking', (select round((percentile_cont(0.5) within group (order by hours_to_booking))::numeric, 1) from booked b where b.specialist_type = tt.specialist_type),
      'avg_hours_to_treatment', (select round(avg(hours_to_treatment)::numeric, 1) from treated tr where tr.specialist_type = tt.specialist_type)
    ) order by tt.total desc)
    from totals tt
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_referral_turnaround() from public, anon;

grant execute on function public.analytics_referral_turnaround() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_reputation_review_conversion()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;

  select jsonb_agg(
    jsonb_build_object(
      'channel', channel,
      'queued', queued,
      'engaged', engaged,
      'clicked', clicked,
      'skipped_rate_limited', skipped_rate_limited
    )
  )
  into v_result
  from (
    select
      channel::text as channel,
      count(*) filter (where status not in ('skipped_rate_limited', 'skipped_flag_disabled')) as queued,
      count(*) filter (where status in ('sent', 'shown', 'clicked', 'dismissed')) as engaged,
      case
        when channel = 'trustpilot_email' then count(*) filter (where status = 'clicked')
        else null
      end as clicked,
      count(*) filter (where status = 'skipped_rate_limited') as skipped_rate_limited
    from analytics_clean.reputation_review_prompts
    group by channel
  ) t;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_reputation_review_conversion() from public, anon;

grant execute on function public.analytics_reputation_review_conversion() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_retention_cohorts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'cohort_week'))
    from (
      select jsonb_build_object(
        'cohort_week', to_char(c.cohort_week,'YYYY-MM-DD'),
        'cohort_size', c.cohort_size,
        'offsets', (
          select coalesce(jsonb_agg(jsonb_build_object('week_offset', o.k, 'retained', (
            select count(distinct e.patient_id)
            from private.patient_engagement_events() e
            where e.patient_id = any(c.members)
              and e.occurred_at >= c.cohort_week + (o.k || ' weeks')::interval
              and e.occurred_at <  c.cohort_week + ((o.k + 1) || ' weeks')::interval
          )) order by o.k), '[]'::jsonb)
          from generate_series(0,3) as o(k)
        )
      ) row
      from (
        select date_trunc('week', p.created_at) cohort_week, count(*) cohort_size, array_agg(p.id) members
        from analytics_clean.profiles p
        join analytics_clean.real_patient_ids rp on rp.patient_id = p.id
        where p.created_at >= now() - interval '8 weeks'
        group by 1
      ) c
    ) rows
  ), '[]'::jsonb);
end; $function$;

revoke all on function public.analytics_retention_cohorts() from public, anon;

grant execute on function public.analytics_retention_cohorts() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_revenue_by_product()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_code', code, 'product_name', name, 'currency', currency,
      'purchases', purchases, 'patients', patients, 'revenue_minor', revenue
    ) order by revenue desc, name)
    from (
      select p.code, p.name, sp.currency::text currency,
             count(*) purchases,
             count(distinct sp.patient_id) patients,
             sum(coalesce(sp.payable_kobo, sp.amount_kobo))::bigint revenue
      from analytics_clean.service_purchases sp
      join public.service_products p on p.id = sp.service_product_id
      where sp.status in ('active', 'expired')
      group by p.code, p.name, sp.currency
      union all
      select 'chronic_doctor_supported_programme', '12-Week Doctor-Supported Programme', 'NGN',
             count(*), count(distinct pp.patient_id), sum(pp.price_kobo)::bigint
      from analytics_clean.programme_purchases pp
      where pp.status in ('active', 'completed', 'expired')
      having count(*) > 0
    ) t
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_revenue_by_product() from public, anon;

grant execute on function public.analytics_revenue_by_product() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_revenue_timeseries(p_period text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_period text := case when p_period in ('day','week','month') then p_period else 'month' end;
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bucket', to_char(bucket, 'YYYY-MM-DD'),
      'currency', currency,
      'total_minor', total
    ) order by bucket, currency)
    from (
      select bucket, currency, sum(amount)::bigint total
      from (
        select date_trunc(v_period, coalesce(sp.purchased_at, sp.created_at)) bucket,
               sp.currency::text currency,
               coalesce(sp.payable_kobo, sp.amount_kobo) amount
        from analytics_clean.service_purchases sp
        where sp.status in ('active','expired')
        union all
        select date_trunc(v_period, coalesce(pp.purchased_at, pp.created_at)), 'NGN', pp.price_kobo
        from analytics_clean.programme_purchases pp
        where pp.status in ('active','completed','expired')
      ) u
      group by bucket, currency
    ) t
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.analytics_revenue_timeseries(text) from public, anon;

grant execute on function public.analytics_revenue_timeseries(text) to authenticated, service_role;

revoke all on function public.analytics_risk_register() from public, anon;

grant execute on function public.analytics_risk_register() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_safety_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_critical_alerts int;
  v_open_safety_events int;
  v_near_misses int;
  v_overdue_actions int;
  v_ai_escalations int;
  v_medication_incidents int;
  v_open_safeguarding_concerns int;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select count(*) into v_critical_alerts
  from analytics_clean.clinician_alerts
  where severity = 4 and status in ('open', 'acknowledged');

  select count(*) into v_open_safety_events
  from analytics_clean.clinical_incident_reports
  where status in ('open', 'under_review');

  select count(*) into v_near_misses
  from analytics_clean.clinical_incident_reports
  where severity = 'near_miss';

  select count(*) into v_overdue_actions
  from analytics_clean.clinician_alerts
  where status in ('open', 'acknowledged') and sla_due_at is not null and sla_due_at < now();

  select count(*) into v_ai_escalations
  from analytics_clean.clinical_incident_reports
  where category = 'ai_recommendation_error';

  select count(*) into v_medication_incidents
  from analytics_clean.clinical_incident_reports
  where category = 'medication_error';

  select count(*) into v_open_safeguarding_concerns
  from analytics_clean.safeguarding_concerns
  where status in ('open', 'under_review');

  return jsonb_build_object(
    'critical_alerts', v_critical_alerts,
    'open_safety_events', v_open_safety_events,
    'near_misses', v_near_misses,
    'overdue_actions', v_overdue_actions,
    'ai_escalations', v_ai_escalations,
    'medication_incidents', v_medication_incidents,
    'open_safeguarding_concerns', v_open_safeguarding_concerns
  );
end;
$function$;

revoke all on function public.analytics_safety_dashboard_summary() from public, anon;

grant execute on function public.analytics_safety_dashboard_summary() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_screening_referral_funnel(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_screened bigint;
  v_abnormal bigint;
  v_reviewed bigint;
  v_referred bigint;
  v_specialist bigint;
  v_treated bigint;
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;

  select count(*) into v_screened from analytics_clean.screening_results sr
    where (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_abnormal from analytics_clean.screening_results sr
    where sr.result_status in ('abnormal', 'critical')
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_reviewed from analytics_clean.screening_upgrades su
    where (p_from is null or su.upgrade_at >= p_from) and (p_to is null or su.upgrade_at <= p_to);

  select count(*) into v_referred from analytics_clean.specialist_referrals sr
    where sr.screening_upgrade_id is not null
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_specialist from analytics_clean.specialist_referrals sr
    where sr.screening_upgrade_id is not null and sr.booking_confirmed_at is not null
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  select count(*) into v_treated from analytics_clean.specialist_referrals sr
    where sr.screening_upgrade_id is not null and sr.treatment_plan_received_at is not null
      and (p_from is null or sr.created_at >= p_from) and (p_to is null or sr.created_at <= p_to);

  return jsonb_build_array(
    jsonb_build_object('stage', 'screened', 'count', v_screened, 'drop_off_pct', 0),
    jsonb_build_object('stage', 'abnormal_result', 'count', v_abnormal,
      'drop_off_pct', case when v_screened = 0 then 0 else round(100.0 * greatest(v_screened - v_abnormal, 0) / v_screened, 1) end),
    jsonb_build_object('stage', 'clinical_review', 'count', v_reviewed,
      'drop_off_pct', case when v_abnormal = 0 then 0 else round(100.0 * greatest(v_abnormal - v_reviewed, 0) / v_abnormal, 1) end),
    jsonb_build_object('stage', 'referred', 'count', v_referred,
      'drop_off_pct', case when v_reviewed = 0 then 0 else round(100.0 * greatest(v_reviewed - v_referred, 0) / v_reviewed, 1) end),
    jsonb_build_object('stage', 'specialist_booked', 'count', v_specialist,
      'drop_off_pct', case when v_referred = 0 then 0 else round(100.0 * greatest(v_referred - v_specialist, 0) / v_referred, 1) end),
    jsonb_build_object('stage', 'treatment', 'count', v_treated,
      'drop_off_pct', case when v_specialist = 0 then 0 else round(100.0 * greatest(v_specialist - v_treated, 0) / v_specialist, 1) end)
  );
end;
$function$;

revoke all on function public.analytics_screening_referral_funnel(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_screening_referral_funnel(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_specialist_provider_performance(p_specialist_provider_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not (private.is_admin() or private.is_analyst() or private.has_permission('partners.specialists.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'referrals_total', count(*),
    'referrals_completed', count(*) filter (where sr.status in ('completed', 'closed')),
    'referrals_declined', count(*) filter (where sr.status = 'declined'),
    'referral_completion_rate', round(
      (count(*) filter (where sr.status in ('completed', 'closed')))::numeric / nullif(count(*), 0),
      3
    ),
    'avg_report_turnaround_days', round(
      (avg(extract(epoch from (sr.treatment_plan_received_at - sr.booking_confirmed_at)) / 86400.0)
        filter (where sr.treatment_plan_received_at is not null and sr.booking_confirmed_at is not null))::numeric,
      1
    ),
    'patient_feedback_available', false,
    'punctuality_tracked', false
  ) into v_result
  from analytics_clean.specialist_referrals sr
  where sr.specialist_provider_id = p_specialist_provider_id;

  return coalesce(v_result, '{}'::jsonb);
end;
$function$;

revoke all on function public.analytics_specialist_provider_performance(uuid) from public, anon;

grant execute on function public.analytics_specialist_provider_performance(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_specialist_provider_workload(p_specialist_provider_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not (private.is_admin() or private.is_analyst() or private.has_permission('partners.specialists.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'consultations_today', count(*) filter (
      where sr.appointment_date::date = current_date and sr.status in ('confirmed', 'completed')
    ),
    'consultations_telemedicine_today', count(*) filter (
      where sr.appointment_date::date = current_date and sr.status in ('confirmed', 'completed')
        and sr.preferred_consultation_type = 'telemedicine'
    ),
    'consultations_physical_today', count(*) filter (
      where sr.appointment_date::date = current_date and sr.status in ('confirmed', 'completed')
        and sr.preferred_consultation_type = 'in_person'
    ),
    'avg_waiting_days_90d', round(
      (avg(extract(epoch from (sr.booking_confirmed_at - sr.created_at)) / 86400.0)
        filter (where sr.booking_confirmed_at is not null and sr.created_at > now() - interval '90 days'))::numeric,
      1
    ),
    'cancellation_rate_90d', round(
      (count(*) filter (where sr.status = 'declined' and sr.created_at > now() - interval '90 days'))::numeric
        / nullif(count(*) filter (where sr.created_at > now() - interval '90 days'), 0),
      3
    ),
    'referrals_90d', count(*) filter (where sr.created_at > now() - interval '90 days')
  ) into v_result
  from analytics_clean.specialist_referrals sr
  where sr.specialist_provider_id = p_specialist_provider_id;

  return coalesce(v_result, '{}'::jsonb);
end;
$function$;

revoke all on function public.analytics_specialist_provider_workload(uuid) from public, anon;

grant execute on function public.analytics_specialist_provider_workload(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_staff_activity(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with staff_events as (
      select w.profile_id, w.occurred_at, p.full_name, p.role::text role
      from analytics_clean.web_events w
      join analytics_clean.profiles p on p.id = w.profile_id
      where w.profile_id is not null
        and p.role in ('admin','clinician','care_coordinator','analyst')
        and (p_from is null or w.occurred_at >= p_from)
        and (p_to is null or w.occurred_at <= p_to)
    ),
    marked as (
      select *,
        case when lag(occurred_at) over (partition by profile_id order by occurred_at) is null
               or occurred_at - lag(occurred_at) over (partition by profile_id order by occurred_at) > interval '30 minutes'
             then 1 else 0 end new_session
      from staff_events
    ),
    numbered as (
      select *, sum(new_session) over (partition by profile_id order by occurred_at rows unbounded preceding) session_num
      from marked
    ),
    sessions as (
      select profile_id, coalesce(full_name,'(unnamed)') full_name, role, session_num,
        min(occurred_at) started, max(occurred_at) ended, count(*) pageviews,
        round(extract(epoch from (max(occurred_at) - min(occurred_at)))/60.0)::int duration_min
      from numbered group by profile_id, full_name, role, session_num
    )
    select jsonb_build_object(
      'staff_total', (select count(*) from analytics_clean.profiles where role in ('admin','clinician','care_coordinator','analyst')),
      'active_today', (select count(distinct profile_id) from staff_events where occurred_at >= date_trunc('day', now())),
      'active_7d', (select count(distinct profile_id) from staff_events where occurred_at >= now() - interval '7 days'),
      'sessions_total', (select count(*) from sessions),
      'by_staff', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff', full_name, 'role', role, 'sessions', sessions,
          'active_minutes', active_minutes, 'pageviews', pageviews, 'last_seen', last_seen) order by last_seen desc), '[]'::jsonb)
        from (
          select full_name, role, count(*) sessions, sum(duration_min) active_minutes,
                 sum(pageviews) pageviews, max(ended) last_seen
          from sessions group by profile_id, full_name, role
        ) t
      ),
      'recent_sessions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff', full_name, 'role', role, 'started', started, 'ended', ended,
          'duration_min', duration_min, 'pageviews', pageviews) order by started desc), '[]'::jsonb)
        from (select * from sessions order by started desc limit 100) t
      )
    )
  );
end; $function$;

revoke all on function public.analytics_staff_activity(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_staff_activity(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_support_response_time()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
  return (
    with first_patient_msg as (
      select thread_id, min(created_at) as first_patient_at
      from analytics_clean.care_messages
      where author_role = 'patient'
        and created_at >= now() - interval '90 days'
      group by thread_id
    ),
    first_reply as (
      select fpm.thread_id, min(cm.created_at) as first_reply_at
      from first_patient_msg fpm
      join analytics_clean.care_messages cm
        on cm.thread_id = fpm.thread_id
        and cm.author_role = 'care_team'
        and cm.created_at > fpm.first_patient_at
      group by fpm.thread_id
    )
    select jsonb_build_object(
      'threads_90d', (select count(*) from first_patient_msg),
      'threads_with_reply', (select count(*) from first_reply),
      'avg_first_response_minutes', (
        select round(avg(extract(epoch from (fr.first_reply_at - fpm.first_patient_at)) / 60.0)::numeric, 1)
        from first_reply fr join first_patient_msg fpm on fpm.thread_id = fr.thread_id
      )
    )
  );
end;
$function$;

revoke all on function public.analytics_support_response_time() from public, anon;

grant execute on function public.analytics_support_response_time() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_support_ticket_summary(p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'total', count(*),
    'open_count', count(*) filter (where status not in ('resolved', 'closed')),
    'by_category', coalesce((
      select jsonb_object_agg(category, cnt) from (
        select category, count(*) as cnt from analytics_clean.support_tickets
        where created_at between p_from and p_to group by category
      ) s
    ), '{}'::jsonb),
    'by_priority', coalesce((
      select jsonb_object_agg(priority, cnt) from (
        select priority, count(*) as cnt from analytics_clean.support_tickets
        where created_at between p_from and p_to group by priority
      ) s
    ), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) as cnt from analytics_clean.support_tickets
        where created_at between p_from and p_to group by status
      ) s
    ), '{}'::jsonb),
    'avg_first_response_minutes', (
      select round(avg(extract(epoch from (first_response_at - created_at)) / 60)::numeric, 1)
      from analytics_clean.support_tickets
      where created_at between p_from and p_to and first_response_at is not null
    ),
    'avg_resolution_minutes', (
      select round(avg(extract(epoch from (resolved_at - created_at)) / 60)::numeric, 1)
      from analytics_clean.support_tickets
      where created_at between p_from and p_to and resolved_at is not null
    ),
    'escalation_rate_pct', (
      select round(100.0 * count(*) filter (where escalated_alert_id is not null or technical_tier > 1) / greatest(count(*), 1), 1)
      from analytics_clean.support_tickets
      where created_at between p_from and p_to
    ),
    'repeat_contact_rate_pct', (
      select round(100.0 * count(*) filter (where ticket_count > 1) / greatest(count(*), 1), 1)
      from (
        select patient_id, count(*) as ticket_count from analytics_clean.support_tickets
        where created_at between p_from and p_to group by patient_id
      ) per_patient
    ),
    'avg_satisfaction', (
      select round(avg(satisfaction_score)::numeric, 2)
      from analytics_clean.support_tickets
      where created_at between p_from and p_to and satisfaction_score is not null
    ),
    'satisfaction_response_count', (
      select count(*) from analytics_clean.support_tickets
      where created_at between p_from and p_to and satisfaction_score is not null
    )
  ) into v_result
  from analytics_clean.support_tickets
  where created_at between p_from and p_to;

  return v_result;
end;
$function$;

revoke all on function public.analytics_support_ticket_summary(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_support_ticket_summary(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_traffic_summary(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'visitors', (select count(distinct coalesce(session_id, id::text)) from analytics_clean.web_events
                 where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'logged_in_visitors', (select count(distinct profile_id) from analytics_clean.web_events
                 where profile_id is not null and (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'pageviews', (select count(*) from analytics_clean.web_events
                 where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'by_country', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(country,'Unknown') country, count(distinct coalesce(session_id, id::text)) v from analytics_clean.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(country,'Unknown')) t),
    'by_region', (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(region,'Unknown') region, count(distinct coalesce(session_id, id::text)) v from analytics_clean.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(region,'Unknown')) t),
    'by_referrer', (select coalesce(jsonb_agg(jsonb_build_object('referrer_host', referrer_host, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(referrer_host,'Direct') referrer_host, count(distinct coalesce(session_id, id::text)) v from analytics_clean.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(referrer_host,'Direct')) t),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(utm_source,'None') source, count(distinct coalesce(session_id, id::text)) v from analytics_clean.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(utm_source,'None')) t),
    'by_device', (select coalesce(jsonb_agg(jsonb_build_object('device', device_type, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(device_type,'unknown') device_type, count(distinct coalesce(session_id, id::text)) v from analytics_clean.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(device_type,'unknown')) t),
    'by_page', (select coalesce(jsonb_agg(jsonb_build_object('page', page, 'pageviews', pv, 'visitors', v) order by pv desc), '[]'::jsonb)
      from (
        select page, count(*) pv, count(distinct visitor) v
        from (
          select
            regexp_replace(path, '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/:id', 'gi') as page,
            coalesce(session_id, id::text) as visitor
          from analytics_clean.web_events
          where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)
        ) normalised
        group by page
        order by pv desc
        limit 20
      ) t)
  );
end; $function$;

revoke all on function public.analytics_traffic_summary(timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_traffic_summary(timestamp with time zone,timestamp with time zone) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_traffic_timeseries(p_period text DEFAULT 'day'::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_period text := case when p_period in ('day','week','month') then p_period else 'day' end;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'visitors', visitors, 'pageviews', pageviews) order by bucket)
    from (
      select date_trunc(v_period, occurred_at) bucket,
             count(distinct coalesce(session_id, id::text)) visitors, count(*) pageviews
      from analytics_clean.web_events
      where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)
      group by 1
    ) t
  ), '[]'::jsonb);
end; $function$;

revoke all on function public.analytics_traffic_timeseries(text,timestamp with time zone,timestamp with time zone) from public, anon;

grant execute on function public.analytics_traffic_timeseries(text,timestamp with time zone,timestamp with time zone) to authenticated, service_role;

revoke all on function public.analytics_upsert_finance_input(date,text,bigint,bigint,bigint,numeric,integer,text) from public, anon;

grant execute on function public.analytics_upsert_finance_input(date,text,bigint,bigint,bigint,numeric,integer,text) to authenticated, service_role;

revoke all on function public.analytics_upsert_risk(uuid,text,text,text,text,text,text,text) from public, anon;

grant execute on function public.analytics_upsert_risk(uuid,text,text,text,text,text,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.analytics_user_segments()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'activity', (
      with activity as (
        select p.id,
          greatest(
            (select max(occurred_at) from analytics_clean.web_events w where w.profile_id = p.id),
            (select max(created_at) from (select r.* from private.vitals_readings_current r where not exists (select 1 from public.profiles tp where tp.id = r.patient_id and tp.is_test)) v where v.patient_id = p.id),
            (select max(updated_at) from analytics_clean.ai_conversations a where a.profile_id = p.id)
          ) last_active
        from analytics_clean.profiles p where p.role = 'patient'
      )
      select jsonb_build_object(
        'total', count(*),
        'active_30d', count(*) filter (where last_active >= now() - interval '30 days'),
        'active_90d', count(*) filter (where last_active >= now() - interval '90 days'),
        'dormant_30d', count(*) filter (where last_active is null or last_active < now() - interval '30 days'),
        'dormant_90d', count(*) filter (where last_active is null or last_active < now() - interval '90 days'),
        'never_active', count(*) filter (where last_active is null)
      ) from activity
    ),
    'paying_patients', (
      select count(*) from (
        select patient_id from analytics_clean.service_purchases where status in ('active','expired')
        union
        select patient_id from analytics_clean.programme_purchases where status in ('active','completed','expired')
      ) t
    ),
    'by_product', (select coalesce(jsonb_agg(jsonb_build_object('product', product, 'users', users) order by users desc), '[]'::jsonb)
      from (select p.name product, count(distinct sp.patient_id) users
            from analytics_clean.service_purchases sp
            join public.service_products p on p.id = sp.service_product_id
            where sp.status in ('active','expired') group by p.name) t),
    'by_care_category', jsonb_build_array(
      jsonb_build_object('category','Chronic disease','users', (select count(distinct patient_id) from analytics_clean.care_plans where status='active')),
      jsonb_build_object('category','Preventive','users', (select count(distinct patient_id) from analytics_clean.preventive_programme_enrolments)),
      -- Pre-existing, unrelated break found while rewiring this function: it
      -- read public.lifestyle_programme_enrolments, which does not exist on
      -- this project, so analytics_user_segments() raised 42P01 for every
      -- analyst and /analytics/users rendered nothing at all. The lifestyle
      -- programme's real enrolment table is lpe_enrollments.
      jsonb_build_object('category','Lifestyle','users', (select count(distinct patient_id) from analytics_clean.lpe_enrollments)),
      jsonb_build_object('category','Care coordination','users', (
        select count(distinct pid) from (
          select patient_id pid from analytics_clean.lab_orders
          union select patient_id from analytics_clean.pharmacy_orders
          union select patient_id from analytics_clean.specialist_referrals
        ) c))
    ),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'users', c) order by c desc), '[]'::jsonb)
      from (select role::text role, count(*) c from analytics_clean.profiles group by role) t),
    'by_condition', (select coalesce(jsonb_agg(jsonb_build_object('condition', condition, 'users', c) order by c desc), '[]'::jsonb)
      from (select condition::text condition, count(distinct patient_id) c from analytics_clean.care_plans where status='active' group by condition) t),
    'by_state', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'users', c) order by c desc), '[]'::jsonb)
      from (select coalesce(state,'Unknown') state, count(*) c from analytics_clean.profiles where role='patient' group by coalesce(state,'Unknown')) t)
  );
end;
$function$;

revoke all on function public.analytics_user_segments() from public, anon;

grant execute on function public.analytics_user_segments() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_geo_health_aggregates()
 RETURNS TABLE(state text, patient_count integer, hypertension_high_count integer, diabetes_high_count integer, cvd_high_count integer, overdue_screening_count integer, suppressed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_min_cohort constant integer := 10;
begin
  if not private.is_analyst() then
    return query select null::text, null::integer, null::integer, null::integer, null::integer, null::integer, null::boolean
      where false;
    return;
  end if;

  return query
  with patients as (
    select p.id, lower(trim(p.state)) as state_key, p.state as state_label
    from analytics_clean.profiles p
    where p.role = 'patient'
      and p.state is not null
      and trim(p.state) <> ''
  ),
  latest_scores as (
    select distinct on (prs.profile_id, prs.condition)
      prs.profile_id, prs.condition, prs.tier
    from analytics_clean.prevention_risk_scores prs
    order by prs.profile_id, prs.condition, prs.computed_at desc
  ),
  overdue as (
    select ss.patient_id
    from analytics_clean.screening_schedules ss
    where ss.status = 'overdue'
  ),
  per_state as (
    select
      pt.state_key,
      max(pt.state_label) as state_label,
      count(distinct pt.id)::integer as patient_count,
      count(distinct ls.profile_id) filter (
        where ls.condition = 'hypertension' and ls.tier in ('high', 'very_high')
      )::integer as hypertension_high_count,
      count(distinct ls.profile_id) filter (
        where ls.condition = 'diabetes' and ls.tier in ('high', 'very_high')
      )::integer as diabetes_high_count,
      count(distinct ls.profile_id) filter (
        where ls.condition = 'cvd' and ls.tier in ('high', 'very_high')
      )::integer as cvd_high_count,
      count(distinct ov.patient_id)::integer as overdue_screening_count
    from patients pt
    left join latest_scores ls on ls.profile_id = pt.id
    left join overdue ov on ov.patient_id = pt.id
    group by pt.state_key
  )
  select
    ps.state_label,
    case when ps.patient_count < v_min_cohort then null else ps.patient_count end,
    case when ps.patient_count < v_min_cohort then null else ps.hypertension_high_count end,
    case when ps.patient_count < v_min_cohort then null else ps.diabetes_high_count end,
    case when ps.patient_count < v_min_cohort then null else ps.cvd_high_count end,
    case when ps.patient_count < v_min_cohort then null else ps.overdue_screening_count end,
    ps.patient_count < v_min_cohort as suppressed
  from per_state ps
  order by ps.state_label;
end;
$function$;

revoke all on function public.get_geo_health_aggregates() from public, anon;

grant execute on function public.get_geo_health_aggregates() to authenticated, service_role;

CREATE OR REPLACE FUNCTION private.refresh_analytics_snapshot_business_summary()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
    'total_orgs', (select count(*) from public.organisations),
    'active_orgs', (select count(*) from public.organisations where is_active),
    'total_profiles', (select count(*) from analytics_clean.profiles),
    'total_patients', (select count(*) from analytics_clean.profiles where role = 'patient'),
    'active_patients', (select count(*) from analytics_clean.profiles where role = 'patient' and is_active),
    'onboarded_patients', (select count(*) from analytics_clean.profiles where role = 'patient' and onboarding_completed_at is not null),
    'paid_purchases', (
      select count(*) from analytics_clean.service_purchases where status in ('active','expired')
    ) + (
      select count(*) from analytics_clean.programme_purchases where status in ('active','completed','expired')
    ),
    'paying_patients', (
      select count(*) from (
        select patient_id from analytics_clean.service_purchases where status in ('active','expired')
        union
        select patient_id from analytics_clean.programme_purchases where status in ('active','completed','expired')
      ) t
    ),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', c) order by c desc), '[]'::jsonb)
              from (select role::text as role, count(*) c from analytics_clean.profiles group by role) t),
    'org_types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'count', c) order by c desc), '[]'::jsonb)
                  from (select type::text as type, count(*) c from public.organisations group by type) t),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', c) order by c desc), '[]'::jsonb)
               from (select coalesce(state, 'Unknown') as state, count(*) c from analytics_clean.profiles where role = 'patient' group by coalesce(state, 'Unknown')) t)
  ) into v_payload;

  insert into analytics.rpc_snapshots (rpc_name, payload, computed_at)
  values ('analytics_business_summary', v_payload, now())
  on conflict (rpc_name) do update set
    payload = excluded.payload,
    computed_at = excluded.computed_at;
end;
$function$;

revoke all on function private.refresh_analytics_snapshot_business_summary() from public, anon;

grant execute on function private.refresh_analytics_snapshot_business_summary() to authenticated, service_role;

-- refresh the stored snapshot now so INV-13 holds immediately; guarded so a fresh replay without the table cannot abort
do $$ begin
  if to_regclass('analytics.rpc_snapshots') is not null then
    perform private.refresh_analytics_snapshot_business_summary();
  else
    raise notice 'OQ-39: analytics.rpc_snapshots absent, snapshot refresh skipped (the nightly job refreshes it)';
  end if;
end $$;

-- Retire analytics_clinical_rule_performance. Counted first (live, 2026-10-23): no caller in apps/, packages/ or supabase/functions
-- on main-dev, none in any branch's apps code (history search), no cron job, view or policy, and no other function body names it.
-- The assertion below repeats the function-body check so the drop cannot go through if that stops being true.
do $$
declare v_dep text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_dep from pg_proc p
  where p.prosrc ilike '%analytics_clinical_rule_performance%' and p.proname <> 'analytics_clinical_rule_performance';
  if v_dep is not null then raise exception 'OQ-39: analytics_clinical_rule_performance is referenced by %', v_dep; end if;
  if exists (select 1 from pg_class c where c.relkind in ('v','m') and pg_get_viewdef(c.oid) ilike '%analytics_clinical_rule_performance%') then
    raise exception 'OQ-39: a view references analytics_clinical_rule_performance'; end if;
end $$;
drop function if exists public.analytics_clinical_rule_performance(timestamp with time zone, timestamp with time zone);


do $$
declare v_leak text; v_bad int;
begin
  -- no re-created function still reads a filtered relation directly
  select string_agg(p.oid::regprocedure::text, ', ') into v_leak
  from pg_proc p
  join pg_class c on c.relnamespace = 'analytics_clean'::regnamespace and c.relkind = 'v'
  where ((p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_%')
         or p.oid in ('private.refresh_analytics_snapshot_business_summary()'::regprocedure, 'public.get_geo_health_aggregates()'::regprocedure))
    and p.proname not in ('analytics_patient_search','analytics_patient_activity','analytics_audit_log','analytics_log_patient_access','analytics_upsert_finance_input','analytics_upsert_risk')
    and regexp_replace(p.prosrc, 'from public\.profiles tp where tp\.id = r\.[a-z_]+ and tp\.is_test', '', 'g') ~ ('\m(public|private)\.' || c.relname || '\M[^(]');
  if v_leak is not null then raise exception 'OQ-39: still reads an unfiltered relation: %', v_leak; end if;
  -- every reference to an inline-filtered relation is wrapped in its filter
  select string_agg(p.oid::regprocedure::text, ', ') into v_leak from pg_proc p
  where ((p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_%')
         or p.oid in ('private.refresh_analytics_snapshot_business_summary()'::regprocedure, 'public.get_geo_health_aggregates()'::regprocedure))
    and p.proname not in ('analytics_patient_search','analytics_patient_activity','analytics_audit_log','analytics_log_patient_access','analytics_upsert_finance_input','analytics_upsert_risk')
    and regexp_count(p.prosrc, '(public\.audit_log|private\.vitals_readings_(current|diagnostic))(\M)')
        <> regexp_count(p.prosrc, 'from (public\.audit_log|private\.vitals_readings_(current|diagnostic)) r where not exists \(select 1 from public\.profiles tp');
  if v_leak is not null then raise exception 'OQ-39: an inline-filtered relation is read unwrapped by %', v_leak; end if;
  -- the views are not reachable by the API roles
  if has_schema_privilege('anon', 'analytics_clean', 'USAGE') or has_schema_privilege('authenticated', 'analytics_clean', 'USAGE') then
    raise exception 'OQ-39: analytics_clean must not be usable by anon or authenticated'; end if;
  select count(*) into v_bad from pg_class c
  where c.relnamespace = 'analytics_clean'::regnamespace and c.relkind = 'v'
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'));
  if v_bad > 0 then raise exception 'OQ-39: % analytics_clean views are selectable by anon/authenticated', v_bad; end if;
  -- grants unchanged: anon never, authenticated yes
  select count(*) into v_bad from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_%'
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then raise exception 'OQ-39: % analytics_* functions have the wrong EXECUTE grants', v_bad; end if;
end $$;
