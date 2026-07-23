-- Sponsor path: lazily create/fetch the wallet of a profile the caller is
-- authorised to fund (same authorization as wallet_topups' INSERT RLS —
-- private.can_fund_wallet: self, family_plan_members link either direction,
-- or a profile_access grant).
create or replace function public.get_or_create_wallet_for(p_profile uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_wallet uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  v_wallet := private.ensure_wallet(p_profile);
  if not private.can_fund_wallet(v_wallet, v_caller) then
    raise exception 'not authorised to fund this wallet' using errcode = '42501';
  end if;
  return v_wallet;
end;
$$;

revoke execute on function public.get_or_create_wallet_for(uuid) from public, anon;
grant execute on function public.get_or_create_wallet_for(uuid) to authenticated;
