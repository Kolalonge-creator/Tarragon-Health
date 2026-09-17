-- Patient-messages "awaiting reply" count for the pending-jobs banner /
-- clinician nav badge. A thread is awaiting a reply when its last message
-- came from the patient's (or sponsor's) side and no care-team member has
-- opened it since -- exactly message-triage.ts's isAwaitingCareTeam(), which
-- compares care_team_last_read_at to last_message_at. That's a column-vs-
-- column comparison PostgREST's query-string filters cannot express (they
-- only compare a column to a supplied literal), hence the RPC rather than a
-- .select().eq()/.lt() chain like every other WorklistCountKey.
--
-- security invoker (not definer): RLS on care_message_threads already scopes
-- correctly per caller (patient sees their own thread, org staff sees their
-- org's), so invoker mode gets the right per-caller count for free, same as
-- every plain-select counter in worklist-counts.ts.
create or replace function public.count_care_threads_awaiting_reply()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.care_message_threads
  where status = 'open'
    and last_message_author_role is not null
    and last_message_author_role <> 'care_team'
    and (care_team_last_read_at is null or care_team_last_read_at < last_message_at);
$$;

grant execute on function public.count_care_threads_awaiting_reply() to authenticated;
