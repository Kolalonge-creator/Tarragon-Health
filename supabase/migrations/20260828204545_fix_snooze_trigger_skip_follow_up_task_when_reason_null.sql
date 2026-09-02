create or replace function private.stamp_clinician_alert_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  if new.status = 'acknowledged' and old.status <> 'acknowledged'
     and new.responsible_clinician_id is null and v_staff_id is not null then
    new.responsible_clinician_id := v_staff_id;
    new.assigned_at := coalesce(new.assigned_at, now());
  end if;

  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_by := v_staff_id;
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif old.status in ('resolved', 'closed') then
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  end if;

  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_by := v_staff_id;
    new.closed_at := coalesce(new.closed_at, now());
  elsif old.status = 'closed' then
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
  end if;

  if new.snoozed_until is distinct from old.snoozed_until then
    if new.snoozed_until is not null and old.status in ('resolved', 'closed') then
      raise exception 'Cannot snooze a resolved or closed alert' using errcode = '23514';
    end if;

    if new.snoozed_until is not null then
      new.snoozed_by := v_staff_id;
      new.status := 'snoozed';

      if new.snooze_reason is not null then
        insert into public.alert_follow_up_tasks
          (organisation_id, clinician_alert_id, patient_id, due_at, reason, created_by)
        values
          (new.organisation_id, new.id, new.patient_id, new.snoozed_until, new.snooze_reason, v_staff_id);
      end if;
    else
      new.snoozed_by := null;
      new.snooze_reason := null;
      if old.status = 'snoozed' then
        new.status := 'open';
      end if;
    end if;
  elsif old.snoozed_until is not null then
    new.snoozed_by := old.snoozed_by;
  end if;

  return new;
end;
$$;

comment on function private.stamp_clinician_alert_lifecycle() is
  'BEFORE UPDATE on clinician_alerts. Server-derives responsible_clinician_id (self-assign on first acknowledge if unowned), resolved_by/resolved_at, closed_by/closed_at, and snoozed_by from the caller''s own active clinical_staff record -- never client-supplied, never re-stamped by a later unrelated edit. Snoozing also creates a real alert_follow_up_tasks row (8.10) when a reason is present -- a null reason is left to fail on clinician_alerts_snooze_requires_reason instead. Un-snoozing (snoozed_until cleared) returns status to ''open'' unconditionally rather than restoring a remembered pre-snooze status, a deliberate simplification: the clinician re-acknowledges if needed.';
