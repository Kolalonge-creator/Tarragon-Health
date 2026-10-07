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

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.queue_next(text[])'::regprocedure) into v_def;
  v_new := replace(v_def,
    'order by c.priority_class, (c.state <> ''offered_to_lead''), c.due_at, c.created_at',
    'order by c.priority_class, (c.state <> ''offered_to_lead''), ct.trigger_severity desc, c.due_at, c.created_at');
  if v_new = v_def or position('ct.trigger_severity desc' in v_new) = 0 then
    raise exception 'queue_next did not have the expected ordering to replace';
  end if;
  execute v_new;
end $$;

-- Assertions: grants unchanged, ordering key present, the column defaults to 0.
do $$
begin
  if has_function_privilege('anon', 'public.queue_next(text[])', 'EXECUTE') then raise exception 'S76 B3: anon can execute queue_next'; end if;
  if not has_function_privilege('authenticated', 'public.queue_next(text[])', 'EXECUTE') then raise exception 'S76 B3: authenticated lost queue_next'; end if;
  if position('ct.trigger_severity desc' in pg_get_functiondef('public.queue_next(text[])'::regprocedure)) = 0 then raise exception 'S76 B3: ordering not applied'; end if;
  if position('skip locked' in pg_get_functiondef('public.queue_next(text[])'::regprocedure)) = 0 then raise exception 'S76 B3: claim lock lost'; end if;
  if exists (select 1 from public.clinical_tasks where trigger_severity <> 0) then raise exception 'S76 B3: an existing task was given a severity'; end if;
  if position('risk' in lower(pg_get_functiondef('public.queue_next(text[])'::regprocedure))) > 0 then raise exception 'S76 B3: queue_next must not consult risk'; end if;
end $$;
