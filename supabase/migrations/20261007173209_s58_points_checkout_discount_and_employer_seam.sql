-- S58 migration 3 of 3: the employer aggregate seam (11.4). Module 24 is not built; this is the seam it will use.
--
-- The CHECKOUT DISCOUNT that this migration first carried (reward_redemptions, apply_points_discount, release_points_discount) is NOT built here:
-- S71 to S73 already ship the working points use at checkout (a single-use reduction on Tarragon's own service fee, tied to one order, with
-- points_applied / points_reduction_kobo on the order), and a second redemption path would be a second place a point could become money.
-- Decision recorded 2026-10-16 when this branch was rebuilt on main-dev. Nothing in this branch converts points to money or touches the order.

create or replace function public.rewards_participation_aggregate(p_org uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer := coalesce((private.reward_config('employer_aggregate') ->> 'min_group')::integer, 10);
  v_people integer;
  v_points bigint;
begin
  if not private.is_admin()
     or p_org is distinct from (select organisation_id from public.profiles where id = auth.uid()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select count(distinct l.patient_id), coalesce(sum(l.points), 0) into v_people, v_points
    from public.wellness_points_ledger l join public.profiles p on p.id = l.patient_id
   where l.organisation_id = p_org and l.kind = 'earn' and l.points > 0 and not coalesce(p.is_test, false)
     and l.created_at >= p_from and l.created_at < p_to + 1;
  if v_people < v_min then
    return jsonb_build_object('suppressed', true, 'min_group', v_min);
  end if;
  return jsonb_build_object('suppressed', false, 'participants', v_people, 'points', v_points,
    'by_rule', coalesce((select jsonb_agg(jsonb_build_object('rule', x.rule_code, 'participants', x.n))
       from (select l.rule_code, count(distinct l.patient_id) n
               from public.wellness_points_ledger l join public.profiles p on p.id = l.patient_id
              where l.organisation_id = p_org and l.kind = 'earn' and l.points > 0 and l.rule_code is not null
                and not coalesce(p.is_test, false) and l.created_at >= p_from and l.created_at < p_to + 1
              group by 1 having count(distinct l.patient_id) >= v_min) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.rewards_participation_aggregate(uuid, date, date) from public, anon;
grant execute on function public.rewards_participation_aggregate(uuid, date, date) to authenticated;

-- Self-check: no points-to-kobo rate exists anywhere, and redemption is still off.
do $$
begin
  -- (wellness_points_config.points_to_kobo_rate and public.redeem_wellness_points are the legacy conversion; S72 drops both later in the replay order.
  --  S58 adds no rate of its own, which is what this proves.)
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and not (table_name = 'wellness_points_config' and column_name = 'points_to_kobo_rate')
              and column_name ~* '(points_to_kobo|kobo_per_point|kobo_rate)') then
    raise exception 'a points-to-kobo rate column exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.proname <> 'redeem_wellness_points'
                and p.prosrc ~* '(points_to_kobo|kobo_per_point|kobo_rate)') then
    raise exception 'a function uses a points-to-kobo rate';
  end if;
end $$;
