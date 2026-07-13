-- Tarragon Health
-- Family Plan member cap (Sprint 6) — pricing.ts: "covers up to 4 people...
-- Extra members: +N30,000/year each, up to 6 people total." Enforced at the
-- DB level rather than only in application code, same posture as the rest
-- of this sprint's money-adjacent invariants.
create or replace function private.validate_family_plan_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_count integer;
  v_extra_addons integer;
  v_limit integer;
begin
  select count(*) into v_current_count
    from public.family_plan_members
    where plan_owner_id = new.plan_owner_id;

  select count(*) into v_extra_addons
    from public.subscription_add_ons sao
    join public.add_ons a on a.id = sao.add_on_id
    join public.subscriptions s on s.id = sao.subscription_id
    where s.subscriber_id = new.plan_owner_id
      and a.code = 'extra-family-member'
      and sao.status in ('active', 'trialing');

  v_limit := 4 + v_extra_addons;

  if v_current_count >= v_limit then
    raise exception 'family_plan_member_limit_reached: % of % members (attach an Extra Family Member add-on to add more)',
      v_current_count, v_limit;
  end if;

  return new;
end;
$$;

create trigger family_plan_members_validate_count
  before insert on public.family_plan_members
  for each row execute function private.validate_family_plan_member_count();
