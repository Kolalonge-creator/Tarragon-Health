-- S06x (offline trust), decisions D1 to D3 (docs/plans/S06-S10-cmo-decisions-2026-10-07.md).
--   * offline_sync_rejections: when the server refuses a row the phone logged offline, the phone writes ONE row here (best effort, on the
--     first rejection) so support can see that a patient's entry was refused and why, WITHOUT any health value. Columns are an id, the
--     organisation, the account, the kind (vital/symptom/dose), a coarse reason code, the HTTP status and the 8 character support code the
--     patient already reads out. Patients insert and read their own; support reads through public.read_offline_sync_rejections, which only an
--     administrator of the same organisation can call and which writes an audit_log row for every read.
--   * offline_device_leases (D3): each phone registers an id and checks in whenever it syncs. A lost-phone report (the patient for their own
--     phone, or an administrator) sets revoked_at; the phone sees it on its next check-in, makes one last upload attempt, wipes its local
--     store and key, tells the patient, and confirms back with a COUNT of unsent rows (never their content). A phone that cannot check in for
--     offline_sync_config.device_lease_days (30, PROPOSED) treats its key lease as expired and does the same, but only when the SERVER's
--     own clock agrees (check-in returns what the server held before renewing) and never while an urgent entry is unsent. Never silent.
-- No data conversion: both tables are new and empty. Applied by the merge pipeline at this filename's version.

alter table public.offline_sync_config
  add column if not exists device_lease_days integer not null default 30 check (device_lease_days between 1 and 365),
  add column if not exists rejection_report_daily_cap integer not null default 200 check (rejection_report_daily_cap between 1 and 5000);

-- 1. Rejections ---------------------------------------------------------------------------------------------------------------------
create table public.offline_sync_rejections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  account_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('vital', 'symptom', 'dose')),
  reason_code text not null check (reason_code in ('refused_permission', 'refused_constraint', 'refused_validation', 'refused_other')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  support_code text not null check (support_code ~ '^[0-9A-F]{8}$'),
  client_id uuid not null,
  created_at timestamptz not null default now(),
  unique (account_id, client_id)
);
create index offline_sync_rejections_org_idx on public.offline_sync_rejections (organisation_id, created_at desc);
create index offline_sync_rejections_account_idx on public.offline_sync_rejections (account_id, created_at desc);
alter table public.offline_sync_rejections enable row level security;
revoke all on public.offline_sync_rejections from public, anon, authenticated;
grant select, insert on public.offline_sync_rejections to authenticated;
comment on table public.offline_sync_rejections is 'S06x: one row per entry the server refused after the phone logged it offline. No health values by design.';

create policy offline_sync_rejections_insert_own on public.offline_sync_rejections for insert to authenticated
  with check (account_id = (select auth.uid()) and organisation_id = (select private.current_org_id()));
create policy offline_sync_rejections_read_own on public.offline_sync_rejections for select to authenticated
  using (account_id = (select auth.uid()));

-- Not STABLE: it writes the audit row, and a STABLE function runs in a read-only transaction when called as a GET.
-- A caller chooses its own client_id, so the unique key is no brake on a loop of inserts. A per-account daily cap (a PROPOSED value in
-- offline_sync_config, mirrored in offline.trust) stops one account flooding the table or pushing real rows out of the support view.
create function private.cap_offline_sync_rejections() returns trigger language plpgsql set search_path = '' as
$$
declare v_cap integer; v_n integer;
begin
  select coalesce(rejection_report_daily_cap, 200) into v_cap from public.offline_sync_config where is_active;
  select count(*) into v_n from public.offline_sync_rejections where account_id = new.account_id and created_at > now() - interval '1 day';
  if v_n >= coalesce(v_cap, 200) then
    raise exception 'too many rejection reports today' using errcode = '53400';
  end if;
  return new;
end $$;
revoke all on function private.cap_offline_sync_rejections() from public, anon;
create trigger offline_sync_rejections_cap before insert on public.offline_sync_rejections
  for each row execute function private.cap_offline_sync_rejections();

create function public.read_offline_sync_rejections(p_account uuid default null, p_days integer default 14)
returns table (id uuid, account_id uuid, kind text, reason_code text, http_status integer, support_code text, created_at timestamptz)
language plpgsql volatile security definer set search_path = '' as
$$
begin
  if not coalesce(private.is_admin(), false) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.log_audit('offline_rejections_read', 'offline_sync_rejections', p_account,
    jsonb_build_object('days', least(greatest(coalesce(p_days, 14), 1), 90)));
  return query
    select r.id, r.account_id, r.kind, r.reason_code, r.http_status, r.support_code, r.created_at
      from public.offline_sync_rejections r
     where r.organisation_id = (select private.current_org_id())
       and (p_account is null or r.account_id = p_account)
       and r.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
     order by r.created_at desc
     limit 500;
end $$;
revoke all on function public.read_offline_sync_rejections(uuid, integer) from public, anon;
grant execute on function public.read_offline_sync_rejections(uuid, integer) to authenticated;

-- 2. Device leases and remote wipe ------------------------------------------------------------------------------------------------------
create table public.offline_device_leases (
  device_id uuid primary key,
  account_id uuid not null references auth.users (id) on delete cascade,
  organisation_id uuid not null,
  platform text not null check (platform in ('ios', 'android')),
  registered_at timestamptz not null default now(),
  last_checkin_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text check (revoke_reason in ('lost_phone', 'stolen', 'admin')),
  wipe_confirmed_at timestamptz,
  wipe_reason text check (wipe_reason in ('lost_phone', 'stolen', 'admin', 'lease_expired', 'shared_phone')),
  unsent_at_wipe integer check (unsent_at_wipe is null or unsent_at_wipe >= 0),
  danger_at_wipe integer check (danger_at_wipe is null or danger_at_wipe >= 0),
  -- A phone that has not checked in for twice the lease is retired: it stops counting towards the per-account cap.
  retired_at timestamptz
);
create index offline_device_leases_account_idx on public.offline_device_leases (account_id);
alter table public.offline_device_leases enable row level security;
revoke all on public.offline_device_leases from public, anon, authenticated;
grant select on public.offline_device_leases to authenticated;
create policy offline_device_leases_read_own on public.offline_device_leases for select to authenticated
  using (account_id = (select auth.uid()));
comment on table public.offline_device_leases is 'S06x: one row per phone holding an encrypted offline store; revoked_at is the remote-wipe flag the phone checks on sync.';

create function public.offline_device_checkin(p_device uuid, p_platform text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_me uuid := (select auth.uid()); v_org uuid; v_days integer; v_row public.offline_device_leases%rowtype;
  v_found boolean; v_prev_exp timestamptz; v_prev_seen timestamptz;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'bad platform' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_me;
  if v_org is null then raise exception 'no organisation' using errcode = '42501'; end if;
  select coalesce(device_lease_days, 30) into v_days from public.offline_sync_config where is_active;
  v_days := coalesce(v_days, 30);

  -- Retire this account's phones that have been silent for twice the lease, so old rows never fill the cap for good.
  update public.offline_device_leases set retired_at = now()
   where account_id = v_me and device_id <> p_device and retired_at is null and revoked_at is null
     and last_checkin_at < now() - make_interval(days => 2 * v_days);

  select * into v_row from public.offline_device_leases where device_id = p_device;
  v_found := found;
  if v_found and v_row.account_id <> v_me then raise exception 'device belongs to another account' using errcode = '42501'; end if;
  -- What the SERVER held before this check-in renews anything. The phone judges a lapsed lease by these, on the server's clock,
  -- so a phone whose own clock jumped forward is not wiped for it.
  v_prev_exp := case when v_found then v_row.lease_expires_at end;
  v_prev_seen := case when v_found then v_row.last_checkin_at end;

  if not v_found or v_row.retired_at is not null then
    -- A new phone, or a retired one coming back, must fit under the cap of live phones.
    if (select count(*) from public.offline_device_leases where account_id = v_me and revoked_at is null and retired_at is null) >= 20 then
      raise exception 'too many registered phones' using errcode = '53400';
    end if;
  end if;

  if not v_found then
    insert into public.offline_device_leases (device_id, account_id, organisation_id, platform, lease_expires_at)
    values (p_device, v_me, v_org, p_platform, now() + make_interval(days => v_days))
    returning * into v_row;
  elsif v_row.revoked_at is null then
    update public.offline_device_leases
       set last_checkin_at = now(), lease_expires_at = now() + make_interval(days => v_days), retired_at = null
     where device_id = p_device returning * into v_row;
  else
    update public.offline_device_leases set last_checkin_at = now() where device_id = p_device returning * into v_row;
  end if;
  return jsonb_build_object('revoked', v_row.revoked_at is not null, 'lease_expires_at', v_row.lease_expires_at,
                            'lease_days', v_days, 'wipe_reason', v_row.revoke_reason, 'server_now', now(),
                            'prev_lease_expires_at', v_prev_exp, 'prev_last_checkin_at', v_prev_seen);
end $$;
revoke all on function public.offline_device_checkin(uuid, text) from public, anon;
grant execute on function public.offline_device_checkin(uuid, text) to authenticated;

create function public.request_offline_device_wipe(p_device uuid, p_reason text default 'lost_phone') returns boolean
language plpgsql security definer set search_path = '' as
$$
declare v_me uuid := (select auth.uid()); v_row public.offline_device_leases%rowtype; v_is_admin boolean;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_reason not in ('lost_phone', 'stolen', 'admin') then raise exception 'bad reason' using errcode = '22023'; end if;
  select * into v_row from public.offline_device_leases where device_id = p_device;
  if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
  v_is_admin := coalesce(private.is_admin(), false) and v_row.organisation_id = (select private.current_org_id());
  if v_row.account_id <> v_me and not v_is_admin then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason = 'admin' and not v_is_admin then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.offline_device_leases
     set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, v_me), revoke_reason = coalesce(revoke_reason, p_reason)
   where device_id = p_device;
  perform private.log_audit('offline_device_wipe_requested', 'offline_device_leases', v_row.account_id, jsonb_build_object('reason', p_reason));
  return true;
end $$;
revoke all on function public.request_offline_device_wipe(uuid, text) from public, anon;
grant execute on function public.request_offline_device_wipe(uuid, text) to authenticated;

-- The phone reports that it wiped, with COUNTS only (entries not sent, how many of those were flagged urgent). Accepted only when
-- the phone was reported lost (revoked_at set) or the SERVER agrees its lease has run out; otherwise anyone could stamp a "wiped"
-- record on a phone that is fine. A sibling account on a shared phone is recorded as 'shared_phone' (phone-reported, unverified). Counts are capped so a bad client cannot store absurd numbers.
create function public.confirm_offline_device_wipe(p_device uuid, p_unsent integer, p_danger integer default 0, p_reason text default 'lost_phone')
returns boolean
language plpgsql security definer set search_path = '' as
$$
declare v_me uuid := (select auth.uid()); v_row public.offline_device_leases%rowtype; v_reason text;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_reason not in ('lost_phone', 'stolen', 'admin', 'lease_expired', 'shared_phone') then raise exception 'bad reason' using errcode = '22023'; end if;
  select * into v_row from public.offline_device_leases where device_id = p_device and account_id = v_me;
  if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
  if v_row.revoked_at is not null then
    v_reason := v_row.revoke_reason;
  elsif p_reason = 'lease_expired' and v_row.lease_expires_at < now() then
    v_reason := 'lease_expired';
  elsif p_reason = 'shared_phone' then
    -- Another account's phone was cleared because it shares this phone. The server cannot check that; it is recorded as
    -- phone-reported (wipe_reason = shared_phone), counts only, on the caller's own device row.
    v_reason := 'shared_phone';
  else
    raise exception 'this phone was not reported lost and its lease has not run out' using errcode = '42501';
  end if;
  update public.offline_device_leases
     set wipe_confirmed_at = coalesce(wipe_confirmed_at, now()), wipe_reason = coalesce(wipe_reason, v_reason),
         unsent_at_wipe = least(greatest(coalesce(p_unsent, 0), 0), 100000),
         danger_at_wipe = least(greatest(coalesce(p_danger, 0), 0), 100000)
   where device_id = p_device;
  perform private.log_audit('offline_device_wiped', 'offline_device_leases', v_me,
    jsonb_build_object('unsent', least(greatest(coalesce(p_unsent, 0), 0), 100000), 'danger', least(greatest(coalesce(p_danger, 0), 0), 100000), 'reason', v_reason));
  return true;
end $$;
revoke all on function public.confirm_offline_device_wipe(uuid, integer, integer, text) from public, anon;
grant execute on function public.confirm_offline_device_wipe(uuid, integer, integer, text) to authenticated;

-- 3. Self-check ----------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.offline_sync_rejections', 'SELECT') or has_table_privilege('anon', 'public.offline_device_leases', 'SELECT') then
    raise exception 'S06x: anon can read'; end if;
  if has_table_privilege('authenticated', 'public.offline_sync_rejections', 'UPDATE') or has_table_privilege('authenticated', 'public.offline_sync_rejections', 'DELETE')
     or has_table_privilege('authenticated', 'public.offline_device_leases', 'INSERT') or has_table_privilege('authenticated', 'public.offline_device_leases', 'UPDATE') then
    raise exception 'S06x: authenticated has a write it must not have'; end if;
  if not has_table_privilege('authenticated', 'public.offline_sync_rejections', 'INSERT') then raise exception 'S06x: patients cannot insert a rejection'; end if;
  if has_function_privilege('anon', 'public.read_offline_sync_rejections(uuid, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.offline_device_checkin(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_offline_device_wipe(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_offline_device_wipe(uuid, integer, integer, text)', 'EXECUTE') then
    raise exception 'S06x: anon can execute'; end if;
end $$;
