-- S27g: the task history said "directly by a tied clinician" even when the lab replaced the result (S27f review). When no clinician
-- acted (the actor is null) the reason now names only what happened.
create or replace function private.lab_close_tasks(p_result uuid, p_actor uuid, p_verb text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype;
begin
  for t in select * from public.clinical_tasks
            where dedup_key like 'lab_result:' || p_result::text || '%' and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed') loop
    if t.state = 'claimed' then
      -- only the clinician who holds the claim completes it; a claim held by someone else is theirs to finish
      if p_actor is not null and t.claimed_by = p_actor then
        perform private.apply_task_transition(t.id, 'completed', 'clinician', p_actor, null, null, null, jsonb_build_object('lab_result', p_verb));
      end if;
    else
      perform private.apply_task_transition(t.id, 'cancelled', 'lead', p_actor,
        case when p_actor is null then 'The result was ' || p_verb else 'The result was ' || p_verb || ' directly by a tied clinician' end);
    end if;
  end loop;
end;
$$;
revoke all on function private.lab_close_tasks(uuid, uuid, text) from public, anon, authenticated;
