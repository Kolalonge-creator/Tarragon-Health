-- Real bug found while testing: revoke_care_access() (the existing "Withdraw access"
-- feature) deletes the parent profile_access row directly, which cascades into
-- profile_access_categories via ON DELETE CASCADE. private.enforce_category_access_owner()
-- looks up the owner via `select profile_id from profile_access where id = ...`, but by the
-- time the cascade fires, the parent row is already invisible to that lookup under normal
-- MVCC/READ COMMITTED semantics (its own deletion, in the same statement, has already set
-- its xmax) -- so v_owner comes back null, and `v_uid is distinct from null` is always true,
-- wrongly blocking even the legitimate owner's full grant revocation.
--
-- Fix: treat a null owner lookup (the grant is gone, i.e. we are mid-cascade) as "allow" --
-- safe because every real path that reaches this trigger already enforced ownership
-- upstream before ever touching profile_access_categories: set_care_access_categories()
-- checks v_owner <> auth.uid() itself before touching this table at all (no cascade
-- involved, so the parent always exists there), and a cascading delete is only reachable
-- after profile_access's own RLS DELETE policy / revoke_care_access()'s explicit caller
-- check already passed. This trigger's real job is "does the caller own this grant", not
-- "does this profile_access_id exist" -- the FK constraint itself already enforces that on
-- insert (an orphan profile_access_id is rejected by the foreign key regardless of what this
-- trigger does).

create or replace function private.enforce_category_access_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_owner uuid;
  v_uid   uuid := (select auth.uid());
begin
  select profile_id into v_owner from public.profile_access
    where id = coalesce(new.profile_access_id, old.profile_access_id);

  if v_owner is null then
    -- The parent grant no longer exists to look up -- this is the cascade-from-
    -- parent-delete case, already authorised upstream. Nothing to check here.
    return coalesce(new, old);
  end if;

  if v_uid is null or v_uid is distinct from v_owner then
    raise exception
      'only the person whose record it is may change who can see their health information'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$function$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where proname = 'enforce_category_access_owner' and pronamespace = 'private'::regnamespace;
  if v_def not like '%v_owner is null%' then
    raise exception 'enforce_category_access_owner was not updated with the cascade-safe null check';
  end if;
end $$;
