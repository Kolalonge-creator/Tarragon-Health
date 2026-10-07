-- S68e: postnatal mental-health screening done in the database, baby-side postnatal checks, and the breastfeeding feed log
-- (Module 16 function 16.9; CMO pack A6).
--
-- EPDS (INV-01): the crisis route used to depend on the application setting crisis_flagged (two writers: a server action and a mobile route).
-- Now a BEFORE INSERT trigger recomputes the total and the item-10 answer from the stored item answers, so ANY non-zero item 10 is a crisis
-- whatever the client sent and whatever the total is (a total of 3 with item 10 = 1 is a crisis). The existing AFTER INSERT handler
-- (20260910014008) then opens the emergency event; this migration adds no second path for it. No language model is anywhere near it.
--   10 to 12 (possible) : a clinician review within the week.   13 or more (probable) : a clinician review within 48 hours.   Both PROPOSED, NOT SIGNED
--   (config epds.cutoffs, CMO pack A6, provisional; Nigerian validation studies report cut-offs from 7 to 12, OQ-354).
--   private.classify_mental_health_screen_concern() no longer maps 'epds' (the EPDS router below owns it), so a screen never raises two alerts.
--   The EPDS router is NOT behind maternal_enabled: it widens a route that is already live (the moderate and severe bands alerted before) and
--   a crisis answer must never be held back by a switch.
-- Wording: a screen result is "a prompt for your care team to look", never a diagnosis (checked in the screens and in the notice text).
-- Live counts read 2026-10-07: mental_health_screens with instrument 'epds' = 0 rows, so there is no history to convert.

-- s68-config-epds.cutoffs-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('epds.cutoffs', 1, true, 'proposed', '2026-10-07', $json${"item_count":10,"possible_min":10,"probable_min":13,"possible_review_within_days":7,"probable_review_within_hours":48,"item_10_any_nonzero_is_crisis":true}$json$::jsonb,
 'CMO pack A6 (selected, NOT signed, provisional): 10 to 12 possible, review within the week; 13 or more probable, clinician review within 48 hours; any non-zero item 10 goes to the crisis route whatever the total. Local audit after the first 200 screens. Basis and Nigerian cut-off range 7 to 12 still to be verified (OQ-354).');
-- s68-config-epds.cutoffs-end
-- s68-config-postnatal.checks-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('postnatal.checks', 1, true, 'proposed', '2026-10-07', $json${"windows":[{"code":"week_1","days":7},{"code":"week_6","days":42}],"epds_prompt_windows":["week_6"],"feed_log_grace_days":7}$json$::jsonb,
 'Mother and baby checks at week 1 and week 6 after delivery (founder scope S68; the existing postnatal_checkins windows). EPDS prompted at week 6 as a proposal for the CMO to place (OQ-355). Windows are generated from this row, never typed in code.');
-- s68-config-postnatal.checks-end

alter table public.mental_health_screens
  add column epds_config_version integer,
  add column review_band text check (review_band in ('none', 'possible', 'probable', 'crisis')),
  add column review_due_at timestamptz;
comment on column public.mental_health_screens.review_band is
  'S68 (INV-16): the EPDS routing decision and epds_config_version says which epds.cutoffs version made it. crisis means any non-zero item 10.';

create or replace function private.classify_mental_health_screen_concern(p_instrument text, p_severity_band text, p_hazardous boolean)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_instrument = 'phq9' and p_severity_band in ('moderately_severe', 'severe') then 'high'
    when p_instrument = 'phq9' and p_severity_band = 'moderate' then 'moderate'
    when p_instrument = 'gad7' and p_severity_band = 'severe' then 'high'
    when p_instrument = 'gad7' and p_severity_band = 'moderate' then 'moderate'
    when p_instrument = 'auditc' and coalesce(p_hazardous, false) then 'moderate'
    else 'none'   -- 'epds' is routed by private.route_epds_screen (S68e), never here
  end;
$$;

create or replace function private.enforce_epds_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := private.maternal_child_rules('epds.cutoffs');
  v_items jsonb := new.item_responses -> 'items';
  v_n integer; v_total integer := 0; v_i integer; v_v integer;
begin
  if new.instrument <> 'epds' then return new; end if;
  if c is null then raise exception 'EPDS configuration is missing' using errcode = '55000'; end if;
  v_n := (c ->> 'item_count')::integer;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) <> v_n then
    raise exception 'An EPDS screen needs exactly % answers', v_n using errcode = '22023';
  end if;
  for v_i in 0 .. v_n - 1 loop
    if jsonb_typeof(v_items -> v_i) <> 'number' or ((v_items -> v_i)::text) !~ '^[0-3]$' then
      raise exception 'Each EPDS answer must be a whole number from 0 to 3' using errcode = '22023';
    end if;
    v_v := (v_items ->> v_i)::integer;
    v_total := v_total + v_v;
  end loop;
  new.total_score := v_total;
  new.severity_band := case when v_total <= 9 then 'minimal' when v_total <= 12 then 'mild' when v_total <= 19 then 'moderate' else 'severe' end;
  new.epds_config_version := private.maternal_child_config_version('epds.cutoffs');
  if coalesce((c ->> 'item_10_any_nonzero_is_crisis')::boolean, true) and (v_items ->> (v_n - 1))::integer > 0 then
    new.crisis_flagged := true;        -- never lowered: a client that says crisis keeps it
    new.review_band := 'crisis';
    new.review_due_at := now();
  elsif v_total >= (c ->> 'probable_min')::integer then
    new.review_band := 'probable'; new.review_due_at := now() + ((c ->> 'probable_review_within_hours')::integer) * interval '1 hour';
  elsif v_total >= (c ->> 'possible_min')::integer then
    new.review_band := 'possible'; new.review_due_at := now() + ((c ->> 'possible_review_within_days')::integer) * interval '1 day';
  else
    new.review_band := case when new.crisis_flagged then 'crisis' else 'none' end;
  end if;
  return new;
end $$;
revoke all on function private.enforce_epds_rules() from public, anon, authenticated;
drop trigger if exists mental_health_screens_epds_rules on public.mental_health_screens;
create trigger mental_health_screens_epds_rules before insert on public.mental_health_screens
  for each row execute function private.enforce_epds_rules();

create or replace function private.route_epds_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.instrument <> 'epds' or new.crisis_flagged or new.review_band not in ('possible', 'probable') then return new; end if;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (new.organisation_id, new.patient_id, 'clinician_review', 'open',
    case new.review_band when 'probable' then 'Postnatal wellbeing check-in: review within 48 hours' else 'Postnatal wellbeing check-in: review within the week' end,
    format('Screen %s, rule version %s, band %s. A screening prompt for a clinician to look, not a diagnosis.', new.id, new.epds_config_version, new.review_band),
    new.review_due_at);
  return new;
end $$;
revoke all on function private.route_epds_screen() from public, anon, authenticated;
drop trigger if exists mental_health_screens_epds_route on public.mental_health_screens;
create trigger mental_health_screens_epds_route after insert on public.mental_health_screens
  for each row execute function private.route_epds_screen();

-- ---------------------------------------------------------------------------
-- Helper seam for staff reads of the new reproductive-adjacent tables.
-- S39b (tied staff reads, not on main-dev yet) will make this one function tie-aware; every S68 policy calls it, so that is a one-line change.
-- ---------------------------------------------------------------------------
create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_org_staff(p_org)
$$;
-- A caregiver reads reproductive-category data only with an explicit category grant AND not for an adolescent (the S49 confidentiality gate).
create or replace function private.maternal_caregiver_may_read(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_read_clinical(p_patient, 'reproductive_health'::public.care_access_category)
     and private.guardian_may_view_confidential_domain(p_patient)
$$;

-- ---------------------------------------------------------------------------
-- Baby-side postnatal checks (week 1 and week 6), generated from postnatal.checks for every delivery
-- ---------------------------------------------------------------------------
create table public.postnatal_baby_checks (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  postnatal_profile_id uuid not null references public.postnatal_profiles (id) on delete cascade,
  child_profile_id     uuid references public.profiles (id) on delete set null,
  check_window         text not null check (check_window in ('week_1', 'week_6')),
  scheduled_date       date,
  completed_at         timestamptz,
  baby_weight_kg       numeric(5, 2) check (baby_weight_kg is null or baby_weight_kg between 0.5 and 25),
  feeding_method       text check (feeding_method in ('breast_only', 'breast_and_other', 'formula_only', 'other')),
  concerns_noted       boolean not null default false,
  concern_note         text check (concern_note is null or length(concern_note) <= 1000),
  birth_vaccines_discussed boolean not null default false,
  appointment_id       uuid references public.appointments (id) on delete set null,
  source               text not null default 'patient_entered' check (source in ('patient_entered', 'clinician_recorded')),
  recorded_by          uuid references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (postnatal_profile_id, check_window)
);
create index postnatal_baby_checks_patient_idx on public.postnatal_baby_checks (patient_id, scheduled_date);
create index postnatal_baby_checks_org_idx on public.postnatal_baby_checks (organisation_id);
create trigger postnatal_baby_checks_set_updated_at before update on public.postnatal_baby_checks for each row execute function private.set_updated_at();
alter table public.postnatal_baby_checks enable row level security;
revoke all on public.postnatal_baby_checks from public, anon;
grant select, insert, update on public.postnatal_baby_checks to authenticated;
create policy postnatal_baby_checks_select on public.postnatal_baby_checks for select to authenticated
  using (patient_id = (select auth.uid()) or private.maternal_staff_may_read(patient_id, organisation_id) or private.maternal_caregiver_may_read(patient_id));
create policy postnatal_baby_checks_insert on public.postnatal_baby_checks for insert to authenticated
  with check ((patient_id = (select auth.uid()) and organisation_id = private.current_org_id()) or private.is_org_staff(organisation_id));
create policy postnatal_baby_checks_update on public.postnatal_baby_checks for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check ((patient_id = (select auth.uid()) and organisation_id = private.current_org_id()) or private.is_org_staff(organisation_id));

create or replace function private.stamp_baby_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    if tg_op = 'INSERT' then new.recorded_by := v_uid; else new.recorded_by := coalesce(old.recorded_by, v_uid); end if;
    new.source := case when v_uid = new.patient_id then 'patient_entered' else 'clinician_recorded' end;
    if tg_op = 'UPDATE' and old.source = 'clinician_recorded' then new.source := 'clinician_recorded'; end if;
  end if;
  if new.child_profile_id is not null and not exists (
       select 1 from public.profile_access pa where pa.profile_id = new.child_profile_id and pa.grantee_user_id = new.patient_id and pa.permission_level = 'manage')
     and v_uid is not null and not private.is_org_staff(new.organisation_id) then
    raise exception 'The child profile is not one you manage' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.stamp_baby_check() from public, anon, authenticated;
create trigger postnatal_baby_checks_stamp before insert or update on public.postnatal_baby_checks for each row execute function private.stamp_baby_check();

-- Every delivery gets its mother and baby checks from the configuration. Idempotent. Not behind the guard: rows are only schedule rows.
create or replace function private.schedule_postnatal_checks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c jsonb := private.maternal_child_rules('postnatal.checks'); w jsonb;
begin
  if c is null then return new; end if;
  for w in select * from jsonb_array_elements(c -> 'windows') loop
    insert into public.postnatal_checkins (organisation_id, patient_id, postnatal_profile_id, checkin_window, scheduled_date)
    select new.organisation_id, new.patient_id, new.id, w ->> 'code', new.delivery_date + (w ->> 'days')::integer
     where not exists (select 1 from public.postnatal_checkins x where x.postnatal_profile_id = new.id and x.checkin_window = w ->> 'code');
    insert into public.postnatal_baby_checks (organisation_id, patient_id, postnatal_profile_id, check_window, scheduled_date)
    values (new.organisation_id, new.patient_id, new.id, w ->> 'code', new.delivery_date + (w ->> 'days')::integer)
    on conflict (postnatal_profile_id, check_window) do nothing;
  end loop;
  return new;
end $$;
revoke all on function private.schedule_postnatal_checks() from public, anon, authenticated;
create trigger postnatal_profiles_schedule_checks after insert on public.postnatal_profiles
  for each row execute function private.schedule_postnatal_checks();

-- ---------------------------------------------------------------------------
-- Breastfeeding feed log (patient-entered tracker data, deletable after the grace window, S68g)
-- ---------------------------------------------------------------------------
create table public.breastfeeding_feed_log (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  postnatal_profile_id uuid references public.postnatal_profiles (id) on delete set null,
  child_profile_id     uuid references public.profiles (id) on delete set null,
  fed_at               timestamptz not null default now(),
  feed_type            text not null check (feed_type in ('breast_left', 'breast_right', 'both_breasts', 'expressed_milk', 'formula', 'other')),
  duration_minutes     integer check (duration_minutes is null or duration_minutes between 0 and 180),
  amount_ml            integer check (amount_ml is null or amount_ml between 0 and 500),
  note                 text check (note is null or length(note) <= 500),
  source               text not null default 'patient_entered' check (source in ('patient_entered', 'clinician_recorded')),
  recorded_by          uuid references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  constraint feed_log_not_in_future check (fed_at <= now() + interval '5 minutes')
);
create index breastfeeding_feed_log_patient_idx on public.breastfeeding_feed_log (patient_id, fed_at desc);
create index breastfeeding_feed_log_org_idx on public.breastfeeding_feed_log (organisation_id);
alter table public.breastfeeding_feed_log enable row level security;
revoke all on public.breastfeeding_feed_log from public, anon;
grant select, insert, update on public.breastfeeding_feed_log to authenticated;   -- no delete: erasure is the audited S68g function only
create policy breastfeeding_feed_log_select on public.breastfeeding_feed_log for select to authenticated
  using (patient_id = (select auth.uid()) or private.maternal_staff_may_read(patient_id, organisation_id) or private.maternal_caregiver_may_read(patient_id));
create policy breastfeeding_feed_log_insert on public.breastfeeding_feed_log for insert to authenticated
  with check ((patient_id = (select auth.uid()) and organisation_id = private.current_org_id()) or private.is_org_staff(organisation_id));
create policy breastfeeding_feed_log_update on public.breastfeeding_feed_log for update to authenticated
  using (patient_id = (select auth.uid()) and source = 'patient_entered')
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id() and source = 'patient_entered');

create or replace function private.stamp_feed_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' and not private.go_live_open_patient('maternal_enabled', new.patient_id) then
    raise exception 'The feed log is not open yet' using errcode = '55000', hint = 'maternal_enabled';
  end if;
  if tg_op = 'INSERT' and v_uid is not null then
    new.recorded_by := v_uid;
    new.source := case when v_uid = new.patient_id then 'patient_entered' else 'clinician_recorded' end;
  elsif tg_op = 'UPDATE' then
    new.recorded_by := old.recorded_by; new.source := old.source;
  end if;
  if new.child_profile_id is not null and v_uid is not null and not private.is_org_staff(new.organisation_id) and not exists (
       select 1 from public.profile_access pa where pa.profile_id = new.child_profile_id and pa.grantee_user_id = new.patient_id and pa.permission_level = 'manage') then
    raise exception 'The child profile is not one you manage' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.stamp_feed_log() from public, anon, authenticated;
create trigger breastfeeding_feed_log_stamp before insert or update on public.breastfeeding_feed_log for each row execute function private.stamp_feed_log();

-- ---------------------------------------------------------------------------
-- Support content: placeholders only. Nothing here is a clinical claim; the CMO writes and approves the text.
-- Patients are only ever shown rows with review_status = 'approved'; a placeholder is invisible to them.
-- ---------------------------------------------------------------------------
create table public.maternal_child_content (
  key           text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  topic         text not null,
  title         text not null,
  body          text not null,
  review_status text not null default 'needs_cmo_review' check (review_status in ('needs_cmo_review', 'approved')),
  reviewed_by   uuid references public.profiles (id) on delete restrict,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint maternal_child_content_approved_has_reviewer check (review_status <> 'approved' or (reviewed_by is not null and reviewed_at is not null))
);
comment on table public.maternal_child_content is 'S68: breastfeeding support, postnatal and loss-path copy. Every seeded row is a placeholder awaiting CMO or founder text and is NOT shown to patients. Approval records the reviewer (null-gated, like ReviewedByDoctor).';
alter table public.maternal_child_content enable row level security;
revoke all on public.maternal_child_content from public, anon, authenticated;
grant select on public.maternal_child_content to authenticated;
create policy maternal_child_content_read on public.maternal_child_content for select to authenticated
  using (review_status = 'approved' or private.is_admin() or private.credential_is_cmo());
insert into public.maternal_child_content (key, topic, title, body) values
  ('breastfeeding.getting_started', 'breastfeeding', 'Getting started with feeding', 'PLACEHOLDER: text to be written and approved by the CMO. No clinical guidance is stored here.'),
  ('breastfeeding.when_to_ask_your_care_team', 'breastfeeding', 'When to ask your care team', 'PLACEHOLDER: text to be written and approved by the CMO. No clinical guidance is stored here.'),
  ('breastfeeding.expressing_and_storing', 'breastfeeding', 'Expressing and storing milk', 'PLACEHOLDER: text to be written and approved by the CMO. No clinical guidance is stored here.'),
  ('postnatal.baby_checks_explained', 'postnatal', 'Your baby''s week 1 and week 6 checks', 'PLACEHOLDER: text to be written and approved by the CMO. No clinical guidance is stored here.'),
  ('loss.gentle_path', 'pregnancy_loss', 'Support after a pregnancy loss', 'PLACEHOLDER: wording for the founder and CMO to write. Until it is approved the app shows only a short neutral line and a way to reach your care team, with no baby content.');

do $$ begin
  if has_table_privilege('anon', 'public.postnatal_baby_checks', 'SELECT') or has_table_privilege('anon', 'public.breastfeeding_feed_log', 'SELECT') or has_table_privilege('anon', 'public.maternal_child_content', 'SELECT') then
    raise exception 'S68e self-check: anon must not read the new tables'; end if;
  if (select count(*) from public.maternal_child_content where review_status = 'approved') <> 0 then raise exception 'S68e self-check: nothing may be seeded as approved'; end if;
  if private.classify_mental_health_screen_concern('epds', 'severe', null) <> 'none' or private.classify_mental_health_screen_concern('phq9', 'severe', null) <> 'high' then
    raise exception 'S68e self-check: the concern classifier was changed for the wrong instrument'; end if;
end $$;
