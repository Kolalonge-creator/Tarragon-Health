-- S80 gap closure (25.9 / 25.3 directory): a freshness score that decays daily, a chase list, a partner email notice, and a hide-from-routing
-- switch. Extends S36g (20261006220445) and S80 C4 (20261007160201); nothing there is replaced except list_lab_test_locations (patched in
-- place, see 4).
--
-- Counted first (live, read only, 2026-10-27): directory_freshness has 40 rows; the screen's verification history is empty or near empty, so
-- almost every listing is "never verified" (score 0). That is why hiding is built the way it is (see 3).
--
-- 1. SCORE. private.directory_freshness_score(last_verified_at, cadence_months): 100 on the day a person verifies a listing, falling in a
--    straight line to 50 on its due date and 0 at twice the cadence; 0 when never verified. It is COMPUTED, never stored, so it decays every
--    day without a job. Cadence per listing kind is the existing directory.verification_cadence (branches follow the parent).
-- 2. CHASE LIST. public.directory_chase_list(): active listings, lowest score first (staler first), with whether anyone can be contacted and
--    when the partner was last chased. Same viewers as the freshness screen (private.directory_can_view).
-- 3. HIDE (guard directory_hide_stale_partners, BORN OFF). private.directory_hidden_by_staleness(table, id) is true only when the guard is on,
--    the listing HAS been verified at least once, and its score is below the PROPOSED hide_below_score. A never-verified listing is never
--    hidden by this (switching the guard on must not make the whole directory vanish before anyone has had a chance to verify it).
-- 4. Patient routing: public.list_lab_test_locations (what the patient's lab picker shows) skips a hidden lab or branch. Patched in place from
--    the CURRENT definition and the migration raises if the anchor is missing. The pharmacy chooser and private.resolve_lab_order_provider are
--    deliberately NOT changed here (the single-active-lab fallback would refuse every order); they are listed as follow-ups.
-- 5. NOTICE (guard directory_partner_stale_email, BORN OFF). A daily sweep queues one email notification (content_class non_clinical, neutral
--    wording, no patient or clinical detail) to the partner's contact_email when the listing's score is below notice_below_score, at most once
--    per notice_repeat_days. It goes through the existing notifications queue and the send-pending-notifications function (template
--    directory_partner_recheck_notice); the queue row is owned by an active admin because a partner contact is not a profile, the same shape as
--    the existing no-login partner rows (the address travels as payload.to_email). It never changes is_active.
-- PROPOSED values (not signed): directory.staleness in packages/shared/src/proposed-config/registry.ts, mirrored by the seed below.

-- ---------------------------------------------------------------------------
-- PROPOSED thresholds (versioned config, mirrored in the code registry)
-- ---------------------------------------------------------------------------
create table public.directory_staleness_config (
  version        integer primary key,
  is_active      boolean not null,
  effective_from date not null,
  rules          jsonb not null
);
create unique index directory_staleness_config_one_active on public.directory_staleness_config (is_active) where is_active;
alter table public.directory_staleness_config enable row level security;
revoke all on public.directory_staleness_config from anon, authenticated;

-- directory-staleness-begin
insert into public.directory_staleness_config (version, is_active, effective_from, rules) values (1, true, '2026-10-27', $json$
{ "notice_below_score": 50, "notice_repeat_days": 14, "hide_below_score": 20 }
$json$::jsonb);
-- directory-staleness-end

alter table public.directory_freshness add column last_partner_notice_on date;

-- go-live guards, born off
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('directory_hide_stale_partners', 'Hide stale partners from patient routing', 'A laboratory or branch that was verified before but whose freshness score has fallen below the threshold stops appearing in the patient lab picker',
   'Operations has worked through the chase list so that no partner Tarragon actually uses is below the threshold; the founder has signed the threshold; admin confirmation', 'admin',
   array['list_lab_test_locations (public)'],
   'The pharmacy chooser and lab order provider resolution are not changed. A listing that was never verified is never hidden by this switch.'),
  ('directory_partner_stale_email', 'Email partners whose directory listing is stale', 'A daily email to the contact address of a partner whose listing freshness score is below the notice threshold',
   'The wording was reviewed by operations; the contact addresses on the listings were confirmed as real partner addresses; admin confirmation', 'admin',
   array['private.directory_chase_notices (daily sweep)'],
   'Specialist, home visit and logistics partners are reached only if their row carries a contact_email. The email names the listing and the screen, nothing about any patient.');

-- ---------------------------------------------------------------------------
-- 1. The score
-- ---------------------------------------------------------------------------
create function private.directory_freshness_score(p_last_verified_at timestamptz, p_cadence_months integer)
returns integer
language sql stable
as $$
  select case
    when p_last_verified_at is null or coalesce(p_cadence_months, 0) <= 0 then 0
    else greatest(0, least(100, round(100 - 50.0 * greatest(0, ((now() at time zone 'Africa/Lagos')::date - (p_last_verified_at at time zone 'Africa/Lagos')::date))
                                          / (p_cadence_months * 30))::integer))
  end
$$;
revoke all on function private.directory_freshness_score(timestamptz, integer) from public, anon, authenticated;

create function private.directory_staleness_rule(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::integer from public.directory_staleness_config where is_active $$;
revoke all on function private.directory_staleness_rule(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The chase list
-- ---------------------------------------------------------------------------
create function public.directory_chase_list()
returns table (
  listing_table text, listing_id uuid, name text, last_verified_at timestamptz, days_since_verified integer,
  freshness_score integer, can_notify boolean, last_partner_notice_on date, would_be_hidden boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hide integer := private.directory_staleness_rule('hide_below_score');
  v_guard boolean := private.go_live_guard_on('directory_hide_stale_partners');
begin
  if (select auth.uid()) is null or not private.directory_can_view() then
    raise exception 'only an admin or an operations user can see the directory chase list' using errcode = '42501';
  end if;
  return query
    select x.listing_table, x.listing_id, x.name, x.last_verified_at, x.days_since, x.score,
           private.directory_partner_contact(x.listing_table, x.listing_id) is not null,
           x.last_partner_notice_on,
           (x.last_verified_at is not null and x.score < v_hide)
    from (
      select l.listing_table, l.listing_id, l.name, f.last_verified_at, f.last_partner_notice_on,
             case when f.last_verified_at is null then null
                  else ((now() at time zone 'Africa/Lagos')::date - (f.last_verified_at at time zone 'Africa/Lagos')::date) end as days_since,
             private.directory_freshness_score(f.last_verified_at, private.directory_cadence_months(l.listing_table)) as score
        from private.directory_listings() l
        left join public.directory_freshness f on f.listing_table = l.listing_table and f.listing_id = l.listing_id
       where l.is_active
    ) x
    order by x.score asc, x.days_since desc nulls last, x.name, x.listing_id;
end $$;
revoke all on function public.directory_chase_list() from public, anon;
grant execute on function public.directory_chase_list() to authenticated;

-- the contact address for a listing (parent's address for a branch). Only the six parent tables are ever queried; a table with no contact_email column yields null.
create function private.directory_partner_contact(p_table text, p_id uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parent text;
  v_pid uuid := p_id;
  v_row jsonb;
begin
  v_parent := case p_table
    when 'lab_provider_locations' then 'lab_providers'
    when 'pharmacy_partner_locations' then 'pharmacy_partners'
    when 'specialist_provider_locations' then 'specialist_providers'
    when 'imaging_provider_locations' then 'imaging_providers'
    else p_table end;
  if p_table = 'lab_provider_locations' then select lab_provider_id into v_pid from public.lab_provider_locations where id = p_id;
  elsif p_table = 'pharmacy_partner_locations' then select pharmacy_partner_id into v_pid from public.pharmacy_partner_locations where id = p_id;
  elsif p_table = 'specialist_provider_locations' then select specialist_provider_id into v_pid from public.specialist_provider_locations where id = p_id;
  elsif p_table = 'imaging_provider_locations' then select imaging_provider_id into v_pid from public.imaging_provider_locations where id = p_id;
  end if;
  if v_parent not in ('lab_providers', 'pharmacy_partners', 'specialist_providers', 'facilities', 'home_visit_providers', 'logistics_partners', 'imaging_providers') then
    return null;
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_parent) into v_row using v_pid;
  return nullif(btrim(coalesce(v_row ->> 'contact_email', '')), '');
end $$;
revoke all on function private.directory_partner_contact(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hide predicate (guard off by default; never hides a never-verified listing)
-- ---------------------------------------------------------------------------
create function private.directory_hidden_by_staleness(p_table text, p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.go_live_guard_on('directory_hide_stale_partners')
     and exists (
       select 1 from public.directory_freshness f
        where f.listing_table = p_table and f.listing_id = p_id and f.last_verified_at is not null
          and private.directory_freshness_score(f.last_verified_at, private.directory_cadence_months(p_table)) < private.directory_staleness_rule('hide_below_score'));
$$;
revoke all on function private.directory_hidden_by_staleness(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Patch the patient lab picker in place (fails loudly if the definition drifted)
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_sig text := 'public.list_lab_test_locations(text, text)';
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef(v_sig::regprocedure);
  v_new := replace(v_def, E'  where lp.is_active\n',
    E'  where lp.is_active\n    and not private.directory_hidden_by_staleness(''lab_providers'', lp.id)\n    and not private.directory_hidden_by_staleness(''lab_provider_locations'', lpl.id)\n');
  if v_new = v_def then
    raise exception 'directory staleness: the where clause of % was not found (definition drifted)', v_sig;
  end if;
  execute v_new;
end $patch$;

-- ---------------------------------------------------------------------------
-- 5. Daily partner notice (guard directory_partner_stale_email, born off)
-- ---------------------------------------------------------------------------
create function private.directory_chase_notices() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_below   integer := private.directory_staleness_rule('notice_below_score');
  v_repeat  integer := private.directory_staleness_rule('notice_repeat_days');
  v_owner   uuid;
  v_org     uuid;
  r         record;
  v_email   text;
  v_n       integer := 0;
begin
  if not private.go_live_guard_on('directory_partner_stale_email') then return 0; end if;
  select p.id, p.organisation_id into v_owner, v_org from public.profiles p where p.is_active and p.role = 'admin' and p.organisation_id is not null order by p.created_at limit 1;
  if v_owner is null then return 0; end if;
  for r in
    select l.listing_table, l.listing_id, l.name, f.last_verified_at, f.last_partner_notice_on
      from private.directory_listings() l
      left join public.directory_freshness f on f.listing_table = l.listing_table and f.listing_id = l.listing_id
     where l.is_active
       and l.listing_table in ('lab_providers', 'pharmacy_partners', 'specialist_providers', 'facilities', 'home_visit_providers', 'logistics_partners')
       and private.directory_freshness_score(f.last_verified_at, private.directory_cadence_months(l.listing_table)) < v_below
       and (f.last_partner_notice_on is null or f.last_partner_notice_on <= current_date - v_repeat)
  loop
    v_email := private.directory_partner_contact(r.listing_table, r.listing_id);
    if v_email is null then continue; end if;
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
    values (v_owner, v_org, 'email', 'directory_partner_recheck_notice',
            jsonb_build_object('to_email', v_email, 'listing_name', r.name,
                               'last_checked', coalesce(to_char(r.last_verified_at at time zone 'Africa/Lagos', 'YYYY-MM-DD'), 'not yet'),
                               'audience', 'partner'),
            'pending', 'non_clinical');
    insert into public.directory_freshness as f (listing_table, listing_id, organisation_id, last_partner_notice_on)
    values (r.listing_table, r.listing_id, v_org, current_date)
    on conflict (listing_table, listing_id) do update set last_partner_notice_on = current_date, updated_at = now();
    perform private.log_audit('directory.partner_notice_queued', r.listing_table, r.listing_id, jsonb_build_object('listing_name', r.name));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.directory_chase_notices() from public, anon, authenticated;

select cron.schedule('directory-staleness-chase', '45 5 * * *', $c$select private.directory_chase_notices()$c$);

-- registry entries (25.8): the job is listed with NO owner (nobody has been assigned; the owners screen flags it as unowned) and, in the
-- automation_jobs pause registry, as an ordinary (not safety-critical) pg_cron job.
insert into public.automations (name, kind, schedule, source_ref, expected_interval_minutes)
values ('cron:directory-staleness-chase', 'pg_cron', '45 5 * * *', 'cron.job:directory-staleness-chase', 1560) on conflict (name) do nothing;
insert into public.automation_jobs (job_name, schedule, source)
values ('directory-staleness-chase', '45 5 * * *', 'pg_cron') on conflict (job_name) do nothing;

-- ---------------------------------------------------------------------------
-- assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.directory_chase_list()', 'EXECUTE')
     or has_function_privilege('anon', 'private.directory_chase_notices()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.directory_chase_notices()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.directory_hidden_by_staleness(text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.directory_partner_contact(text, uuid)', 'EXECUTE') then
    raise exception 'directory staleness functions are executable by a role that must not run them';
  end if;
  if (select count(*) from public.go_live_guards where key in ('directory_hide_stale_partners', 'directory_partner_stale_email') and not is_on) <> 2 then
    raise exception 'both directory guards must exist and be off';
  end if;
  if private.directory_freshness_score(null, 12) <> 0 or private.directory_freshness_score(now(), 12) <> 100
     or private.directory_freshness_score(now() - interval '360 days', 12) not between 49 and 51
     or private.directory_freshness_score(now() - interval '900 days', 12) <> 0 then
    raise exception 'directory freshness score arithmetic is wrong';
  end if;
  if not exists (select 1 from cron.job where jobname = 'directory-staleness-chase') then raise exception 'chase sweep not scheduled'; end if;
  if pg_get_functiondef('public.list_lab_test_locations(text, text)'::regprocedure) not like '%directory_hidden_by_staleness%' then
    raise exception 'lab picker was not patched';
  end if;
end $$;
