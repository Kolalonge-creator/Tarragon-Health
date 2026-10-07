-- S63 (Module 14): digital therapy programmes, the engine and Wave A (panic breathing, pelvic floor, IBS gut calm audio).
-- NOT APPLIED TO PRODUCTION. Every guard is seeded OFF, every programme version and exclusion list is a DRAFT (nobody signs anything here),
-- and the Wave B and C programmes are scaffolds with no content.
--
-- VERSION NOTE. The wall clock on the build machine (UTC) was earlier than the newest versions already in the repository and on the live project
-- (which carry other sessions' stamps up to 20261007200000), so a plain `date -u` stamp would have sorted BEFORE the S56 migrations this file
-- depends on. The version is 2026100720 plus the minutes and seconds of the wall clock when it was written: not a round number, and later than every
-- version the live project listed (checked with list_migrations 2026-10-07). BASE: origin/s55-60/s56-mental-wellbeing. Merging needs S56 first.
--
-- NAMING. The spec's `programmes` and `programme_enrolments` collide with 13 existing programme tables, and the existing public.therapy_sessions
-- is the S56 therapist BOOKING table (private psychiatry or therapy appointments). So: therapy_programmes, therapy_programme_versions,
-- therapy_programme_sessions (the content, one row per session and version), therapy_enrolments, therapy_session_progress, therapy_share_consents,
-- therapy_exclusion_list_versions, therapy_exclusion_rules and therapy_programme_config. No existing table is touched.
--
-- WHAT THIS DOES (spec 14.1 to 14.9, Section B.14; plan docs/design/S61-S65-build-plan.md 4.2; CMO decisions Q13 to Q16):
--  * Content is versioned and immutable once a version is approved (INV-16). An enrolment records the programme version it started on and always
--    reads that version, so a new version never alters an enrolled patient's content.
--  * The entry screen (14.9) is table-driven (therapy_exclusion_rules) and FAILS CLOSED: an unanswered or malformed item is a positive, a programme
--    with no list admits nobody. It runs at entry (enrol_in_therapy_programme) and again at the start of EVERY session (start_therapy_session).
--    A positive stops the programme and raises a clinician task through create_clinical_task (never only a notification); a crisis route
--    (any PHQ-9 item 9 above zero, or self-harm thoughts on the panic list) also raises a class 1 task, an urgent event and pages the clinician on call,
--    and the patient card says go to the nearest hospital now with no phone number.
--  * Outcome scores are recorded at set sessions (therapy_programme_config.checkpoints). Worsening beyond the PROPOSED thresholds pauses the programme,
--    raises a clinician review task (never only a notification) and emits programme.flag. The check runs inline at completion AND again from the event
--    bus (programme.assess_progress, the programme-progress handler), both idempotent, so a missed event cannot hide a worsening.
--  * Progress is shared with a clinician only on explicit, revocable consent, and only through an audited read (INV-10) that needs a clinician with
--    a tie (INV-12). No policy uses private.is_org_staff(); sponsors, employers, admin, ops, finance and analysts have no read at all (I9).
--  * Events (S10 outbox): programme.session_completed, programme.flag. Payloads carry ids only.
--  * Go-live: seven guards (therapy_*_enabled), seeded OFF, each needing an approved content version, a confirmed exclusion list and attestations.
--    A real patient is refused at the database (trigger on enrolments, start and complete functions); a test account passes so the flow can be proved.
--
-- WHAT IS NOT HERE. No audio (clips are named in the manifest module, unrecorded). No notification template (a reminder, if ever added, must be neutral:
-- INV-07). No sponsor aggregate (they have no access). No model anywhere (INV-01). No helpline anywhere (founder decision 2026-10-07).
--
-- ROWS AFFECTED. 0 existing rows changed. New tables only; the seeds below add 12 programmes, 12 draft versions, 24 draft sessions, 12 draft exclusion
-- lists, one config row, 2 event types, 1 subscriber and 7 guards.

-- ---------------------------------------------------------------------------
-- 1. Event types and the progress subscriber
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values
  ('programme.session_completed', 'A patient finished a therapy programme session (ids only)', 'S63', false),
  ('programme.flag', 'A therapy programme was stopped or paused for a clinician to look at (ids only; the reason is read through the audited path)', 'S63', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('programme.session_completed', 1, array['enrolment_id', 'ordinal']), ('programme.flag', 1, array['enrolment_id'])
on conflict (event_type, version) do nothing;
insert into public.event_subscribers (subscriber_key, event_type, handler_key, note)
values ('programme.assess_progress', 'programme.session_completed', 'programme.assess_progress',
        'S63: re-runs the idempotent worsening check for the enrolment (second line behind the inline check at completion)')
on conflict (subscriber_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.therapy_programmes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code in ('panic_breathing', 'pelvic_floor', 'ibs_hypnotherapy', 'cbt_i', 'pain_back', 'pain_neck', 'pain_knee', 'pain_hip', 'low_mood', 'stress', 'anxiety', 'pulmonary_rehab')),
  wave            text not null check (wave in ('A', 'B', 'C')),
  title           text not null,
  summary         text not null,
  -- scaffold: no content yet. draft: content is a draft awaiting the CMO. live: reserved for after sign-off. held: waits for another pathway.
  status          text not null check (status in ('scaffold', 'draft', 'live', 'held')),
  guard_key       text not null references public.go_live_guards (key),
  current_version integer not null default 1 check (current_version >= 1),
  created_at      timestamptz not null default now()
);

create table public.therapy_programme_versions (
  programme_id uuid not null references public.therapy_programmes (id) on delete restrict,
  version      integer not null check (version >= 1),
  review_state text not null default 'draft' check (review_state in ('draft', 'in_review', 'approved', 'retired')),
  approved_by  uuid references public.profiles (id) on delete restrict,
  approved_at  timestamptz,
  note         text,
  created_at   timestamptz not null default now(),
  primary key (programme_id, version),
  constraint therapy_versions_approval_shape check (
    (review_state <> 'approved' or (approved_by is not null and approved_at is not null))
    and (review_state in ('approved', 'retired') or (approved_by is null and approved_at is null)))
);

create table public.therapy_programme_sessions (
  id               uuid primary key default gen_random_uuid(),
  programme_id     uuid not null,
  version          integer not null,
  ordinal          integer not null check (ordinal >= 1),
  title            text not null,
  kind             text not null check (kind in ('education', 'paced_breathing', 'guided_audio', 'exercise')),
  text_body        text not null,
  -- the manifest clip id the recording will use (group THP); null or unrecorded means the player shows the text
  audio_clip_id    text check (audio_clip_id ~ '^THP-[A-Z]{3}[0-9]{2}$'),
  duration_seconds integer not null check (duration_seconds > 0),
  audio_bytes      bigint check (audio_bytes is null or audio_bytes > 0),
  created_at       timestamptz not null default now(),
  unique (programme_id, version, ordinal),
  foreign key (programme_id, version) references public.therapy_programme_versions (programme_id, version) on delete restrict
);

create table public.therapy_exclusion_list_versions (
  programme_code text not null references public.therapy_programmes (code) on delete restrict,
  version        integer not null check (version >= 1),
  status         text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_by   uuid references public.profiles (id) on delete restrict,
  confirmed_at   timestamptz,
  created_by     uuid references public.profiles (id) on delete restrict,
  note           text,
  created_at     timestamptz not null default now(),
  primary key (programme_code, version),
  constraint therapy_lists_confirm_shape check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);

create table public.therapy_exclusion_rules (
  id             uuid primary key default gen_random_uuid(),
  programme_code text not null,
  list_version   integer not null,
  ordinal        integer not null check (ordinal >= 1),
  item_code      text not null check (item_code ~ '^[a-z][a-z0-9_]*$'),
  question       text not null,
  kind           text not null check (kind in ('yes_no', 'score_at_least', 'score_below')),
  threshold      numeric,
  route          text not null check (route in ('crisis', 'same_day_clinician', 'medical_review_first', 'education_only')),
  unverified     boolean not null default false,
  unique (programme_code, list_version, item_code),
  unique (programme_code, list_version, ordinal),
  constraint therapy_rules_threshold_shape check ((kind = 'yes_no') = (threshold is null)),
  foreign key (programme_code, list_version) references public.therapy_exclusion_list_versions (programme_code, version) on delete restrict
);

create table public.therapy_programme_config (
  version    integer primary key check (version >= 1),
  config     jsonb not null,
  notes      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index therapy_programme_config_one_active on public.therapy_programme_config (is_active) where is_active;

create table public.therapy_enrolments (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id),
  patient_id             uuid not null references public.profiles (id) on delete restrict,
  programme_id           uuid not null,
  -- INV-16: the version this patient started on. They always read this version.
  programme_version      integer not null,
  exclusion_list_version integer not null,
  state                  text not null check (state in ('active', 'paused', 'completed', 'stopped_exclusion', 'stopped_by_patient', 'blocked')),
  stop_reason            text check (stop_reason in ('exclusion', 'crisis', 'worsening_review', 'patient_choice', 'completed', 'no_exclusion_list')),
  baseline_score         numeric,
  current_score          numeric,
  -- the codes and routes of the items that stopped the programme (never free text)
  exclusion_result       jsonb not null default '{}'::jsonb,
  source                 text not null default 'self' check (source in ('self', 'clinician_referral')),
  recorded_by            uuid references public.profiles (id) on delete restrict,
  is_test                boolean not null default false,
  completed_count        integer not null default 0 check (completed_count >= 0),
  started_at             timestamptz not null default now(),
  stopped_at             timestamptz,
  -- set when a clinician resumes a programme paused for review: only scores recorded after this are assessed again
  resumed_at             timestamptz,
  updated_at             timestamptz not null default now(),
  foreign key (programme_id, programme_version) references public.therapy_programme_versions (programme_id, version) on delete restrict,
  constraint therapy_enrolments_stop_shape check ((state in ('active', 'paused')) = (stopped_at is null) or state = 'paused')
);
create unique index therapy_enrolments_one_open on public.therapy_enrolments (patient_id, programme_id) where state in ('active', 'paused');
create index therapy_enrolments_patient_idx on public.therapy_enrolments (patient_id, started_at desc);

create table public.therapy_session_progress (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  enrolment_id    uuid not null references public.therapy_enrolments (id) on delete restrict,
  ordinal         integer not null check (ordinal >= 1),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  scores          jsonb,
  is_test         boolean not null default false,
  unique (enrolment_id, ordinal)
);

create table public.therapy_share_consents (
  enrolment_id    uuid primary key references public.therapy_enrolments (id) on delete restrict,
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  shared          boolean not null,
  -- the wording version the patient saw. DRAFT wording until the CMO and counsel sign it (see docs/OPEN-QUESTIONS.md).
  text_version    text not null default 'draft-1',
  granted_at      timestamptz,
  revoked_at      timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.therapy_enrolments is 'S63: one self-guided programme a patient joined (or was blocked from). Per-patient access, audited staff reads only (INV-10, INV-12); never readable through the organisation-wide staff function.';
comment on table public.therapy_programme_sessions is 'S63: versioned programme content. Immutable once its version is approved (INV-16). A patient reads only through start_therapy_session, after the screen passes.';
comment on table public.therapy_exclusion_rules is 'S63: CMO-editable, versioned entry screen and red flags (14.9). Items marked unverified are local additions awaiting the CMO.';

-- ---------------------------------------------------------------------------
-- 3. Access: RLS on every table, explicit grants (a new table is not reachable by default; default privileges also grant authenticated everything,
--    so the grants are narrowed on purpose)
-- ---------------------------------------------------------------------------
alter table public.therapy_programmes enable row level security;
alter table public.therapy_programme_versions enable row level security;
alter table public.therapy_programme_sessions enable row level security;
alter table public.therapy_exclusion_list_versions enable row level security;
alter table public.therapy_exclusion_rules enable row level security;
alter table public.therapy_programme_config enable row level security;
alter table public.therapy_enrolments enable row level security;
alter table public.therapy_session_progress enable row level security;
alter table public.therapy_share_consents enable row level security;

revoke all on public.therapy_programmes, public.therapy_programme_versions, public.therapy_programme_sessions, public.therapy_exclusion_list_versions,
  public.therapy_exclusion_rules, public.therapy_programme_config, public.therapy_enrolments, public.therapy_session_progress, public.therapy_share_consents
  from public, anon, authenticated;
grant select on public.therapy_programmes, public.therapy_programme_versions, public.therapy_programme_sessions, public.therapy_exclusion_list_versions,
  public.therapy_exclusion_rules, public.therapy_programme_config, public.therapy_enrolments, public.therapy_session_progress, public.therapy_share_consents
  to authenticated;
grant all on public.therapy_programmes, public.therapy_programme_versions, public.therapy_programme_sessions, public.therapy_exclusion_list_versions,
  public.therapy_exclusion_rules, public.therapy_programme_config, public.therapy_enrolments, public.therapy_session_progress, public.therapy_share_consents
  to service_role;

-- the catalogue (titles only) is readable by any signed-in person
create policy therapy_programmes_read on public.therapy_programmes for select to authenticated using (true);
-- content, lists and config are for the people who govern them (admin console and the CMO); a patient reaches content only through the functions
create policy therapy_versions_governors_read on public.therapy_programme_versions for select to authenticated using (private.go_live_actor_role() is not null);
create policy therapy_sessions_governors_read on public.therapy_programme_sessions for select to authenticated using (private.go_live_actor_role() is not null);
create policy therapy_lists_governors_read on public.therapy_exclusion_list_versions for select to authenticated using (private.go_live_actor_role() is not null);
create policy therapy_rules_governors_read on public.therapy_exclusion_rules for select to authenticated using (private.go_live_actor_role() is not null);
create policy therapy_config_governors_read on public.therapy_programme_config for select to authenticated using (private.go_live_actor_role() is not null);
-- a patient's own rows, and nobody else's: no staff policy, no supporter policy, no dependent bypass (clinicians read only through read_therapy_progress_audited)
create policy therapy_enrolments_own_read on public.therapy_enrolments for select to authenticated using (patient_id = (select auth.uid()));
create policy therapy_progress_own_read on public.therapy_session_progress for select to authenticated using (patient_id = (select auth.uid()));
create policy therapy_consents_own_read on public.therapy_share_consents for select to authenticated using (patient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Immutability and state rules
-- ---------------------------------------------------------------------------
create or replace function private.therapy_version_is_approved(p_programme uuid, p_version integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.therapy_programme_versions where programme_id = p_programme and version = p_version and review_state = 'approved')
$$;
revoke all on function private.therapy_version_is_approved(uuid, integer) from public, anon, authenticated;

create or replace function private.therapy_content_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and private.therapy_version_is_approved(old.programme_id, old.version) then
    raise exception 'the content of an approved programme version cannot change: publish a new version' using errcode = '55000';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and private.therapy_version_is_approved(new.programme_id, new.version) then
    raise exception 'the content of an approved programme version cannot change: publish a new version' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.therapy_content_immutable() from public, anon, authenticated;
create trigger therapy_programme_sessions_immutable before insert or update or delete on public.therapy_programme_sessions
  for each row execute function private.therapy_content_immutable();

create or replace function private.therapy_version_state_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.review_state = 'approved' and new.review_state not in ('approved', 'retired') then
    raise exception 'an approved programme version cannot go back to a draft' using errcode = '55000';
  end if;
  if old.review_state = 'retired' and new.review_state <> 'retired' then
    raise exception 'a retired programme version stays retired' using errcode = '55000';
  end if;
  if old.review_state = 'approved' and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'the approval of a programme version cannot be changed' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.therapy_version_state_rule() from public, anon, authenticated;
create trigger therapy_programme_versions_state_rule before update on public.therapy_programme_versions
  for each row execute function private.therapy_version_state_rule();

create or replace function private.therapy_rules_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_ver integer;
begin
  v_code := case when tg_op = 'INSERT' then new.programme_code else old.programme_code end;
  v_ver := case when tg_op = 'INSERT' then new.list_version else old.list_version end;
  if exists (select 1 from public.therapy_exclusion_list_versions where programme_code = v_code and version = v_ver and status = 'confirmed') then
    raise exception 'a confirmed exclusion list cannot change: save a new version' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.therapy_rules_immutable() from public, anon, authenticated;
create trigger therapy_exclusion_rules_immutable before insert or update or delete on public.therapy_exclusion_rules
  for each row execute function private.therapy_rules_immutable();

create or replace function private.therapy_enrolment_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if tg_op = 'INSERT' then
    -- belt and braces behind the functions: nobody becomes ACTIVE in a programme whose guard is closed (a test account passes)
    if new.state = 'active' then
      select guard_key into v_key from public.therapy_programmes where id = new.programme_id;
      if not private.go_live_open_patient(v_key, new.patient_id) then
        raise exception 'This programme is not open yet' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if new.patient_id is distinct from old.patient_id or new.programme_id is distinct from old.programme_id
     or new.programme_version is distinct from old.programme_version or new.exclusion_list_version is distinct from old.exclusion_list_version
     or new.organisation_id is distinct from old.organisation_id then
    raise exception 'an enrolment keeps its patient, programme and versions (INV-16)' using errcode = '55000';
  end if;
  if old.state <> new.state and not (
       (old.state = 'active' and new.state in ('paused', 'completed', 'stopped_exclusion', 'stopped_by_patient'))
    or (old.state = 'paused' and new.state in ('active', 'stopped_exclusion', 'stopped_by_patient'))) then
    raise exception 'an enrolment cannot go from % to %', old.state, new.state using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.therapy_enrolment_rules() from public, anon, authenticated;
create trigger therapy_enrolments_rules before insert or update on public.therapy_enrolments
  for each row execute function private.therapy_enrolment_rules();

-- ---------------------------------------------------------------------------
-- 5. Private helpers
-- ---------------------------------------------------------------------------
create or replace function private.therapy_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select config from public.therapy_programme_config where is_active
$$;
revoke all on function private.therapy_config() from public, anon, authenticated;

-- The entry screen. Pure: same rule as packages/shared evaluateEntryScreen. FAILS CLOSED: an item that is missing, or has the wrong kind of value,
-- is a positive; a programme with no rules admits nobody. Uses the highest list version unless one is named.
create or replace function private.therapy_evaluate_screen(p_code text, p_answers jsonb, p_list_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c_order constant text[] := array['crisis', 'same_day_clinician', 'medical_review_first', 'education_only'];
  v_ver integer;
  r public.therapy_exclusion_rules%rowtype;
  v_a jsonb;
  v_pos boolean;
  v_unans boolean;
  v_n numeric;
  v_stops jsonb := '[]'::jsonb;
  v_best integer := null;
  v_pos_in_order integer;
begin
  v_ver := coalesce(p_list_version, (select coalesce(max(version) filter (where status = 'confirmed'), max(version)) from public.therapy_exclusion_list_versions where programme_code = p_code));
  if v_ver is null or not exists (select 1 from public.therapy_exclusion_rules where programme_code = p_code and list_version = v_ver) then
    return jsonb_build_object('passed', false, 'route', null, 'stops', '[]'::jsonb, 'no_rules', true, 'list_version', v_ver);
  end if;
  for r in select * from public.therapy_exclusion_rules where programme_code = p_code and list_version = v_ver order by ordinal loop
    v_a := case when jsonb_typeof(p_answers) = 'object' then p_answers -> r.item_code else null end;
    v_unans := false;
    v_pos := false;
    if r.kind = 'yes_no' then
      if v_a is null or jsonb_typeof(v_a) <> 'boolean' then v_pos := true; v_unans := true;
      else v_pos := (v_a #>> '{}')::boolean; end if;
    else
      if v_a is null or jsonb_typeof(v_a) <> 'number' then v_pos := true; v_unans := true;
      else
        v_n := (v_a #>> '{}')::numeric;
        v_pos := case r.kind when 'score_at_least' then v_n >= r.threshold else v_n < r.threshold end;
      end if;
    end if;
    if v_pos then
      v_stops := v_stops || jsonb_build_array(jsonb_build_object('code', r.item_code, 'route', r.route, 'unverified', r.unverified, 'unanswered', v_unans));
      v_pos_in_order := array_position(c_order, r.route);
      if v_best is null or v_pos_in_order < v_best then v_best := v_pos_in_order; end if;
    end if;
  end loop;
  return jsonb_build_object('passed', jsonb_array_length(v_stops) = 0, 'route', case when v_best is null then null else c_order[v_best] end,
                            'stops', v_stops, 'no_rules', false, 'list_version', v_ver);
end $$;
revoke all on function private.therapy_evaluate_screen(text, jsonb, integer) from public, anon, authenticated;

create or replace function private.therapy_audit_error(p_org uuid, p_entity uuid, p_step text, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
  values (p_org, 'therapy_programme.error', 'therapy_enrolment', p_entity, jsonb_build_object('step', p_step, 'error', p_error));
  perform private.page_incident(p_org, 'therapy_programme_failed:' || coalesce(p_entity::text, 'none') || ':' || p_step,
    'A programme follow-up could not be completed',
    'A programme safety step failed; see audit_log action therapy_programme.error. The patient was still stopped or paused.');
exception when others then
  null; -- the incident page itself failing must never undo the stop; the audit row above is the record
end $$;
revoke all on function private.therapy_audit_error(uuid, uuid, text, text) from public, anon, authenticated;

-- A crisis route (item 9 above zero, or self-harm thoughts): urgent event, a class 1 task that never waits for a pull, the clinician on call.
-- Same task type and notice templates as the F1 crisis path; it is keyed on the enrolment because there is no questionnaire row here.
create or replace function private.therapy_raise_crisis(p_enrolment uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  e public.therapy_enrolments%rowtype;
  v_event uuid;
  v_task uuid;
  v_to uuid;
  v_ok boolean := true;
  r record;
begin
  select * into e from public.therapy_enrolments where id = p_enrolment;
  if not found then return false; end if;
  begin
    v_event := private.emit_domain_event('programme.flag', e.organisation_id, jsonb_build_object('enrolment_id', e.id),
      'programme.flag:' || e.id || ':crisis', e.patient_id, 'therapy_enrolment', e.id, 'urgent');
  exception when others then
    v_ok := false;
    perform private.therapy_audit_error(e.organisation_id, e.id, 'crisis_event', sqlerrm);
  end;
  begin
    v_task := private.create_clinical_task(e.patient_id, 'red_event_unacknowledged', null, 'crisis:' || e.patient_id, null, null, v_event);
  exception when others then
    v_ok := false;
    perform private.therapy_audit_error(e.organisation_id, e.id, 'crisis_task', sqlerrm);
  end;
  -- one page per patient per hour: repeated submissions raise the (deduplicated) task but do not flood the pager
  if not exists (select 1 from public.audit_log where action = 'therapy.crisis_notified' and entity_id = e.patient_id and created_at > now() - interval '60 minutes') then
  begin
    v_to := private.page_recipient(e.organisation_id, e.is_test);
    if v_to is not null then
      perform private.crisis_notify(v_to, e.organisation_id, 'on_call_page', v_task);
    else
      for r in
        select p.id from public.profiles p where p.organisation_id = e.organisation_id and p.is_active and p.role = 'admin' and p.is_test = e.is_test
        union
        select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
         where cs.organisation_id = e.organisation_id and cs.profile_id is not null and cs.active and cs.status = 'active'
           and cs.doctor_tier = 'chief_medical_officer' and p.is_test = e.is_test
      loop
        perform private.crisis_notify(r.id, e.organisation_id, 'on_call_escalation', v_task);
      end loop;
      perform private.page_incident(e.organisation_id, 'therapy_crisis_no_cover:' || e.id, 'A priority case with nobody on call',
        'A priority case arrived while no eligible clinician was on the rota. The clinical lead and ops were alerted and a priority task is open.');
    end if;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event) values (e.organisation_id, 'therapy.crisis_notified', 'profile', e.patient_id, '{}'::jsonb);
  exception when others then
    v_ok := false;
    perform private.therapy_audit_error(e.organisation_id, e.id, 'crisis_notify', sqlerrm);
  end;
  end if;
  return v_ok and v_task is not null;
end $$;
revoke all on function private.therapy_raise_crisis(uuid) from public, anon, authenticated;

-- Stops an enrolment (or records a blocked one) for a positive screen and routes it. Idempotent: the tasks dedupe on the patient and programme.
create or replace function private.therapy_route_stop(p_enrolment uuid, p_screen jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.therapy_enrolments%rowtype;
  v_code text;
  v_route text := p_screen ->> 'route';
  v_cfg jsonb := private.therapy_config();
  v_task uuid;
  v_task_failed boolean := false;
begin
  select * into e from public.therapy_enrolments where id = p_enrolment;
  select code into v_code from public.therapy_programmes where id = e.programme_id;
  if v_route = 'crisis' then
    v_task_failed := not private.therapy_raise_crisis(e.id);
  elsif v_route in ('same_day_clinician', 'medical_review_first') then
    begin
      v_task := private.create_clinical_task(e.patient_id, 'symptom_review',
        (v_cfg -> 'route_due_minutes' ->> v_route)::integer, 'ts:' || md5(e.patient_id::text || ':' || v_code || ':' || v_route));
      begin
        perform private.emit_domain_event('programme.flag', e.organisation_id, jsonb_build_object('enrolment_id', e.id),
          'programme.flag:' || e.id || ':' || v_route, e.patient_id, 'therapy_enrolment', e.id);
      exception when others then
        perform private.therapy_audit_error(e.organisation_id, e.id, 'flag_event', sqlerrm);
      end;
    exception when others then
      v_task_failed := true;
      perform private.therapy_audit_error(e.organisation_id, e.id, 'route_task', sqlerrm);
    end;
  end if;
  return jsonb_build_object('route', v_route, 'task_id', v_task, 'task_failed', v_task_failed);
end $$;
revoke all on function private.therapy_route_stop(uuid, jsonb) from public, anon, authenticated;

create or replace function private.therapy_stop_enrolment(p_enrolment uuid, p_screen jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_route text := p_screen ->> 'route';
begin
  update public.therapy_enrolments
     set state = 'stopped_exclusion',
         stop_reason = case when coalesce((p_screen ->> 'no_rules')::boolean, false) then 'no_exclusion_list' when v_route = 'crisis' then 'crisis' else 'exclusion' end,
         exclusion_result = jsonb_build_object('stops', coalesce(p_screen -> 'stops', '[]'::jsonb), 'list_version', p_screen -> 'list_version'),
         stopped_at = now()
   where id = p_enrolment and state in ('active', 'paused');
  return private.therapy_route_stop(p_enrolment, p_screen);
end $$;
revoke all on function private.therapy_stop_enrolment(uuid, jsonb) from public, anon, authenticated;

-- The worsening check. Idempotent: it pauses an active enrolment on worsening, and a paused-for-review one only has its task and event re-ensured
-- (the task dedupes), so the bus handler can safely run it again. Comparisons mirror packages/shared assessWorsening.
create or replace function private.therapy_assess_progress(p_enrolment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.therapy_enrolments%rowtype;
  v_cfg jsonb := private.therapy_config();
  k text;
  v_rule jsonb;
  v_base numeric;
  v_last numeric;
  v_found boolean := false;
  v_task uuid;
begin
  select * into e from public.therapy_enrolments where id = p_enrolment;
  if not found then return jsonb_build_object('flagged', false, 'reason', 'unknown'); end if;
  if e.state = 'paused' and e.stop_reason = 'worsening_review' then
    v_found := true;
  elsif e.state = 'active' then
    for k, v_rule in select key, value from jsonb_each(v_cfg -> 'worsening') loop
      select (scores ->> k)::numeric into v_base from public.therapy_session_progress where enrolment_id = e.id and completed_at is not null and scores ? k order by ordinal asc limit 1;
      select (scores ->> k)::numeric into v_last from public.therapy_session_progress where enrolment_id = e.id and completed_at is not null and scores ? k
         and (e.resumed_at is null or completed_at > e.resumed_at) order by ordinal desc limit 1;
      if v_last is null then continue; end if;
      if v_rule ? 'absolute_at_least' and v_last >= (v_rule ->> 'absolute_at_least')::numeric then v_found := true;
      elsif v_base is not null and v_rule ? 'rise_at_least' and v_last - v_base >= (v_rule ->> 'rise_at_least')::numeric then v_found := true; end if;
    end loop;
    if v_found then
      update public.therapy_enrolments set state = 'paused', stop_reason = 'worsening_review' where id = e.id and state = 'active';
    end if;
  end if;
  if not v_found then return jsonb_build_object('flagged', false); end if;
  begin
    v_task := private.create_clinical_task(e.patient_id, 'symptom_review', (v_cfg -> 'route_due_minutes' ->> 'worsening_review')::integer, 'therapy_worsening:' || e.id);
    perform private.emit_domain_event('programme.flag', e.organisation_id, jsonb_build_object('enrolment_id', e.id),
      'programme.flag:' || e.id || ':worsening_review', e.patient_id, 'therapy_enrolment', e.id);
  exception when others then
    perform private.therapy_audit_error(e.organisation_id, e.id, 'worsening_task', sqlerrm);
    return jsonb_build_object('flagged', true, 'task_failed', true);
  end;
  return jsonb_build_object('flagged', true, 'task_id', v_task);
end $$;
revoke all on function private.therapy_assess_progress(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Go-live guards (seeded OFF) and their conditions
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('therapy_panic_breathing_enabled', 'Therapy programme: panic breathing', 'New enrolment, session start and completion for the panic breathing programme',
   'An approved content version; a confirmed exclusion list; clinician cover for the same-day queue confirmed; outcome thresholds confirmed', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session', 'programme screens'],
   'The entry screen itself, emergency guidance, and the crisis card are not behind it.'),
  ('therapy_pelvic_floor_enabled', 'Therapy programme: pelvic floor', 'New enrolment, session start and completion for the pelvic floor programme',
   'An approved content version; a confirmed exclusion list; clinician cover for the same-day queue confirmed; outcome thresholds confirmed', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session', 'programme screens'],
   'The entry screen itself, emergency guidance, and the crisis card are not behind it.'),
  ('therapy_ibs_hypnotherapy_enabled', 'Therapy programme: gut calm audio (IBS)', 'New enrolment, session start and completion for the IBS programme',
   'An approved content version; a confirmed exclusion list; clinician cover for the same-day queue confirmed; outcome thresholds confirmed', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session', 'programme screens'],
   'The entry screen itself, emergency guidance, and the crisis card are not behind it.'),
  ('therapy_cbt_i_enabled', 'Therapy programme: sleep (CBT-I)', 'Enrolment in the CBT-I programme (a scaffold: no content exists yet)',
   'An approved content version; a confirmed exclusion list; clinician cover confirmed; outcome thresholds confirmed', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session'], 'The entry screen is not behind it.'),
  ('therapy_pain_enabled', 'Therapy programmes: back, neck, knee and hip pain', 'Enrolment in the pain programmes (scaffolds: no content exists yet)',
   'An approved content version; a confirmed exclusion list; clinician cover confirmed; outcome thresholds confirmed', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session'], 'The red-flag entry screen is not behind it: saddle numbness blocks and shows urgent guidance whatever this says.'),
  ('therapy_mood_enabled', 'Therapy programmes: low mood, stress and anxiety', 'Enrolment in the mood, stress and anxiety programmes (scaffolds: no content exists yet)',
   'An approved content version; a confirmed exclusion list; clinician cover confirmed; outcome thresholds confirmed; the crisis follow-up path tested', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session'], 'The crisis route (item 9) and the crisis card are never behind a guard.'),
  ('therapy_pulmonary_rehab_enabled', 'Therapy programme: pulmonary rehabilitation', 'Enrolment in pulmonary rehabilitation (held until the COPD pathway exists)',
   'An approved content version; a confirmed exclusion list; the COPD pathway live; clinician cover confirmed; outcome thresholds confirmed', 'cmo',
   array['trigger therapy_enrolments_rules', 'enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session'], 'Nothing: the programme has no entry list, so it admits nobody.')
on conflict (key) do nothing;

create or replace function private.therapy_guard_conditions(p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_conds jsonb;
begin
  v_conds := jsonb_build_array(
    private.go_live_cond('content_approved', 'The programme content version is approved by the Chief Medical Officer',
      exists (select 1 from public.therapy_programmes p where p.guard_key = p_key)
      and not exists (select 1 from public.therapy_programmes p
                       where p.guard_key = p_key and p.status <> 'held'
                         and not private.therapy_version_is_approved(p.id, p.current_version)), 'data', null),
    private.go_live_cond('exclusion_list_confirmed', 'The entry questions and red flags are confirmed by the Chief Medical Officer',
      exists (select 1 from public.therapy_programmes p where p.guard_key = p_key)
      and not exists (select 1 from public.therapy_programmes p
                       where p.guard_key = p_key and p.status <> 'held'
                         and not exists (select 1 from public.therapy_exclusion_list_versions l
                                          where l.programme_code = p.code and l.status = 'confirmed'
                                            and l.version = (select max(version) from public.therapy_exclusion_list_versions where programme_code = p.code)
                                            and exists (select 1 from public.therapy_exclusion_rules r where r.programme_code = p.code and r.list_version = l.version))), 'data', null),
    private.go_live_cond('clinical_cover_confirmed', 'Clinician cover for the same-day queue is confirmed', private.go_live_attested(p_key, 'clinical_cover_confirmed'), 'attestation', null),
    private.go_live_cond('outcome_thresholds_confirmed', 'The Chief Medical Officer has confirmed the outcome thresholds', private.go_live_attested(p_key, 'outcome_thresholds_confirmed'), 'attestation', null));
  if p_key = 'therapy_mood_enabled' then
    v_conds := v_conds || jsonb_build_array(
      private.go_live_cond('crisis_path_tested', 'The crisis follow-up path was tested with a test patient', private.go_live_attested(p_key, 'crisis_path_tested'), 'attestation', null));
  elsif p_key = 'therapy_pulmonary_rehab_enabled' then
    v_conds := v_conds || jsonb_build_array(
      private.go_live_cond('copd_pathway_live', 'The asthma and COPD pathway is live', private.go_live_attested(p_key, 'copd_pathway_live'), 'attestation', null));
  end if;
  return v_conds;
end $$;
revoke all on function private.therapy_guard_conditions(text) from public, anon, authenticated;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def not like '%therapy_guard_conditions%' then
    v_new := replace(v_def, E'  end if;\n  -- An unknown key has no conditions',
      E'  elsif p_key like ''therapy\\_%\\_enabled'' then\n' ||
      E'    return private.therapy_guard_conditions(p_key);\n' ||
      E'  end if;\n  -- An unknown key has no conditions');
    if v_new = v_def then raise exception 'S63: go_live_conditions marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if v_def not like '%therapy%' then
    v_new := replace(v_def, 'if (p_key, p_code) not in (',
      E'if not (p_key like ''therapy\\_%\\_enabled'' and p_code in (''clinical_cover_confirmed'', ''outcome_thresholds_confirmed'', ''crisis_path_tested'', ''copd_pathway_live''))\n' ||
      E'       and (p_key, p_code) not in (');
    if v_new = v_def then raise exception 'S63: attest_go_live_condition marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Patient functions
-- ---------------------------------------------------------------------------
create or replace function public.get_therapy_entry_questions(p_programme_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  p public.therapy_programmes%rowtype;
  v_ver integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.therapy_programmes where code = p_programme_code;
  if not found then raise exception 'unknown programme' using errcode = '22023'; end if;
  select coalesce(max(version) filter (where status = 'confirmed'), max(version)) into v_ver from public.therapy_exclusion_list_versions where programme_code = p.code;
  return jsonb_build_object(
    'programme', jsonb_build_object('code', p.code, 'title', p.title, 'summary', p.summary, 'status', p.status),
    'open', p.status in ('draft', 'live') and private.go_live_open_patient(p.guard_key, v_uid),
    'list_version', v_ver,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('code', r.item_code, 'question', r.question, 'kind', r.kind) order by r.ordinal)
                             from public.therapy_exclusion_rules r where r.programme_code = p.code and r.list_version = v_ver), '[]'::jsonb));
end $$;
revoke all on function public.get_therapy_entry_questions(text) from public, anon;
grant execute on function public.get_therapy_entry_questions(text) to authenticated;

-- The pure screen, for showing guidance. No row is written and no task is raised.
create or replace function public.therapy_check_entry_screen(p_programme_code text, p_answers jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.therapy_programmes where code = p_programme_code) then raise exception 'unknown programme' using errcode = '22023'; end if;
  return private.therapy_evaluate_screen(p_programme_code, p_answers);
end $$;
revoke all on function public.therapy_check_entry_screen(text, jsonb) from public, anon;
grant execute on function public.therapy_check_entry_screen(text, jsonb) to authenticated;

create or replace function public.enrol_in_therapy_programme(p_programme_code text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  p public.therapy_programmes%rowtype;
  v_screen jsonb;
  v_existing public.therapy_enrolments%rowtype;
  v_id uuid;
  v_routed jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'only a patient can join a programme' using errcode = '42501'; end if;
  select * into p from public.therapy_programmes where code = p_programme_code;
  if not found then raise exception 'unknown programme' using errcode = '22023'; end if;

  v_screen := private.therapy_evaluate_screen(p.code, p_answers);
  select * into v_existing from public.therapy_enrolments where patient_id = v_uid and programme_id = p.id and state in ('active', 'paused');

  if not (v_screen ->> 'passed')::boolean then
    if coalesce((v_screen ->> 'no_rules')::boolean, false) then
      return jsonb_build_object('enrolled', false, 'route', null, 'no_rules', true, 'reason', 'not_available');
    end if;
    if v_existing.id is not null then
      v_routed := private.therapy_stop_enrolment(v_existing.id, v_screen);
      v_id := v_existing.id;
    else
      insert into public.therapy_enrolments (organisation_id, patient_id, programme_id, programme_version, exclusion_list_version, state, stop_reason,
                                              exclusion_result, source, recorded_by, is_test, stopped_at)
      values (pr.organisation_id, v_uid, p.id, p.current_version, (v_screen ->> 'list_version')::integer, 'blocked',
              case when (v_screen ->> 'route') = 'crisis' then 'crisis' else 'exclusion' end,
              jsonb_build_object('stops', v_screen -> 'stops', 'list_version', v_screen -> 'list_version'), 'self', v_uid, coalesce(pr.is_test, false), now())
      returning id into v_id;
      v_routed := private.therapy_route_stop(v_id, v_screen);
    end if;
    return jsonb_build_object('enrolled', false, 'enrolment_id', v_id, 'state', 'blocked', 'route', v_screen ->> 'route',
                              'stop_codes', (select coalesce(jsonb_agg(s ->> 'code'), '[]'::jsonb) from jsonb_array_elements(v_screen -> 'stops') s),
                              'task_failed', coalesce((v_routed ->> 'task_failed')::boolean, false));
  end if;

  if v_existing.id is not null then
    return jsonb_build_object('enrolled', true, 'enrolment_id', v_existing.id, 'state', v_existing.state, 'existing', true);
  end if;
  -- a stop by the entry screen (crisis or a red flag) is not undone by answering the form again: a clinician looks first
  if exists (select 1 from public.therapy_enrolments x
              where x.patient_id = v_uid and x.programme_id = p.id and x.state in ('blocked', 'stopped_exclusion') and x.stop_reason in ('crisis', 'exclusion')
                and exists (select 1 from jsonb_array_elements(x.exclusion_result -> 'stops') st where st ->> 'route' <> 'education_only')
                -- no active config means the longest wait, never none (fail closed)
                and x.stopped_at > now() - make_interval(hours => coalesce((private.therapy_config() ->> 'reenrol_cooldown_hours')::integer, 8760))) then
    return jsonb_build_object('enrolled', false, 'reason', 'clinician_review_pending');
  end if;
  if p.status in ('scaffold', 'held') then
    return jsonb_build_object('enrolled', false, 'reason', 'not_available');
  end if;
  if not private.go_live_open_patient(p.guard_key, v_uid) then
    return jsonb_build_object('enrolled', false, 'reason', 'not_open_yet');
  end if;
  begin
    insert into public.therapy_enrolments (organisation_id, patient_id, programme_id, programme_version, exclusion_list_version, state, exclusion_result, source, recorded_by, is_test)
    values (pr.organisation_id, v_uid, p.id, p.current_version, (v_screen ->> 'list_version')::integer, 'active',
            jsonb_build_object('stops', '[]'::jsonb, 'list_version', v_screen -> 'list_version'), 'self', v_uid, coalesce(pr.is_test, false))
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.therapy_enrolments where patient_id = v_uid and programme_id = p.id and state in ('active', 'paused');
    return jsonb_build_object('enrolled', true, 'enrolment_id', v_id, 'existing', true);
  end;
  return jsonb_build_object('enrolled', true, 'enrolment_id', v_id, 'state', 'active', 'programme_version', p.current_version);
end $$;
revoke all on function public.enrol_in_therapy_programme(text, jsonb) from public, anon;
grant execute on function public.enrol_in_therapy_programme(text, jsonb) to authenticated;

-- Starts a session. The entry screen is run AGAIN here, every time, and fails closed: a positive stops the programme, routes it, and no content is returned.
create or replace function public.start_therapy_session(p_enrolment uuid, p_ordinal integer, p_recheck jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  e public.therapy_enrolments%rowtype;
  p public.therapy_programmes%rowtype;
  s public.therapy_programme_sessions%rowtype;
  v_screen jsonb;
  v_total integer;
  v_cfg jsonb := private.therapy_config();
  v_approved boolean;
  v_routed jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.therapy_enrolments where id = p_enrolment and patient_id = v_uid;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select * into p from public.therapy_programmes where id = e.programme_id;
  if v_cfg is null then raise exception 'programmes are not configured' using errcode = '55000'; end if;
  if e.state <> 'active' then return jsonb_build_object('status', 'not_active', 'state', e.state); end if;
  if not private.go_live_open_patient(p.guard_key, v_uid) then return jsonb_build_object('status', 'not_open_yet'); end if;
  select count(*) into v_total from public.therapy_programme_sessions where programme_id = e.programme_id and version = e.programme_version;
  -- every session is done but the programme was left open because the worsening check failed at the last one: check again, then close it
  if e.completed_count >= v_total then
    begin
      perform private.therapy_assess_progress(e.id);
    exception when others then
      perform private.therapy_audit_error(e.organisation_id, e.id, 'assess', sqlerrm);
      return jsonb_build_object('status', 'not_active', 'state', 'active');
    end;
    update public.therapy_enrolments set state = 'completed', stop_reason = 'completed', stopped_at = now() where id = e.id and state = 'active';
    return jsonb_build_object('status', 'not_active', 'state', (select state from public.therapy_enrolments where id = e.id));
  end if;
  if p_ordinal is null or p_ordinal < 1 or p_ordinal > v_total or p_ordinal > e.completed_count + 1 then
    raise exception 'that session is not open yet' using errcode = '22023';
  end if;

  -- the re-check, every session, latest list, fail closed
  v_screen := private.therapy_evaluate_screen(p.code, p_recheck);
  if not (v_screen ->> 'passed')::boolean then
    v_routed := private.therapy_stop_enrolment(e.id, v_screen);
    return jsonb_build_object('status', 'stopped', 'route', v_screen ->> 'route', 'task_failed', coalesce((v_routed ->> 'task_failed')::boolean, false),
      'stop_codes', (select coalesce(jsonb_agg(x ->> 'code'), '[]'::jsonb) from jsonb_array_elements(v_screen -> 'stops') x));
  end if;

  select * into s from public.therapy_programme_sessions where programme_id = e.programme_id and version = e.programme_version and ordinal = p_ordinal;
  if not found then raise exception 'that session does not exist' using errcode = '22023'; end if;
  v_approved := private.therapy_version_is_approved(e.programme_id, e.programme_version);
  if not v_approved and not e.is_test then
    return jsonb_build_object('status', 'content_not_approved');
  end if;

  insert into public.therapy_session_progress (organisation_id, patient_id, enrolment_id, ordinal, is_test)
  values (e.organisation_id, e.patient_id, e.id, p_ordinal, e.is_test)
  on conflict (enrolment_id, ordinal) do update set started_at = now();

  return jsonb_build_object('status', 'ok',
    'programme', jsonb_build_object('code', p.code, 'title', p.title, 'version', e.programme_version, 'total_sessions', v_total),
    'session', jsonb_build_object('ordinal', s.ordinal, 'title', s.title, 'kind', s.kind, 'text', s.text_body,
                                  'audio_clip_id', s.audio_clip_id, 'duration_seconds', s.duration_seconds, 'audio_bytes', s.audio_bytes),
    'checkpoint', (v_cfg -> 'checkpoints' -> p.code) @> to_jsonb(p_ordinal),
    'instruments', coalesce(v_cfg -> 'instruments' -> p.code, '[]'::jsonb),
    'draft_content', not v_approved);
end $$;
revoke all on function public.start_therapy_session(uuid, integer, jsonb) from public, anon;
grant execute on function public.start_therapy_session(uuid, integer, jsonb) to authenticated;

create or replace function public.complete_therapy_session(p_enrolment uuid, p_ordinal integer, p_scores jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  e public.therapy_enrolments%rowtype;
  p public.therapy_programmes%rowtype;
  v_cfg jsonb := private.therapy_config();
  v_prog public.therapy_session_progress%rowtype;
  v_total integer;
  v_wanted jsonb;
  v_key text;
  v_val jsonb;
  v_range jsonb;
  v_is_cp boolean;
  v_primary text;
  v_done integer;
  v_assess jsonb := jsonb_build_object('flagged', false);
  v_assess_failed boolean := false;
  v_finished boolean := false;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.therapy_enrolments where id = p_enrolment and patient_id = v_uid;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select * into p from public.therapy_programmes where id = e.programme_id;
  if v_cfg is null then raise exception 'programmes are not configured' using errcode = '55000'; end if;
  if e.state <> 'active' then return jsonb_build_object('status', 'not_active', 'state', e.state); end if;
  if not private.go_live_open_patient(p.guard_key, v_uid) then return jsonb_build_object('status', 'not_open_yet'); end if;
  select * into v_prog from public.therapy_session_progress where enrolment_id = e.id and ordinal = p_ordinal;
  if not found then raise exception 'that session was not started' using errcode = '22023'; end if;
  if v_prog.completed_at is not null then
    return jsonb_build_object('status', 'ok', 'already', true, 'completed_count', e.completed_count);
  end if;

  v_is_cp := (v_cfg -> 'checkpoints' -> p.code) @> to_jsonb(p_ordinal);
  v_wanted := coalesce(v_cfg -> 'instruments' -> p.code, '[]'::jsonb);
  if v_is_cp then
    if p_scores is null or jsonb_typeof(p_scores) <> 'object' then raise exception 'scores are needed at this session' using errcode = '22023'; end if;
    for v_key in select jsonb_array_elements_text(v_wanted) loop
      v_val := p_scores -> v_key;
      v_range := v_cfg -> 'instrument_ranges' -> v_key;
      if v_val is null or jsonb_typeof(v_val) <> 'number' or v_range is null or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
         or (v_val #>> '{}')::numeric < (v_range ->> 'min')::numeric or (v_val #>> '{}')::numeric > (v_range ->> 'max')::numeric then
        raise exception 'a score is missing or out of range' using errcode = '22023';
      end if;
    end loop;
    if exists (select 1 from jsonb_object_keys(p_scores) k where not (v_wanted ? k)) then
      raise exception 'an unknown score was sent' using errcode = '22023';
    end if;
  elsif p_scores is not null and p_scores <> '{}'::jsonb then
    raise exception 'scores are asked only at set sessions' using errcode = '22023';
  end if;

  update public.therapy_session_progress set completed_at = now(), scores = case when v_is_cp then p_scores else null end where id = v_prog.id;
  select count(*) into v_done from public.therapy_session_progress where enrolment_id = e.id and completed_at is not null;
  select count(*) into v_total from public.therapy_programme_sessions where programme_id = e.programme_id and version = e.programme_version;
  v_primary := v_wanted ->> 0;
  update public.therapy_enrolments
     set completed_count = v_done,
         baseline_score = case when v_is_cp and baseline_score is null and v_primary is not null then (p_scores ->> v_primary)::numeric else baseline_score end,
         current_score = case when v_is_cp and v_primary is not null then (p_scores ->> v_primary)::numeric else current_score end
   where id = e.id;

  -- the event (second line: the bus handler re-runs the worsening check)
  begin
    perform private.emit_domain_event('programme.session_completed', e.organisation_id, jsonb_build_object('enrolment_id', e.id, 'ordinal', p_ordinal),
      'programme.session_completed:' || e.id || ':' || p_ordinal, e.patient_id, 'therapy_enrolment', e.id);
  exception when others then
    perform private.therapy_audit_error(e.organisation_id, e.id, 'completed_event', sqlerrm);
  end;
  -- the first line: the worsening check inline, so it does not depend on the bus. It runs BEFORE the programme is marked complete, so a
  -- worsening score at the last session still pauses it for review.
  if v_is_cp then
    begin
      v_assess := private.therapy_assess_progress(e.id);
    exception when others then
      v_assess_failed := true;
      perform private.therapy_audit_error(e.organisation_id, e.id, 'assess', sqlerrm);
    end;
  end if;
  -- a failed check leaves the programme open (not complete) so the bus handler can still assess and flag it
  if v_done >= v_total and not v_assess_failed and not coalesce((v_assess ->> 'flagged')::boolean, false) then
    update public.therapy_enrolments set state = 'completed', stop_reason = 'completed', stopped_at = now() where id = e.id and state = 'active';
    v_finished := true;
  end if;
  return jsonb_build_object('status', 'ok', 'completed_count', v_done, 'programme_completed', v_finished,
                            'paused_for_review', coalesce((v_assess ->> 'flagged')::boolean, false));
end $$;
revoke all on function public.complete_therapy_session(uuid, integer, jsonb) from public, anon;
grant execute on function public.complete_therapy_session(uuid, integer, jsonb) to authenticated;

create or replace function public.stop_therapy_enrolment(p_enrolment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.therapy_enrolments set state = 'stopped_by_patient', stop_reason = 'patient_choice', stopped_at = now()
   where id = p_enrolment and patient_id = v_uid and state in ('active', 'paused');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.stop_therapy_enrolment(uuid) from public, anon;
grant execute on function public.stop_therapy_enrolment(uuid) to authenticated;

-- Explicit, revocable consent to share progress with a clinician. Owner only. Nothing is shared by default and a revoke takes effect at once.
create or replace function public.set_therapy_progress_sharing(p_enrolment uuid, p_share boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); e public.therapy_enrolments%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_share is null then raise exception 'say whether to share' using errcode = '22023'; end if;
  select * into e from public.therapy_enrolments where id = p_enrolment and patient_id = v_uid;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  insert into public.therapy_share_consents (enrolment_id, organisation_id, patient_id, shared, granted_at, revoked_at)
  values (e.id, e.organisation_id, v_uid, p_share, case when p_share then now() else null end, case when p_share then null else now() end)
  on conflict (enrolment_id) do update
    set shared = excluded.shared,
        granted_at = case when excluded.shared then now() else public.therapy_share_consents.granted_at end,
        revoked_at = case when excluded.shared then null else now() end,
        updated_at = now();
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (e.organisation_id, v_uid, case when p_share then 'therapy_progress.share_granted' else 'therapy_progress.share_revoked' end,
          'therapy_enrolment', e.id, '{}'::jsonb, v_uid);
  return jsonb_build_object('status', 'ok', 'shared', p_share);
end $$;
revoke all on function public.set_therapy_progress_sharing(uuid, boolean) from public, anon;
grant execute on function public.set_therapy_progress_sharing(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Clinician reads (audited, tied, consented) and resume
-- ---------------------------------------------------------------------------
create or replace function private.audit_therapy_read(p_patient uuid, p_reason text, p_result text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), 'staff.therapy_progress_read', 'profile', pr.id,
         jsonb_build_object('reason', btrim(p_reason)), btrim(p_reason), p_result, pr.id, private.request_ip()
    from public.profiles pr where pr.id = p_patient;
end $$;
revoke all on function private.audit_therapy_read(uuid, text, text) from public, anon, authenticated;

create or replace function public.read_therapy_progress_audited(p_patient uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_patient = v_uid then
    -- a patient reading their own progress is not a staff read
    return jsonb_build_object('status', 'ok', 'enrolments', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select e.id, p.code, e.state, e.completed_count, e.baseline_score, e.current_score from public.therapy_enrolments e join public.therapy_programmes p on p.id = e.programme_id
       where e.patient_id = v_uid order by e.started_at desc) x), '[]'::jsonb));
  end if;
  if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
  if not (private.is_mental_health_clinician() and private.clinician_has_patient_access(p_patient)) then
    perform private.audit_therapy_read(p_patient, p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'programme', p.code, 'title', p.title, 'state', e.state, 'stop_reason', e.stop_reason, 'started_at', e.started_at,
           'completed_count', e.completed_count, 'baseline_score', e.baseline_score, 'current_score', e.current_score,
           'sessions', coalesce((select jsonb_agg(jsonb_build_object('ordinal', sp.ordinal, 'completed_at', sp.completed_at, 'scores', sp.scores) order by sp.ordinal)
                                   from public.therapy_session_progress sp where sp.enrolment_id = e.id), '[]'::jsonb)) order by e.started_at desc), '[]'::jsonb)
    into v_rows
    from public.therapy_enrolments e
    join public.therapy_programmes p on p.id = e.programme_id
    join public.therapy_share_consents c on c.enrolment_id = e.id and c.shared
   where e.patient_id = p_patient;
  if v_rows = '[]'::jsonb then
    perform private.audit_therapy_read(p_patient, p_reason, 'denied');
    return jsonb_build_object('status', 'not_shared');
  end if;
  perform private.audit_therapy_read(p_patient, p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'enrolments', v_rows);
end $$;
revoke all on function public.read_therapy_progress_audited(uuid, text) from public, anon;
grant execute on function public.read_therapy_progress_audited(uuid, text) to authenticated;

-- A tied clinician resumes a programme paused for review. Audited; cannot resume a programme stopped by the entry screen.
create or replace function public.resume_therapy_enrolment(p_enrolment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); e public.therapy_enrolments%rowtype;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
  select * into e from public.therapy_enrolments where id = p_enrolment;
  if not found or not (private.is_mental_health_clinician() and private.clinician_has_patient_access(e.patient_id)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if e.state <> 'paused' or e.stop_reason <> 'worsening_review' then raise exception 'only a programme paused for review can be resumed' using errcode = '22023'; end if;
  update public.therapy_enrolments set state = 'active', stop_reason = null, resumed_at = now() where id = e.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id)
  values (e.organisation_id, v_uid, 'staff.therapy_programme_resumed', 'therapy_enrolment', e.id, '{}'::jsonb, btrim(p_reason), 'success', e.patient_id);
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.resume_therapy_enrolment(uuid, text) from public, anon;
grant execute on function public.resume_therapy_enrolment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. CMO-only governance functions. The build NEVER calls these against a real project: signing is the CMO's act.
-- ---------------------------------------------------------------------------
create or replace function public.save_therapy_exclusion_list(p_programme_code text, p_rules jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_ver integer; v_i integer := 0; x jsonb;
begin
  if v_uid is null or not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can edit an exclusion list' using errcode = '42501'; end if;
  if not exists (select 1 from public.therapy_programmes where code = p_programme_code) then raise exception 'unknown programme' using errcode = '22023'; end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then raise exception 'a list needs at least one item' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.therapy_exclusion_list_versions where programme_code = p_programme_code;
  insert into public.therapy_exclusion_list_versions (programme_code, version, status, created_by, note) values (p_programme_code, v_ver, 'draft', v_uid, p_note);
  for x in select * from jsonb_array_elements(p_rules) loop
    v_i := v_i + 1;
    insert into public.therapy_exclusion_rules (programme_code, list_version, ordinal, item_code, question, kind, threshold, route, unverified)
    values (p_programme_code, v_ver, v_i, x ->> 'code', x ->> 'question', x ->> 'kind', (x ->> 'threshold')::numeric, x ->> 'route', coalesce((x ->> 'unverified')::boolean, false));
  end loop;
  return jsonb_build_object('status', 'ok', 'version', v_ver);
end $$;
revoke all on function public.save_therapy_exclusion_list(text, jsonb, text) from public, anon;
grant execute on function public.save_therapy_exclusion_list(text, jsonb, text) to authenticated;

create or replace function public.confirm_therapy_exclusion_list(p_programme_code text, p_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n integer;
begin
  if v_uid is null or not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can confirm an exclusion list' using errcode = '42501'; end if;
  if p_version <> (select max(version) from public.therapy_exclusion_list_versions where programme_code = p_programme_code) then
    raise exception 'only the newest version can be confirmed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.therapy_exclusion_rules where programme_code = p_programme_code and list_version = p_version) then
    raise exception 'an empty list cannot be confirmed' using errcode = '22023';
  end if;
  update public.therapy_exclusion_list_versions set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now()
   where programme_code = p_programme_code and version = p_version and status = 'draft';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'that version is already confirmed or does not exist' using errcode = '22023'; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select (select organisation_id from public.profiles where id = v_uid), v_uid, 'therapy_exclusion_list.confirmed', 'therapy_programme', null,
         jsonb_build_object('programme', p_programme_code, 'version', p_version);
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.confirm_therapy_exclusion_list(text, integer) from public, anon;
grant execute on function public.confirm_therapy_exclusion_list(text, integer) to authenticated;

create or replace function public.approve_therapy_programme_version(p_programme_code text, p_version integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); p public.therapy_programmes%rowtype; n integer;
begin
  if v_uid is null or not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can approve programme content' using errcode = '42501'; end if;
  select * into p from public.therapy_programmes where code = p_programme_code;
  if not found then raise exception 'unknown programme' using errcode = '22023'; end if;
  if not exists (select 1 from public.therapy_programme_sessions where programme_id = p.id and version = p_version) then
    raise exception 'a version with no sessions cannot be approved' using errcode = '22023';
  end if;
  update public.therapy_programme_versions set review_state = 'approved', approved_by = v_uid, approved_at = now(), note = coalesce(p_note, note)
   where programme_id = p.id and version = p_version and review_state in ('draft', 'in_review');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'that version is already approved, retired or does not exist' using errcode = '22023'; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values ((select organisation_id from public.profiles where id = v_uid), v_uid, 'therapy_programme.version_approved', 'therapy_programme', p.id,
          jsonb_build_object('programme', p_programme_code, 'version', p_version));
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.approve_therapy_programme_version(text, integer, text) from public, anon;
grant execute on function public.approve_therapy_programme_version(text, integer, text) to authenticated;

-- The bus handler's entry point (programme-progress). Service role only.
create or replace function public.therapy_run_progress(p_enrolment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not authorised' using errcode = '42501'; end if;
  return private.therapy_assess_progress(p_enrolment);
end $$;
revoke all on function public.therapy_run_progress(uuid) from public, anon, authenticated;
grant execute on function public.therapy_run_progress(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Seeds. All DRAFT. Nothing is signed, approved, confirmed or switched on.
-- ---------------------------------------------------------------------------
insert into public.therapy_programmes (code, wave, title, summary, status, guard_key) values
  ('panic_breathing', 'A', 'Slow breathing for panic', 'Six weekly sessions of guided slow breathing you can follow by sound or on screen. A self-help programme, not treatment.', 'draft', 'therapy_panic_breathing_enabled'),
  ('pelvic_floor', 'A', 'Pelvic floor exercises', 'Twelve weekly sessions of audio-guided pelvic floor exercises for bladder leaks. A self-help programme, not treatment.', 'draft', 'therapy_pelvic_floor_enabled'),
  ('ibs_hypnotherapy', 'A', 'Gut calm audio', 'Six weeks of a 15 minute guided relaxation recording for tummy symptoms. A self-help programme, not treatment.', 'draft', 'therapy_ibs_hypnotherapy_enabled'),
  ('cbt_i', 'B', 'Sleep programme', 'A self-help programme for long-standing sleep trouble. Scaffold only: no content yet.', 'scaffold', 'therapy_cbt_i_enabled'),
  ('pain_back', 'B', 'Back pain programme', 'Self-help exercises and education for back pain. Scaffold only: no content yet.', 'scaffold', 'therapy_pain_enabled'),
  ('pain_neck', 'B', 'Neck pain programme', 'Self-help exercises and education for neck pain. Scaffold only: no content yet.', 'scaffold', 'therapy_pain_enabled'),
  ('pain_knee', 'B', 'Knee pain programme', 'Self-help exercises and education for knee pain. Scaffold only: no content yet.', 'scaffold', 'therapy_pain_enabled'),
  ('pain_hip', 'B', 'Hip pain programme', 'Self-help exercises and education for hip pain. Scaffold only: no content yet.', 'scaffold', 'therapy_pain_enabled'),
  ('low_mood', 'C', 'Low mood programme', 'A self-guided programme for low mood. Scaffold only: no content yet.', 'scaffold', 'therapy_mood_enabled'),
  ('stress', 'C', 'Stress programme', 'A self-guided programme for stress. Scaffold only: no content yet.', 'scaffold', 'therapy_mood_enabled'),
  ('anxiety', 'C', 'Anxiety programme', 'A self-guided programme for worry and anxiety. Scaffold only: no content yet.', 'scaffold', 'therapy_mood_enabled'),
  ('pulmonary_rehab', 'C', 'Breathing exercise programme', 'Held until the asthma and COPD pathway exists. No content, no entry list.', 'held', 'therapy_pulmonary_rehab_enabled')
on conflict (code) do nothing;

insert into public.therapy_programme_versions (programme_id, version, review_state, note)
select id, 1, 'draft', 'DRAFT (S63, 2026-10-07). Unreviewed. The CMO reads, changes or rejects the content before it can be approved.' from public.therapy_programmes
on conflict (programme_id, version) do nothing;

-- therapy-content-v1-begin (the Wave A session text; packages/shared/src/therapy-content mirrors it, a test fails on drift)
insert into public.therapy_programme_sessions (programme_id, version, ordinal, title, kind, text_body, audio_clip_id, duration_seconds)
select p.id, 1, (s ->> 'ordinal')::integer, s ->> 'title', s ->> 'kind', s ->> 'body',
       'THP-' || (c ->> 'clip') || lpad(s ->> 'ordinal', 2, '0'), (s ->> 'durationSeconds')::integer
  from jsonb_array_elements($json$[{"code":"panic_breathing","clip":"PAN","sessions":[{"ordinal":1,"title":"What panic is, and your first slow breaths","kind":"education","body":"Welcome. This is a self-help programme. It is not treatment, and it does not replace your care team. Panic is a rush of fear that comes with strong body feelings, such as a pounding heart, shaky hands or fast breathing. It feels frightening, and it passes. Fast, shallow breathing can make those body feelings stronger. Slow, even breathing gives your body a calmer signal. Today we only practise. Sit comfortably with your feet on the floor. Let your shoulders drop. Breathe in gently through your nose as the guide moves up, and breathe out slowly as it moves down. Let the out-breath be a little longer than the in-breath. Never force a breath and never hold it. Practise twice a day this week, when you feel calm. If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.","durationSeconds":600},{"ordinal":2,"title":"Practising when you feel calm","kind":"paced_breathing","body":"Welcome back. Slow breathing is a skill, and skills grow with practice on ordinary days, not only on hard ones. Sit comfortably. Follow the pacer: in gently as it rises, out slowly as it falls. Keep your breath small and quiet, as if you were breathing in the smell of food and breathing out onto a cool window. If your mind wanders, that is normal. Notice it and come back to the pacer. Practise twice a day. You do not need to wait for panic to practise. If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.","durationSeconds":600},{"ordinal":3,"title":"A longer out-breath, eyes open","kind":"paced_breathing","body":"This week we practise with your eyes open, so you can use the skill anywhere. Sit or stand. Rest your gaze on one still point. Follow the pacer. Breathe in gently, and let the out-breath be slow and soft. Try it at a bus stop, in a queue or before a meeting. Each time, notice how your body feels before and after. You are not trying to feel perfect. You are practising settling. If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.","durationSeconds":600},{"ordinal":4,"title":"Using it early, when a wave begins","kind":"paced_breathing","body":"Now we use the skill when you notice the first signs of a wave. Early signs may be a tight chest feeling you know well, a quick heartbeat or a rush of worry. Say to yourself: this is a wave, and it will pass. Then start your slow breathing, in gently and out slowly. Keep going for a few minutes, even if the feelings are still there. Slow breathing may not stop a wave at once. It gives you something steady to do while it passes. If a chest feeling is new, different from your usual pattern, or severe, do not use this programme. Get help straight away. If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.","durationSeconds":600},{"ordinal":5,"title":"Staying with the wave","kind":"paced_breathing","body":"Waves of panic rise, peak and fall. Trying to fight a wave often makes it feel bigger. This week, when a wave comes, breathe slowly and let it rise and fall without arguing with it. Follow the pacer, and notice where in your body you feel the wave. Afterwards, write down one line in your diary: where you were, and what helped. Your diary stays on this phone unless you choose to share it. If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.","durationSeconds":600},{"ordinal":6,"title":"Looking back, and what comes next","kind":"education","body":"You have practised slow breathing for six weeks. Look at your diary and at your scores. Some people notice a change and some do not. Either is useful to know. Keep practising a little each day if it helps you. If panic is still getting in the way of your life, or is getting worse, tell your care team. They can talk with you about other support. Thank you for taking part. If you feel dizzy, faint or unwell at any point, stop, sit down and breathe normally. If something feels wrong or you are worried, contact your care team through the app. If you feel in danger, go to the nearest hospital now.","durationSeconds":480}]},{"code":"pelvic_floor","clip":"PEL","sessions":[{"ordinal":1,"title":"Finding your pelvic floor","kind":"education","body":"Welcome. This is a self-help programme. It does not replace your care team. Your pelvic floor is a sling of muscles that supports your bladder. When it is weak, you can leak when you cough, sneeze, laugh or lift. These muscles can be trained, like any other muscle. Sit comfortably. Imagine you are trying to stop yourself passing wind, and at the same time stop the flow of urine. Squeeze and lift gently inside, then let go. Do not hold your breath. Do not squeeze your buttocks or thighs. Do not practise while passing urine. Try three gentle squeezes now. If you cannot feel the muscles, or you feel pain, tell your care team.","durationSeconds":480},{"ordinal":2,"title":"Slow squeezes and rest","kind":"exercise","body":"Today we practise slow squeezes. Squeeze and lift, hold for a count of three, then let go fully for a count of three. Let go completely each time, because the rest is part of the exercise. Breathe normally throughout. Do a short set now with the guide. Over the week, aim for a set of squeezes morning, afternoon and evening.","durationSeconds":480},{"ordinal":3,"title":"Building up to a full set","kind":"exercise","body":"Your target is a set of at least 8 squeezes, three times a day, for at least 3 months. We build up to it. Today, do as many slow squeezes as you can with good form, up to 8, and rest between each. If your muscles tire, stop the set and try again later. Tired muscles are normal at first. Sharp pain is not. If you feel pain, stop and tell your care team. Fix your sets to things you already do, such as after brushing your teeth, at lunch and before bed.","durationSeconds":540},{"ordinal":4,"title":"Squeeze before you cough or sneeze","kind":"exercise","body":"Now we link your exercises to daily life. Just before you cough, sneeze, laugh or lift something, squeeze and lift your pelvic floor, and hold until after. This is a skill. It takes practice, so begin with a small cough on purpose. Keep up your three sets of 8 squeezes each day.","durationSeconds":540},{"ordinal":5,"title":"Longer holds","kind":"exercise","body":"Keep up your sets of 8 squeezes, three times a day. This week, slowly lengthen each hold. If you can, hold for a count of five, then rest for a count of five. Do not strain. Breathe throughout. Some people skip a day. That is fine. Start again the next day.","durationSeconds":540},{"ordinal":6,"title":"Quick squeezes","kind":"exercise","body":"Alongside your slow squeezes, add a few quick ones. Squeeze and lift fast, let go fully, and repeat up to 8 times. Quick squeezes practise reacting in time when you cough or move. Keep to three sets a day. Stop and tell your care team if you notice pain, blood in your urine, or trouble passing urine.","durationSeconds":540},{"ordinal":7,"title":"Squeezing while you are standing","kind":"exercise","body":"So far you have practised sitting. Now practise standing, because that is when leaks often happen. Stand with your feet apart. Squeeze and lift for a slow count, then rest. Keep to your three sets of 8 a day, and try one of them standing.","durationSeconds":540},{"ordinal":8,"title":"Checking in on your progress","kind":"education","body":"You are about halfway. Think back over the last two weeks. How many leaks did you have each week? Add your count when the app asks. Some people see a change by now and some need longer. The usual advice is to keep going for at least 3 months before judging. If leaks are getting worse, tell your care team.","durationSeconds":420},{"ordinal":9,"title":"Squeezing during activity","kind":"exercise","body":"Practise squeezing while you walk, climb stairs or carry something light. Squeeze and lift, then relax as you finish the movement. Keep up your three sets a day. Notice which moments are hardest, and squeeze just before them.","durationSeconds":540},{"ordinal":10,"title":"Keeping the habit","kind":"education","body":"A habit sticks when it is tied to your day. Choose three moments you will not forget. Set a quiet reminder if it helps. Keep your three sets of 8 squeezes. Drink normally and avoid cutting back on water to avoid leaks, because that can irritate your bladder.","durationSeconds":420},{"ordinal":11,"title":"Longer and stronger","kind":"exercise","body":"Combine what you have learned. Do slow holds, quick squeezes and a squeeze before a cough. Keep your three sets a day. Stay with good form: breathe, do not squeeze your buttocks, and let go fully.","durationSeconds":540},{"ordinal":12,"title":"Looking back, and keeping going","kind":"education","body":"You have reached the end of the twelve sessions. Look at your leak counts. Muscles stay strong only with regular use, so keep your three sets a day if you can. If leaks have not eased, or have got worse, tell your care team. They can talk with you about other support. Thank you for taking part.","durationSeconds":420}]},{"code":"ibs_hypnotherapy","clip":"IBS","sessions":[{"ordinal":1,"title":"Week 1: settling the body","kind":"guided_audio","body":"Find a quiet place where you will not be disturbed, and lie down or sit back. This is a self-help recording. It does not replace your care team. Close your eyes if you wish. Let your breathing slow. Notice your feet, and let them be heavy. Let that heaviness move up through your legs, your hips and your back. Let your shoulders drop and your jaw soften. Now bring your attention to your tummy. Rest a warm hand there if you like. With each slow out-breath, let your tummy soften. Imagine a gentle warmth spreading through it, like sun on your skin. There is nothing to do and nowhere to be. When you are ready, take a deeper breath, stretch, and open your eyes. Listen to this recording once a day this week.","durationSeconds":900},{"ordinal":2,"title":"Week 2: a calm, steady rhythm","kind":"guided_audio","body":"Settle into your usual quiet place. Let your breath slow, and let your body grow heavy. Move your attention through your body from your feet up to your head, letting each part relax. Now picture a slow, steady river that flows at an easy pace. Imagine your gut moving in the same even rhythm, without hurry and without effort. Each out-breath lets the river flow a little more smoothly. Stay with that picture for a few minutes. When you are ready, open your eyes. Keep listening once a day.","durationSeconds":900},{"ordinal":3,"title":"Week 3: a safe and quiet place inside","kind":"guided_audio","body":"Begin as before: slow breath, heavy body, soft shoulders. Picture a place where you feel safe and calm. It might be a garden, a shady tree or a quiet room. Notice what you can see, hear and feel there. Bring that calm into your tummy. With each out-breath, let that calm settle there. If a tummy sensation comes, notice it kindly, without trying to push it away, and let your breath stay slow. When you are ready, return to the room, take a deeper breath and open your eyes.","durationSeconds":900},{"ordinal":4,"title":"Week 4: noticing without worry","kind":"guided_audio","body":"Settle in with a slow breath and relax your body from your feet upwards. This week, as you rest, notice any sensations in your tummy as simply sensations, like weather passing. They come and they go. Breathe slowly, and picture a soft, warm light resting over your tummy, steady and calm. Let each out-breath soften the area a little more. When you finish, notice how you feel. Keep your daily listening going.","durationSeconds":900},{"ordinal":5,"title":"Week 5: bringing calm into your day","kind":"guided_audio","body":"Settle in as before, and relax your body. Picture an ordinary part of your day, such as a meal or a journey, going smoothly. Imagine yourself calm and comfortable in your body as it happens. Then take a slow breath in, and as you breathe out, let your tummy soften. You can use that same soft out-breath in your day, at any time. When you are ready, open your eyes. Keep listening once a day.","durationSeconds":900},{"ordinal":6,"title":"Week 6: looking back, and carrying on","kind":"guided_audio","body":"Settle into your quiet place. Let your breath slow and your body relax, in your own time. Think back over the six weeks. Notice what has helped you settle. Keep the slow out-breath, the warm hand and the quiet place as tools you can use whenever you like. When you are ready, open your eyes. Check your symptom score when the app asks. If your tummy symptoms are not easing or are getting worse, or if anything new worries you, tell your care team. Thank you for taking part.","durationSeconds":900}]}]$json$::jsonb) c
  join public.therapy_programmes p on p.code = c ->> 'code'
  cross join lateral jsonb_array_elements(c -> 'sessions') s
on conflict (programme_id, version, ordinal) do nothing;
-- therapy-content-v1-end

-- exclusion-lists-v1-begin (docs/design/S63.md; packages/shared/src/proposed-config mirrors it, a test fails on drift). Every list is a DRAFT.
insert into public.therapy_exclusion_list_versions (programme_code, version, status, note)
select p.code, 1, 'draft', 'DRAFT (S63, 2026-10-07), unconfirmed. Verified items come from CMO decisions Q14 to Q16 and NICE NG123 and CG61 style lists; items marked unverified are local additions that stay draft until the CMO confirms them.'
  from public.therapy_programmes p
on conflict (programme_code, version) do nothing;

insert into public.therapy_exclusion_rules (programme_code, list_version, ordinal, item_code, question, kind, threshold, route, unverified)
select l.key, 1, r.ord::integer, r.val ->> 'code', r.val ->> 'question', r.val ->> 'kind', (r.val ->> 'threshold')::numeric, r.val ->> 'route', coalesce((r.val ->> 'unverified')::boolean, false)
  from jsonb_each($json${"panic_breathing":[{"code":"crisis_thoughts","question":"In the last two weeks, have you had thoughts of harming yourself or that you would be better off dead?","kind":"yes_no","route":"crisis"},{"code":"chest_symptom","question":"Do you have, or have you recently had, chest pain, chest tightness, or a racing or uneven heartbeat?","kind":"yes_no","route":"same_day_clinician"},{"code":"breathless_or_faint","question":"Are you short of breath at rest, or did you faint or nearly faint recently?","kind":"yes_no","route":"same_day_clinician"},{"code":"first_time_panic","question":"Is this the first time you have had sudden waves of intense fear or panic?","kind":"yes_no","route":"medical_review_first"}],"pelvic_floor":[{"code":"blood_in_urine","question":"Have you seen blood in your urine?","kind":"yes_no","route":"same_day_clinician"},{"code":"urinary_retention","question":"Do you have trouble passing urine, a very weak stream, or a feeling that you cannot empty your bladder?","kind":"yes_no","route":"same_day_clinician"},{"code":"pelvic_mass","question":"Have you felt a new lump or swelling in your pelvis or lower tummy?","kind":"yes_no","route":"same_day_clinician"},{"code":"continuous_leakage","question":"Does urine leak all the time, day and night, rather than with a cough, a sneeze or a sudden urge?","kind":"yes_no","route":"same_day_clinician","unverified":true}],"ibs_hypnotherapy":[{"code":"unexplained_weight_loss","question":"Have you lost weight without trying in the last few months?","kind":"yes_no","route":"same_day_clinician"},{"code":"rectal_bleeding","question":"Have you had bleeding from your back passage?","kind":"yes_no","route":"same_day_clinician"},{"code":"family_bowel_or_ovarian_cancer","question":"Has a close relative had cancer of the bowel or the ovary?","kind":"yes_no","route":"same_day_clinician"},{"code":"anaemia_or_mass","question":"Have you been told you have anaemia (low blood), or have you felt a lump in your tummy or back passage?","kind":"yes_no","route":"same_day_clinician"},{"code":"new_onset_over_50","question":"Are you over 50 and are these tummy symptoms new for you?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"night_symptoms","question":"Do your tummy symptoms wake you from sleep?","kind":"yes_no","route":"same_day_clinician","unverified":true}],"cbt_i":[{"code":"isi_total","question":"Insomnia Severity Index total score (0 to 28)","kind":"score_below","threshold":15,"route":"education_only"},{"code":"bipolar_or_mania","question":"Have you ever been told you have bipolar disorder or had an episode of mania?","kind":"yes_no","route":"same_day_clinician"},{"code":"psychosis","question":"Have you ever been told you have a psychotic illness, or had times of hearing or seeing things others do not?","kind":"yes_no","route":"same_day_clinician"},{"code":"epilepsy_or_seizures","question":"Do you have epilepsy or have you had a seizure?","kind":"yes_no","route":"same_day_clinician"},{"code":"parasomnia","question":"Do you sleepwalk, act out dreams, or have other unusual behaviours at night?","kind":"yes_no","route":"same_day_clinician"},{"code":"drowsy_driving_or_safety_critical","question":"Do you drive or do safety-critical work and sometimes feel drowsy while doing it?","kind":"yes_no","route":"same_day_clinician"},{"code":"pregnancy","question":"Are you pregnant?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"alcohol_or_sedative_dependence","question":"Do you rely on alcohol, sleeping tablets or sedatives to sleep?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"epworth_total","question":"Epworth Sleepiness Scale total score (0 to 24)","kind":"score_at_least","threshold":10,"route":"medical_review_first"},{"code":"stopbang_total","question":"STOP-Bang total score (0 to 8)","kind":"score_at_least","threshold":3,"route":"medical_review_first"}],"pain_back":[{"code":"saddle_numbness","question":"Do you have numbness or odd feelings around your genitals, buttocks or inner thighs (the saddle area)?","kind":"yes_no","route":"same_day_clinician"},{"code":"bladder_or_bowel_change","question":"Have you noticed a new change in passing urine or opening your bowels, such as leaking or not being able to go?","kind":"yes_no","route":"same_day_clinician"},{"code":"weakness_both_legs","question":"Do you have weakness in both legs?","kind":"yes_no","route":"same_day_clinician"},{"code":"progressive_deficit","question":"Is weakness or numbness getting worse over days or weeks?","kind":"yes_no","route":"same_day_clinician"},{"code":"recent_trauma","question":"Did this pain start after a fall, accident or injury?","kind":"yes_no","route":"same_day_clinician"},{"code":"fever","question":"Do you have a fever, or have you felt feverish with this pain?","kind":"yes_no","route":"same_day_clinician"},{"code":"unexplained_weight_loss","question":"Have you lost weight without trying in the last few months?","kind":"yes_no","route":"same_day_clinician"},{"code":"cancer_history","question":"Have you ever been told you have or had cancer?","kind":"yes_no","route":"same_day_clinician"},{"code":"night_pain","question":"Does the pain wake you at night or is it worst when you lie still?","kind":"yes_no","route":"same_day_clinician"},{"code":"known_tb","question":"Have you been told you have TB (tuberculosis)?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"sickle_cell_bone_pain","question":"Do you have sickle cell disease and is this a bone pain?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"known_hiv","question":"Do you live with HIV?","kind":"yes_no","route":"same_day_clinician","unverified":true}],"pain_neck":[{"code":"saddle_numbness","question":"Do you have numbness or odd feelings around your genitals, buttocks or inner thighs (the saddle area)?","kind":"yes_no","route":"same_day_clinician"},{"code":"bladder_or_bowel_change","question":"Have you noticed a new change in passing urine or opening your bowels, such as leaking or not being able to go?","kind":"yes_no","route":"same_day_clinician"},{"code":"weakness_both_legs","question":"Do you have weakness in both legs?","kind":"yes_no","route":"same_day_clinician"},{"code":"progressive_deficit","question":"Is weakness or numbness getting worse over days or weeks?","kind":"yes_no","route":"same_day_clinician"},{"code":"recent_trauma","question":"Did this pain start after a fall, accident or injury?","kind":"yes_no","route":"same_day_clinician"},{"code":"fever","question":"Do you have a fever, or have you felt feverish with this pain?","kind":"yes_no","route":"same_day_clinician"},{"code":"unexplained_weight_loss","question":"Have you lost weight without trying in the last few months?","kind":"yes_no","route":"same_day_clinician"},{"code":"cancer_history","question":"Have you ever been told you have or had cancer?","kind":"yes_no","route":"same_day_clinician"},{"code":"night_pain","question":"Does the pain wake you at night or is it worst when you lie still?","kind":"yes_no","route":"same_day_clinician"},{"code":"known_tb","question":"Have you been told you have TB (tuberculosis)?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"sickle_cell_bone_pain","question":"Do you have sickle cell disease and is this a bone pain?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"known_hiv","question":"Do you live with HIV?","kind":"yes_no","route":"same_day_clinician","unverified":true}],"pain_knee":[{"code":"saddle_numbness","question":"Do you have numbness or odd feelings around your genitals, buttocks or inner thighs (the saddle area)?","kind":"yes_no","route":"same_day_clinician"},{"code":"bladder_or_bowel_change","question":"Have you noticed a new change in passing urine or opening your bowels, such as leaking or not being able to go?","kind":"yes_no","route":"same_day_clinician"},{"code":"weakness_both_legs","question":"Do you have weakness in both legs?","kind":"yes_no","route":"same_day_clinician"},{"code":"progressive_deficit","question":"Is weakness or numbness getting worse over days or weeks?","kind":"yes_no","route":"same_day_clinician"},{"code":"recent_trauma","question":"Did this pain start after a fall, accident or injury?","kind":"yes_no","route":"same_day_clinician"},{"code":"fever","question":"Do you have a fever, or have you felt feverish with this pain?","kind":"yes_no","route":"same_day_clinician"},{"code":"unexplained_weight_loss","question":"Have you lost weight without trying in the last few months?","kind":"yes_no","route":"same_day_clinician"},{"code":"cancer_history","question":"Have you ever been told you have or had cancer?","kind":"yes_no","route":"same_day_clinician"},{"code":"night_pain","question":"Does the pain wake you at night or is it worst when you lie still?","kind":"yes_no","route":"same_day_clinician"},{"code":"known_tb","question":"Have you been told you have TB (tuberculosis)?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"sickle_cell_bone_pain","question":"Do you have sickle cell disease and is this a bone pain?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"known_hiv","question":"Do you live with HIV?","kind":"yes_no","route":"same_day_clinician","unverified":true}],"pain_hip":[{"code":"saddle_numbness","question":"Do you have numbness or odd feelings around your genitals, buttocks or inner thighs (the saddle area)?","kind":"yes_no","route":"same_day_clinician"},{"code":"bladder_or_bowel_change","question":"Have you noticed a new change in passing urine or opening your bowels, such as leaking or not being able to go?","kind":"yes_no","route":"same_day_clinician"},{"code":"weakness_both_legs","question":"Do you have weakness in both legs?","kind":"yes_no","route":"same_day_clinician"},{"code":"progressive_deficit","question":"Is weakness or numbness getting worse over days or weeks?","kind":"yes_no","route":"same_day_clinician"},{"code":"recent_trauma","question":"Did this pain start after a fall, accident or injury?","kind":"yes_no","route":"same_day_clinician"},{"code":"fever","question":"Do you have a fever, or have you felt feverish with this pain?","kind":"yes_no","route":"same_day_clinician"},{"code":"unexplained_weight_loss","question":"Have you lost weight without trying in the last few months?","kind":"yes_no","route":"same_day_clinician"},{"code":"cancer_history","question":"Have you ever been told you have or had cancer?","kind":"yes_no","route":"same_day_clinician"},{"code":"night_pain","question":"Does the pain wake you at night or is it worst when you lie still?","kind":"yes_no","route":"same_day_clinician"},{"code":"known_tb","question":"Have you been told you have TB (tuberculosis)?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"sickle_cell_bone_pain","question":"Do you have sickle cell disease and is this a bone pain?","kind":"yes_no","route":"same_day_clinician","unverified":true},{"code":"known_hiv","question":"Do you live with HIV?","kind":"yes_no","route":"same_day_clinician","unverified":true}],"low_mood":[{"code":"phq9_item9","question":"PHQ-9 question 9: thoughts that you would be better off dead, or of hurting yourself (0 to 3)","kind":"score_at_least","threshold":1,"route":"crisis"},{"code":"phq9_total","question":"PHQ-9 total score (0 to 27)","kind":"score_at_least","threshold":15,"route":"medical_review_first"},{"code":"gad7_total","question":"GAD-7 total score (0 to 21)","kind":"score_at_least","threshold":15,"route":"medical_review_first"}],"stress":[{"code":"phq9_item9","question":"PHQ-9 question 9: thoughts that you would be better off dead, or of hurting yourself (0 to 3)","kind":"score_at_least","threshold":1,"route":"crisis"},{"code":"phq9_total","question":"PHQ-9 total score (0 to 27)","kind":"score_at_least","threshold":15,"route":"medical_review_first"},{"code":"gad7_total","question":"GAD-7 total score (0 to 21)","kind":"score_at_least","threshold":15,"route":"medical_review_first"}],"anxiety":[{"code":"phq9_item9","question":"PHQ-9 question 9: thoughts that you would be better off dead, or of hurting yourself (0 to 3)","kind":"score_at_least","threshold":1,"route":"crisis"},{"code":"phq9_total","question":"PHQ-9 total score (0 to 27)","kind":"score_at_least","threshold":15,"route":"medical_review_first"},{"code":"gad7_total","question":"GAD-7 total score (0 to 21)","kind":"score_at_least","threshold":15,"route":"medical_review_first"}],"pulmonary_rehab":[]}$json$::jsonb) l
  cross join lateral jsonb_array_elements(l.value) with ordinality as r(val, ord)
on conflict (programme_code, list_version, item_code) do nothing;
-- exclusion-lists-v1-end

-- programme-config-v1-begin (docs/design/S63.md; packages/shared/src/proposed-config mirrors it, a test fails on drift). DRAFT, PROPOSED.
insert into public.therapy_programme_config (version, config, notes, is_active)
values (1, $json${"reenrol_cooldown_hours":72,"route_due_minutes":{"same_day_clinician":480,"medical_review_first":2880,"worsening_review":1440},"instruments":{"panic_breathing":["panic_episodes_week"],"pelvic_floor":["leakage_episodes_week"],"ibs_hypnotherapy":["ibs_symptom_0_10"],"cbt_i":["isi"],"pain_back":["pain_nrs"],"pain_neck":["pain_nrs"],"pain_knee":["pain_nrs"],"pain_hip":["pain_nrs"],"low_mood":["phq9","gad7"],"stress":["phq9","gad7"],"anxiety":["gad7","phq9"],"pulmonary_rehab":[]},"checkpoints":{"panic_breathing":[1,3,6],"pelvic_floor":[1,4,8,12],"ibs_hypnotherapy":[1,3,6],"cbt_i":[1,3,6],"pain_back":[1,4,8],"pain_neck":[1,4,8],"pain_knee":[1,4,8],"pain_hip":[1,4,8],"low_mood":[1,3,6],"stress":[1,3,6],"anxiety":[1,3,6],"pulmonary_rehab":[]},"instrument_ranges":{"phq9":{"min":0,"max":27},"gad7":{"min":0,"max":21},"isi":{"min":0,"max":28},"pain_nrs":{"min":0,"max":10},"panic_episodes_week":{"min":0,"max":99},"leakage_episodes_week":{"min":0,"max":99},"ibs_symptom_0_10":{"min":0,"max":10}},"worsening":{"phq9":{"rise_at_least":5,"absolute_at_least":20},"gad7":{"rise_at_least":4},"isi":{"rise_at_least":4},"pain_nrs":{"rise_at_least":2},"panic_episodes_week":{"rise_at_least":3},"leakage_episodes_week":{"rise_at_least":3},"ibs_symptom_0_10":{"rise_at_least":2}},"cbt_i":{"time_in_bed_floor_minutes":330,"sleep_restriction_requires_clinician_flag":true,"default_variant":["sleep_diary","wind_down","stimulus_control"]},"pelvic_floor":{"contractions_per_set":8,"sets_per_day":3,"minimum_months":3}}$json$::jsonb,
  'DRAFT, UNSIGNED (S63, 2026-10-07). PROPOSED values. The phq9 and gad7 worsening thresholds, the CBT-I time in bed floor and the CBT-I entry and review scores are CMO decisions (Q14, Q15); every other number was chosen by the build so the engine can run and must be confirmed or replaced by the CMO. Publish a higher version to change it.', true)
on conflict (version) do nothing;
-- programme-config-v1-end

-- ---------------------------------------------------------------------------
-- 11. Self-checks
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if (select count(*) from public.therapy_programmes) <> 12 then raise exception 'FAIL: expected 12 programmes'; end if;
  if (select count(*) from public.therapy_programme_sessions) <> 24 then raise exception 'FAIL: expected 24 Wave A session rows'; end if;
  if exists (select 1 from public.therapy_programme_versions where review_state <> 'draft' or approved_by is not null) then raise exception 'FAIL: a programme version is not a draft'; end if;
  if exists (select 1 from public.therapy_exclusion_list_versions where status <> 'draft' or confirmed_by is not null) then raise exception 'FAIL: an exclusion list is not a draft'; end if;
  if exists (select 1 from public.therapy_programmes p where not exists (select 1 from public.therapy_exclusion_list_versions l where l.programme_code = p.code)) then raise exception 'FAIL: a programme has no list row'; end if;
  if (select count(*) from public.therapy_exclusion_rules where programme_code = 'pulmonary_rehab') <> 0 then raise exception 'FAIL: pulmonary rehab must have no entry list'; end if;
  if (select count(*) from public.therapy_programme_config where is_active) <> 1 then raise exception 'FAIL: one active config expected'; end if;
  if exists (select 1 from public.go_live_guards where key like 'therapy\_%\_enabled' and is_on) or (select count(*) from public.go_live_guards where key like 'therapy\_%\_enabled') <> 7 then
    raise exception 'FAIL: the seven therapy guards must exist and be off';
  end if;
  foreach t in array array['therapy_programmes', 'therapy_programme_versions', 'therapy_programme_sessions', 'therapy_exclusion_list_versions', 'therapy_exclusion_rules',
                           'therapy_programme_config', 'therapy_enrolments', 'therapy_session_progress', 'therapy_share_consents'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL: RLS is not enabled on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'FAIL: anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'FAIL: authenticated can write % directly', t;
    end if;
  end loop;
  -- no policy on the patient tables reaches staff through the organisation shape
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('therapy_enrolments', 'therapy_session_progress', 'therapy_share_consents')
              and (qual ilike '%is_org_staff%' or qual ilike '%organisation_id%')) then
    raise exception 'FAIL: a patient-scoped therapy policy admits staff or an organisation';
  end if;
  if jsonb_array_length(private.go_live_conditions('therapy_panic_breathing_enabled', null)) <> 4
     or jsonb_array_length(private.go_live_conditions('therapy_mood_enabled', null)) <> 5
     or jsonb_array_length(private.go_live_conditions('therapy_pulmonary_rehab_enabled', null)) <> 5 then
    raise exception 'FAIL: unexpected number of therapy go-live conditions';
  end if;
  if jsonb_array_length(private.go_live_conditions('symptom_checker_enabled', null)) <> 6 then raise exception 'FAIL: the symptom checker conditions were disturbed'; end if;
  if private.go_live_open('therapy_panic_breathing_enabled') then raise exception 'FAIL: a therapy guard reads open'; end if;
  foreach t in array array['enrol_in_therapy_programme', 'start_therapy_session', 'complete_therapy_session', 'read_therapy_progress_audited', 'set_therapy_progress_sharing',
                           'get_therapy_entry_questions', 'therapy_check_entry_screen', 'stop_therapy_enrolment', 'resume_therapy_enrolment',
                           'save_therapy_exclusion_list', 'confirm_therapy_exclusion_list', 'approve_therapy_programme_version'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = t
                and (has_function_privilege('anon', p.oid, 'EXECUTE'))) then raise exception 'FAIL: anon can execute %', t; end if;
  end loop;
end $$;
