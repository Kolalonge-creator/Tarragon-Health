-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

create or replace function public.redeem_wellness_points(p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_bal public.wellness_points_balances%rowtype;
  v_rate numeric;
  v_kobo bigint;
  v_wallet uuid;
  v_ledger_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_points is null or p_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter a positive number of points.');
  end if;

  select * into v_bal from public.wellness_points_balances where patient_id = v_caller for update;
  if not found or v_bal.balance < p_points then
    return jsonb_build_object('ok', false, 'error', 'You don''t have enough points for that yet.');
  end if;

  select points_to_kobo_rate into v_rate from public.wellness_points_config where id = true;
  v_kobo := round(p_points * coalesce(v_rate, 1));
  if v_kobo <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Redemption isn''t available right now.');
  end if;

  update public.wellness_points_balances
    set balance = balance - p_points, updated_at = now()
    where patient_id = v_caller;

  insert into public.wellness_points_ledger
    (organisation_id, patient_id, points, balance_after, reason)
  values (v_bal.organisation_id, v_caller, -p_points, v_bal.balance - p_points, 'redeemed_to_wallet');

  v_wallet := private.ensure_wallet(v_caller);
  v_ledger_id := private.wallet_apply(
    v_wallet, v_kobo, 'points_redemption', v_caller, 'Wellness points redeemed to wallet');

  insert into public.wellness_points_redemptions
    (organisation_id, patient_id, points_redeemed, kobo_credited, wallet_ledger_id)
  values (v_bal.organisation_id, v_caller, p_points, v_kobo, v_ledger_id);

  return jsonb_build_object(
    'ok', true, 'balance', v_bal.balance - p_points, 'kobo_credited', v_kobo);
end;
$$;

revoke execute on function public.redeem_wellness_points(integer) from public, anon;
grant execute on function public.redeem_wellness_points(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.wellness_points_config enable row level security;
alter table public.wellness_points_balances enable row level security;
alter table public.wellness_points_ledger enable row level security;
alter table public.wellness_points_redemptions enable row level security;
alter table public.wellness_badges enable row level security;
alter table public.patient_wellness_badges enable row level security;

create policy wellness_points_config_select on public.wellness_points_config
  for select to authenticated using (true);
create policy wellness_points_config_write on public.wellness_points_config
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

create policy wellness_points_balances_select on public.wellness_points_balances
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wellness_points_ledger_select on public.wellness_points_ledger
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wellness_points_redemptions_select on public.wellness_points_redemptions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wellness_badges_select on public.wellness_badges
  for select to authenticated using (is_active or private.is_admin());
create policy wellness_badges_write on public.wellness_badges
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy patient_wellness_badges_select on public.patient_wellness_badges
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.wellness_points_config to authenticated;
grant update on public.wellness_points_config to authenticated;
grant select on public.wellness_points_balances to authenticated;
grant select on public.wellness_points_ledger to authenticated;
grant select on public.wellness_points_redemptions to authenticated;
grant select, insert, update, delete on public.wellness_badges to authenticated;
grant select on public.patient_wellness_badges to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: a small, honest v1 badge set.
-- ---------------------------------------------------------------------------
insert into public.wellness_badges (code, name, description, icon, criteria_type, criteria_reason, criteria_threshold) values
  ('first_step',        'First Step',        'Logged your first wellness activity.',            'award',  'entries_total',       null,                          1),
  ('streak_7',          '7-Day Streak',      'Logged something every day for a week.',           'flame',  'streak_days',         null,                          7),
  ('streak_30',         '30-Day Streak',     'Logged something every day for a month.',          'flame',  'streak_days',         null,                          30),
  ('meal_logger',       'Meal Logger',       'Logged 10 meals.',                                  'utensils', 'reason_count',      'meal_logged',                 10),
  ('vitals_champion',   'Vitals Champion',   'Logged 20 vitals readings.',                        'heart',  'reason_count',        'vitals_logged',               20),
  ('lesson_learner',    'Lesson Learner',    'Completed 5 health education lessons.',             'book',   'reason_count',        'education_lesson_completed',  5),
  ('goal_getter',       'Goal Getter',       'Achieved a lifestyle goal.',                        'target', 'reason_count',        'lpe_goal_achieved',           1),
  ('challenge_champion','Challenge Champion','Completed a wellness challenge.',                   'trophy', 'challenge_completions', null,                        1),
  ('points_500',        '500 Points',        'Earned 500 wellness points.',                       'star',   'points_total',        null,                          500),
  ('points_2000',       '2,000 Points',      'Earned 2,000 wellness points.',                     'star',   'points_total',        null,                          2000)
on conflict (code) do nothing;
;
