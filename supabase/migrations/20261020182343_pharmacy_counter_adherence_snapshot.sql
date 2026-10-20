-- Pharmacy-counter adherence snapshot (S06x to S10x follow-up).
--
-- A patient shows a pharmacist, at the counter, the same "doses you marked taken" record the app already gives them (S08x). It is built on the
-- EXISTING record_shares machinery (S09/S09x): the same random link, the same random PIN shown once, the same lockout and per-client slow-down,
-- the same one-session window, the same expiry cap, the same revoke, and the same patient-readable access log. Nothing in that machinery is
-- changed here: record_share_by_token and create_record_share are called, not rewritten.
--
-- What is added:
--   * pharmacy_counter_snapshots: ONE row per counter share, holding the weekly figures the app computed for the patient with the S08x formula
--     (packages/medicines buildAdherenceReport, the same function the app, the PDF and the care team's chart use). The figures are frozen at
--     creation: "doses marked taken", skipped shown apart, no grade, no threshold flag, no medicine name (the share's own 'medications'
--     section carries the names). The database cannot recompute them (the formula is TypeScript), so it validates the SHAPE and the arithmetic
--     bounds and nothing more; the page says the figures are the patient's own app record.
--   * create_pharmacy_counter_snapshot(): signed-in patient only, section-scoped to 'medications' only, PIN always on, one-session always on,
--     expiry 1 to 24 hours (default 2), at most 5 live snapshots at once, audited.
--   * pharmacy_snapshot_by_token(): the public door. It answers only for a token that has a snapshot row; any other token, a switched-off guard,
--     or any dead/locked/expired link gets the same null as every other dead share link. The PIN, lockout and open counting are
--     record_share_by_token's own.
--   * go-live guard 'pharmacy_counter_snapshot', born OFF, with NO conditions branch (the wallet_pass pattern): an unknown key is one unmet
--     'unknown_guard' condition, so set_go_live_guard refuses to switch it on until a later change adds the branch and its attestations.
--
-- KNOWN LIMIT (kept on purpose): the guard closes the counter feature (create, the counter door and the page), not the ordinary share link. A counter
-- view is a real record share limited to the medicines section, so while it is live it can still be opened through the ordinary share door
-- (/share/[token], same PIN, same lockout) and shows the medicines list the patient already chose to share. Switching the guard off does not
-- revoke links already issued; they end by themselves within 24 hours and the patient can revoke them under Share records.
-- No notification is sent by any of this (INV-07: nothing here can carry a medicine name). Counted before writing (live, 2026-10-20): record_shares
-- holds no counter snapshot and the table does not exist, so no data is converted.
-- The new table is keyed by profile_id, not patient_id, on purpose (the S09x lock-screen table did the same): a patient_id column would put it in
-- the S39d data registry and the under-18 guard, whose reviews are the CMO's and DPO's to give. It cascades with the profile and with its share.

-- 1. Shape check for the stored figures ------------------------------------------------------------------------------------------------
create function private.pharmacy_snapshot_weeks_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  e jsonb;
  k text;
  c_keys constant text[] := array['week_start', 'week_end', 'due', 'marked_taken', 'late', 'skipped', 'no_record', 'could_not_get', 'percent'];
  c_counts constant text[] := array['due', 'marked_taken', 'late', 'skipped', 'no_record', 'could_not_get'];
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) < 1 or jsonb_array_length(p) > 8 then return false; end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    -- exactly the known keys: nothing else (a medicine name, a note) can ride along
    if (select count(*) from jsonb_object_keys(e)) <> cardinality(c_keys) then return false; end if;
    foreach k in array c_keys loop
      if not (e ? k) then return false; end if;
    end loop;
    if jsonb_typeof(e -> 'week_start') <> 'string' or (e ->> 'week_start') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    if jsonb_typeof(e -> 'week_end') <> 'string' or (e ->> 'week_end') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    foreach k in array c_counts loop
      if jsonb_typeof(e -> k) <> 'number' or (e ->> k) !~ '^\d{1,5}$' then return false; end if;
    end loop;
    if jsonb_typeof(e -> 'percent') not in ('number', 'null') then return false; end if;
    if jsonb_typeof(e -> 'percent') = 'number' and (e ->> 'percent') !~ '^(\d{1,2}|100)$' then return false; end if;
    if (e ->> 'late')::integer > (e ->> 'marked_taken')::integer then return false; end if;
    if (e ->> 'marked_taken')::integer + (e ->> 'skipped')::integer + (e ->> 'no_record')::integer + (e ->> 'could_not_get')::integer
         > (e ->> 'due')::integer then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.pharmacy_snapshot_weeks_ok(jsonb) from public, anon, authenticated;

-- 2. The table -----------------------------------------------------------------------------------------------------------------------
create table public.pharmacy_counter_snapshots (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null unique references public.record_shares (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  weeks           jsonb not null,
  min_doses       integer not null check (min_doses between 1 and 100),
  created_at      timestamptz not null default now(),
  constraint pharmacy_counter_snapshots_weeks_shape check (private.pharmacy_snapshot_weeks_ok(weeks))
);
create index pharmacy_counter_snapshots_profile_idx on public.pharmacy_counter_snapshots (profile_id, created_at desc);
alter table public.pharmacy_counter_snapshots enable row level security;
revoke all on public.pharmacy_counter_snapshots from public, anon, authenticated;
grant select on public.pharmacy_counter_snapshots to authenticated;
create policy pharmacy_counter_snapshots_own on public.pharmacy_counter_snapshots for select to authenticated
  using (profile_id = (select auth.uid()));
comment on table public.pharmacy_counter_snapshots is 'Pharmacy-counter adherence snapshot: frozen weekly "doses marked taken" figures for one record share. Written only by create_pharmacy_counter_snapshot.';

-- 3. Create (patient) -------------------------------------------------------------------------------------------------------------------
create function public.create_pharmacy_counter_snapshot(p_weeks jsonb, p_min_doses integer, p_expires_in_hours integer default 2)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_org  uuid;
  v_hours integer := coalesce(p_expires_in_hours, 2);
  v_res  jsonb;
  v_live integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.go_live_open_patient('pharmacy_counter_snapshot', v_uid) then
    raise exception 'the pharmacy counter view is not open yet' using errcode = '55000';
  end if;
  if v_hours < 1 or v_hours > 24 then raise exception 'a counter view lasts 1 to 24 hours' using errcode = '22023'; end if;
  if p_min_doses is null or p_min_doses < 1 or p_min_doses > 100 then raise exception 'min doses out of range' using errcode = '22023'; end if;
  if not private.pharmacy_snapshot_weeks_ok(p_weeks) then raise exception 'the figures are not in the expected shape' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'profile not found' using errcode = 'P0002'; end if;

  -- a brake on piling up links: at most 5 counter views live at once for one person
  select count(*) into v_live
    from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id
   where s.profile_id = v_uid and r.is_active and r.expires_at > now();
  if v_live >= 5 then raise exception 'too many live counter views; revoke one first' using errcode = '53400'; end if;

  -- The existing door does the rest: medications section ONLY, a random PIN shown once, one-session window, the expiry cap.
  v_res := public.create_record_share(array['medications'], v_hours, true, true);

  insert into public.pharmacy_counter_snapshots (share_id, profile_id, organisation_id, weeks, min_doses)
  values ((v_res ->> 'id')::uuid, v_uid, v_org, p_weeks, p_min_doses);

  perform private.log_audit('pharmacy_counter_snapshot_created', 'record_shares', v_uid,
    jsonb_build_object('share_id', v_res ->> 'id', 'hours', v_hours, 'weeks', jsonb_array_length(p_weeks)));
  return v_res || jsonb_build_object('kind', 'pharmacy_counter');
end $$;
revoke all on function public.create_pharmacy_counter_snapshot(jsonb, integer, integer) from public, anon;
grant execute on function public.create_pharmacy_counter_snapshot(jsonb, integer, integer) to authenticated;

-- 4. The public door ----------------------------------------------------------------------------------------------------------------------
create function public.pharmacy_snapshot_by_token(p_token text, p_pin text default null, p_client_key text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_weeks   jsonb;
  v_min     integer;
  v_profile uuid;
  v_res     jsonb;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select s.weeks, s.min_doses, s.profile_id into v_weeks, v_min, v_profile
    from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id
   where r.token = p_token;
  -- not a counter view, or the feature is off: the same silent answer as any other dead link
  if not found then return null; end if;
  if not private.go_live_open_patient('pharmacy_counter_snapshot', v_profile) then return null; end if;

  -- PIN, lockout, slow-down, expiry, one-session window, open counting and the access log are the share door's own.
  v_res := public.record_share_by_token(p_token, p_pin, p_client_key);
  if v_res is null or v_res ->> 'status' is distinct from 'ok' then return v_res; end if;
  return v_res || jsonb_build_object('kind', 'pharmacy_counter',
                                     'adherence', jsonb_build_object('weeks', v_weeks, 'min_doses', v_min));
end $$;
revoke all on function public.pharmacy_snapshot_by_token(text, text, text) from public;
grant execute on function public.pharmacy_snapshot_by_token(text, text, text) to anon, authenticated;

-- 5. Go-live guard (born off, fail closed) ---------------------------------------------------------------------------------------------------
-- Deliberately NO branch in private.go_live_conditions: an unknown key returns one unmet 'unknown_guard' condition, so set_go_live_guard
-- refuses to switch it on. Whoever adds the pharmacist-facing attestations (CMO and DPO view of the counter use) adds the branch.
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('pharmacy_counter_snapshot', 'Pharmacy-counter adherence view',
   'A patient creating, and a pharmacist opening, a short-lived "doses you marked taken" view at the counter',
   'The CMO and the data protection officer have agreed the wording and the use at a pharmacy counter; the PIN and expiry behaviour have been tried on a real phone',
   'admin', array['create_pharmacy_counter_snapshot', 'pharmacy_snapshot_by_token', 'the patient medicine-report page', '/share/counter/[token]'],
   'The patient''s own medicine report and the PDF are not behind it: they show a patient their own record.')
on conflict (key) do nothing;

-- 6. The migration proves what it claims -------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.pharmacy_counter_snapshots', 'SELECT') then raise exception 'pharmacy snapshot: anon can read'; end if;
  if has_table_privilege('authenticated', 'public.pharmacy_counter_snapshots', 'INSERT') or has_table_privilege('authenticated', 'public.pharmacy_counter_snapshots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pharmacy_counter_snapshots', 'DELETE') then
    raise exception 'pharmacy snapshot: a client can write the table directly';
  end if;
  if has_function_privilege('anon', 'public.create_pharmacy_counter_snapshot(jsonb, integer, integer)', 'EXECUTE') then
    raise exception 'pharmacy snapshot: anon can create';
  end if;
  if not has_function_privilege('anon', 'public.pharmacy_snapshot_by_token(text, text, text)', 'EXECUTE') then
    raise exception 'pharmacy snapshot: the counter door must be anon-callable';
  end if;
  if has_function_privilege('anon', 'private.pharmacy_snapshot_weeks_ok(jsonb)', 'EXECUTE') then
    raise exception 'pharmacy snapshot: anon can run the shape check';
  end if;
  if (select is_on from public.go_live_guards where key = 'pharmacy_counter_snapshot') is distinct from false then
    raise exception 'pharmacy snapshot: the guard must be born off';
  end if;
  if private.pharmacy_snapshot_weeks_ok('[{"week_start":"2026-10-05","week_end":"2026-10-11","due":14,"marked_taken":10,"late":1,"skipped":2,"no_record":2,"could_not_get":0,"percent":71}]'::jsonb) is not true then
    raise exception 'pharmacy snapshot: a good figure set was refused';
  end if;
  if private.pharmacy_snapshot_weeks_ok('[{"week_start":"2026-10-05","week_end":"2026-10-11","due":14,"marked_taken":10,"late":1,"skipped":2,"no_record":2,"could_not_get":0,"percent":71,"drug_name":"x"}]'::jsonb) then
    raise exception 'pharmacy snapshot: an extra key (a place to hide a medicine name) was accepted';
  end if;
end $$;
