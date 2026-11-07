-- ===========================================================================
-- Doctor-workspace follow-ups (founder, 2026-11-07: "fix all these").
--
-- 1. A monitoring case that returns by itself now tells the doctor (DW-11 follow-up). private.return_due_escalation_monitoring
--    (20261106191528) moved due cases back to under_review silently; it now writes one in-app notice per returned case to the
--    assigned doctor, or to each active Chief Medical Officer of the organisation when nobody holds the case. Fixed wording, no
--    patient and nothing clinical (INV-07): template 'escalation_monitoring_returned', payload {escalation_id}; the wording lives in
--    apps/web/src/lib/notifications/describe-in-app.ts. A failure to notify never undoes the return (it is logged to audit_log).
--
-- 2. Nobody deletes an escalation through the API. Live public.escalations carried an escalations_delete policy
--    (private.is_org_staff(organisation_id)) that is in NO migration file (found 2026-11-06 while building DW-03): any staff account,
--    a care coordinator included, could delete a clinical case and its history. No app code, RPC or proof deletes escalations
--    (checked 2026-11-07), and retention purges run as the table owner, so the policy is dropped and DELETE is revoked from the API roles.
-- ===========================================================================

-- 1 --------------------------------------------------------------------------------------------------------------------------------
create or replace function private.return_due_escalation_monitoring()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    update public.escalations e
       set status = 'under_review',
           status_note = 'Monitoring period ended '
             || to_char(e.monitor_until at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI')
             || '. Back for review.'
     where e.status = 'monitoring' and e.monitor_until <= now()
    returning e.id, e.organisation_id, e.assigned_doctor_id
  loop
    v_count := v_count + 1;
    begin
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      select recipient, r.organisation_id, 'in_app', 'escalation_monitoring_returned',
             jsonb_build_object('escalation_id', r.id), 'pending', 'non_clinical', 'routine', 'escalations', r.id
        from (
          select r.assigned_doctor_id as recipient where r.assigned_doctor_id is not null
          union
          select cs.profile_id from public.clinical_staff cs
           where r.assigned_doctor_id is null
             and cs.organisation_id = r.organisation_id and cs.active and cs.profile_id is not null
             and cs.doctor_tier = 'chief_medical_officer'
        ) recipients;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'escalation.monitoring_return_notify_failed', 'escalation', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return v_count;
end;
$function$;

revoke all on function private.return_due_escalation_monitoring() from public, anon, authenticated;

-- 2 --------------------------------------------------------------------------------------------------------------------------------
drop policy if exists escalations_delete on public.escalations;
revoke delete on table public.escalations from anon, authenticated;

-- Self-check ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'escalations' and cmd = 'DELETE') then
    raise exception 'follow-up self-check: a DELETE policy remains on public.escalations';
  end if;
  if has_table_privilege('authenticated', 'public.escalations', 'DELETE') or has_table_privilege('anon', 'public.escalations', 'DELETE') then
    raise exception 'follow-up self-check: an API role can still delete escalations';
  end if;
  if pg_get_functiondef('private.return_due_escalation_monitoring()'::regprocedure) !~ 'escalation_monitoring_returned' then
    raise exception 'follow-up self-check: the monitoring return does not notify';
  end if;
end;
$$;
