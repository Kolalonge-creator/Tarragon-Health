-- Tarragon Health — Result Lifecycle §58.18 (Result audit): "Track result
-- received, who reviewed, when, action, communication, closure." Reviewed/
-- action/communication/closure are covered by screening_results.reviewed_by/
-- reviewed_at/action_type/patient_informed_at (20260829122500) and by
-- private.apply_screening_result_recall's own effect on screening_schedules
-- (20260829121900) — but "result received" itself had no audit_log row at
-- all unless the result happened to be abnormal/critical (screening_upgrades
-- only fires for those two
-- statuses, per private.handle_abnormal_screening_result). A normal,
-- borderline, or indeterminate result — the majority of results — left no
-- trace in audit_log that it was ever received.

create or replace function private.audit_screening_result_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, (select auth.uid()), 'result.received', 'screening_result', new.id,
    jsonb_build_object(
      'patient_id', new.patient_id,
      'screen_type_code', new.screen_type_code,
      'result_status', new.result_status
    )
  );
  return new;
end;
$$;

drop trigger if exists screening_results_audit_received on public.screening_results;
create trigger screening_results_audit_received
  after insert on public.screening_results
  for each row execute function private.audit_screening_result_received();

revoke all on function private.audit_screening_result_received() from public;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'screening_results_audit_received') then
    raise exception 'screening_results_audit_received trigger was not created';
  end if;
end $$;
