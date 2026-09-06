-- Fix the `raise-stale-urgent-referral-alerts` cron, which has failed on EVERY
-- run since it was created (7 runs, 0 successes, first 2026-08-29 04:30 UTC).
--
-- Live error, every night:
--   ERROR: function private.raise_clinician_alert(uuid, uuid, text, unknown,
--          text, unknown, unknown) does not exist
--
-- The real signature is
--   private.raise_clinician_alert(uuid, uuid, alert_level, text, text,
--                                 alert_category, alert_type_code)
--
-- Nothing is semantically wrong with the call: 'urgent_escalation' and
-- 'clinician_review' are both real `alert_level` values, 'care_management' is a
-- real `alert_category`, and 'failed_referral' is a real `alert_type_code`. The
-- failure is purely type resolution. A CASE whose branches are two bare string
-- literals resolves to `text`, and Postgres will not implicitly cast `text` to
-- an enum when resolving a function call, so the third argument never matches.
-- (The other two literals stay `unknown` and would have coerced on their own,
-- which is why only the CASE broke it.)
--
-- Consequence while broken: an urgent or priority specialist referral with no
-- treatment plan and no outcome document after 7 days raised NO clinician alert,
-- ever. That is the "referral disappeared into a void" failure mode, which is
-- exactly what this job exists to catch.
--
-- The body below is the live definition verbatim with explicit casts added and
-- nothing else changed. Casts are schema-qualified because the function runs
-- with `search_path = ''`.

create or replace function private.raise_stale_urgent_referral_alerts()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.raise_clinician_alert(
    sr.organisation_id, sr.patient_id,
    (case when sr.urgency = 'urgent' then 'urgent_escalation' else 'clinician_review' end)::public.alert_level,
    'Referral needs follow-up',
    format('A %s referral (%s) has had no specialist outcome recorded since %s.',
      sr.urgency, sr.specialist_type, to_char(sr.created_at, 'YYYY-MM-DD')),
    'care_management'::public.alert_category,
    'failed_referral'::public.alert_type_code
  )
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined', 'draft')
    and sr.urgency in ('urgent', 'priority')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '7 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'failed_referral' and ca.patient_id = sr.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$function$;

-- Prove the call now resolves. Before this migration the PERFORM raised
-- 42883 the moment the statement was planned; a clean run is the assertion.
do $$
begin
  perform private.raise_stale_urgent_referral_alerts();
  raise notice 'raise_stale_urgent_referral_alerts() resolved and ran cleanly';
end $$;
