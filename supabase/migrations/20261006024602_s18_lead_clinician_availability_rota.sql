-- S18: lead clinician assignment, declared availability, on-call rota and conflicts of interest (spec 7.2, 7.5, 7.1 tail).
--
-- Invariants touched: INV-05 (the rota is what S19 pages from), INV-07 (every notice here is neutral: no condition,
-- reading or result), INV-10 and INV-12 (a lead change updates care_team_assignment in the same transaction, so the old
-- lead loses chart access at once), INV-13 (is_test; test patients never use up real capacity), INV-14 (nothing here
-- switches a clinical feature on; capacity and cover are exposed as read functions for S25/S37), INV-16 (each lead
-- assignment records the lead_config version it used).
--
-- Built on top of S17 (migration 20261006020013, already live): S17 owns availability_blocks (minimal), clinician_conflicts,
-- declare_conflict / record_conflict / lift_conflict and declare_availability / cancel_availability. S18 extends them:
-- triggers add the on-call, minimum-length, leave and minimum-guarantee rules, and a new trigger replaces a lead who is
-- the subject of a conflict. S18 adds no table or function under those names.
--
-- What this adds:
--   * lead_config (versioned, mirrored as queue.lead_rules in packages/shared/src/proposed-config; a test keeps the two
--     identical). Every number below is PROPOSED and the CMO's to set.
--   * on_call_rota (primary + backup), rota_swaps, lead_assignments (current row plus history). Direct writes are refused for every role including the
--     table owner; the only writers are the functions below.
--   * private.lead_candidates / choose_lead, assign and reassign functions, subscribers on clinician.suspended,
--     clinician.reinstated, clinician.competency_changed and order.paid, a nightly reconcile and a retry sweep.
--   * rota_coverage_gaps(), on_call_cover_status(), lead_capacity_status(): read functions, no gate (OQ-127).
--   * private.create_clinical_task() now reads the lead from lead_assignments (falls back to care_team_assignment, so
--     existing named-clinician patients keep working), skips a conflicted or resting clinician, and applies the working
--     hours and post-call rest rule for contracted clinicians (OQ-111, OQ-112).
--
-- Founder decisions: F-03 (hybrid: employed doctors are pushed tasks, contracted ones pull and must declare hours),
-- F-05 (doctor tier is the gate, credentialing_level is not used), OQ-111 and OQ-112 (2026-10-06). Open: OQ-124 to
-- OQ-130 (recommended option (a) in each is what this migration does).
--
-- Counts before this migration (live): availability_blocks, on_call_rota, conflicts, lead_assignments and lead_config
-- do not exist; care_team_assignment is read and upserted only for patients who are given a lead. No data conversion.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.lead_state as enum ('active', 'ended', 'unassigned');
create type public.lead_end_reason as enum (
  'suspended', 'offboarded', 'licence_expired', 'competency_revoked', 'conflict', 'ineligible',
  'capacity_rebalance', 'clinician_request', 'patient_request', 'superseded'
);
create type public.rota_swap_state as enum ('requested', 'accepted', 'declined', 'approved', 'cancelled');

-- ---------------------------------------------------------------------------
-- 2. Versioned configuration (PROPOSED values, CMO owner)
-- ---------------------------------------------------------------------------
create table public.lead_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index lead_config_one_active on public.lead_config (is_active) where is_active;

-- lead-rules-begin
insert into public.lead_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "max_lead_patients": 60,
  "lead_min_doctor_tier": "senior_medical_officer",
  "required_competencies": ["lead_clinician", "hypertension"],
  "block_min_hours": 2,
  "minimum_guarantee_kinds": ["queue", "on_call"],
  "rota_max_shift_hours": 24,
  "rota_horizon_days": 14,
  "gap_alert_hours": 48,
  "min_eligible_on_call": 2,
  "fatigue_min_rest_hours": 11,
  "fatigue_max_consecutive_days": 7,
  "fatigue_max_shifts_per_7_days": 3,
  "fatigue_max_hours_per_7_days": 72,
  "fatigue_long_shift_hours": 10,
  "fatigue_max_long_shifts_per_7_days": 4,
  "post_call_rest_hours": 8,
  "post_call_rest_min_shift_hours": 8,
  "contracted_needs_declared_hours": true,
  "contracted_min_declared_hours_per_week": 10,
  "swap_urgent_hours": 4,
  "override_reason_min_chars": 10
}
$json$::jsonb);
-- lead-rules-end

alter table public.lead_config enable row level security;
create policy lead_config_read on public.lead_config for select to authenticated using (true);
revoke all on public.lead_config from anon;
revoke insert, update, delete, truncate, references, trigger on public.lead_config from authenticated;
grant select on public.lead_config to authenticated;

create function private.lead_rule(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.lead_config where is_active order by version desc limit 1 $$;
revoke all on function private.lead_rule(text) from public, anon, authenticated;

create function private.lead_config_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.lead_config where is_active order by version desc limit 1 $$;
revoke all on function private.lead_config_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Small helpers
-- ---------------------------------------------------------------------------
create function private.has_competency(p_profile uuid, p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clinical_staff cs
    join public.clinician_competencies cc on cc.clinical_staff_id = cs.id and cc.revoked_at is null
   where cs.profile_id = p_profile and cc.competency_code = p_code);
$$;
revoke all on function private.has_competency(uuid, text) from public, anon, authenticated;

-- The signed-in user, if they are a working clinician (active, not suspended). Used by the clinician-facing functions.
create function private.working_clinician() returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' limit 1;
$$;
revoke all on function private.working_clinician() from public, anon, authenticated;
grant execute on function private.working_clinician() to authenticated;

-- True when a clinician is on leave at any point in [p_from, p_to] (provider_time_off, kind leave).
create function private.clinician_on_leave_during(p_profile uuid, p_from timestamptz, p_to timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.provider_time_off t
   where t.clinician_id = p_profile and t.kind = 'leave' and t.starts_at < p_to and t.ends_at > p_from);
$$;
revoke all on function private.clinician_on_leave_during(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Licence and indemnity good for the whole stretch, not only at the start.
create function private.clinician_eligible_through(p_profile uuid, p_from timestamptz, p_to timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.clinician_is_eligible(p_profile, p_from) and private.clinician_is_eligible(p_profile, p_to); $$;
revoke all on function private.clinician_eligible_through(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Direct-write guard shared by the S18 tables: only the functions in this file (which set the flag) may write.
create function private.guard_lead_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('tarragon.lead_write', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception '% is written only by the lead and rota functions', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function private.guard_lead_write() from public, anon, authenticated;

-- S15's credential_notify_reviewers forces payload.audience to 'reviewer', which links to the credentialing pages. S18 notices to
-- reviewers must land on the rota, so this sends the same notice to the same people (active admins and the chief medical officer)
-- with its own audience (rota_review, which the app routes through the /rota doorway).
create function private.rota_notify_reviewers(p_org uuid, p_subject text, p_message text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p where p.organisation_id = p_org and p.is_active and p.role = 'admin'
    union
    select cs.profile_id from public.clinical_staff cs where cs.organisation_id = p_org and cs.profile_id is not null and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
  loop
    perform private.credential_notify(r.id, p_org, p_subject, p_message, jsonb_build_object('audience', 'rota_review'), false);
  end loop;
end;
$$;
revoke all on function private.rota_notify_reviewers(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
-- S17 created availability_blocks (kind and state are text there). S18 only adds who confirmed an on-call block.
alter table public.availability_blocks
  add column confirmed_by uuid references public.profiles (id) on delete set null,
  add column confirmed_at timestamptz;
comment on column public.availability_blocks.minimum_guarantee_eligible is
  'Stored only. S30 decides what the pilot minimum per declared hour pays; S18 sets the flag for contracted clinicians and pays nothing.';

create table public.on_call_rota (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  primary_clinician_id uuid not null references public.profiles (id) on delete restrict,
  -- Nullable only because removing a clinician can strip the backup from a live row; set_on_call_rota() always requires one.
  backup_clinician_id  uuid references public.profiles (id) on delete restrict,
  built_by             uuid references public.profiles (id) on delete set null,
  override_reason      text,
  warnings             text[] not null default '{}',
  cancelled_at         timestamptz,
  cancelled_reason     text,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  check (ends_at > starts_at),
  check (backup_clinician_id is null or backup_clinician_id <> primary_clinician_id)
);
create index on_call_rota_range_idx on public.on_call_rota (organisation_id, starts_at, ends_at) where cancelled_at is null;
create index on_call_rota_primary_idx on public.on_call_rota (primary_clinician_id, starts_at) where cancelled_at is null;
create index on_call_rota_backup_idx on public.on_call_rota (backup_clinician_id, starts_at) where cancelled_at is null and backup_clinician_id is not null;

create table public.rota_swaps (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  rota_id         uuid not null references public.on_call_rota (id) on delete cascade,
  role            text not null check (role in ('primary', 'backup')),
  from_clinician  uuid not null references public.profiles (id) on delete restrict,
  to_clinician    uuid not null references public.profiles (id) on delete restrict,
  state           public.rota_swap_state not null default 'requested',
  reason          text not null,
  accepted_at     timestamptz,
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (from_clinician <> to_clinician)
);
create unique index rota_swaps_one_live on public.rota_swaps (rota_id, role) where state in ('requested', 'accepted');

create table public.lead_assignments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  -- Null only in the 'unassigned' state: the patient has no eligible lead yet and an alert is open.
  clinician_id     uuid references public.profiles (id) on delete restrict,
  state            public.lead_state not null,
  source           text not null check (source in ('order_paid', 'admin', 'reassign', 'retry')),
  source_order_id  uuid,
  config_version   integer not null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  end_reason       public.lead_end_reason,
  end_note         text,
  assigned_by      uuid references public.profiles (id) on delete set null,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  -- an active row always names a clinician, an unassigned one never does; an ended row keeps whatever it had
  check (state <> 'active' or clinician_id is not null),
  check (state <> 'unassigned' or clinician_id is null),
  check ((state = 'ended') = (ended_at is not null)),
  check (state <> 'ended' or end_reason is not null)
);
-- One live lead row (active or unassigned) per patient.
create unique index lead_assignments_one_live on public.lead_assignments (patient_id) where state in ('active', 'unassigned');
create index lead_assignments_clinician_idx on public.lead_assignments (clinician_id) where state = 'active';

-- Guards and RLS
create trigger on_call_rota_guard before insert or update or delete on public.on_call_rota
  for each row execute function private.guard_lead_write();
create trigger rota_swaps_guard before insert or update or delete on public.rota_swaps
  for each row execute function private.guard_lead_write();
create trigger lead_assignments_guard before insert or update or delete on public.lead_assignments
  for each row execute function private.guard_lead_write();

alter table public.on_call_rota enable row level security;
alter table public.rota_swaps enable row level security;
alter table public.lead_assignments enable row level security;

-- "Ops or clinical lead" is a capability (admin, or the active chief medical officer), as in S15.
create policy on_call_rota_read on public.on_call_rota for select to authenticated
  using (private.working_clinician() is not null or private.can_credential_review());
create policy rota_swaps_read on public.rota_swaps for select to authenticated
  using (from_clinician = (select auth.uid()) or to_clinician = (select auth.uid()) or private.can_credential_review());
create policy lead_assignments_read on public.lead_assignments for select to authenticated
  using (clinician_id = (select auth.uid()) or private.can_credential_review());

do $$
declare t text;
begin
  foreach t in array array['on_call_rota', 'rota_swaps', 'lead_assignments'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('lead.assigned', 'A care pack patient was given a lead clinician', 'S18', false),
  ('lead.reassigned', 'A patient''s lead clinician changed', 'S18', false),
  ('lead.unassigned', 'A patient has no eligible lead clinician; an alert is open', 'S18', true),
  ('rota.changed', 'The on-call rota changed', 'S18', false),
  ('rota.gap_detected', 'Hours in the next days have no on-call cover', 'S18', true);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('lead.assigned', 1, array['patient_id', 'clinician_id']),
  ('lead.reassigned', 1, array['patient_id', 'from_clinician_id']),
  ('lead.unassigned', 1, array['count']),
  ('rota.changed', 1, array['change']),
  ('rota.gap_detected', 1, array['gap_count']);

-- ---------------------------------------------------------------------------
-- 6. Conflicts of interest (S17 owns clinician_conflicts and its writers; S18 reads it and reacts)
-- ---------------------------------------------------------------------------
-- A live conflict (pending_review or active, S17) bars the clinician from leading this patient or being offered their work.
create function private.has_conflict(p_clinician uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.clinician_conflicts c where c.clinician_id = p_clinician and c.patient_id = p_patient and c.status <> 'lifted'); $$;
revoke all on function private.has_conflict(uuid, uuid) from public, anon, authenticated;

-- A clinician who is the patient's lead and becomes the subject of a conflict (their own declaration, the CMO's record or
-- a hand-back) is replaced at once (spec 7.2: never offered; 7.5: same rules). Forward reference: replace_lead_internal is
-- defined in section 9.
create function private.conflict_replaces_lead() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'lifted' and exists (select 1 from public.lead_assignments la
      where la.patient_id = new.patient_id and la.clinician_id = new.clinician_id and la.state = 'active') then
    -- The conflict row is the safety record and must survive: if moving the lead fails, keep the conflict, raise an
    -- incident and leave it to the nightly reconcile (which also sees the conflict) to retry. Never lose the declaration.
    begin
      perform private.replace_lead_internal(new.patient_id, new.clinician_id, 'conflict', new.declared_by, 'conflict of interest on record');
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (new.organisation_id, 'lead_conflict_replace.error', 'clinician_conflict', new.id, jsonb_build_object('error', sqlerrm));
      if not exists (select 1 from public.ops_incidents where external_reference = 'lead_conflict_replace_failed' and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values (new.organisation_id, 'clinical', 'sev2', 'A conflicted lead clinician could not be replaced',
                'A conflict of interest was recorded against a patient''s lead clinician but the patient could not be moved to another lead; see audit_log action lead_conflict_replace.error. The nightly check will retry.',
                'lead_conflict_replace_failed', now(), now());
      end if;
    end;
  end if;
  return null;
end;
$$;
revoke all on function private.conflict_replaces_lead() from public, anon, authenticated;
create trigger clinician_conflicts_replace_lead after insert or update of status on public.clinician_conflicts
  for each row execute function private.conflict_replaces_lead();

-- ---------------------------------------------------------------------------
-- 7. Declared availability
-- ---------------------------------------------------------------------------
-- S17's declare_availability() inserts the row. These two triggers add the S18 rules to every insert and cancel.
create function private.availability_s18_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into cs from public.clinical_staff where profile_id = new.clinician_id;
    if extract(epoch from (new.ends_at - new.starts_at)) / 3600.0 < (private.lead_rule('block_min_hours') #>> '{}')::numeric then
      raise exception 'availability_too_short' using errcode = '22023';
    end if;
    if new.kind = 'on_call' and not private.has_competency(new.clinician_id, 'on_call') then
      raise exception 'availability_needs_on_call_competency' using errcode = '42501';
    end if;
    if new.state <> 'cancelled' and private.clinician_on_leave_during(new.clinician_id, new.starts_at, new.ends_at) then
      raise exception 'availability_during_leave' using errcode = '22023';
    end if;
    new.minimum_guarantee_eligible := coalesce(cs.employment_type = 'contracted', false)
      and (private.lead_rule('minimum_guarantee_kinds') ? new.kind);
  elsif new.state = 'cancelled' and old.state <> 'cancelled' and new.kind = 'on_call'
        and coalesce(current_setting('tarragon.lead_write', true), '') <> 'on'
        and exists (select 1 from public.on_call_rota r
          where r.cancelled_at is null and r.ends_at > now() and r.starts_at < new.ends_at and r.ends_at > new.starts_at
            and (r.primary_clinician_id = new.clinician_id or r.backup_clinician_id = new.clinician_id)) then
    raise exception 'availability_on_the_rota: ask for a swap instead' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.availability_s18_rules() from public, anon, authenticated;
create trigger availability_blocks_s18_rules before insert or update of state on public.availability_blocks
  for each row execute function private.availability_s18_rules();

create function public.confirm_availability_block(p_block uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare b public.availability_blocks%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into b from public.availability_blocks where id = p_block for update;
  if not found or b.state <> 'declared' then raise exception 'only a declared block can be confirmed' using errcode = '22023'; end if;
  update public.availability_blocks set state = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now() where id = p_block;
end;
$$;

create function public.my_availability_blocks(p_from timestamptz default now(), p_to timestamptz default null)
returns table (id uuid, kind text, state text, starts_at timestamptz, ends_at timestamptz, minimum_guarantee_eligible boolean)
language sql stable security definer set search_path = ''
as $$
  select b.id, b.kind, b.state, b.starts_at, b.ends_at, b.minimum_guarantee_eligible
    from public.availability_blocks b
   where b.clinician_id = (select auth.uid()) and b.state <> 'cancelled' and b.ends_at > p_from
     and b.starts_at < coalesce(p_to, p_from + interval '60 days')
   order by b.starts_at;
$$;

-- Working hours and post-call rest (OQ-112). Rest follows an on-call shift of at least post_call_rest_min_shift_hours.
create function private.clinician_in_post_call_rest(p_profile uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.on_call_rota r
   where r.cancelled_at is null and r.primary_clinician_id = p_profile   -- the backup is only paged if the primary does not answer
     and r.ends_at <= p_at
     and r.ends_at > p_at - make_interval(hours => (private.lead_rule('post_call_rest_hours') #>> '{}')::integer)
     and extract(epoch from (r.ends_at - r.starts_at)) / 3600.0 >= (private.lead_rule('post_call_rest_min_shift_hours') #>> '{}')::numeric);
$$;
revoke all on function private.clinician_in_post_call_rest(uuid, timestamptz) from public, anon, authenticated;

-- May this clinician be offered work during [p_from, p_to]? Employed doctors keep the existing leave and hours
-- behaviour (deprioritised, never excluded); a contracted clinician must also have declared and confirmed hours
-- overlapping the window, because nobody else knows when they are working.
create function private.clinician_offerable(p_profile uuid, p_from timestamptz, p_to timestamptz) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  select * into cs from public.clinical_staff where profile_id = p_profile;
  if not found or not private.clinician_is_eligible(p_profile) then return false; end if;
  if private.clinician_on_leave(p_profile) then return false; end if;
  if private.clinician_in_post_call_rest(p_profile, p_from) then return false; end if;
  if cs.employment_type = 'contracted' and coalesce((private.lead_rule('contracted_needs_declared_hours'))::boolean, true) then
    return exists (select 1 from public.availability_blocks b
      where b.clinician_id = p_profile and b.state in ('declared', 'confirmed') and b.kind in ('queue', 'bookable_consultations')
        and b.starts_at < p_to and b.ends_at > p_from);
  end if;
  return true;
end;
$$;
revoke all on function private.clinician_offerable(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. On-call rota
-- ---------------------------------------------------------------------------
-- Hard checks for one person on one slot. Raises with a specific reason.
create function private.rota_validate_clinician(p_profile uuid, p_org uuid, p_start timestamptz, p_end timestamptz)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  select * into cs from public.clinical_staff where profile_id = p_profile and organisation_id = p_org;
  if not found then raise exception 'unknown clinician for this organisation' using errcode = '22023'; end if;
  if not private.has_competency(p_profile, 'on_call') then raise exception '% does not have the on-call competency', cs.full_name using errcode = '22023'; end if;
  if not private.clinician_eligible_through(p_profile, greatest(p_start, now()), p_end) then
    raise exception '% is not eligible for the whole shift (licence, indemnity or status)', cs.full_name using errcode = '22023';
  end if;
  if private.clinician_on_leave_during(p_profile, p_start, p_end) then raise exception '% is on leave for part of this shift', cs.full_name using errcode = '22023'; end if;
  if cs.employment_type = 'contracted' and not exists (select 1 from public.availability_blocks b
        where b.clinician_id = p_profile and b.state = 'confirmed' and b.kind = 'on_call' and b.starts_at <= p_start and b.ends_at >= p_end) then
    raise exception '% has no confirmed on-call hours covering this shift', cs.full_name using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.rota_validate_clinician(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Soft checks (rest, consecutive days, shifts in 7 days). Configurable; the caller may override with a written reason.
create function private.rota_fatigue_warnings(p_profile uuid, p_org uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rest integer := (private.lead_rule('fatigue_min_rest_hours') #>> '{}')::integer;
  v_maxdays integer := (private.lead_rule('fatigue_max_consecutive_days') #>> '{}')::integer;
  v_maxshifts integer := (private.lead_rule('fatigue_max_shifts_per_7_days') #>> '{}')::integer;
  v_maxhours numeric := (private.lead_rule('fatigue_max_hours_per_7_days') #>> '{}')::numeric;
  v_longh numeric := (private.lead_rule('fatigue_long_shift_hours') #>> '{}')::numeric;
  v_maxlong integer := (private.lead_rule('fatigue_max_long_shifts_per_7_days') #>> '{}')::integer;
  v_hours numeric;
  w text[] := '{}';
  v_name text;
  n integer;
  d date;
  v_run integer;
  v_best integer := 0;
  v_dates date[];
begin
  select full_name into v_name from public.clinical_staff where profile_id = p_profile;
  select count(*) into n from public.on_call_rota r
   where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
     and (r.primary_clinician_id = p_profile or r.backup_clinician_id = p_profile)
     and r.starts_at < p_end + make_interval(hours => v_rest) and r.ends_at > p_start - make_interval(hours => v_rest);
  if n > 0 then w := w || format('%s has less than %s hours of rest around this shift', v_name, v_rest); end if;

  select greatest(
    (select count(*) from public.on_call_rota r where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
        and (r.primary_clinician_id = p_profile or r.backup_clinician_id = p_profile) and r.starts_at < p_end and r.ends_at > p_end - interval '7 days'),
    (select count(*) from public.on_call_rota r where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
        and (r.primary_clinician_id = p_profile or r.backup_clinician_id = p_profile) and r.starts_at < p_start + interval '7 days' and r.ends_at > p_start))
    into n;
  if n + 1 > v_maxshifts then w := w || format('%s would have %s shifts inside 7 days (limit %s)', v_name, n + 1, v_maxshifts); end if;

  -- hours worked (as primary: a backup is only paged if the primary does not answer, as for post-call rest): the NHS contract
  -- caps 72 hours in any 168 (documented, 2016 doctors in training FAQ). Checked over the 7 days
  -- ending with this shift and the 7 days starting with it, counting this shift in full.
  select greatest(
    coalesce((select sum(extract(epoch from (least(r.ends_at, p_end) - greatest(r.starts_at, p_end - interval '7 days'))) / 3600.0)
                from public.on_call_rota r where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
                 and r.primary_clinician_id = p_profile and r.starts_at < p_end and r.ends_at > p_end - interval '7 days'), 0),
    coalesce((select sum(extract(epoch from (least(r.ends_at, p_start + interval '7 days') - greatest(r.starts_at, p_start))) / 3600.0)
                from public.on_call_rota r where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
                 and r.primary_clinician_id = p_profile and r.starts_at < p_start + interval '7 days' and r.ends_at > p_start), 0))
    + extract(epoch from (p_end - p_start)) / 3600.0
    into v_hours;
  if v_hours > v_maxhours then w := w || format('%s would work %s hours inside 7 days (limit %s)', v_name, round(v_hours), v_maxhours); end if;

  -- long shifts: the contract allows at most 4 consecutive long shifts; approximated as at most 4 shifts over the long-shift
  -- length in any 7 days, counting this one
  if extract(epoch from (p_end - p_start)) / 3600.0 > v_longh then
    select count(*) into n from public.on_call_rota r
     where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
       and r.primary_clinician_id = p_profile
       and extract(epoch from (r.ends_at - r.starts_at)) / 3600.0 > v_longh
       and r.starts_at < p_start + interval '7 days' and r.ends_at > p_start - interval '7 days';
    if n + 1 > v_maxlong then w := w || format('%s would work %s long shifts (over %s hours) inside 7 days (limit %s)', v_name, n + 1, v_longh, v_maxlong); end if;
  end if;

  -- consecutive days with a shift, in Lagos local dates, including this one
  select array_agg(distinct x::date order by x::date) into v_dates from (
    select generate_series((r.starts_at at time zone 'Africa/Lagos')::date, ((r.ends_at - interval '1 second') at time zone 'Africa/Lagos')::date, interval '1 day') x
      from public.on_call_rota r
     where r.organisation_id = p_org and r.cancelled_at is null and r.id is distinct from p_exclude
       and (r.primary_clinician_id = p_profile or r.backup_clinician_id = p_profile)
       and r.ends_at > p_start - interval '10 days' and r.starts_at < p_end + interval '10 days'
    union
    select generate_series((p_start at time zone 'Africa/Lagos')::date, ((p_end - interval '1 second') at time zone 'Africa/Lagos')::date, interval '1 day')
  ) s;
  v_run := 0;
  foreach d in array coalesce(v_dates, '{}') loop
    if v_run > 0 and d = (select max(x) from unnest(v_dates) x where x < d) + 1 then v_run := v_run + 1; else v_run := 1; end if;
    v_best := greatest(v_best, v_run);
  end loop;
  if v_best > v_maxdays then w := w || format('%s would work %s days in a row (limit %s)', v_name, v_best, v_maxdays); end if;
  return w;
end;
$$;
revoke all on function private.rota_fatigue_warnings(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

create function public.set_on_call_rota(p_starts_at timestamptz, p_ends_at timestamptz, p_primary uuid, p_backup uuid, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_backup_org uuid;
  w text[] := '{}';
  v_id uuid;
  v_min integer := (private.lead_rule('override_reason_min_chars') #>> '{}')::integer;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_ends_at <= p_starts_at then raise exception 'the shift must end after it starts' using errcode = '22023'; end if;
  if p_starts_at < now() - interval '5 minutes' then raise exception 'a rota shift cannot start in the past' using errcode = '22023'; end if;
  if extract(epoch from (p_ends_at - p_starts_at)) / 3600.0 > (private.lead_rule('rota_max_shift_hours') #>> '{}')::numeric then
    raise exception 'a rota shift is at most % hours', private.lead_rule('rota_max_shift_hours') #>> '{}' using errcode = '22023';
  end if;
  if p_primary is null or p_backup is null then raise exception 'every shift needs a primary and a backup' using errcode = '22023'; end if;
  if p_primary = p_backup then raise exception 'the primary and the backup must be different people' using errcode = '22023'; end if;
  select organisation_id into v_org from public.clinical_staff where profile_id = p_primary;
  select organisation_id into v_backup_org from public.clinical_staff where profile_id = p_backup;
  if v_org is null or v_org is distinct from v_backup_org then raise exception 'unknown clinician or different organisations' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('on_call_rota:' || v_org));
  perform private.rota_validate_clinician(p_primary, v_org, p_starts_at, p_ends_at);
  perform private.rota_validate_clinician(p_backup, v_org, p_starts_at, p_ends_at);
  if exists (select 1 from public.on_call_rota r where r.organisation_id = v_org and r.cancelled_at is null and r.starts_at < p_ends_at and r.ends_at > p_starts_at) then
    raise exception 'this overlaps an existing rota shift: cancel it first' using errcode = '23P01';
  end if;
  w := private.rota_fatigue_warnings(p_primary, v_org, p_starts_at, p_ends_at) || private.rota_fatigue_warnings(p_backup, v_org, p_starts_at, p_ends_at);
  if array_length(w, 1) > 0 and char_length(btrim(coalesce(p_override_reason, ''))) < v_min then
    raise exception 'fatigue_warning: % (add a written reason of at least % characters to override)', array_to_string(w, '; '), v_min using errcode = '23514';
  end if;
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, built_by, override_reason, warnings, is_test)
  values (v_org, p_starts_at, p_ends_at, p_primary, p_backup, (select auth.uid()),
          case when array_length(w, 1) > 0 then btrim(p_override_reason) end, w,
          coalesce((select is_test from public.profiles where id = p_primary), false))
  returning id into v_id;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.credential_audit(v_org, (select auth.uid()), 'rota.shift_set', 'on_call_rota', v_id,
    jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'warnings', to_jsonb(w), 'override_reason', p_override_reason));
  perform private.emit_domain_event('rota.changed', v_org, jsonb_build_object('change', 'set', 'rota_id', v_id), 'rota.changed:' || v_id || ':set');
  perform private.credential_notify(p_primary, v_org, 'You are on call', 'You are the on-call clinician for a shift. Open Availability to see the rota.', jsonb_build_object('audience', 'rota'), true);
  perform private.credential_notify(p_backup, v_org, 'You are the backup on call', 'You are the backup on-call clinician for a shift. Open Availability to see the rota.', jsonb_build_object('audience', 'rota'), true);
  perform private.rota_gap_alert(v_org);
  return jsonb_build_object('id', v_id, 'warnings', to_jsonb(w));
end;
$$;

create function public.cancel_on_call_rota(p_rota uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.on_call_rota%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into r from public.on_call_rota where id = p_rota for update;
  if not found or r.cancelled_at is not null then raise exception 'unknown or already cancelled shift' using errcode = '22023'; end if;
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = btrim(p_reason) where id = p_rota;
  update public.rota_swaps set state = 'cancelled' where rota_id = p_rota and state in ('requested', 'accepted');
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.credential_audit(r.organisation_id, (select auth.uid()), 'rota.shift_cancelled', 'on_call_rota', r.id, jsonb_build_object('reason', btrim(p_reason)));
  perform private.emit_domain_event('rota.changed', r.organisation_id, jsonb_build_object('change', 'cancelled', 'rota_id', r.id), 'rota.changed:' || r.id || ':cancelled');
  perform private.rota_gap_alert(r.organisation_id);
end;
$$;

-- Uncovered and thin stretches in [p_from, p_to). kind: uncovered (nobody), no_backup, primary_ineligible, backup_ineligible.
create function private.rota_gaps(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (gap_start timestamptz, gap_end timestamptz, kind text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r record;
  v_cursor timestamptz := p_from;
begin
  for r in select * from public.on_call_rota o
            where o.organisation_id = p_org and o.cancelled_at is null and o.ends_at > p_from and o.starts_at < p_to
            order by o.starts_at loop
    if r.starts_at > v_cursor then
      gap_start := v_cursor; gap_end := least(r.starts_at, p_to); kind := 'uncovered'; return next;
    end if;
    if r.backup_clinician_id is null then
      gap_start := greatest(r.starts_at, p_from); gap_end := least(r.ends_at, p_to); kind := 'no_backup'; return next;
    elsif not private.clinician_eligible_through(r.backup_clinician_id, greatest(r.starts_at, now()), r.ends_at) then
      gap_start := greatest(r.starts_at, p_from); gap_end := least(r.ends_at, p_to); kind := 'backup_ineligible'; return next;
    end if;
    if not private.clinician_eligible_through(r.primary_clinician_id, greatest(r.starts_at, now()), r.ends_at) then
      gap_start := greatest(r.starts_at, p_from); gap_end := least(r.ends_at, p_to); kind := 'primary_ineligible'; return next;
    end if;
    v_cursor := greatest(v_cursor, r.ends_at);
  end loop;
  if v_cursor < p_to then gap_start := v_cursor; gap_end := p_to; kind := 'uncovered'; return next; end if;
end;
$$;
revoke all on function private.rota_gaps(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create function public.rota_coverage_gaps(p_org uuid default null, p_from timestamptz default now(), p_to timestamptz default null)
returns table (gap_start timestamptz, gap_end timestamptz, kind text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not (private.can_credential_review() or (select auth.role()) = 'service_role') then raise exception 'not authorised' using errcode = '42501'; end if;
  v_org := coalesce(p_org, (select organisation_id from public.profiles where id = (select auth.uid())), (select id from public.organisations order by created_at limit 1));
  return query select * from private.rota_gaps(v_org, p_from, coalesce(p_to, p_from + make_interval(days => (private.lead_rule('rota_horizon_days') #>> '{}')::integer)));
end;
$$;

-- Opens (or refreshes) one incident while any hour in the next gap_alert_hours has no proper cover. Uncovered hours fail
-- loudly and are never dropped (the PagerDuty lesson: "nobody on call" must not mean "nothing happens").
create function private.rota_gap_alert(p_org uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
  v_now integer;
  v_ref text := 'rota_gap:' || p_org;
  v_hours integer := (private.lead_rule('gap_alert_hours') #>> '{}')::integer;
  v_summary text;
begin
  with g as (select * from private.rota_gaps(p_org, now(), now() + make_interval(hours => v_hours)))
  select count(*), count(*) filter (where gap_start <= now()),
         string_agg(format('%s from %s to %s', kind, to_char(gap_start at time zone 'Africa/Lagos', 'DD Mon HH24:MI'), to_char(gap_end at time zone 'Africa/Lagos', 'DD Mon HH24:MI')), '; ' order by gap_start)
    into v_n, v_now, v_summary from g;
  if v_n = 0 then return 0; end if;
  if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = 'On-call cover problem in the next ' || v_hours || ' hours: ' || v_summary
     where external_reference = v_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'clinical', (case when v_now > 0 then 'sev1' else 'sev2' end)::public.ops_incident_severity, 'On-call rota has uncovered or thin hours',
            'On-call cover problem in the next ' || v_hours || ' hours: ' || v_summary, v_ref, now(), now());
    perform private.rota_notify_reviewers(p_org, 'On-call cover gap', 'Some upcoming hours have no on-call cover or no working backup. Open the rota to fix it.');
  end if;
  perform private.emit_domain_event('rota.gap_detected', p_org, jsonb_build_object('gap_count', v_n),
    'rota.gap_detected:' || p_org || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'), null, null, null, 'urgent');
  return v_n;
end;
$$;
revoke all on function private.rota_gap_alert(uuid) from public, anon, authenticated;

create function public.on_call_cover_status(p_org uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_days integer := (private.lead_rule('rota_horizon_days') #>> '{}')::integer;
  v_eligible integer;
  r public.on_call_rota%rowtype;
begin
  if not (private.can_credential_review() or (select auth.role()) = 'service_role') then raise exception 'not authorised' using errcode = '42501'; end if;
  v_org := coalesce(p_org, (select organisation_id from public.profiles where id = (select auth.uid())), (select id from public.organisations order by created_at limit 1));
  select count(*) into v_eligible from public.clinical_staff cs
   where cs.organisation_id = v_org and cs.profile_id is not null and private.has_competency(cs.profile_id, 'on_call') and private.clinician_is_eligible(cs.profile_id);
  select * into r from public.on_call_rota o where o.organisation_id = v_org and o.cancelled_at is null and o.starts_at <= now() and o.ends_at > now() limit 1;
  return jsonb_build_object(
    'covered_now', r.id is not null and r.backup_clinician_id is not null,
    'current_primary', (select full_name from public.clinical_staff where profile_id = r.primary_clinician_id),
    'current_backup', (select full_name from public.clinical_staff where profile_id = r.backup_clinician_id),
    'eligible_on_call_clinicians', v_eligible,
    'enough_clinicians', v_eligible >= (private.lead_rule('min_eligible_on_call') #>> '{}')::integer,
    'horizon_days', v_days,
    'gaps', coalesce((select jsonb_agg(jsonb_build_object('from', g.gap_start, 'to', g.gap_end, 'kind', g.kind) order by g.gap_start)
                        from private.rota_gaps(v_org, now(), now() + make_interval(days => v_days)) g), '[]'::jsonb));
end;
$$;

create function public.my_rota(p_from timestamptz default now(), p_to timestamptz default null)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, primary_name text, backup_name text, my_role text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.starts_at, r.ends_at,
         (select full_name from public.clinical_staff where profile_id = r.primary_clinician_id),
         (select full_name from public.clinical_staff where profile_id = r.backup_clinician_id),
         case when r.primary_clinician_id = (select auth.uid()) then 'primary' when r.backup_clinician_id = (select auth.uid()) then 'backup' end
    from public.on_call_rota r
   where private.working_clinician() is not null and r.cancelled_at is null and r.ends_at > p_from
     and r.starts_at < coalesce(p_to, p_from + make_interval(days => (private.lead_rule('rota_horizon_days') #>> '{}')::integer))
     and r.organisation_id = (select organisation_id from public.clinical_staff where profile_id = (select auth.uid()))
   order by r.starts_at;
$$;

-- Swaps: nothing changes until the covering clinician accepts AND a reviewer approves.
create function public.request_rota_swap(p_rota uuid, p_role text, p_to uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  r public.on_call_rota%rowtype;
  v_me uuid := private.working_clinician();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_role not in ('primary', 'backup') then raise exception 'role must be primary or backup' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into r from public.on_call_rota where id = p_rota and cancelled_at is null;
  if not found or r.ends_at <= now() then raise exception 'unknown or finished shift' using errcode = '22023'; end if;
  if (p_role = 'primary' and r.primary_clinician_id <> v_me) or (p_role = 'backup' and r.backup_clinician_id is distinct from v_me) then
    raise exception 'you do not hold this slot' using errcode = '42501';
  end if;
  if p_to in (r.primary_clinician_id, r.backup_clinician_id) then raise exception 'that clinician is already on this shift' using errcode = '22023'; end if;
  perform private.rota_validate_clinician(p_to, r.organisation_id, r.starts_at, r.ends_at);
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.rota_swaps (organisation_id, rota_id, role, from_clinician, to_clinician, reason, is_test)
  values (r.organisation_id, p_rota, p_role, v_me, p_to, btrim(p_reason), r.is_test) returning id into v_id;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.credential_notify(p_to, r.organisation_id, 'Cover request', 'A colleague asked you to cover an on-call shift. Open Availability to accept or decline.', jsonb_build_object('audience', 'rota'), true);
  return v_id;
end;
$$;

create function public.respond_rota_swap(p_swap uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.rota_swaps%rowtype;
  r public.on_call_rota%rowtype;
  w text[];
  v_urgent boolean;
begin
  select * into s from public.rota_swaps where id = p_swap for update;
  if not found then raise exception 'unknown swap' using errcode = '22023'; end if;
  if s.to_clinician <> (select auth.uid()) or s.state <> 'requested' then raise exception 'not authorised' using errcode = '42501'; end if;
  perform set_config('tarragon.lead_write', 'on', true);
  update public.rota_swaps set state = case when p_accept then 'accepted' else 'declined' end::public.rota_swap_state,
         accepted_at = case when p_accept then now() end where id = p_swap;
  perform set_config('tarragon.lead_write', 'off', true);
  if not p_accept then return; end if;

  select * into r from public.on_call_rota where id = s.rota_id and cancelled_at is null for update;
  v_urgent := found and r.ends_at > now() and r.starts_at <= now() + make_interval(hours => (private.lead_rule('swap_urgent_hours') #>> '{}')::integer);
  if v_urgent then
    -- the slot must still be the requester's and the colleague must not already be on the shift (a suspension or another swap may
    -- have changed it since the request); otherwise the normal reviewer path decides
    if (s.role = 'primary' and r.primary_clinician_id <> s.from_clinician) or (s.role = 'backup' and r.backup_clinician_id is distinct from s.from_clinician)
       or s.to_clinician in (r.primary_clinician_id, r.backup_clinician_id) then
      v_urgent := false;
    else
      perform private.rota_validate_clinician(s.to_clinician, r.organisation_id, greatest(r.starts_at, now()), r.ends_at);
      w := private.rota_fatigue_warnings(s.to_clinician, r.organisation_id, greatest(r.starts_at, now()), r.ends_at, r.id);
      -- a fatigue warning needs a written override from a reviewer: it is never waved through by two colleagues agreeing
      v_urgent := coalesce(array_length(w, 1), 0) = 0;
    end if;
  end if;
  if v_urgent then
    -- URGENT COVER: the shift starts within a few hours or has started and the swap is clean. Waiting for a reviewer could leave
    -- the shift uncovered, so the colleague's acceptance applies it at once. It is audited and the reviewers are told straight away
    -- so they can check it. (Other platforms leave this open; a rota must not stall on approval.)
    perform set_config('tarragon.lead_write', 'on', true);
    if s.role = 'primary' then update public.on_call_rota set primary_clinician_id = s.to_clinician where id = r.id;
    else update public.on_call_rota set backup_clinician_id = s.to_clinician where id = r.id; end if;
    update public.rota_swaps set state = 'approved', decided_by = s.to_clinician, decided_at = now() where id = p_swap;
    perform set_config('tarragon.lead_write', 'off', true);
    perform private.credential_audit(r.organisation_id, s.to_clinician, 'rota.swap_urgent', 'rota_swap', s.id,
      jsonb_build_object('rota_id', r.id, 'role', s.role, 'from', s.from_clinician, 'to', s.to_clinician, 'warnings', '[]'::jsonb));
    perform private.emit_domain_event('rota.changed', r.organisation_id, jsonb_build_object('change', 'swap', 'rota_id', r.id), 'rota.changed:' || s.id || ':swap');
    perform private.rota_notify_reviewers(r.organisation_id, 'Urgent rota cover taken', 'An on-call shift starting soon was covered by a colleague without waiting for approval. Please check it.');
    perform private.credential_notify(s.from_clinician, r.organisation_id, 'Your shift is covered', 'A colleague has taken your on-call shift. You are no longer on call for it.', jsonb_build_object('audience', 'rota'), true);
    perform private.rota_gap_alert(r.organisation_id);
  else
    perform private.rota_notify_reviewers(s.organisation_id, 'Rota swap to approve', 'A rota swap was accepted and needs approval.');
  end if;
end;
$$;

create function public.cancel_rota_swap(p_swap uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.rota_swaps%rowtype;
begin
  select * into s from public.rota_swaps where id = p_swap for update;
  if not found or s.state not in ('requested', 'accepted') or (s.from_clinician <> (select auth.uid()) and not private.can_credential_review()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  perform set_config('tarragon.lead_write', 'on', true);
  update public.rota_swaps set state = 'cancelled' where id = p_swap;
  perform set_config('tarragon.lead_write', 'off', true);
end;
$$;

create function public.approve_rota_swap(p_swap uuid, p_override_reason text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.rota_swaps%rowtype;
  r public.on_call_rota%rowtype;
  w text[];
  v_min integer := (private.lead_rule('override_reason_min_chars') #>> '{}')::integer;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into s from public.rota_swaps where id = p_swap for update;
  if not found or s.state <> 'accepted' then raise exception 'only an accepted swap can be approved' using errcode = '22023'; end if;
  select * into r from public.on_call_rota where id = s.rota_id and cancelled_at is null for update;
  if not found or r.ends_at <= now() then raise exception 'that shift is no longer live' using errcode = '22023'; end if;
  if (s.role = 'primary' and r.primary_clinician_id <> s.from_clinician) or (s.role = 'backup' and r.backup_clinician_id is distinct from s.from_clinician) then
    raise exception 'the slot has changed since the request' using errcode = '22023';
  end if;
  perform private.rota_validate_clinician(s.to_clinician, r.organisation_id, r.starts_at, r.ends_at);
  w := private.rota_fatigue_warnings(s.to_clinician, r.organisation_id, r.starts_at, r.ends_at, r.id);
  if array_length(w, 1) > 0 and char_length(btrim(coalesce(p_override_reason, ''))) < v_min then
    raise exception 'fatigue_warning: % (add a written reason of at least % characters to override)', array_to_string(w, '; '), v_min using errcode = '23514';
  end if;
  perform set_config('tarragon.lead_write', 'on', true);
  if s.role = 'primary' then update public.on_call_rota set primary_clinician_id = s.to_clinician where id = r.id;
  else update public.on_call_rota set backup_clinician_id = s.to_clinician where id = r.id; end if;
  update public.rota_swaps set state = 'approved', decided_by = (select auth.uid()), decided_at = now() where id = p_swap;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.credential_audit(r.organisation_id, (select auth.uid()), 'rota.swap_approved', 'rota_swap', s.id,
    jsonb_build_object('rota_id', r.id, 'role', s.role, 'from', s.from_clinician, 'to', s.to_clinician, 'warnings', to_jsonb(w), 'override_reason', p_override_reason));
  perform private.emit_domain_event('rota.changed', r.organisation_id, jsonb_build_object('change', 'swap', 'rota_id', r.id), 'rota.changed:' || s.id || ':swap');
  perform private.credential_notify(s.to_clinician, r.organisation_id, 'You are covering a shift', 'Your cover for an on-call shift was approved. Open Availability to see it.', jsonb_build_object('audience', 'rota'), true);
  perform private.credential_notify(s.from_clinician, r.organisation_id, 'Your swap was approved', 'Your on-call swap was approved. You no longer hold that shift.', jsonb_build_object('audience', 'rota'), true);
  perform private.rota_gap_alert(r.organisation_id);
  return jsonb_build_object('warnings', to_jsonb(w));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Lead clinician: who may lead, who is chosen, assign, replace
-- ---------------------------------------------------------------------------
-- Who may be this patient's lead (spec 7.5 step 1, with F-05: doctor tier is the gate). Capacity is skipped when we only
-- want to know whether the CURRENT lead is still allowed to be one.
create function private.lead_candidates(p_patient uuid, p_exclude uuid[] default '{}', p_check_capacity boolean default true)
returns table (cand uuid, was_treating boolean, lang_ok boolean, lead_count integer, reliability numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pr public.profiles%rowtype;
  v_min public.doctor_tier := (private.lead_rule('lead_min_doctor_tier') #>> '{}')::public.doctor_tier;
  v_cap integer := (private.lead_rule('max_lead_patients') #>> '{}')::integer;
  v_comps text[] := array(select jsonb_array_elements_text(private.lead_rule('required_competencies')));
  v_cta uuid;
  v_lang text;
begin
  select * into pr from public.profiles where id = p_patient;
  if not found then return; end if;
  v_lang := lower(coalesce(pr.language, 'en'));
  select clinician_id into v_cta from public.care_team_assignment where patient_id = p_patient;
  return query
  with c as (
    select cs.profile_id as pid, cs.max_lead_patients as lim, cs.languages as langs, cs.reliability_score as rel,
           -- test patients never use up real capacity (INV-13)
           (select count(*)::integer from public.lead_assignments la where la.clinician_id = cs.profile_id and la.state = 'active' and not la.is_test) as n
      from public.clinical_staff cs
     where cs.profile_id is not null and cs.organisation_id = pr.organisation_id and cs.active and cs.status = 'active'
       -- test and real never mix (INV-13, as S17 does for the queue)
       and cs.is_test = pr.is_test
       and cs.doctor_tier is not null and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(v_min)
       and cs.profile_id <> p_patient and not (cs.profile_id = any(p_exclude))
       and private.clinician_is_eligible(cs.profile_id)
       and not private.clinician_on_leave(cs.profile_id)
       and not private.has_conflict(cs.profile_id, p_patient)
       and not exists (select 1 from unnest(v_comps) k where not private.has_competency(cs.profile_id, k))
  )
  select c.pid,
         (c.pid = v_cta
          or exists (select 1 from public.clinical_tasks t where t.patient_id = p_patient and t.claimed_by = c.pid and t.state = 'completed')
          or exists (select 1 from public.lead_assignments la where la.patient_id = p_patient and la.clinician_id = c.pid)),
         (v_lang = any (select lower(x) from unnest(case when cardinality(c.langs) = 0 then array['en'] else c.langs end) x)),
         c.n, coalesce(c.rel, 0)
    from c
   where (not p_check_capacity) or c.n < coalesce(c.lim, v_cap);
end;
$$;
revoke all on function private.lead_candidates(uuid, uuid[], boolean) from public, anon, authenticated;

-- Is this clinician STILL allowed to lead this patient? Same rules as lead_candidates minus the two that must not end a
-- lead: leave (they will be back; only offers pause) and capacity (they already hold the patient).
create function private.lead_valid(p_clinician uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs join public.profiles pr on pr.id = p_patient
     where cs.profile_id = p_clinician and cs.organisation_id = pr.organisation_id and cs.active and cs.status = 'active'
       and cs.doctor_tier is not null
       and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank((private.lead_rule('lead_min_doctor_tier') #>> '{}')::public.doctor_tier)
       and cs.profile_id <> p_patient
       and private.clinician_is_eligible(cs.profile_id)
       and not private.has_conflict(cs.profile_id, p_patient)
       and not exists (select 1 from jsonb_array_elements_text(private.lead_rule('required_competencies')) k where not private.has_competency(cs.profile_id, k)));
$$;
revoke all on function private.lead_valid(uuid, uuid) from public, anon, authenticated;

-- Spec 7.5 step 2: prefer the clinician who already treated the patient, then language where possible, then the fewest
-- active leads, ties by reliability, then a stable id so the choice is repeatable.
create function private.choose_lead(p_patient uuid, p_exclude uuid[] default '{}') returns uuid
language sql stable security definer set search_path = ''
as $$
  select cand from private.lead_candidates(p_patient, p_exclude, true)
   order by was_treating desc, lang_ok desc, lead_count asc, reliability desc, cand asc limit 1;
$$;
revoke all on function private.choose_lead(uuid, uuid[]) from public, anon, authenticated;

-- Why is this clinician no longer fit to lead this patient? Used for the history row.
create function private.lead_ineligibility_reason(p_clinician uuid, p_patient uuid) returns public.lead_end_reason
language plpgsql stable security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  select * into cs from public.clinical_staff where profile_id = p_clinician;
  if not found then return 'ineligible'; end if;
  if cs.status = 'offboarded' then return 'offboarded'; end if;
  if cs.status = 'suspended' or not cs.active then
    return case when coalesce(cs.suspended_reason, '') ~* 'licen[cs]e' then 'licence_expired' else 'suspended' end;
  end if;
  if private.has_conflict(p_clinician, p_patient) then return 'conflict'; end if;
  if cs.license_expires_at is not null and not private.clinician_is_eligible(p_clinician) then return 'licence_expired'; end if;
  if exists (select 1 from jsonb_array_elements_text(private.lead_rule('required_competencies')) k where not private.has_competency(p_clinician, k)) then return 'competency_revoked'; end if;
  return 'ineligible';
end;
$$;
revoke all on function private.lead_ineligibility_reason(uuid, uuid) from public, anon, authenticated;

-- Neutral notices only (INV-07): no condition, reading or result, no names.
create function private.lead_notify_patient(p_patient uuid, p_org uuid, p_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
  values (p_patient, p_org, 'in_app', 'care_team_notice', jsonb_build_object('kind', p_kind), 'pending', 'non_clinical');
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
  values (p_patient, p_org, 'email', 'care_team_notice', jsonb_build_object('kind', p_kind), 'pending', 'non_clinical');
end;
$$;
revoke all on function private.lead_notify_patient(uuid, uuid, text) from public, anon, authenticated;

-- One open incident while any patient has no lead. Refreshed, never duplicated, never silent.
create function private.lead_unassigned_alert(p_org uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
  v_ref text := 'lead_unassigned:' || p_org;
begin
  select count(*) into v_n from public.lead_assignments where organisation_id = p_org and state = 'unassigned';
  if v_n = 0 then return; end if;
  if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = format('%s patient(s) have no eligible lead clinician. Add lead-capable clinicians or free capacity.', v_n)
     where external_reference = v_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'clinical', 'sev2', 'Patients without a lead clinician',
            format('%s patient(s) have no eligible lead clinician. Add lead-capable clinicians or free capacity.', v_n), v_ref, now(), now());
    perform private.rota_notify_reviewers(p_org, 'Patients without a lead clinician', 'Some care pack patients have no lead clinician. Open the lead overview.');
  end if;
  perform private.emit_domain_event('lead.unassigned', p_org, jsonb_build_object('patient_id', null, 'count', v_n),
    'lead.unassigned:' || p_org || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'), null, null, null, 'urgent');
end;
$$;
revoke all on function private.lead_unassigned_alert(uuid) from public, anon, authenticated;

-- Offered tasks follow the lead change: to the new lead, or to the pool at once (never stranded with someone removed).
create function private.reroute_offered_tasks(p_patient uuid, p_old uuid, p_new uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare t record; n integer := 0;
begin
  for t in select id, min_tier, lead_window_ends_at from public.clinical_tasks
            where patient_id = p_patient and state = 'offered_to_lead' and (lead_clinician_id = p_old or pushed_to = p_old) for update loop
    -- the new lead gets an exclusive offer only if they can actually be working inside the window (declared hours, not in rest)
    if p_new is not null
       and exists (select 1 from public.clinical_staff cs where cs.profile_id = p_new and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(t.min_tier))
       and private.clinician_offerable(p_new, now(), coalesce(t.lead_window_ends_at, now() + interval '4 hours')) then
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set lead_clinician_id = p_new, delivery_path = 'pull', pushed_to = null where id = t.id;
      perform set_config('tarragon.task_transition', 'off', true);
    else
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set lead_clinician_id = null, lead_window_ends_at = null, delivery_path = 'pull', pushed_to = null where id = t.id;
      perform set_config('tarragon.task_transition', 'off', true);
      perform private.apply_task_transition(t.id, 'open', 'system', null, 'lead changed: to the pool');
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.reroute_offered_tasks(uuid, uuid, uuid) from public, anon, authenticated;

create function private.assign_lead_internal(p_patient uuid, p_source text, p_order uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles%rowtype;
  cur public.lead_assignments%rowtype;
  v_have boolean;
  v_new uuid;
  v_id uuid;
begin
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('lead_assign'));
  select * into cur from public.lead_assignments where patient_id = p_patient and state in ('active', 'unassigned') for update;
  v_have := found;
  if v_have and cur.state = 'active' then
    if private.lead_valid(cur.clinician_id, p_patient) then return cur.clinician_id; end if;
    return private.replace_lead_internal(p_patient, cur.clinician_id, private.lead_ineligibility_reason(cur.clinician_id, p_patient), p_actor, 'no longer eligible to lead');
  end if;
  v_new := private.choose_lead(p_patient, '{}');
  if v_new is null then
    if v_have then return null; end if;   -- already unassigned and still nobody: the open alert stands
    perform set_config('tarragon.lead_write', 'on', true);
    insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, source_order_id, config_version, assigned_by, is_test)
    values (pr.organisation_id, p_patient, null, 'unassigned', p_source, p_order, private.lead_config_version(), p_actor, pr.is_test);
    perform set_config('tarragon.lead_write', 'off', true);
    perform private.lead_unassigned_alert(pr.organisation_id);
    perform private.lead_notify_patient(p_patient, pr.organisation_id, 'arranging');
    return null;
  end if;
  perform set_config('tarragon.lead_write', 'on', true);
  if v_have then
    update public.lead_assignments set state = 'ended', ended_at = now(), end_reason = 'superseded' where id = cur.id;
  end if;
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, source_order_id, config_version, assigned_by, is_test)
  values (pr.organisation_id, p_patient, v_new, 'active', p_source, p_order, private.lead_config_version(), p_actor, pr.is_test)
  returning id into v_id;
  -- INV-12: care_team_assignment is what ties the lead to the chart, so it moves in this same transaction.
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
  values (pr.organisation_id, p_patient, v_new)
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id, assigned_at = now();
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.credential_audit(pr.organisation_id, p_actor, 'lead.assigned', 'lead_assignment', v_id, jsonb_build_object('clinician_id', v_new, 'source', p_source));
  perform private.emit_domain_event('lead.assigned', pr.organisation_id, jsonb_build_object('patient_id', p_patient, 'clinician_id', v_new),
    'lead.assigned:' || v_id, p_patient, 'lead_assignment', v_id);
  perform private.credential_notify(v_new, pr.organisation_id, 'A new patient is in your care', 'A new patient has joined your lead list. Open your patients to see them.', jsonb_build_object('audience', 'lead'), true);
  perform private.lead_notify_patient(p_patient, pr.organisation_id, 'assigned');
  return v_new;
end;
$$;
revoke all on function private.assign_lead_internal(uuid, text, uuid, uuid) from public, anon, authenticated;

create function private.replace_lead_internal(p_patient uuid, p_old uuid, p_reason public.lead_end_reason, p_actor uuid, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.lead_assignments%rowtype;
  v_new uuid;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('lead_assign'));
  select * into cur from public.lead_assignments where patient_id = p_patient and clinician_id = p_old and state = 'active' for update;
  if not found then return null; end if;
  v_new := private.choose_lead(p_patient, array[p_old]);
  perform set_config('tarragon.lead_write', 'on', true);
  update public.lead_assignments set state = 'ended', ended_at = now(), end_reason = p_reason, end_note = p_note where id = cur.id;
  if v_new is null then
    insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, assigned_by, is_test)
    values (cur.organisation_id, p_patient, null, 'unassigned', 'reassign', private.lead_config_version(), p_actor, cur.is_test) returning id into v_id;
    update public.care_team_assignment set clinician_id = null where patient_id = p_patient and clinician_id = p_old;
  else
    insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, assigned_by, is_test)
    values (cur.organisation_id, p_patient, v_new, 'active', 'reassign', private.lead_config_version(), p_actor, cur.is_test) returning id into v_id;
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
    values (cur.organisation_id, p_patient, v_new)
    on conflict (patient_id) do update set clinician_id = excluded.clinician_id, assigned_at = now();
  end if;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.reroute_offered_tasks(p_patient, p_old, v_new);
  perform private.credential_audit(cur.organisation_id, p_actor, 'lead.reassigned', 'lead_assignment', v_id,
    jsonb_build_object('from', p_old, 'to', v_new, 'reason', p_reason, 'note', p_note));
  perform private.emit_domain_event('lead.reassigned', cur.organisation_id,
    jsonb_build_object('patient_id', p_patient, 'from_clinician_id', p_old, 'to_clinician_id', v_new, 'reason', p_reason),
    'lead.reassigned:' || v_id, p_patient, 'lead_assignment', v_id);
  if v_new is null then
    perform private.lead_unassigned_alert(cur.organisation_id);
    perform private.lead_notify_patient(p_patient, cur.organisation_id, 'arranging');
  else
    perform private.credential_notify(v_new, cur.organisation_id, 'A patient moved to your lead list', 'A patient has been moved to your lead list. Open your patients to see them.', jsonb_build_object('audience', 'lead'), true);
    perform private.lead_notify_patient(p_patient, cur.organisation_id, 'changed');
  end if;
  if p_reason not in ('suspended', 'offboarded', 'licence_expired') then
    perform private.credential_notify(p_old, cur.organisation_id, 'A patient left your lead list', 'A patient is no longer on your lead list. Open your patients to see your list.', jsonb_build_object('audience', 'lead'), false);
  end if;
  return v_new;
end;
$$;
revoke all on function private.replace_lead_internal(uuid, uuid, public.lead_end_reason, uuid, text) from public, anon, authenticated;

-- A clinician is leaving every duty at once: leads, queue work, declared hours, rota.
create function private.release_removed_clinician_work(p_clinician uuid, p_reason text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare t record; n integer := 0;
begin
  for t in select id, state from public.clinical_tasks
            where ((state = 'offered_to_lead' and (pushed_to = p_clinician or lead_clinician_id = p_clinician)) or (state = 'claimed' and claimed_by = p_clinician)) for update loop
    perform set_config('tarragon.task_transition', 'on', true);
    update public.clinical_tasks set lead_clinician_id = case when lead_clinician_id = p_clinician then null else lead_clinician_id end,
           lead_window_ends_at = case when lead_clinician_id = p_clinician then null else lead_window_ends_at end,
           delivery_path = 'pull', pushed_to = null where id = t.id;
    perform set_config('tarragon.task_transition', 'off', true);
    perform private.apply_task_transition(t.id, 'open', 'system', null, p_reason);
    n := n + 1;
  end loop;
  update public.task_claims set ended_at = now(), end_reason = 'cancelled' where clinician_id = p_clinician and ended_at is null;
  return n;
end;
$$;
revoke all on function private.release_removed_clinician_work(uuid, text) from public, anon, authenticated;

create function private.strip_clinician_from_schedule(p_clinician uuid, p_reason text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r public.on_call_rota%rowtype; n integer := 0; v_org uuid;
begin
  perform set_config('tarragon.lead_write', 'on', true);
  update public.availability_blocks set state = 'cancelled'
   where clinician_id = p_clinician and state <> 'cancelled' and ends_at > now();
  for r in select * from public.on_call_rota where cancelled_at is null and ends_at > now()
            and (primary_clinician_id = p_clinician or backup_clinician_id = p_clinician) for update loop
    v_org := r.organisation_id;
    update public.rota_swaps set state = 'cancelled' where rota_id = r.id and state in ('requested', 'accepted');
    if r.backup_clinician_id = p_clinician then
      update public.on_call_rota set backup_clinician_id = null where id = r.id;
    elsif r.backup_clinician_id is not null and private.clinician_eligible_through(r.backup_clinician_id, greatest(r.starts_at, now()), r.ends_at) then
      update public.on_call_rota set primary_clinician_id = r.backup_clinician_id, backup_clinician_id = null where id = r.id;
    else
      update public.on_call_rota set cancelled_at = now(), cancelled_reason = p_reason where id = r.id;
    end if;
    n := n + 1;
  end loop;
  perform set_config('tarragon.lead_write', 'off', true);
  if v_org is not null then perform private.rota_gap_alert(v_org); end if;
  return n;
end;
$$;
revoke all on function private.strip_clinician_from_schedule(uuid, text) from public, anon, authenticated;

-- Everything a removal sets in motion for one clinician. Safe to run twice.
create function private.lead_on_clinician_removed(p_staff uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cs public.clinical_staff%rowtype;
  la record;
  v_reason public.lead_end_reason;
  v_moved integer := 0;
  v_errors integer := 0;
  v_released integer;
  v_rota integer;
begin
  select * into cs from public.clinical_staff where id = p_staff;
  if not found or cs.profile_id is null then return jsonb_build_object('skipped', true); end if;
  for la in select patient_id from public.lead_assignments where clinician_id = cs.profile_id and state = 'active' loop
    begin
      v_reason := private.lead_ineligibility_reason(cs.profile_id, la.patient_id);
      perform private.replace_lead_internal(la.patient_id, cs.profile_id, v_reason, null, 'clinician removed from duty');
      v_moved := v_moved + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (cs.organisation_id, 'lead_reassign.error', 'lead_assignment', la.patient_id, jsonb_build_object('error', sqlerrm, 'clinician_id', cs.profile_id));
    end;
  end loop;
  v_released := private.release_removed_clinician_work(cs.profile_id, 'clinician removed from duty');
  v_rota := private.strip_clinician_from_schedule(cs.profile_id, 'clinician removed from duty');
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'lead_reassign_failed' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (cs.organisation_id, 'clinical', 'sev1', 'Some patients could not be moved to a new lead',
            format('%s patient(s) of a removed clinician could not be reassigned; see audit_log action lead_reassign.error. They may still show the old lead.', v_errors),
            'lead_reassign_failed', now(), now());
  end if;
  return jsonb_build_object('leads_moved', v_moved, 'errors', v_errors, 'tasks_released', v_released, 'rota_rows_changed', v_rota);
end;
$$;
revoke all on function private.lead_on_clinician_removed(uuid) from public, anon, authenticated;

-- The one entry point for the bus handler (service role only).
create function public.lead_on_clinician_event(p_staff uuid, p_event text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cs public.clinical_staff%rowtype;
  v_missing boolean;
  v_result jsonb := '{}'::jsonb;
begin
  select * into cs from public.clinical_staff where id = p_staff;
  if not found then return jsonb_build_object('skipped', true); end if;
  if p_event = 'clinician.suspended' or cs.status <> 'active' or not cs.active then
    -- also covers a suspension event that arrives after a reinstatement: only act on the clinician's live state
    if cs.status <> 'active' or not cs.active then v_result := private.lead_on_clinician_removed(p_staff); end if;
  elsif p_event = 'clinician.competency_changed' then
    v_missing := exists (select 1 from jsonb_array_elements_text(private.lead_rule('required_competencies')) k where not private.has_competency(cs.profile_id, k));
    if v_missing then v_result := private.lead_on_clinician_removed(p_staff); end if;
    if not private.has_competency(cs.profile_id, 'on_call') then
      v_result := v_result || jsonb_build_object('rota_rows_changed', private.strip_clinician_from_schedule(cs.profile_id, 'on-call competency removed'));
    end if;
  end if;
  -- a reinstatement or a new competency can add capacity: try the patients still waiting
  perform private.retry_unassigned_leads();
  return v_result;
end;
$$;

create function public.assign_lead_for_event(p_patient uuid, p_order uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  return private.assign_lead_internal(p_patient, 'order_paid', p_order, null);
end;
$$;

-- Retry every patient still without a lead (a clinician was reinstated or granted the competency, or capacity freed).
create function private.retry_unassigned_leads() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select patient_id from public.lead_assignments where state = 'unassigned' order by started_at loop
    begin
      if private.assign_lead_internal(r.patient_id, 'retry', null, null) is not null then n := n + 1; end if;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        select organisation_id, 'lead_retry.error', 'lead_assignment', r.patient_id, jsonb_build_object('error', sqlerrm)
          from public.profiles where id = r.patient_id;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function private.retry_unassigned_leads() from public, anon, authenticated;

-- Nightly: leads whose clinician drifted out of eligibility, patients still waiting, rota gaps, clinicians over the cap.
create function private.lead_reconcile() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  la record;
  o record;
  v_fixed integer := 0;
  v_errors integer := 0;
  v_retried integer;
  v_cap integer := (private.lead_rule('max_lead_patients') #>> '{}')::integer;
  v_over integer;
begin
  for la in select l.patient_id, l.clinician_id, l.organisation_id from public.lead_assignments l where l.state = 'active' loop
    if not private.lead_valid(la.clinician_id, la.patient_id) then
      begin
        perform private.replace_lead_internal(la.patient_id, la.clinician_id, private.lead_ineligibility_reason(la.clinician_id, la.patient_id), null, 'nightly eligibility check');
        v_fixed := v_fixed + 1;
      exception when others then
        v_errors := v_errors + 1;
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (la.organisation_id, 'lead_reconcile.error', 'lead_assignment', la.patient_id, jsonb_build_object('error', sqlerrm));
      end;
    end if;
  end loop;
  v_retried := private.retry_unassigned_leads();
  for o in select distinct organisation_id from public.clinical_staff loop
    perform private.rota_gap_alert(o.organisation_id);
    perform private.lead_unassigned_alert(o.organisation_id);
  end loop;
  select count(*) into v_over from (
    select clinician_id from public.lead_assignments where state = 'active' and not is_test group by clinician_id
    having count(*) > coalesce((select max_lead_patients from public.clinical_staff cs where cs.profile_id = clinician_id), v_cap)) x;
  if (v_errors > 0 or v_over > 0) and not exists (select 1 from public.ops_incidents where external_reference = 'lead_reconcile' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('clinical', 'sev2', 'Lead clinician check found a problem',
            format('%s patient(s) could not be moved off an ineligible lead; %s clinician(s) are over their lead cap. See audit_log action lead_reconcile.error.', v_errors, v_over),
            'lead_reconcile', now(), now());
  end if;
  return jsonb_build_object('reassigned', v_fixed, 'errors', v_errors, 'retried', v_retried, 'over_cap', v_over);
end;
$$;
revoke all on function private.lead_reconcile() from public, anon, authenticated;

select cron.schedule('lead-reconcile-nightly', '20 5 * * *', $$ select private.lead_reconcile(); $$);
select cron.schedule('lead-retry-unassigned', '*/15 * * * *', $$ select private.retry_unassigned_leads(); $$);

-- Staff actions (admin or chief medical officer), audited and reasoned.
create function public.assign_lead_clinician(p_patient uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  return private.assign_lead_internal(p_patient, 'admin', null, (select auth.uid()));
end;
$$;

create function public.change_lead_clinician(p_patient uuid, p_reason public.lead_end_reason, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_old uuid;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason not in ('clinician_request', 'patient_request', 'capacity_rebalance', 'conflict') then
    raise exception 'use clinician_request, patient_request, capacity_rebalance or conflict' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < (private.lead_rule('override_reason_min_chars') #>> '{}')::integer then
    raise exception 'a written reason is required' using errcode = '22023';
  end if;
  select clinician_id into v_old from public.lead_assignments where patient_id = p_patient and state = 'active';
  if v_old is null then raise exception 'this patient has no active lead' using errcode = '22023'; end if;
  return private.replace_lead_internal(p_patient, v_old, p_reason, (select auth.uid()), btrim(p_note));
end;
$$;

-- Reads
create function public.my_care_team_lead() returns table (lead_name text, photo_url text, status text)
language sql stable security definer set search_path = ''
as $$
  select cs.full_name, cs.photo_url, 'assigned'::text
    from public.lead_assignments la join public.clinical_staff cs on cs.profile_id = la.clinician_id
   where la.patient_id = (select auth.uid()) and la.state = 'active'
  union all
  select null::text, null::text, 'arranging'::text
    from public.lead_assignments la where la.patient_id = (select auth.uid()) and la.state = 'unassigned';
$$;

create function public.my_lead_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_c uuid := private.working_clinician();
begin
  if v_c is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'lead_patients', (select count(*) from public.lead_assignments where clinician_id = v_c and state = 'active' and not is_test),
    'cap', coalesce((select max_lead_patients from public.clinical_staff where profile_id = v_c), (private.lead_rule('max_lead_patients') #>> '{}')::integer),
    'lead_capable', private.has_competency(v_c, 'lead_clinician'));
end;
$$;

-- Capacity and cover for S25 checkout and the S37 go-live guard to read. Nothing here blocks a sale (OQ-118, INV-14).
create function public.lead_capacity_status(p_org uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_cap integer := (private.lead_rule('max_lead_patients') #>> '{}')::integer;
  v_min public.doctor_tier := (private.lead_rule('lead_min_doctor_tier') #>> '{}')::public.doctor_tier;
  v_comps text[] := array(select jsonb_array_elements_text(private.lead_rule('required_competencies')));
  v_total integer;
  v_used integer;
begin
  if not (private.can_credential_review() or (select auth.role()) = 'service_role') then raise exception 'not authorised' using errcode = '42501'; end if;
  v_org := coalesce(p_org, (select organisation_id from public.profiles where id = (select auth.uid())), (select id from public.organisations order by created_at limit 1));
  select coalesce(sum(coalesce(cs.max_lead_patients, v_cap)), 0), coalesce(sum((select count(*) from public.lead_assignments la where la.clinician_id = cs.profile_id and la.state = 'active' and not la.is_test)), 0)
    into v_total, v_used
    from public.clinical_staff cs
   where cs.organisation_id = v_org and cs.profile_id is not null and cs.active and cs.status = 'active' and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(v_min)
     and private.clinician_is_eligible(cs.profile_id)
     and not exists (select 1 from unnest(v_comps) k where not private.has_competency(cs.profile_id, k));
  return jsonb_build_object('capacity', v_total, 'in_use', v_used, 'free', greatest(v_total - v_used, 0),
    'accepting_new_patients', v_total - v_used > 0,
    'unassigned_patients', (select count(*) from public.lead_assignments where organisation_id = v_org and state = 'unassigned'));
end;
$$;

create function public.lead_overview(p_org uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  v_org := coalesce(p_org, (select organisation_id from public.profiles where id = (select auth.uid())), (select id from public.organisations order by created_at limit 1));
  return jsonb_build_object(
    'leads', coalesce((select jsonb_agg(jsonb_build_object('clinician_id', cs.profile_id, 'name', cs.full_name, 'employment_type', cs.employment_type,
                'cap', coalesce(cs.max_lead_patients, (private.lead_rule('max_lead_patients') #>> '{}')::integer),
                'active', (select count(*) from public.lead_assignments la where la.clinician_id = cs.profile_id and la.state = 'active' and not la.is_test))
                order by cs.full_name)
                from public.clinical_staff cs
               where cs.organisation_id = v_org and cs.profile_id is not null and cs.active and cs.status = 'active'
                 and private.has_competency(cs.profile_id, 'lead_clinician')), '[]'::jsonb),
    'unassigned', coalesce((select jsonb_agg(jsonb_build_object('patient_id', patient_id, 'since', started_at) order by started_at)
                              from public.lead_assignments where organisation_id = v_org and state = 'unassigned'), '[]'::jsonb),
    'conflicts_open', (select count(*) from public.clinician_conflicts where organisation_id = v_org and status <> 'lifted'));
end;
$$;

-- A patient with a live lead record is led through the lead functions, which apply the tier, competency, conflict and
-- capacity rules and keep chart access (care_team_assignment, INV-12) and task routing (lead_assignments) in step. A
-- hand edit of care_team_assignment.clinician_id would split the two, so it is refused while a lead record is live.
-- Clearing it (null) is always allowed: that only removes access, and a profile delete does it through the foreign key.
create function private.guard_care_team_lead() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.clinician_id is not null and new.clinician_id is distinct from old.clinician_id
     and coalesce(current_setting('tarragon.lead_write', true), '') <> 'on'
     and exists (select 1 from public.lead_assignments la where la.patient_id = new.patient_id and la.state in ('active', 'unassigned')) then
    raise exception 'this patient''s lead clinician is managed on the rota and lead page: use Change lead there' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_care_team_lead() from public, anon, authenticated;
create trigger care_team_assignment_guard_lead before update of clinician_id on public.care_team_assignment
  for each row execute function private.guard_care_team_lead();

-- ---------------------------------------------------------------------------
-- 10. Subscribers
-- ---------------------------------------------------------------------------
insert into public.event_subscribers (subscriber_key, event_type, handler_key, note) values
  ('lead.on_suspended', 'clinician.suspended', 'lead.clinician_event', 'S18: move a removed clinician''s leads, work, hours and rota'),
  ('lead.on_reinstated', 'clinician.reinstated', 'lead.clinician_event', 'S18: capacity returned, retry patients waiting for a lead'),
  ('lead.on_competency_changed', 'clinician.competency_changed', 'lead.clinician_event', 'S18: lead or on-call competency removed or granted'),
  ('lead.on_order_paid', 'order.paid', 'lead.assign_on_order_paid', 'S18: lead assignment for a paid care pack (S25 emits order.paid)');

-- ---------------------------------------------------------------------------
-- 11. Task routing now honours conflicts, rest and declared hours
-- ---------------------------------------------------------------------------
-- Same as private.pick_employed_clinician (S16) plus: not in post-call rest, no conflict with the patient.
create function private.pick_employed_clinician_for(p_org uuid, p_min public.doctor_tier, p_patient uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.employment_type = 'employed'
     and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(p_min)
     and private.clinician_is_eligible(cs.profile_id)
     and not private.clinician_on_leave(cs.profile_id)
     and not private.clinician_in_post_call_rest(cs.profile_id)
     and not private.has_conflict(cs.profile_id, p_patient)
   order by private.clinician_deprioritised_now(cs.profile_id),
            (select count(*) from public.clinical_tasks ct
              where ct.pushed_to = cs.profile_id and ct.state in ('offered_to_lead', 'open', 'claimed', 'escalated')),
            cs.profile_id
   limit 1;
$$;
revoke all on function private.pick_employed_clinician_for(uuid, public.doctor_tier, uuid) from public, anon, authenticated;

-- Replaces the S16 body: lead from lead_assignments (OQ-111), conflicts, rest and declared hours (OQ-112).
create or replace function private.create_clinical_task(
  p_patient uuid, p_type text, p_due_minutes integer default null, p_dedup_key text default null,
  p_triage_event uuid default null, p_rule_set_version integer default null, p_source_event uuid default null,
  p_extra_competencies text[] default '{}')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  ty public.task_types%rowtype;
  pr public.profiles%rowtype;
  v_due timestamptz;
  v_id uuid;
  v_existing public.clinical_tasks%rowtype;
  v_lead uuid;
  v_push uuid;
  v_window_ends timestamptz;
begin
  select * into ty from public.task_types where code = p_type and is_active;
  if not found or not ty.creatable then raise exception 'unknown or non-creatable task type %', p_type using errcode = '22023'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  v_due := now() + make_interval(mins => coalesce(p_due_minutes, ty.default_due_minutes));

  -- A repeat trigger merges into the live task; the merge is counted and a tighter due time wins. Never dropped silently.
  if p_dedup_key is not null then
    -- A task already claimed is being worked on without the new information, so a repeat must not vanish into it:
    -- it becomes a follow-up task under its own key (a further repeat merges into that one, or into the next).
    loop
      select * into v_existing from public.clinical_tasks
       where dedup_key = p_dedup_key and state not in ('completed', 'cancelled') for update;
      exit when not found or v_existing.state <> 'claimed';
      p_dedup_key := p_dedup_key || '+';
    end loop;
    if found then
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set merged_count = merged_count + 1,
             due_at = case when coalesce((private.queue_setting('dedup_tightens_due'))::boolean, true) then least(due_at, v_due) else due_at end
       where id = v_existing.id;
      perform set_config('tarragon.task_transition', 'off', true);
      return v_existing.id;
    end if;
  end if;

  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
      source_event_id, triage_event_id, rule_set_version, required_competencies, min_tier, due_at, dedup_key, is_test)
  values (pr.organisation_id, ty.code, ty.version, ty.priority_class, ty.priority_class, p_patient,
      p_source_event, p_triage_event, p_rule_set_version,
      (select coalesce(array_agg(distinct c order by c), '{}') from unnest(ty.required_competencies || coalesce(p_extra_competencies, '{}')) c),
      ty.min_doctor_tier, v_due, p_dedup_key, pr.is_test)
  returning id into v_id;
  perform set_config('tarragon.task_transition', 'off', true);

  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, reason, is_test)
  values (pr.organisation_id, v_id, null, 'created', 'system', 'created', pr.is_test);
  perform private.emit_domain_event('clinical_task.created', pr.organisation_id,
    jsonb_build_object('task_id', v_id, 'type', ty.code, 'priority_class', ty.priority_class),
    'clinical_task.created:' || v_id, p_patient, 'clinical_task', v_id);

  -- Where it goes first. A red-class task never waits (INV-05).
  if ty.priority_class > 1 and ty.lead_window_minutes > 0 then
    -- S18 (OQ-111): the patient's lead clinician; care_team_assignment is only the fallback for patients with no lead row.
    select coalesce(
             (select la.clinician_id from public.lead_assignments la where la.patient_id = p_patient and la.state = 'active'),
             (select cta.clinician_id from public.care_team_assignment cta where cta.patient_id = p_patient))
      into v_lead;
    -- S18 (OQ-112): working hours and post-call rest for contracted clinicians; never offered to a conflicted clinician.
    if v_lead is not null
       and private.clinician_offerable(v_lead, now(), least(v_due, now() + make_interval(mins => ty.lead_window_minutes)))
       and not private.has_conflict(v_lead, p_patient)
       and exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.doctor_tier is not null
                    and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ty.min_doctor_tier)) then
            v_window_ends := least(v_due, now() + make_interval(mins => ty.lead_window_minutes));
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set lead_clinician_id = v_lead, lead_window_ends_at = v_window_ends where id = v_id;
      if exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.employment_type = 'employed') and ty.pushable then
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_lead where id = v_id;
      end if;
      perform set_config('tarragon.task_transition', 'off', true);
      perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'offered to the named clinician');
      return v_id;
    end if;
    if ty.pushable then
      v_push := private.pick_employed_clinician_for(pr.organisation_id, ty.min_doctor_tier, p_patient);
      if v_push is not null then
        v_window_ends := least(v_due, now() + make_interval(mins => ty.lead_window_minutes));
        perform set_config('tarragon.task_transition', 'on', true);
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_push, lead_window_ends_at = v_window_ends where id = v_id;
        perform set_config('tarragon.task_transition', 'off', true);
        perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'pushed to an employed doctor');
        return v_id;
      end if;
    end if;
  end if;
  perform private.apply_task_transition(v_id, 'open', 'system', null, 'to the pool');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11b. Reads for the screens
-- ---------------------------------------------------------------------------
-- Colleagues a clinician may ask to cover an on-call shift.
create function public.on_call_colleagues() returns table (clinician_id uuid, name text)
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id, cs.full_name
    from public.clinical_staff cs
   where private.working_clinician() is not null and cs.profile_id is not null and cs.profile_id <> (select auth.uid())
     and cs.organisation_id = (select organisation_id from public.clinical_staff where profile_id = (select auth.uid()))
     and cs.active and cs.status = 'active' and private.has_competency(cs.profile_id, 'on_call') and private.clinician_is_eligible(cs.profile_id)
   order by cs.full_name;
$$;

-- The swaps a clinician is part of (asked of them, or asked by them), still open.
create function public.my_rota_swaps() returns table (id uuid, rota_id uuid, role text, state public.rota_swap_state, reason text,
  from_name text, to_name text, direction text, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.rota_id, s.role, s.state, s.reason,
         (select full_name from public.clinical_staff where profile_id = s.from_clinician),
         (select full_name from public.clinical_staff where profile_id = s.to_clinician),
         case when s.to_clinician = (select auth.uid()) then 'incoming' else 'outgoing' end, r.starts_at, r.ends_at
    from public.rota_swaps s join public.on_call_rota r on r.id = s.rota_id
   where private.working_clinician() is not null and s.state in ('requested', 'accepted')
     and (s.from_clinician = (select auth.uid()) or s.to_clinician = (select auth.uid()))
   order by r.starts_at;
$$;

-- Everything the rota builder shows, in one call (admin or chief medical officer).
create function public.rota_overview(p_from timestamptz default now(), p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_to timestamptz := coalesce(p_to, p_from + make_interval(days => (private.lead_rule('rota_horizon_days') #>> '{}')::integer));
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  v_org := coalesce((select organisation_id from public.profiles where id = (select auth.uid())), (select id from public.organisations order by created_at limit 1));
  return jsonb_build_object(
    'status', public.on_call_cover_status(v_org),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
                'primary_id', r.primary_clinician_id, 'primary_name', (select full_name from public.clinical_staff where profile_id = r.primary_clinician_id),
                'backup_id', r.backup_clinician_id, 'backup_name', (select full_name from public.clinical_staff where profile_id = r.backup_clinician_id),
                'warnings', to_jsonb(r.warnings), 'override_reason', r.override_reason) order by r.starts_at)
                from public.on_call_rota r where r.organisation_id = v_org and r.cancelled_at is null and r.ends_at > p_from and r.starts_at < v_to), '[]'::jsonb),
    'pending_blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'clinician_id', b.clinician_id,
                'name', (select full_name from public.clinical_staff where profile_id = b.clinician_id), 'starts_at', b.starts_at, 'ends_at', b.ends_at) order by b.starts_at)
                from public.availability_blocks b where b.organisation_id = v_org and b.kind = 'on_call' and b.state = 'declared' and b.ends_at > now()), '[]'::jsonb),
    'swaps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rota_id', s.rota_id, 'role', s.role, 'state', s.state, 'reason', s.reason,
                'from_name', (select full_name from public.clinical_staff where profile_id = s.from_clinician),
                'to_name', (select full_name from public.clinical_staff where profile_id = s.to_clinician)) order by s.created_at)
                from public.rota_swaps s where s.organisation_id = v_org and s.state in ('requested', 'accepted')), '[]'::jsonb),
    'clinicians', coalesce((select jsonb_agg(jsonb_build_object('id', cs.profile_id, 'name', cs.full_name, 'employment_type', cs.employment_type) order by cs.full_name)
                from public.clinical_staff cs where cs.organisation_id = v_org and cs.profile_id is not null and cs.active and cs.status = 'active'
                  and private.has_competency(cs.profile_id, 'on_call') and private.clinician_is_eligible(cs.profile_id)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Privileges: nothing is callable by anon or PUBLIC; signed-in staff and clinicians get only their own entry points
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.confirm_availability_block(uuid)',
    'public.my_availability_blocks(timestamptz, timestamptz)',
    'public.set_on_call_rota(timestamptz, timestamptz, uuid, uuid, text)', 'public.cancel_on_call_rota(uuid, text)',
    'public.rota_coverage_gaps(uuid, timestamptz, timestamptz)', 'public.on_call_cover_status(uuid)', 'public.my_rota(timestamptz, timestamptz)',
    'public.request_rota_swap(uuid, text, uuid, text)', 'public.respond_rota_swap(uuid, boolean)', 'public.cancel_rota_swap(uuid)',
    'public.approve_rota_swap(uuid, text)',
    'public.assign_lead_clinician(uuid)', 'public.change_lead_clinician(uuid, public.lead_end_reason, text)',
    'public.my_care_team_lead()', 'public.my_lead_summary()', 'public.lead_capacity_status(uuid)', 'public.lead_overview(uuid)',
    'public.on_call_colleagues()', 'public.rota_overview(timestamptz, timestamptz)', 'public.my_rota_swaps()',
    'public.lead_on_clinician_event(uuid, text)', 'public.assign_lead_for_event(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.confirm_availability_block(uuid)',
    'public.my_availability_blocks(timestamptz, timestamptz)',
    'public.set_on_call_rota(timestamptz, timestamptz, uuid, uuid, text)', 'public.cancel_on_call_rota(uuid, text)',
    'public.rota_coverage_gaps(uuid, timestamptz, timestamptz)', 'public.on_call_cover_status(uuid)', 'public.my_rota(timestamptz, timestamptz)',
    'public.request_rota_swap(uuid, text, uuid, text)', 'public.respond_rota_swap(uuid, boolean)', 'public.cancel_rota_swap(uuid)',
    'public.approve_rota_swap(uuid, text)',
    'public.assign_lead_clinician(uuid)', 'public.change_lead_clinician(uuid, public.lead_end_reason, text)',
    'public.my_care_team_lead()', 'public.my_lead_summary()', 'public.lead_capacity_status(uuid)', 'public.lead_overview(uuid)',
    'public.on_call_colleagues()', 'public.rota_overview(timestamptz, timestamptz)', 'public.my_rota_swaps()'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- the S25 checkout and S37 guard read these as the service role as well
  grant execute on function public.rota_coverage_gaps(uuid, timestamptz, timestamptz) to service_role;
  grant execute on function public.on_call_cover_status(uuid) to service_role;
  grant execute on function public.lead_capacity_status(uuid) to service_role;
  grant execute on function public.lead_on_clinician_event(uuid, text) to service_role;
  grant execute on function public.assign_lead_for_event(uuid, uuid) to service_role;
end $$;
revoke all on function private.create_clinical_task(uuid, text, integer, text, uuid, integer, uuid, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Self-check: the migration proves its own shape (the proof script covers behaviour)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('availability_blocks', 'clinician_conflicts', 'on_call_rota', 'rota_swaps', 'lead_assignments', 'lead_config')
                and grantee in ('anon', 'PUBLIC')) then
    raise exception 'S18: anon or PUBLIC has table privileges';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('availability_blocks', 'clinician_conflicts', 'on_call_rota', 'rota_swaps', 'lead_assignments', 'lead_config')
                and grantee = 'authenticated' and privilege_type <> 'SELECT') then
    raise exception 'S18: authenticated has a write privilege on an S18 table';
  end if;
  if has_function_privilege('anon', 'public.set_on_call_rota(timestamptz, timestamptz, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.lead_on_clinician_event(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.lead_on_clinician_event(uuid, text)', 'EXECUTE') then
    raise exception 'S18: a function is callable by the wrong role';
  end if;
  if (select count(*) from public.lead_config where is_active) <> 1 then raise exception 'S18: lead_config needs exactly one active version'; end if;
end $$;
