-- S43 part 2 of 3: share links (spec 2.8) and the emergency card's patient-chosen fields (spec 2.7).
-- Design: docs/design/S43.md. Not applied to production by the session that wrote it.
--
-- Counted first (live, read-only, 2026-10-07): record_shares 0 rows, emergency_cards 1 row. So hashing the stored token and replacing the create
-- function cannot strand a link someone is using.
--
-- Share links, what changes (S09 built the first version, already live):
--   * The token is stored as a SHA-256 hash (token_hash). The plaintext `token` column stays (nullable, always null for new links) so the deployed
--     client that still selects it keeps working while the code ships first; a later migration can drop it.
--   * Default expiry comes from versioned config (record_share_config v1: 72 hours default, 720 maximum), not from the client.
--   * Optional PIN (stored with crypt/bf, never returned), locked after the configured number of wrong tries.
--   * Optional view cap, counted under a row lock so two simultaneous openings cannot both take the last view.
--   * Every outcome is logged against the link (record_share_lookups.outcome): viewed, expired, revoked, view_cap, pin_wrong, locked. The patient sees them.
--   * record_share_open(token, pin) returns a status the web route turns into 200, 401 (pin), 410 (expired, revoked, view cap) or 404.
--   * Two sections added (procedures, family_history). Mental health and reproductive data are NOT in the closed set, so they are off by default and
--     cannot be added by accident (a CHECK refuses them). Letting a patient opt them in explicitly is a decision recorded in OQ-S43.
--   * BUG FIXED: the S09 vitals section selected vr.glucose_mmol, a column that does not exist (it is glucose_mmol_l), so choosing the vitals section made every
--     opening raise. Found by this session's proof by exercising the section the S09 proof never opened. The output key stays glucose_mmol for the public page.
--   * BUG FIXED: the S09 lab_results section compared report_status to 'released', which is not a member of lab_report_status, so choosing that
--     section made the function raise on every opening. It now reads only released, non-withdrawn, non-sensitive result items plus final legacy readings.
--
-- Emergency card: patient-chosen fields (emergency_card_fields). The shipped public function is RENAMED, not rewritten, and a wrapper with the
-- original name and signature strips what the patient did not choose. That keeps whatever body is live (including later hardening) and means the
-- renamed function can no longer be called by anyone directly, so an excluded field cannot be read around the wrapper.

-- ---------------------------------------------------------------------------
-- 1. Versioned config
-- ---------------------------------------------------------------------------
create table if not exists public.record_share_config (
  version            integer primary key check (version >= 1),
  default_hours      integer not null check (default_hours between 1 and 720),
  max_hours          integer not null check (max_hours between 1 and 720),
  max_pin_attempts   integer not null check (max_pin_attempts between 3 and 20),
  min_pin_length     integer not null check (min_pin_length between 4 and 8),
  status             text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  is_active          boolean not null default false,
  note               text,
  created_at         timestamptz not null default now(),
  check (default_hours <= max_hours)
);
create unique index if not exists record_share_config_one_active on public.record_share_config (is_active) where is_active;

alter table public.record_share_config enable row level security;
create policy record_share_config_read on public.record_share_config for select to authenticated using (true);
grant select on public.record_share_config to authenticated;
revoke insert, update, delete, truncate on public.record_share_config from authenticated;
revoke all on public.record_share_config from anon;

-- v1: the spec's 72 hour default (X7). PROPOSED until the founder and the CMO confirm; a later version is a new row, never an edit.
insert into public.record_share_config (version, default_hours, max_hours, max_pin_attempts, min_pin_length, status, is_active, note)
values (1, 72, 720, 5, 4, 'proposed', true, 'S43 proposal: spec section 2.8 default of 72 hours; 30 day ceiling as built in S09; five wrong PIN tries; 4 digit minimum.')
on conflict (version) do nothing;

create or replace function private.record_share_setting()
returns public.record_share_config
language sql stable security definer set search_path = ''
as $$ select c from public.record_share_config c where c.is_active limit 1 $$;
revoke all on function private.record_share_setting() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. record_shares columns
-- ---------------------------------------------------------------------------
alter table public.record_shares
  add column if not exists token_hash text,
  add column if not exists pin_hash text,
  add column if not exists pin_failed_attempts integer not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists max_views integer check (max_views is null or max_views between 1 and 1000),
  add column if not exists config_version integer;

-- lets the owner's screen say "PIN needed" without ever selecting the hash itself
alter table public.record_shares add column if not exists has_pin boolean generated always as (pin_hash is not null) stored;

-- hash any plaintext token that exists, then stop holding it
update public.record_shares
   set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 where token_hash is null and token is not null;
alter table public.record_shares alter column token drop not null;
update public.record_shares set token = null where token is not null;
create unique index if not exists record_shares_token_hash_unique on public.record_shares (token_hash) where token_hash is not null;
alter table public.record_shares drop constraint if exists record_shares_has_a_token;
alter table public.record_shares add constraint record_shares_has_a_token check (token_hash is not null or token is not null);

-- the closed set of sections: two added; mental health and reproductive data are deliberately not members
alter table public.record_shares drop constraint if exists record_shares_sections_valid;
alter table public.record_shares add constraint record_shares_sections_valid
  check (sections <@ array['vitals', 'medications', 'conditions', 'allergies', 'lab_results', 'vaccinations', 'emergency_info', 'procedures', 'family_history']::text[]);

alter table public.record_share_lookups
  add column if not exists outcome text not null default 'viewed'
    check (outcome in ('viewed', 'expired', 'revoked', 'view_cap', 'pin_wrong', 'locked'));

-- ---------------------------------------------------------------------------
-- 3. create_record_share (the 2-argument S09 signature is dropped so a 2-argument call is never ambiguous)
-- ---------------------------------------------------------------------------
drop function if exists public.create_record_share(text[], integer);

create or replace function public.create_record_share(
  p_sections text[],
  p_expires_in_hours integer default null,
  p_pin text default null,
  p_max_views integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id uuid := (select auth.uid());
  v_org_id uuid;
  v_cfg public.record_share_config;
  v_hours integer;
  v_token text;
  v_share public.record_shares;
  v_allowed text[] := array['vitals', 'medications', 'conditions', 'allergies', 'lab_results', 'vaccinations', 'emergency_info', 'procedures', 'family_history'];
begin
  if v_patient_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select organisation_id into v_org_id from public.profiles where id = v_patient_id;
  if v_org_id is null then
    raise exception 'profile not found';
  end if;
  v_cfg := private.record_share_setting();
  if v_cfg.version is null then
    raise exception 'record sharing has no active configuration' using errcode = '55000';
  end if;
  if p_sections is null or cardinality(p_sections) = 0 then
    raise exception 'at least one section must be selected';
  end if;
  if not (p_sections <@ v_allowed) then
    raise exception 'invalid section in list: allowed are %', array_to_string(v_allowed, ', ');
  end if;
  v_hours := coalesce(p_expires_in_hours, v_cfg.default_hours);
  if v_hours < 1 or v_hours > v_cfg.max_hours then
    raise exception 'expires_in_hours must be between 1 and %', v_cfg.max_hours;
  end if;
  if p_pin is not null then
    if p_pin !~ '^[0-9]+$' or char_length(p_pin) < v_cfg.min_pin_length or char_length(p_pin) > 8 then
      raise exception 'the PIN must be % to 8 digits', v_cfg.min_pin_length;
    end if;
  end if;
  if p_max_views is not null and (p_max_views < 1 or p_max_views > 1000) then
    raise exception 'the view limit must be between 1 and 1000';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.record_shares
    (organisation_id, patient_id, token, token_hash, sections, expires_at, pin_hash, max_views, config_version)
  values
    (v_org_id, v_patient_id, null, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_sections,
     now() + make_interval(hours => v_hours),
     case when p_pin is null then null else extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) end,
     p_max_views, v_cfg.version)
  returning * into v_share;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (v_org_id, v_patient_id, 'record_share.created', 'record_shares', v_share.id,
          jsonb_build_object('sections', to_jsonb(p_sections), 'expires_at', v_share.expires_at, 'has_pin', p_pin is not null, 'max_views', p_max_views),
          v_patient_id);

  -- the token is shown to the patient once, here, and exists nowhere in the database after this call
  return jsonb_build_object('id', v_share.id, 'token', v_token, 'sections', v_share.sections, 'expires_at', v_share.expires_at,
                            'created_at', v_share.created_at, 'has_pin', p_pin is not null, 'max_views', p_max_views);
end;
$$;

create or replace function public.revoke_record_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.record_shares
     set is_active = false, revoked_at = now()
   where id = p_share_id and patient_id = (select auth.uid()) and is_active;
  if not found then
    raise exception 'share not found or already revoked';
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  select organisation_id, patient_id, 'record_share.revoked', 'record_shares', id, '{}'::jsonb, patient_id
    from public.record_shares where id = p_share_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. record_share_open: the one door for a link, anon-callable, returns a status
-- ---------------------------------------------------------------------------
create or replace function public.record_share_open(p_token text, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.record_share_config;
  s public.record_shares%rowtype;
  v_profile public.profiles%rowtype;
  v_out jsonb;
  v_attempts_left integer;
  v_lookup uuid;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_cfg := private.record_share_setting();

  -- the row lock serialises two simultaneous openings, so a view cap cannot be exceeded
  select * into s from public.record_shares where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not s.is_active or s.revoked_at is not null then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'revoked');
    return jsonb_build_object('status', 'gone', 'reason', 'revoked');
  end if;
  if s.expires_at <= now() then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'expired');
    return jsonb_build_object('status', 'gone', 'reason', 'expired');
  end if;
  if s.max_views is not null and s.view_count >= s.max_views then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'view_cap');
    return jsonb_build_object('status', 'gone', 'reason', 'view_cap');
  end if;
  if s.locked_at is not null then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'locked');
    return jsonb_build_object('status', 'locked');
  end if;

  if s.pin_hash is not null then
    if p_pin is null or btrim(p_pin) = '' then
      return jsonb_build_object('status', 'pin_required');
    end if;
    if extensions.crypt(p_pin, s.pin_hash) is distinct from s.pin_hash then
      update public.record_shares
         set pin_failed_attempts = pin_failed_attempts + 1,
             locked_at = case when pin_failed_attempts + 1 >= v_cfg.max_pin_attempts then now() else null end
       where id = s.id
      returning v_cfg.max_pin_attempts - pin_failed_attempts into v_attempts_left;
      insert into public.record_share_lookups (share_id, outcome) values (s.id, 'pin_wrong');
      return jsonb_build_object('status', 'pin_wrong', 'attempts_left', greatest(v_attempts_left, 0));
    end if;
    update public.record_shares set pin_failed_attempts = 0 where id = s.id;
  end if;

  select * into v_profile from public.profiles where id = s.patient_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.record_share_lookups (share_id, outcome) values (s.id, 'viewed') returning id into v_lookup;
  update public.record_shares set view_count = view_count + 1, last_viewed_at = now() where id = s.id;
  perform private.emit_domain_event('share_link.accessed', s.organisation_id, jsonb_build_object('share_id', s.id),
                                    'share_link.accessed:' || v_lookup::text, s.patient_id, 'record_share', s.id);

  v_out := jsonb_build_object('full_name', v_profile.full_name, 'shared_at', s.created_at, 'expires_at', s.expires_at, 'sections', s.sections,
                              'views_left', case when s.max_views is null then null else s.max_views - s.view_count - 1 end);

  if 'vitals' = any (s.sections) then
    v_out := v_out || jsonb_build_object('vitals', coalesce((
      select jsonb_agg(jsonb_build_object('vital_type', vr.vital_type::text, 'systolic', vr.systolic, 'diastolic', vr.diastolic,
               'pulse_bpm', vr.pulse_bpm, 'glucose_mmol', vr.glucose_mmol_l, 'weight_kg', vr.weight_kg, 'temperature_c', vr.temperature_c,
               'spo2_pct', vr.spo2_pct, 'source', vr.source::text, 'taken_at', vr.taken_at) order by vr.taken_at desc)
        from (select * from public.vitals_readings where patient_id = s.patient_id order by taken_at desc limit 20) vr), '[]'::jsonb));
  end if;
  if 'medications' = any (s.sections) then
    v_out := v_out || jsonb_build_object('medications', coalesce((
      select jsonb_agg(jsonb_build_object('drug_name', m.drug_name, 'dose', m.dose, 'frequency', m.frequency, 'is_active', m.is_active) order by m.drug_name)
        from public.medications m where m.patient_id = s.patient_id and m.is_active), '[]'::jsonb));
  end if;
  if 'conditions' = any (s.sections) then
    v_out := v_out || jsonb_build_object('conditions', coalesce((
      select jsonb_agg(distinct cp.condition::text) from public.care_plans cp where cp.patient_id = s.patient_id and cp.status = 'active'), '[]'::jsonb));
  end if;
  if 'allergies' = any (s.sections) then
    v_out := v_out || jsonb_build_object('allergies', coalesce((
      select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity) order by a.severity desc nulls last, a.allergen)
        from public.patient_allergies a where a.patient_id = s.patient_id), '[]'::jsonb));
  end if;
  -- Lab results: released and not withdrawn (INV-03), never a sensitive positive (INV-04: a link holder is not a clinician disclosing it),
  -- plus final legacy readings. A held, withheld or withdrawn result is invisible here exactly as it is to the patient.
  if 'lab_results' = any (s.sections) then
    v_out := v_out || jsonb_build_object('lab_results', coalesce((
      select jsonb_agg(x.j order by x.taken_at desc) from (
        select r.released_at as taken_at,
               jsonb_build_object('code', i.analyte_code, 'value', i.value_numeric, 'value_text', i.value_text, 'unit', i.unit,
                 'reference_range_text', case when i.ref_low is not null or i.ref_high is not null then concat_ws(' to ', i.ref_low::text, i.ref_high::text) end,
                 'abnormal_flag', i.flag, 'taken_at', r.released_at, 'laboratory', null) as j
          from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
         where i.patient_id = s.patient_id and r.release_state = 'released' and r.withdrawn_at is null and not i.sensitive_positive
        union all
        select lr.taken_at,
               jsonb_build_object('code', lr.code, 'value', lr.value, 'value_text', lr.value_text, 'unit', lr.unit,
                 'reference_range_text', lr.reference_range_text, 'abnormal_flag', lr.abnormal_flag::text, 'taken_at', lr.taken_at, 'laboratory', lr.laboratory)
          from public.lab_analyte_readings lr
         where lr.patient_id = s.patient_id and lr.report_status in ('final', 'corrected', 'amended')
         order by 1 desc limit 40) x), '[]'::jsonb));
  end if;
  if 'vaccinations' = any (s.sections) then
    v_out := v_out || jsonb_build_object('vaccinations', coalesce((
      select jsonb_agg(jsonb_build_object('vaccine_name', vc.name, 'date_administered', vr.date_administered, 'dose_number', vr.dose_number,
               'batch_number', vr.batch_lot_number, 'verified', vr.verification_status::text = 'verified') order by vr.date_administered desc)
        from public.vaccination_records vr left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id
       where vr.profile_id = s.patient_id), '[]'::jsonb));
  end if;
  if 'procedures' = any (s.sections) then
    v_out := v_out || jsonb_build_object('procedures', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'performed_on', p.performed_on, 'approximate_year', p.approximate_year, 'facility', p.facility,
               'verified_by_clinician', p.verified_by_clinician) order by coalesce(p.performed_on, make_date(coalesce(p.approximate_year, 1900), 1, 1)) desc)
        from public.procedures p where p.patient_id = s.patient_id and p.removed_at is null), '[]'::jsonb));
  end if;
  if 'family_history' = any (s.sections) then
    v_out := v_out || jsonb_build_object('family_history', coalesce((
      select jsonb_agg(jsonb_build_object('condition_name', f.condition_name, 'relationship', f.relationship::text, 'age_of_onset_years', f.age_of_onset_years,
               'verified_by_clinician', f.verified_by_clinician) order by f.condition_name)
        from public.family_history f where f.patient_id = s.patient_id and f.removed_at is null), '[]'::jsonb));
  end if;
  if 'emergency_info' = any (s.sections) then
    v_out := v_out || jsonb_build_object('emergency_info', jsonb_build_object(
      'blood', (select jsonb_build_object('blood_group', b.blood_group::text, 'genotype', b.genotype::text, 'source', b.provenance::text)
                  from public.patient_blood_profile b where b.patient_id = s.patient_id),
      'emergency_contact', case when v_profile.emergency_contact_name is null then null
         else jsonb_build_object('name', v_profile.emergency_contact_name, 'phone', v_profile.emergency_contact_phone, 'relationship', v_profile.emergency_contact_relationship) end));
  end if;

  return jsonb_build_object('status', 'ok', 'record', v_out);
end;
$$;

-- The S09 name stays callable for the web code that is already deployed. It returns the record only on a clean opening and null otherwise
-- (a PIN-protected link therefore reads as not found to the old page, which is the safe direction).
create or replace function public.record_share_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  v := public.record_share_open(p_token, null);
  if v ->> 'status' = 'ok' then
    return v -> 'record';
  end if;
  return null;
end;
$$;

revoke all on function public.create_record_share(text[], integer, text, integer) from public, anon;
grant execute on function public.create_record_share(text[], integer, text, integer) to authenticated;
revoke all on function public.revoke_record_share(uuid) from public, anon;
grant execute on function public.revoke_record_share(uuid) to authenticated;
revoke all on function public.record_share_open(text, text) from public;
grant execute on function public.record_share_open(text, text) to anon, authenticated;
revoke all on function public.record_share_by_token(text) from public;
grant execute on function public.record_share_by_token(text) to anon, authenticated;

-- A patient reads the attempts against their own links through the existing lookup policy; staff do not.

-- ---------------------------------------------------------------------------
-- 5. Emergency card: patient-chosen fields
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_card_fields (
  patient_id          uuid primary key references public.profiles (id) on delete cascade,
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  show_date_of_birth  boolean not null default true,
  show_sex            boolean not null default true,
  show_patient_number boolean not null default true,
  show_allergies      boolean not null default true,
  show_medications    boolean not null default true,
  show_conditions     boolean not null default true,
  show_blood          boolean not null default true,
  show_emergency_contact boolean not null default true,
  -- opt-in presence on a phone's lock screen: a shared phone shows the card to whoever holds it, so it is off until the person chooses it
  lock_screen_opt_in  boolean not null default false,
  updated_at          timestamptz not null default now()
);
alter table public.emergency_card_fields enable row level security;
create policy emergency_card_fields_own_select on public.emergency_card_fields for select to authenticated using (patient_id = (select auth.uid()));
create policy emergency_card_fields_own_insert on public.emergency_card_fields for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = (select organisation_id from public.profiles where id = (select auth.uid())));
create policy emergency_card_fields_own_update on public.emergency_card_fields for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));
grant select, insert, update on public.emergency_card_fields to authenticated;
revoke delete on public.emergency_card_fields from authenticated;
revoke all on public.emergency_card_fields from anon;
create trigger emergency_card_fields_set_updated_at before update on public.emergency_card_fields for each row execute function private.set_updated_at();

-- Rename, do not rewrite: the live body (and anything added to it since this file was written) is kept exactly.
do $$
begin
  if to_regprocedure('public.emergency_card_full_by_token(text)') is null then
    alter function public.emergency_card_by_token(text) rename to emergency_card_full_by_token;
  end if;
end $$;
revoke all on function public.emergency_card_full_by_token(text) from public, anon, authenticated;

create or replace function public.emergency_card_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full jsonb;
  v_patient uuid;
  f public.emergency_card_fields%rowtype;
  v_hidden text[] := '{}';
begin
  v_full := public.emergency_card_full_by_token(p_token);   -- does the lookup, the audit row and the patient notice, exactly as before
  if v_full is null then
    return null;
  end if;
  select patient_id into v_patient from public.emergency_cards where token = p_token;
  select * into f from public.emergency_card_fields where patient_id = v_patient;
  if not found then
    return v_full;                                             -- no choice made yet: the card is unchanged
  end if;
  if not f.show_date_of_birth then v_full := v_full - 'date_of_birth'; v_hidden := array_append(v_hidden, 'date_of_birth'); end if;
  if not f.show_sex then v_full := v_full - 'sex'; v_hidden := array_append(v_hidden, 'sex'); end if;
  if not f.show_patient_number then v_full := v_full - 'patient_number'; v_hidden := array_append(v_hidden, 'patient_number'); end if;
  if not f.show_emergency_contact then v_full := v_full || jsonb_build_object('emergency_contact', null); v_hidden := array_append(v_hidden, 'emergency_contact'); end if;
  if not f.show_allergies then v_full := v_full || jsonb_build_object('allergies', '[]'::jsonb); v_hidden := array_append(v_hidden, 'allergies'); end if;
  if not f.show_medications then v_full := v_full || jsonb_build_object('medications', '[]'::jsonb); v_hidden := array_append(v_hidden, 'medications'); end if;
  if not f.show_conditions then v_full := v_full || jsonb_build_object('conditions', '[]'::jsonb); v_hidden := array_append(v_hidden, 'conditions'); end if;
  if not f.show_blood then v_full := v_full || jsonb_build_object('blood', null); v_hidden := array_append(v_hidden, 'blood'); end if;
  return v_full || jsonb_build_object('hidden_fields', to_jsonb(v_hidden));
end;
$$;
revoke all on function public.emergency_card_by_token(text) from public;
grant execute on function public.emergency_card_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.create_record_share(text[], integer, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_record_share(uuid)', 'EXECUTE') then
    raise exception 'S43 self-check: anon can create or revoke a share';
  end if;
  if not has_function_privilege('anon', 'public.record_share_open(text, text)', 'EXECUTE') then
    raise exception 'S43 self-check: record_share_open must be anon-executable';
  end if;
  if has_function_privilege('anon', 'public.emergency_card_full_by_token(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.emergency_card_full_by_token(text)', 'EXECUTE') then
    raise exception 'S43 self-check: the renamed full-card function must not be callable by clients';
  end if;
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then
    raise exception 'S43 self-check: the wrapper must stay anon-executable (the public card page)';
  end if;
  if exists (select 1 from public.record_shares where token is not null) then
    raise exception 'S43 self-check: a plaintext share token remains';
  end if;
  if (select count(*) from public.record_share_config where is_active) <> 1 then
    raise exception 'S43 self-check: exactly one active share config expected';
  end if;
end $$;
