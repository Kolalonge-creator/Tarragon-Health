-- S46: Module 3 part 2 (functions 3.11 to 3.16): pathway suppression override, hepatitis B immunity logic, INV-04 explainer guard, yearly Health Report.
--
-- Founder waiver of the S40 gate recorded 2026-10-07 for this session. Timestamp note: stamped by hand to sort after the newest file on the stacked branch
-- (20261007131904, S45); live list_migrations was read first (latest live version 20261007124418, no collision).
--
-- !!! BEHAVIOUR CHANGE, FLAGGED ON PURPOSE (3.12, founder decision 2026-10-07: the spec rule wins) !!!
-- OLD (live since 2026-08-21, founder "Know Your Basics, once, ever"): hep_b and hep_c carry screen_types.once_per_lifetime = true, so once a result is on
--   file they are never re-sold or re-scheduled (unless an exposure report reopens them). HIV was annual.
-- NEW (spec 3.12): HIV and hepatitis C stay annual. Hepatitis B surface antigen (hep_b) is annual until a positive anti-HBs records immunity ONCE, after which
--   it stops; a chronic HBV state also stops it, as before. The rule is data: public.serology_rule_versions. Version 1 ('legacy_once_ever') documents the old
--   behaviour and stays in the table; version 2 ('spec_2026_10') is the active one. TO ROLL BACK: update the two status values (v1 active, v2 proposed).
--   screen_types.once_per_lifetime is deliberately NOT edited (it still describes blood group and genotype correctly); the exclusion function consults the
--   active rule first and falls back to the column only for codes the rule does not name.
-- The anti-HBs threshold (proposed 10 mIU/mL) is NOT confirmed by the CMO (OQ-S46-2). Until it is, a numeric anti-HBs titre never sets immunity on its own:
--   only a laboratory-flagged positive result, or a clinician recording immunity with a stated basis, does.
--
-- Live counts before this migration (read-only, 2026-10-07): patient_serology_status rows with hbv_status = immune: 0; health_reports, screening_pathway_overrides,
--   serology_rule_versions, sensitive_result_codes do not exist.
--
-- What this does (nothing is signed, nothing is switched on):
--   1. serology_rule_versions (v1 legacy, v2 active), patient immunity state (private.set_hbv_immune, trigger on an anti_hbs lab item, clinician RPCs),
--      screening_due and compute_screening_order_exclusions made aware of it, the pricing whitelist extended for the new 'repeat_not_due' reason.
--   2. screening_pathway_overrides + override_pathway_suppression (clinician, audited, expiring); the exclusion function honours it for pathway ownership only.
--   3. sensitive_result_codes + a trigger on patient_result_explanations: no AI explanation row can exist for HIV, hepatitis B or C (INV-04).
--   4. health_report_config_versions (versioned, CMO-signable, UNSIGNED), health_reports (hidden until signed by RLS, corrections are new versions), the
--      collector, the draft writer, queue/get/sign/correct functions, the honesty guard, two events, one go-live guard (off).

-- ---------------------------------------------------------------------------
-- 1. Serology rules (3.12)
-- ---------------------------------------------------------------------------
create table public.serology_rule_versions (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  code        text not null,
  status      text not null check (status in ('legacy', 'active', 'proposed')),
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  notes       text,
  decision_ref text,
  threshold_approved_by uuid references public.clinical_staff (id) on delete restrict,
  threshold_approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((threshold_approved_by is null) = (threshold_approved_at is null))
);
create unique index serology_rule_versions_one_active on public.serology_rule_versions ((true)) where status = 'active';

insert into public.serology_rule_versions (version, code, status, decision_ref, notes, config) values
 (1, 'legacy_once_ever', 'legacy', 'founder 2026-08-21 (migration 20260821191743)',
  'The behaviour before S46: hep_b and hep_c are never re-sold once a result is on file (once_per_lifetime), HIV is annual. Kept so the change is reversible and visible.',
  '{"hep_b":{"oncePerLifetime":true},"hep_c":{"oncePerLifetime":true},"hiv":{"repeatMonths":12,"suppressWithinInterval":false}}'::jsonb),
 (2, 'spec_2026_10', 'active', 'founder 2026-10-07: the spec rule (3.12) wins',
  'HIV and hepatitis C annual. HBsAg annual until a positive anti-HBs records immunity once. The anti-HBs threshold is PROPOSED and unconfirmed by the CMO (OQ-S46-2).',
  -- serology-rules-begin
  $json${
 "hiv": { "repeatMonths": 12, "suppressWithinInterval": false },
 "hep_c": { "repeatMonths": 12, "suppressWithinInterval": true },
 "hep_b": { "repeatMonths": 12, "suppressWithinInterval": true, "stopsWhenHbvStatus": ["immune"], "immunityTest": "anti_hbs" },
 "antiHbs": { "thresholdMiuPerMl": 10, "thresholdStatus": "proposed_unsigned" }
}$json$::jsonb);
  -- serology-rules-end

alter table public.serology_rule_versions enable row level security;
create policy serology_rule_versions_read on public.serology_rule_versions for select to authenticated using (true);
revoke all on public.serology_rule_versions from public, anon, authenticated;
grant select on public.serology_rule_versions to authenticated;

create function private.serology_rule(p_code text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select r.config -> p_code from public.serology_rule_versions r where r.status = 'active' limit 1 $$;
revoke all on function private.serology_rule(text) from public, anon, authenticated;

create function private.anti_hbs_threshold_confirmed() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select r.threshold_approved_by is not null from public.serology_rule_versions r where r.status = 'active' limit 1), false) $$;
revoke all on function private.anti_hbs_threshold_confirmed() from public, anon, authenticated;

alter table public.serology_status_transitions
  add column basis text,
  add column lab_result_item_id uuid references public.lab_result_items (id) on delete set null,
  add column recorded_by uuid references public.profiles (id) on delete set null;

-- The one writer of 'immune'. A chronic HBV state is never overwritten (an immune reading cannot cancel an infection record).
create function private.set_hbv_immune(p_patient uuid, p_basis text, p_item uuid default null, p_by uuid default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_cur text;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return false; end if;
  select hbv_status::text into v_cur from public.patient_serology_status where patient_id = p_patient;
  v_cur := coalesce(v_cur, 'unknown');
  if v_cur in ('immune', 'chronic_hbv') then return false; end if;
  insert into public.patient_serology_status (organisation_id, patient_id, hbv_status)
    values (v_org, p_patient, 'immune')
    on conflict (patient_id) do update set hbv_status = 'immune', updated_at = now();
  insert into public.serology_status_transitions (organisation_id, patient_id, virus, from_status, to_status, basis, lab_result_item_id, recorded_by)
    values (v_org, p_patient, 'hbv', v_cur, 'immune', p_basis, p_item, p_by);
  return true;
end $$;
revoke all on function private.set_hbv_immune(uuid, text, uuid, uuid) from public, anon, authenticated;

-- A laboratory-flagged positive anti-HBs (or, only once the CMO confirms the threshold, a numeric titre at or above it) records immunity.
create function private.lab_item_anti_hbs_immunity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_thr numeric;
begin
  if lower(new.analyte_code) <> 'anti_hbs' then return new; end if;
  if new.flag = 'positive' then
    perform private.set_hbv_immune(new.patient_id, 'anti_hbs_positive', new.id, null);
  elsif new.value_numeric is not null and private.anti_hbs_threshold_confirmed() then
    v_thr := (private.serology_rule('antiHbs') ->> 'thresholdMiuPerMl')::numeric;
    if v_thr is not null and new.value_numeric >= v_thr then
      perform private.set_hbv_immune(new.patient_id, 'anti_hbs_titre_at_or_above_threshold', new.id, null);
    end if;
  end if;
  return new;
end $$;
create trigger lab_result_items_anti_hbs_immunity after insert on public.lab_result_items
  for each row execute function private.lab_item_anti_hbs_immunity();

create function public.clinician_record_hbv_immunity(p_patient uuid, p_basis text, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_changed boolean;
begin
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'not_authorised: no active task, lead assignment or page for this patient' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not_authorised: a doctor records immunity' using errcode = '42501';
  end if;
  if p_basis not in ('anti_hbs_positive', 'vaccination_with_titre', 'other') then raise exception 'unknown_basis' using errcode = '22023'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'note_required' using errcode = '22023'; end if;
  v_changed := private.set_hbv_immune(p_patient, 'clinician:' || p_basis, null, (select auth.uid()));
  perform private.log_audit('serology.hbv_immunity_recorded', 'profiles', p_patient, jsonb_build_object('basis', p_basis, 'changed', v_changed));
  return jsonb_build_object('changed', v_changed, 'threshold_confirmed_by_cmo', private.anti_hbs_threshold_confirmed());
end $$;
revoke all on function public.clinician_record_hbv_immunity(uuid, text, text) from public, anon;
grant execute on function public.clinician_record_hbv_immunity(uuid, text, text) to authenticated;

create function public.clinician_clear_hbv_immunity(p_patient uuid, p_note text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'not_authorised: no active task, lead assignment or page for this patient' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not_authorised: a doctor clears immunity' using errcode = '42501';
  end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'note_required' using errcode = '22023'; end if;
  update public.patient_serology_status set hbv_status = 'hbv_negative', updated_at = now() where patient_id = p_patient and hbv_status = 'immune';
  if not found then return false; end if;
  insert into public.serology_status_transitions (organisation_id, patient_id, virus, from_status, to_status, basis, recorded_by)
    select organisation_id, p_patient, 'hbv', 'immune', 'hbv_negative', 'clinician_cleared', (select auth.uid()) from public.profiles where id = p_patient;
  perform private.log_audit('serology.hbv_immunity_cleared', 'profiles', p_patient, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.clinician_clear_hbv_immunity(uuid, text) from public, anon;
grant execute on function public.clinician_clear_hbv_immunity(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pathway suppression override (3.11)
-- ---------------------------------------------------------------------------
create table public.screening_pathway_overrides (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  item_code       text not null references public.screen_types (code) on delete restrict,
  reason_code     text not null check (reason_code in ('clinical_change', 'result_unreliable', 'pathway_not_following_cadence', 'other')),
  note            text not null check (length(btrim(note)) > 0),
  overridden_by   uuid not null references public.profiles (id) on delete restrict,
  source          text not null default 'clinician' check (source = 'clinician'),
  expires_at      timestamptz not null default (now() + interval '12 months'),
  revoked_at      timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index screening_pathway_overrides_patient_idx on public.screening_pathway_overrides (patient_id, item_code);
alter table public.screening_pathway_overrides enable row level security;
-- A patient may see that a check was allowed despite their pathway; staff read through the audited function only (INV-10, INV-12).
create policy screening_pathway_overrides_patient_read on public.screening_pathway_overrides for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.screening_pathway_overrides from public, anon, authenticated;
grant select on public.screening_pathway_overrides to authenticated;

create function public.override_pathway_suppression(p_patient uuid, p_item_code text, p_reason_code text, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_org uuid; v_test boolean;
begin
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'not_authorised: no active task, lead assignment or page for this patient' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not_authorised: a doctor overrides a pathway' using errcode = '42501';
  end if;
  if not exists (select 1 from public.screening_pathway_coverage c where c.item_code = p_item_code) then
    raise exception 'no_pathway_owns_this_item' using errcode = '22023';
  end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = p_patient;
  insert into public.screening_pathway_overrides (organisation_id, patient_id, item_code, reason_code, note, overridden_by, is_test)
    values (v_org, p_patient, p_item_code, p_reason_code, p_note, (select auth.uid()), coalesce(v_test, false))
    returning id into v_id;
  perform private.log_audit('screening.pathway_override', 'profiles', p_patient, jsonb_build_object('item_code', p_item_code, 'reason_code', p_reason_code, 'override_id', v_id));
  return v_id;
end $$;
revoke all on function public.override_pathway_suppression(uuid, text, text, text) from public, anon;
grant execute on function public.override_pathway_suppression(uuid, text, text, text) to authenticated;

create function public.revoke_pathway_override(p_override uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_p uuid;
begin
  select patient_id into v_p from public.screening_pathway_overrides where id = p_override and revoked_at is null;
  if v_p is null then return false; end if;
  if not private.clinician_has_patient_access(v_p) then raise exception 'not_authorised' using errcode = '42501'; end if;
  update public.screening_pathway_overrides set revoked_at = now() where id = p_override;
  perform private.log_audit('screening.pathway_override_revoked', 'profiles', v_p, jsonb_build_object('override_id', p_override));
  return true;
end $$;
revoke all on function public.revoke_pathway_override(uuid) from public, anon;
grant execute on function public.revoke_pathway_override(uuid) to authenticated;

create function public.clinician_list_pathway_overrides(p_patient uuid) returns setof public.screening_pathway_overrides
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then raise exception 'not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('screening.pathway_overrides_read', 'profiles', p_patient, '{}'::jsonb);
  return query select * from public.screening_pathway_overrides where patient_id = p_patient order by created_at desc;
end $$;
revoke all on function public.clinician_list_pathway_overrides(uuid) from public, anon;
grant execute on function public.clinician_list_pathway_overrides(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b + 2b. The exclusion function: body of the live definition (20260830102308, confirmed identical in shape on live 2026-10-07) plus
--   * the active serology rule (annual hep_b / hep_c, hep_b stops on recorded immunity),
--   * a pathway override that lifts 'owned_by_pathway' (never a terminal serology state, never a window period).
-- ---------------------------------------------------------------------------
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
  v_rule jsonb;
  v_last timestamptz;
  v_overridden boolean;
begin
  select hbv_status, hcv_status, hiv_status
    into v_hbv, v_hcv, v_hiv
    from public.patient_serology_status where patient_id = p_patient_id;
  v_hbv := coalesce(v_hbv, 'unknown');
  v_hcv := coalesce(v_hcv, 'unknown');
  v_hiv := coalesce(v_hiv, 'unknown');

  foreach v_code in array p_test_codes loop
    v_reason := null;
    v_rule := private.serology_rule(v_code);

    select coalesce(st.once_per_lifetime, false), coalesce(st.reopens_on_exposure, false)
      into v_once, v_reopens
      from public.screen_types st where st.code = v_code;
    -- S46 (3.12): when the active serology rule names this code, its rule replaces the once-per-lifetime column.
    if v_rule is not null then v_once := coalesce((v_rule ->> 'oncePerLifetime')::boolean, false); end if;

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
    -- S46 (3.12): recorded immunity stops annual HBsAg (the stored state, never a guess from a titre).
    if v_reason is null and v_code = 'hep_b' and v_rule is not null
       and (v_rule -> 'stopsWhenHbvStatus') ? v_hbv::text then
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

    -- S46 (3.12): an annual test with a result inside its interval is not due yet (unless an exposure reopened it).
    if v_reason is null and v_rule is not null and not v_reopened
       and coalesce((v_rule ->> 'suppressWithinInterval')::boolean, false) and (v_rule ->> 'repeatMonths') is not null then
      select max(sr.created_at) into v_last from public.screening_results sr
       where sr.patient_id = p_patient_id and sr.screen_type_code = v_code;
      if v_last is not null and v_last > now() - make_interval(months => (v_rule ->> 'repeatMonths')::integer) then
        v_reason := 'repeat_not_due:' || (v_last + make_interval(months => (v_rule ->> 'repeatMonths')::integer))::date::text;
      end if;
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
      -- S46 (3.11): a clinician's recorded override lifts pathway ownership for this item while it is live.
      select exists (
        select 1 from public.screening_pathway_overrides o
         where o.patient_id = p_patient_id and o.item_code = v_code and o.revoked_at is null and o.expires_at > now()
      ) into v_overridden;

      if not v_overridden then
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
    end if;

    if v_reason is not null then
      v_result := v_result || jsonb_build_object('item_code', v_code, 'reason', v_reason);
    end if;
  end loop;

  return v_result;
end;
$function$;
revoke all on function private.compute_screening_order_exclusions(uuid, uuid, text[]) from public;

-- Pricing: only SETTLED exclusions remove a billed code (20260821190935, whitelist on purpose). 'repeat_not_due' is settled in the same sense as
-- lifetime_once_on_file was: the test was done inside its interval. Patched in place so whatever body is live is kept.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.patient_delivered_test_codes(uuid,uuid,text[])'::regprocedure);
  if v_def like '%repeat_not_due%' then return; end if;
  v_new := replace(v_def, 'or e ->> ''reason'' like ''owned_by_pathway:%''', 'or e ->> ''reason'' like ''owned_by_pathway:%'' or e ->> ''reason'' like ''repeat_not_due:%''');
  if v_new = v_def then raise exception 'S46: could not find the pricing whitelist line to extend'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 1c. screening_due (S45 body) aware of recorded immunity and terminal serology, and a v2 rule set (UNSIGNED) carrying the 3.12 rule.
-- ---------------------------------------------------------------------------
create or replace function private.screening_due(p_patient uuid, p_rule_set uuid)
returns table (screen_type_id uuid, screen_type_code text, due_date date, reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_sex text; v_dob date; v_age integer; v_cfg jsonb; v_hbv text; v_hcv text; v_hiv text;
begin
  select pr.sex::text, pr.date_of_birth into v_sex, v_dob from public.profiles pr where pr.id = p_patient;
  select config into v_cfg from public.screening_rule_sets where id = p_rule_set;
  if v_dob is null or v_sex is null or v_cfg is null then return; end if;
  v_age := extract(year from age(current_date, v_dob))::integer;
  select hbv_status::text, hcv_status::text, hiv_status::text into v_hbv, v_hcv, v_hiv from public.patient_serology_status where patient_id = p_patient;
  v_hbv := coalesce(v_hbv, 'unknown'); v_hcv := coalesce(v_hcv, 'unknown'); v_hiv := coalesce(v_hiv, 'unknown');
  return query
  select st.id, st.code,
         case when lc.last_done is null then current_date else (lc.last_done + make_interval(months => r."frequencyMonths"))::date end,
         case when lc.last_done is null then 'first_due' else 'recurrence' end
    from jsonb_to_recordset(v_cfg -> 'rules') as r(code text, sex text, "ageFrom" integer, "ageTo" integer, "frequencyMonths" integer,
                                                   "oncePerLifetime" boolean, "isOptional" boolean, "autoSchedule" boolean,
                                                   "stopsWhenHbvStatus" text[])
    join public.screen_types st on st.code = r.code and st.is_active
    left join lateral (
      select max(d) as last_done from (
        select ss.due_date as d from public.screening_schedules ss
         where ss.patient_id = p_patient and ss.screen_type_id = st.id and ss.status = 'completed'
        union all
        select sc.performed_date from public.screening_completions sc where sc.patient_id = p_patient and sc.screen_type_id = st.id) x) lc on true
   where coalesce(r."autoSchedule", false) and not coalesce(r."isOptional", false)
     and (r.sex = 'all' or r.sex = v_sex)
     and (r."ageFrom" is null or v_age >= r."ageFrom")
     and (r."ageTo" is null or v_age <= r."ageTo")
     and not (lc.last_done is not null and (coalesce(r."oncePerLifetime", false) or r."frequencyMonths" is null))
     and not (r.code = 'hep_b' and (v_hbv = 'chronic_hbv' or v_hbv = any (coalesce(r."stopsWhenHbvStatus", '{}'::text[]))))
     and not (r.code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active'))
     and not (r.code = 'hiv' and v_hiv = 'hiv_positive')
     and not exists (select 1 from public.screening_schedules ss
                      where ss.patient_id = p_patient and ss.screen_type_id = st.id
                        and ss.status in ('pending', 'booked', 'overdue', 'declined', 'not_applicable'));
end $$;
revoke all on function private.screening_due(uuid, uuid) from public, anon, authenticated;

insert into public.screening_rule_sets (version, notes, config)
select 2,
  'PROPOSED, UNSIGNED. S45 v1 plus the S46 hepatitis rule (3.12): hep_b and hep_c annual (not once per lifetime), hep_b stops once immunity is recorded. Cervical keeps the live rule. The CMO signs this version or v1; see OQ-S46-2.',
  jsonb_build_object('rules', coalesce(jsonb_agg(
    case when x ->> 'code' = 'hep_b' then (x || '{"oncePerLifetime":false,"frequencyMonths":12,"stopsWhenHbvStatus":["immune"]}'::jsonb)
         when x ->> 'code' = 'hep_c' then (x || '{"oncePerLifetime":false,"frequencyMonths":12}'::jsonb)
         else x end order by x ->> 'code'), '[]'::jsonb))
from public.screening_rule_sets rs cross join lateral jsonb_array_elements(rs.config -> 'rules') x
where rs.version = 1 and rs.code = 'screening_rules';

-- ---------------------------------------------------------------------------
-- 3. INV-04: no AI explanation row can exist for HIV, hepatitis B or hepatitis C
-- ---------------------------------------------------------------------------
create table public.sensitive_result_codes (
  code text primary key check (code = lower(code)),
  virus text not null check (virus in ('hiv', 'hbv', 'hcv'))
);
insert into public.sensitive_result_codes (code, virus) values
  ('hiv', 'hiv'), ('hiv_screen', 'hiv'), ('hiv_ab_ag', 'hiv'), ('hiv_antibody', 'hiv'),
  ('hep_b', 'hbv'), ('hbsag', 'hbv'), ('hbs_ag', 'hbv'), ('hbv_surface_antigen', 'hbv'),
  ('hep_c', 'hcv'), ('hcv_ab', 'hcv'), ('anti_hcv', 'hcv'), ('hcv_antibody', 'hcv');
alter table public.sensitive_result_codes enable row level security;
create policy sensitive_result_codes_read on public.sensitive_result_codes for select to authenticated using (true);
revoke all on public.sensitive_result_codes from public, anon, authenticated;
grant select on public.sensitive_result_codes to authenticated;

create function private.is_sensitive_result_code(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_code is not null and exists (select 1 from public.sensitive_result_codes s where s.code = lower(btrim(p_code))) $$;
revoke all on function private.is_sensitive_result_code(text) from public, anon, authenticated;

create function private.patient_result_explanations_inv04() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'lab_analyte' and private.is_sensitive_result_code(new.subject_key) then
    raise exception 'inv04_no_ai_explanation: HIV, hepatitis B and hepatitis C results are never explained by AI; a clinician discloses them' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger patient_result_explanations_inv04 before insert or update on public.patient_result_explanations
  for each row execute function private.patient_result_explanations_inv04();

-- ---------------------------------------------------------------------------
-- 4. Yearly Tarragon Health Report (3.15)
-- ---------------------------------------------------------------------------
create table public.health_report_config_versions (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null unique check (version >= 1),
  config       jsonb not null check (jsonb_typeof(config) = 'object'),
  notes        text,
  approved_by  uuid references public.clinical_staff (id) on delete restrict,
  approved_at  timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index health_report_config_one_active on public.health_report_config_versions ((true)) where is_active;

-- health-report-config-begin
insert into public.health_report_config_versions (version, notes, config) values (1,
  'PROPOSED, UNSIGNED. Every value below is a placeholder for the CMO to confirm; none is a clinical decision. A care-plan target for the patient overrides the BP target.',
  $json${
 "maxPriorities": 3,
 "minBpReadings": 3,
 "bpTarget": { "systolicBelow": 140, "diastolicBelow": 90 },
 "bpBorderlineMarginMmHg": 5,
 "labBorderlineMarginPct": 5,
 "changeTolerancePct": 3,
 "recheckWeeks": 4,
 "priorityWindows": { "bp": "within 4 weeks", "lab": "within 4 weeks", "screening": "within 3 months", "risk": "within 4 weeks" },
 "trendMinPoints": 2,
 "trendYears": 3,
 "statementKey": "report.statement.not_rule_out",
 "statementApprovedByCmo": false,
 "shareExcludedSections": ["screening_reproductive", "risk", "questionnaires"]
}$json$::jsonb);
-- health-report-config-end

create function public.sign_health_report_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the report settings'; end if;
  if not exists (select 1 from public.health_report_config_versions where id = p_id) then raise exception 'Report settings version not found'; end if;
  update public.health_report_config_versions set is_active = false where is_active and id <> p_id;
  update public.health_report_config_versions set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('health_report_config.signed', 'health_report_config_versions', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_health_report_config(uuid) from public, anon;
grant execute on function public.sign_health_report_config(uuid) to authenticated;
alter table public.health_report_config_versions enable row level security;
create policy health_report_config_read on public.health_report_config_versions for select to authenticated using (true);
revoke all on public.health_report_config_versions from public, anon, authenticated;
grant select on public.health_report_config_versions to authenticated;

-- The honesty rules the spec asks for, enforced where they cannot be skipped (study: "Honesty rules (enforced in code and tests)").
create function private.health_report_assert_honest(p_inputs jsonb, p_composed jsonb, p_priorities jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
declare v_item jsonb; v_pri jsonb; v_txt text;
begin
  if jsonb_typeof(p_priorities) <> 'array' or jsonb_array_length(p_priorities) > 3 then
    raise exception 'health_report_honesty: at most three priorities' using errcode = '23514';
  end if;
  for v_pri in select * from jsonb_array_elements(p_priorities) loop
    if v_pri ->> 'action' is null or v_pri ->> 'why' is null or v_pri ->> 'whoHelps' is null or v_pri ->> 'when' is null then
      raise exception 'health_report_honesty: a priority needs an action, a reason, who helps and when' using errcode = '23514';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_composed -> 'items', '[]'::jsonb)) loop
    if v_item ->> 'state' not in ('on_target', 'needs_attention', 'not_checked', 'not_measured', 'no_target') then
      raise exception 'health_report_honesty: unknown state %', v_item ->> 'state' using errcode = '23514';
    end if;
    if v_item ->> 'state' = 'on_target' and (
         v_item -> 'value' is null or jsonb_typeof(v_item -> 'value') <> 'number'
         or coalesce((v_item ->> 'readingCount')::integer, 0) < 1
         or coalesce((v_item ->> 'tooFewReadings')::boolean, false)) then
      raise exception 'health_report_honesty: "on target" needs a recorded value and enough readings' using errcode = '23514';
    end if;
    if v_item ->> 'state' = 'on_target' and coalesce((v_item ->> 'borderline')::boolean, false) then
      raise exception 'health_report_honesty: a borderline value is never "on target"' using errcode = '23514';
    end if;
  end loop;
  v_txt := lower(coalesce(p_inputs::text, '') || ' ' || coalesce(p_composed::text, '') || ' ' || coalesce(p_priorities::text, ''));
  if v_txt ~ '(^|[^a-z])(optimal|biological_age|biological age|healthspan|health_span|percentile)' then
    raise exception 'health_report_honesty: no optimal range, biological age, healthspan or percentile' using errcode = '23514';
  end if;
  if v_txt ~ '(^|[^a-z])(hiv|hbsag|hbs_ag|hcv|hep_b|hep_c|hepatitis|syphilis|chlamydia|gonorrh|anti_hbs)' then
    raise exception 'health_report_honesty: sensitive blood-borne or sexual-health results never appear in a report (INV-04)' using errcode = '23514';
  end if;
end $$;
revoke all on function private.health_report_assert_honest(jsonb, jsonb, jsonb) from public, anon, authenticated;

create table public.health_reports (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id),
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  year                  integer not null check (year between 2000 and 2100),
  version               integer not null default 1 check (version >= 1),
  status                text not null default 'pending_signature' check (status in ('pending_signature', 'signed', 'superseded')),
  config_version_id     uuid not null references public.health_report_config_versions (id),
  risk_instrument_version_id uuid references public.risk_instrument_versions (id),
  inputs                jsonb not null check (jsonb_typeof(inputs) = 'object'),
  composed              jsonb not null check (jsonb_typeof(composed) = 'object'),
  priorities            jsonb not null default '[]'::jsonb,
  ai_draft              text,
  summary_text          text,
  summary_source        text check (summary_source in ('template', 'clinician', 'clinician_edited_ai_draft')),
  document_id           uuid references public.patient_documents (id) on delete set null,
  assigned_clinician_id uuid references public.profiles (id) on delete set null,
  signed_by             uuid references public.clinical_staff (id) on delete restrict,
  signed_at             timestamptz,
  signer_name           text,
  signer_registration   text,
  supersedes_id         uuid references public.health_reports (id) on delete set null,
  correction_note       text,
  source                text not null default 'system' check (source in ('system', 'clinician')),
  recorded_by           uuid references public.profiles (id) on delete set null,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (patient_id, year, version),
  check (status <> 'signed' or (signed_by is not null and signed_at is not null and summary_text is not null
                                and summary_source is not null and signer_name is not null and signer_registration is not null)),
  -- INV-11: an AI draft lives only on an unsigned row, and is wiped when the clinician signs
  check (status = 'pending_signature' or ai_draft is null),
  check (supersedes_id is null or (correction_note is not null and length(btrim(correction_note)) >= 10))
);
create index health_reports_patient_idx on public.health_reports (patient_id, year desc, version desc);
create index health_reports_queue_idx on public.health_reports (assigned_clinician_id) where status = 'pending_signature';

create function private.health_reports_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending_signature' then raise exception 'a signed report is never deleted' using errcode = '55000'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status in ('signed', 'superseded') then
    -- the only change allowed after signing: signed -> superseded, nothing else moving
    if not (old.status = 'signed' and new.status = 'superseded'
            and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at')) then
      raise exception 'a signed report cannot be changed; a correction is a new version' using errcode = '55000';
    end if;
    return new;
  end if;
  perform private.health_report_assert_honest(new.inputs, new.composed, new.priorities);
  new.updated_at := now();
  return new;
end $$;
create trigger health_reports_guard before insert or update or delete on public.health_reports
  for each row execute function private.health_reports_guard();

alter table public.health_reports enable row level security;
-- A patient reads their own report only once a named clinician has signed it. Unsigned rows are invisible (spec acceptance test).
create policy health_reports_patient_read on public.health_reports for select to authenticated
  using (patient_id = (select auth.uid()) and status = 'signed' and signed_by is not null);
revoke all on public.health_reports from public, anon, authenticated;
grant select on public.health_reports to authenticated;

-- Codes that never appear in a report: the sensitive list, and anything that merely looks like a blood-borne or sexual-health test (a lab can name
-- an analyte "hbv_dna" or "hepatitis_b_core"). Kept in step with the honesty guard's word list so a stray analyte cannot make a build fail either.
create function private.report_excluded_code(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_sensitive_result_code(p_code)
          or lower(coalesce(p_code, '')) ~ '(^|[^a-z])(hiv|hbsag|hbs_ag|hcv|hbv|hep_b|hep_c|hepatitis|syphilis|chlamydia|gonorrh|anti_hbs)' $$;
revoke all on function private.report_excluded_code(text) from public, anon, authenticated;

-- Biomarker series for the report (same rules as the S43 trends: released, not withdrawn, not replaced, never a sensitive code). A separate name so
-- S43's private.biomarker_points can replace it at merge without a collision (OQ-S46-6).
create function private.hr_biomarker_points(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, flag text)
language sql stable security definer set search_path = ''
as $$
  select r.released_at, i.value_numeric, i.unit, i.ref_low, i.ref_high, i.flag
    from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null
     and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
     and not i.sensitive_positive and not private.report_excluded_code(i.analyte_code)
  union all
  select l.taken_at, l.value, l.unit, l.reference_range_low, l.reference_range_high, l.abnormal_flag::text
    from public.lab_analyte_readings l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null
     and l.report_status in ('final', 'corrected', 'amended') and not private.report_excluded_code(l.code)
$$;
revoke all on function private.hr_biomarker_points(uuid, text) from public, anon, authenticated;

-- Facts only. No judgement is made here (the composer decides state words); nothing sensitive is read.
create function private.health_report_collect(p_patient uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from timestamptz := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Lagos');
  v_to   timestamptz := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Lagos');
  v_pfrom timestamptz := make_timestamptz(p_year - 1, 1, 1, 0, 0, 0, 'Africa/Lagos');
  v_bp jsonb; v_prior jsonb; v_labs jsonb; v_trends jsonb; v_screen jsonb; v_risk jsonb; v_dev jsonb; v_weight jsonb; v_quest jsonb; v_target jsonb;
  v_ra public.risk_assessments%rowtype;
begin
  select jsonb_build_object('count', count(*), 'firstAt', min(taken_at), 'lastAt', max(taken_at),
           'avgSystolic', round(avg(systolic), 1), 'avgDiastolic', round(avg(diastolic), 1))
    into v_bp from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and taken_at >= v_from and taken_at < v_to and systolic is not null and diastolic is not null;
  select jsonb_build_object('count', count(*), 'avgSystolic', round(avg(systolic), 1), 'avgDiastolic', round(avg(diastolic), 1))
    into v_prior from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and taken_at >= v_pfrom and taken_at < v_from and systolic is not null and diastolic is not null;
  if (v_prior ->> 'count')::integer = 0 then v_prior := null; end if;

  select jsonb_build_object('manual', count(*) filter (where source = 'manual'), 'device', count(*) filter (where source = 'device'),
           'wearable', count(*) filter (where source = 'wearable'))
    into v_dev from public.vitals_readings where patient_id = p_patient and taken_at >= v_from and taken_at < v_to;

  select jsonb_build_object('latestKg', (array_agg(weight_kg order by taken_at desc))[1], 'latestAt', max(taken_at), 'count', count(*))
    into v_weight from public.vitals_readings
   where patient_id = p_patient and vital_type = 'weight' and weight_kg is not null and taken_at >= v_from and taken_at < v_to;

  -- the care team's own BP target, if an active care plan carries one (never invented here)
  select jsonb_build_object('systolicBelow', (cp.target_ranges -> 'systolic' ->> 'max')::numeric, 'diastolicBelow', (cp.target_ranges -> 'diastolic' ->> 'max')::numeric, 'setBy', 'care_team')
    into v_target from public.care_plans cp
   where cp.patient_id = p_patient and cp.status = 'active' and (cp.target_ranges -> 'systolic' ->> 'max') is not null and (cp.target_ranges -> 'diastolic' ->> 'max') is not null
   order by cp.updated_at desc limit 1;

  -- labs: every analyte with a released numeric reading this year, latest and the latest from before this year
  select coalesce(jsonb_agg(x order by x ->> 'code'), '[]'::jsonb) into v_labs from (
    select jsonb_build_object('code', c.code,
        'unit', (array_agg(p.unit order by p.taken_at desc))[1],
        'readingsThisYear', count(*) filter (where p.taken_at >= v_from and p.taken_at < v_to),
        'latest', (select jsonb_build_object('at', q.taken_at, 'value', q.value, 'refLow', q.ref_low, 'refHigh', q.ref_high, 'flag', q.flag, 'unit', q.unit)
                     from private.hr_biomarker_points(p_patient, c.code) q where q.taken_at >= v_from and q.taken_at < v_to order by q.taken_at desc limit 1),
        'previous', (select jsonb_build_object('at', q.taken_at, 'value', q.value, 'refLow', q.ref_low, 'refHigh', q.ref_high, 'flag', q.flag, 'unit', q.unit)
                     from private.hr_biomarker_points(p_patient, c.code) q where q.taken_at < v_from order by q.taken_at desc limit 1)) as x
      from (select distinct lower(i.analyte_code) as code from public.lab_result_items i where i.patient_id = p_patient and i.value_numeric is not null
            union select distinct lower(l.code) from public.lab_analyte_readings l where l.patient_id = p_patient and l.value is not null) c
      cross join lateral private.hr_biomarker_points(p_patient, c.code) p
     where not private.report_excluded_code(c.code)
     group by c.code
    having count(*) filter (where p.taken_at >= v_from and p.taken_at < v_to) > 0) s;

  -- trends: the last few points per analyte (own history only, units never converted)
  select coalesce(jsonb_agg(t order by t ->> 'code'), '[]'::jsonb) into v_trends from (
    select jsonb_build_object('code', c.code,
        'unitMixed', (select count(distinct nullif(lower(btrim(q.unit)), '')) > 1 from private.hr_biomarker_points(p_patient, c.code) q),
        'points', (select coalesce(jsonb_agg(jsonb_build_object('at', z.taken_at, 'value', z.value, 'unit', z.unit, 'refLow', z.ref_low, 'refHigh', z.ref_high) order by z.taken_at), '[]'::jsonb)
                     from (select * from private.hr_biomarker_points(p_patient, c.code) q where q.taken_at >= make_timestamptz(p_year - 2, 1, 1, 0, 0, 0, 'Africa/Lagos') and q.taken_at < v_to
                            order by q.taken_at desc limit 6) z)) as t
      from (select distinct lower(i.analyte_code) as code from public.lab_result_items i where i.patient_id = p_patient and i.value_numeric is not null
            union select distinct lower(l.code) from public.lab_analyte_readings l where l.patient_id = p_patient and l.value is not null) c
     where not private.report_excluded_code(c.code)) s2
   where jsonb_array_length(t -> 'points') >= 2;

  -- screening done and due. Blood-borne and sexual-health items are never listed. Reproductive items are flagged so a shared copy can drop them.
  select jsonb_build_object(
    'done', (select coalesce(jsonb_agg(jsonb_build_object('code', st.code, 'on', sc.performed_date, 'reproductive', st.code in ('cervical_smear', 'breast_imaging', 'mammography', 'clinical_breast_exam', 'antenatal_booking', 'pcos_panel')) order by sc.performed_date), '[]'::jsonb)
               from public.screening_completions sc join public.screen_types st on st.id = sc.screen_type_id
              where sc.patient_id = p_patient and sc.performed_date >= v_from::date and sc.performed_date < v_to::date
                and st.code not in ('hiv', 'hep_b', 'hep_c', 'syphilis', 'chlamydia_gonorrhoea')),
    'due', (select coalesce(jsonb_agg(jsonb_build_object('code', st.code, 'dueOn', ss.due_date, 'status', ss.status::text, 'reproductive', st.code in ('cervical_smear', 'breast_imaging', 'mammography', 'clinical_breast_exam', 'antenatal_booking', 'pcos_panel')) order by ss.due_date), '[]'::jsonb)
               from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id
              where ss.patient_id = p_patient and ss.status in ('pending', 'booked', 'overdue')
                and st.code not in ('hiv', 'hep_b', 'hep_c', 'syphilis', 'chlamydia_gonorrhoea'))) into v_screen;

  -- the S45 risk band, only when the instrument is signed and its guard is on; otherwise "not assessed" (never an estimate)
  select ra.* into v_ra from public.risk_assessments ra
    join public.risk_instrument_versions iv on iv.id = ra.instrument_version_id
   where ra.patient_id = p_patient and ra.status = 'scored' and iv.is_active and iv.approved_by is not null
     and private.go_live_open_patient('risk_instrument_who2019_enabled', p_patient)
   order by ra.assessed_at desc limit 1;
  if v_ra.id is null then
    v_risk := jsonb_build_object('state', 'not_assessed');
  else
    v_risk := jsonb_build_object('state', 'assessed', 'bandCode', v_ra.band_code, 'tier', v_ra.tier, 'lowPct', v_ra.band_low_pct, 'highPct', v_ra.band_high_pct,
                                 'model', v_ra.model, 'assessedAt', v_ra.assessed_at, 'instrumentVersionId', v_ra.instrument_version_id,
                                 'basedOn', coalesce(v_ra.inputs, '{}'::jsonb));
  end if;

  -- questionnaire results (risk scores), never a mental-health instrument
  select coalesce(jsonb_agg(jsonb_build_object('type', s.score_type, 'level', s.risk_level::text, 'at', s.computed_at) order by s.computed_at desc), '[]'::jsonb) into v_quest
    from (select distinct on (score_type) * from public.patient_risk_scores
           where patient_id = p_patient and computed_at >= v_from and computed_at < v_to
             and score_type !~* '(phq|gad|mental|depress|anxiety|suicid|audit|substance)'
           order by score_type, computed_at desc) s;

  return jsonb_build_object('year', p_year, 'collectedAt', now(), 'bp', v_bp, 'bpPrior', v_prior, 'bpCareTeamTarget', v_target, 'weight', v_weight, 'devices', v_dev,
                            'labs', v_labs, 'trends', v_trends, 'screening', v_screen, 'risk', v_risk, 'questionnaires', v_quest);
end $$;
revoke all on function private.health_report_collect(uuid, integer) from public, anon, authenticated;

create function public.health_report_collect(p_patient uuid, p_year integer) returns jsonb
language sql stable security definer set search_path = ''
as $$ select private.health_report_collect(p_patient, p_year) $$;
revoke all on function public.health_report_collect(uuid, integer) from public, anon, authenticated;
grant execute on function public.health_report_collect(uuid, integer) to service_role;

-- The one writer of a new draft. Service role only; fails closed behind the guard (a test patient passes) and a signed settings version.
create function public.record_health_report_draft(p_patient uuid, p_year integer, p_inputs jsonb, p_composed jsonb, p_priorities jsonb, p_ai_draft text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_prof public.profiles%rowtype; v_cfg uuid; v_id uuid; v_ver integer; v_clin uuid; v_risk uuid;
begin
  select * into v_prof from public.profiles where id = p_patient;
  if not found or v_prof.organisation_id is null or v_prof.role <> 'patient' then raise exception 'patient_not_found' using errcode = '22023'; end if;
  if not private.go_live_open_patient('health_report_generation_enabled', p_patient) then
    raise exception 'not_live: yearly report generation is not switched on' using errcode = 'P0001';
  end if;
  select id into v_cfg from public.health_report_config_versions where is_active and approved_by is not null limit 1;
  if v_cfg is null and coalesce(v_prof.is_test, false) then select id into v_cfg from public.health_report_config_versions order by version desc limit 1; end if;
  if v_cfg is null then raise exception 'not_live: the report settings are not signed' using errcode = 'P0001'; end if;
  if exists (select 1 from public.health_reports where patient_id = p_patient and year = p_year and status = 'pending_signature') then
    raise exception 'draft_already_waiting_for_signature' using errcode = '23505';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.health_reports where patient_id = p_patient and year = p_year;
  select cta.clinician_id into v_clin from public.care_team_assignment cta where cta.patient_id = p_patient and cta.clinician_id is not null limit 1;
  v_risk := nullif(p_inputs -> 'risk' ->> 'instrumentVersionId', '')::uuid;
  insert into public.health_reports (organisation_id, patient_id, year, version, config_version_id, risk_instrument_version_id, inputs, composed, priorities,
                                     ai_draft, assigned_clinician_id, source, is_test)
    values (v_prof.organisation_id, p_patient, p_year, v_ver, v_cfg, v_risk, p_inputs, p_composed, coalesce(p_priorities, '[]'::jsonb),
            p_ai_draft, v_clin, 'system', coalesce(v_prof.is_test, false))
    returning id into v_id;
  perform private.emit_domain_event('health_report.generated', v_prof.organisation_id, jsonb_build_object('health_report_id', v_id),
      'health_report.generated:' || v_id, p_patient, 'health_report', v_id);
  return v_id;
end $$;
revoke all on function public.record_health_report_draft(uuid, integer, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_health_report_draft(uuid, integer, jsonb, jsonb, jsonb, text) to service_role;

-- Re-fill an unsigned draft (used after a correction is opened, so the new version carries the corrected facts).
create function public.refresh_health_report_draft(p_report uuid, p_inputs jsonb, p_composed jsonb, p_priorities jsonb, p_ai_draft text default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.health_reports set inputs = p_inputs, composed = p_composed, priorities = coalesce(p_priorities, '[]'::jsonb), ai_draft = p_ai_draft
   where id = p_report and status = 'pending_signature';
  return found;
end $$;
revoke all on function public.refresh_health_report_draft(uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.refresh_health_report_draft(uuid, jsonb, jsonb, jsonb, text) to service_role;

-- Who the yearly build should consider: active patients with something to report on that year and no report for it yet (service role only).
create function public.health_report_candidates(p_year integer, p_limit integer default 25) returns table (patient_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.id
    from public.profiles p
   where p.role = 'patient' and p.is_active and p.organisation_id is not null
     and not exists (select 1 from public.health_reports hr where hr.patient_id = p.id and hr.year = p_year)
     and (exists (select 1 from public.lab_results r where r.patient_id = p.id and r.release_state = 'released'
                    and r.released_at >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Lagos') and r.released_at < make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Lagos'))
          or exists (select 1 from public.vitals_readings v where v.patient_id = p.id and v.vital_type = 'blood_pressure'
                    and v.taken_at >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Lagos') and v.taken_at < make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Lagos')))
   order by p.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;
revoke all on function public.health_report_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.health_report_candidates(integer, integer) to service_role;

create function private.is_signing_clinician() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator') $$;
revoke all on function private.is_signing_clinician() from public, anon, authenticated;

create function public.clinician_health_report_queue() returns table (id uuid, patient_id uuid, year integer, version integer, created_at timestamptz, is_correction boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_signing_clinician() then raise exception 'not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('health_report.queue_read', 'health_reports', null, '{}'::jsonb);
  return query select r.id, r.patient_id, r.year, r.version, r.created_at, r.supersedes_id is not null
    from public.health_reports r
   where r.status = 'pending_signature' and private.clinician_has_patient_access(r.patient_id)
   order by r.created_at;
end $$;
revoke all on function public.clinician_health_report_queue() from public, anon;
grant execute on function public.clinician_health_report_queue() to authenticated;

create function public.clinician_get_health_report(p_id uuid) returns public.health_reports
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype;
begin
  select * into r from public.health_reports where id = p_id;
  if not found or not private.is_signing_clinician() or not private.clinician_has_patient_access(r.patient_id) then
    raise exception 'not_authorised: no active task, lead assignment or page for this patient' using errcode = '42501';
  end if;
  perform private.log_audit('health_report.read', 'profiles', r.patient_id, jsonb_build_object('health_report_id', p_id));
  return r;
end $$;
revoke all on function public.clinician_get_health_report(uuid) from public, anon;
grant execute on function public.clinician_get_health_report(uuid) to authenticated;

-- Signing is the last step before release. Any AI draft is wiped here; the signed text is whatever the clinician submits (INV-11).
create function public.sign_health_report(p_id uuid, p_summary text, p_summary_source text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype; v_staff public.clinical_staff%rowtype;
begin
  select * into r from public.health_reports where id = p_id;
  if not found then raise exception 'report_not_found' using errcode = '22023'; end if;
  select * into v_staff from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator' limit 1;
  if v_staff.id is null or not private.clinician_has_patient_access(r.patient_id) then
    raise exception 'not_authorised: only a doctor with this patient on their list can sign' using errcode = '42501';
  end if;
  if r.status <> 'pending_signature' then raise exception 'not_waiting_for_signature' using errcode = '22023'; end if;
  if btrim(coalesce(p_summary, '')) = '' or length(p_summary) > 2000 then raise exception 'summary_required' using errcode = '22023'; end if;
  if p_summary_source not in ('template', 'clinician', 'clinician_edited_ai_draft') then raise exception 'unknown_summary_source' using errcode = '22023'; end if;
  if btrim(coalesce(v_staff.credential_number, '')) = '' then raise exception 'registration_number_required' using errcode = '22023'; end if;
  -- the signed summary is itself held to the honesty rules (no sensitive result, no optimal or age claim)
  perform private.health_report_assert_honest('{}'::jsonb, jsonb_build_object('items', '[]'::jsonb, 'summary', p_summary), '[]'::jsonb);
  update public.health_reports set status = 'superseded'
   where patient_id = r.patient_id and year = r.year and status = 'signed' and id <> p_id;
  update public.health_reports set status = 'signed', signed_by = v_staff.id, signed_at = now(), signer_name = v_staff.full_name,
         signer_registration = v_staff.credential_number, summary_text = btrim(p_summary), summary_source = p_summary_source, ai_draft = null,
         recorded_by = (select auth.uid())
   where id = p_id;
  perform private.log_audit('health_report.signed', 'profiles', r.patient_id, jsonb_build_object('health_report_id', p_id, 'version', r.version));
  perform private.emit_domain_event('health_report.signed', r.organisation_id, jsonb_build_object('health_report_id', p_id),
      'health_report.signed:' || p_id, r.patient_id, 'health_report', p_id);
  return p_id;
end $$;
revoke all on function public.sign_health_report(uuid, text, text) from public, anon;
grant execute on function public.sign_health_report(uuid, text, text) to authenticated;

-- A correction is a new version with a visible note. The old signed version stays visible until the new one is signed.
create function public.correct_health_report(p_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r public.health_reports%rowtype; v_new uuid; v_ver integer;
begin
  select * into r from public.health_reports where id = p_id;
  if not found then raise exception 'report_not_found' using errcode = '22023'; end if;
  if not private.is_signing_clinician() or not private.clinician_has_patient_access(r.patient_id) then
    raise exception 'not_authorised: only a doctor with this patient on their list can correct a report' using errcode = '42501';
  end if;
  if r.status <> 'signed' then raise exception 'only_a_signed_report_is_corrected' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'correction_note_required' using errcode = '22023'; end if;
  if exists (select 1 from public.health_reports where patient_id = r.patient_id and year = r.year and status = 'pending_signature') then
    raise exception 'draft_already_waiting_for_signature' using errcode = '23505';
  end if;
  select max(version) + 1 into v_ver from public.health_reports where patient_id = r.patient_id and year = r.year;
  insert into public.health_reports (organisation_id, patient_id, year, version, config_version_id, risk_instrument_version_id, inputs, composed, priorities,
                                     assigned_clinician_id, supersedes_id, correction_note, source, recorded_by, is_test)
    values (r.organisation_id, r.patient_id, r.year, v_ver, r.config_version_id, r.risk_instrument_version_id, r.inputs, r.composed, r.priorities,
            (select auth.uid()), r.id, btrim(p_note), 'clinician', (select auth.uid()), r.is_test)
    returning id into v_new;
  perform private.log_audit('health_report.correction_opened', 'profiles', r.patient_id, jsonb_build_object('health_report_id', v_new, 'supersedes', r.id));
  perform private.emit_domain_event('health_report.generated', r.organisation_id, jsonb_build_object('health_report_id', v_new),
      'health_report.generated:' || v_new, r.patient_id, 'health_report', v_new);
  return v_new;
end $$;
revoke all on function public.correct_health_report(uuid, text) from public, anon;
grant execute on function public.correct_health_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Events (ids only, INV-07) and the guard (off, INV-14)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('health_report.generated', 'A yearly Health Report draft is waiting for a clinician to sign', 'S46', false),
  ('health_report.signed', 'A yearly Health Report was signed and is now visible to the patient', 'S46', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('health_report.generated', 1, array['health_report_id']),
  ('health_report.signed', 1, array['health_report_id']);

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('health_report_generation_enabled', 'Yearly Health Report generation', 'Building a yearly report draft for a patient',
   'CMO has signed the report settings and the fixed "screening does not rule out disease" wording', 'cmo',
   array['record_health_report_draft'], 'Reading and signing an already built draft is not behind this guard; nothing can be built while it is off.');

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.serology_rule_versions where status = 'active') <> 1 then raise exception 'S46 self-check: exactly one active serology rule version'; end if;
  if private.anti_hbs_threshold_confirmed() then raise exception 'S46 self-check: the anti-HBs threshold must start unconfirmed'; end if;
  if exists (select 1 from public.health_report_config_versions where is_active or approved_by is not null) then raise exception 'S46 self-check: report settings must start unsigned'; end if;
  if (select is_on from public.go_live_guards where key = 'health_report_generation_enabled') then raise exception 'S46 self-check: the report guard must start off'; end if;
  if has_table_privilege('anon', 'public.health_reports', 'SELECT') or has_table_privilege('authenticated', 'public.health_reports', 'INSERT') then
    raise exception 'S46 self-check: health_reports grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.record_health_report_draft(uuid,integer,jsonb,jsonb,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_health_report_draft(uuid,integer,jsonb,jsonb,jsonb,text)', 'EXECUTE') then
    raise exception 'S46 self-check: record_health_report_draft must be service role only';
  end if;
  if has_function_privilege('anon', 'public.sign_health_report(uuid,text,text)', 'EXECUTE') then raise exception 'S46 self-check: sign_health_report must not be anon'; end if;
  if (select count(*) from public.screening_rule_sets where version = 2) <> 1 then raise exception 'S46 self-check: rule set v2 missing'; end if;
end $$;
