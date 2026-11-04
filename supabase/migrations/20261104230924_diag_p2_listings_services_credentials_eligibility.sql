-- Verified lab and imaging directory, Phase 2a: listings, branch services, credentials, incidents, eligibility.
-- Design: docs/plans/diagnostic-directory-design-2026-11-04.md §5, §8, §10 (stage 1), §11. Decisions DIR-1 to DIR-3.
-- Builds on Phase 1 (20261104225509: investigation concepts on reference_concepts).
--
-- SHAPE
--   * A LISTING is separate from a CONTRACT. lab_providers / imaging_providers.is_active keeps meaning "contracted,
--     routable, billable" (private.resolve_lab_order_provider falls back to "the single active laboratory", so a
--     directory-only lab must never become is_active). Directory state lives in two 1:1 extension tables:
--       diagnostic_provider_listings  -> one per lab_providers OR imaging_providers row
--       diagnostic_branch_listings    -> one per lab_provider_locations OR imaging_provider_locations row
--     They use real foreign keys (one of two columns), not a text "kind + id" pair. No fourth location model: address,
--     state, phone and coordinates stay on the existing branch tables.
--   * diagnostic_branch_services: one row per branch per investigation concept (Phase 1 catalogue). No price column.
--   * diagnostic_credentials: regulator credentials at provider or branch level, with scope, expiry, evidence and
--     verifier. diagnostic_credential_requirements (versioned operational setting) says which regulators each kind
--     of investigation needs. diagnostic_directory_settings (versioned) holds the re-confirmation cadences.
--   * diagnostic_listing_incidents: complaint -> decision -> corrective action -> reinstatement, at provider, branch or
--     service scope. An open incident marked "suspends" removes that scope at once.
--   * diagnostic_directory_events: append-only audit of every material change (who, what, from, to, why).
--   * private.diagnostic_service_eligibility(service_id) returns the list of reasons a service is NOT eligible (empty
--     = eligible). Expiry and staleness are evaluated when it runs, so an expired credential drops a service with no
--     cron. Phase 3's search will call it; nothing patient-facing reads these tables in this phase.
--
-- WRITE PATH: tables have NO insert/update/delete policies. Every write goes through a SECURITY DEFINER admin_dx_*
-- function that checks private.can_verify_diagnostic_directory() (admin, or the new permission
-- 'directory.diagnostic.verify') and writes an event. A lab partner's existing right to edit its own
-- lab_provider_locations row therefore cannot list it, verify it, or add a credential.
--
-- REGULATOR REQUIREMENTS SEEDED (an operational setting under G-01: versioned, audited, change note, no CMO signature):
--   laboratory            -> MLSCN registration (provider or branch)
--   ionising_imaging      -> NNRA authorisation (branch) + state facility licence (branch)   [X-ray, CT, mammography, DEXA]
--   non_ionising_imaging  -> state facility licence (branch)                                  [ultrasound, MRI, echo]
--   clinical_procedure    -> state facility licence (branch)                                  [ECG, endoscopy, physiology]
--
-- Reader audit (2026-11-04): every patient-facing, routing and billing reader of lab_providers / lab_provider_locations
-- already filters on is_active, so a listed-but-uncontracted lab cannot become orderable or billable. The one unguarded
-- path, partner imaging orders, gets a trigger in section 9b. Admin analytics that list every provider will need a
-- directory_status filter once many listings exist (Phase 2b).
--
-- Counts at write time (live 2026-11-04): every new table is empty; nothing is listed, so nothing becomes visible.
-- lab_providers 4 (1 active: Synlab), lab_provider_locations 39, imaging_providers 0, imaging_provider_locations 0.

-- ---------------------------------------------------------------------------
-- 0. Who may verify
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description)
values ('directory.diagnostic.verify', 'Verify diagnostic directory', 'Partners',
        'List laboratories and imaging centres, confirm their services, record and verify regulator credentials, and open or close listing incidents')
on conflict (key) do nothing;

create or replace function private.can_verify_diagnostic_directory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or private.has_permission('directory.diagnostic.verify');
$$;
revoke all on function private.can_verify_diagnostic_directory() from public;
grant execute on function private.can_verify_diagnostic_directory() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Versioned settings and requirements
-- ---------------------------------------------------------------------------
create table public.diagnostic_directory_settings (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null unique check (version > 0),
  is_active    boolean not null default false,
  rules        jsonb not null,
  change_note  text not null check (char_length(btrim(change_note)) >= 10),
  changed_by   uuid references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now()
);
create unique index diagnostic_directory_settings_one_active on public.diagnostic_directory_settings (is_active) where is_active;
comment on table public.diagnostic_directory_settings is
  'Versioned operational setting for the diagnostic directory. Mirrors proposed-config "directory.diagnostic_cadence".';

-- diag-settings-v1-begin
insert into public.diagnostic_directory_settings (version, is_active, rules, change_note)
values (1, true,
        '{"service_confirm_days": 90, "contact_confirm_days": 90, "stale_multiple": 2, "credential_due_soon_days": 30}'::jsonb,
        'Initial cadences from the directory design (services and contacts every 3 months; hidden at twice that, like S65)');
-- diag-settings-v1-end

create or replace function private.diagnostic_directory_rule(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (rules ->> p_key)::integer from public.diagnostic_directory_settings where is_active;
$$;
revoke all on function private.diagnostic_directory_rule(text) from public;

create table public.diagnostic_credential_requirements (
  id                 uuid primary key default gen_random_uuid(),
  requirement_group  text not null check (requirement_group in ('laboratory', 'ionising_imaging', 'non_ionising_imaging', 'clinical_procedure')),
  regulator          text not null,
  level              text not null check (level in ('branch', 'provider_or_branch')),
  is_active          boolean not null default true,
  change_note        text not null check (char_length(btrim(change_note)) >= 10),
  changed_by         uuid references public.profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),
  retired_at         timestamptz,
  retired_by         uuid references public.profiles (id) on delete restrict,
  constraint diagnostic_credential_requirements_retired check (is_active = (retired_at is null))
);
create unique index diagnostic_credential_requirements_one_active
  on public.diagnostic_credential_requirements (requirement_group, regulator) where is_active;

-- ---------------------------------------------------------------------------
-- 2. Listings (1:1 extensions of the existing provider and branch tables)
-- ---------------------------------------------------------------------------
create table public.diagnostic_provider_listings (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid references public.organisations (id) on delete set null,
  lab_provider_id     uuid unique references public.lab_providers (id) on delete restrict,
  imaging_provider_id uuid unique references public.imaging_providers (id) on delete restrict,
  directory_status    text not null default 'draft' check (directory_status in ('draft', 'listed', 'suspended', 'deactivated')),
  status_changed_at   timestamptz,
  status_changed_by   uuid references public.profiles (id) on delete restrict,
  status_reason       text,
  is_test             boolean not null default false,
  created_by          uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint diagnostic_provider_listings_one_kind check ((lab_provider_id is null) <> (imaging_provider_id is null)),
  constraint diagnostic_provider_listings_listed_attributed check (
    directory_status = 'draft' or (status_changed_at is not null and status_changed_by is not null))
);

create table public.diagnostic_branch_listings (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid references public.organisations (id) on delete set null,
  provider_listing_id  uuid not null references public.diagnostic_provider_listings (id) on delete restrict,
  lab_location_id      uuid unique references public.lab_provider_locations (id) on delete restrict,
  imaging_location_id  uuid unique references public.imaging_provider_locations (id) on delete restrict,
  lga                  text check (lga is null or char_length(btrim(lga)) between 2 and 80),
  town                 text check (town is null or char_length(btrim(town)) between 2 and 80),
  neighbourhood        text check (neighbourhood is null or char_length(btrim(neighbourhood)) between 2 and 80),
  email                text check (email is null or email ~* '^[^@ ]+@[^@ ]+\.[^@ ]+$'),
  website              text check (website is null or website ~* '^https?://[^ ]+$'),
  location_verified_at timestamptz,
  location_verified_by uuid references public.profiles (id) on delete restrict,
  location_source      text,
  hours_verified_at    timestamptz,
  hours_verified_by    uuid references public.profiles (id) on delete restrict,
  directory_status     text not null default 'draft' check (directory_status in ('draft', 'listed', 'suspended', 'deactivated')),
  status_changed_at    timestamptz,
  status_changed_by    uuid references public.profiles (id) on delete restrict,
  status_reason        text,
  is_test              boolean not null default false,
  created_by           uuid references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint diagnostic_branch_listings_one_kind check ((lab_location_id is null) <> (imaging_location_id is null)),
  constraint diagnostic_branch_listings_location_attributed check ((location_verified_at is null) = (location_verified_by is null)),
  constraint diagnostic_branch_listings_hours_attributed check ((hours_verified_at is null) = (hours_verified_by is null)),
  constraint diagnostic_branch_listings_listed_needs_location check (directory_status <> 'listed' or location_verified_at is not null),
  constraint diagnostic_branch_listings_status_attributed check (
    directory_status = 'draft' or (status_changed_at is not null and status_changed_by is not null))
);
create index diagnostic_branch_listings_provider_idx on public.diagnostic_branch_listings (provider_listing_id);

comment on table public.diagnostic_provider_listings is
  'Directory state of a lab or imaging provider. Separate from lab_providers.is_active (contracted/billable): a listed provider may be uncontracted.';
comment on table public.diagnostic_branch_listings is
  'Directory state of one branch (lab_provider_locations or imaging_provider_locations row). Address, state, phone and coordinates stay on the branch table.';

-- A branch listing must belong to the provider listing of its own provider, and be of the same kind.
create or replace function private.diagnostic_branch_listing_matches_provider()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p public.diagnostic_provider_listings%rowtype;
  v_ok boolean;
begin
  select * into p from public.diagnostic_provider_listings where id = new.provider_listing_id;
  if new.lab_location_id is not null then
    select p.lab_provider_id is not null and exists (
      select 1 from public.lab_provider_locations l where l.id = new.lab_location_id and l.lab_provider_id = p.lab_provider_id)
      into v_ok;
  else
    select p.imaging_provider_id is not null and exists (
      select 1 from public.imaging_provider_locations l where l.id = new.imaging_location_id and l.imaging_provider_id = p.imaging_provider_id)
      into v_ok;
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'branch listing must belong to its own provider''s listing' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.diagnostic_branch_listing_matches_provider() from public;
create trigger diagnostic_branch_listings_match_provider
  before insert or update of provider_listing_id, lab_location_id, imaging_location_id on public.diagnostic_branch_listings
  for each row execute function private.diagnostic_branch_listing_matches_provider();

-- ---------------------------------------------------------------------------
-- 3. Branch services
-- ---------------------------------------------------------------------------
create table public.diagnostic_branch_services (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid references public.organisations (id) on delete set null,
  branch_listing_id           uuid not null references public.diagnostic_branch_listings (id) on delete restrict,
  concept_id                  uuid not null references public.reference_concepts (id) on delete restrict,
  availability                text not null check (availability in ('available', 'temporarily_unavailable', 'by_appointment',
                                                                   'external_referral', 'awaiting_confirmation', 'discontinued')),
  performed                   text not null check (performed in ('onsite', 'other_branch_same_provider', 'external_facility')),
  performing_branch_listing_id uuid references public.diagnostic_branch_listings (id) on delete restrict,
  appointment_required        boolean not null default false,
  preparation_note            text check (preparation_note is null or char_length(preparation_note) <= 1000),
  equipment_note              text check (equipment_note is null or char_length(equipment_note) <= 500),
  confirmed_at                timestamptz not null,
  confirmed_by                uuid not null references public.profiles (id) on delete restrict,
  evidence_source             text not null check (char_length(btrim(evidence_source)) >= 5),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint diagnostic_branch_services_one unique (branch_listing_id, concept_id),
  constraint diagnostic_branch_services_performer check (
    (performed = 'onsite' and performing_branch_listing_id is null)
    or (performed = 'other_branch_same_provider' and performing_branch_listing_id is not null)
    or performed = 'external_facility'),
  constraint diagnostic_branch_services_not_self check (performing_branch_listing_id is distinct from branch_listing_id)
);
create index diagnostic_branch_services_concept_idx on public.diagnostic_branch_services (concept_id, availability);
comment on table public.diagnostic_branch_services is
  'What one branch actually does, per investigation, confirmed by a named person with evidence. No price column on purpose: patients contact the facility for current pricing. Re-confirmation is due at confirmed_at + the active service_confirm_days (derived, never stored, so a cadence change applies everywhere at once).';

-- ---------------------------------------------------------------------------
-- 4. Credentials
-- ---------------------------------------------------------------------------
create table public.diagnostic_credentials (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid references public.organisations (id) on delete set null,
  provider_listing_id  uuid references public.diagnostic_provider_listings (id) on delete restrict,
  branch_listing_id    uuid references public.diagnostic_branch_listings (id) on delete restrict,
  regulator            text not null check (regulator in ('mlscn_registration', 'iso15189', 'nnra_authorisation',
                                                         'state_facility_licence', 'rrbn', 'mdcn', 'other')),
  issuer               text not null check (char_length(btrim(issuer)) between 2 and 160),
  accreditation_body   text,
  state                text,
  identifier           text check (identifier is null or char_length(btrim(identifier)) between 1 and 120),
  scope_concept_ids    uuid[],
  scope_note           text,
  issued_on            date,
  expires_on           date,
  source_url           text check (source_url is null or source_url ~* '^https?://[^ ]+$'),
  evidence_path        text check (evidence_path is null or char_length(btrim(evidence_path)) between 3 and 400),
  status               text not null default 'pending' check (status in (
                         'verified_current', 'pending', 'registered_accreditation_unverified', 'accreditation_verified',
                         'scope_partially_verified', 'expired', 'suspended', 'withdrawn', 'failed', 'unverified')),
  recorded_by          uuid not null references public.profiles (id) on delete restrict,
  recorded_at          timestamptz not null default now(),
  verified_by          uuid references public.profiles (id) on delete restrict,
  verified_at          timestamptz,
  verification_note    text,
  next_verify_due      date,
  status_reason        text,
  updated_at           timestamptz not null default now(),
  constraint diagnostic_credentials_one_subject check ((provider_listing_id is null) <> (branch_listing_id is null)),
  constraint diagnostic_credentials_has_source check (source_url is not null or evidence_path is not null),
  constraint diagnostic_credentials_dates check (expires_on is null or issued_on is null or expires_on >= issued_on),
  constraint diagnostic_credentials_identifier_required check (
    regulator not in ('mlscn_registration', 'nnra_authorisation', 'state_facility_licence', 'iso15189') or identifier is not null),
  -- ISO 15189 is never inferred from a quality policy: it needs the accrediting body, an identifier and a stated scope.
  constraint diagnostic_credentials_iso_complete check (
    regulator <> 'iso15189' or (accreditation_body is not null and cardinality(coalesce(scope_concept_ids, '{}')) > 0)),
  constraint diagnostic_credentials_state_licence_state check (regulator <> 'state_facility_licence' or state is not null),
  constraint diagnostic_credentials_partial_scope check (
    status <> 'scope_partially_verified' or cardinality(coalesce(scope_concept_ids, '{}')) > 0),
  constraint diagnostic_credentials_verified_attributed check (
    status in ('pending', 'unverified')
    or (verified_by is not null and verified_at is not null and char_length(btrim(coalesce(verification_note, ''))) >= 10))
);
create index diagnostic_credentials_provider_idx on public.diagnostic_credentials (provider_listing_id) where provider_listing_id is not null;
create index diagnostic_credentials_branch_idx on public.diagnostic_credentials (branch_listing_id) where branch_listing_id is not null;
create index diagnostic_credentials_expiry_idx on public.diagnostic_credentials (expires_on) where expires_on is not null;

-- ---------------------------------------------------------------------------
-- 5. Incidents and the audit trail
-- ---------------------------------------------------------------------------
create table public.diagnostic_listing_incidents (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid references public.organisations (id) on delete set null,
  provider_listing_id    uuid references public.diagnostic_provider_listings (id) on delete restrict,
  branch_listing_id      uuid references public.diagnostic_branch_listings (id) on delete restrict,
  service_id             uuid references public.diagnostic_branch_services (id) on delete restrict,
  severity               text not null check (severity in ('serious', 'routine')),
  description            text not null check (char_length(btrim(description)) >= 20),
  suspends               boolean not null,
  status                 text not null default 'open' check (status in ('open', 'closed')),
  opened_by              uuid not null references public.profiles (id) on delete restrict,
  opened_at              timestamptz not null default now(),
  decision               text,
  corrective_action      text,
  reinstated             boolean,
  closed_by              uuid references public.profiles (id) on delete restrict,
  closed_at              timestamptz,
  constraint diagnostic_listing_incidents_one_scope check (
    num_nonnulls(provider_listing_id, branch_listing_id, service_id) = 1),
  constraint diagnostic_listing_incidents_closed check (
    status = 'open' or (closed_by is not null and closed_at is not null and char_length(btrim(coalesce(decision, ''))) >= 10
                        and reinstated is not null)),
  -- A serious concern always suspends the affected scope while it is investigated.
  constraint diagnostic_listing_incidents_serious_suspends check (severity <> 'serious' or suspends)
);
create index diagnostic_listing_incidents_open_idx on public.diagnostic_listing_incidents (status) where status = 'open';

create table public.diagnostic_directory_events (
  id            uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete set null,
  subject_table text not null,
  subject_id    uuid not null,
  action        text not null,
  from_value    text,
  to_value      text,
  note          text,
  actor         uuid references public.profiles (id) on delete restrict,
  at            timestamptz not null default now()
);
create index diagnostic_directory_events_subject_idx on public.diagnostic_directory_events (subject_table, subject_id, at desc);

create or replace function private.diagnostic_directory_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'diagnostic_directory_events is append-only' using errcode = '42501';
end;
$$;
revoke all on function private.diagnostic_directory_events_immutable() from public;
create trigger diagnostic_directory_events_no_change
  before update or delete on public.diagnostic_directory_events
  for each row execute function private.diagnostic_directory_events_immutable();

create or replace function private.diagnostic_log(p_table text, p_id uuid, p_action text, p_from text, p_to text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.diagnostic_directory_events (subject_table, subject_id, action, from_value, to_value, note, actor)
  values (p_table, p_id, p_action, p_from, p_to, p_note, auth.uid());
$$;
revoke all on function private.diagnostic_log(text, uuid, text, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- 6. RLS: verifiers read; nobody writes directly (writes are the admin_dx_* functions below)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['diagnostic_directory_settings', 'diagnostic_credential_requirements', 'diagnostic_provider_listings',
                           'diagnostic_branch_listings', 'diagnostic_branch_services', 'diagnostic_credentials',
                           'diagnostic_listing_incidents', 'diagnostic_directory_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_verify_diagnostic_directory())',
                   t || '_select_verifiers', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Eligibility
-- ---------------------------------------------------------------------------
create or replace function private.diagnostic_requirement_group(p_concept_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when c.domain = 'lab_test' then 'laboratory'
           when c.modality in ('xray', 'ct', 'mammography') or c.investigation_category = 'other_imaging' then 'ionising_imaging'
           when c.modality in ('ultrasound', 'mri', 'echocardiography') then 'non_ionising_imaging'
           else 'clinical_procedure'
         end
    from public.reference_concepts c
   where c.id = p_concept_id;
$$;
revoke all on function private.diagnostic_requirement_group(uuid) from public;

-- Returns the reasons a service is NOT eligible to be recommended. An empty array means eligible.
create or replace function private.diagnostic_service_eligibility(p_service_id uuid, p_depth integer default 0)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s   public.diagnostic_branch_services%rowtype;
  b   public.diagnostic_branch_listings%rowtype;
  p   public.diagnostic_provider_listings%rowtype;
  v_reasons text[] := '{}';
  v_today date := private.lagos_today();
  v_stale_days integer;
  v_branch_active boolean;
  v_phone text;
  v_lat double precision;
  v_state text;
  v_group text;
  r record;
  v_perf uuid;
begin
  select * into s from public.diagnostic_branch_services where id = p_service_id;
  if s.id is null then
    return array['service_not_found'];
  end if;
  select * into b from public.diagnostic_branch_listings where id = s.branch_listing_id;
  select * into p from public.diagnostic_provider_listings where id = b.provider_listing_id;

  -- Provider
  if p.directory_status <> 'listed' then v_reasons := v_reasons || 'provider_not_listed'::text; end if;
  if exists (select 1 from public.diagnostic_listing_incidents i
              where i.provider_listing_id = p.id and i.status = 'open' and i.suspends) then
    v_reasons := v_reasons || 'provider_incident_open'::text;
  end if;

  -- Branch
  if b.lab_location_id is not null then
    select l.is_active, l.contact_phone, l.latitude, l.state into v_branch_active, v_phone, v_lat, v_state
      from public.lab_provider_locations l where l.id = b.lab_location_id;
  else
    select l.is_active, l.contact_phone, l.latitude, l.state into v_branch_active, v_phone, v_lat, v_state
      from public.imaging_provider_locations l where l.id = b.imaging_location_id;
  end if;
  if b.directory_status <> 'listed' then v_reasons := v_reasons || 'branch_not_listed'::text; end if;
  if not coalesce(v_branch_active, false) then v_reasons := v_reasons || 'branch_closed'::text; end if;
  if v_phone is null then v_reasons := v_reasons || 'branch_missing_phone'::text; end if;
  if v_lat is null then v_reasons := v_reasons || 'branch_missing_coordinates'::text; end if;
  v_stale_days := private.diagnostic_directory_rule('contact_confirm_days') * private.diagnostic_directory_rule('stale_multiple');
  if b.location_verified_at is null then
    v_reasons := v_reasons || 'branch_location_unverified'::text;
  elsif b.location_verified_at < now() - make_interval(days => v_stale_days) then
    v_reasons := v_reasons || 'branch_location_stale'::text;
  end if;
  if exists (select 1 from public.diagnostic_listing_incidents i
              where i.branch_listing_id = b.id and i.status = 'open' and i.suspends) then
    v_reasons := v_reasons || 'branch_incident_open'::text;
  end if;

  -- Service
  if s.availability not in ('available', 'by_appointment') then v_reasons := v_reasons || ('service_' || s.availability); end if;
  v_stale_days := private.diagnostic_directory_rule('service_confirm_days') * private.diagnostic_directory_rule('stale_multiple');
  if s.confirmed_at < now() - make_interval(days => v_stale_days) then v_reasons := v_reasons || 'service_stale'::text; end if;
  if exists (select 1 from public.diagnostic_listing_incidents i
              where i.service_id = s.id and i.status = 'open' and i.suspends) then
    v_reasons := v_reasons || 'service_incident_open'::text;
  end if;

  -- Who actually performs it: must be known, done onsite there, and itself eligible.
  if s.performed <> 'onsite' then
    if s.performing_branch_listing_id is null then
      v_reasons := v_reasons || 'performer_unknown'::text;
    elsif p_depth > 0 then
      v_reasons := v_reasons || 'performer_chain'::text;
    else
      select ps.id into v_perf from public.diagnostic_branch_services ps
       where ps.branch_listing_id = s.performing_branch_listing_id and ps.concept_id = s.concept_id and ps.performed = 'onsite';
      if v_perf is null then
        v_reasons := v_reasons || 'performer_not_onsite'::text;
      elsif cardinality(private.diagnostic_service_eligibility(v_perf, p_depth + 1)) > 0 then
        v_reasons := v_reasons || 'performer_ineligible'::text;
      end if;
    end if;
  end if;

  -- Credentials required for this kind of investigation, checked at the level the regulator licenses.
  v_group := private.diagnostic_requirement_group(s.concept_id);
  for r in select q.regulator, q.level from public.diagnostic_credential_requirements q
            where q.is_active and q.requirement_group = v_group
  loop
    if not exists (
      select 1 from public.diagnostic_credentials c
       where c.regulator = r.regulator
         and (c.branch_listing_id = b.id or (r.level = 'provider_or_branch' and c.provider_listing_id = p.id))
         and (c.expires_on is null or c.expires_on >= v_today)
         and (r.regulator <> 'state_facility_licence' or lower(btrim(c.state)) = lower(btrim(v_state)))
         and (
           (c.status in ('verified_current', 'accreditation_verified')
              and (c.scope_concept_ids is null or s.concept_id = any (c.scope_concept_ids)))
           or (c.status = 'registered_accreditation_unverified'
              and c.regulator in ('mlscn_registration', 'nnra_authorisation', 'state_facility_licence'))
           or (c.status = 'scope_partially_verified' and s.concept_id = any (c.scope_concept_ids))
         )
    ) then
      v_reasons := v_reasons || ('missing_credential:' || r.regulator);
    end if;
  end loop;

  return v_reasons;
end;
$$;
revoke all on function private.diagnostic_service_eligibility(uuid, integer) from public;

create or replace function private.diagnostic_service_eligible(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(private.diagnostic_service_eligibility(p_service_id)) = 0;
$$;
revoke all on function private.diagnostic_service_eligible(uuid) from public;

-- Credential status as a reader should see it today (a "verified" credential past its expiry reads as expired).
create or replace function private.diagnostic_credential_effective_status(p_status text, p_expires_on date)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_expires_on is not null and p_expires_on < private.lagos_today()
                   and p_status not in ('suspended', 'withdrawn', 'failed') then 'expired'
              else p_status end;
$$;
revoke all on function private.diagnostic_credential_effective_status(text, date) from public;

-- ---------------------------------------------------------------------------
-- 8. Admin write functions (the only write path)
-- ---------------------------------------------------------------------------
create or replace function private.diagnostic_require_verifier()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_verify_diagnostic_directory() then
    raise exception 'only a directory verifier may do this' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.diagnostic_require_verifier() from public;

create or replace function public.admin_dx_create_provider_listing(p_kind text, p_provider_id uuid, p_is_test boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.diagnostic_require_verifier();
  if p_kind = 'lab' then
    if not exists (select 1 from public.lab_providers where id = p_provider_id) then raise exception 'unknown lab provider' using errcode = '23503'; end if;
    insert into public.diagnostic_provider_listings (lab_provider_id, is_test, created_by) values (p_provider_id, p_is_test, auth.uid()) returning id into v_id;
  elsif p_kind = 'imaging' then
    if not exists (select 1 from public.imaging_providers where id = p_provider_id) then raise exception 'unknown imaging provider' using errcode = '23503'; end if;
    insert into public.diagnostic_provider_listings (imaging_provider_id, is_test, created_by) values (p_provider_id, p_is_test, auth.uid()) returning id into v_id;
  else
    raise exception 'kind must be lab or imaging' using errcode = '22023';
  end if;
  perform private.diagnostic_log('diagnostic_provider_listings', v_id, 'created', null, 'draft', null);
  return v_id;
end;
$$;

create or replace function public.admin_dx_upsert_branch_listing(
  p_provider_listing_id uuid, p_location_id uuid, p_lga text default null, p_town text default null,
  p_neighbourhood text default null, p_email text default null, p_website text default null, p_is_test boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.diagnostic_provider_listings%rowtype;
  v_id uuid;
begin
  perform private.diagnostic_require_verifier();
  select * into p from public.diagnostic_provider_listings where id = p_provider_listing_id;
  if p.id is null then raise exception 'unknown provider listing' using errcode = '23503'; end if;

  select id into v_id from public.diagnostic_branch_listings
   where (p.lab_provider_id is not null and lab_location_id = p_location_id)
      or (p.imaging_provider_id is not null and imaging_location_id = p_location_id);

  if v_id is null then
    insert into public.diagnostic_branch_listings (provider_listing_id, lab_location_id, imaging_location_id, lga, town,
                                                   neighbourhood, email, website, is_test, created_by)
    values (p.id,
            case when p.lab_provider_id is not null then p_location_id end,
            case when p.imaging_provider_id is not null then p_location_id end,
            p_lga, p_town, p_neighbourhood, p_email, p_website, p_is_test, auth.uid())
    returning id into v_id;
    perform private.diagnostic_log('diagnostic_branch_listings', v_id, 'created', null, 'draft', null);
  else
    update public.diagnostic_branch_listings
       set lga = coalesce(p_lga, lga), town = coalesce(p_town, town), neighbourhood = coalesce(p_neighbourhood, neighbourhood),
           email = coalesce(p_email, email), website = coalesce(p_website, website), updated_at = now()
     where id = v_id;
    perform private.diagnostic_log('diagnostic_branch_listings', v_id, 'details_updated', null, null, null);
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_dx_verify_branch_location(
  p_branch_listing_id uuid, p_source text, p_note text, p_hours_checked boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  if char_length(btrim(coalesce(p_source, ''))) < 5 or char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say how the address, phone and map position were checked (source 5+ and note 10+ characters)' using errcode = '22023';
  end if;
  update public.diagnostic_branch_listings
     set location_verified_at = now(), location_verified_by = auth.uid(), location_source = p_source,
         hours_verified_at = case when p_hours_checked then now() else hours_verified_at end,
         hours_verified_by = case when p_hours_checked then auth.uid() else hours_verified_by end,
         updated_at = now()
   where id = p_branch_listing_id;
  if not found then raise exception 'unknown branch listing' using errcode = '23503'; end if;
  perform private.diagnostic_log('diagnostic_branch_listings', p_branch_listing_id, 'location_verified', null, p_source, p_note);
end;
$$;

create or replace function public.admin_dx_set_listing_status(p_level text, p_listing_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_from text;
begin
  perform private.diagnostic_require_verifier();
  if p_status not in ('draft', 'listed', 'suspended', 'deactivated') then raise exception 'unknown status' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'give a reason of at least 10 characters' using errcode = '22023';
  end if;
  if p_level = 'provider' then
    select directory_status into v_from from public.diagnostic_provider_listings where id = p_listing_id for update;
    if v_from is null then raise exception 'unknown provider listing' using errcode = '23503'; end if;
    update public.diagnostic_provider_listings
       set directory_status = p_status, status_changed_at = now(), status_changed_by = auth.uid(), status_reason = p_reason, updated_at = now()
     where id = p_listing_id;
    perform private.diagnostic_log('diagnostic_provider_listings', p_listing_id, 'status', v_from, p_status, p_reason);
  elsif p_level = 'branch' then
    select directory_status into v_from from public.diagnostic_branch_listings where id = p_listing_id for update;
    if v_from is null then raise exception 'unknown branch listing' using errcode = '23503'; end if;
    update public.diagnostic_branch_listings
       set directory_status = p_status, status_changed_at = now(), status_changed_by = auth.uid(), status_reason = p_reason, updated_at = now()
     where id = p_listing_id;
    perform private.diagnostic_log('diagnostic_branch_listings', p_listing_id, 'status', v_from, p_status, p_reason);
  else
    raise exception 'level must be provider or branch' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.admin_dx_upsert_service(
  p_branch_listing_id uuid, p_concept_id uuid, p_availability text, p_performed text,
  p_performing_branch_listing_id uuid, p_appointment_required boolean, p_preparation_note text,
  p_equipment_note text, p_evidence_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.diagnostic_branch_listings%rowtype;
  c public.reference_concepts%rowtype;
  v_id uuid;
  v_from text;
begin
  perform private.diagnostic_require_verifier();
  select * into b from public.diagnostic_branch_listings where id = p_branch_listing_id;
  if b.id is null then raise exception 'unknown branch listing' using errcode = '23503'; end if;
  select * into c from public.reference_concepts where id = p_concept_id;
  if c.id is null or c.investigation_category is null or c.is_ambiguous then
    raise exception 'choose a specific investigation from the catalogue' using errcode = '23514';
  end if;
  -- A lab branch records laboratory tests and non-imaging procedures (e.g. ECG); imaging needs an imaging listing.
  if b.lab_location_id is not null and c.modality is not null then
    raise exception 'a laboratory branch cannot list an imaging investigation; list it under the imaging centre' using errcode = '23514';
  end if;
  if b.imaging_location_id is not null and c.domain <> 'procedure' then
    raise exception 'an imaging branch cannot list a laboratory test' using errcode = '23514';
  end if;
  if p_performed = 'other_branch_same_provider' and not exists (
       select 1 from public.diagnostic_branch_listings o
        where o.id = p_performing_branch_listing_id and o.provider_listing_id = b.provider_listing_id) then
    raise exception 'the performing branch must belong to the same provider' using errcode = '23514';
  end if;

  select id, availability into v_id, v_from from public.diagnostic_branch_services
   where branch_listing_id = b.id and concept_id = c.id for update;
  if v_id is null then
    insert into public.diagnostic_branch_services (branch_listing_id, concept_id, availability, performed,
      performing_branch_listing_id, appointment_required, preparation_note, equipment_note,
      confirmed_at, confirmed_by, evidence_source)
    values (b.id, c.id, p_availability, p_performed, p_performing_branch_listing_id, coalesce(p_appointment_required, false),
            p_preparation_note, p_equipment_note, now(), auth.uid(), p_evidence_source)
    returning id into v_id;
  else
    update public.diagnostic_branch_services
       set availability = p_availability, performed = p_performed, performing_branch_listing_id = p_performing_branch_listing_id,
           appointment_required = coalesce(p_appointment_required, false), preparation_note = p_preparation_note,
           equipment_note = p_equipment_note, confirmed_at = now(), confirmed_by = auth.uid(),
           evidence_source = p_evidence_source, updated_at = now()
     where id = v_id;
  end if;
  perform private.diagnostic_log('diagnostic_branch_services', v_id, 'confirmed', v_from, p_availability, p_evidence_source);
  return v_id;
end;
$$;

create or replace function public.admin_dx_record_credential(
  p_level text, p_listing_id uuid, p_regulator text, p_issuer text, p_accreditation_body text, p_state text,
  p_identifier text, p_scope_concept_ids uuid[], p_scope_note text, p_issued_on date, p_expires_on date,
  p_source_url text, p_evidence_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.diagnostic_require_verifier();
  if p_level not in ('provider', 'branch') then raise exception 'level must be provider or branch' using errcode = '22023'; end if;
  insert into public.diagnostic_credentials (provider_listing_id, branch_listing_id, regulator, issuer, accreditation_body, state,
    identifier, scope_concept_ids, scope_note, issued_on, expires_on, source_url, evidence_path, recorded_by)
  values (case when p_level = 'provider' then p_listing_id end, case when p_level = 'branch' then p_listing_id end,
          p_regulator, p_issuer, p_accreditation_body, p_state, p_identifier, p_scope_concept_ids, p_scope_note,
          p_issued_on, p_expires_on, p_source_url, p_evidence_path, auth.uid())
  returning id into v_id;
  perform private.diagnostic_log('diagnostic_credentials', v_id, 'recorded', null, 'pending', p_regulator);
  return v_id;
end;
$$;

-- A credential is verified only against its source, by a named person; the recorder may verify (single-founder team),
-- but every step is in the audit trail.
create or replace function public.admin_dx_set_credential_status(p_credential_id uuid, p_status text, p_note text, p_next_verify_due date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_from text;
begin
  perform private.diagnostic_require_verifier();
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked and where (10+ characters)' using errcode = '22023';
  end if;
  select status into v_from from public.diagnostic_credentials where id = p_credential_id for update;
  if v_from is null then raise exception 'unknown credential' using errcode = '23503'; end if;
  update public.diagnostic_credentials
     set status = p_status,
         verified_by = case when p_status in ('pending', 'unverified') then verified_by else auth.uid() end,
         verified_at = case when p_status in ('pending', 'unverified') then verified_at else now() end,
         verification_note = p_note,
         next_verify_due = p_next_verify_due,
         status_reason = p_note,
         updated_at = now()
   where id = p_credential_id;
  perform private.diagnostic_log('diagnostic_credentials', p_credential_id, 'status', v_from, p_status, p_note);
end;
$$;

create or replace function public.admin_dx_open_incident(p_level text, p_id uuid, p_severity text, p_description text, p_suspends boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.diagnostic_require_verifier();
  insert into public.diagnostic_listing_incidents (provider_listing_id, branch_listing_id, service_id, severity, description, suspends, opened_by)
  values (case when p_level = 'provider' then p_id end, case when p_level = 'branch' then p_id end,
          case when p_level = 'service' then p_id end, p_severity, p_description,
          coalesce(p_suspends, false) or p_severity = 'serious', auth.uid())
  returning id into v_id;
  perform private.diagnostic_log('diagnostic_listing_incidents', v_id, 'opened', null, p_severity, p_description);
  return v_id;
end;
$$;

create or replace function public.admin_dx_close_incident(p_incident_id uuid, p_decision text, p_corrective_action text, p_reinstate boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare i public.diagnostic_listing_incidents%rowtype;
begin
  perform private.diagnostic_require_verifier();
  select * into i from public.diagnostic_listing_incidents where id = p_incident_id for update;
  if i.id is null or i.status <> 'open' then raise exception 'no open incident with that id' using errcode = '23503'; end if;
  update public.diagnostic_listing_incidents
     set status = 'closed', decision = p_decision, corrective_action = p_corrective_action, reinstated = p_reinstate,
         closed_by = auth.uid(), closed_at = now()
   where id = p_incident_id;
  -- Not reinstating: the affected listing is deactivated so it cannot quietly return when the incident closes.
  if not p_reinstate then
    if i.provider_listing_id is not null then
      update public.diagnostic_provider_listings set directory_status = 'deactivated', status_changed_at = now(),
             status_changed_by = auth.uid(), status_reason = p_decision, updated_at = now() where id = i.provider_listing_id;
      perform private.diagnostic_log('diagnostic_provider_listings', i.provider_listing_id, 'status', null, 'deactivated', p_decision);
    elsif i.branch_listing_id is not null then
      update public.diagnostic_branch_listings set directory_status = 'deactivated', status_changed_at = now(),
             status_changed_by = auth.uid(), status_reason = p_decision, updated_at = now() where id = i.branch_listing_id;
      perform private.diagnostic_log('diagnostic_branch_listings', i.branch_listing_id, 'status', null, 'deactivated', p_decision);
    else
      update public.diagnostic_branch_services set availability = 'discontinued', updated_at = now() where id = i.service_id;
      perform private.diagnostic_log('diagnostic_branch_services', i.service_id, 'availability', null, 'discontinued', p_decision);
    end if;
  end if;
  perform private.diagnostic_log('diagnostic_listing_incidents', p_incident_id, 'closed', 'open',
                                 case when p_reinstate then 'reinstated' else 'not_reinstated' end, p_decision);
end;
$$;

create or replace function public.admin_dx_replace_requirement(
  p_requirement_group text, p_regulator text, p_level text, p_active boolean, p_change_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'only an admin may change credential requirements' using errcode = '42501';
  end if;
  update public.diagnostic_credential_requirements
     set is_active = false, retired_at = now(), retired_by = auth.uid()
   where requirement_group = p_requirement_group and regulator = p_regulator and is_active
  returning id into v_old;
  if v_old is not null then
    perform private.diagnostic_log('diagnostic_credential_requirements', v_old, 'retired', 'active', 'retired', p_change_note);
  end if;
  if p_active then
    insert into public.diagnostic_credential_requirements (requirement_group, regulator, level, change_note, changed_by)
    values (p_requirement_group, p_regulator, p_level, p_change_note, auth.uid())
    returning id into v_new;
    perform private.diagnostic_log('diagnostic_credential_requirements', v_new, 'created', null, p_level, p_change_note);
  end if;
end;
$$;

create or replace function public.admin_dx_service_eligibility(p_service_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  return private.diagnostic_service_eligibility(p_service_id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_dx_create_provider_listing(text, uuid, boolean)',
    'public.admin_dx_upsert_branch_listing(uuid, uuid, text, text, text, text, text, boolean)',
    'public.admin_dx_verify_branch_location(uuid, text, text, boolean)',
    'public.admin_dx_set_listing_status(text, uuid, text, text)',
    'public.admin_dx_upsert_service(uuid, uuid, text, text, uuid, boolean, text, text, text)',
    'public.admin_dx_record_credential(text, uuid, text, text, text, text, text, uuid[], text, date, date, text, text)',
    'public.admin_dx_set_credential_status(uuid, text, text, date)',
    'public.admin_dx_open_incident(text, uuid, text, text, boolean)',
    'public.admin_dx_close_incident(uuid, text, text, boolean)',
    'public.admin_dx_replace_requirement(text, text, text, boolean, text)',
    'public.admin_dx_service_eligibility(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Seed the requirements (operational setting, see header)
-- ---------------------------------------------------------------------------
insert into public.diagnostic_credential_requirements (requirement_group, regulator, level, change_note) values
  ('laboratory',           'mlscn_registration',     'provider_or_branch', 'Initial: a medical laboratory must be MLSCN registered (design §8)'),
  ('ionising_imaging',     'nnra_authorisation',     'branch',             'Initial: X-ray, CT, mammography and DEXA need NNRA authorisation of the premises (design §8)'),
  ('ionising_imaging',     'state_facility_licence', 'branch',             'Initial: imaging premises need the state facility licence, e.g. Lagos HEFAMAA (design §8)'),
  ('non_ionising_imaging', 'state_facility_licence', 'branch',             'Initial: ultrasound, MRI and echo premises need the state facility licence (design §8)'),
  ('clinical_procedure',   'state_facility_licence', 'branch',             'Initial: ECG, endoscopy and physiology premises need the state facility licence (design §8)');

-- ---------------------------------------------------------------------------
-- 9b. Close the one gap the reader audit found: an imaging order for PARTNER fulfilment (Tarragon books and bills)
--     must name a contracted (is_active) imaging provider. Self-arranged orders (the patient goes and pays the centre)
--     may name any centre, including a directory-only listing. Live: imaging_orders 0 rows, imaging_providers 0 rows.
-- ---------------------------------------------------------------------------
create or replace function private.imaging_order_partner_must_be_contracted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfilment = 'partner' and (
       new.provider_id is null
       or not exists (select 1 from public.imaging_providers ip where ip.id = new.provider_id and ip.is_active)) then
    raise exception 'a partner imaging order needs a contracted imaging provider' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.imaging_order_partner_must_be_contracted() from public;
create trigger imaging_orders_partner_contracted
  before insert or update of fulfilment, provider_id on public.imaging_orders
  for each row execute function private.imaging_order_partner_must_be_contracted();

-- ---------------------------------------------------------------------------
-- 10. Self-check
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['diagnostic_provider_listings', 'diagnostic_branch_listings', 'diagnostic_branch_services',
                           'diagnostic_credentials', 'diagnostic_listing_incidents', 'diagnostic_directory_events']
  loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') then
      raise exception 'authenticated can write % directly', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.admin_dx_upsert_service(uuid, uuid, text, text, uuid, boolean, text, text, text)', 'EXECUTE') then
    raise exception 'anon can execute an admin_dx function';
  end if;
  if (select count(*) from public.diagnostic_credential_requirements where is_active) <> 5 then
    raise exception 'expected 5 active credential requirements';
  end if;
end;
$$;
