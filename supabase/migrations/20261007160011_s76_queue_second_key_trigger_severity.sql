-- S76 B3: the queue's second ordering key. Within one priority class, and after tasks offered to their lead, the more
-- severe trigger is offered first: priority_class, offered_to_lead, trigger_severity desc, due_at, created_at.
--
--   * clinical_tasks.trigger_severity smallint not null default 0. Set when the task is created from its triage event:
--     red 3, amber 2, green 1, anything else 0. A before-insert trigger does it so private.create_clinical_task() and its
--     many callers are not redefined. A task created some other way keeps 0 and sorts by due time exactly as before.
--   * queue_next: only the ORDER BY changes. The function body is taken from the live definition and the one ordering
--     line is replaced, so the claim filters (membership, lead window, tier, competencies, caps) and the claim atomicity
--     (for update skip locked) are exactly what S22b left. The patient's risk score is NOT consulted (risk never gates).
-- Counts: existing open tasks all get severity 0 (the default), so today's order is unchanged until new tasks arrive.

alter table public.clinical_tasks add column trigger_severity smallint not null default 0 check (trigger_severity between 0 and 3);

create function private.set_task_trigger_severity() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.triage_event_id is not null then
    select case te.grade when 'red' then 3 when 'amber' then 2 when 'green' then 1 else 0 end into new.trigger_severity
      from public.triage_events te where te.id = new.triage_event_id;
    new.trigger_severity := coalesce(new.trigger_severity, 0);
  end if;
  return new;
end;
$$;
revoke all on function private.set_task_trigger_severity() from public, anon, authenticated;
create trigger clinical_tasks_set_trigger_severity before insert on public.clinical_tasks
  for each row execute function private.set_task_trigger_severity();

-- (The queue_next ordering change is in 20261015034113_s76_queue_second_key_order.sql: the S16-S20 task layer, dated later,
-- replaced queue_next whole, so the patch has to be applied after it.)

-- Assertions: the column defaults to 0.
do $$
begin
  if exists (select 1 from public.clinical_tasks where trigger_severity <> 0) then raise exception 'S76 B3: an existing task was given a severity'; end if;
end $$;
