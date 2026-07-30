-- M2: clinician activation guard (build spec v3 §4, §5.2, §20).
--
-- Two complementary mechanisms:
--   1. A BEFORE INSERT/UPDATE trigger blocks a clinicians row from ever being written with
--      active = true unless its credentials currently satisfy the accountability model in
--      force (app_config.accountability_model) -- the "before activation" half of §4's table.
--   2. A nightly sweep (private.run_clinician_activation_guard, scheduled via pg_cron) catches
--      credentials that lapse purely by the passage of time, with no write ever happening -- a
--      write-time trigger alone cannot see a date crossing today's date with nobody touching
--      the row.
--
-- Suspension does not need to touch profiles.role or revoke any grant: private.actor_clinician_id()
-- (see v3_rls_helper_functions) already filters on active = true, so flipping this one column is
-- what "revokes the clinician role grant immediately" (§5.2) means in this schema -- every
-- can_see_patient() check for the clinician role routes through that function.

create or replace function private.clinician_meets_activation_requirements(p_clinician clinicians)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_model accountability_model;
begin
  select accountability_model into v_model from app_config where id = true;

  if p_clinician.mdcn_number is null or p_clinician.mdcn_expiry is null
     or p_clinician.mdcn_expiry < current_date then
    return false;
  end if;

  if v_model = 'tech_layer' then
    if p_clinician.indemnity_provider is null
       or p_clinician.indemnity_policy_no is null
       or p_clinician.indemnity_expiry is null
       or p_clinician.indemnity_expiry < current_date then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create or replace function private.enforce_clinician_activation_requirements() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.active and not private.clinician_meets_activation_requirements(new) then
    raise exception 'ACTIVATION: clinician % does not meet the activation requirements for the current accountability model (expired/missing MDCN or indemnity)', new.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_clinician_activation_requirements_trigger
  before insert or update on clinicians
  for each row execute function private.enforce_clinician_activation_requirements();

-- Nightly sweep: suspends any currently-active clinician whose credentials have since lapsed.
-- Never activates anyone -- activation is a deliberate ops/superadmin action gated by the
-- trigger above; this function only ever sets active -> false.
create or replace function private.run_clinician_activation_guard() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_model accountability_model;
begin
  select accountability_model into v_model from app_config where id = true;

  update clinicians
    set active = false,
        suspended_reason = 'mdcn_expired'
    where active = true
      and mdcn_expiry < current_date;

  if v_model = 'tech_layer' then
    update clinicians
      set active = false,
          suspended_reason = case
            when indemnity_expiry is null or indemnity_provider is null or indemnity_policy_no is null
              then 'indemnity_missing'
            else 'indemnity_expired'
          end
      where active = true
        and (indemnity_expiry is null or indemnity_expiry < current_date
             or indemnity_provider is null or indemnity_policy_no is null);
  end if;
end;
$$;

select cron.schedule(
  'clinician-activation-guard-nightly',
  '15 2 * * *',
  $$select private.run_clinician_activation_guard();$$
);
