-- ---------------------------------------------------------------------------
-- Helpers (private schema, unexposed)
-- ---------------------------------------------------------------------------

create or replace function private.ensure_wellness_points_balance(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if exists (select 1 from public.wellness_points_balances where patient_id = p_patient) then
    return;
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return; end if;
  insert into public.wellness_points_balances (patient_id, organisation_id)
  values (p_patient, v_org)
  on conflict (patient_id) do nothing;
end;
$$;

-- Badge evaluation: a small generic engine over the ledger + related tables.
-- Never blocks a caller — swallows its own errors.
create or replace function private.check_and_award_wellness_badges(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge record;
  v_org uuid;
  v_qualifies boolean;
  v_lifetime integer;
  v_entries integer;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return; end if;

  select lifetime_earned into v_lifetime
    from public.wellness_points_balances where patient_id = p_patient;
  select count(*) into v_entries
    from public.wellness_points_ledger where patient_id = p_patient and points > 0;

  for v_badge in select * from public.wellness_badges where is_active loop
    if exists (
      select 1 from public.patient_wellness_badges
      where patient_id = p_patient and badge_id = v_badge.id
    ) then
      continue;
    end if;

    v_qualifies := false;
    if v_badge.criteria_type = 'points_total' then
      v_qualifies := coalesce(v_lifetime, 0) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'entries_total' then
      v_qualifies := coalesce(v_entries, 0) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'reason_count' then
      v_qualifies := (
        select count(*) from public.wellness_points_ledger
        where patient_id = p_patient and points > 0 and reason = v_badge.criteria_reason
      ) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'challenge_completions' then
      v_qualifies := (
        select count(*) from public.patient_challenge_enrolments
        where patient_id = p_patient and status = 'completed'
      ) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'streak_days' then
      -- Every day in the last N (including today) has at least one earn row.
      v_qualifies := not exists (
        select 1 from generate_series(0, v_badge.criteria_threshold - 1) as gs (n)
        where not exists (
          select 1 from public.wellness_points_ledger
          where patient_id = p_patient and points > 0
            and created_at::date = current_date - gs.n
        )
      );
    end if;

    if v_qualifies then
      insert into public.patient_wellness_badges (organisation_id, patient_id, badge_id)
      values (v_org, p_patient, v_badge.id)
      on conflict (patient_id, badge_id) do nothing;
    end if;
  end loop;
exception when others then
  null;
end;
$$;

-- The single write path for every points EARN. Locks the balance row,
-- computes the candidate new balance, then attempts the idempotent ledger
-- insert BEFORE committing the balance change — a duplicate (patient,
-- source, reason) event leaves the balance untouched. Never raises: a
-- gamification failure must never block the underlying write it hangs off.
create or replace function private.award_wellness_points(
  p_patient uuid,
  p_points integer,
  p_reason text,
  p_source_table text default null,
  p_source_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal public.wellness_points_balances%rowtype;
  v_new_balance integer;
begin
  if p_patient is null or p_points is null or p_points <= 0 then return; end if;
  perform private.ensure_wellness_points_balance(p_patient);

  select * into v_bal from public.wellness_points_balances where patient_id = p_patient for update;
  if not found then return; end if;
  v_new_balance := v_bal.balance + p_points;

  begin
    insert into public.wellness_points_ledger
      (organisation_id, patient_id, points, balance_after, reason, source_table, source_id)
    values
      (v_bal.organisation_id, p_patient, p_points, v_new_balance, p_reason, p_source_table, p_source_id);
  exception when unique_violation then
    return; -- already awarded for this exact event
  end;

  update public.wellness_points_balances
    set balance = v_new_balance, lifetime_earned = lifetime_earned + p_points, updated_at = now()
    where patient_id = p_patient;

  perform private.check_and_award_wellness_badges(p_patient);
exception when others then
  null;
end;
$$;
;
