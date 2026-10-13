-- S36g: directory and partner freshness (spec 25.3 "verification schedules" and 25.9 "directory freshness alerts").
--
-- Reconciled first. Live today: licence-expiry columns and a nightly licence alert (20260731011319) for five partner tables;
-- `license_verified_at` on those, but NO listing carries a "last verified" date, a next-due date, or any re-verification history,
-- and `facilities` has only a bare boolean `verified`. This adds the schedule, not a second licence tracker:
--
--   directory_verifications     append-only history (who checked what, when, their note, the cadence used, the next due date).
--   directory_freshness         one current row per listing: last verified, by whom, next due, stale flag, last reminder.
--   directory_verification_config  PROPOSED cadence (mirrored as `directory.verification_cadence` in the code registry; a drift
--                               test compares the two). 12 months for every listing, 6 months for pharmacies. UNSIGNED: OQ-214/OQ-235.
--   record_directory_verification(table, id, note)   the one door that records a verification (a typed note is required, audited).
--   directory_freshness_list()  the ops screen's read.
--   private.directory_freshness_sweep()  nightly (pg_cron, like the licence sweep): marks past-due listings stale and sends ONE
--                               neutral in-app notice to ops. It NEVER changes is_active, never hides or suspends a listing: a person decides.
--
-- Six listing tables are covered (lab_providers, pharmacy_partners, specialist_providers, facilities, home_visit_providers,
-- logistics_partners). None has an is_test column (partner catalogue rows are real or absent), so there is nothing to exclude.
-- INV-07: a notice names a count and the screen, never a patient, reading or result. In-app only (no SMS, no email needed).
-- Counts at write time: nothing is converted. Every listing starts as "never verified" until a person records one.

-- ---------------------------------------------------------------------------
-- 1. PROPOSED cadence (versioned)
-- ---------------------------------------------------------------------------
create table public.directory_verification_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index directory_verification_config_one_active on public.directory_verification_config (is_active) where is_active;
alter table public.directory_verification_config enable row level security;
revoke all on public.directory_verification_config from anon, authenticated;

-- directory-cadence-begin
insert into public.directory_verification_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "default_months": 12,
  "due_soon_days": 30,
  "by_listing_table": { "pharmacy_partners": 6 }
}
$json$::jsonb);
-- directory-cadence-end

create function private.directory_cadence_months(p_table text) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((rules -> 'by_listing_table' ->> p_table)::integer, (rules ->> 'default_months')::integer, 12)
  from public.directory_verification_config where is_active;
$$;
revoke all on function private.directory_cadence_months(text) from public, anon, authenticated;

create function private.directory_due_soon_days() returns integer
language sql stable security definer set search_path = ''
as $$ select coalesce((rules ->> 'due_soon_days')::integer, 30) from public.directory_verification_config where is_active; $$;
revoke all on function private.directory_due_soon_days() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.directory_verifications (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  listing_table   text not null check (listing_table in ('lab_providers', 'pharmacy_partners', 'specialist_providers', 'facilities', 'home_visit_providers', 'logistics_partners')),
  listing_id      uuid not null,
  verified_at     timestamptz not null default now(),
  verified_by     uuid not null references public.profiles (id) on delete restrict,
  note            text not null check (char_length(btrim(note)) between 10 and 500),
  cadence_months  integer not null check (cadence_months between 1 and 60),
  next_due        date not null,
  created_at      timestamptz not null default now()
);
create index directory_verifications_listing_idx on public.directory_verifications (listing_table, listing_id, verified_at desc);

create table public.directory_freshness (
  listing_table          text not null check (listing_table in ('lab_providers', 'pharmacy_partners', 'specialist_providers', 'facilities', 'home_visit_providers', 'logistics_partners')),
  listing_id             uuid not null,
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  last_verified_at       timestamptz,
  verified_by            uuid references public.profiles (id) on delete restrict,
  next_verification_due  date,
  is_stale               boolean not null default false,
  stale_since            date,
  last_notified_on       date,
  updated_at             timestamptz not null default now(),
  primary key (listing_table, listing_id),
  check ((next_verification_due is null) = (last_verified_at is null))
);

create function private.directory_verifications_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'directory_verifications is append-only' using errcode = '42501'; end $$;
create trigger directory_verifications_no_change before update or delete on public.directory_verifications
  for each row execute function private.directory_verifications_append_only();

-- Who may see the freshness list: the admin, an operations user, or anyone who manages one of the six listing kinds.
create function private.directory_can_view() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission('ops.console.view')
      or private.has_permission('partners.labs.manage') or private.has_permission('partners.pharmacies.manage')
      or private.has_permission('partners.facilities.manage') or private.has_permission('partners.specialists.manage')
      or private.has_permission('partners.home_visit.manage') or private.has_permission('partners.logistics.manage');
$$;
revoke all on function private.directory_can_view() from public, anon;
grant execute on function private.directory_can_view() to authenticated;

-- Who may RECORD a verification for one kind of listing: the manage permission for that kind (the admin holds all).
create function private.directory_can_record(p_table text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission(case p_table
    when 'lab_providers' then 'partners.labs.manage'
    when 'pharmacy_partners' then 'partners.pharmacies.manage'
    when 'facilities' then 'partners.facilities.manage'
    when 'specialist_providers' then 'partners.specialists.manage'
    when 'home_visit_providers' then 'partners.home_visit.manage'
    when 'logistics_partners' then 'partners.logistics.manage'
    else 'no.such.permission' end);
$$;
revoke all on function private.directory_can_record(text) from public, anon;
grant execute on function private.directory_can_record(text) to authenticated;

alter table public.directory_verifications enable row level security;
alter table public.directory_freshness enable row level security;
create policy directory_verifications_read on public.directory_verifications for select to authenticated using (private.directory_can_view());
create policy directory_freshness_read on public.directory_freshness for select to authenticated using (private.directory_can_view());
revoke all on public.directory_verifications, public.directory_freshness from anon, authenticated;
grant select on public.directory_verifications, public.directory_freshness to authenticated;
-- No client write policy and no write grant: record_directory_verification and the sweep are the only doors.

-- ---------------------------------------------------------------------------
-- 3. The listings, as one set
-- ---------------------------------------------------------------------------
create function private.directory_listings() returns table (listing_table text, listing_id uuid, name text, is_active boolean)
language sql stable security definer set search_path = ''
as $$
  select 'lab_providers', id, name, is_active from public.lab_providers
  union all select 'pharmacy_partners', id, name, is_active from public.pharmacy_partners
  union all select 'specialist_providers', id, name, is_active from public.specialist_providers
  union all select 'facilities', id, name, is_active from public.facilities
  union all select 'home_visit_providers', id, name, is_active from public.home_visit_providers
  union all select 'logistics_partners', id, name, is_active from public.logistics_partners;
$$;
revoke all on function private.directory_listings() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Record a verification (the one door)
-- ---------------------------------------------------------------------------
create function public.record_directory_verification(p_listing_table text, p_listing_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_note   text := btrim(coalesce(p_note, ''));
  v_org    uuid := private.caller_org();
  v_months integer;
  v_next   date;
  v_at     timestamptz := now();
  v_name   text;
begin
  if (select auth.uid()) is null or not private.directory_can_record(p_listing_table) then
    raise exception 'you may not record a verification for this kind of listing' using errcode = '42501';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 500 then
    raise exception 'write a note of 10 to 500 characters saying what was checked' using errcode = '22023';
  end if;
  select l.name into v_name from private.directory_listings() l where l.listing_table = p_listing_table and l.listing_id = p_listing_id;
  if not found then raise exception 'that listing does not exist' using errcode = '22023'; end if;

  v_months := private.directory_cadence_months(p_listing_table);
  v_next := ((v_at at time zone 'Africa/Lagos')::date + make_interval(months => v_months))::date;

  insert into public.directory_verifications (organisation_id, listing_table, listing_id, verified_at, verified_by, note, cadence_months, next_due)
  values (v_org, p_listing_table, p_listing_id, v_at, (select auth.uid()), v_note, v_months, v_next);

  insert into public.directory_freshness as f (listing_table, listing_id, organisation_id, last_verified_at, verified_by, next_verification_due, is_stale, stale_since, updated_at)
  values (p_listing_table, p_listing_id, v_org, v_at, (select auth.uid()), v_next, false, null, now())
  on conflict (listing_table, listing_id) do update
    set last_verified_at = excluded.last_verified_at, verified_by = excluded.verified_by, next_verification_due = excluded.next_verification_due,
        is_stale = false, stale_since = null, updated_at = now();

  perform private.log_audit('directory.verification_recorded', p_listing_table, p_listing_id,
    jsonb_build_object('listing_name', v_name, 'next_due', v_next, 'cadence_months', v_months));
  return jsonb_build_object('listing_table', p_listing_table, 'listing_id', p_listing_id, 'verified_at', v_at, 'next_due', v_next);
end $$;
revoke all on function public.record_directory_verification(text, uuid, text) from public, anon;
grant execute on function public.record_directory_verification(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The ops screen's read
-- ---------------------------------------------------------------------------
create function public.directory_freshness_list() returns table (
  listing_table text, listing_id uuid, name text, is_active boolean,
  last_verified_at timestamptz, verified_by_name text, next_verification_due date,
  status text, days_overdue integer, can_record boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_soon integer := private.directory_due_soon_days();
begin
  if not private.directory_can_view() then
    raise exception 'only an admin or an operations user can see directory freshness' using errcode = '42501';
  end if;
  return query
    select l.listing_table, l.listing_id, l.name, l.is_active, f.last_verified_at, p.full_name, f.next_verification_due,
           case when f.last_verified_at is null then 'never_verified'
                when f.next_verification_due < current_date then 'overdue'
                when f.next_verification_due <= current_date + v_soon then 'due_soon'
                else 'current' end,
           case when f.next_verification_due < current_date then (current_date - f.next_verification_due) else null end,
           private.directory_can_record(l.listing_table)
    from private.directory_listings() l
    left join public.directory_freshness f on f.listing_table = l.listing_table and f.listing_id = l.listing_id
    left join public.profiles p on p.id = f.verified_by
    where l.is_active
    order by case when f.last_verified_at is null then 1 when f.next_verification_due < current_date then 0 else 2 end,
             f.next_verification_due nulls last, l.name, l.listing_id;
end $$;
revoke all on function public.directory_freshness_list() from public, anon;
grant execute on function public.directory_freshness_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Nightly sweep: mark stale, tell ops. Never hides, deactivates or suspends anything.
-- ---------------------------------------------------------------------------
create function private.directory_freshness_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_org     uuid := (select id from public.organisations order by created_at limit 1);
  v_notify  integer;
  v_r       record;
  v_message text;
begin
  -- Every active listing gets a state row (never verified until a person records one).
  insert into public.directory_freshness (listing_table, listing_id, organisation_id)
  select l.listing_table, l.listing_id, v_org from private.directory_listings() l where l.is_active
  on conflict (listing_table, listing_id) do nothing;

  update public.directory_freshness f
     set is_stale = (f.next_verification_due is not null and f.next_verification_due < current_date),
         stale_since = case when f.next_verification_due is not null and f.next_verification_due < current_date then coalesce(f.stale_since, current_date) else null end,
         updated_at = now()
   where f.is_stale is distinct from (f.next_verification_due is not null and f.next_verification_due < current_date);

  -- One notice per sweep when a listing went stale since the last reminder, or has gone 30 days without one.
  select count(*) into v_notify from public.directory_freshness f
   join private.directory_listings() l on l.listing_table = f.listing_table and l.listing_id = f.listing_id and l.is_active
   where f.is_stale and (f.last_notified_on is null or f.last_notified_on <= current_date - 30);
  if v_notify > 0 then
    v_message := format('%s directory listing%s overdue for verification. Open Directory freshness to review. Nothing has been hidden or switched off.',
                        v_notify, case when v_notify = 1 then ' is' else 's are' end);
    for v_r in
      select p.id from public.profiles p where p.is_active and p.role = 'admin'
      union
      select p.id from public.profiles p
        join public.user_permission_grants g on g.profile_id = p.id and g.permission_key = 'ops.console.view' and g.revoked_at is null
        where p.is_active
      union
      select p.id from public.profiles p
        join public.role_permissions rp on rp.custom_role_id = p.custom_role_id and rp.permission_key = 'ops.console.view'
        where p.is_active
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_r.id, v_org, 'in_app', 'directory_freshness_overdue',
              jsonb_build_object('message', v_message, 'overdue_count', v_notify, 'audience', 'ops'), 'pending', 'non_clinical');
    end loop;
    update public.directory_freshness f set last_notified_on = current_date
     where f.is_stale and (f.last_notified_on is null or f.last_notified_on <= current_date - 30);
  end if;
  return v_notify;
end $$;
revoke all on function private.directory_freshness_sweep() from public, anon, authenticated;

select cron.schedule('directory-freshness-sweep', '30 5 * * *', $c$select private.directory_freshness_sweep()$c$);

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.record_directory_verification(text, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.directory_freshness_list()', 'EXECUTE')
     or has_function_privilege('anon', 'private.directory_freshness_sweep()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.directory_freshness_sweep()', 'EXECUTE') then
    raise exception 'directory freshness functions are executable by a role that must not run them';
  end if;
  if has_table_privilege('anon', 'public.directory_freshness', 'SELECT') or has_table_privilege('authenticated', 'public.directory_freshness', 'INSERT')
     or has_table_privilege('authenticated', 'public.directory_verifications', 'INSERT') then
    raise exception 'directory freshness tables have a grant they must not have';
  end if;
  if not exists (select 1 from cron.job where jobname = 'directory-freshness-sweep') then raise exception 'sweep not scheduled'; end if;
  if private.directory_cadence_months('pharmacy_partners') <> 6 or private.directory_cadence_months('lab_providers') <> 12 then
    raise exception 'cadence seed is wrong';
  end if;
end $$;
