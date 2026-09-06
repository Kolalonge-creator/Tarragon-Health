-- profiles.hiv_status/hbv_status/hcv_status are readable today by ANY profile_access
-- grantee, including a bare view-only grant with no clinical_access consent -- a live PHI
-- exposure of the platform's most sensitive field, on a table too broadly-granted (full_name
-- etc. must stay readable by ordinary next-of-kin) to fix with a row-level policy alone.
-- Extracted to its own single-purpose table, matching the established pattern already used
-- for mental_health_screens/reproductive_health_profiles/patient_blood_profile/
-- patient_cardiovascular_profile.

create table public.patient_serology_status (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null unique references public.profiles (id) on delete cascade,
  hbv_status      public.hbv_status not null default 'unknown',
  hcv_status      public.hcv_status not null default 'unknown',
  hiv_status      public.hiv_status not null default 'unknown',
  updated_at      timestamptz not null default now()
);

create index patient_serology_status_org_idx on public.patient_serology_status (organisation_id);

drop trigger if exists patient_serology_status_set_updated_at on public.patient_serology_status;
create trigger patient_serology_status_set_updated_at
  before update on public.patient_serology_status
  for each row execute function private.set_updated_at();

alter table public.patient_serology_status enable row level security;

create policy patient_serology_status_select on public.patient_serology_status
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- No authenticated write policy: the only writer is private.advance_serology_status(),
-- SECURITY DEFINER, same as the table it replaces.
grant select on public.patient_serology_status to authenticated;

-- Backfill every patient row (not just non-'unknown' ones), so the writer's
-- `on conflict (patient_id) do update` always has a row to land on from day one.
insert into public.patient_serology_status (organisation_id, patient_id, hbv_status, hcv_status, hiv_status, updated_at)
select organisation_id, id, hbv_status, hcv_status, hiv_status, now()
from public.profiles
where role = 'patient' and organisation_id is not null;

-- Writer: repoint from profiles to patient_serology_status.
create or replace function private.advance_serology_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_reactive boolean;
  v_current  text;
begin
  if new.screen_type_code not in ('hep_b', 'hep_c', 'hiv') then
    return new;
  end if;

  v_reactive := new.result_status in ('abnormal', 'critical');

  if new.screen_type_code = 'hep_b' then
    select hbv_status::text into v_current from public.patient_serology_status where patient_id = new.patient_id;
    v_current := coalesce(v_current, 'unknown');
    if v_reactive and v_current <> 'chronic_hbv' then
      insert into public.patient_serology_status (organisation_id, patient_id, hbv_status)
        values (new.organisation_id, new.patient_id, 'chronic_hbv')
        on conflict (patient_id) do update set hbv_status = 'chronic_hbv', updated_at = now();
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hbv', v_current, 'chronic_hbv', new.id);
    elsif not v_reactive and v_current = 'unknown' then
      insert into public.patient_serology_status (organisation_id, patient_id, hbv_status)
        values (new.organisation_id, new.patient_id, 'hbv_negative')
        on conflict (patient_id) do update set hbv_status = 'hbv_negative', updated_at = now();
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hbv', v_current, 'hbv_negative', new.id);
    end if;
  end if;

  if new.screen_type_code = 'hep_c' then
    select hcv_status::text into v_current from public.patient_serology_status where patient_id = new.patient_id;
    v_current := coalesce(v_current, 'unknown');
    if v_reactive and v_current not in ('hcv_rna_pending', 'hcv_active') then
      insert into public.patient_serology_status (organisation_id, patient_id, hcv_status)
        values (new.organisation_id, new.patient_id, 'hcv_rna_pending')
        on conflict (patient_id) do update set hcv_status = 'hcv_rna_pending', updated_at = now();
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hcv', v_current, 'hcv_rna_pending', new.id);
    elsif not v_reactive and v_current = 'unknown' then
      insert into public.patient_serology_status (organisation_id, patient_id, hcv_status)
        values (new.organisation_id, new.patient_id, 'hcv_negative')
        on conflict (patient_id) do update set hcv_status = 'hcv_negative', updated_at = now();
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hcv', v_current, 'hcv_negative', new.id);
    end if;
  end if;

  if new.screen_type_code = 'hiv' then
    select hiv_status::text into v_current from public.patient_serology_status where patient_id = new.patient_id;
    v_current := coalesce(v_current, 'unknown');
    if v_reactive and v_current <> 'hiv_positive' then
      insert into public.patient_serology_status (organisation_id, patient_id, hiv_status)
        values (new.organisation_id, new.patient_id, 'hiv_positive')
        on conflict (patient_id) do update set hiv_status = 'hiv_positive', updated_at = now();
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hiv', v_current, 'hiv_positive', new.id);
    elsif not v_reactive and v_current = 'unknown' then
      insert into public.patient_serology_status (organisation_id, patient_id, hiv_status)
        values (new.organisation_id, new.patient_id, 'hiv_negative')
        on conflict (patient_id) do update set hiv_status = 'hiv_negative', updated_at = now();
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hiv', v_current, 'hiv_negative', new.id);
    end if;
  end if;

  if v_reactive then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id, new.patient_id, 'urgent_escalation', 'open',
      format('Reactive %s result — confirm and contact the patient', upper(new.screen_type_code)),
      'A reactive serology result was recorded. It must be confirmed and discussed with the patient directly — do not release a bare reactive result without this review.',
      1
    );
  end if;

  return new;
end;
$function$;

-- Reader: repoint from profiles to patient_serology_status.
create or replace function private.compute_screening_order_exclusions(p_patient_id uuid, p_organisation_id uuid, p_test_codes text[])
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_code text;
  v_result jsonb := '[]'::jsonb;
  v_hbv public.hbv_status;
  v_hcv public.hcv_status;
  v_hiv public.hiv_status;
  v_has_sdm boolean;
  v_reason text;
  v_owning_condition public.care_plan_condition;
  v_pathway_interval int;
  v_recent boolean;
  v_once boolean;
  v_reopens boolean;
  v_reopened boolean;
  v_due date;
begin
  select hbv_status, hcv_status, hiv_status
    into v_hbv, v_hcv, v_hiv
    from public.patient_serology_status where patient_id = p_patient_id;
  v_hbv := coalesce(v_hbv, 'unknown');
  v_hcv := coalesce(v_hcv, 'unknown');
  v_hiv := coalesce(v_hiv, 'unknown');

  foreach v_code in array p_test_codes loop
    v_reason := null;

    select coalesce(st.once_per_lifetime, false), coalesce(st.reopens_on_exposure, false)
      into v_once, v_reopens
      from public.screen_types st where st.code = v_code;

    select count(*) > 0, min(per.occurred_on + r.earliest_test_days)
      into v_reopened, v_due
      from public.patient_exposure_reports per
      join public.exposure_retest_rules r
        on r.exposure_code = per.exposure_code
       and r.screen_type_code = v_code
     where per.patient_id = p_patient_id
       and per.status = 'open'
       and not exists (
         select 1 from public.screening_results sr
          where sr.patient_id = p_patient_id
            and sr.screen_type_code = v_code
            and sr.created_at > per.reported_at
       );
    v_reopened := coalesce(v_reopened, false);
    if v_reopened and v_due is null then
      select min(per.reported_at::date + r.earliest_test_days) into v_due
        from public.patient_exposure_reports per
        join public.exposure_retest_rules r
          on r.exposure_code = per.exposure_code and r.screen_type_code = v_code
       where per.patient_id = p_patient_id and per.status = 'open';
    end if;

    if coalesce(v_once, false) and exists (
      select 1 from public.screening_results sr
      where sr.patient_id = p_patient_id and sr.screen_type_code = v_code
    ) and not (v_reopens and v_reopened) then
      v_reason := 'lifetime_once_on_file';
    end if;

    if v_reason is null and v_code = 'hep_b' and v_hbv = 'chronic_hbv' then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active') then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hiv' and v_hiv = 'hiv_positive' then
      v_reason := 'terminal_serology_state';
    end if;

    if v_reason is null and v_reopened and v_due is not null and current_date < v_due then
      v_reason := 'within_window_period:' || v_due::text;
    end if;

    if v_reason is null and v_code = 'psa' then
      select exists (
        select 1 from public.patient_shared_decisions
        where patient_id = p_patient_id and screen_type_code = 'psa'
      ) into v_has_sdm;
      if not v_has_sdm then
        v_reason := 'pending_shared_decision';
      end if;
    end if;

    if v_reason is null and not v_reopened then
      select spc.condition into v_owning_condition
        from public.screening_pathway_coverage spc
        join public.care_plans cp
          on cp.condition = spc.condition
         and cp.patient_id = p_patient_id
         and cp.status = 'active'
        where spc.item_code = v_code
        limit 1;

      if v_owning_condition is not null then
        select csc.interval_months into v_pathway_interval
          from public.condition_screen_cadences csc
         where csc.condition = v_owning_condition
           and csc.screen_type_code = v_code
           and csc.control_state = coalesce(
                 private.patient_chronic_control_state(p_patient_id, v_owning_condition),
                 'not_yet_established'
               );

        if v_pathway_interval is null then
          select interval_months into v_pathway_interval
            from public.medication_review_cadences
            where condition = v_owning_condition;
        end if;

        select exists (
          select 1 from public.screening_results sr
          where sr.patient_id = p_patient_id
            and sr.screen_type_code = v_code
            and sr.created_at > now() - make_interval(months => coalesce(v_pathway_interval, 6))
        ) into v_recent;

        if v_recent then
          v_reason := 'owned_by_pathway:' || v_owning_condition::text;
        end if;
      end if;
    end if;

    if v_reason is not null then
      v_result := v_result || jsonb_build_object('item_code', v_code, 'reason', v_reason);
    end if;
  end loop;

  return v_result;
end;
$function$;

-- Guard trigger: strip the 3 dead-column checks. Must land in this same migration as the
-- DROP COLUMN below -- leaving these in place after the columns are gone means every future
-- profiles UPDATE starts erroring at runtime the first time this trigger fires.
create or replace function private.guard_profiles_self_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_is_self_direct_edit boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_is_self_direct_edit :=
    (select auth.uid()) is not null
    and (select auth.uid()) = old.id
    and not private.is_admin()
    and not (old.organisation_id is not null and private.is_org_staff(old.organisation_id));

  if not v_is_self_direct_edit then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role cannot be changed by the account owner';
  end if;
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'profiles.organisation_id cannot be changed by the account owner';
  end if;
  if new.patient_number is distinct from old.patient_number then
    raise exception 'profiles.patient_number cannot be changed by the account owner';
  end if;
  if new.staff_number is distinct from old.staff_number then
    raise exception 'profiles.staff_number cannot be changed by the account owner';
  end if;
  if new.custom_role_id is distinct from old.custom_role_id then
    raise exception 'profiles.custom_role_id cannot be changed by the account owner';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'profiles.is_active cannot be changed by the account owner';
  end if;
  if new.is_dependent_account is distinct from old.is_dependent_account then
    raise exception 'profiles.is_dependent_account cannot be changed by the account owner';
  end if;
  if new.identity_verified_at is distinct from old.identity_verified_at then
    raise exception 'profiles.identity_verified_at cannot be changed by the account owner';
  end if;
  if new.lab_provider_id is distinct from old.lab_provider_id then
    raise exception 'profiles.lab_provider_id cannot be changed by the account owner';
  end if;
  if new.pharmacy_partner_id is distinct from old.pharmacy_partner_id then
    raise exception 'profiles.pharmacy_partner_id cannot be changed by the account owner';
  end if;
  if new.is_partner_admin is distinct from old.is_partner_admin then
    raise exception 'profiles.is_partner_admin cannot be changed by the account owner';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at cannot be changed by the account owner';
  end if;

  return new;
end;
$function$;

alter table public.profiles
  drop column hbv_status,
  drop column hcv_status,
  drop column hiv_status;

do $$
declare
  v_serology_count bigint;
  v_patient_count bigint;
  v_leftover_cols text;
  v_guard_def text;
  v_reader_def text;
begin
  select count(*) into v_serology_count from public.patient_serology_status;
  select count(*) into v_patient_count from public.profiles where role = 'patient' and organisation_id is not null;
  if v_serology_count <> v_patient_count then
    raise exception 'backfill row-count mismatch: patient_serology_status has %, expected %', v_serology_count, v_patient_count;
  end if;

  select string_agg(column_name, ', ') into v_leftover_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('hbv_status', 'hcv_status', 'hiv_status');
  if v_leftover_cols is not null then
    raise exception 'profiles still has these columns after DROP COLUMN: %', v_leftover_cols;
  end if;

  select pg_get_functiondef(oid) into v_guard_def
    from pg_proc where proname = 'guard_profiles_self_update' and pronamespace = 'private'::regnamespace;
  if v_guard_def like '%hbv_status%' or v_guard_def like '%hcv_status%' or v_guard_def like '%hiv_status%' then
    raise exception 'guard_profiles_self_update still references a dropped column';
  end if;

  select pg_get_functiondef(oid) into v_reader_def
    from pg_proc where proname = 'compute_screening_order_exclusions' and pronamespace = 'private'::regnamespace;
  if v_reader_def like '%from public.profiles%hbv_status%' then
    raise exception 'compute_screening_order_exclusions still reads serology status from profiles';
  end if;
end $$;
