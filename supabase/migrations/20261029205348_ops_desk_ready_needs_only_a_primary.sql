-- The ops desk is "ready" with a primary contact and the required checklist items; a deputy is welcome later but is not needed to start.
--
-- WHY. private.ops_desk_org_ready (the one readiness check the on_call_cover_ok guard trigger reads) required an active primary AND an active
-- deputy contact AND all four checklist items, including "Deputy cover". For a first launch with one named ops person that blocked the cover guard
-- (and so every enforcing capacity version) behind a second admin account that does not exist. The founder's decision (2026-10-29): a deputy is not
-- needed to start; add one later.
--
-- WHAT CHANGES (and what does not):
--   * ops_desk_checklist_items gains required_to_start (default true). deputy_cover is set to false: the statement can still be made and is still shown,
--     it just no longer holds the org back. The other three items (backup power, second internet link, tested contact numbers) stay required.
--   * ops_desk_org_ready: every REQUIRED item needs a fresh "in place" statement, and an active primary contact must exist. The deputy contact test is
--     removed. Freshness (checklist_max_age_days), test/real separation and the usable-contact rule are exactly as before.
--   * NOT changed: checklist_gates_readiness (the CMO's signed config) still gates the guard; the primary still needs a verified phone and hours;
--     the sweeper still opens a "no deputy" incident when a page needs a deputy and none is on duty, so a missing deputy stays visible.
--
-- DEFINITION TAKEN FROM THE LIVE FUNCTION (read 2026-10-29). Counted first: ops_desk_checklist_items has 4 rows; 0 real attestations and 0 real
-- contacts exist, so nothing is converted.
alter table public.ops_desk_checklist_items add column if not exists required_to_start boolean not null default true;
update public.ops_desk_checklist_items set required_to_start = false where item_key = 'deputy_cover';
update public.ops_desk_checklist_items set detail = 'Optional to start; add one when you can. A named deputy can take the phone calls when the primary cannot, for the hours the primary is not working.' where item_key = 'deputy_cover';

create or replace function private.ops_desk_org_ready(p_org uuid, p_test boolean default false)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select not exists (
           select 1 from public.ops_desk_checklist_items it
            where it.required_to_start
              and not exists (
              select 1 from (select a.state, a.attested_at from public.ops_desk_checklist_attestations a
                              where a.organisation_id = p_org and a.item_key = it.item_key and a.is_test = p_test
                              order by a.attested_at desc limit 1) l
               where l.state = 'in_place' and l.attested_at > now() - make_interval(days => coalesce(private.ops_desk_rule('checklist_max_age_days'), 90))))
     and exists (select 1 from public.ops_desk_contacts c where c.organisation_id = p_org and c.is_test = p_test and c.role = 'primary' and private.ops_desk_contact_usable(c.id))
$function$;

do $$
begin
  if (select count(*) from public.ops_desk_checklist_items where not required_to_start) <> 1
     or not exists (select 1 from public.ops_desk_checklist_items where item_key = 'deputy_cover' and not required_to_start) then
    raise exception 'only deputy_cover may be optional to start';
  end if;
  if pg_get_functiondef('private.ops_desk_org_ready(uuid,boolean)'::regprocedure) like '%deputy%' then
    raise exception 'ops_desk_org_ready must not test for a deputy';
  end if;
  if has_function_privilege('anon', 'private.ops_desk_org_ready(uuid,boolean)', 'EXECUTE') or has_function_privilege('authenticated', 'private.ops_desk_org_ready(uuid,boolean)', 'EXECUTE') then
    raise exception 'private.ops_desk_org_ready must stay closed to anon and authenticated';
  end if;
end $$;
