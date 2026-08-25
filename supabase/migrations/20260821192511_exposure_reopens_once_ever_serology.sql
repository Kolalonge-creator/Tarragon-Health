-- Founder decision 2026-08-21: "Know Your Basics" is once, ever — but the
-- patient can tell us if something changes, and the test comes back when it
-- needs to.
--
-- WHY THE FOUR ITEMS IN THAT TIER ARE NOT THE SAME KIND OF THING
-- --------------------------------------------------------------
-- Blood group and genotype are facts about a body. Nothing that happens to a
-- person can change them, so "once, ever" is literally true and re-testing is
-- pure waste.
--
-- Hepatitis B and C are not facts about a body; they are a statement about a
-- body AT A POINT IN TIME. A negative result says "not infected as of the day
-- we tested", and a needlestick, a transfusion, an unsterile tattoo needle or
-- a new sexual partner all make that statement out of date. Selling those two
-- as identically permanent would be the platform telling a patient something
-- untrue about their own health.
--
-- So the tier keeps its promise — nobody is charged again for a test they do
-- not need — while the promise itself becomes honest: once, ever, unless
-- something changes, and you can tell us when it does.
--
-- THE THING THAT MATTERS MOST HERE IS NOT THE RE-TEST
-- ---------------------------------------------------
-- It is the 72 hours before it. Someone reporting a fresh high-risk exposure
-- may need post-exposure prophylaxis NOW — HIV PEP works for roughly 72 hours
-- and hepatitis B immunoglobulin sooner. Answering that person with "your
-- hepatitis B check is due again on 15 October" would be worse than useless:
-- it would read as care while the window that actually mattered closed. A
-- recent, PEP-relevant exposure therefore raises an emergency_event first and
-- schedules the re-test second.
--
-- AND THE SECOND THING IS NOT TESTING TOO SOON
-- --------------------------------------------
-- Serology has a window period. A hepatitis C antibody test taken a week after
-- exposure is negative in almost everyone who was infected, so selling it then
-- takes a patient's money for a reassurance that is not real. Every re-test is
-- scheduled at the earliest date it can actually answer the question, and the
-- ordering path refuses it before then with the date it becomes useful.
--
-- WHAT IS DELIBERATELY NOT MODELLED HERE
-- --------------------------------------
-- A sexual-assault pathway. That needs a safeguarding response — not a test
-- date — and designing one unilaterally would be inappropriate. The exposure
-- taxonomy below is clinically neutral, 'other' routes to a human, and the
-- Clinical Director should decide whether a distinct pathway is added.
--
-- Every interval below is standard practice, NOT a signed protocol. They are
-- carried as data with their basis recorded so the Clinical Director can
-- review and change them with an UPDATE.

-- ---------------------------------------------------------------------------
-- 1. Which "once, ever" items can be reopened at all.
-- ---------------------------------------------------------------------------
alter table public.screen_types
  add column if not exists reopens_on_exposure boolean not null default false;

comment on column public.screen_types.reopens_on_exposure is
  'True for a once-per-lifetime test whose result is a statement about a point in time rather than an unchangeable fact, so a reported exposure can legitimately reopen it. Blood group and genotype are false: they are immutable and no exposure can change them.';

update public.screen_types set reopens_on_exposure = true  where code in ('hep_b', 'hep_c');
update public.screen_types set reopens_on_exposure = false where code in ('blood_group', 'sickle_cell_genotype');

-- ---------------------------------------------------------------------------
-- 2. The exposures a patient can tell us about.
-- ---------------------------------------------------------------------------
create table if not exists public.exposure_types (
  code             text primary key,
  label            text not null,
  description      text not null,
  pep_relevant     boolean not null default false,
  pep_window_hours integer,
  routes_to_human  boolean not null default false,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  check (not pep_relevant or pep_window_hours is not null)
);

comment on table public.exposure_types is
  'What a patient can report, in their own words on screen. pep_relevant marks the ones where post-exposure prophylaxis is time-critical; pep_window_hours is how long that window lasts. routes_to_human marks the ones no algorithm should be deciding about.';

insert into public.exposure_types
  (code, label, description, pep_relevant, pep_window_hours, routes_to_human, sort_order) values
  ('needlestick_or_sharps', 'A needle or sharp object injury',
   'A used needle, blade or other sharp broke your skin — at work, or anywhere else.', true, 72, false, 10),
  ('sexual_exposure', 'Sex without a condom with a new or untested partner',
   'Anything where there was a real chance of coming into contact with someone else''s blood or body fluids.', true, 72, false, 20),
  ('shared_injecting_equipment', 'Shared injecting equipment',
   'A needle, syringe or anything else used for injecting was shared.', true, 72, false, 30),
  ('blood_transfusion_or_products', 'A blood transfusion or blood products',
   'You received blood or a blood product, especially outside a screened blood bank.', false, null, false, 40),
  ('unsterile_procedure', 'A tattoo, piercing, or a procedure with reused equipment',
   'Including traditional cuts, circumcision, dental or surgical work where equipment may not have been sterile.', false, null, false, 50),
  ('household_or_partner_diagnosed', 'Someone close to you was diagnosed',
   'A partner or someone in your household has been diagnosed with hepatitis B or C.', false, null, false, 60),
  ('other', 'Something else',
   'Tell us what happened and a member of the care team will decide what is needed.', false, null, true, 90)
on conflict (code) do nothing;

alter table public.exposure_types enable row level security;
drop policy if exists exposure_types_select on public.exposure_types;
create policy exposure_types_select on public.exposure_types
  for select to authenticated using (true);
grant select on public.exposure_types to authenticated;
revoke all on public.exposure_types from anon;

-- ---------------------------------------------------------------------------
-- 3. What each exposure reopens, and when the test can actually answer.
--
-- earliest_test_days is the window period: before it, a negative result means
-- nothing and must not be sold. definitive_test_days is the later repeat that
-- closes the question.
-- ---------------------------------------------------------------------------
create table if not exists public.exposure_retest_rules (
  exposure_code        text not null references public.exposure_types (code) on delete cascade,
  screen_type_code     text not null references public.screen_types (code) on delete restrict,
  earliest_test_days   integer not null check (earliest_test_days >= 0),
  definitive_test_days integer check (definitive_test_days is null or definitive_test_days >= earliest_test_days),
  basis                text not null,
  primary key (exposure_code, screen_type_code)
);

comment on table public.exposure_retest_rules is
  'Which tests a reported exposure reopens and the earliest date each can give a meaningful answer. Standard practice, NOT a signed protocol — the Clinical Director should review these intervals; changing one is an UPDATE, not a migration.';

insert into public.exposure_retest_rules
  (exposure_code, screen_type_code, earliest_test_days, definitive_test_days, basis) values
  ('needlestick_or_sharps',          'hep_b',    42, 180, 'HBsAg detectable from about 6 weeks; 6 months excludes.'),
  ('needlestick_or_sharps',          'hep_c',    56, 168, 'Anti-HCV from about 8 weeks; 24 weeks excludes.'),
  ('needlestick_or_sharps',          'hiv',      45,  90, 'Fourth-generation antigen/antibody from about 6 weeks; 90 days excludes.'),
  ('sexual_exposure',                'hep_b',    42, 180, 'HBsAg detectable from about 6 weeks; 6 months excludes.'),
  ('sexual_exposure',                'hep_c',    56, 168, 'Anti-HCV from about 8 weeks; 24 weeks excludes.'),
  ('sexual_exposure',                'hiv',      45,  90, 'Fourth-generation antigen/antibody from about 6 weeks; 90 days excludes.'),
  ('sexual_exposure',                'syphilis', 42,  90, 'Treponemal tests reliable from about 6 weeks; 90 days excludes.'),
  ('shared_injecting_equipment',     'hep_b',    42, 180, 'HBsAg detectable from about 6 weeks; 6 months excludes.'),
  ('shared_injecting_equipment',     'hep_c',    56, 168, 'Anti-HCV from about 8 weeks; 24 weeks excludes.'),
  ('shared_injecting_equipment',     'hiv',      45,  90, 'Fourth-generation antigen/antibody from about 6 weeks; 90 days excludes.'),
  ('blood_transfusion_or_products',  'hep_b',    42, 180, 'HBsAg detectable from about 6 weeks; 6 months excludes.'),
  ('blood_transfusion_or_products',  'hep_c',    56, 168, 'Anti-HCV from about 8 weeks; 24 weeks excludes.'),
  ('blood_transfusion_or_products',  'hiv',      45,  90, 'Fourth-generation antigen/antibody from about 6 weeks; 90 days excludes.'),
  ('unsterile_procedure',            'hep_b',    42, 180, 'HBsAg detectable from about 6 weeks; 6 months excludes.'),
  ('unsterile_procedure',            'hep_c',    56, 168, 'Anti-HCV from about 8 weeks; 24 weeks excludes.'),
  ('household_or_partner_diagnosed', 'hep_b',    42, 180, 'Household and sexual transmission of hepatitis B is well described.'),
  ('household_or_partner_diagnosed', 'hep_c',    56, 168, 'Lower household risk than hepatitis B, but re-testing is reasonable once.')
on conflict (exposure_code, screen_type_code) do nothing;

alter table public.exposure_retest_rules enable row level security;
drop policy if exists exposure_retest_rules_select on public.exposure_retest_rules;
create policy exposure_retest_rules_select on public.exposure_retest_rules
  for select to authenticated using (true);
grant select on public.exposure_retest_rules to authenticated;
revoke all on public.exposure_retest_rules from anon;

-- ---------------------------------------------------------------------------
-- 4. What the patient told us.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.exposure_report_status as enum ('open', 'completed', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.patient_exposure_reports (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  exposure_code       text not null references public.exposure_types (code) on delete restrict,
  -- Nullable on purpose: "I don't know when" is a real and common answer, and
  -- forcing a date would make the patient invent one that then drives a
  -- clinical schedule.
  occurred_on         date,
  detail              text,
  status              public.exposure_report_status not null default 'open',
  reported_by         uuid references public.profiles (id) on delete set null,
  reported_at         timestamptz not null default now(),
  emergency_event_id  uuid references public.emergency_events (id) on delete set null,
  -- Null-gated clinician attribution, same rule as everywhere else: no screen
  -- may claim a doctor looked at this without these two being set.
  reviewed_by         uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  check (occurred_on is null or occurred_on <= current_date)
);

create index if not exists patient_exposure_reports_patient_idx
  on public.patient_exposure_reports (patient_id, status);
create index if not exists patient_exposure_reports_unreviewed_idx
  on public.patient_exposure_reports (organisation_id, reported_at)
  where status = 'open' and reviewed_at is null;

alter table public.patient_exposure_reports enable row level security;

drop policy if exists patient_exposure_reports_select on public.patient_exposure_reports;
create policy patient_exposure_reports_select on public.patient_exposure_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Written only through public.report_exposure, which is SECURITY DEFINER and
-- does its own authorisation. No direct insert policy: a report drives a
-- clinical schedule and possibly an emergency event, so it must not be
-- creatable by hand-rolled client SQL.
drop policy if exists patient_exposure_reports_staff_update on public.patient_exposure_reports;
create policy patient_exposure_reports_staff_update on public.patient_exposure_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.patient_exposure_reports to authenticated;
revoke all on public.patient_exposure_reports from anon;

-- ---------------------------------------------------------------------------
-- 5. An exposure emergency must never message the patient's family.
--
-- private.notify_unacknowledged_emergencies messages the emergency contact for
-- ANY active event the patient has not acknowledged within ten minutes. That
-- is right for a collapse and badly wrong here: a patient who reports a
-- possible exposure and then puts their phone down would have their sister or
-- their employer messaged about an emergency they never consented to share.
-- The template does not name the cause, but "there is an emergency with your
-- brother" is itself the disclosure, and the exposures most likely to be
-- reported are the ones a person is least likely to want passed on.
--
-- So the suppression is a column rather than a special case in the cron: any
-- future source of the same delicacy sets it too, and the reason lives with
-- the row.
-- ---------------------------------------------------------------------------
alter table public.emergency_events
  add column if not exists suppress_contact_notify boolean not null default false;

comment on column public.emergency_events.suppress_contact_notify is
  'True when this event must never trigger the emergency-contact auto-notify, because the event itself is confidential. Set for exposure reports: the patient still gets the urgent guidance and the care team still gets the alert, but nobody''s relative is messaged because they told us about a possible exposure.';

create or replace function private.notify_unacknowledged_emergencies()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   public.emergency_events%rowtype;
  v_patient public.profiles%rowtype;
begin
  for v_event in
    select * from public.emergency_events e
    where e.status = 'active'
      and e.acknowledged_at is null
      and e.contact_notified_at is null
      and e.suppress_contact_notify = false
      and e.created_at < now() - interval '10 minutes'
      and e.created_at > now() - interval '1 day'
  loop
    select * into v_patient from public.profiles where id = v_event.patient_id;
    if v_patient.emergency_contact_phone is not null and v_patient.emergency_contact_consent then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_event.organisation_id, v_event.patient_id, 'sms', 'pending',
         'emergency_contact_alert',
         jsonb_build_object(
           'to_phone', v_patient.emergency_contact_phone,
           'contact_name', coalesce(v_patient.emergency_contact_name, 'there'),
           'contact_relationship', v_patient.emergency_contact_relationship,
           'patient_name', coalesce(v_patient.full_name, 'someone who lists you as their emergency contact'))),
        (v_event.organisation_id, v_event.patient_id, 'whatsapp', 'pending',
         'emergency_contact_alert',
         jsonb_build_object(
           'to_phone', v_patient.emergency_contact_phone,
           'contact_name', coalesce(v_patient.emergency_contact_name, 'there'),
           'patient_name', coalesce(v_patient.full_name, 'someone who lists you as their emergency contact')));

      update public.emergency_events
        set contact_notified_at = now()
        where id = v_event.id;
    end if;
  end loop;
end;
$$;

revoke all on function private.notify_unacknowledged_emergencies() from public;

-- ---------------------------------------------------------------------------
-- 6. Reporting one.
--
-- Order of operations is the clinical safety property: triage the 72 hours
-- BEFORE scheduling anything. A person who has just been stuck with a used
-- needle needs to be told to get help today; the date their hepatitis C test
-- becomes meaningful is true, useful, and completely beside the point in that
-- moment.
-- ---------------------------------------------------------------------------
create or replace function public.report_exposure(
  p_patient_id uuid,
  p_exposure_code text,
  p_occurred_on date default null,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller   uuid := auth.uid();
  v_org      uuid;
  v_type     public.exposure_types%rowtype;
  v_report   uuid;
  v_event    uuid;
  v_urgent   boolean := false;
  v_rule     record;
  v_due      date;
  v_screen   uuid;
  v_reopened jsonb := '[]'::jsonb;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'no such patient' using errcode = '42501';
  end if;

  if not (
    p_patient_id = v_caller
    or private.is_org_staff(v_org)
    or exists (select 1 from public.profile_access pa
                where pa.profile_id = p_patient_id
                  and pa.grantee_user_id = v_caller
                  and pa.permission_level = 'manage')
  ) then
    raise exception 'you cannot report an exposure for this person' using errcode = '42501';
  end if;

  select * into v_type from public.exposure_types where code = p_exposure_code and is_active;
  if v_type.code is null then
    raise exception 'unknown exposure type' using errcode = '23514';
  end if;

  insert into public.patient_exposure_reports
    (organisation_id, patient_id, exposure_code, occurred_on, detail, reported_by)
  values (v_org, p_patient_id, p_exposure_code, p_occurred_on, p_detail, v_caller)
  returning id into v_report;

  -- Urgency first.
  --
  -- Date granularity rounds in the patient's favour deliberately: an exposure
  -- dated three days ago counts as inside a 72-hour window even though it may
  -- have been 80 hours. Being sent to a clinic that says "you are just outside
  -- the window" costs an afternoon; missing it costs far more. An unknown date
  -- does NOT raise an emergency — it could be years ago — but it does leave
  -- the report unreviewed and visible to the care team.
  if v_type.pep_relevant
     and p_occurred_on is not null
     and p_occurred_on >= current_date - (v_type.pep_window_hours / 24) then
    v_urgent := true;

    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, suppress_contact_notify)
    values (v_org, p_patient_id, 'exposure_report',
            'Reported ' || v_type.label || ' on ' || p_occurred_on
              || ' — inside the post-exposure prophylaxis window.',
            true)
    returning id into v_event;

    update public.patient_exposure_reports
       set emergency_event_id = v_event where id = v_report;
  end if;

  -- Then the re-tests, each at the earliest date it can answer.
  for v_rule in
    select r.*, st.name as screen_name
      from public.exposure_retest_rules r
      join public.screen_types st on st.code = r.screen_type_code
     where r.exposure_code = p_exposure_code
       and st.is_active
  loop
    v_due := coalesce(p_occurred_on, current_date) + v_rule.earliest_test_days;

    select id into v_screen from public.screen_types where code = v_rule.screen_type_code;

    -- Reuses the patient's ordinary screening calendar rather than inventing a
    -- second place for "things that are due". It simply appears alongside
    -- everything else, with a date that already accounts for the window
    -- period.
    if not exists (
      select 1 from public.screening_schedules ss
      where ss.patient_id = p_patient_id
        and ss.screen_type_id = v_screen
        and ss.status in ('pending', 'booked', 'overdue')
        and ss.due_date = v_due
    ) then
      insert into public.screening_schedules
        (organisation_id, patient_id, screen_type_id, due_date, status)
      values (v_org, p_patient_id, v_screen, v_due, 'pending');
    end if;

    v_reopened := v_reopened || jsonb_build_object(
      'code', v_rule.screen_type_code,
      'name', v_rule.screen_name,
      'due_from', v_due,
      'definitive_from', case when v_rule.definitive_test_days is null then null
                              else coalesce(p_occurred_on, current_date) + v_rule.definitive_test_days end);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report,
    'urgent', v_urgent,
    'emergency_event_id', v_event,
    'routes_to_human', v_type.routes_to_human or p_occurred_on is null,
    'reopened', v_reopened,
    'guidance', case
      when v_urgent then
        'Go to a hospital or clinic today and tell them about this exposure. There is medication that can stop an infection taking hold, but it only works if it is started within about three days — so this is worth doing now rather than waiting for a test.'
      when v_type.routes_to_human or p_occurred_on is null then
        'Thank you for telling us. Someone from your care team will look at this and come back to you about what is needed.'
      else
        'Thank you for telling us. A test straight away would not give a reliable answer yet, so we have put the right checks on your calendar for when they can actually tell you something.'
    end
  );
end;
$$;

revoke all on function public.report_exposure(uuid, text, date, text) from public;
grant execute on function public.report_exposure(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The exclusion engine learns two new things.
--
-- Supersedes the copy in the Synlab price migration. Every existing reason and
-- branch is preserved; two behaviours are added:
--
--   * a once-per-lifetime item that reopens_on_exposure is NO LONGER excluded
--     while an open exposure report covers it and no result has come in since.
--     Without this the tier would promise a re-check it then refused to sell.
--
--   * 'within_window_period' — the item is reopened and genuinely needed, but
--     today is too early for it to mean anything. A new reason rather than a
--     silent exclusion, because the app has something specific and reassuring
--     to say: not "unavailable", but "this is booked for the date it can
--     actually tell you something".
-- ---------------------------------------------------------------------------
create or replace function private.compute_screening_order_exclusions(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_test_codes text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
  v_once boolean;
  v_reopens boolean;
  v_reopened boolean;
  v_due date;
begin
  select hbv_status, hcv_status, hiv_status
    into v_hbv, v_hcv, v_hiv
    from public.profiles where id = p_patient_id;

  foreach v_code in array p_test_codes loop
    v_reason := null;

    select coalesce(st.once_per_lifetime, false), coalesce(st.reopens_on_exposure, false)
      into v_once, v_reopens
      from public.screen_types st where st.code = v_code;

    -- Is an open exposure report asking for this item again, with nothing
    -- resulted since it was made?
    -- count(*) > 0, not a bare `true`: this is an aggregate query, so with no
    -- matching report it still returns exactly one row, and selecting a
    -- literal there would set v_reopened true for every test on the platform.
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
    -- An unknown exposure date leaves min() null; fall back to the report date
    -- so a reopened item still gets a defensible earliest date.
    if v_reopened and v_due is null then
      select min(per.reported_at::date + r.earliest_test_days) into v_due
        from public.patient_exposure_reports per
        join public.exposure_retest_rules r
          on r.exposure_code = per.exposure_code and r.screen_type_code = v_code
       where per.patient_id = p_patient_id and per.status = 'open';
    end if;

    -- Lifetime-once items already on file — unless reopened.
    if coalesce(v_once, false) and exists (
      select 1 from public.screening_results sr
      where sr.patient_id = p_patient_id and sr.screen_type_code = v_code
    ) and not (v_reopens and v_reopened) then
      v_reason := 'lifetime_once_on_file';
    end if;

    -- Terminal serology states — never re-test. Outranks a reopen: an exposure
    -- changes nothing for someone already known to be infected.
    if v_reason is null and v_code = 'hep_b' and v_hbv = 'chronic_hbv' then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active') then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hiv' and v_hiv = 'hiv_positive' then
      v_reason := 'terminal_serology_state';
    end if;

    -- Reopened, but too early to mean anything.
    if v_reason is null and v_reopened and v_due is not null and current_date < v_due then
      v_reason := 'within_window_period:' || v_due::text;
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

    -- Owned by an active chronic pathway that already covers it recently. A
    -- reopened item is not "already covered": the pathway's routine cadence
    -- says nothing about an exposure that happened since.
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
$$;

revoke all on function private.compute_screening_order_exclusions(uuid, uuid, text[]) from public;

-- The delivered-set function whitelists settled exclusion reasons. Both new
-- states must be treated as "not being delivered on this order": a reopened
-- item still inside its window period is not billed, and the whitelist has to
-- learn the prefixed form of the reason.
create or replace function private.patient_delivered_test_codes(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_test_codes text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_patient_sex text;
  v_patient_age int;
  v_excluded    jsonb;
  v_code        text;
  v_st          public.screen_types%rowtype;
  v_out         text[] := '{}';
begin
  if p_patient_id is null or p_test_codes is null then
    return '{}';
  end if;

  select p.sex::text, extract(year from age(now(), p.date_of_birth))::int
    into v_patient_sex, v_patient_age
  from public.profiles p where p.id = p_patient_id;

  v_excluded := coalesce(
    private.compute_screening_order_exclusions(p_patient_id, p_organisation_id, p_test_codes),
    '[]'::jsonb
  );

  foreach v_code in array p_test_codes loop
    select * into v_st from public.screen_types st where st.code = v_code;

    if v_st.code is null then
      v_out := v_out || v_code;
      continue;
    end if;

    if v_st.fulfilment_dormant then
      continue;
    end if;
    if v_st.sex_applicability::text <> 'all'
       and v_st.sex_applicability::text is distinct from coalesce(v_patient_sex, '') then
      continue;
    end if;
    if v_st.age_from is not null and v_patient_age is not null and v_patient_age < v_st.age_from then
      continue;
    end if;
    if v_st.age_to is not null and v_patient_age is not null and v_patient_age > v_st.age_to then
      continue;
    end if;

    -- Settled exclusions only. 'pending_shared_decision' stays required and
    -- billed (see the long note in the computed-price migration);
    -- 'within_window_period' is the opposite — genuinely needed, genuinely not
    -- yet, and must not be charged for today.
    if exists (
      select 1 from jsonb_array_elements(v_excluded) e
      where e ->> 'item_code' = v_code
        and (
          e ->> 'reason' in ('lifetime_once_on_file', 'terminal_serology_state')
          or e ->> 'reason' like 'owned_by_pathway:%'
          or e ->> 'reason' like 'within_window_period:%'
        )
    ) then
      continue;
    end if;

    v_out := v_out || v_code;
  end loop;

  return v_out;
end;
$$;

revoke all on function private.patient_delivered_test_codes(uuid, uuid, text[]) from public;

-- ---------------------------------------------------------------------------
-- 8. A report closes itself when the question is answered.
--
-- Without this, an exposure report stays open forever and the item it reopened
-- never settles back to "once, ever" — so the patient would be offered the
-- same re-test indefinitely. Best-effort and exception-guarded, the same
-- discipline as every other secondary effect hanging off screening_results:
-- closing a report must never block recording a clinical result.
-- ---------------------------------------------------------------------------
create or replace function private.close_exposure_reports_on_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.screen_type_code is null then
    return new;
  end if;

  update public.patient_exposure_reports per
     set status = 'completed'
   where per.patient_id = new.patient_id
     and per.status = 'open'
     and exists (
       select 1 from public.exposure_retest_rules r
        where r.exposure_code = per.exposure_code
          and r.screen_type_code = new.screen_type_code
     )
     -- Only when EVERY item this exposure reopened now has a result dated
     -- after the report. A hepatitis B result alone does not answer a
     -- needlestick that also reopened hepatitis C and HIV.
     and not exists (
       select 1
         from public.exposure_retest_rules r2
         join public.screen_types st on st.code = r2.screen_type_code and st.is_active
        where r2.exposure_code = per.exposure_code
          and not exists (
            select 1 from public.screening_results sr
             where sr.patient_id = per.patient_id
               and sr.screen_type_code = r2.screen_type_code
               and (sr.created_at > per.reported_at or sr.id = new.id)
          )
     );

  return new;
exception
  when others then
    return new;
end;
$$;

revoke all on function private.close_exposure_reports_on_result() from public;

drop trigger if exists screening_results_close_exposure_reports on public.screening_results;
create trigger screening_results_close_exposure_reports
  after insert on public.screening_results
  for each row execute function private.close_exposure_reports_on_result();

-- ---------------------------------------------------------------------------
-- 9. Say it on the tier, so the promise is the true one.
-- ---------------------------------------------------------------------------
update public.panel_bundles
   set description = 'Blood group, genotype and hepatitis B and C. Your blood group and genotype never change, so those are done once and kept for life. Hepatitis B and C are a picture of one moment — so if something happens that could have exposed you, tell us and we will check again at the right time. You will never be charged for a repeat you do not need.'
 where code = 'know_your_basics';

-- ---------------------------------------------------------------------------
-- 10. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- The split that this whole migration rests on.
  if (select count(*) from public.screen_types
       where code in ('blood_group','sickle_cell_genotype') and reopens_on_exposure) > 0 then
    raise exception 'an immutable fact was marked reopenable — no exposure changes a blood group';
  end if;
  if (select count(*) from public.screen_types
       where code in ('hep_b','hep_c') and not reopens_on_exposure) > 0 then
    raise exception 'hepatitis serology must be reopenable by an exposure';
  end if;

  -- Every PEP-relevant exposure has a window, and every exposure reopens
  -- something (or routes to a human). An exposure type that does neither is a
  -- dead end the patient would report into silence.
  select string_agg(t.code, ', ') into v_bad
    from public.exposure_types t
   where t.is_active
     and not t.routes_to_human
     and not exists (select 1 from public.exposure_retest_rules r where r.exposure_code = t.code);
  if v_bad is not null then
    raise exception 'exposure types that reopen nothing and route nowhere: %', v_bad;
  end if;

  -- No test is ever scheduled before it can answer.
  if exists (select 1 from public.exposure_retest_rules where earliest_test_days < 14) then
    raise exception 'a window period under two weeks would sell a test that cannot yet answer';
  end if;

  -- The confidentiality guarantee.
  if pg_get_functiondef('private.notify_unacknowledged_emergencies()'::regprocedure)
       not like '%suppress_contact_notify%' then
    raise exception 'the emergency-contact auto-notify would still fire on an exposure report';
  end if;

  -- Both engines learned the new state.
  if pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%within_window_period%' then
    raise exception 'the exclusion engine does not know about the window period';
  end if;
  if pg_get_functiondef('private.patient_delivered_test_codes(uuid,uuid,text[])'::regprocedure)
       not like '%within_window_period%' then
    raise exception 'a test inside its window period would still be billed';
  end if;

  -- And the four original reasons all survived a fourth rewrite.
  if pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure) not like '%lifetime_once_on_file%'
   or pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure) not like '%terminal_serology_state%'
   or pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure) not like '%pending_shared_decision%'
   or pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure) not like '%owned_by_pathway%' then
    raise exception 'an exclusion reason was lost';
  end if;
end $$;
