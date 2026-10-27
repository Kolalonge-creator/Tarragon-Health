-- Membership Plus that arrives without a checkout still gets a collection state (founder decision 2026-10-26, OQ-PLUS-1).
--
-- Plus can be created without create_order: an employer seat (private.grant_org_seat), an admin grant (grant_membership_tier), a legacy
-- conversion. Those rows have patient_memberships.collection_state null, so nobody knows where to arrange the person's blood collection.
--   1. grant_membership_tier gains a trailing p_collection_state (default null). While the module membership_two_member_tiers is ON, granting
--      Plus needs an approved state (the admin knows the person's state). The old four-argument function is dropped so a call is never
--      ambiguous. While the module is off an approved state is still kept if given, but nothing is required. Granting Membership (evergreen)
--      ignores the argument and stores nothing.
--   2. public.set_my_plus_collection_state(state): a member whose live Plus has no state picks one from the approved list ONCE (seats, legacy
--      rows, and grants made while the module was off). Once set it cannot be changed here, same rule as a state chosen at checkout.
--      Employer seats are covered by this path: the roster row carries no state, the member chooses on first use.
-- ROLLBACK: restore the four-argument grant_membership_tier from 20261021111904 and drop set_my_plus_collection_state.

drop function if exists public.grant_membership_tier(uuid, text, text, timestamptz);

create function public.grant_membership_tier(p_patient uuid, p_tier text, p_reason text, p_ends_at timestamptz default null, p_collection_state text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_state text := nullif(btrim(coalesce(p_collection_state, '')), '');
begin
  if p_tier is null or p_tier not in ('evergreen', 'plus') then raise exception 'membership_tier_invalid' using errcode = '22023'; end if;
  -- every authorisation, reason and overlap rule is grant_membership's own, and it runs FIRST so a caller who may not grant is told that
  -- (and nothing is written: a refusal below rolls this whole call back)
  v_id := public.grant_membership(p_patient, p_reason, p_ends_at);
  if p_tier = 'plus' and private.plus_needs_state('membership_annual') then
    if v_state is null then raise exception 'plus_state_required' using errcode = 'P0001'; end if;
    if not private.plus_collection_state_enabled(v_state) then raise exception 'plus_state_not_available' using errcode = 'P0001'; end if;
  elsif p_tier = 'plus' and v_state is not null and private.plus_collection_state_enabled(v_state) then
    null; -- module off: an approved state the admin chose is still kept, so switching the module on later loses nothing
  else
    v_state := null;
  end if;
  update public.patient_memberships set tier = p_tier, collection_state = v_state where id = v_id;
  return v_id;
end $$;
revoke all on function public.grant_membership_tier(uuid, text, text, timestamptz, text) from public, anon;
grant execute on function public.grant_membership_tier(uuid, text, text, timestamptz, text) to authenticated;

create function public.set_my_plus_collection_state(p_state text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_state text := nullif(btrim(coalesce(p_state, '')), '');
  m public.patient_memberships%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_state is null then raise exception 'plus_state_required' using errcode = 'P0001'; end if;
  select * into m from public.patient_memberships
   where patient_id = v_uid and state = 'active' and tier = 'plus' and (ends_at is null or ends_at > now())
   order by starts_at desc limit 1 for update;
  if not found then raise exception 'plus_membership_not_found' using errcode = 'P0001'; end if;
  if m.collection_state is not null then raise exception 'plus_state_already_set' using errcode = 'P0001'; end if;
  if not private.plus_collection_state_enabled(v_state) then raise exception 'plus_state_not_available' using errcode = 'P0001'; end if;
  update public.patient_memberships set collection_state = v_state where id = m.id;
  perform private.log_audit('membership.plus_state_set', 'patient_memberships', m.id, jsonb_build_object('state', v_state));
end $$;
revoke all on function public.set_my_plus_collection_state(text) from public, anon;
grant execute on function public.set_my_plus_collection_state(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.grant_membership_tier(uuid,text,text,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_my_plus_collection_state(text)', 'EXECUTE') then raise exception 'self-check: anon can execute'; end if;
  if (select count(*) from pg_proc where proname = 'grant_membership_tier' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'self-check: expected exactly one grant_membership_tier';
  end if;
end $$;
