-- S47 (decisions applied, chat selections 2026-10-07, docs/plans/S41-S46-cmo-decisions-2026-10-07.md decisions 7, 8, 13 and 14). NOT signatures.
-- Everything clinical here is UNSIGNED / PROPOSED: the serology rule v3, the screening rule set v3 and its risk criteria. Nothing is switched on.
--
-- What this does:
--   1. Hepatitis B immunity (7): the 10 mIU/mL threshold stays PROPOSED and unconfirmed. A numeric titre alone NEVER sets immunity (the trigger no
--      longer has a titre path at all); a laboratory-flagged positive or a doctor-recorded immunity does, and then routine HBsAg stops unless a new
--      exposure is on record (compute_screening_order_exclusions and screening_due both honour that).
--   2. HIV and hepatitis C become RISK-BASED, offered yearly to people who qualify (8): screening_rule_sets v3 marks them riskBased; the criteria
--      live in the rule set's own versioned, unsigned config (riskCriteria); a person qualifies through screening_risk_flags (self-reported or
--      recorded by a doctor, valid 12 months, revocable), or, for hepatitis C, by living with HIV. The scheduler no longer calendars them for every
--      adult. A patient can STILL order either test at any time: the order path (compute_screening_order_exclusions) is not made stricter by this.
--   3. Cervical (13): HPV DNA at ages 35 and 45 (a milestone window of 5 years each); a woman living with HIV is flagged to the care team through
--      screening_care_team_flags and a screening.care_team_review_needed event (ids only), never auto-scheduled by this rule. The HPV DNA sale
--      itself stays behind hpv_dna_enabled. S45's acceptance (a 45-year-old woman is scheduled) still holds under the milestone rule.
--   4. Packages (14): hiv, hep_b and hep_c are removed from the Essential, Core, Advanced and Comprehensive bundles (they are added by risk and history
--      through the screening rules, or bought as single items). Prices are NOT changed here (open question OQ-S47-1). Know Your Basics stays.
--
-- Counted first: nothing in this migration touches existing patient data; screening_risk_flags and screening_care_team_flags are new and empty.
-- Not applied to production by the author. Timestamp hand-picked later than every file on the branch and every live version read 2026-10-07.

-- ---------------------------------------------------------------------------
-- 1. Risk flags (who qualifies for a risk-based test) and care-team flags
-- ---------------------------------------------------------------------------
create table public.screening_risk_flags (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  criterion_code  text not null check (criterion_code ~ '^[a-z][a-z0-9_]*$'),
  basis           text not null check (basis in ('patient_reported', 'clinician_recorded')),
  recorded_by     uuid not null references public.profiles (id) on delete restrict,
  recorded_at     timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '12 months'),
  revoked_at      timestamptz,
  is_test         boolean not null default false
);
create unique index screening_risk_flags_live_idx on public.screening_risk_flags (patient_id, criterion_code) where revoked_at is null;
alter table public.screening_risk_flags enable row level security;
-- The patient reads their own; staff read through the audited function only (INV-10, INV-12).
create policy screening_risk_flags_patient_read on public.screening_risk_flags for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.screening_risk_flags from public, anon, authenticated;
grant select on public.screening_risk_flags to authenticated;
comment on table public.screening_risk_flags is 'S47: a stated reason a person qualifies for a risk-based screening test (HIV, hepatitis C). Codes come from screening_rule_sets.config.riskCriteria. Sensitive: never in a report, never in a notification.';

create table public.screening_care_team_flags (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  screen_type_id  uuid not null references public.screen_types (id),
  reason_code     text not null check (reason_code in ('review_cervical_pathway')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id) on delete restrict,
  resolution_note text,
  is_test         boolean not null default false,
  check ((resolved_at is null) = (resolved_by is null))
);
create unique index screening_care_team_flags_open_idx on public.screening_care_team_flags (patient_id, screen_type_id, reason_code) where resolved_at is null;
alter table public.screening_care_team_flags enable row level security;
-- No patient policy and no staff table policy: the row is read only through clinician_list_screening_care_flags (tied, audited).
revoke all on public.screening_care_team_flags from public, anon, authenticated;
comment on table public.screening_care_team_flags is 'S47: the cervical pathway for this patient needs a care-team decision. The row deliberately carries no status word; the reason is generic (INV-04, INV-07).';

create function private.screening_risk_qualifies(p_patient uuid, p_criteria jsonb, p_hiv text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_criteria) = 'array' and (
       (p_hiv = 'hiv_positive' and p_criteria ? 'living_with_hiv')
       or exists (select 1 from public.screening_risk_flags f
                   where f.patient_id = p_patient and f.revoked_at is null and f.expires_at > now()
                     and p_criteria ? f.criterion_code)), false)
$$;
revoke all on function private.screening_risk_qualifies(uuid, jsonb, text) from public, anon, authenticated;

-- The codes a flag may carry: those the latest screening rule set names. A fixed vocabulary, not free text.
create function private.screening_risk_codes() returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct c), '{}'::text[]) from (
    select jsonb_array_elements_text(e.value) as c
      from jsonb_each((select rs.config -> 'riskCriteria' from public.screening_rule_sets rs order by rs.version desc limit 1)) e
     where jsonb_typeof(e.value) = 'array') s
$$;
revoke all on function private.screening_risk_codes() from public, anon, authenticated;

create function public.record_screening_risk_flag(p_patient uuid, p_criterion text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_test boolean; v_basis text; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_patient is distinct from v_uid then
    if not private.clinician_has_patient_access(p_patient) then
      raise exception 'not_authorised: no active task, lead assignment or page for this patient' using errcode = '42501';
    end if;
    if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator') then
      raise exception 'not_authorised: a doctor records this' using errcode = '42501';
    end if;
    v_basis := 'clinician_recorded';
  else
    v_basis := 'patient_reported';
  end if;
  if not (p_criterion = any (private.screening_risk_codes())) then raise exception 'unknown_criterion' using errcode = '22023'; end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = p_patient;
  if v_org is null then raise exception 'patient_not_found' using errcode = 'P0002'; end if;
  update public.screening_risk_flags set revoked_at = now() where patient_id = p_patient and criterion_code = p_criterion and revoked_at is null and expires_at <= now();
  insert into public.screening_risk_flags (organisation_id, patient_id, criterion_code, basis, recorded_by, is_test)
    values (v_org, p_patient, p_criterion, v_basis, v_uid, coalesce(v_test, false))
    on conflict (patient_id, criterion_code) where revoked_at is null do update set recorded_at = now(), expires_at = now() + interval '12 months', basis = excluded.basis, recorded_by = excluded.recorded_by
    returning id into v_id;
  perform private.log_audit('screening.risk_flag_recorded', 'profiles', p_patient, jsonb_build_object('basis', v_basis));
  return v_id;
end $$;
revoke all on function public.record_screening_risk_flag(uuid, text) from public, anon;
grant execute on function public.record_screening_risk_flag(uuid, text) to authenticated;

create function public.revoke_screening_risk_flag(p_flag uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_p uuid; v_uid uuid := (select auth.uid());
begin
  select patient_id into v_p from public.screening_risk_flags where id = p_flag and revoked_at is null;
  if v_p is null then return false; end if;
  if v_p is distinct from v_uid and not private.clinician_has_patient_access(v_p) then raise exception 'not_authorised' using errcode = '42501'; end if;
  update public.screening_risk_flags set revoked_at = now() where id = p_flag;
  perform private.log_audit('screening.risk_flag_revoked', 'profiles', v_p, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.revoke_screening_risk_flag(uuid) from public, anon;
grant execute on function public.revoke_screening_risk_flag(uuid) to authenticated;

create function public.clinician_list_screening_risk_flags(p_patient uuid) returns setof public.screening_risk_flags
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then raise exception 'not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('screening.risk_flags_read', 'profiles', p_patient, '{}'::jsonb);
  return query select * from public.screening_risk_flags where patient_id = p_patient order by recorded_at desc;
end $$;
revoke all on function public.clinician_list_screening_risk_flags(uuid) from public, anon;
grant execute on function public.clinician_list_screening_risk_flags(uuid) to authenticated;

create function public.clinician_list_screening_care_flags(p_patient uuid) returns table (id uuid, reason_code text, created_at timestamptz, resolved_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then raise exception 'not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('screening.care_flags_read', 'profiles', p_patient, '{}'::jsonb);
  return query select f.id, f.reason_code, f.created_at, f.resolved_at from public.screening_care_team_flags f where f.patient_id = p_patient order by f.created_at desc;
end $$;
revoke all on function public.clinician_list_screening_care_flags(uuid) from public, anon;
grant execute on function public.clinician_list_screening_care_flags(uuid) to authenticated;

create function public.resolve_screening_care_flag(p_flag uuid, p_note text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_p uuid; v_uid uuid := (select auth.uid());
begin
  select patient_id into v_p from public.screening_care_team_flags where id = p_flag and resolved_at is null;
  if v_p is null then return false; end if;
  if not private.clinician_has_patient_access(v_p) then raise exception 'not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.status = 'active' and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not_authorised: a doctor resolves this' using errcode = '42501';
  end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'note_required' using errcode = '22023'; end if;
  update public.screening_care_team_flags set resolved_at = now(), resolved_by = v_uid, resolution_note = btrim(p_note) where id = p_flag;
  perform private.log_audit('screening.care_flag_resolved', 'profiles', v_p, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.resolve_screening_care_flag(uuid, text) from public, anon;
grant execute on function public.resolve_screening_care_flag(uuid, text) to authenticated;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('screening.care_team_review_needed', 'A screening pathway needs a care-team decision (ids only; no status or condition in the payload)', 'S47', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('screening.care_team_review_needed', 1, array['screening_care_flag_id'])
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Rule data: serology v3 (active, threshold unconfirmed) and screening rule set v3 (unsigned)
-- ---------------------------------------------------------------------------
update public.serology_rule_versions set status = 'legacy' where version = 2 and status = 'active';
-- serology-rules-v3-begin
insert into public.serology_rule_versions (version, code, status, decision_ref, notes, config) values
 (3, 'risk_based_2026_10', 'active', 'chat selections 2026-10-07 (not a signature): HIV and hepatitis C risk-based, yearly for those who qualify',
  'v2 made HIV and hepatitis C annual for everyone. v3 makes them risk-based (riskBased). The anti-HBs threshold is PROPOSED and unconfirmed, and a numeric titre alone never sets immunity. Hepatitis B stops on recorded immunity unless a new exposure is on record. The risk lists are unverified against the Nigeria 2023 HIV guideline (interval not read).',
  $json${
 "hiv": {
  "repeatMonths": 12,
  "suppressWithinInterval": false,
  "riskBased": true
 },
 "hep_c": {
  "repeatMonths": 12,
  "suppressWithinInterval": true,
  "riskBased": true
 },
 "hep_b": {
  "repeatMonths": 12,
  "suppressWithinInterval": true,
  "stopsWhenHbvStatus": [
   "immune"
  ],
  "immunityTest": "anti_hbs",
  "reopensOnNewExposure": true
 },
 "antiHbs": {
  "thresholdMiuPerMl": 10,
  "thresholdStatus": "proposed_unconfirmed",
  "numericTitreAloneSetsImmunity": false
 },
 "riskCriteria": {
  "hcv": [
   "transfusion_or_transplant",
   "injecting_drug_use",
   "haemodialysis",
   "contact_with_infected_person",
   "healthcare_sharps_exposure",
   "liver_disease_or_raised_enzymes",
   "living_with_hiv",
   "tattoo_or_scarification",
   "men_who_have_sex_with_men",
   "sex_work",
   "prison_history"
  ],
  "hiv": [
   "ongoing_risk",
   "sexually_active_adult"
  ]
 },
 "riskCriteriaSource": {
  "hcv": "Nigeria FMOH 2016 hepatitis guideline risk list (read); WHO risk groups (search snippet only)",
  "hiv": "Product wording of 'ongoing risk or sexually active adult'. The Nigeria 2023 HIV guideline retest interval was NOT read.",
  "evidence": "unverified"
 }
}$json$::jsonb);
-- serology-rules-v3-end

-- screening-rules-v3-begin
insert into public.screening_rule_sets (version, notes, config)
select 3,
  'PROPOSED, UNSIGNED. v2 (S46) with: HIV and hepatitis C riskBased (offered yearly to people who qualify, not scheduled for every adult); cervical screening by HPV DNA at ages 35 and 45 (milestone window 5 years) with women living with HIV flagged to the care team, not auto-scheduled; prostate stays optional. The age milestones are from chat selections (WHO elimination targets adopted by Nigeria, search snippet): the national cervical screening guideline text was NOT read. The CMO signs this version, or another, before the scheduler runs for a real patient.',
  jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(
        case when x ->> 'code' = 'hiv'   then x || '{"riskBased":true,"riskCriteriaKey":"hiv","oncePerLifetime":false,"frequencyMonths":12}'::jsonb
             when x ->> 'code' = 'hep_c' then x || '{"riskBased":true,"riskCriteriaKey":"hcv","oncePerLifetime":false,"frequencyMonths":12}'::jsonb
             when x ->> 'code' = 'cervical_smear' then $json${"code": "cervical_smear", "method": "hpv_dna", "sex": "female", "ageFrom": 35, "ageTo": 49, "ageMilestones": [35, 45], "milestoneWindowYears": 5, "frequencyMonths": null, "oncePerLifetime": false, "isOptional": false, "autoSchedule": true, "excludeWhenHiv": true}$json$::jsonb
             else x end order by x ->> 'code'), '[]'::jsonb)
      from jsonb_array_elements(rs2.config -> 'rules') x),
    'riskCriteria', $json${"hcv": ["transfusion_or_transplant", "injecting_drug_use", "haemodialysis", "contact_with_infected_person", "healthcare_sharps_exposure", "liver_disease_or_raised_enzymes", "living_with_hiv", "tattoo_or_scarification", "men_who_have_sex_with_men", "sex_work", "prison_history"], "hiv": ["ongoing_risk", "sexually_active_adult"]}$json$::jsonb,
    'riskCriteriaSource', $json${"hcv": "Nigeria FMOH 2016 hepatitis guideline risk list (read); WHO risk groups (search snippet only)", "hiv": "Product wording of 'ongoing risk or sexually active adult'. The Nigeria 2023 HIV guideline retest interval was NOT read.", "evidence": "unverified"}$json$::jsonb)
from public.screening_rule_sets rs2 where rs2.code = 'screening_rules' and rs2.version = 2;
-- screening-rules-v3-end

-- ---------------------------------------------------------------------------
-- 3. Functions restated (bodies of the S46 / S45 definitions plus the edits marked S47)
-- ---------------------------------------------------------------------------
create or replace function private.lab_item_anti_hbs_immunity() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if lower(new.analyte_code) <> 'anti_hbs' then return new; end if;
  -- S47 (decision 7): ONLY a laboratory-flagged positive on a RELEASED, non-withdrawn, non-superseded result records immunity. A numeric titre alone never
  -- does, whatever the threshold says; the 10 mIU/mL figure is a PROPOSED, unconfirmed hint for the doctor who records immunity by hand.
  -- (An item usually arrives before its result is released; lab_results_anti_hbs_sync below acts when the result is released.)
  if new.flag = 'positive' and exists (select 1 from public.lab_results r where r.id = new.lab_result_id
        and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null) then
    perform private.set_hbv_immune(new.patient_id, 'anti_hbs_positive', new.id, null);
  end if;
  return new;
end $$;

-- Release, withdrawal and supersession of the whole result re-evaluate the immune flag: a withdrawn or replaced positive must not leave it standing.
create function private.lab_result_anti_hbs_sync() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare it record; v_t record; v_cur text;
begin
  if new.release_state = 'released' and new.withdrawn_at is null and new.superseded_by is null then
    for it in select id from public.lab_result_items where lab_result_id = new.id and lower(analyte_code) = 'anti_hbs' and flag = 'positive' loop
      perform private.set_hbv_immune(new.patient_id, 'anti_hbs_positive', it.id, null);
    end loop;
    return new;
  end if;
  -- no longer valid: take back immunity that rests on THIS result, unless another valid basis exists
  select t.* into v_t from public.serology_status_transitions t
   where t.patient_id = new.patient_id and t.virus = 'hbv' and t.to_status::text = 'immune' and t.basis = 'anti_hbs_positive'
     and t.lab_result_item_id in (select id from public.lab_result_items where lab_result_id = new.id)
   order by t.created_at desc limit 1;
  if not found then return new; end if;
  select hbv_status::text into v_cur from public.patient_serology_status where patient_id = new.patient_id;
  if v_cur is distinct from 'immune' then return new; end if;
  if exists (select 1 from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
              where i.patient_id = new.patient_id and lower(i.analyte_code) = 'anti_hbs' and i.flag = 'positive' and r.id <> new.id
                and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null) then
    return new;
  end if;
  if exists (select 1 from public.serology_status_transitions t2
              where t2.patient_id = new.patient_id and t2.virus = 'hbv' and t2.to_status::text = 'immune' and t2.basis like 'clinician:%'
                and not exists (select 1 from public.serology_status_transitions t3 where t3.patient_id = new.patient_id and t3.virus = 'hbv'
                                  and t3.basis = 'clinician_cleared' and t3.created_at > t2.created_at)) then
    return new;
  end if;
  update public.patient_serology_status set hbv_status = coalesce(nullif(v_t.from_status::text, 'immune'), 'unknown')::public.hbv_status, updated_at = now()
   where patient_id = new.patient_id;
  insert into public.serology_status_transitions (organisation_id, patient_id, virus, from_status, to_status, basis, lab_result_item_id, recorded_by)
    values (new.organisation_id, new.patient_id, 'hbv', 'immune', coalesce(nullif(v_t.from_status::text, 'immune'), 'unknown'), 'lab_result_no_longer_valid', v_t.lab_result_item_id, null);
  return new;
end $$;
revoke all on function private.lab_result_anti_hbs_sync() from public, anon, authenticated;
create trigger lab_results_anti_hbs_sync after update of release_state, withdrawn_at, superseded_by on public.lab_results
  for each row execute function private.lab_result_anti_hbs_sync();

create or replace function private.screening_due(p_patient uuid, p_rule_set uuid)
returns table (screen_type_id uuid, screen_type_code text, due_date date, reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_sex text; v_dob date; v_age integer; v_cfg jsonb; v_hbv text; v_hcv text; v_hiv text; v_exp boolean;
begin
  select pr.sex::text, pr.date_of_birth into v_sex, v_dob from public.profiles pr where pr.id = p_patient;
  select config into v_cfg from public.screening_rule_sets where id = p_rule_set;
  if v_dob is null or v_sex is null or v_cfg is null then return; end if;
  v_age := extract(year from age(current_date, v_dob))::integer;
  select hbv_status::text, hcv_status::text, hiv_status::text into v_hbv, v_hcv, v_hiv from public.patient_serology_status where patient_id = p_patient;
  v_hbv := coalesce(v_hbv, 'unknown'); v_hcv := coalesce(v_hcv, 'unknown'); v_hiv := coalesce(v_hiv, 'unknown');
  -- S47: a new exposure on record reopens routine HBsAg even after recorded immunity (an open report with a retest rule for hep_b and no hep_b result since).
  select exists (select 1 from public.patient_exposure_reports per
                   join public.exposure_retest_rules rr on rr.exposure_code = per.exposure_code and rr.screen_type_code = 'hep_b'
                  where per.patient_id = p_patient and per.status = 'open'
                    and not exists (select 1 from public.screening_results sr where sr.patient_id = p_patient and sr.screen_type_code = 'hep_b' and sr.created_at > per.reported_at))
    into v_exp;
  return query
  select st.id, st.code,
         case when lc.last_done is null or r."ageMilestones" is not null then current_date else (lc.last_done + make_interval(months => r."frequencyMonths"))::date end,
         case when r."ageMilestones" is not null then 'milestone' when lc.last_done is null then 'first_due' else 'recurrence' end
    from jsonb_to_recordset(v_cfg -> 'rules') as r(code text, sex text, "ageFrom" integer, "ageTo" integer, "frequencyMonths" integer,
                                                   "oncePerLifetime" boolean, "isOptional" boolean, "autoSchedule" boolean,
                                                   "stopsWhenHbvStatus" text[],
                                                   "riskBased" boolean, "riskCriteriaKey" text, "ageMilestones" integer[], "milestoneWindowYears" integer,
                                                   "excludeWhenHiv" boolean)
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
     and (r."ageMilestones" is not null or not (lc.last_done is not null and (coalesce(r."oncePerLifetime", false) or r."frequencyMonths" is null)))
     -- S47 (decision 13): HPV DNA at the configured ages. Due while the patient is inside a milestone's window and has no cervical result since turning that age.
     and (r."ageMilestones" is null or exists (
            select 1 from unnest(r."ageMilestones") m
             where v_age >= m and v_age < m + coalesce(r."milestoneWindowYears", 5)
               and (lc.last_done is null or lc.last_done < (v_dob + make_interval(years => m))::date)))
     -- S47 (decision 13): a woman living with HIV is flagged to the care team by the scheduler, never auto-scheduled by this rule.
     and not (coalesce(r."excludeWhenHiv", false) and v_hiv = 'hiv_positive')
     -- S47 (decision 8): HIV and hepatitis C are offered yearly to people who qualify, not scheduled for every adult.
     and not (coalesce(r."riskBased", false) and not private.screening_risk_qualifies(p_patient, v_cfg -> 'riskCriteria' -> r."riskCriteriaKey", v_hiv))
     and not (r.code = 'hep_b' and (v_hbv = 'chronic_hbv' or (v_hbv = any (coalesce(r."stopsWhenHbvStatus", '{}'::text[])) and not v_exp)))
     and not (r.code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active'))
     and not (r.code = 'hiv' and v_hiv = 'hiv_positive')
     and not exists (select 1 from public.screening_schedules ss
                      where ss.patient_id = p_patient and ss.screen_type_id = st.id
                        and ss.status in ('pending', 'booked', 'overdue', 'declined', 'not_applicable'));
end $$;
revoke all on function private.screening_due(uuid, uuid) from public, anon, authenticated;

create or replace function private.run_screening_scheduler(p_patient uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_set uuid; v_created integer := 0; v_events integer := 0; r record; v_reasons text[]; v_flagged integer := 0;
begin
  if p_patient is null then
    if not private.go_live_guard_on('screening_scheduler_enabled') then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
    select id into v_set from public.screening_rule_sets where is_active and approved_by is not null limit 1;
  else
    if not private.go_live_open_patient('screening_scheduler_enabled', p_patient) then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
    select id into v_set from public.screening_rule_sets
     where (is_active and approved_by is not null)
        or (exists (select 1 from public.profiles where id = p_patient and is_test))
     order by (is_active and approved_by is not null) desc, version desc limit 1;
  end if;
  if v_set is null then return jsonb_build_object('ran', false, 'reason', 'rules_not_signed'); end if;

  for r in
    with due as (
      select p.id as patient_id, p.organisation_id, d.*
        from public.profiles p
        cross join lateral private.screening_due(p.id, v_set) d
       where p.role = 'patient' and p.is_active and p.organisation_id is not null
         and (p_patient is null or p.id = p_patient)
    ), ins as (
      insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
      select organisation_id, patient_id, screen_type_id, 'pending', due_date, v_set from due
      returning id, organisation_id, patient_id, due_date
    )
    select * from ins
  loop
    v_created := v_created + 1;
    if r.due_date <= current_date + 30 then
      perform private.emit_domain_event('screening.due', r.organisation_id, jsonb_build_object('screening_schedule_id', r.id),
        'screening.due:' || r.id, r.patient_id, 'screening_schedule', r.id);
      v_events := v_events + 1;
    end if;
  end loop;

  -- S47 (decision 13): a woman living with HIV is flagged to the care team for her cervical pathway. This rule never schedules her itself.
  -- The row says only that the pathway needs a care-team decision (no status word); the event carries ids only (INV-07).
  for r in
    with flagged as (
      insert into public.screening_care_team_flags (organisation_id, patient_id, screen_type_id, reason_code, is_test)
      select p.organisation_id, p.id, st.id, 'review_cervical_pathway', p.is_test
        from public.profiles p
        join public.patient_serology_status ss on ss.patient_id = p.id and ss.hiv_status = 'hiv_positive'
        cross join lateral jsonb_to_recordset((select rs.config -> 'rules' from public.screening_rule_sets rs where rs.id = v_set))
             as x(code text, sex text, "ageFrom" integer, "ageTo" integer, "excludeWhenHiv" boolean)
        join public.screen_types st on st.code = x.code
       where coalesce(x."excludeWhenHiv", false)
         and p.role = 'patient' and p.is_active and p.organisation_id is not null and p.date_of_birth is not null
         and p.sex::text = x.sex
         and (p_patient is null or p.id = p_patient)
         and extract(year from age(current_date, p.date_of_birth))::integer between coalesce(x."ageFrom", 0) and coalesce(x."ageTo", 150)
         -- a flag the care team already resolved in the last 12 months is not raised again every night
         and not exists (select 1 from public.screening_care_team_flags f where f.patient_id = p.id and f.screen_type_id = st.id and f.resolved_at > now() - interval '12 months')
      on conflict (patient_id, screen_type_id, reason_code) where resolved_at is null do nothing
      returning id, organisation_id, patient_id
    ) select * from flagged
  loop
    v_flagged := v_flagged + 1;
    perform private.emit_domain_event('screening.care_team_review_needed', r.organisation_id, jsonb_build_object('screening_care_flag_id', r.id),
      'screening.care_team_review_needed:' || r.id, r.patient_id, 'screening_care_team_flag', r.id);
  end loop;

  -- reassessment prompts ride the same nightly run (only while the risk guard is on)
  if p_patient is null and private.go_live_guard_on('risk_instrument_who2019_enabled') then
    for r in select distinct ra.patient_id, ra.organisation_id from public.risk_assessments ra loop
      v_reasons := private.risk_reassessment_reasons(r.patient_id);
      if cardinality(v_reasons) > 0 then
        perform private.emit_domain_event('risk.reassessment_due', r.organisation_id, jsonb_build_object('patient_ref', r.patient_id),
          'risk.reassessment_due:' || r.patient_id || ':' || to_char(current_date, 'YYYY'), r.patient_id, 'profile', r.patient_id);
      end if;
    end loop;
  end if;
  return jsonb_build_object('ran', true, 'rule_set_id', v_set, 'created', v_created, 'events', v_events, 'care_flags', v_flagged);
end $$;
revoke all on function private.run_screening_scheduler(uuid) from public, anon, authenticated;

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
    -- S47 (decision 7): recorded immunity stops routine HBsAg unless a new exposure is on record (the rule says so with reopensOnNewExposure).
    if v_reason is null and v_code = 'hep_b' and v_rule is not null
       and (v_rule -> 'stopsWhenHbvStatus') ? v_hbv::text
       and not (v_reopened and coalesce((v_rule ->> 'reopensOnNewExposure')::boolean, false)) then
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

-- ---------------------------------------------------------------------------
-- 4. Packages (14): no blood-borne virus test is bundled for everyone
-- ---------------------------------------------------------------------------
update public.panel_bundles
   set test_codes = array(select t from unnest(test_codes) t where t not in ('hiv', 'hep_b', 'hep_c'))
 where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive', 'health_check_comprehensive');
update public.panel_bundles set description = 'Kidney function, HbA1c, lipids, urinalysis and full blood count. The Core Screen without liver function testing. HIV and hepatitis tests are offered through your screening calendar when they apply to you, or you can add one yourself at any time.'
 where code = 'screen_essential';
update public.panel_bundles set description = 'Cardiometabolic and organ-baseline screen: HbA1c, full lipid panel, FBC, liver and kidney function, urinalysis, plus PHQ-9/GAD-7. HIV and hepatitis tests are offered through your screening calendar when they apply to you, or you can add one yourself at any time.'
 where code = 'screen_core';
update public.panel_bundles set description = 'Everything in Core Screen, plus urine ACR, OGTT (fires only on borderline HbA1c), resting ECG, and age-triggered FIT and PSA screening, with a personalised screening calendar written to your health passport.'
 where code = 'screen_advanced' and description ~* 'hiv|hepatitis';
update public.panel_bundles set description = 'Everything in Advanced Screen, plus abdominal ultrasound, breast imaging, prostate ultrasound and a vaccination catch-up plan. Sexual-health and blood-borne virus tests are offered when they apply to you.'
 where code = 'screen_comprehensive';
update public.panel_bundles set description = 'Everything in the Annual Health Check, with a personalised screening calendar. HIV and hepatitis tests are offered when they apply to you.'
 where code = 'health_check_comprehensive';

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.serology_rule_versions where status = 'active') <> 1 or (select version from public.serology_rule_versions where status = 'active') <> 3 then
    raise exception 'S47 self-check: serology v3 must be the single active rule';
  end if;
  if private.anti_hbs_threshold_confirmed() then raise exception 'S47 self-check: the anti-HBs threshold must start unconfirmed'; end if;
  if exists (select 1 from public.screening_rule_sets where version = 3 and (is_active or approved_by is not null)) then raise exception 'S47 self-check: rule set v3 must be unsigned'; end if;
  if exists (select 1 from public.panel_bundles where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive') and test_codes && array['hiv', 'hep_b', 'hep_c']) then
    raise exception 'S47 self-check: a tier bundle still carries a blood-borne virus test';
  end if;
  if has_table_privilege('anon', 'public.screening_risk_flags', 'SELECT') or has_table_privilege('authenticated', 'public.screening_risk_flags', 'INSERT')
     or has_table_privilege('authenticated', 'public.screening_care_team_flags', 'SELECT') then
    raise exception 'S47 self-check: flag table grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.record_screening_risk_flag(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.resolve_screening_care_flag(uuid,text)', 'EXECUTE') then
    raise exception 'S47 self-check: a flag function is reachable by anon';
  end if;
end $$;
