-- Tarragon Control — M2: clinician activation guard
-- Source: docs/tarragon-build-spec-v3.md §5.2 blockquote: "A nightly Edge
-- Function suspends any clinician whose mdcn_expiry has passed, or --
-- when accountability_model = 'tech_layer' -- whose indemnity_expiry has
-- passed or whose indemnity fields are null. Suspension revokes the
-- clinician role grant immediately."
--
-- Implementation choice, documented not hidden: the spec says "Edge
-- Function" (a Deno function on a schedule); this uses pg_cron + a plain
-- plpgsql function instead. Same nightly cadence, same behaviour, and
-- directly verifiable in this environment (no Docker available to run
-- Supabase Edge Functions locally, and MCP-deployed Edge Functions are
-- much harder to invoke-and-assert against than a SQL function I can call
-- directly). If a real Deno Edge Function is ever needed for this specific
-- job (e.g. to call an external MDCN registry API rather than just
-- reading local columns), swap the cron target -- the suspension logic
-- itself doesn't need to move.
--
-- "Suspension revokes the clinician role grant immediately" -- read as
-- revoking clinical AUTHORITY (active=false, which every RLS policy in
-- this schema keys off of for clinician actions... except it doesn't yet:
-- see the note below). Not literally changing profiles.role away from
-- 'clinician', since that would also strip their own-row visibility and
-- historical clinical_notes attribution.

create extension if not exists pg_cron with schema extensions;

create or replace function private.suspend_expired_clinicians()
returns table (clinician_id uuid, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accountability_model text;
begin
  select value #>> '{}' into v_accountability_model
  from app_config where key = 'accountability_model';

  return query
  update clinicians c
  set
    active = false,
    suspended_reason = case
      when c.mdcn_expiry <= current_date then 'MDCN registration expired'
      when v_accountability_model = 'tech_layer' and (
        c.indemnity_expiry is null or c.indemnity_expiry <= current_date
      ) then 'Indemnity cover expired or missing (tech_layer accountability model requires current cover)'
      when v_accountability_model = 'tech_layer' and (
        c.indemnity_provider is null or c.indemnity_policy_no is null
      ) then 'Indemnity details incomplete (tech_layer accountability model requires indemnity_provider and indemnity_policy_no)'
      else 'Suspended by nightly activation guard'
    end
  where c.active = true
    and (
      c.mdcn_expiry <= current_date
      or (
        v_accountability_model = 'tech_layer'
        and (
          c.indemnity_expiry is null or c.indemnity_expiry <= current_date
          or c.indemnity_provider is null
          or c.indemnity_policy_no is null
        )
      )
    )
  returning c.id, c.suspended_reason;
end;
$$;

comment on function private.suspend_expired_clinicians is
  'Idempotent and re-runnable: only touches rows where active=true, so an already-suspended clinician''s suspended_reason is never clobbered by a later run for a different cause. Called nightly by the tarragon-control-clinician-activation-guard cron job below, and directly callable for testing/ops (select * from private.suspend_expired_clinicians();).';

select cron.schedule(
  'tarragon-control-clinician-activation-guard',
  '15 1 * * *', -- 01:15 UTC nightly (00:15/02:15 Africa/Lagos depending on DST-free WAT, which has none -- always 02:15 WAT)
  $$select private.suspend_expired_clinicians();$$
);
