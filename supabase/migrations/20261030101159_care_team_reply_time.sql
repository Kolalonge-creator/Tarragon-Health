-- "How quickly does the care team reply": one honest number for the Messages screen (design audit, Messages).
--
-- Definition, so the figure cannot flatter: take each patient message that starts a run (the previous message in its thread was not
-- also the patient's), leave out messages flagged as a possible emergency (those take a different route), and find the first reply in
-- that thread written by a named member of the care team (author_profile_id is set, so an automatic notice never counts). The figure is
-- the median of those gaps over the last 30 days, for the caller's own organisation.
--
-- It is shown only when it is trustworthy: at least 10 answered messages, and no more than 1 in 5 of the messages older than 48 hours
-- still unanswered. Otherwise it answers "not available" and the screen shows nothing. It returns one aggregate and no message text,
-- patient or clinician, so it needs no per-patient access. It is a description of recent replies, not a promise, and the screen says so.

create function public.care_team_reply_time()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with msgs as (
    select m.id, m.thread_id, m.author_role, m.created_at, m.author_profile_id, m.flagged_potential_emergency,
           lag(m.author_role) over (partition by m.thread_id order by m.created_at, m.id) as prev_role
      from public.care_messages m
     where m.organisation_id = private.current_org_id()
       and m.created_at >= now() - interval '30 days'
  ),
  starts as (
    select s.id, s.thread_id, s.created_at,
           (select min(r.created_at) from msgs r
             where r.thread_id = s.thread_id and r.author_role = 'care_team' and r.author_profile_id is not null
               and r.created_at > s.created_at) as replied_at
      from msgs s
     where s.author_role = 'patient' and s.prev_role is distinct from 'patient' and not s.flagged_potential_emergency
  ),
  agg as (
    select count(*) filter (where replied_at is not null) as answered,
           count(*) filter (where replied_at is null and created_at < now() - interval '48 hours') as stale_unanswered,
           percentile_cont(0.5) within group (order by extract(epoch from (replied_at - created_at)) / 60.0)
             filter (where replied_at is not null) as median_minutes
      from starts
  )
  select case
           when private.current_org_id() is null then jsonb_build_object('available', false)
           when answered >= 10 and stale_unanswered <= 0.2 * (answered + stale_unanswered)
             then jsonb_build_object('available', true, 'median_minutes', round(median_minutes)::integer, 'replies', answered, 'window_days', 30)
           else jsonb_build_object('available', false)
         end
    from agg;
$$;

revoke all on function public.care_team_reply_time() from public, anon;
grant execute on function public.care_team_reply_time() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.care_team_reply_time()', 'EXECUTE') then
    raise exception 'anon must not run care_team_reply_time';
  end if;
  if not has_function_privilege('authenticated', 'public.care_team_reply_time()', 'EXECUTE') then
    raise exception 'authenticated must run care_team_reply_time';
  end if;
end $$;
