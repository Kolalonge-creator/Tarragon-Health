-- S69: Module 17 community (spec 17.6 to 17.9): private cohorts, effort challenges, cohort totals and cohort-versus-cohort
-- comparison. Group audio (17.8) is schema only and dormant.
--
-- Founder decisions 2026-10-07 (binding, see docs/design/S69.md):
--   (a) rankings compare COHORTS only; a member sees their cohort's total and "goal reached", never a member rank;
--   (b) live group audio is deferred: a dormant table and a dormant platform_modules row, no room, no Zoom code;
--   (c) cohort membership is sensitive: separate withdrawable consent to join and again to contribute to totals, generic cohort
--       names, the member list is seen by members only, moderators see no health data, employers, sponsors and staff see nothing;
--   (d) effort metrics only (CMO sign-off pack A16); anyone with heart failure, kidney disease, pregnancy, insulin use or an
--       eating-disorder history only gets logging and lesson challenges, decided here in the database, never shown as a reason.
-- Invariants touched: INV-07 (the one notice is "Your group has an update", no name, metric or figure), INV-09 (no money, no
-- balance), INV-13 (is_test: a test cohort only ever holds test accounts), INV-14 (platform_modules rows off, plus a go-live guard
-- added by the next migration), INV-16 (rules and templates are versioned and signed).
--
-- Live counts before this migration: none of these tables exist; no data conversion.
-- Reused, not rebuilt: S29 token pattern (only the SHA-256 is stored, 72 hours, single use), private.module_enabled,
-- private.go_live_open_patient (S37), private.emit_domain_event (S10), private.log_audit, notifications.
-- Not reused on purpose: the floor of 5 in apps/web/src/lib/institutions/suppression.ts is for institution aggregates; a five
-- person cell group would be re-identifiable at 5, so this module has its own floor of 10 (PROPOSED, never below 10).

-- ---------------------------------------------------------------------------
-- 1. Versioned rules (PROPOSED values, Founder owner). Mirrored as community.rules in packages/shared/src/proposed-config.
-- ---------------------------------------------------------------------------
create table public.community_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index community_config_one_active on public.community_config (is_active) where is_active;

create function private.community_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text; t jsonb;
begin
  foreach k in array array['min_contributors', 'max_single_share_pct', 'round_total_to', 'publish_delay_hours', 'snapshot_every_hours',
                           'invite_ttl_hours', 'max_invites_per_day', 'max_members_per_cohort', 'max_cohorts_per_moderator',
                           'max_active_challenges', 'challenge_min_days', 'challenge_max_days', 'activity_minutes_week_cap',
                           'activity_minutes_day_max', 'board_min_cohorts', 'progress_step_pct', 'participation_keep_days'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,5}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  -- the binding founder floors: never fewer than 10 contributors, never an instant publish, never a board of fewer than 3 cohorts
  if (r ->> 'min_contributors')::integer < 10 or (r ->> 'publish_delay_hours')::integer < 1 or (r ->> 'board_min_cohorts')::integer < 3 then
    return false;
  end if;
  if (r ->> 'max_single_share_pct')::integer not between 5 and 100 or (r ->> 'progress_step_pct')::integer not between 1 and 25 then return false; end if;
  if (r ->> 'invite_ttl_hours')::integer > 720 or (r ->> 'challenge_min_days')::integer > (r ->> 'challenge_max_days')::integer then return false; end if;
  if jsonb_typeof(r -> 'blocked_name_terms') <> 'array' or jsonb_array_length(r -> 'blocked_name_terms') < 1 then return false; end if;
  for t in select * from jsonb_array_elements(r -> 'blocked_name_terms') loop
    if jsonb_typeof(t) <> 'string' or (t #>> '{}') !~ '^[a-z][a-z ]{1,29}$' then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.community_rules_valid(jsonb) from public, anon, authenticated;
alter table public.community_config add constraint community_config_rules_valid check (private.community_rules_valid(rules));

-- community-rules-begin
insert into public.community_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{
  "min_contributors": 10,
  "max_single_share_pct": 30,
  "round_total_to": 10,
  "publish_delay_hours": 12,
  "snapshot_every_hours": 6,
  "invite_ttl_hours": 72,
  "max_invites_per_day": 20,
  "max_members_per_cohort": 200,
  "max_cohorts_per_moderator": 3,
  "max_active_challenges": 2,
  "challenge_min_days": 7,
  "challenge_max_days": 60,
  "activity_minutes_week_cap": 300,
  "activity_minutes_day_max": 180,
  "board_min_cohorts": 3,
  "progress_step_pct": 5,
  "participation_keep_days": 30,
  "blocked_name_terms": ["diabet", "sugar", "hypertens", "blood pressure", "bp", "hiv", "aids", "cancer", "kidney", "renal", "dialysis",
    "heart", "stroke", "asthma", "sickle", "obes", "weight", "slim", "diet", "pregnan", "fertil", "mental", "depress", "anxiety",
    "addict", "recovery", "cholesterol", "epilep", "tb", "tubercul", "hepatitis", "patient", "sick", "disease"]
}
$json$::jsonb);
-- community-rules-end

alter table public.community_config enable row level security;
create policy community_config_read on public.community_config for select to authenticated using (true);
revoke all on public.community_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.community_config from authenticated;
grant select on public.community_config to authenticated;

create function private.community_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.community_config where is_active $$;
revoke all on function private.community_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Platform switches (both OFF) and event types
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values
  ('community_cohorts', 'Community cohorts and challenges',
   'Private cohorts (church, mosque, union, estate, workplace) with effort challenges and cohort totals (spec 17.6, 17.7, 17.9). Off until the CMO has signed the challenge templates, the DPIA is recorded and the go-live guard community_cohorts_enabled is on.'),
  ('group_sessions', 'Clinician-led live audio group sessions',
   'Live audio group sessions for programme members (spec 17.8). Deferred by the founder 2026-10-07: only the schema exists, there is no room and no Zoom code. Do not switch on.')
on conflict (key) do nothing;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('challenge.progress', 'A cohort challenge reached a milestone (goal reached, or ended). Carries ids and a milestone code only, never a figure.', 'S69', false),
  ('group_session.scheduled', 'A clinician-led group audio session was scheduled. Dormant: nothing emits it yet.', 'S69', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('challenge.progress', 1, array['challenge_id', 'cohort_id', 'kind']),
  ('group_session.scheduled', 1, array['group_session_id']);

-- ---------------------------------------------------------------------------
-- 3. Challenge templates (config, proposed, signed by the CMO). Nothing is approved here.
-- ---------------------------------------------------------------------------
create table public.challenge_templates (
  code              text primary key check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  label             text not null check (char_length(label) between 3 and 60),
  description       text not null check (char_length(description) between 3 and 200),
  metric            text not null check (metric in ('log_days', 'medicine_checkin_days', 'lessons_completed', 'activity_minutes',
                                                    'low_salt_days', 'consistent_sleep_days', 'water_with_meals_days')),
  unit              text not null check (unit in ('days', 'lessons', 'minutes')),
  default_days      integer not null check (default_days between 7 and 60),
  target_per_member integer not null check (target_per_member between 1 and 300),
  status            text not null default 'proposed' check (status in ('proposed', 'approved', 'withdrawn')),
  version           integer not null default 1 check (version >= 1),
  approved_by       uuid references public.profiles (id) on delete restrict,
  approved_at       timestamptz,
  approval_note     text,
  created_at        timestamptz not null default now(),
  -- an approved template always says who approved it and when (INV-16); nothing here can be born approved
  constraint challenge_templates_approval_attributed check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

-- community-templates-begin
insert into public.challenge_templates (code, label, description, metric, unit, default_days, target_per_member) values
  ('log_days',        'Check in with your health log', 'Days you add something to your own health log.',                  'log_days',              'days',    14, 8),
  ('medicine_days',   'Medicine check-in days',        'Days you answer your medicine check-in.',                         'medicine_checkin_days', 'days',    14, 8),
  ('lessons',         'Learn together',                'Short health lessons you finish.',                                 'lessons_completed',     'lessons', 14, 3),
  ('move_together',   'Move together',                 'Minutes of activity you do. Up to 300 minutes a week count.',      'activity_minutes',      'minutes', 7, 150),
  ('low_salt_days',   'Lower-salt days',               'Days you tell us you chose lower-salt food.',                      'low_salt_days',         'days',    14, 8),
  ('regular_sleep',   'Regular bedtime days',          'Days you tell us you kept a regular bedtime.',                     'consistent_sleep_days', 'days',    14, 8),
  ('water_with_meals','Water with meals',              'Days you tell us you drank water with meals.',                     'water_with_meals_days', 'days',    14, 8);
-- community-templates-end

alter table public.challenge_templates enable row level security;
create policy challenge_templates_read on public.challenge_templates for select to authenticated
  using (status = 'approved' or private.is_admin() or private.credential_is_cmo());
revoke all on public.challenge_templates from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.challenge_templates from authenticated;
grant select on public.challenge_templates to authenticated;

-- Only the CMO signs a template. A person's decision, never an agent's: this migration approves nothing.
create function public.sign_challenge_template(p_code text, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can sign a challenge template' using errcode = '42501'; end if;
  if p_approve is null or length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say what was reviewed, in a sentence' using errcode = '22023'; end if;
  update public.challenge_templates
     set status = case when p_approve then 'approved' else 'withdrawn' end,
         approved_by = case when p_approve then v_uid else null end,
         approved_at = case when p_approve then now() else null end,
         approval_note = btrim(p_note)
   where code = p_code;
  if not found then raise exception 'no such template' using errcode = '22023'; end if;
  perform private.log_audit('community.template_signed', 'challenge_template', null, jsonb_build_object('code', p_code, 'approved', p_approve));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
create table public.community_cohorts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 3 and 60),
  kind            text not null check (kind in ('church', 'mosque', 'union', 'estate', 'workplace')),
  state           text not null default 'active' check (state in ('active', 'closed', 'frozen')),
  created_by      uuid not null references public.profiles (id) on delete restrict,
  frozen_by       uuid references public.profiles (id) on delete set null,
  freeze_note     text,
  closed_at       timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index community_cohorts_creator_idx on public.community_cohorts (created_by, state);

create table public.cohort_members (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  cohort_id                   uuid not null references public.community_cohorts (id) on delete cascade,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  role                        text not null default 'member' check (role in ('member', 'moderator')),
  state                       text not null default 'active' check (state in ('active', 'left', 'removed')),
  -- two separate, withdrawable, explicit consents. Totals consent null = not contributing (withdrawn or never given).
  consent_join_at             timestamptz not null,
  consent_totals_at           timestamptz,
  consent_totals_withdrawn_at timestamptz,
  consent_text_version        text not null default 'draft-1',
  muted                       boolean not null default false,
  barred                      boolean not null default false,
  joined_at                   timestamptz not null default now(),
  left_at                     timestamptz,
  removed_by                  uuid references public.profiles (id) on delete set null,
  is_test                     boolean not null default false,
  unique (cohort_id, patient_id)
);
create index cohort_members_patient_idx on public.cohort_members (patient_id, state);
create index cohort_members_cohort_idx on public.cohort_members (cohort_id, state);

create table public.community_preferences (
  patient_id    uuid primary key references public.profiles (id) on delete cascade,
  community_off boolean not null default false,
  updated_at    timestamptz not null default now()
);

create table public.cohort_invites (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  cohort_id       uuid not null references public.community_cohorts (id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by      uuid not null references public.profiles (id) on delete cascade,
  state           text not null default 'pending' check (state in ('pending', 'used', 'cancelled', 'expired')),
  expires_at      timestamptz not null,
  used_by         uuid references public.profiles (id) on delete set null,
  used_at         timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (state <> 'used' or (used_by is not null and used_at is not null))
);
create index cohort_invites_cohort_idx on public.cohort_invites (cohort_id, created_at desc);

create table public.challenges (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  cohort_id         uuid not null references public.community_cohorts (id) on delete cascade,
  template_code     text not null references public.challenge_templates (code) on delete restrict,
  template_version  integer not null,
  metric            text not null check (metric in ('log_days', 'medicine_checkin_days', 'lessons_completed', 'activity_minutes',
                                                    'low_salt_days', 'consistent_sleep_days', 'water_with_meals_days')),
  target_per_member integer not null check (target_per_member between 1 and 300),
  starts_on         date not null,
  ends_on           date not null,
  created_by        uuid not null references public.profiles (id) on delete restrict,
  cancelled_at      timestamptz,
  ended_announced_at timestamptz,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index challenges_cohort_idx on public.challenges (cohort_id, starts_on desc);
create index challenges_template_idx on public.challenges (template_code, starts_on);

-- Private to the member: one row per member per day. Holds an effort count only (0 or 1 for a day metric, a minute or lesson count for
-- the others). It can never hold a weight, calorie, fasting, blood pressure or glucose value because it has no column for one.
create table public.challenge_participation (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  challenge_id    uuid not null references public.challenges (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  day             date not null,
  value           integer not null check (value between 1 and 180),
  source          text not null check (source in ('computed', 'self_report')),
  created_at      timestamptz not null default now(),
  unique (challenge_id, patient_id, day)
);
create index challenge_participation_patient_idx on public.challenge_participation (patient_id);

-- Aggregate only, append only. NO member id, no per-member figure, no contributor count (only a band). A snapshot is readable only
-- after published_after, so one entry is never visible as a jump.
create table public.challenge_totals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  challenge_id     uuid not null references public.challenges (id) on delete cascade,
  as_of            timestamptz not null default clock_timestamp(),
  published_after  timestamptz not null,
  is_final         boolean not null default false,
  suppressed       boolean not null,
  suppression_reason text check (suppression_reason in ('too_few', 'dominant_contributor')),
  total_rounded    bigint,
  progress_pct     smallint check (progress_pct between 0 and 100),
  goal_reached     boolean not null default false,
  contributor_band text check (contributor_band in ('10-19', '20-49', '50-99', '100+')),
  announced_at     timestamptz,
  check (suppressed = (suppression_reason is not null)),
  check (suppressed or (total_rounded is not null and progress_pct is not null and contributor_band is not null)),
  check (not suppressed or (total_rounded is null and progress_pct is null and contributor_band is null and not goal_reached))
);
create index challenge_totals_latest_idx on public.challenge_totals (challenge_id, published_after desc);

-- Snapshots are written once. The only column that ever changes is announced_at (the milestone notice was sent).
create function private.challenge_totals_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin
  if (to_jsonb(new) - 'announced_at') is distinct from (to_jsonb(old) - 'announced_at') then
    raise exception 'challenge_totals is append only' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.challenge_totals_append_only() from public, anon, authenticated;
create trigger challenge_totals_append_only before update on public.challenge_totals
  for each row execute function private.challenge_totals_append_only();

create table public.community_reports (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  cohort_id          uuid not null references public.community_cohorts (id) on delete cascade,
  reporter_id        uuid not null references public.profiles (id) on delete cascade,
  reported_member_id uuid references public.cohort_members (id) on delete cascade,
  reason             text not null check (reason in ('concerning_behaviour', 'unwanted_contact', 'pressure_to_share', 'something_else')),
  state              text not null default 'open' check (state in ('open', 'actioned', 'dismissed')),
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles (id) on delete set null
);
create unique index community_reports_one_open on public.community_reports (cohort_id, reporter_id, coalesce(reported_member_id, '00000000-0000-0000-0000-000000000000'::uuid)) where state = 'open';

-- 17.8 live audio sessions: schema only, dormant (founder decision 2026-10-07). No room, no recording, no scribe (INV-11), audio only.
create table public.group_sessions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  host_clinician_id uuid not null references public.profiles (id) on delete restrict,
  title             text not null check (char_length(title) between 3 and 80),
  scheduled_for     timestamptz not null,
  duration_minutes  integer not null check (duration_minutes between 15 and 90),
  capacity          integer not null check (capacity between 2 and 20),
  room_type         text not null default 'audio_only' check (room_type = 'audio_only'),
  recording_enabled boolean not null default false check (not recording_enabled),
  scribe_enabled    boolean not null default false check (not scribe_enabled),
  state             text not null default 'scheduled' check (state in ('scheduled', 'cancelled', 'done')),
  is_test           boolean not null default false,
  created_at        timestamptz not null default now()
);
create function private.group_sessions_dormant() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin
  if not private.module_enabled('group_sessions') then
    raise exception 'group sessions are not switched on' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.group_sessions_dormant() from public, anon, authenticated;
create trigger group_sessions_dormant before insert on public.group_sessions for each row execute function private.group_sessions_dormant();

-- A cohort name is generic, never about a condition: checked against the versioned term list on every insert and rename.
create function private.community_name_ok(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_name is not null
     and char_length(btrim(p_name)) between 3 and 60
     and lower(p_name) !~ ('\m(' || (select string_agg(t, '|') from jsonb_array_elements_text(private.community_rules() -> 'blocked_name_terms') t) || ')')
$$;
revoke all on function private.community_name_ok(text) from public, anon, authenticated;

create function private.community_cohort_name_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    if not private.community_name_ok(new.name) then raise exception 'cohort_name_not_allowed' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke all on function private.community_cohort_name_guard() from public, anon, authenticated;
create trigger community_cohort_name_guard before insert or update of name on public.community_cohorts
  for each row execute function private.community_cohort_name_guard();

-- ---------------------------------------------------------------------------
-- 5. Private helpers
-- ---------------------------------------------------------------------------
create function private.community_today() returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Africa/Lagos')::date $$;
revoke all on function private.community_today() from public, anon, authenticated;

-- Open for a real person only when the platform module is on AND the go-live guard is on (INV-14). A test account passes either way, so
-- the whole flow can be proved before launch on test data; a test account can only ever be in a test cohort (checked at join).
create function private.community_open(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (private.module_enabled('community_cohorts') and private.go_live_guard_on('community_cohorts_enabled'))
      or exists (select 1 from public.profiles where id = p_patient and is_test)
$$;
revoke all on function private.community_open(uuid) from public, anon, authenticated;

create function private.community_is_off(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select community_off from public.community_preferences where patient_id = p_patient), false) $$;
revoke all on function private.community_is_off(uuid) from public, anon, authenticated;

-- The signed-in adult patient. Dependants and under-18s never take part.
create function private.community_patient() returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); pr public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active
     and not coalesce(is_dependent_account, false)
     and (date_of_birth is null or date_of_birth <= (now() at time zone 'Africa/Lagos')::date - interval '18 years');
  if not found then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  return pr;
end $$;
revoke all on function private.community_patient() from public, anon, authenticated;

create function private.community_member(p_cohort uuid, p_patient uuid) returns public.cohort_members
language sql stable security definer set search_path = ''
as $$ select m.* from public.cohort_members m where m.cohort_id = p_cohort and m.patient_id = p_patient and m.state = 'active' $$;
revoke all on function private.community_member(uuid, uuid) from public, anon, authenticated;

create function private.community_is_member(p_cohort uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.cohort_members m where m.cohort_id = p_cohort and m.patient_id = (select auth.uid()) and m.state = 'active') $$;
revoke all on function private.community_is_member(uuid) from public, anon, authenticated;

-- used by RLS policies, so the signed-in role must be able to run it (it answers only "am I a member", for the caller)
grant execute on function private.community_is_member(uuid) to authenticated;

create function private.community_is_moderator(p_cohort uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.cohort_members m where m.cohort_id = p_cohort and m.patient_id = p_patient and m.state = 'active' and m.role = 'moderator') $$;
revoke all on function private.community_is_moderator(uuid, uuid) from public, anon, authenticated;

-- The effort-only rule (A16). True when the person has heart failure, kidney disease, a pregnancy, uses insulin, or has an eating-disorder
-- history. Decided here, from the record, never returned to a caller: the only thing a caller can learn is "not available for you".
create function private.community_effort_only(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_conditions c
                  where c.patient_id = p_patient and c.status not in ('resolved')
                    and (c.condition_name ~* '(heart failure|cardiac failure|kidney|renal|\mckd\M|dialysis|eating disorder|anorexi|bulimi|binge)'
                         or c.icd10_code ~* '^(I50|N17|N18|N19|F50)'))
      or exists (select 1 from public.patient_pregnancy p where p.patient_id = p_patient and p.is_pregnant)
      or exists (select 1 from public.medications m where m.patient_id = p_patient and m.is_active
                  and m.drug_name ~* '(insulin|lantus|levemir|novorapid|humalog|humulin|mixtard|glargine|detemir|aspart|lispro|degludec)')
      or exists (select 1 from public.obesity_ed_screens e where e.patient_id = p_patient and e.positive)
$$;
revoke all on function private.community_effort_only(uuid) from public, anon, authenticated;

create function private.community_metric_allowed(p_patient uuid, p_metric text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_metric in ('log_days', 'lessons_completed') or not private.community_effort_only(p_patient) $$;
revoke all on function private.community_metric_allowed(uuid, text) from public, anon, authenticated;

create function private.community_phase(p_starts date, p_ends date, p_cancelled timestamptz) returns text
language sql stable set search_path = ''
as $$ select case when p_cancelled is not null then 'cancelled'
                  when private.community_today() < p_starts then 'scheduled'
                  when private.community_today() <= p_ends then 'active' else 'ended' end $$;
revoke all on function private.community_phase(date, date, timestamptz) from public, anon, authenticated;

-- INV-07: one generic notice for every community milestone. The payload is empty, the template names no cohort, metric or figure.
create function private.community_notify(p_recipient uuid, p_org uuid, p_source_table text, p_source uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array array['in_app', 'push'] loop
    if not exists (select 1 from public.notifications n where n.recipient_id = p_recipient and n.template = 'community_update'
                      and n.channel = c::public.notification_channel and n.source_table = p_source_table and n.source_id = p_source) then
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (p_recipient, p_org, c::public.notification_channel, 'community_update', '{}'::jsonb, 'pending', 'non_clinical', 'routine'::public.notification_priority, p_source_table, p_source);
    end if;
  end loop;
end $$;
revoke all on function private.community_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Withdrawing, leaving, being removed or turning community off all remove the person's own effort rows; published aggregates stay.
create function private.community_forget_effort(p_patient uuid, p_cohort uuid default null) returns void
language sql security definer set search_path = ''
as $$
  delete from public.challenge_participation cp using public.challenges ch
   where cp.challenge_id = ch.id and cp.patient_id = p_patient and (p_cohort is null or ch.cohort_id = p_cohort)
$$;
revoke all on function private.community_forget_effort(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cohorts, invites, joining
-- ---------------------------------------------------------------------------
create function public.community_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  return jsonb_build_object('open', private.community_open(pr.id), 'off', private.community_is_off(pr.id));
end $$;

create function public.community_create(p_name text, p_kind text, p_consent_join boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles; cfg jsonb := private.community_rules(); v_id uuid;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) then raise exception 'community_closed' using errcode = 'P0001'; end if;
  if private.community_is_off(pr.id) then raise exception 'community_off' using errcode = 'P0001'; end if;
  if p_consent_join is distinct from true then raise exception 'consent_required' using errcode = 'P0001'; end if;
  if p_kind not in ('church', 'mosque', 'union', 'estate', 'workplace') then raise exception 'cohort_kind_invalid' using errcode = '22023'; end if;
  if not private.community_name_ok(p_name) then raise exception 'cohort_name_not_allowed' using errcode = '22023'; end if;
  if (select count(*) from public.community_cohorts where created_by = pr.id and state = 'active') >= (cfg ->> 'max_cohorts_per_moderator')::integer then
    raise exception 'too_many_cohorts' using errcode = 'P0001';
  end if;
  insert into public.community_cohorts (organisation_id, name, kind, created_by, is_test)
  values (pr.organisation_id, btrim(p_name), p_kind, pr.id, coalesce(pr.is_test, false)) returning id into v_id;
  insert into public.cohort_members (organisation_id, cohort_id, patient_id, role, consent_join_at, is_test)
  values (pr.organisation_id, v_id, pr.id, 'moderator', now(), coalesce(pr.is_test, false));
  return jsonb_build_object('cohort_id', v_id);
end $$;

create function public.community_create_invite(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles; cfg jsonb := private.community_rules(); co public.community_cohorts%rowtype; v_token text; v_expires timestamptz;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) then raise exception 'community_closed' using errcode = 'P0001'; end if;
  select * into co from public.community_cohorts where id = p_cohort and state = 'active';
  if not found or not private.community_is_moderator(p_cohort, pr.id) then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  if (select count(*) from public.cohort_invites where cohort_id = p_cohort and created_at > now() - interval '24 hours') >= (cfg ->> 'max_invites_per_day')::integer then
    raise exception 'invite_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.cohort_members where cohort_id = p_cohort and state = 'active') >= (cfg ->> 'max_members_per_cohort')::integer then
    raise exception 'cohort_full' using errcode = 'P0001';
  end if;
  v_token := replace(replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  v_expires := now() + make_interval(hours => (cfg ->> 'invite_ttl_hours')::integer);
  insert into public.cohort_invites (organisation_id, cohort_id, token_hash, created_by, expires_at, is_test)
  values (co.organisation_id, p_cohort, private.circle_hash(v_token), pr.id, v_expires, co.is_test);
  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end $$;

-- One lookup for preview and join. Returns null for every failure (unknown, used, expired, closed cohort, wrong test flag, community off).
create function private.community_invite_for_caller(p_token text) returns public.cohort_invites
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles; i public.cohort_invites%rowtype; co public.community_cohorts%rowtype;
begin
  pr := private.community_patient();
  if p_token is null or char_length(p_token) not between 20 and 100 then return null; end if;
  if not private.community_open(pr.id) or private.community_is_off(pr.id) then return null; end if;
  select * into i from public.cohort_invites where token_hash = private.circle_hash(p_token) and state = 'pending' and expires_at > now() for update;
  if not found then return null; end if;
  select * into co from public.community_cohorts where id = i.cohort_id and state = 'active';
  if not found or co.is_test is distinct from coalesce(pr.is_test, false) then return null; end if;
  if exists (select 1 from public.cohort_members m where m.cohort_id = i.cohort_id and m.patient_id = pr.id and (m.state = 'active' or m.barred)) then return null; end if;
  if (select count(*) from public.cohort_members where cohort_id = i.cohort_id and state = 'active') >= (private.community_rules() ->> 'max_members_per_cohort')::integer then return null; end if;
  return i;
end $$;
revoke all on function private.community_invite_for_caller(text) from public, anon, authenticated;

create function public.community_preview_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare i public.cohort_invites; co public.community_cohorts%rowtype;
begin
  i := private.community_invite_for_caller(p_token);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  select * into co from public.community_cohorts where id = i.cohort_id;
  return jsonb_build_object('ok', true, 'name', co.name, 'kind', co.kind);
end $$;

create function public.community_join(p_token text, p_consent_join boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare i public.cohort_invites; pr public.profiles; v_member uuid;
begin
  pr := private.community_patient();
  if p_consent_join is distinct from true then return jsonb_build_object('ok', false); end if;
  i := private.community_invite_for_caller(p_token);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  insert into public.cohort_members (organisation_id, cohort_id, patient_id, role, consent_join_at, is_test)
  values (pr.organisation_id, i.cohort_id, pr.id, 'member', now(), coalesce(pr.is_test, false))
  on conflict (cohort_id, patient_id) do update
     set state = 'active', role = 'member', consent_join_at = now(), consent_totals_at = null, consent_totals_withdrawn_at = null,
         muted = false, left_at = null, removed_by = null, joined_at = now()
  returning id into v_member;
  update public.cohort_invites set state = 'used', used_by = pr.id, used_at = now() where id = i.id;
  return jsonb_build_object('ok', true, 'cohort_id', i.cohort_id);
end $$;

-- ---------------------------------------------------------------------------
-- 7. What a member sees (no health data anywhere in these answers)
-- ---------------------------------------------------------------------------
create function public.community_my_cohorts() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) then return jsonb_build_object('open', false, 'off', private.community_is_off(pr.id), 'cohorts', '[]'::jsonb); end if;
  return jsonb_build_object('open', true, 'off', private.community_is_off(pr.id), 'cohorts', coalesce((
    select jsonb_agg(jsonb_build_object('cohort_id', c.id, 'name', c.name, 'kind', c.kind, 'state', c.state, 'is_moderator', m.role = 'moderator',
                                        'muted', m.muted, 'contributing', m.consent_totals_at is not null) order by c.name)
      from public.cohort_members m join public.community_cohorts c on c.id = m.cohort_id
     where m.patient_id = pr.id and m.state = 'active'), '[]'::jsonb));
end $$;

-- The member list: first names and roles only, to members of that cohort. A moderator sees the same list, nothing more.
create function public.community_roster(p_cohort uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) or private.community_member(p_cohort, pr.id) is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'first_name', coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'Member'),
                                                         'role', m.role, 'is_you', m.patient_id = pr.id) order by coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'Member'), m.id)
                     from public.cohort_members m join public.profiles p on p.id = m.patient_id
                    where m.cohort_id = p_cohort and m.state = 'active'), '[]'::jsonb);
end $$;

create function public.community_leave(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.cohort_members%rowtype;
begin
  if v_uid is null then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  -- leaving always works, even with the platform switch off
  update public.cohort_members set state = 'left', left_at = now(), consent_totals_at = null, consent_totals_withdrawn_at = coalesce(consent_totals_withdrawn_at, now())
   where cohort_id = p_cohort and patient_id = v_uid and state = 'active' returning * into m;
  if not found then return jsonb_build_object('ok', false); end if;
  perform private.community_forget_effort(v_uid, p_cohort);
  -- a cohort with no moderator left is closed (no stranger is promoted into moderator powers)
  if not exists (select 1 from public.cohort_members where cohort_id = p_cohort and state = 'active' and role = 'moderator') then
    update public.community_cohorts set state = 'closed', closed_at = now() where id = p_cohort and state <> 'closed';
    update public.challenges set cancelled_at = now() where cohort_id = p_cohort and cancelled_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.community_set_muted(p_cohort uuid, p_muted boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_muted is null then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  update public.cohort_members set muted = p_muted where cohort_id = p_cohort and patient_id = v_uid and state = 'active';
  return jsonb_build_object('ok', found);
end $$;

create function public.community_set_totals_consent(p_cohort uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles; co public.community_cohorts%rowtype;
begin
  pr := private.community_patient();
  if p_on is null then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  if p_on then
    select * into co from public.community_cohorts where id = p_cohort and state = 'active';
    if not found or private.community_member(p_cohort, pr.id) is null or not private.community_open(pr.id) or private.community_is_off(pr.id) then
      return jsonb_build_object('ok', false);
    end if;
    update public.cohort_members set consent_totals_at = now(), consent_totals_withdrawn_at = null where cohort_id = p_cohort and patient_id = pr.id;
  else
    -- withdrawing is never blocked by the switch or the cohort state
    update public.cohort_members set consent_totals_at = null, consent_totals_withdrawn_at = now() where cohort_id = p_cohort and patient_id = pr.id and state = 'active';
    perform private.community_forget_effort(pr.id, p_cohort);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.set_community_off(p_off boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_off is null then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  insert into public.community_preferences (patient_id, community_off, updated_at) values (v_uid, p_off, now())
  on conflict (patient_id) do update set community_off = excluded.community_off, updated_at = now();
  if p_off then
    update public.cohort_members set consent_totals_at = null, consent_totals_withdrawn_at = now() where patient_id = v_uid and state = 'active' and consent_totals_at is not null;
    perform private.community_forget_effort(v_uid);
  end if;
  return jsonb_build_object('ok', true, 'off', p_off);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Moderation: report-and-remove, moderator tools, platform freeze. No free text anywhere.
-- ---------------------------------------------------------------------------
create function public.community_report(p_cohort uuid, p_member uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); me public.cohort_members%rowtype; tgt public.cohort_members%rowtype; co public.community_cohorts%rowtype;
begin
  if v_uid is null then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  me := private.community_member(p_cohort, v_uid);
  if me.id is null then return jsonb_build_object('ok', false); end if;
  if p_reason not in ('concerning_behaviour', 'unwanted_contact', 'pressure_to_share', 'something_else') then raise exception 'report_reason_invalid' using errcode = '22023'; end if;
  if p_member is not null then
    select * into tgt from public.cohort_members where id = p_member and cohort_id = p_cohort and state = 'active';
    if not found or tgt.patient_id = v_uid then return jsonb_build_object('ok', false); end if;
  end if;
  select * into co from public.community_cohorts where id = p_cohort;
  insert into public.community_reports (organisation_id, cohort_id, reporter_id, reported_member_id, reason, is_test)
  values (co.organisation_id, p_cohort, v_uid, p_member, p_reason, co.is_test) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- A moderator sees reports about members (never about themselves, never who reported).
create function public.community_moderator_reports(p_cohort uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  if not private.community_is_moderator(p_cohort, pr.id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('report_id', r.id, 'member_id', r.reported_member_id, 'reason', r.reason, 'created_on', r.created_at::date) order by r.created_at)
                     from public.community_reports r join public.cohort_members t on t.id = r.reported_member_id
                    where r.cohort_id = p_cohort and r.state = 'open' and t.patient_id <> pr.id), '[]'::jsonb);
end $$;

create function private.community_remove(p_member uuid, p_by uuid, p_bar boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.cohort_members%rowtype;
begin
  update public.cohort_members set state = 'removed', left_at = now(), removed_by = p_by, barred = barred or p_bar,
         consent_totals_at = null, consent_totals_withdrawn_at = coalesce(consent_totals_withdrawn_at, now())
   where id = p_member and state = 'active' returning * into t;
  if not found then return; end if;
  perform private.community_forget_effort(t.patient_id, t.cohort_id);
  update public.community_reports set state = 'actioned', resolved_at = now(), resolved_by = p_by where reported_member_id = p_member and state = 'open';
end $$;
revoke all on function private.community_remove(uuid, uuid, boolean) from public, anon, authenticated;

create function public.community_remove_member(p_cohort uuid, p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles; t public.cohort_members%rowtype;
begin
  pr := private.community_patient();
  if not private.community_is_moderator(p_cohort, pr.id) then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  select * into t from public.cohort_members where id = p_member and cohort_id = p_cohort and state = 'active';
  if not found or t.patient_id = pr.id or t.role = 'moderator' then return jsonb_build_object('ok', false); end if;
  perform private.community_remove(p_member, pr.id, false);
  perform private.log_audit('community.member_removed', 'community_cohort', p_cohort, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create function public.community_close(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  if not private.community_is_moderator(p_cohort, pr.id) then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  update public.community_cohorts set state = 'closed', closed_at = now() where id = p_cohort and state <> 'closed';
  update public.challenges set cancelled_at = now() where cohort_id = p_cohort and cancelled_at is null;
  delete from public.challenge_participation cp using public.challenges ch where cp.challenge_id = ch.id and ch.cohort_id = p_cohort;
  update public.cohort_invites set state = 'cancelled' where cohort_id = p_cohort and state = 'pending';
  perform private.log_audit('community.cohort_closed', 'community_cohort', p_cohort, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_community_freeze(p_cohort uuid, p_frozen boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_admin() then raise exception 'only an admin can freeze a cohort' using errcode = '42501'; end if;
  if p_frozen is null or length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'say why, in a few words' using errcode = '22023'; end if;
  update public.community_cohorts
     set state = case when p_frozen then 'frozen' else 'active' end, frozen_by = case when p_frozen then v_uid else null end,
         freeze_note = case when p_frozen then btrim(p_note) else null end
   where id = p_cohort and state in ('active', 'frozen');
  if not found then return jsonb_build_object('ok', false); end if;
  perform private.log_audit('community.cohort_frozen', 'community_cohort', p_cohort, jsonb_build_object('frozen', p_frozen));
  return jsonb_build_object('ok', true);
end $$;

-- Admin queue: report, cohort name and reason. No member list, no health data exists in this module to show.
create function public.admin_community_reports() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'only an admin can read this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('report_id', r.id, 'cohort_id', r.cohort_id, 'cohort_name', c.name, 'about_a_member', r.reported_member_id is not null,
                                                         'reason', r.reason, 'created_on', r.created_at::date, 'is_test', r.is_test) order by r.created_at)
                     from public.community_reports r join public.community_cohorts c on c.id = r.cohort_id where r.state = 'open'), '[]'::jsonb);
end $$;

create function public.admin_community_resolve_report(p_report uuid, p_action text, p_bar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r public.community_reports%rowtype;
begin
  if v_uid is null or not private.is_admin() then raise exception 'only an admin can resolve a report' using errcode = '42501'; end if;
  select * into r from public.community_reports where id = p_report and state = 'open';
  if not found then return jsonb_build_object('ok', false); end if;
  if p_action = 'dismiss' then
    update public.community_reports set state = 'dismissed', resolved_at = now(), resolved_by = v_uid where id = p_report;
  elsif p_action = 'remove_member' and r.reported_member_id is not null then
    perform private.community_remove(r.reported_member_id, v_uid, coalesce(p_bar, false));
    update public.community_reports set state = 'actioned', resolved_at = now(), resolved_by = v_uid where id = p_report;
  else
    raise exception 'action_invalid' using errcode = '22023';
  end if;
  perform private.log_audit('community.report_resolved', 'community_cohort', r.cohort_id, jsonb_build_object('action', p_action));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Challenges
-- ---------------------------------------------------------------------------
create function public.list_challenge_templates() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) then return '[]'::jsonb; end if;
  -- approved only; nothing is approved until the CMO signs it
  return coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'description', description, 'unit', unit,
                                                         'default_days', default_days, 'target_per_member', target_per_member) order by label)
                     from public.challenge_templates where status = 'approved'), '[]'::jsonb);
end $$;

create function public.community_start_challenge(p_cohort uuid, p_template text, p_starts_on date, p_days integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles; cfg jsonb := private.community_rules(); t public.challenge_templates%rowtype; co public.community_cohorts%rowtype; v_id uuid;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) then raise exception 'community_closed' using errcode = 'P0001'; end if;
  select * into co from public.community_cohorts where id = p_cohort and state = 'active';
  if not found or not private.community_is_moderator(p_cohort, pr.id) then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  select * into t from public.challenge_templates where code = p_template and status = 'approved';
  if not found then raise exception 'template_not_approved' using errcode = 'P0001'; end if;
  if p_starts_on is null or p_starts_on < private.community_today() or p_starts_on > private.community_today() + 30 then raise exception 'challenge_dates_invalid' using errcode = '22023'; end if;
  if p_days is null or p_days not between (cfg ->> 'challenge_min_days')::integer and (cfg ->> 'challenge_max_days')::integer then raise exception 'challenge_dates_invalid' using errcode = '22023'; end if;
  if (select count(*) from public.challenges where cohort_id = p_cohort and cancelled_at is null and ends_on >= private.community_today()) >= (cfg ->> 'max_active_challenges')::integer then
    raise exception 'too_many_challenges' using errcode = 'P0001';
  end if;
  insert into public.challenges (organisation_id, cohort_id, template_code, template_version, metric, target_per_member, starts_on, ends_on, created_by, is_test)
  values (co.organisation_id, p_cohort, t.code, t.version, t.metric, t.target_per_member, p_starts_on, p_starts_on + p_days - 1, pr.id, co.is_test) returning id into v_id;
  return jsonb_build_object('challenge_id', v_id);
end $$;

-- The challenge view. A CLOSED key set: label, dates, phase, one availability flag, and the cohort's own published total. There is no
-- field for any person's figure, so no view built on this function can show one.
create function private.community_challenge_view(p_challenge public.challenges, p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare t public.challenge_templates%rowtype; s public.challenge_totals%rowtype; m public.cohort_members%rowtype;
begin
  select * into t from public.challenge_templates where code = p_challenge.template_code;
  m := private.community_member(p_challenge.cohort_id, p_patient);
  select * into s from public.challenge_totals where challenge_id = p_challenge.id and published_after <= now() order by published_after desc, as_of desc limit 1;
  return jsonb_build_object(
    'challenge_id', p_challenge.id, 'label', t.label, 'unit', t.unit, 'starts_on', p_challenge.starts_on, 'ends_on', p_challenge.ends_on,
    'phase', private.community_phase(p_challenge.starts_on, p_challenge.ends_on, p_challenge.cancelled_at),
    'available', private.community_metric_allowed(p_patient, p_challenge.metric),
    'contributing', m.consent_totals_at is not null,
    'total', case when s.id is null then jsonb_build_object('state', 'pending')
                  when s.suppressed then jsonb_build_object('state', 'hidden')
                  else jsonb_build_object('state', 'shown', 'total', s.total_rounded, 'progress_pct', s.progress_pct, 'goal_reached', s.goal_reached,
                                          'group_size', s.contributor_band, 'as_of', s.published_after::date, 'final', s.is_final) end);
end $$;
revoke all on function private.community_challenge_view(public.challenges, uuid) from public, anon, authenticated;

create function public.community_challenges(p_cohort uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.community_patient();
  if not private.community_open(pr.id) or private.community_member(p_cohort, pr.id) is null then return '[]'::jsonb; end if;
  if (select state from public.community_cohorts where id = p_cohort) <> 'active' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(private.community_challenge_view(ch, pr.id) order by ch.starts_on desc)
                     from public.challenges ch where ch.cohort_id = p_cohort and ch.cancelled_at is null), '[]'::jsonb);
end $$;

-- Add today's effort. The client never sends a value for a logged metric: the database counts the member's own log days, check-ins and
-- finished lessons itself. A self-reported day is "I did it" (1), or minutes for activity, capped at the WHO weekly range.
create function public.contribute_to_challenge(p_challenge uuid, p_day date default null, p_minutes integer default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles; ch public.challenges%rowtype; co public.community_cohorts%rowtype; m public.cohort_members%rowtype; cfg jsonb := private.community_rules();
  v_from date; v_to date; v_day date; v_val integer; v_week_used integer;
begin
  pr := private.community_patient();
  select * into ch from public.challenges where id = p_challenge and cancelled_at is null;
  if not found or not private.community_open(pr.id) then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  select * into co from public.community_cohorts where id = ch.cohort_id;
  m := private.community_member(ch.cohort_id, pr.id);
  -- one neutral answer for: not in the cohort, frozen or closed, challenge not running, or the effort-only rule (never says which)
  if m.id is null or co.state <> 'active' or private.community_phase(ch.starts_on, ch.ends_on, ch.cancelled_at) <> 'active'
     or not private.community_metric_allowed(pr.id, ch.metric) or private.community_is_off(pr.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if m.consent_totals_at is null then return jsonb_build_object('ok', false, 'reason', 'consent_needed'); end if;
  v_from := ch.starts_on; v_to := least(ch.ends_on, private.community_today());

  if ch.metric = 'log_days' then
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    select pr.organisation_id, ch.id, pr.id, d, 1, 'computed' from (
      select (v.taken_at at time zone 'Africa/Lagos')::date d from public.vitals_readings v where v.patient_id = pr.id
        and (v.taken_at at time zone 'Africa/Lagos')::date between v_from and v_to
      union select (n.logged_at at time zone 'Africa/Lagos')::date from public.nutrition_log_entries n where n.patient_id = pr.id
        and (n.logged_at at time zone 'Africa/Lagos')::date between v_from and v_to) x
    on conflict (challenge_id, patient_id, day) do nothing;
  elsif ch.metric = 'medicine_checkin_days' then
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    select pr.organisation_id, ch.id, pr.id, d, 1, 'computed' from (
      select distinct (a.responded_at at time zone 'Africa/Lagos')::date d from public.medication_adherence_checkins a
       where a.patient_id = pr.id and a.status = 'responded' and (a.responded_at at time zone 'Africa/Lagos')::date between v_from and v_to) x
    on conflict (challenge_id, patient_id, day) do nothing;
  elsif ch.metric = 'lessons_completed' then
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    select pr.organisation_id, ch.id, pr.id, (e.updated_at at time zone 'Africa/Lagos')::date, least(count(*), 5)::integer, 'computed'
      from public.health_education_progress e
     where e.patient_id = pr.id and e.status = 'understood' and (e.updated_at at time zone 'Africa/Lagos')::date between v_from and v_to
     group by (e.updated_at at time zone 'Africa/Lagos')::date
    on conflict (challenge_id, patient_id, day) do update set value = excluded.value;
  else
    -- self-reported: today or yesterday only, one row a day
    v_day := coalesce(p_day, private.community_today());
    if v_day < private.community_today() - 1 or v_day > private.community_today() or v_day < ch.starts_on or v_day > ch.ends_on then
      return jsonb_build_object('ok', false, 'reason', 'not_available');
    end if;
    if ch.metric = 'activity_minutes' then
      if p_minutes is null or p_minutes < 1 or p_minutes > (cfg ->> 'activity_minutes_day_max')::integer then raise exception 'minutes_invalid' using errcode = '22023'; end if;
      select coalesce(sum(value), 0) into v_week_used from public.challenge_participation
       where challenge_id = ch.id and patient_id = pr.id and day <> v_day and date_trunc('week', day::timestamp) = date_trunc('week', v_day::timestamp);
      v_val := least(p_minutes, greatest((cfg ->> 'activity_minutes_week_cap')::integer - v_week_used, 0));
      if v_val < 1 then return jsonb_build_object('ok', true, 'capped', true); end if;
    else
      v_val := 1;
    end if;
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    values (pr.organisation_id, ch.id, pr.id, v_day, v_val, 'self_report')
    on conflict (challenge_id, patient_id, day) do update set value = excluded.value;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Own status, booleans only.
create function public.my_challenge_status(p_challenge uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles; ch public.challenges%rowtype; m public.cohort_members%rowtype;
begin
  pr := private.community_patient();
  select * into ch from public.challenges where id = p_challenge and cancelled_at is null;
  if not found then return jsonb_build_object('available', false); end if;
  m := private.community_member(ch.cohort_id, pr.id);
  if m.id is null then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available', private.community_metric_allowed(pr.id, ch.metric), 'contributing', m.consent_totals_at is not null,
    'did_today', exists (select 1 from public.challenge_participation where challenge_id = p_challenge and patient_id = pr.id and day = private.community_today()));
end $$;

-- ---------------------------------------------------------------------------
-- 10. challenge-aggregate: totals only, a floor of 10 contributors, leave-one-out, rounding, a delay, and cohort-to-cohort comparison
-- ---------------------------------------------------------------------------
create function private.challenge_aggregate(p_challenge uuid, p_final boolean) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := private.community_rules(); ch public.challenges%rowtype;
  v_n integer; v_total bigint; v_max bigint; v_reason text; v_pct integer; v_step integer := (cfg ->> 'progress_step_pct')::integer;
  v_round integer := (cfg ->> 'round_total_to')::integer; v_id uuid; v_band text; v_goal boolean;
begin
  select * into ch from public.challenges where id = p_challenge;
  -- contributors: active members who consent to totals, have not turned community off, and have at least one effort row
  select count(*), coalesce(sum(s), 0), coalesce(max(s), 0) into v_n, v_total, v_max from (
    select sum(cp.value)::bigint s
      from public.challenge_participation cp
      join public.cohort_members m on m.cohort_id = ch.cohort_id and m.patient_id = cp.patient_id and m.state = 'active' and m.consent_totals_at is not null
     where cp.challenge_id = p_challenge and not private.community_is_off(cp.patient_id)
     group by cp.patient_id) per_member;
  if v_n < (cfg ->> 'min_contributors')::integer then v_reason := 'too_few';
  -- leave-one-out: if removing the biggest contributor would move the total by more than the allowed share, it is hidden
  elsif v_max * 100 > v_total * (cfg ->> 'max_single_share_pct')::integer then v_reason := 'dominant_contributor';
  end if;
  if v_reason is null then
    v_pct := least(100, (floor((100.0 * v_total / (ch.target_per_member * v_n)) / v_step) * v_step)::integer);
    v_goal := (100.0 * v_total / (ch.target_per_member * v_n)) >= 100;
    v_band := case when v_n < 20 then '10-19' when v_n < 50 then '20-49' when v_n < 100 then '50-99' else '100+' end;
  end if;
  insert into public.challenge_totals (organisation_id, challenge_id, published_after, is_final, suppressed, suppression_reason, total_rounded, progress_pct, goal_reached, contributor_band)
  values (ch.organisation_id, p_challenge, clock_timestamp() + make_interval(hours => (cfg ->> 'publish_delay_hours')::integer), p_final, v_reason is not null, v_reason,
          case when v_reason is null then (round(v_total::numeric / v_round) * v_round)::bigint end,
          case when v_reason is null then v_pct end, coalesce(v_goal, false), v_band)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.challenge_aggregate(uuid, boolean) from public, anon, authenticated;

-- The scheduled run. Real cohorts only while the module is on; test cohorts always (so the flow is provable before launch).
create function private.community_run() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := private.community_rules(); ch public.challenges%rowtype; s public.challenge_totals%rowtype; v_made integer := 0; v_announced integer := 0; v_purged integer; v_phase text; v_member record;
  v_on boolean := private.module_enabled('community_cohorts');
begin
  -- 1. snapshots: one every snapshot_every_hours while a challenge runs, and exactly one final one after it ends
  for ch in select h.* from public.challenges h join public.community_cohorts c on c.id = h.cohort_id
             where h.cancelled_at is null and c.state = 'active' and (c.is_test or v_on)
               and h.starts_on <= private.community_today() and h.ends_on >= private.community_today() - 3 loop
    v_phase := private.community_phase(ch.starts_on, ch.ends_on, ch.cancelled_at);
    if v_phase = 'active' then
      if not exists (select 1 from public.challenge_totals where challenge_id = ch.id and as_of > now() - make_interval(hours => (cfg ->> 'snapshot_every_hours')::integer)) then
        perform private.challenge_aggregate(ch.id, false); v_made := v_made + 1;
      end if;
    elsif v_phase = 'ended' and not exists (select 1 from public.challenge_totals where challenge_id = ch.id and is_final) then
      perform private.challenge_aggregate(ch.id, true); v_made := v_made + 1;
    end if;
  end loop;

  -- 2. announce milestones only once their snapshot is PUBLISHED, so a notice never arrives before the figure it is about
  for s in select t.* from public.challenge_totals t where t.announced_at is null and t.published_after <= now() and (t.goal_reached or t.is_final) loop
    select * into ch from public.challenges where id = s.challenge_id;
    if s.goal_reached and not exists (select 1 from public.challenge_totals e where e.challenge_id = s.challenge_id and e.goal_reached and e.announced_at is not null) then
      perform private.emit_domain_event('challenge.progress', ch.organisation_id,
        jsonb_build_object('challenge_id', ch.id, 'cohort_id', ch.cohort_id, 'kind', 'goal_reached'), 'challenge.progress:' || s.id,
        case when ch.is_test then ch.created_by end, 'challenge', ch.id);
      for v_member in select m.patient_id, m.organisation_id from public.cohort_members m
                       where m.cohort_id = ch.cohort_id and m.state = 'active' and not m.muted and not private.community_is_off(m.patient_id) loop
        perform private.community_notify(v_member.patient_id, v_member.organisation_id, 'challenge_totals', s.id);
      end loop;
      v_announced := v_announced + 1;
    end if;
    if s.is_final and ch.ended_announced_at is null then
      perform private.emit_domain_event('challenge.progress', ch.organisation_id,
        jsonb_build_object('challenge_id', ch.id, 'cohort_id', ch.cohort_id, 'kind', 'ended'), 'challenge.progress:ended:' || ch.id,
        case when ch.is_test then ch.created_by end, 'challenge', ch.id);
      for v_member in select m.patient_id, m.organisation_id from public.cohort_members m
                       where m.cohort_id = ch.cohort_id and m.state = 'active' and not m.muted and not private.community_is_off(m.patient_id) loop
        perform private.community_notify(v_member.patient_id, v_member.organisation_id, 'challenges', ch.id);
      end loop;
      update public.challenges set ended_announced_at = now() where id = ch.id;
      v_announced := v_announced + 1;
    end if;
    update public.challenge_totals set announced_at = now() where id = s.id;
  end loop;

  -- 3. retention: a member's own effort rows are kept only a short while after a challenge ends
  delete from public.challenge_participation cp using public.challenges h
   where cp.challenge_id = h.id and h.ends_on < private.community_today() - (cfg ->> 'participation_keep_days')::integer;
  get diagnostics v_purged = row_count;
  return jsonb_build_object('snapshots', v_made, 'announced', v_announced, 'purged', v_purged);
end $$;
revoke all on function private.community_run() from public, anon, authenticated;

-- Cohort against cohort. Anonymised labels, ranked by percent of goal (so size does not decide it), only cohorts whose own total is shown,
-- and only when enough cohorts take part. A member never sees who the other cohorts are, and never a member rank.
create function public.community_board(p_challenge uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles; ch public.challenges%rowtype; cfg jsonb := private.community_rules(); v_rows jsonb;
begin
  pr := private.community_patient();
  select * into ch from public.challenges where id = p_challenge and cancelled_at is null;
  if not found or not private.community_open(pr.id) or private.community_member(ch.cohort_id, pr.id) is null then return jsonb_build_object('state', 'hidden'); end if;
  with latest as (
    select distinct on (h.id) h.id as challenge_id, h.cohort_id, s.progress_pct, s.suppressed
      from public.challenges h
      join public.community_cohorts c on c.id = h.cohort_id and c.state = 'active' and c.is_test = ch.is_test
      join public.challenge_totals s on s.challenge_id = h.id and s.published_after <= now()
     where h.template_code = ch.template_code and h.cancelled_at is null and h.starts_on <= ch.ends_on and h.ends_on >= ch.starts_on
     order by h.id, s.published_after desc, s.as_of desc),
  shown as (select challenge_id, cohort_id, progress_pct from latest where not suppressed),
  ranked as (select challenge_id, progress_pct, dense_rank() over (order by progress_pct desc) rk, challenge_id = ch.id as mine from shown)
  select jsonb_agg(jsonb_build_object('label', case when mine then 'Your group' else 'Group ' || rk end, 'rank', rk, 'progress_pct', progress_pct, 'is_yours', mine)
                   order by rk, mine desc)
    into v_rows from ranked;
  if v_rows is null or jsonb_array_length(v_rows) < (cfg ->> 'board_min_cohorts')::integer
     or not exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'is_yours')::boolean) then
    return jsonb_build_object('state', 'not_ready');
  end if;
  return jsonb_build_object('state', 'shown', 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------------------
-- 11. RLS and grants. Writes happen only inside the functions above.
-- ---------------------------------------------------------------------------
alter table public.community_cohorts enable row level security;
alter table public.cohort_members enable row level security;
alter table public.community_preferences enable row level security;
alter table public.cohort_invites enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_participation enable row level security;
alter table public.challenge_totals enable row level security;
alter table public.community_reports enable row level security;
alter table public.group_sessions enable row level security;

-- a member (and so a moderator) reads their own cohorts, the cohort's challenges and its PUBLISHED totals; an admin can see cohort rows
create policy community_cohorts_read on public.community_cohorts for select to authenticated
  using (private.community_is_member(id) or private.is_admin());
create policy cohort_members_own on public.cohort_members for select to authenticated using (patient_id = (select auth.uid()));
create policy community_preferences_own on public.community_preferences for select to authenticated using (patient_id = (select auth.uid()));
create policy challenges_member_read on public.challenges for select to authenticated using (private.community_is_member(cohort_id));
create policy challenge_participation_own on public.challenge_participation for select to authenticated using (patient_id = (select auth.uid()));
create policy challenge_totals_published on public.challenge_totals for select to authenticated
  using (published_after <= now() and private.community_is_member((select h.cohort_id from public.challenges h where h.id = challenge_id)));
-- invites (hash only), reports and group sessions have no policy and no grant: reached only through the functions

revoke all on public.community_cohorts, public.cohort_members, public.community_preferences, public.cohort_invites, public.challenges,
  public.challenge_participation, public.challenge_totals, public.community_reports, public.group_sessions from public, anon, authenticated;
grant select on public.community_cohorts, public.cohort_members, public.community_preferences, public.challenges,
  public.challenge_participation, public.challenge_totals to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.sign_challenge_template(text,boolean,text)', 'public.community_status()', 'public.community_create(text,text,boolean)',
    'public.community_create_invite(uuid)', 'public.community_preview_invite(text)', 'public.community_join(text,boolean)', 'public.community_my_cohorts()',
    'public.community_roster(uuid)', 'public.community_leave(uuid)', 'public.community_set_muted(uuid,boolean)', 'public.community_set_totals_consent(uuid,boolean)',
    'public.set_community_off(boolean)', 'public.community_report(uuid,uuid,text)', 'public.community_moderator_reports(uuid)', 'public.community_remove_member(uuid,uuid)',
    'public.community_close(uuid)', 'public.admin_community_freeze(uuid,boolean,text)', 'public.admin_community_reports()',
    'public.admin_community_resolve_report(uuid,text,boolean)', 'public.list_challenge_templates()', 'public.community_start_challenge(uuid,text,date,integer)',
    'public.community_challenges(uuid)', 'public.contribute_to_challenge(uuid,date,integer)', 'public.my_challenge_status(uuid)', 'public.community_board(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- the daily and hourly work (pg_cron is absent on some local stacks; the guard keeps a fresh replay working)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'community-challenge-aggregate';
    perform cron.schedule('community-challenge-aggregate', '23 * * * *', $c$select private.community_run()$c$);
  end if;
end $$;

-- The migration proves what it claims.
do $$
declare f text; v_n integer;
begin
  foreach f in array array['public.community_create(text,text,boolean)', 'public.community_join(text,boolean)', 'public.community_board(uuid)', 'public.contribute_to_challenge(uuid,date,integer)',
                           'public.admin_community_freeze(uuid,boolean,text)', 'public.sign_challenge_template(text,boolean,text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.challenge_participation', 'SELECT') or has_table_privilege('anon', 'public.challenge_totals', 'SELECT')
     or has_table_privilege('anon', 'public.cohort_members', 'SELECT') or has_table_privilege('anon', 'public.cohort_invites', 'SELECT') then
    raise exception 'anon can read a community table';
  end if;
  if has_table_privilege('authenticated', 'public.cohort_invites', 'SELECT') or has_table_privilege('authenticated', 'public.community_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.group_sessions', 'SELECT') then
    raise exception 'authenticated can read a hidden community table';
  end if;
  if has_table_privilege('authenticated', 'public.challenge_participation', 'INSERT') or has_table_privilege('authenticated', 'public.challenge_totals', 'INSERT') then
    raise exception 'authenticated can write a community table directly';
  end if;
  -- the totals table carries no member id by construction
  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name = 'challenge_totals'
     and column_name in ('patient_id', 'member_id', 'profile_id', 'user_id', 'cohort_member_id');
  if v_n > 0 then raise exception 'challenge_totals carries a member id'; end if;
  if (select count(*) from public.platform_modules where key in ('community_cohorts', 'group_sessions') and not is_enabled) <> 2 then raise exception 'a community module is not off'; end if;
  if exists (select 1 from public.challenge_templates where status <> 'proposed') then raise exception 'a template was born approved'; end if;
end $$;
