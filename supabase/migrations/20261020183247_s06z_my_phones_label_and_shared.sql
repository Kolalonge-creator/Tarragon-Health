-- S06z (patient "My phones" screen). The lease table already lets a patient read their own phones and the RPC
-- request_offline_device_wipe already lets them report one of their OWN phones lost, so no wipe-request RPC is added.
-- What was missing: a name the patient recognises and a "shared phone" mark. Two additive columns on offline_device_leases (no row
-- is converted: both default to "not set") and one RPC that only ever touches the caller's own, not-yet-wiped phone.
-- offline_device_leases stays patient-registered state (S39d registry row unchanged: no new table). Applied by the merge pipeline.

alter table public.offline_device_leases
  add column if not exists device_label text check (device_label is null or char_length(device_label) between 1 and 40),
  add column if not exists shared_phone boolean not null default false;

create function public.update_my_offline_device(p_device uuid, p_label text default null, p_shared boolean default null,
                                                p_clear_label boolean default false)
returns boolean
language plpgsql volatile security definer set search_path = '' as
$$
declare v_me uuid := (select auth.uid()); v_row public.offline_device_leases%rowtype; v_label text;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_row from public.offline_device_leases where device_id = p_device and account_id = v_me;
  if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
  if v_row.revoked_at is not null or v_row.wipe_confirmed_at is not null then raise exception 'this phone has been removed' using errcode = '42501'; end if;
  v_label := nullif(btrim(coalesce(p_label, '')), '');
  if v_label is not null and (char_length(v_label) > 40 or v_label ~ '[[:cntrl:]]') then
    raise exception 'bad name' using errcode = '22023';
  end if;
  update public.offline_device_leases
     set device_label = case when coalesce(p_clear_label, false) then null when v_label is not null then v_label else device_label end,
         shared_phone = coalesce(p_shared, shared_phone)
   where device_id = p_device and account_id = v_me;
  -- The audit row records WHAT changed, never the free-text name.
  perform private.log_audit('offline_device_details_updated', 'offline_device_leases', v_me,
    jsonb_build_object('renamed', v_label is not null or coalesce(p_clear_label, false), 'shared', p_shared));
  return true;
end $$;
revoke all on function public.update_my_offline_device(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.update_my_offline_device(uuid, text, boolean, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.update_my_offline_device(uuid, text, boolean, boolean)', 'EXECUTE') then
    raise exception 'S06z: anon can execute'; end if;
  if not has_function_privilege('authenticated', 'public.update_my_offline_device(uuid, text, boolean, boolean)', 'EXECUTE') then
    raise exception 'S06z: authenticated cannot execute'; end if;
  if has_table_privilege('authenticated', 'public.offline_device_leases', 'UPDATE') then
    raise exception 'S06z: authenticated gained a direct write'; end if;
end $$;
