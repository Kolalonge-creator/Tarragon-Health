-- S65a: directory listing detail, freshness TIER, the hide-stale rule, wrong-information reports (spec 15.8, 15.10, 15.11, 15.17).
--
-- Reconciled first. Live today: `facilities` (type, state, city, phone, address, lat/long, free-text hours, `verified`), `facility_services`,
-- S36g freshness (`directory_freshness`, `directory_verifications`, `directory_verification_config` v1, a nightly sweep that never hides).
-- Extended, not rebuilt.
--
-- DECISION CHANGE, recorded in docs/OPEN-QUESTIONS.md (S65 CMO decision Q21, 2026-10-07): S36g's header says a listing is never hidden.
-- That is now changed ON PURPOSE for PATIENT SEARCH ONLY: a listing whose last verification (or, if it has never been verified, its
-- creation date) is older than TWICE its cadence is left out of `directory_search` (migration S65b). Nothing is deleted, deactivated or
-- suspended, staff still see it in Directory freshness, and one verification brings it straight back. The S36g nightly sweep is unchanged.
--
-- Also reverses, behind a go-live guard that starts OFF, the 2026-08-03 founder decision that no facility is shown to patients
-- (20260803160537): `directory_enabled`. Nothing patient-facing reads the directory until a person switches it on.
--
-- Cadence classes (CMO Q21, still PROPOSED and unsigned): emergency-capable hospitals and 24-hour pharmacies 90 days, clinics and labs
-- 180, everything else 365. `facilities.type` has no 'clinic' value, so a hospital that is not emergency-capable counts as a clinic.
-- Two independent wrong-information reports (two different people) move a listing to the front of the verification queue at once.
--
-- Counts at write time: facilities has 9 rows (live, 2026-10-07), all 'seed only'. Nothing is converted.

-- ---------------------------------------------------------------------------
-- 1. facilities: the extra detail the filters need
-- ---------------------------------------------------------------------------
create function private.facility_hours_valid(h jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare d text; w jsonb;
begin
  if h is null then return true; end if;
  if jsonb_typeof(h) <> 'object' then return false; end if;
  for d in select jsonb_object_keys(h) loop
    if d not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then return false; end if;
    if jsonb_typeof(h -> d) <> 'array' then return false; end if;
    for w in select * from jsonb_array_elements(h -> d) loop
      if jsonb_typeof(w) <> 'array' or jsonb_array_length(w) <> 2
         or (w ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (w ->> 1) !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         or (w ->> 0) >= (w ->> 1) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;
revoke all on function private.facility_hours_valid(jsonb) from public, anon, authenticated;

alter table public.facilities
  add column services          text[]  not null default '{}',
  add column hours_structured  jsonb,
  add column languages         text[]  not null default '{}',
  add column accepts_hmo       text[]  not null default '{}',
  add column nhia              boolean not null default false,
  add column nhia_confirmed_at timestamptz,
  add column emergency_capable boolean not null default false,
  add column open_24h          boolean not null default false,
  add column is_test           boolean not null default false,
  add column source_note       text;
alter table public.facilities add constraint facilities_hours_structured_valid check (private.facility_hours_valid(hours_structured));
comment on column public.facilities.accepts_hmo is 'What the FACILITY says it accepts (a claim). The confirmed list is facility_hmo_confirmations, written by staff from the HMO''s own provider list.';
comment on column public.facilities.nhia is 'What the facility says (a claim). nhia_confirmed_at is set by staff only when NHIA acceptance has been checked.';
comment on column public.facilities.hours_structured is '{"mon":[["08:00","17:00"]], ...} in Africa/Lagos. The free text `hours` stays for display; this drives the open-now filter.';

create table public.facility_hmo_confirmations (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities (id) on delete cascade,
  hmo_name      text not null check (char_length(btrim(hmo_name)) between 2 and 80),
  confirmed_at  timestamptz not null default now(),
  confirmed_by  uuid not null references public.profiles (id) on delete restrict,
  source_note   text not null check (char_length(btrim(source_note)) between 10 and 300)
);
create unique index facility_hmo_confirmations_one on public.facility_hmo_confirmations (facility_id, lower(btrim(hmo_name)));
alter table public.facility_hmo_confirmations enable row level security;
create policy facility_hmo_confirmations_read on public.facility_hmo_confirmations for select to authenticated using (true);
revoke all on public.facility_hmo_confirmations from public, anon, authenticated;
grant select on public.facility_hmo_confirmations to authenticated;
-- A confirmation is a fact about a facility, not about a person: readable by every signed-in role; written only by confirm_facility_hmo.

-- ---------------------------------------------------------------------------
-- 2. Config v2 (versioned, PROPOSED). v1 stays as history; v2 carries the same keys plus the S65 rules.
-- ---------------------------------------------------------------------------
-- directory-access-begin
update public.directory_verification_config set is_active = false where is_active;
insert into public.directory_verification_config (version, is_active, effective_from, rules) values (2, true, '2026-10-07', $json$
{
  "default_months": 12,
  "due_soon_days": 30,
  "by_listing_table": { "pharmacy_partners": 6 },
  "visibility": {
    "cadence_days": { "emergency_hospital": 90, "pharmacy_24h": 90, "clinic": 180, "lab": 180, "other": 365 },
    "hide_multiple": 2,
    "reports_to_reverify": 2,
    "reports_per_person_per_day": 10
  },
  "ratings": {
    "moderation_target_hours": 72,
    "min_ratings_to_show_average": 3,
    "hold_terms": ["diagnos", "misdiagnos", "prescri", "wrong medicine", "wrong drug", "treatment plan", "doctor was wrong", "the doctor", "clinical judgement"]
  },
  "booking": {
    "reminder_minutes_before": [10080, 1440, 120],
    "min_lead_minutes": 60,
    "max_days_ahead": 90
  }
}
$json$::jsonb);
-- directory-access-end

create function private.directory_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.directory_verification_config where is_active $$;
revoke all on function private.directory_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The tier on the current freshness row, and the one door that sets it
-- ---------------------------------------------------------------------------
alter table public.directory_freshness
  add column tier text not null default 'seed_only' check (tier in ('seed_only', 'phone_confirmed', 'licence_checked'));
comment on column public.directory_freshness.tier is 'seed_only = existence only; phone_confirmed = a person rang and confirmed open, hours and services; licence_checked = the licence was checked against the regulator register.';

create function public.record_directory_check(p_listing_table text, p_listing_id uuid, p_note text, p_tier text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  if p_tier is null or p_tier not in ('phone_confirmed', 'licence_checked') then
    raise exception 'a check is either phone_confirmed or licence_checked' using errcode = '22023';
  end if;
  v := public.record_directory_verification(p_listing_table, p_listing_id, p_note);   -- refuses a caller without the manage permission
  update public.directory_freshness set tier = p_tier, updated_at = now()
   where listing_table = p_listing_table and listing_id = p_listing_id;
  return v || jsonb_build_object('tier', p_tier);
end $$;
revoke all on function public.record_directory_check(text, uuid, text, text) from public, anon;
grant execute on function public.record_directory_check(text, uuid, text, text) to authenticated;

create function public.confirm_facility_hmo(p_facility uuid, p_hmo text, p_source_note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then
    raise exception 'you may not confirm HMO acceptance' using errcode = '42501';
  end if;
  if not exists (select 1 from public.facilities where id = p_facility) then raise exception 'that facility does not exist' using errcode = '22023'; end if;
  insert into public.facility_hmo_confirmations (facility_id, hmo_name, confirmed_by, source_note)
  values (p_facility, btrim(p_hmo), (select auth.uid()), btrim(p_source_note))
  on conflict (facility_id, lower(btrim(hmo_name))) do update set confirmed_at = now(), confirmed_by = excluded.confirmed_by, source_note = excluded.source_note;
  perform private.log_audit('directory.hmo_confirmed', 'facilities', p_facility, jsonb_build_object('hmo', btrim(p_hmo)));
end $$;
revoke all on function public.confirm_facility_hmo(uuid, text, text) from public, anon;
grant execute on function public.confirm_facility_hmo(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cadence class and the hide-stale rule
-- ---------------------------------------------------------------------------
create function private.directory_cadence_class(p_table text, p_id uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare f public.facilities%rowtype;
begin
  if p_table = 'facilities' then
    select * into f from public.facilities where id = p_id;
    if not found then return 'other'; end if;
    return case when f.type = 'hospital' and f.emergency_capable then 'emergency_hospital'
                when f.type = 'pharmacy' and f.open_24h then 'pharmacy_24h'
                when f.type = 'hospital' then 'clinic'
                when f.type = 'lab' then 'lab'
                else 'other' end;
  end if;
  return 'other';
end $$;
revoke all on function private.directory_cadence_class(text, uuid) from public, anon, authenticated;

create function private.directory_cadence_days(p_table text, p_id uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((private.directory_rules() -> 'visibility' -> 'cadence_days' ->> private.directory_cadence_class(p_table, p_id))::integer,
                  (private.directory_rules() -> 'visibility' -> 'cadence_days' ->> 'other')::integer, 365)
$$;
revoke all on function private.directory_cadence_days(text, uuid) from public, anon, authenticated;

-- The clock starts at the last verification, or at the listing's creation if it has never been verified.
create function private.directory_listing_visible(p_table text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_basis timestamptz;
  v_mult  integer := coalesce((private.directory_rules() -> 'visibility' ->> 'hide_multiple')::integer, 2);
begin
  select coalesce(f.last_verified_at, l.created_at) into v_basis
    from (select created_at from public.facilities where p_table = 'facilities' and id = p_id
          union all select created_at from public.specialist_providers where p_table = 'specialist_providers' and id = p_id) l
    left join public.directory_freshness f on f.listing_table = p_table and f.listing_id = p_id
   limit 1;
  if v_basis is null then return false; end if;
  return v_basis + make_interval(days => private.directory_cadence_days(p_table, p_id) * v_mult) >= now();
end $$;
revoke all on function private.directory_listing_visible(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Wrong-information reports (15.17): a report queues re-verification and NEVER edits the listing
-- ---------------------------------------------------------------------------
create table public.directory_reverification_queue (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  listing_table  text not null check (listing_table in ('facilities', 'specialist_providers')),
  listing_id     uuid not null,
  priority       text not null default 'normal' check (priority in ('normal', 'immediate')),
  opened_at      timestamptz not null default now(),
  immediate_at   timestamptz,
  closed_at      timestamptz,
  closed_by      uuid references public.profiles (id) on delete set null,
  check ((priority = 'immediate') = (immediate_at is not null))
);
create unique index directory_reverification_one_open on public.directory_reverification_queue (listing_table, listing_id) where closed_at is null;

create table public.directory_listing_reports (
  id           uuid primary key default gen_random_uuid(),
  queue_id     uuid not null references public.directory_reverification_queue (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  field        text not null check (field in ('phone', 'address', 'hours', 'closed', 'services', 'other')),
  detail       text check (detail is null or char_length(btrim(detail)) between 1 and 500),
  created_at   timestamptz not null default now(),
  unique (queue_id, reporter_id)
);
create index directory_listing_reports_reporter_idx on public.directory_listing_reports (reporter_id, created_at desc);

alter table public.directory_reverification_queue enable row level security;
alter table public.directory_listing_reports enable row level security;
create policy directory_reverification_queue_read on public.directory_reverification_queue for select to authenticated using (private.directory_can_view());
create policy directory_listing_reports_read on public.directory_listing_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.directory_can_view());
revoke all on public.directory_reverification_queue, public.directory_listing_reports from public, anon, authenticated;
grant select on public.directory_reverification_queue, public.directory_listing_reports to authenticated;
-- No write grant and no write policy for any client role: report_directory_listing and the verification trigger are the only doors.

create function public.report_directory_listing(p_listing_table text, p_listing_id uuid, p_field text, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_org     uuid;
  v_q       public.directory_reverification_queue%rowtype;
  v_n       integer;
  v_need    integer := coalesce((private.directory_rules() -> 'visibility' ->> 'reports_to_reverify')::integer, 2);
  v_cap     integer := coalesce((private.directory_rules() -> 'visibility' ->> 'reports_per_person_per_day')::integer, 10);
  v_name    text;
  v_r       record;
begin
  if v_uid is null then raise exception 'sign in to report a listing' using errcode = '42501'; end if;
  if p_listing_table not in ('facilities', 'specialist_providers') then raise exception 'unknown listing kind' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  select l.name into v_name from private.directory_listings() l where l.listing_table = p_listing_table and l.listing_id = p_listing_id;
  if v_name is null then raise exception 'that listing does not exist' using errcode = '22023'; end if;
  if (select count(*) from public.directory_listing_reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= v_cap then
    raise exception 'you have sent a lot of reports today; please try again tomorrow' using errcode = '54000';
  end if;

  select * into v_q from public.directory_reverification_queue where listing_table = p_listing_table and listing_id = p_listing_id and closed_at is null;
  if not found then
    insert into public.directory_reverification_queue (organisation_id, listing_table, listing_id) values (v_org, p_listing_table, p_listing_id) returning * into v_q;
  end if;
  insert into public.directory_listing_reports (queue_id, reporter_id, field, detail)
  values (v_q.id, v_uid, p_field, nullif(btrim(coalesce(p_detail, '')), ''))
  on conflict (queue_id, reporter_id) do nothing;

  select count(distinct reporter_id) into v_n from public.directory_listing_reports where queue_id = v_q.id;
  if v_n >= v_need and v_q.priority <> 'immediate' then
    update public.directory_reverification_queue set priority = 'immediate', immediate_at = now() where id = v_q.id;
    for v_r in
      select p.id from public.profiles p where p.is_active and p.role = 'admin'
      union
      select p.id from public.profiles p join public.user_permission_grants g on g.profile_id = p.id and g.permission_key = 'ops.console.view' and g.revoked_at is null where p.is_active
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_r.id, v_org, 'in_app', 'directory_reverify_now',
              jsonb_build_object('message', 'A directory listing has two independent reports of wrong information. Open Directory freshness and re-verify it now.', 'audience', 'ops'), 'pending', 'non_clinical');
    end loop;
  end if;
  return jsonb_build_object('queued', true, 'immediate', v_n >= v_need);
end $$;
revoke all on function public.report_directory_listing(text, uuid, text, text) from public, anon;
grant execute on function public.report_directory_listing(text, uuid, text, text) to authenticated;

-- A recorded verification closes the open queue entry for that listing.
create function private.directory_verification_closes_queue() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.directory_reverification_queue set closed_at = new.verified_at, closed_by = new.verified_by
   where listing_table = new.listing_table and listing_id = new.listing_id and closed_at is null;
  return new;
end $$;
revoke all on function private.directory_verification_closes_queue() from public, anon, authenticated;
create trigger directory_verifications_close_queue after insert on public.directory_verifications
  for each row execute function private.directory_verification_closes_queue();

-- Staff read: the queue, immediate first.
create function public.directory_reverification_list() returns table (
  queue_id uuid, listing_table text, listing_id uuid, name text, priority text, opened_at timestamptz, reports integer, fields text[]
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.directory_can_view() then raise exception 'only an admin or an operations user can see the verification queue' using errcode = '42501'; end if;
  return query
    select q.id, q.listing_table, q.listing_id, l.name, q.priority, q.opened_at,
           (select count(*)::integer from public.directory_listing_reports r where r.queue_id = q.id),
           (select coalesce(array_agg(distinct r.field), '{}') from public.directory_listing_reports r where r.queue_id = q.id)
      from public.directory_reverification_queue q
      join private.directory_listings() l on l.listing_table = q.listing_table and l.listing_id = q.listing_id
     where q.closed_at is null
     order by (q.priority = 'immediate') desc, q.opened_at, q.id;
end $$;
revoke all on function public.directory_reverification_list() from public, anon;
grant execute on function public.directory_reverification_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The go-live guard for the patient-facing directory (starts OFF)
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('directory_enabled', 'Patient directory, ratings and facility booking', 'Directory search, facility ratings and facility booking for patients',
   'The CMO has signed the verification cadence; a named person owns phone verification; at least one listing has been phone-confirmed', 'admin',
   array['directory_search', 'create_facility_booking', 'submit_facility_rating'],
   'The old facility selector used by lab and booking-request flows is not behind this guard. Listings are only ever hidden by the stale rule, not by this guard.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.report_directory_listing(text, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_directory_check(text, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_facility_hmo(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.directory_reverification_list()', 'EXECUTE') then
    raise exception 'S65a: a directory function is executable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.directory_listing_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.directory_reverification_queue', 'UPDATE')
     or has_table_privilege('anon', 'public.directory_listing_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.facility_hmo_confirmations', 'INSERT') then
    raise exception 'S65a: a directory table has a grant it must not have';
  end if;
  if (select count(*) from public.directory_verification_config where is_active) <> 1
     or private.directory_cadence_days('facilities', gen_random_uuid()) <> 365
     or (select is_on from public.go_live_guards where key = 'directory_enabled') then
    raise exception 'S65a: cadence config or guard seed is wrong';
  end if;
end $$;
