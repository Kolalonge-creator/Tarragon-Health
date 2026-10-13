-- S09x: My Health completion (docs/design/S09x.md).
--   a. A patient-facing access log from ONE function (public.my_access_log), scoped to auth.uid(), no clinical content.
--   b. Safer sharing: optional PIN (bcrypt, per-share salt, shown once, separate from the link), lockout after N misses, per-client rate limit,
--      one-session mode, a shorter default expiry from versioned config (30-day cap kept), every attempt audited.
--   c. Lock-screen presence, the parts that need no Apple or Google credential: a patient setting (OFF by default, D4), a minimal-field facts
--      function, a governed field list (C8, UNSIGNED), and a go-live guard 'wallet_pass' born off with NO conditions branch, so it can never be
--      switched on until the credentials session adds one.
--
-- Read live definitions with pg_get_functiondef on 2026-10-13 before replacing record_share_by_token (the live body differs from the S09 file:
-- S39 added log_public_lookup_failure and lab report_status, S39 round 1 fixed glucose_mmol_l). Live counts: record_shares 0, record_share_lookups 0,
-- emergency_card_lookups 0, so the signature changes and column additions convert no data.
--
-- SECURITY FIXES FOUND WHILE BUILDING THIS (existing behaviour, not new):
--   * record_shares_org_staff_select let ANY org staff member read every share row, including the token, i.e. open any patient's shared record.
--     The comment on it said "not the token"; the policy never delivered that. Dropped: staff have no reason to hold a share credential.
--   * authenticated had INSERT/UPDATE/DELETE on record_shares directly. The RPCs are the door (cap, sections, consent); direct writes revoked.
--   * the new pin_hash must never be readable by a client: select is now granted by column, pin_hash excluded (a table-level revoke first,
--     because a column revoke is a no-op under a table grant).
-- private.is_org_staff is NOT edited.

-- 1. Versioned, governed configuration ------------------------------------------------------------------------------------------------
create table public.my_health_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create unique index my_health_config_one_active on public.my_health_config (is_active) where is_active;
alter table public.my_health_config enable row level security;
revoke all on public.my_health_config from public, anon, authenticated;
grant select on public.my_health_config to authenticated;
create policy my_health_config_read on public.my_health_config for select to authenticated using (true);
create trigger refuse_superseded_activation before update of is_active on public.my_health_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- my-health-config-begin
insert into public.my_health_config (version, is_active, config, notes)
values (1, true, $json${
 "sharing": {
  "default_expiry_hours": 12,
  "max_expiry_hours": 720,
  "expiry_options_hours": [1, 6, 12, 24, 72, 168, 720],
  "pin_digits": 6,
  "pin_max_misses": 5,
  "pin_client_max_misses": 3,
  "pin_client_window_minutes": 15,
  "one_session_window_minutes": 30
 },
 "access_log": {
  "page_size": 50,
  "max_page_size": 100,
  "show_staff_opens": false
 },
 "lock_screen_pass": {
  "default_enabled": false,
  "fields": ["initials", "blood_group", "genotype", "genotype_provenance", "allergies_on_file", "emergency_contact_phone", "unlock_hint"]
 }
}$json$::jsonb,
        'PROPOSED, unsigned. sharing and access_log are the founder''s and counsel''s (OQ-281 holds show_staff_opens at false). lock_screen_pass.fields is CMO item C8 (approved text, not signed): sign_my_health_config() by the CMO. The lock-screen surfaces stay inert until it is signed AND the wallet_pass guard is on.');
-- my-health-config-end

create function private.my_health_cfg(p_section text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config -> p_section from public.my_health_config where is_active; $$;
revoke all on function private.my_health_cfg(text) from public, anon, authenticated;

create function private.my_health_pass_signed() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.my_health_config where is_active and approved_by is not null); $$;
revoke all on function private.my_health_pass_signed() from public, anon, authenticated;

create function public.sign_my_health_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.my_health_config where id = p_id) then raise exception 'My Health config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the My Health config'; end if;
  update public.my_health_config set is_active = false where is_active and id <> p_id;
  update public.my_health_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('my_health_config.signed', 'my_health_config', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_my_health_config(uuid) from public, anon;
grant execute on function public.sign_my_health_config(uuid) to authenticated;

-- 2. record_shares: PIN, lockout, one-session ----------------------------------------------------------------------------------------
alter table public.record_shares
  add column pin_hash         text,
  add column pin_misses       integer not null default 0 check (pin_misses >= 0),
  add column locked_at        timestamptz,
  add column one_session      boolean not null default false,
  add column first_opened_at  timestamptz,
  add column pin_protected    boolean generated always as (pin_hash is not null) stored;

alter table public.record_share_lookups
  add column outcome     text not null default 'opened' check (outcome in ('opened', 'pin_wrong', 'locked')),
  add column client_hash text;
create index record_share_lookups_client_idx on public.record_share_lookups (share_id, client_hash, looked_up_at desc) where outcome = 'pin_wrong';

-- Direct writes are closed: the RPCs are the only door. Staff cannot read a share credential.
drop policy record_shares_org_staff_select on public.record_shares;
drop policy record_shares_patient_insert on public.record_shares;
drop policy record_shares_patient_update on public.record_shares;
revoke all on public.record_shares from authenticated;
grant select (id, organisation_id, patient_id, token, sections, expires_at, is_active, consented_at, revoked_at, view_count, last_viewed_at, created_at,
              pin_misses, locked_at, one_session, first_opened_at, pin_protected) on public.record_shares to authenticated;
revoke all on public.record_share_lookups from authenticated;
grant select (id, share_id, looked_up_at, outcome) on public.record_share_lookups to authenticated;

-- 3. create_record_share (new signature; the old one is dropped so no anon-callable or ambiguous overload remains) ------------------------
drop function public.create_record_share(text[], integer);

create function public.create_record_share(
  p_sections text[],
  p_expires_in_hours integer default null,
  p_use_pin boolean default false,
  p_one_session boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_org_id     uuid;
  v_cfg        jsonb := private.my_health_cfg('sharing');
  v_hours      integer;
  v_max        integer := coalesce((v_cfg ->> 'max_expiry_hours')::integer, 720);
  v_digits     integer := coalesce((v_cfg ->> 'pin_digits')::integer, 6);
  v_token      text;
  v_pin        text;
  v_share      public.record_shares;
  v_allowed    text[] := array['vitals', 'medications', 'conditions', 'allergies', 'lab_results', 'vaccinations', 'emergency_info'];
begin
  v_patient_id := (select auth.uid());
  if v_patient_id is null then raise exception 'not authenticated'; end if;
  select organisation_id into v_org_id from public.profiles where id = v_patient_id;
  if v_org_id is null then raise exception 'profile not found'; end if;
  if p_sections is null or cardinality(p_sections) = 0 then raise exception 'at least one section must be selected'; end if;
  if not (p_sections <@ v_allowed) then
    raise exception 'invalid section in list: allowed are vitals, medications, conditions, allergies, lab_results, vaccinations, emergency_info';
  end if;
  if v_cfg is null or v_cfg ->> 'default_expiry_hours' is null then raise exception 'sharing config missing'; end if;
  -- The door accepts 4 to 12 digit PINs; 32 random bits fill at most 9 digits without bias worth the name. Refuse a config outside that, never issue a PIN that cannot validate.
  if v_digits < 4 or v_digits > 9 then raise exception 'pin_digits must be between 4 and 9'; end if;
  v_hours := coalesce(p_expires_in_hours, (v_cfg ->> 'default_expiry_hours')::integer);
  if v_hours < 1 or v_hours > least(v_max, 720) then raise exception 'expires_in_hours must be between 1 and %', least(v_max, 720); end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  if p_use_pin then
    -- A random PIN the patient cannot weaken. Shown once in this response, never stored in clear.
    v_pin := lpad((abs(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % power(10, v_digits)::bigint)::text, v_digits, '0');
  end if;

  insert into public.record_shares (organisation_id, patient_id, token, sections, expires_at, pin_hash, one_session)
  values (v_org_id, v_patient_id, v_token, p_sections, now() + make_interval(hours => v_hours),
          case when v_pin is null then null else extensions.crypt(v_pin, extensions.gen_salt('bf', 8)) end,
          coalesce(p_one_session, false))
  returning * into v_share;

  return jsonb_build_object(
    'id', v_share.id, 'token', v_share.token, 'sections', v_share.sections,
    'expires_at', v_share.expires_at, 'created_at', v_share.created_at,
    'pin_protected', v_share.pin_protected, 'one_session', v_share.one_session,
    'pin', v_pin);
end;
$$;
revoke all on function public.create_record_share(text[], integer, boolean, boolean) from public, anon;
grant execute on function public.create_record_share(text[], integer, boolean, boolean) to authenticated;

-- 4. record_share_by_token (anon-callable on purpose: the link is the credential) ----------------------------------------------------
--   null                         = not available (unknown, short, revoked, expired, locked, one-session window closed): all look the same
--   {status: 'pin_required'}     = a valid link that needs its PIN (attempts_left present only after a wrong PIN)
--   {status: 'try_later'}        = too many wrong PINs from this client just now
--   {status: 'ok', ...record}    = the record
drop function public.record_share_by_token(text);

create function public.record_share_by_token(p_token text, p_pin text default null, p_client_key text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_share   public.record_shares%rowtype;
  v_profile public.profiles%rowtype;
  v_result  jsonb := '{}'::jsonb;
  v_cfg     jsonb := private.my_health_cfg('sharing');
  v_max     integer := coalesce((v_cfg ->> 'pin_max_misses')::integer, 5);
  v_cmax    integer := coalesce((v_cfg ->> 'pin_client_max_misses')::integer, 3);
  v_cwin    integer := coalesce((v_cfg ->> 'pin_client_window_minutes')::integer, 15);
  v_osw     integer := coalesce((v_cfg ->> 'one_session_window_minutes')::integer, 30);
  v_client  text;
  v_n       integer;
  v_misses  integer;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  -- The row lock serialises concurrent guesses so the miss counter cannot be raced.
  select * into v_share from public.record_shares where token = p_token for update;

  if not found or not v_share.is_active or v_share.expires_at <= now() or v_share.locked_at is not null then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;

  if v_share.one_session and v_share.first_opened_at is not null
     and now() > v_share.first_opened_at + make_interval(mins => v_osw) then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_share.patient_id;
  if not found then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;

  if v_share.pin_hash is not null then
    if p_pin is null or btrim(p_pin) = '' then
      return jsonb_build_object('status', 'pin_required');
    end if;
    v_client := case when p_client_key is null then null else encode(extensions.digest(p_client_key, 'sha256'), 'hex') end;
    if v_client is not null then
      select count(*) into v_n from public.record_share_lookups
       where share_id = v_share.id and client_hash = v_client and outcome = 'pin_wrong'
         and looked_up_at > now() - make_interval(mins => v_cwin);
      if v_n >= v_cmax then
        return jsonb_build_object('status', 'try_later');
      end if;
    end if;

    if p_pin !~ '^[0-9]{4,12}$' or extensions.crypt(p_pin, v_share.pin_hash) is distinct from v_share.pin_hash then
      v_misses := v_share.pin_misses + 1;
      update public.record_shares set pin_misses = v_misses where id = v_share.id;
      insert into public.record_share_lookups (share_id, outcome, client_hash) values (v_share.id, 'pin_wrong', v_client);
      if v_misses >= v_max then
        update public.record_shares set locked_at = now() where id = v_share.id;
        insert into public.record_share_lookups (share_id, outcome, client_hash) values (v_share.id, 'locked', v_client);
        return null;
      end if;
      return jsonb_build_object('status', 'pin_required', 'attempts_left', v_max - v_misses);
    end if;
    update public.record_shares set pin_misses = 0 where id = v_share.id;
  end if;

  insert into public.record_share_lookups (share_id, outcome, client_hash) values (v_share.id, 'opened', v_client);
  update public.record_shares
     set view_count = view_count + 1, last_viewed_at = now(), first_opened_at = coalesce(first_opened_at, now())
   where id = v_share.id
  returning * into v_share;

  v_result := jsonb_build_object(
    'status', 'ok',
    'full_name', v_profile.full_name,
    'shared_at', v_share.created_at,
    'expires_at', v_share.expires_at,
    'sections', v_share.sections,
    'one_session', v_share.one_session,
    'session_ends_at', case when v_share.one_session then v_share.first_opened_at + make_interval(mins => v_osw) else null end
  );

  if 'vitals' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'vitals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vital_type', vr.vital_type::text, 'systolic', vr.systolic, 'diastolic', vr.diastolic, 'pulse_bpm', vr.pulse_bpm,
          'glucose_mmol', vr.glucose_mmol_l, 'weight_kg', vr.weight_kg, 'temperature_c', vr.temperature_c,
          'spo2_pct', vr.spo2_pct, 'source', vr.source::text, 'taken_at', vr.taken_at
        ) order by vr.taken_at desc)
        from (select * from public.vitals_readings where patient_id = v_share.patient_id order by taken_at desc limit 20) vr
      ), '[]'::jsonb));
  end if;

  if 'medications' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'medications', coalesce((
        select jsonb_agg(jsonb_build_object('drug_name', m.drug_name, 'dose', m.dose, 'frequency', m.frequency, 'is_active', m.is_active) order by m.drug_name)
        from public.medications m where m.patient_id = v_share.patient_id and m.is_active
      ), '[]'::jsonb));
  end if;

  if 'conditions' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'conditions', coalesce((
        select jsonb_agg(distinct cp.condition::text) from public.care_plans cp
        where cp.patient_id = v_share.patient_id and cp.status = 'active'
      ), '[]'::jsonb));
  end if;

  if 'allergies' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'allergies', coalesce((
        select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity)
                         order by a.severity desc nulls last, a.allergen)
        from public.patient_allergies a where a.patient_id = v_share.patient_id
      ), '[]'::jsonb));
  end if;

  if 'lab_results' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'lab_results', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', lr.code, 'value', lr.value, 'value_text', lr.value_text, 'unit', lr.unit,
          'reference_range_text', lr.reference_range_text, 'abnormal_flag', lr.abnormal_flag,
          'taken_at', lr.taken_at, 'laboratory', lr.laboratory
        ) order by lr.taken_at desc)
        from (
          select * from public.lab_analyte_readings
          where patient_id = v_share.patient_id and report_status in ('final', 'corrected', 'amended')
          order by taken_at desc limit 20
        ) lr
      ), '[]'::jsonb));
  end if;

  if 'vaccinations' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'vaccinations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vaccine_name', vc.name, 'date_administered', vr.date_administered,
          'dose_number', vr.dose_number, 'batch_number', vr.batch_lot_number
        ) order by vr.date_administered desc)
        from public.vaccination_records vr
        left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id
        where vr.profile_id = v_share.patient_id
      ), '[]'::jsonb));
  end if;

  if 'emergency_info' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'emergency_info', jsonb_build_object(
        'blood', (
          select jsonb_build_object('blood_group', b.blood_group::text, 'genotype', b.genotype::text, 'source', b.provenance::text)
          from public.patient_blood_profile b where b.patient_id = v_share.patient_id
        ),
        'emergency_contact', case
          when v_profile.emergency_contact_name is null then null
          else jsonb_build_object('name', v_profile.emergency_contact_name, 'phone', v_profile.emergency_contact_phone,
                                  'relationship', v_profile.emergency_contact_relationship)
        end));
  end if;

  return v_result;
end;
$$;
-- The one deliberate anon-callable door here; every other function in this file is revoked from public.
revoke all on function public.record_share_by_token(text, text, text) from public;
grant execute on function public.record_share_by_token(text, text, text) to anon, authenticated;

-- A side-effect-free look at a link, for the landing page. A link preview, a crawler or a browser prefetch fetches the page; it must not count as the
-- recipient opening the record, start a one-session window or write an 'opened' audit row. Only an explicit submit calls record_share_by_token.
--   null = not available (same cases as the door), 'pin_required' = needs its PIN, 'ready' = open on request. Dead links feed the same failure counter.
create function public.record_share_peek(p_token text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_share public.record_shares%rowtype;
  v_osw   integer := coalesce((private.my_health_cfg('sharing') ->> 'one_session_window_minutes')::integer, 30);
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select * into v_share from public.record_shares where token = p_token;
  if not found or not v_share.is_active or v_share.expires_at <= now() or v_share.locked_at is not null
     or (v_share.one_session and v_share.first_opened_at is not null and now() > v_share.first_opened_at + make_interval(mins => v_osw)) then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;
  return case when v_share.pin_hash is not null then 'pin_required' else 'ready' end;
end;
$$;
revoke all on function public.record_share_peek(text) from public;
grant execute on function public.record_share_peek(text) to anon, authenticated;

-- 5. The patient's access log ------------------------------------------------------------------------------------------------------
--   Who, when, what kind of thing. Never a value, a reason, a medicine, a condition or an allergen. Routine staff openings (S39c) are NOT shown
--   unless access_log.show_staff_opens is true: founder direction 2026-10-07 is that the patient is not told, pending counsel (OQ-281).
--   Break-glass and emergency access ARE shown: they are exceptional, and the plan (S06-S10 section 3.4) promises it.
--   reproductive_health: nothing here reads a category table; break-glass never opens it (private.has_emergency_access) and no row names it.
create function public.my_access_log(p_limit integer default null, p_before timestamptz default null, p_before_id text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_cfg   jsonb := private.my_health_cfg('access_log');
  v_size  integer;
  v_staff boolean := coalesce((v_cfg ->> 'show_staff_opens')::boolean, false);
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_size := least(greatest(coalesce(p_limit, (v_cfg ->> 'page_size')::integer, 50), 1), coalesce((v_cfg ->> 'max_page_size')::integer, 100));

  -- Keyset paging on (at, rid): rid is unique per source row, so rows sharing a timestamp (a wrong PIN and the lock it caused are written in one
  -- transaction) are never lost at a page boundary. Each source applies the cursor and its own limit first, so a long history is never scanned whole.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', e.at, 'rid', e.rid, 'kind', e.kind, 'actor_label', e.actor_label, 'actor_name', e.actor_name,
             'categories', e.categories, 'status', e.status, 'ends_at', e.ends_at) order by e.at desc, e.rid desc)
    from (
      select * from (
        (select l.looked_up_at as at, 'l:' || l.id::text as rid,
               case l.outcome when 'opened' then 'share_opened' when 'pin_wrong' then 'share_pin_wrong' else 'share_locked' end as kind,
               'Someone with your share link'::text as actor_label, null::text as actor_name,
               s.sections as categories, null::text as status, null::timestamptz as ends_at
          from public.record_share_lookups l join public.record_shares s on s.id = l.share_id
         where s.patient_id = v_uid and (p_before is null or l.looked_up_at < p_before or (p_before_id is not null and l.looked_up_at = p_before and ('l:' || l.id::text) < p_before_id))
         order by l.looked_up_at desc, l.id desc limit v_size)
        union all
        (select l.looked_up_at, 'c:' || l.id::text, 'emergency_card_opened', 'Someone with your emergency card link', null, array['emergency_card']::text[], null, null
          from public.emergency_card_lookups l join public.emergency_cards c on c.id = l.card_id
         where c.patient_id = v_uid and (p_before is null or l.looked_up_at < p_before or (p_before_id is not null and l.looked_up_at = p_before and ('c:' || l.id::text) < p_before_id))
         order by l.looked_up_at desc, l.id desc limit v_size)
        union all
        (select g.granted_at, 'g:' || g.id::text, 'emergency_access_grant', 'Person you allowed to use emergency access', p.full_name, array['emergency_access']::text[],
               case when g.revoked_at is not null then 'revoked' when g.expires_at <= now() then 'expired' else 'active' end,
               coalesce(g.revoked_at, g.expires_at)
          from public.emergency_access_grants g left join public.profiles p on p.id = g.grantee_user_id
         where g.profile_id = v_uid and (p_before is null or g.granted_at < p_before or (p_before_id is not null and g.granted_at = p_before and ('g:' || g.id::text) < p_before_id))
         order by g.granted_at desc, g.id desc limit v_size)
        union all
        (select g.granted_at, 'b:' || g.id::text, 'emergency_record_access', 'Clinician using emergency access',
               nullif(concat_ws(', ', p.full_name, o.name), ''), array['emergency_record']::text[],
               case when g.ended_at is not null then 'ended' when g.expires_at <= now() then 'expired' else 'active' end,
               coalesce(g.ended_at, g.expires_at)
          from public.emergency_record_access_grants g
          left join public.profiles p on p.id = g.requester_id
          left join public.organisations o on o.id = g.requester_org_id
         where g.patient_id = v_uid and (p_before is null or g.granted_at < p_before or (p_before_id is not null and g.granted_at = p_before and ('b:' || g.id::text) < p_before_id))
         order by g.granted_at desc, g.id desc limit v_size)
        union all
        (select e2.occurred_at, 'd:' || e2.id::text, 'delegated_access', 'Person you gave access to', p.full_name, array[coalesce(e2.scope, 'record')]::text[], null, null
          from public.care_access_events e2 left join public.profiles p on p.id = e2.actor_profile_id
         where e2.patient_id = v_uid and e2.kind in ('record_viewed', 'receipt_generated', 'acted_for') and (p_before is null or e2.occurred_at < p_before or (p_before_id is not null and e2.occurred_at = p_before and ('d:' || e2.id::text) < p_before_id))
         order by e2.occurred_at desc, e2.id desc limit v_size)
        union all
        (select o2.opened_at, 's:' || o2.id::text, 'staff_record_opened', 'Member of your care team', p.full_name, array['record_opened']::text[], o2.basis, o2.expires_at
          from public.staff_record_opens o2 left join public.profiles p on p.id = o2.staff_id
         where v_staff and o2.patient_id = v_uid and (p_before is null or o2.opened_at < p_before or (p_before_id is not null and o2.opened_at = p_before and ('s:' || o2.id::text) < p_before_id))
         order by o2.opened_at desc, o2.id desc limit v_size)
      ) u
      order by u.at desc, u.rid desc
      limit v_size
    ) e
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_access_log(integer, timestamptz, text) from public, anon;
grant execute on function public.my_access_log(integer, timestamptz, text) to authenticated;

-- 6. Lock-screen presence ---------------------------------------------------------------------------------------------------------
create table public.patient_lock_screen_pass (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now()
);
-- profile_id, not patient_id, on purpose: a patient_id column puts a table in data_registry (S39d), whose rows need a CMO/DPO review this
-- session must not fake. Adding this table to the registry is a follow-up for that review (docs/design/S09x.md).
alter table public.patient_lock_screen_pass enable row level security;
revoke all on public.patient_lock_screen_pass from public, anon, authenticated;
grant select on public.patient_lock_screen_pass to authenticated;
create policy patient_lock_screen_pass_own on public.patient_lock_screen_pass for select to authenticated
  using (profile_id = (select auth.uid()));

create function public.set_lock_screen_pass(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_enabled is null then raise exception 'p_enabled is required'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'profile not found'; end if;
  insert into public.patient_lock_screen_pass (profile_id, organisation_id, enabled, updated_at)
  values (v_uid, v_org, p_enabled, now())
  on conflict (profile_id) do update set enabled = excluded.enabled, updated_at = now();
  return p_enabled;
end;
$$;
revoke all on function public.set_lock_screen_pass(boolean) from public, anon;
grant execute on function public.set_lock_screen_pass(boolean) to authenticated;

-- The minimal facts. The database is the first minimiser: no medicine, condition or allergen NAME is ever returned, only "has allergies on file".
-- Off by default: returns only {enabled:false, fields_signed} until the patient turns it on.
create function public.my_lock_screen_facts() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_enabled boolean;
  v_name    text;
  v_phone   text;
  v_words   text[];
  v_blood   record;
  v_fields  jsonb := coalesce(private.my_health_cfg('lock_screen_pass') -> 'fields', '[]'::jsonb);
  v_signed  boolean := private.my_health_pass_signed();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select coalesce((select enabled from public.patient_lock_screen_pass where profile_id = v_uid),
                  coalesce((private.my_health_cfg('lock_screen_pass') ->> 'default_enabled')::boolean, false))
    into v_enabled;
  if not v_enabled then
    return jsonb_build_object('enabled', false, 'fields_signed', v_signed);
  end if;
  select full_name, emergency_contact_phone into v_name, v_phone from public.profiles where id = v_uid;
  v_words := regexp_split_to_array(btrim(coalesce(v_name, '')), '\s+');
  select b.blood_group::text as bg, b.genotype::text as gt, b.provenance::text as pv into v_blood
    from public.patient_blood_profile b where b.patient_id = v_uid;
  return jsonb_strip_nulls(jsonb_build_object(
    'enabled', true,
    'fields_signed', v_signed,
    'fields', v_fields,
    'initials', nullif(upper(left(v_words[1], 1) || case when cardinality(v_words) > 1 then left(v_words[cardinality(v_words)], 1) else '' end), ''),
    'blood_group', v_blood.bg,
    'genotype', v_blood.gt,
    'genotype_provenance', v_blood.pv,
    'allergies_on_file', case when exists (select 1 from public.patient_allergies a where a.patient_id = v_uid) then true else null end,
    'emergency_contact_phone', nullif(btrim(coalesce(v_phone, '')), '')
  ));
end;
$$;
revoke all on function public.my_lock_screen_facts() from public, anon;
grant execute on function public.my_lock_screen_facts() to authenticated;

-- 7. Go-live guard 'wallet_pass' (born off) ----------------------------------------------------------------------------------------
-- Deliberately NO branch in private.go_live_conditions: an unknown key returns one unmet 'unknown_guard' condition, so set_go_live_guard
-- refuses to switch it on (fail closed). The session that holds the Apple Pass Type ID certificate and the Google Wallet issuer account adds the
-- branch (and the attestations) in the same change that adds the signer. Until then the generator in apps/web/src/lib/wallet-pass cannot run.
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('wallet_pass', 'Lock-screen wallet pass', 'Issuing an Apple Wallet or Google Wallet pass that carries a patient''s emergency basics',
   'Apple Pass Type ID certificate and Google Wallet issuer account held; CMO has signed the pass field list (C8); counsel has given a view on the NDPA basis (D9)',
   'admin', array['wallet-pass generator (apps/web/src/lib/wallet-pass)'],
   'The printable card and the patient setting are not behind it: they reveal nothing the patient did not choose to print or turn on.')
on conflict (key) do nothing;

-- 8. Self-checks ------------------------------------------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.my_health_config where is_active) <> 1 then raise exception 'S09x: exactly one active my_health_config expected'; end if;
  if has_function_privilege('anon', 'public.create_record_share(text[], integer, boolean, boolean)', 'EXECUTE') then raise exception 'S09x: anon can create shares'; end if;
  if has_function_privilege('anon', 'public.my_access_log(integer, timestamptz, text)', 'EXECUTE') then raise exception 'S09x: anon can read the access log'; end if;
  if has_function_privilege('anon', 'public.my_lock_screen_facts()', 'EXECUTE') then raise exception 'S09x: anon can read lock-screen facts'; end if;
  if has_function_privilege('anon', 'public.set_lock_screen_pass(boolean)', 'EXECUTE') then raise exception 'S09x: anon can set the pass'; end if;
  if has_function_privilege('anon', 'public.sign_my_health_config(uuid)', 'EXECUTE') then raise exception 'S09x: anon can sign'; end if;
  if not has_function_privilege('anon', 'public.record_share_peek(text)', 'EXECUTE') then raise exception 'S09x: the share landing check must stay anon-callable'; end if;
  if not has_function_privilege('anon', 'public.record_share_by_token(text, text, text)', 'EXECUTE') then raise exception 'S09x: the share door must stay anon-callable'; end if;
  if has_column_privilege('authenticated', 'public.record_shares', 'pin_hash', 'SELECT') then raise exception 'S09x: a client can read pin_hash'; end if;
  if has_table_privilege('authenticated', 'public.record_shares', 'UPDATE') or has_table_privilege('authenticated', 'public.record_shares', 'INSERT') then
    raise exception 'S09x: a client can write record_shares directly';
  end if;
  if (select is_on from public.go_live_guards where key = 'wallet_pass') is distinct from false then raise exception 'S09x: wallet_pass must be born off'; end if;
end $$;
