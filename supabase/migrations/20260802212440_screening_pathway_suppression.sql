-- Pathway-ownership suppression for the Screen ladder — mapped onto the real
-- tables that already exist (care_plans, screening_results,
-- medication_review_cadences, patient_shared_decisions, the new serology
-- status columns). Deliberately NOT a parallel order_line/observation
-- schema: `screening_pathway_coverage` is a small reference table in the
-- same spirit as medication_review_cadences / drug_monitoring_rules, and the
-- exclusion function reads real observation tables rather than inventing one.
--
-- One function, three exclusion reasons, so a patient never gets re-tested
-- (or asked to pay for a re-test) for something already settled:
--   * lifetime_once_on_file       — genotype/blood group already resulted
--   * terminal_serology_state     — chronic HBV / HCV RNA-pending / HIV+
--   * owned_by_pathway            — an active chronic care plan already
--                                    covers this item within its own cadence
--   * pending_shared_decision     — PSA specifically, no SDM record yet
--     (this one is inclusion-blocking, not "already covered" — surfaced
--     with its own reason so the app can show "complete the PSA
--     conversation" rather than "already covered, nothing to do")

create table if not exists public.screening_pathway_coverage (
  condition   public.care_plan_condition not null,
  item_code   text not null references public.screen_types (code) on delete restrict,
  primary key (condition, item_code)
);

alter table public.screening_pathway_coverage enable row level security;

drop policy if exists screening_pathway_coverage_select on public.screening_pathway_coverage;
create policy screening_pathway_coverage_select on public.screening_pathway_coverage
  for select to authenticated using (true);

grant select on public.screening_pathway_coverage to authenticated;
revoke all on public.screening_pathway_coverage from anon;

insert into public.screening_pathway_coverage (condition, item_code) values
  ('diabetes',       'hba1c'),
  ('diabetes',       'lipid_panel'),
  ('diabetes',       'urine_acr'),
  ('diabetes',       'kft'),
  ('hypertension',   'lipid_panel'),
  ('hypertension',   'urine_acr'),
  ('hypertension',   'kft'),
  ('hypertension',   'ecg_resting'),
  ('ckd',            'urine_acr'),
  ('ckd',            'kft'),
  ('ckd',            'fbc'),
  ('cardiovascular', 'lipid_panel'),
  ('obesity',        'hba1c'),
  ('obesity',        'lipid_panel'),
  ('heart_failure',  'lipid_panel')
on conflict (condition, item_code) do nothing;

-- ---------------------------------------------------------------------------
-- lab_orders gains a column recording what a self-bookable Screen order
-- actually excluded, and why — visible to the patient/fulfilling lab so
-- nobody redraws blood or images something already on file.
-- ---------------------------------------------------------------------------
alter table public.lab_orders
  add column if not exists excluded_test_codes jsonb not null default '[]'::jsonb;

create or replace function private.compute_screening_order_exclusions(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_test_codes text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
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
begin
  select hbv_status, hcv_status, hiv_status
    into v_hbv, v_hcv, v_hiv
    from public.profiles where id = p_patient_id;

  foreach v_code in array p_test_codes loop
    v_reason := null;

    -- Lifetime-once items already on file.
    if v_code in ('blood_group', 'sickle_cell_genotype') and exists (
      select 1 from public.screening_results sr
      where sr.patient_id = p_patient_id and sr.screen_type_code = v_code
    ) then
      v_reason := 'lifetime_once_on_file';
    end if;

    -- Terminal serology states — never re-test.
    if v_reason is null and v_code = 'hep_b' and v_hbv = 'chronic_hbv' then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active') then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hiv' and v_hiv = 'hiv_positive' then
      v_reason := 'terminal_serology_state';
    end if;

    -- PSA needs a recorded shared decision before it can be resulted.
    if v_reason is null and v_code = 'psa' then
      select exists (
        select 1 from public.patient_shared_decisions
        where patient_id = p_patient_id and screen_type_code = 'psa'
      ) into v_has_sdm;
      if not v_has_sdm then
        v_reason := 'pending_shared_decision';
      end if;
    end if;

    -- Owned by an active chronic pathway that already covers it recently.
    if v_reason is null then
      select spc.condition into v_owning_condition
        from public.screening_pathway_coverage spc
        join public.care_plans cp
          on cp.condition = spc.condition
         and cp.patient_id = p_patient_id
         and cp.status = 'active'
        where spc.item_code = v_code
        limit 1;

      if v_owning_condition is not null then
        select interval_months into v_pathway_interval
          from public.medication_review_cadences
          where condition = v_owning_condition;

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
$$;

revoke all on function private.compute_screening_order_exclusions(uuid, uuid, text[]) from public;

-- ---------------------------------------------------------------------------
-- Wire it into lab_orders creation for the three self-bookable Screen tiers.
-- Runs before enforce_lab_order_origin (alphabetically 'a' < 'e' among
-- BEFORE INSERT triggers of the same event, but trigger order is not
-- guaranteed by name — this trigger only touches excluded_test_codes and
-- never rejects the insert, so ordering relative to enforce_lab_order_origin
-- does not matter).
-- ---------------------------------------------------------------------------
create or replace function private.annotate_screening_order_exclusions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle public.panel_bundles%rowtype;
begin
  if new.panel_bundle_id is null then
    return new;
  end if;

  select * into v_bundle from public.panel_bundles where id = new.panel_bundle_id;

  if v_bundle.code not in ('screen_core', 'screen_advanced', 'screen_comprehensive') then
    return new;
  end if;

  new.excluded_test_codes := private.compute_screening_order_exclusions(
    new.patient_id, new.organisation_id, v_bundle.test_codes
  );

  return new;
end;
$$;

drop trigger if exists lab_orders_annotate_exclusions on public.lab_orders;
create trigger lab_orders_annotate_exclusions
  before insert on public.lab_orders
  for each row execute function private.annotate_screening_order_exclusions();

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.screening_pathway_coverage;
  if v_count < 10 then
    raise exception 'screening_pathway_coverage seed looks incomplete, found % rows', v_count;
  end if;
end $$;
