-- S76 B3 (part 2): the queue's second ordering key, applied to queue_next as it stands after the S16-S20 task layer.
-- The column, the before-insert trigger and the zero default are in 20261007160011. Here only the ORDER BY changes:
-- priority_class, offered_to_lead, trigger_severity desc, due_at, created_at. Patched in place from the live text; it fails loudly if
-- the ordering line is not found. The patient's risk score is NOT consulted (risk never gates).

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

-- Assertions: grants unchanged, ordering key present.
do $$
begin
  if has_function_privilege('anon', 'public.queue_next(text[])', 'EXECUTE') then raise exception 'S76 B3: anon can execute queue_next'; end if;
  if not has_function_privilege('authenticated', 'public.queue_next(text[])', 'EXECUTE') then raise exception 'S76 B3: authenticated lost queue_next'; end if;
  if position('ct.trigger_severity desc' in pg_get_functiondef('public.queue_next(text[])'::regprocedure)) = 0 then raise exception 'S76 B3: ordering not applied'; end if;
  if position('skip locked' in pg_get_functiondef('public.queue_next(text[])'::regprocedure)) = 0 then raise exception 'S76 B3: claim lock lost'; end if;
  if position('risk' in lower(pg_get_functiondef('public.queue_next(text[])'::regprocedure))) > 0 then raise exception 'S76 B3: queue_next must not consult risk'; end if;
end $$;
