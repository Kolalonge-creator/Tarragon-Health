-- S70b item 10: a blood pressure taken at a partner pharmacy, with the person's consent at the counter. Opens the SEAM that assisted entry left closed
-- (migration 20261016191457, section 3: private.pharmacy_assisted_entry_allowed returned false "until OQ-ASSIST-1 is answered"). OQ-ASSIST-1 asked: how is a
-- pharmacy staff member verified, how does the person consent, whose record is it. This is a PROPOSED answer, not a decision (OQ-S70B-3).
--
-- DESIGN (smallest safe):
--   * source stays 'manual'. A new vital_source value would skip triggers keyed on manual/device (assisted-entry design note, section 2), so the reading is triaged
--     EXACTLY like a typed one. "Taken at a partner pharmacy" is shown from the existing assisted_entry_log (actor_kind = 'pharmacy', consent_basis = 'counter_consent').
--   * Consent at the counter: the PERSON makes a one-time code in the app (create_pharmacy_reading_code, rate limited). The pharmacist types it
--     (pharmacist_open_reading_visit). That opens a short visit for that pharmacist and that person: authorisationMinutes, up to maxReadings readings. The person can end
--     the visit early (end_pharmacy_reading_visit). Only then does the seam say yes.
--   * The pharmacy must be LIVE: pharmacy_partners.is_active, onboarding_status 'activated', approved_at and license_verified_at set. A suspended pharmacy's logins cannot
--     open a visit or record a reading.
--   * The code is stored as an HMAC-SHA256 with a pepper from the Vault (pharmacy_reading_pepper, same pattern as hmo_member_pepper). No secret, no code: it fails closed.
--   * Brute force: failures are counted per pharmacy under a per-pharmacy advisory lock (parallel calls cannot slip past the count). maxFailedAttempts wrong codes
--     inside lockoutMinutes locks the pharmacy out.
--   * The reading cap is an atomic counter on the visit row (readings_used), claimed under a row lock in the same transaction as the insert, so it does not depend on the
--     ledger trigger (which warns instead of failing) and parallel records cannot exceed it. The seam only says yes inside that claim.
--   * The reading itself is entered with pharmacist_record_bp, SECURITY INVOKER, so the existing insert policy, the assisted-entry guard, the plausibility hold, the
--     red-flag triggers and the ledger run as the pharmacist. Blood pressure only; source manual only; the row's organisation must be the person's.
--   * Two switches, both OFF: platform module device_pharmacy_readings (this migration) AND the existing go-live guard assisted_entry_pharmacy_enabled, which still has no
--     conditions defined, so it cannot be switched on. This migration does NOT touch private.go_live_conditions().
-- Numbers are the PROPOSED, unsigned configuration pharmacy.reading_point (packages/shared proposed-config); private.pharmacy_reading_cfg() holds them for the database and a
-- mirror test keeps the two equal. Nothing here is signed or approved by anyone.

insert into public.platform_modules (key, label, description) values
  ('device_pharmacy_readings', 'Blood pressure readings at a partner pharmacy',
   'A partner pharmacist can record a blood pressure for a person who gave them a one-time code at the counter. The reading is triaged like one the person typed and is labelled as taken at a pharmacy. Off: the code and the counter functions refuse.')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pharmacy_reading_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pharmacy_reading_pepper',
                                'HMAC key for pharmacy counter reading code hashes (S70b). Rotating it invalidates unused codes, which expire in minutes anyway.');
  end if;
end $$;

create function private.pharmacy_reading_cfg() returns jsonb
language sql immutable parallel safe set search_path = ''
as $$ select '{"codeLength": 8, "codeValidMinutes": 15, "authorisationMinutes": 10, "maxReadings": 3, "maxFailedAttempts": 5, "lockoutMinutes": 15, "maxCodesPerHour": 5}'::jsonb $$;
revoke all on function private.pharmacy_reading_cfg() from public, anon, authenticated;

-- HMAC of a code with the Vault pepper. Fails closed: without the secret there is no safe way to store or test a code.
create function private.pharmacy_code_hash(p_code text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pharmacy_reading_pepper';
  if k is null or k = '' then raise exception 'pharmacy_readings_not_configured' using errcode = 'P0001'; end if;
  return encode(extensions.hmac(p_code, k, 'sha256'), 'hex');
end $$;
revoke all on function private.pharmacy_code_hash(text) from public, anon, authenticated;

-- A pharmacy that is allowed to work today: active, activated, approved, licence verified.
create function private.pharmacy_partner_live(p_partner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select pp.is_active and pp.onboarding_status = 'activated' and pp.approved_at is not null and pp.license_verified_at is not null
                     from public.pharmacy_partners pp where pp.id = p_partner), false)
$$;
revoke all on function private.pharmacy_partner_live(uuid) from public, anon, authenticated;

-- 1. Tables. Codes and failures are never readable by a client; the person may read their own visits. -----------------------------------------------
create table public.pharmacy_reading_codes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  code_hash       text not null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  revoked_at      timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index pharmacy_reading_codes_live_idx on public.pharmacy_reading_codes (code_hash) where used_at is null and revoked_at is null;
create index pharmacy_reading_codes_patient_idx on public.pharmacy_reading_codes (patient_id, created_at desc);
alter table public.pharmacy_reading_codes enable row level security;
revoke all on public.pharmacy_reading_codes from public, anon, authenticated;
comment on table public.pharmacy_reading_codes is 'S70b: the one-time code a person makes to let a partner pharmacist record a blood pressure at the counter. Only a peppered HMAC is kept. No client can read it; it is tested through pharmacist_open_reading_visit.';

create table public.pharmacy_reading_failures (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete cascade,
  created_at          timestamptz not null default now()
);
create index pharmacy_reading_failures_partner_idx on public.pharmacy_reading_failures (pharmacy_partner_id, created_at desc);
alter table public.pharmacy_reading_failures enable row level security;
revoke all on public.pharmacy_reading_failures from public, anon, authenticated;
comment on table public.pharmacy_reading_failures is 'S70b: wrong counter codes by pharmacy, for the lockout. Carries no patient. No client can read it.';

create table public.pharmacy_reading_visits (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  pharmacist_id       uuid not null,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  code_id             uuid not null references public.pharmacy_reading_codes (id) on delete restrict,
  max_readings        integer not null,
  readings_used       integer not null default 0 check (readings_used >= 0),
  expires_at          timestamptz not null,
  ended_by_patient_at timestamptz,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  check (readings_used <= max_readings)
);
create index pharmacy_reading_visits_lookup_idx on public.pharmacy_reading_visits (patient_id, pharmacist_id, expires_at desc);
alter table public.pharmacy_reading_visits enable row level security;
revoke all on public.pharmacy_reading_visits from public, anon, authenticated;
grant select on public.pharmacy_reading_visits to authenticated;
create policy pharmacy_reading_visits_patient_select on public.pharmacy_reading_visits for select to authenticated using (patient_id = (select auth.uid()));
comment on table public.pharmacy_reading_visits is 'S70b: a counter visit opened when a pharmacist entered the person''s one-time code. The person reads their own and can end it early. It is the consent record behind assisted_entry_log rows with consent_basis counter_consent.';

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('pharmacy_reading_codes', 'patient_id', 'operational', 'review', false, 'S70b. Peppered hash of a short-lived consent code. PROPOSED class, to be confirmed by the DPO.'),
  ('pharmacy_reading_visits', 'patient_id', 'consent', 'review', true, 'S70b. The counter consent record. PROPOSED class, to be confirmed by the DPO.')
on conflict (table_name) do nothing;

-- 2. The person makes a code (rate limited) and can end a visit ---------------------------------------------------------------------------------
create function public.create_pharmacy_reading_code() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_cfg jsonb := private.pharmacy_reading_cfg();
  v_len integer := (v_cfg ->> 'codeLength')::integer;
  v_org uuid; v_test boolean; v_code text; v_hash text; v_exp timestamptz;
  v_try integer := 0;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.module_enabled('device_pharmacy_readings') then raise exception 'this is not available yet' using errcode = '55000'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_me and role = 'patient' and is_active;
  if v_org is null then raise exception 'only a patient can make a pharmacy code' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pharmacy_code:' || v_me::text));
  if (select count(*) from public.pharmacy_reading_codes where patient_id = v_me and created_at > now() - interval '1 hour') >= (v_cfg ->> 'maxCodesPerHour')::integer then
    raise exception 'too many codes, try again later' using errcode = '54000';
  end if;
  -- an earlier unused code stops working: one live code per person
  update public.pharmacy_reading_codes set revoked_at = now() where patient_id = v_me and used_at is null and revoked_at is null;
  v_exp := now() + make_interval(mins => (v_cfg ->> 'codeValidMinutes')::integer);
  loop
    v_code := lpad((('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40)::bigint % (10::bigint ^ v_len)::bigint)::text, v_len, '0');
    v_hash := private.pharmacy_code_hash(v_code);
    exit when not exists (select 1 from public.pharmacy_reading_codes where code_hash = v_hash and used_at is null and revoked_at is null and expires_at > now());
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'could not make a code, try again' using errcode = '55000'; end if;
  end loop;
  insert into public.pharmacy_reading_codes (organisation_id, patient_id, code_hash, expires_at, is_test) values (v_org, v_me, v_hash, v_exp, v_test);
  perform private.log_audit('pharmacy_reading_code.created', 'profiles', v_me, '{}'::jsonb);
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;
revoke all on function public.create_pharmacy_reading_code() from public, anon;
grant execute on function public.create_pharmacy_reading_code() to authenticated;

-- The person ends any open visit of theirs now (and any unused code). Returns how many visits were closed.
create function public.end_pharmacy_reading_visit() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := (select auth.uid()); v_n integer;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.pharmacy_reading_codes set revoked_at = now() where patient_id = v_me and used_at is null and revoked_at is null;
  update public.pharmacy_reading_visits set expires_at = now(), ended_by_patient_at = now() where patient_id = v_me and expires_at > now();
  get diagnostics v_n = row_count;
  if v_n > 0 then perform private.log_audit('pharmacy_reading_visit.ended_by_patient', 'profiles', v_me, jsonb_build_object('visits', v_n)); end if;
  return v_n;
end $$;
revoke all on function public.end_pharmacy_reading_visit() from public, anon;
grant execute on function public.end_pharmacy_reading_visit() to authenticated;

-- 3. The pharmacist types the code: opens a short counter visit ---------------------------------------------------------------------------------
create function public.pharmacist_open_reading_visit(p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_partner uuid := private.pharmacist_partner();
  v_cfg jsonb := private.pharmacy_reading_cfg();
  v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  v_row public.pharmacy_reading_codes%rowtype;
  v_fails integer; v_exp timestamptz; v_name text; v_number text; v_visit uuid;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.module_enabled('device_pharmacy_readings') then raise exception 'this is not available yet' using errcode = '55000'; end if;
  if not private.pharmacy_partner_live(v_partner) then raise exception 'This pharmacy is not active' using errcode = '42501'; end if;
  -- serialise this pharmacy's attempts: a parallel burst cannot read the same failure count and all pass
  perform pg_advisory_xact_lock(hashtext('pharmacy_open:' || v_partner::text));
  select count(*) into v_fails from public.pharmacy_reading_failures
   where pharmacy_partner_id = v_partner and created_at > now() - make_interval(mins => (v_cfg ->> 'lockoutMinutes')::integer);
  if v_fails >= (v_cfg ->> 'maxFailedAttempts')::integer then
    return jsonb_build_object('outcome', 'locked');
  end if;
  if v_code !~ ('^[0-9]{' || (v_cfg ->> 'codeLength') || '}$') then
    insert into public.pharmacy_reading_failures (pharmacy_partner_id) values (v_partner);
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select * into v_row from public.pharmacy_reading_codes
   where code_hash = private.pharmacy_code_hash(v_code) and used_at is null and revoked_at is null and expires_at > now()
   for update;
  if not found then
    insert into public.pharmacy_reading_failures (pharmacy_partner_id) values (v_partner);
    perform private.log_audit('pharmacy_reading_code.refused', 'pharmacy_partners', v_partner, '{}'::jsonb);
    return jsonb_build_object('outcome', 'invalid');
  end if;
  update public.pharmacy_reading_codes set used_at = now() where id = v_row.id;
  v_exp := now() + make_interval(mins => (v_cfg ->> 'authorisationMinutes')::integer);
  insert into public.pharmacy_reading_visits (organisation_id, patient_id, pharmacist_id, pharmacy_partner_id, code_id, max_readings, expires_at, is_test)
  values (v_row.organisation_id, v_row.patient_id, v_me, v_partner, v_row.id, (v_cfg ->> 'maxReadings')::integer, v_exp, v_row.is_test)
  returning id into v_visit;
  select full_name, patient_number into v_name, v_number from public.profiles where id = v_row.patient_id;
  perform private.log_audit('pharmacy_reading_visit.opened', 'pharmacy_reading_visits', v_visit, jsonb_build_object('pharmacy_partner_id', v_partner));
  return jsonb_build_object('outcome', 'ok', 'patient_id', v_row.patient_id, 'patient_name', v_name, 'patient_number', v_number, 'expires_at', v_exp, 'max_readings', (v_cfg ->> 'maxReadings')::integer);
end $$;
revoke all on function public.pharmacist_open_reading_visit(text) from public, anon;
grant execute on function public.pharmacist_open_reading_visit(text) to authenticated;

-- 4. Claiming one reading from the visit, atomically. Locks the visit row until the end of the transaction, so two parallel records cannot both take the last slot, and
-- the claim and the insert stand or fall together. It also marks THIS transaction as holding a claim, which is the only thing the seam accepts. ---------------------------
create function private.pharmacy_visit_claim(p_patient uuid) returns table (organisation_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare v public.pharmacy_reading_visits%rowtype;
begin
  select * into v from public.pharmacy_reading_visits x
   where x.patient_id = p_patient and x.pharmacist_id = (select auth.uid()) and x.expires_at > now() and x.readings_used < x.max_readings
     and private.pharmacy_partner_live(x.pharmacy_partner_id) and private.module_enabled('device_pharmacy_readings')
   order by x.created_at desc limit 1 for update;
  if not found then return; end if;
  update public.pharmacy_reading_visits set readings_used = readings_used + 1 where id = v.id;
  perform set_config('tarragon.pharmacy_visit', v.id::text, true);
  return query select v.organisation_id;
end $$;
revoke all on function private.pharmacy_visit_claim(uuid) from public, anon;
grant execute on function private.pharmacy_visit_claim(uuid) to authenticated;

-- The organisation of the person's open visit for this pharmacist, for the insert policy (the pharmacist cannot read the visits table).
create function private.pharmacy_visit_org(p_patient uuid) returns table (organisation_id uuid)
language sql stable security definer set search_path = ''
as $$
  select v.organisation_id from public.pharmacy_reading_visits v
   where v.patient_id = p_patient and v.pharmacist_id = (select auth.uid()) and v.expires_at > now() order by v.created_at desc limit 1
$$;
revoke all on function private.pharmacy_visit_org(uuid) from public, anon;
grant execute on function private.pharmacy_visit_org(uuid) to authenticated;

-- 5. The seam: yes only inside a claim made in THIS transaction for an open visit of this pharmacist and this person at a live pharmacy ------------------------------
-- (Body written for the seam created in 20261016191457. It is still ANDed with the go-live guard by private.pharmacy_assisted_entry_open.)
create or replace function private.pharmacy_assisted_entry_allowed(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.module_enabled('device_pharmacy_readings')
     and private.pharmacist_partner() is not null
     and exists (
       select 1 from public.pharmacy_reading_visits v
        where v.id::text = coalesce(current_setting('tarragon.pharmacy_visit', true), '')
          and v.patient_id = p_patient and v.pharmacist_id = (select auth.uid()) and v.expires_at > now()
          and v.pharmacy_partner_id = private.pharmacist_partner()
          and private.pharmacy_partner_live(v.pharmacy_partner_id)
          and v.readings_used between 1 and v.max_readings
     )
$$;
revoke all on function private.pharmacy_assisted_entry_allowed(uuid) from public, anon, authenticated;

-- Blood pressure only, typed ('manual') only, and the row must belong to the person's own organisation.
drop policy if exists vitals_readings_insert_pharmacy_assisted on public.vitals_readings;
create policy vitals_readings_insert_pharmacy_assisted on public.vitals_readings
  for insert to authenticated
  with check (
    private.pharmacy_assisted_entry_open(patient_id) and vital_type = 'blood_pressure' and source = 'manual'
    and organisation_id = (select o.organisation_id from private.pharmacy_visit_org(patient_id) o)
  );

-- 6. The pharmacist records the reading. SECURITY INVOKER on purpose: the policy, the guard, the hold, the red-flag triggers and the ledger run as the pharmacist. -----
create function public.pharmacist_record_bp(p_patient uuid, p_systolic integer, p_diastolic integer) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid; v_id uuid := gen_random_uuid();
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_systolic is null or p_diastolic is null or p_systolic <= 0 or p_diastolic <= 0 or p_diastolic >= p_systolic then
    raise exception 'that reading cannot be right, please measure again' using errcode = '22023';
  end if;
  select c.organisation_id into v_org from private.pharmacy_visit_claim(p_patient) c;
  if v_org is null then raise exception 'no open visit for this person' using errcode = '42501'; end if;
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, source, systolic, diastolic, logged_by_profile_id, taken_at)
  values (v_id, v_org, p_patient, 'blood_pressure', 'manual', p_systolic, p_diastolic, v_me, now());
  return v_id;
end $$;
revoke all on function public.pharmacist_record_bp(uuid, integer, integer) from public, anon;
grant execute on function public.pharmacist_record_bp(uuid, integer, integer) to authenticated;

-- 7. Self-checks -----------------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  if private.module_enabled('device_pharmacy_readings') then raise exception 'S70b: the pharmacy module was born on'; end if;
  if private.go_live_guard_on('assisted_entry_pharmacy_enabled') then raise exception 'S70b: the pharmacy assisted-entry guard must stay off'; end if;
  if private.pharmacy_assisted_entry_allowed(gen_random_uuid()) then raise exception 'S70b: the seam must say no without an open claimed visit'; end if;
  foreach f in array array['public.create_pharmacy_reading_code()', 'public.end_pharmacy_reading_visit()', 'public.pharmacist_open_reading_visit(text)', 'public.pharmacist_record_bp(uuid,integer,integer)',
                           'private.pharmacy_visit_org(uuid)', 'private.pharmacy_visit_claim(uuid)', 'private.pharmacy_code_hash(text)', 'private.pharmacy_partner_live(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S70b: anon can execute %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.pharmacy_code_hash(text)', 'EXECUTE') then raise exception 'S70b: a client can execute the code hash'; end if;
  if has_table_privilege('authenticated', 'public.pharmacy_reading_codes', 'SELECT') or has_table_privilege('authenticated', 'public.pharmacy_reading_failures', 'SELECT')
     or has_table_privilege('anon', 'public.pharmacy_reading_visits', 'SELECT') then
    raise exception 'S70b: a client can read the code or failure tables, or anon can read visits';
  end if;
  if not exists (select 1 from vault.secrets where name = 'pharmacy_reading_pepper') then raise exception 'S70b: the pepper was not created'; end if;
end $$;
