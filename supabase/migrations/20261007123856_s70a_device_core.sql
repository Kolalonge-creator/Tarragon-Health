-- S70a (Module 18: devices, wearables and data connections, core half: 18.1, 18.2, 18.9, 18.3 and the 18.6 / 18.5 alert paths).
--
-- EXTEND, DO NOT REBUILD. The spec's `device_connections` is `wearable_connections`; `observations.source` is `vitals_readings.source` plus
-- `device_id`. Nothing here renames or replaces either. What is new:
--
--   1. device_config            versioned PROPOSED values for this module (plausibility, de-duplication, CGM events, ECG alert, task types).
--                               Mirrored in packages/shared/src/proposed-config with a test that fails on drift. Nothing is signed.
--   2. platform_modules rows    one per new capability, ALL OFF. Existing live behaviour changes only when an admin switches one on.
--   3. 18.9 plausibility        a BEFORE INSERT trigger that HOLDS an impossible value (never saved to the record, never triaged) in
--                               vitals_readings_held; an extreme-but-possible value is untouched and triaged as before.
--   4. 18.9 de-duplication      a BEFORE INSERT trigger that keeps one canonical row when two DIFFERENT sources report the same reading, and
--                               links the other in vitals_reading_links. Nothing is ever deleted; the lost payload is kept.
--   5. 18.5 CGM events          an AFTER INSERT trigger that creates a clinician TASK (never an instant page) for sustained lows and highs.
--   6. 18.6 rhythm results      device_rhythm_results + record_device_rhythm_result(): the device's own label verbatim, a routine task, and a
--                               neutral patient notice. Chest pain, fainting or breathlessness goes through the existing symptom red path.
--   7. events                   device.synced and device.alert in the S10 catalogue.
--   8. 18.2 recommended devices device_catalog gains the validation and NAFDAC / distributor evidence; only the CMO may mark a row reviewed;
--                               the list is read through recommended_devices(). Nothing is seeded. Tarragon sells nothing.
--   9. 18.1 pairing for a person  pair_device_for(): a supporter pairs a device to the person they support (shared phones).
--
-- LIVE FACTS READ 2026-10-07 BEFORE WRITING (read-only): vitals_readings has 19 triggers (the red-flag family is AFTER INSERT and each already
-- merges into an open alert of the same vital type, so a repeat reading cannot page twice); the enforce_vitals_reading_source_lock function is
-- replaced below with one change marked S70a; the live single-reading glucose emergency backstop (a reading under 3.0) fires for every source
-- including CGM and is NOT touched; the wearable FK on vitals_readings is ON DELETE SET NULL.
--
-- INVARIANTS: INV-01 (no model anywhere here), INV-05 (nothing here delays or replaces a red path), INV-07 (no notification names a condition,
-- a reading or a result), INV-10 (the new tables are read through the same tie rule as vitals_readings), INV-13 (is_test stamped), INV-14
-- (every new capability is off until switched on), INV-16 (every decision stores the config version it used).

-- ---------------------------------------------------------------------------
-- 1. device_config (reference data, no organisation_id, like device_catalog and queue_config)
-- ---------------------------------------------------------------------------
create table public.device_config (
  key            text not null check (key ~ '^[a-z][a-z0-9_.]*$'),
  version        integer not null check (version >= 1),
  is_active      boolean not null default true,
  value          jsonb not null,
  owner          text not null default 'CMO',
  status         text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  effective_from date not null,
  source         text not null,
  created_at     timestamptz not null default now(),
  primary key (key, version)
);
create unique index device_config_one_active on public.device_config (key) where is_active;
comment on table public.device_config is
  'S70a: versioned PROPOSED values for Module 18 (plausibility, cross-source de-duplication, CGM sustained events, ECG alert). Mirrored in packages/shared as devices.*; a test fails on drift. status stays proposed until the CMO signs.';

-- device-config-begin
insert into public.device_config (key, version, value, owner, status, effective_from, source) values
  ('devices.plausibility', 1, $json$
  {
    "impossible": {
      "systolic_mmhg": { "min": 40, "max": 300 },
      "diastolic_mmhg": { "min": 20, "max": 200 },
      "systolic_must_exceed_diastolic": true,
      "pulse_bpm": { "min": 20, "max": 250 },
      "spo2_pct": { "min": 50, "max": 100 },
      "temperature_c": { "min": 30, "max": 44 },
      "weight_kg_adult": { "min": 20, "max": 400 },
      "glucose_mmol_l": { "min": 1.1, "max": 55 }
    },
    "adult_age_years": 18,
    "wrist_ppg_spo2_informational": true
  }
  $json$::jsonb, 'CMO', 'proposed', '2026-10-07', 'docs/plans/S66-S70-cmo-signoff-pack.md A9, A12'),
  ('devices.dedupe', 1, $json$
  {
    "tolerance": { "systolic_mmhg": 3, "diastolic_mmhg": 3, "glucose_mmol_l": 0.3, "weight_kg": 0.2, "pulse_bpm": 3, "spo2_pct": 1 },
    "window_minutes": { "blood_pressure": 10, "glucose": 5, "weight": 10, "pulse": 10, "spo2": 10 },
    "precedence": ["ble_device", "vendor_cloud", "phone_mirror", "photo_confirmed", "manual"],
    "mirror_providers": ["apple_health", "android_health_connect"],
    "glucose_band_edges_mmol_l": [3.0, 3.9, 11.0, 13.9]
  }
  $json$::jsonb, 'CMO', 'proposed', '2026-10-07', 'docs/DECISIONS.md S70-1, OQ-309; pack A10'),
  ('devices.cgm_events', 1, $json$
  {
    "rules": [
      { "code": "low_severe", "kind": "low", "below_mmol_l": 3.0, "minutes": 15, "due_minutes": 240, "cooldown_minutes": 120 },
      { "code": "low", "kind": "low", "below_mmol_l": 3.9, "minutes": 60, "due_minutes": 1440, "cooldown_minutes": 240 },
      { "code": "high", "kind": "high", "above_mmol_l": 13.9, "minutes": 120, "due_minutes": 1440, "cooldown_minutes": 480 }
    ],
    "max_gap_minutes": 20,
    "task_type": "cgm_glucose_review",
    "severe_low_copy": "Your sensor shows a very low sugar level. If you feel shaky, sweaty, confused or faint, take a fast sugar now, such as juice or glucose tablets, and check again soon. If you cannot swallow, or someone cannot wake you, call emergency services now. Your care team has been told."
  }
  $json$::jsonb, 'CMO', 'proposed', '2026-10-07', 'docs/DECISIONS.md S70-2, OQ-310; pack A12'),
  ('devices.ecg_alert', 1, $json$
  {
    "task_type": "device_rhythm_review",
    "due_minutes": 1440,
    "patient_copy": "Your device flagged something for your care team to look at.",
    "label_map": {
      "inconclusive": ["inconclusive", "poor recording", "poor reading", "unclassified", "unrecognized", "unrecognised"],
      "irregular": ["atrial fibrillation", "afib", "irregular", "arrhythm", "bradycardia", "tachycardia", "high heart rate", "low heart rate"],
      "normal": ["sinus rhythm", "normal"]
    },
    "red_symptoms": ["chest_pain", "fainting", "breathlessness"]
  }
  $json$::jsonb, 'CMO', 'proposed', '2026-10-07', 'docs/DECISIONS.md S70-3, OQ-311; pack A11');
-- device-config-end

alter table public.device_config enable row level security;
create policy device_config_read on public.device_config for select to authenticated using (true);
revoke all on public.device_config from public, anon, authenticated, service_role;
grant select on public.device_config to authenticated, service_role;

create or replace function private.device_config(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select c.value from public.device_config c where c.key = p_key and c.is_active
$$;
create or replace function private.device_config_version(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select c.version from public.device_config c where c.key = p_key and c.is_active
$$;
revoke all on function private.device_config(text) from public, anon;
revoke all on function private.device_config_version(text) from public, anon;
grant execute on function private.device_config(text) to authenticated;
grant execute on function private.device_config_version(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Go-live: one dormant module per new capability, all off (INV-14). platform_modules is used (not go_live_guards) because adding a
--    go_live_guards row needs a new branch inside private.go_live_conditions(), one function every parallel session edits (OQ-371).
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values
  ('device_plausibility_hold', 'Held readings (impossible values)', 'Impossible device readings are held as "please confirm" and never triaged or saved. Off: today''s behaviour.'),
  ('device_cross_source_dedupe', 'Cross-source de-duplication', 'Keeps one canonical reading when two different sources report the same one. Off: every source is stored as it is today.'),
  ('device_cgm_sustained_events', 'Glucose sensor sustained events', 'Creates a clinician task for a sustained low or high from a glucose sensor stream. Off: no task is created.'),
  ('device_ecg_rhythm_alerts', 'Personal ECG device results', 'Accepts a device''s own rhythm result and creates a routine clinician task. Off: results are refused.'),
  ('device_photo_capture', 'Photo reading capture', 'Lets a person photograph a device screen and confirm every number. Off: the option is not offered.'),
  ('device_recommended_list', 'Recommended devices list', 'Shows the clinically reviewed, NAFDAC or distributor evidenced devices. Off: the list is empty and says "type it in".'),
  ('device_wrist_spo2_informational', 'Wrist SpO2 informational only', 'Oxygen readings from watches and wearables are shown but never raise an alert alone. Off: they triage as they do today.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. 18.9 plausibility: hold impossible values
-- ---------------------------------------------------------------------------
create or replace function private.dev_out_of_range(p_value numeric, p_lim jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p_value is not null and p_lim is not null
     and (p_value < (p_lim ->> 'min')::numeric or p_value > (p_lim ->> 'max')::numeric)
$$;

create or replace function private.vitals_impossible_reasons(r public.vitals_readings) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg jsonb := private.device_config('devices.plausibility');
  lim jsonb;
  v_reasons text[] := '{}';
  v_age integer;
begin
  if v_cfg is null then return v_reasons; end if;
  lim := v_cfg -> 'impossible';
  case r.vital_type::text
    when 'blood_pressure' then
      if private.dev_out_of_range(r.systolic, lim -> 'systolic_mmhg') then v_reasons := array_append(v_reasons, 'systolic_range'); end if;
      if private.dev_out_of_range(r.diastolic, lim -> 'diastolic_mmhg') then v_reasons := array_append(v_reasons, 'diastolic_range'); end if;
      if coalesce((lim ->> 'systolic_must_exceed_diastolic')::boolean, false)
         and r.systolic is not null and r.diastolic is not null and r.systolic <= r.diastolic then
        v_reasons := array_append(v_reasons, 'systolic_not_above_diastolic');
      end if;
      if private.dev_out_of_range(r.pulse_bpm, lim -> 'pulse_bpm') then v_reasons := array_append(v_reasons, 'pulse_range'); end if;
    when 'pulse' then
      if private.dev_out_of_range(r.pulse_bpm, lim -> 'pulse_bpm') then v_reasons := array_append(v_reasons, 'pulse_range'); end if;
    when 'spo2' then
      if private.dev_out_of_range(r.spo2_pct, lim -> 'spo2_pct') then v_reasons := array_append(v_reasons, 'spo2_range'); end if;
      if private.dev_out_of_range(r.pulse_bpm, lim -> 'pulse_bpm') then v_reasons := array_append(v_reasons, 'pulse_range'); end if;
    when 'temperature' then
      if private.dev_out_of_range(r.temperature_c, lim -> 'temperature_c') then v_reasons := array_append(v_reasons, 'temperature_range'); end if;
    when 'glucose' then
      if private.dev_out_of_range(r.glucose_mmol_l, lim -> 'glucose_mmol_l') then v_reasons := array_append(v_reasons, 'glucose_range'); end if;
    when 'weight' then
      -- only a known adult: a small child's weight is real, and an unknown age fails open (saved, never held)
      select extract(year from age(current_date, p.date_of_birth))::integer into v_age from public.profiles p where p.id = r.patient_id;
      if v_age is not null and v_age >= (v_cfg ->> 'adult_age_years')::integer
         and private.dev_out_of_range(r.weight_kg, lim -> 'weight_kg_adult') then
        v_reasons := array_append(v_reasons, 'weight_range');
      end if;
    else null;
  end case;
  return v_reasons;
end $$;

create table public.vitals_readings_held (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  vital_type           text not null,
  source               text not null,
  payload              jsonb not null,
  payload_hash         text not null,
  reasons              text[] not null,
  config_version       integer not null,
  state                text not null default 'pending' check (state in ('pending', 'corrected', 'discarded', 'confirmed_as_shown')),
  resolved_at          timestamptz,
  resolved_by          uuid references public.profiles (id) on delete set null,
  corrected_reading_id uuid references public.vitals_readings (id) on delete set null,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  check ((state = 'pending') = (resolved_at is null))
);
create unique index vitals_readings_held_pending_once on public.vitals_readings_held (patient_id, payload_hash) where state = 'pending';
create index vitals_readings_held_patient_idx on public.vitals_readings_held (patient_id, created_at desc);
create index vitals_readings_held_org_idx on public.vitals_readings_held (organisation_id);
comment on table public.vitals_readings_held is
  'S70a 18.9: a device or typed value that cannot be real (see device_config devices.plausibility), held as "please confirm". Never part of the record and never triaged. Rows are kept after resolution (no erase); the person resolves them with resolve_held_reading().';

alter table public.vitals_readings_held enable row level security;
create policy vitals_readings_held_select on public.vitals_readings_held for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category));
revoke all on public.vitals_readings_held from public, anon, authenticated, service_role;
grant select on public.vitals_readings_held to authenticated, service_role;

create or replace function private.hold_impossible_vitals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_reasons text[];
  v_payload jsonb;
begin
  if not private.module_enabled('device_plausibility_hold') then return new; end if;
  v_reasons := private.vitals_impossible_reasons(new);
  if coalesce(array_length(v_reasons, 1), 0) = 0 then return new; end if;
  v_payload := jsonb_strip_nulls(to_jsonb(new) - 'id' - 'created_at' - 'received_at');
  insert into public.vitals_readings_held (organisation_id, patient_id, vital_type, source, payload, payload_hash, reasons, config_version, is_test)
  values (new.organisation_id, new.patient_id, new.vital_type::text, new.source::text, v_payload, md5(v_payload::text), v_reasons,
          coalesce(private.device_config_version('devices.plausibility'), 1),
          coalesce((select p.is_test from public.profiles p where p.id = new.patient_id), false))
  on conflict (patient_id, payload_hash) where state = 'pending' do nothing;
  -- Nothing is lost: the full payload is in the held row. The reading never reaches the record, so no red-flag trigger runs on it.
  return null;
end $$;
revoke all on function private.hold_impossible_vitals() from public, anon;

create trigger vitals_readings_a_hold_impossible
  before insert on public.vitals_readings
  for each row execute function private.hold_impossible_vitals();

create or replace function public.resolve_held_reading(p_id uuid, p_state text, p_reading_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h public.vitals_readings_held;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_state not in ('corrected', 'discarded', 'confirmed_as_shown') then
    raise exception 'state must be corrected, discarded or confirmed_as_shown' using errcode = '22023';
  end if;
  select * into h from public.vitals_readings_held where id = p_id for update;
  if h.id is null or not (h.patient_id = v_uid or private.can_act_for(h.patient_id)) then
    raise exception 'not found' using errcode = '42501';  -- the same answer for "no such row" and "not yours"
  end if;
  if h.state <> 'pending' then return jsonb_build_object('ok', true, 'changed', false, 'state', h.state); end if;
  if p_state = 'corrected' then
    if p_reading_id is null or not exists (
         select 1 from public.vitals_readings r where r.id = p_reading_id and r.patient_id = h.patient_id and r.vital_type::text = h.vital_type) then
      raise exception 'a corrected reading must be one of this person''s own readings of the same kind' using errcode = '22023';
    end if;
  end if;
  update public.vitals_readings_held
     set state = p_state, resolved_at = now(), resolved_by = v_uid, corrected_reading_id = case when p_state = 'corrected' then p_reading_id end
   where id = p_id;
  perform private.log_audit('device.held_reading_resolved', 'vitals_readings_held', p_id, jsonb_build_object('state', p_state));
  return jsonb_build_object('ok', true, 'changed', true, 'state', p_state);
end $$;
revoke all on function public.resolve_held_reading(uuid, text, uuid) from public, anon;
grant execute on function public.resolve_held_reading(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 18.9 cross-source de-duplication
-- ---------------------------------------------------------------------------
create table public.vitals_reading_links (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  canonical_reading_id  uuid references public.vitals_readings (id) on delete set null,
  vital_type            text not null,
  link_kind             text not null check (link_kind in ('incoming_not_stored', 'previous_replaced')),
  superseded_source     text not null,
  superseded_class      text not null,
  canonical_class       text not null,
  superseded_payload    jsonb not null,
  payload_hash          text not null,
  config_version        integer not null,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (patient_id, payload_hash)
);
create index vitals_reading_links_canonical_idx on public.vitals_reading_links (canonical_reading_id);
create index vitals_reading_links_org_idx on public.vitals_reading_links (organisation_id);
comment on table public.vitals_reading_links is
  'S70a 18.9: the other half of a duplicate. When two different sources report the same reading, vitals_readings keeps ONE canonical row and this table keeps the other payload, linked, so nothing is lost and nothing is counted twice. Written only by private.dedupe_cross_source_vitals().';

alter table public.vitals_reading_links enable row level security;
create policy vitals_reading_links_select on public.vitals_reading_links for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category));
revoke all on public.vitals_reading_links from public, anon, authenticated, service_role;
grant select on public.vitals_reading_links to authenticated, service_role;

create or replace function private.vital_source_class(p_source text, p_wearable_connection uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mirrors jsonb := coalesce(private.device_config('devices.dedupe') -> 'mirror_providers', '[]'::jsonb);
  v_provider text;
begin
  case p_source
    when 'device' then return 'ble_device';
    when 'cgm' then return 'vendor_cloud';
    when 'photo_confirmed' then return 'photo_confirmed';
    when 'manual' then return 'manual';
    when 'wearable' then
      -- the phone health bridges write a wearable row with no connection at all: that is a mirror, not a vendor cloud
      if p_wearable_connection is null then return 'phone_mirror'; end if;
      select wc.provider::text into v_provider from public.wearable_connections wc where wc.id = p_wearable_connection;
      if v_provider is null or v_mirrors ? v_provider then return 'phone_mirror'; end if;
      return 'vendor_cloud';
    else return null;   -- fhir_import and anything new: never de-duplicated
  end case;
end $$;

create or replace function private.dedupe_rank(p_class text, p_cfg jsonb) returns integer
language sql immutable set search_path = '' as $$
  select coalesce((select (o.ord - 1)::integer from jsonb_array_elements_text(p_cfg -> 'precedence') with ordinality o(v, ord) where o.v = p_class),
                  jsonb_array_length(p_cfg -> 'precedence'))
$$;

-- A triage band for a stored reading, from the LIVE classifiers (so a merge can never hide the worse of two readings).
create or replace function private.vitals_triage_band(r public.vitals_readings) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_edges jsonb := coalesce(private.device_config('devices.dedupe') -> 'glucose_band_edges_mmol_l', '[]'::jsonb);
  v_t_sys smallint;
  v_t_dia smallint;
  v_over boolean := false;
begin
  case r.vital_type::text
    when 'blood_pressure' then
      select systolic, diastolic into v_t_sys, v_t_dia from private.patient_home_bp_target(r.patient_id);
      v_over := r.systolic >= coalesce(v_t_sys, 32767) or r.diastolic >= coalesce(v_t_dia, 32767);
      return private.classify_bp_level(r.systolic, r.diastolic) || ':' || v_over::text;
    when 'pulse' then return private.classify_pulse_level(r.pulse_bpm);
    when 'spo2' then return private.classify_spo2_level(r.spo2_pct);
    when 'glucose' then
      return (select count(*)::text from jsonb_array_elements_text(v_edges) e where r.glucose_mmol_l >= e::numeric);
    else return 'n';
  end case;
end $$;

create or replace function private.vitals_within_tolerance(a public.vitals_readings, b public.vitals_readings, p_cfg jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case a.vital_type::text
    when 'blood_pressure' then a.systolic is not null and b.systolic is not null and a.diastolic is not null and b.diastolic is not null
        and abs(a.systolic - b.systolic) <= (p_cfg -> 'tolerance' ->> 'systolic_mmhg')::numeric
        and abs(a.diastolic - b.diastolic) <= (p_cfg -> 'tolerance' ->> 'diastolic_mmhg')::numeric
    when 'glucose' then a.glucose_mmol_l is not null and b.glucose_mmol_l is not null
        and abs(a.glucose_mmol_l - b.glucose_mmol_l) <= (p_cfg -> 'tolerance' ->> 'glucose_mmol_l')::numeric
    when 'weight' then a.weight_kg is not null and b.weight_kg is not null
        and abs(a.weight_kg - b.weight_kg) <= (p_cfg -> 'tolerance' ->> 'weight_kg')::numeric
    when 'pulse' then a.pulse_bpm is not null and b.pulse_bpm is not null
        and abs(a.pulse_bpm - b.pulse_bpm) <= (p_cfg -> 'tolerance' ->> 'pulse_bpm')::numeric
    when 'spo2' then a.spo2_pct is not null and b.spo2_pct is not null
        and abs(a.spo2_pct - b.spo2_pct) <= (p_cfg -> 'tolerance' ->> 'spo2_pct')::numeric
    else false end
$$;

create or replace function private.dedupe_cross_source_vitals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb;
  v_vt text := new.vital_type::text;
  v_win numeric;
  v_cls text;
  v_key text;
  v_ex public.vitals_readings;
  v_ex_cls text;
  v_ex_key text;
  v_hit public.vitals_readings;
  v_hit_cls text;
  v_found boolean := false;
  v_new_band text;
  v_payload jsonb;
  v_ver integer;
begin
  if not private.module_enabled('device_cross_source_dedupe') then return new; end if;
  if v_vt not in ('blood_pressure', 'glucose', 'weight', 'pulse', 'spo2') then return new; end if;
  v_cfg := private.device_config('devices.dedupe');
  if v_cfg is null then return new; end if;
  v_win := (v_cfg -> 'window_minutes' ->> v_vt)::numeric;
  if v_win is null or new.taken_at is null then return new; end if;
  v_cls := private.vital_source_class(new.source::text, new.wearable_connection_id);
  if v_cls is null then return new; end if;
  v_key := coalesce(new.device_id::text, new.wearable_connection_id::text, new.cgm_connection_id::text, v_cls);
  -- BP in pregnancy is triaged on its own, tighter lines: never merge it
  if v_vt = 'blood_pressure' and exists (select 1 from public.profiles p where p.id = new.patient_id and coalesce(p.is_pregnant, false)) then
    return new;
  end if;
  v_new_band := private.vitals_triage_band(new);

  for v_ex in
    select vr.* from public.vitals_readings vr
     where vr.patient_id = new.patient_id and vr.vital_type = new.vital_type
       and vr.taken_at between new.taken_at - make_interval(secs => (v_win * 60)::double precision)
                           and new.taken_at + make_interval(secs => (v_win * 60)::double precision)
     order by abs(extract(epoch from (vr.taken_at - new.taken_at))) asc
     limit 20
  loop
    v_ex_cls := private.vital_source_class(v_ex.source::text, v_ex.wearable_connection_id);
    continue when v_ex_cls is null;
    v_ex_key := coalesce(v_ex.device_id::text, v_ex.wearable_connection_id::text, v_ex.cgm_connection_id::text, v_ex_cls);
    continue when v_ex_cls = v_cls and v_ex_key = v_key;                       -- same source: never merged
    continue when not private.vitals_within_tolerance(new, v_ex, v_cfg);
    continue when private.vitals_triage_band(v_ex) is distinct from v_new_band;  -- never hide the worse of two readings
    v_hit := v_ex; v_hit_cls := v_ex_cls; v_found := true;
    exit;
  end loop;
  if not v_found then return new; end if;

  v_ver := coalesce(private.device_config_version('devices.dedupe'), 1);

  if private.dedupe_rank(v_cls, v_cfg) < private.dedupe_rank(v_hit_cls, v_cfg) then
    -- The incoming reading is the better source: it becomes the canonical row IN PLACE (no second row, so no second triage and no
    -- double count), and the row it replaces is kept in the link table. If anything stops the replacement, both rows are kept as they
    -- were (a double count is recoverable; a lost reading is not).
    begin
      v_payload := jsonb_strip_nulls(to_jsonb(v_hit) - 'id' - 'created_at' - 'received_at');
      perform set_config('tarragon.vitals_dedupe', 'on', true);
      update public.vitals_readings r set
        source = new.source, device_id = new.device_id, external_reading_id = new.external_reading_id,
        wearable_connection_id = new.wearable_connection_id, cgm_connection_id = new.cgm_connection_id, taken_at = new.taken_at,
        systolic = coalesce(new.systolic, r.systolic), diastolic = coalesce(new.diastolic, r.diastolic),
        pulse_bpm = coalesce(new.pulse_bpm, r.pulse_bpm), glucose_mmol_l = coalesce(new.glucose_mmol_l, r.glucose_mmol_l),
        glucose_context = coalesce(new.glucose_context, r.glucose_context), weight_kg = coalesce(new.weight_kg, r.weight_kg),
        spo2_pct = coalesce(new.spo2_pct, r.spo2_pct), position = coalesce(new.position, r.position), arm = coalesce(new.arm, r.arm),
        cuff_type = coalesce(new.cuff_type, r.cuff_type)
       where r.id = v_hit.id;
      perform set_config('tarragon.vitals_dedupe', 'off', true);
      insert into public.vitals_reading_links
        (organisation_id, patient_id, canonical_reading_id, vital_type, link_kind, superseded_source, superseded_class, canonical_class,
         superseded_payload, payload_hash, config_version, is_test)
      values (new.organisation_id, new.patient_id, v_hit.id, v_vt, 'previous_replaced', v_hit.source::text, v_hit_cls, v_cls,
              v_payload, md5(v_payload::text), v_ver, coalesce((select p.is_test from public.profiles p where p.id = new.patient_id), false))
      on conflict (patient_id, payload_hash) do nothing;
      return null;
    exception when others then
      perform set_config('tarragon.vitals_dedupe', 'off', true);
      raise warning 'S70a dedupe: could not replace reading % in place (%), keeping both', v_hit.id, sqlerrm;
      return new;
    end;
  end if;

  -- The existing row is as good or better: the incoming reading is linked, not stored.
  v_payload := jsonb_strip_nulls(to_jsonb(new) - 'id' - 'created_at' - 'received_at');
  insert into public.vitals_reading_links
    (organisation_id, patient_id, canonical_reading_id, vital_type, link_kind, superseded_source, superseded_class, canonical_class,
     superseded_payload, payload_hash, config_version, is_test)
  values (new.organisation_id, new.patient_id, v_hit.id, v_vt, 'incoming_not_stored', new.source::text, v_cls, v_hit_cls,
          v_payload, md5(v_payload::text), v_ver, coalesce((select p.is_test from public.profiles p where p.id = new.patient_id), false))
  on conflict (patient_id, payload_hash) do nothing;
  return null;
end $$;
revoke all on function private.dedupe_cross_source_vitals() from public, anon;

-- 'z' sorts after vitals_readings_stamp_manual_timestamp, so a typed reading has its server-stamped time before it is compared.
create trigger vitals_readings_z_cross_source_dedupe
  before insert on public.vitals_readings
  for each row execute function private.dedupe_cross_source_vitals();

-- The live body (read 2026-10-07) plus ONE change marked S70a: the de-duplication trigger may replace a reading in place with the same
-- reading from a better source. The bypass is a transaction-local setting that only the SECURITY DEFINER trigger above sets.
create or replace function private.enforce_vitals_reading_source_lock()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- S70a: the cross-source de-duplication trigger is replacing a reading with the same reading from a better source.
  if current_setting('tarragon.vitals_dedupe', true) = 'on' then
    return new;
  end if;

  if old.triage_event_id is distinct from new.triage_event_id then
    if (select auth.uid()) is null then
      if (to_jsonb(new) - 'triage_event_id') is distinct from (to_jsonb(old) - 'triage_event_id') then
        raise exception 'A backend update may only link the triage result' using errcode = '42501';
      end if;
      return new;
    end if;
    if not private.is_org_staff(old.organisation_id) then
      raise exception 'The triage result link cannot be changed from a patient session' using errcode = '42501';
    end if;
  end if;

  -- Org staff (any role): unrestricted, unchanged from prior behavior.
  if private.is_org_staff(old.organisation_id) then
    return new;
  end if;

  -- Patient session editing their own row: only a 'manual' reading may be
  -- touched. Anything else (device/wearable/cgm, or any future source
  -- value - deny-by-default, not an enumerated allowlist) is locked.
  if old.source is distinct from 'manual' then
    raise exception
      'This reading was recorded automatically (%) and cannot be edited directly. Contact your care team if it needs a correction.',
      old.source
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Task types (S16 pattern) and neutral notices. PROPOSED, flagged for the CMO, nothing signed.
-- ---------------------------------------------------------------------------
-- device-task-types-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('cgm_glucose_review', 1, 4, 1440, 'medical_officer', '{adult_general}', 240, 30, true, true, '{}',
   'S70a: a glucose sensor stream stayed low or high long enough to need a person to look (devices.cgm_events). Never an instant red page. PROPOSED class, due time and tier: the CMO signs them.'),
  ('device_rhythm_review', 1, 5, 1440, 'medical_officer', '{adult_general}', 1440, 30, true, true, '{}',
   'S70a: a personal ECG device gave an irregular, inconclusive or unrecognised result (devices.ecg_alert). Routine, due within one working day. Never a patient-facing diagnosis. PROPOSED: the CMO signs it.');
-- device-task-types-end

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('device_flag_notice', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S70a: a personal device flagged something for the care team. Names no condition, reading or result (INV-07).'),
  ('device_safety_notice', 'operational', 'important', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S70a: a safety message is waiting in the app after a sustained glucose sensor event. The full message is shown on the phone; this notice names nothing (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('device_flag_notice', 'en', 'in_app', 'A message from your care team', 'Your device flagged something for your care team to look at.'),
  ('device_safety_notice', 'en', 'in_app', 'A message is waiting for you', 'You have a safety message in Tarragon. Please open the app now.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Events (S10 catalogue)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('device.synced', 'A device or health-data source delivered readings for a person', 'S70a', false),
  ('device.alert', 'A device result needs the care team: a task was created (never a page, never a diagnosis)', 'S70a', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('device.synced', 1, array['source', 'readings']),
  ('device.alert', 1, array['alert_kind', 'task_id'])
on conflict (event_type, version) do nothing;

create or replace function public.report_device_synced(p_source text, p_readings integer, p_ref uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_readings is null or p_readings < 0 or p_readings > 100000 or coalesce(length(p_source), 0) not between 1 and 40 then
    raise exception 'invalid sync report' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  -- one event per person, source and ten-minute bucket: a chatty sync cannot flood the bus
  return private.emit_domain_event('device.synced', v_org,
    jsonb_build_object('source', p_source, 'readings', p_readings, 'ref', p_ref),
    'device.synced:' || v_uid || ':' || p_source || ':' || floor(extract(epoch from now()) / 600)::bigint,
    v_uid, 'device_sync', p_ref);
end $$;
revoke all on function public.report_device_synced(text, integer, uuid) from public, anon;
grant execute on function public.report_device_synced(text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 18.5 CGM sustained events
-- ---------------------------------------------------------------------------
create or replace function private.cgm_run_minutes(p_patient uuid, p_at timestamptz, p_kind text, p_threshold numeric, p_max_gap_minutes numeric, p_lookback_minutes numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  with recent as (
    select vr.taken_at, vr.glucose_mmol_l v from public.vitals_readings vr
     where vr.patient_id = p_patient and vr.vital_type = 'glucose' and vr.source::text = 'cgm' and vr.glucose_mmol_l is not null
       and vr.taken_at <= p_at and vr.taken_at >= p_at - make_interval(secs => (p_lookback_minutes * 60)::double precision)
  ), flagged as (
    select taken_at, case when p_kind = 'low' then v < p_threshold else v > p_threshold end m from recent
  ), brk as (
    select max(taken_at) b from flagged where not m
  ), run as (
    select taken_at from flagged where m and taken_at > coalesce((select b from brk), '-infinity'::timestamptz)
  ), gaps as (
    select taken_at, taken_at - lag(taken_at) over (order by taken_at) g from run
  ), big as (
    select max(taken_at) bg from gaps where g > make_interval(secs => (p_max_gap_minutes * 60)::double precision)
  )
  select coalesce(extract(epoch from (p_at - (select min(taken_at) from run where taken_at >= coalesce((select bg from big), '-infinity'::timestamptz)))) / 60.0, 0)
$$;
revoke all on function private.cgm_run_minutes(uuid, timestamptz, text, numeric, numeric, numeric) from public, anon;

create or replace function private.cgm_sustained_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb;
  v_rule jsonb;
  v_kind text;
  v_done text[] := '{}';
  v_thr numeric;
  v_len numeric;
  v_key text;
  v_task uuid;
  v_is_new boolean;
  v_pat public.profiles;
  v_ver integer;
begin
  if new.source::text <> 'cgm' or new.vital_type::text <> 'glucose' or new.glucose_mmol_l is null then return new; end if;
  if not private.module_enabled('device_cgm_sustained_events') then return new; end if;
  v_cfg := private.device_config('devices.cgm_events');
  if v_cfg is null then return new; end if;
  v_ver := coalesce(private.device_config_version('devices.cgm_events'), 1);
  select * into v_pat from public.profiles where id = new.patient_id;

  for v_rule in select r from jsonb_array_elements(v_cfg -> 'rules') r loop
    v_kind := v_rule ->> 'kind';
    continue when v_kind = any (v_done);
    v_thr := coalesce((v_rule ->> 'below_mmol_l')::numeric, (v_rule ->> 'above_mmol_l')::numeric);
    continue when not (case when v_kind = 'low' then new.glucose_mmol_l < v_thr else new.glucose_mmol_l > v_thr end);
    v_len := private.cgm_run_minutes(new.patient_id, new.taken_at, v_kind, v_thr,
               (v_cfg ->> 'max_gap_minutes')::numeric, (v_rule ->> 'minutes')::numeric + (v_cfg ->> 'max_gap_minutes')::numeric);
    continue when v_len < (v_rule ->> 'minutes')::numeric;
    v_done := v_done || v_kind;   -- the first (most serious) matching rule of a kind wins
    v_key := 'cgm:' || v_kind || ':' || new.patient_id;

    -- Rate limit: one task per kind per cooldown, whatever happened to the last one. A stream cannot flood the queue.
    continue when exists (
      select 1 from public.clinical_tasks t
       where t.patient_id = new.patient_id and t.dedup_key like v_key || '%'
         and t.created_at > now() - make_interval(mins => (v_rule ->> 'cooldown_minutes')::integer));

    begin
      v_task := private.create_clinical_task(new.patient_id, v_cfg ->> 'task_type', (v_rule ->> 'due_minutes')::integer, v_key);
      perform private.emit_domain_event('device.alert', new.organisation_id,
        jsonb_build_object('alert_kind', 'cgm_' || (v_rule ->> 'code'), 'task_id', v_task, 'config_version', v_ver),
        'device.alert:cgm:' || v_task || ':' || (v_rule ->> 'code'), new.patient_id, 'clinical_task', v_task);
      if (v_rule ->> 'code') = 'low_severe' then
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
        values (new.organisation_id, new.patient_id, 'in_app', 'pending', 'device_safety_notice', jsonb_build_object('task_id', v_task));
      end if;
    exception when others then
      -- Never block the reading, never swallow the failure: it is written to the audit log where an operator will see it.
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'device.cgm_task_failed', 'vitals_readings', new.id,
              jsonb_build_object('rule', v_rule ->> 'code', 'sqlstate', sqlstate, 'message', left(sqlerrm, 200)));
    end;
  end loop;
  return new;
end $$;
revoke all on function private.cgm_sustained_after_insert() from public, anon;

create trigger vitals_readings_cgm_sustained
  after insert on public.vitals_readings
  for each row when (new.source::text = 'cgm')
  execute function private.cgm_sustained_after_insert();

-- ---------------------------------------------------------------------------
-- 8. 18.6 personal ECG device results
-- ---------------------------------------------------------------------------
create table public.device_rhythm_results (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  source            text not null check (source in ('healthkit_ecg', 'ecg_report', 'device_label')),
  -- The device's OWN label, verbatim. Never edited, never translated, never shown to the patient as a diagnosis.
  device_label      text not null check (length(btrim(device_label)) between 1 and 200),
  device_name       text check (device_name is null or length(device_name) <= 120),
  category          text not null check (category in ('normal', 'irregular', 'inconclusive', 'other')),
  recorded_at       timestamptz not null,
  external_id       text not null check (length(external_id) between 1 and 200),
  symptoms_reported text[] not null default '{}',
  task_id           uuid references public.clinical_tasks (id) on delete set null,
  recorded_by       uuid references public.profiles (id) on delete set null,
  config_version    integer not null,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (patient_id, source, external_id)
);
create index device_rhythm_results_patient_idx on public.device_rhythm_results (patient_id, recorded_at desc);
create index device_rhythm_results_org_idx on public.device_rhythm_results (organisation_id);
comment on table public.device_rhythm_results is
  'S70a 18.6: a personal ECG device''s own rhythm result, stored verbatim. The platform never interprets a tracing and never shows a diagnosis; a result that is not clearly normal creates a routine clinician task (device_rhythm_review) via record_device_rhythm_result().';

alter table public.device_rhythm_results enable row level security;
create policy device_rhythm_results_select on public.device_rhythm_results for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category));
revoke all on public.device_rhythm_results from public, anon, authenticated, service_role;
grant select on public.device_rhythm_results to authenticated, service_role;

create or replace function private.rhythm_category(p_label text, p_cfg jsonb) returns text
language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from jsonb_array_elements_text(p_cfg -> 'label_map' -> 'inconclusive') w where lower(p_label) ~ ('\y' || w)) then 'inconclusive'
    when exists (select 1 from jsonb_array_elements_text(p_cfg -> 'label_map' -> 'irregular') w where lower(p_label) ~ ('\y' || w)) then 'irregular'
    -- "normal" only counts when nothing negates it: "not normal", "abnormal" and "unable to" fall through to review
    when lower(p_label) !~ '\y(not|non|no|abnormal|unable)\y'
         and exists (select 1 from jsonb_array_elements_text(p_cfg -> 'label_map' -> 'normal') w where lower(p_label) ~ ('\y' || w || '\y')) then 'normal'
    else 'other' end
$$;

create or replace function public.record_device_rhythm_result(
  p_source text, p_device_label text, p_recorded_at timestamptz, p_external_id text,
  p_device_name text default null, p_symptoms text[] default '{}', p_patient_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient_id, (select auth.uid()));
  v_cfg jsonb;
  v_org uuid;
  v_test boolean;
  v_cat text;
  v_id uuid;
  v_task uuid;
  v_sym text;
  v_red boolean := false;
  v_ver integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_patient <> v_uid and not private.can_act_for(v_patient) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.module_enabled('device_ecg_rhythm_alerts') then
    raise exception 'Personal ECG device results are built but not yet switched on' using errcode = '23514';
  end if;
  v_cfg := private.device_config('devices.ecg_alert');
  v_ver := coalesce(private.device_config_version('devices.ecg_alert'), 1);
  select organisation_id, is_test into v_org, v_test from public.profiles where id = v_patient and role = 'patient';
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  if p_recorded_at is null or p_recorded_at > now() + interval '5 minutes' or p_recorded_at < now() - interval '30 days' then
    raise exception 'the recording time is outside the last 30 days' using errcode = '22023';
  end if;

  v_cat := private.rhythm_category(p_device_label, v_cfg);
  insert into public.device_rhythm_results
    (organisation_id, patient_id, source, device_label, device_name, category, recorded_at, external_id, symptoms_reported, recorded_by, config_version, is_test)
  values (v_org, v_patient, p_source, btrim(p_device_label), p_device_name, v_cat, p_recorded_at, p_external_id,
          coalesce((select array_agg(distinct s) from unnest(p_symptoms) s where s in ('chest_pain', 'fainting', 'breathlessness')), '{}'),
          v_uid, v_ver, coalesce(v_test, false))
  on conflict (patient_id, source, external_id) do nothing
  returning id into v_id;
  if v_id is null then
    -- a retry of a result already recorded: idempotent, nothing is created twice
    select id, task_id into v_id, v_task from public.device_rhythm_results where patient_id = v_patient and source = p_source and external_id = p_external_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_id, 'category', v_cat, 'task_id', v_task, 'red_path', false);
  end if;

  -- Chest pain, fainting or breathlessness NOW goes through the existing symptom red path (its own trigger pages), not this one.
  foreach v_sym in array coalesce((select symptoms_reported from public.device_rhythm_results where id = v_id), '{}') loop
    insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, is_red_flag, description, logged_by_profile_id)
    values (v_org, v_patient,
            (case v_sym when 'fainting' then 'dizziness' else v_sym end)::public.symptom_type, 10, true,
            'Answered yes to this with a flagged device result: ' || v_sym, v_uid);
    v_red := true;
  end loop;

  if v_cat <> 'normal' then
    v_task := private.create_clinical_task(v_patient, v_cfg ->> 'task_type', (v_cfg ->> 'due_minutes')::integer, 'ecg:' || v_id);
    update public.device_rhythm_results set task_id = v_task where id = v_id;
    perform private.emit_domain_event('device.alert', v_org,
      jsonb_build_object('alert_kind', 'rhythm_' || v_cat, 'task_id', v_task, 'config_version', v_ver),
      'device.alert:rhythm:' || v_id, v_patient, 'clinical_task', v_task);
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (v_org, v_patient, 'in_app', 'pending', 'device_flag_notice', jsonb_build_object('result_id', v_id));
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'device.rhythm_result_recorded', 'device_rhythm_results', v_id,
          jsonb_build_object('category', v_cat, 'source', p_source, 'task_id', v_task, 'red_path', v_red));
  return jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'category', v_cat, 'task_id', v_task, 'red_path', v_red,
                            'patient_copy', case when v_cat <> 'normal' then v_cfg ->> 'patient_copy' end);
end $$;
revoke all on function public.record_device_rhythm_result(text, text, timestamptz, text, text, text[], uuid) from public, anon;
grant execute on function public.record_device_rhythm_result(text, text, timestamptz, text, text, text[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. 18.2 recommended devices: evidence columns, CMO-only review, one read function
-- ---------------------------------------------------------------------------
alter table public.device_catalog
  add column validated_source_url text,
  add column validation_basis text check (validation_basis is null or validation_basis in ('validatebp', 'published_validation_study')),
  add column nafdac_number text,
  add column authorised_distributor text,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column review_note text;

-- A row may be marked reviewed only with its evidence, and Tarragon never lists a device it would sell (the band stays unbuilt, D-22).
alter table public.device_catalog
  add constraint device_catalog_reviewed_needs_evidence
    check (not clinically_reviewed or (
      validated_source_url is not null and length(btrim(validated_source_url)) >= 12 and validation_basis is not null
      and (nullif(btrim(coalesce(nafdac_number, '')), '') is not null or nullif(btrim(coalesce(authorised_distributor, '')), '') is not null)
      and reviewed_by is not null and reviewed_at is not null)),
  add constraint device_catalog_never_active_when_owned
    check (not (active and fulfillment_type = 'tarragon_owned'));

create or replace function private.device_catalog_review_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.clinically_reviewed and (tg_op = 'INSERT' or old.clinically_reviewed is distinct from true) then
    if current_setting('tarragon.device_catalog_review', true) is distinct from 'on' then
      raise exception 'only the Chief Medical Officer can mark a device as clinically reviewed (review_device_catalog_entry)' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.device_catalog_review_guard() from public, anon;
create trigger device_catalog_review_guard before insert or update on public.device_catalog
  for each row execute function private.device_catalog_review_guard();

create or replace function public.review_device_catalog_entry(p_id uuid, p_reviewed boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can review a recommended device' using errcode = '42501';
  end if;
  if p_reviewed and length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked, in a sentence' using errcode = '22023';
  end if;
  perform set_config('tarragon.device_catalog_review', 'on', true);
  update public.device_catalog
     set clinically_reviewed = p_reviewed,
         reviewed_by = case when p_reviewed then v_uid end, reviewed_at = case when p_reviewed then now() end,
         review_note = case when p_reviewed then btrim(p_note) else nullif(btrim(coalesce(p_note, '')), '') end
   where id = p_id;
  perform set_config('tarragon.device_catalog_review', 'off', true);
  if not found then raise exception 'no such device' using errcode = '22023'; end if;
  perform private.log_audit('device_catalog.reviewed', 'device_catalog', p_id, jsonb_build_object('reviewed', p_reviewed));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.review_device_catalog_entry(uuid, boolean, text) from public, anon;
grant execute on function public.review_device_catalog_entry(uuid, boolean, text) to authenticated;

create or replace function public.recommended_devices() returns table (
  id uuid, device_name text, category public.device_catalog_category, vendor_name text, description text, pairing_path public.device_catalog_pairing_path,
  validated_source_url text, validation_basis text, nafdac_number text, authorised_distributor text, display_order integer)
language sql stable security definer set search_path = '' as $$
  select d.id, d.device_name, d.category, d.vendor_name, d.description, d.pairing_path, d.validated_source_url, d.validation_basis,
         d.nafdac_number, d.authorised_distributor, d.display_order
    from public.device_catalog d
   where (select auth.uid()) is not null and private.module_enabled('device_recommended_list')
     and d.active and d.clinically_reviewed and d.fulfillment_type = 'recommend_only'
   order by d.category, d.display_order
$$;
revoke all on function public.recommended_devices() from public, anon;
grant execute on function public.recommended_devices() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. 18.1 pairing for a person (shared phones): a supporter pairs a device to the person they support
-- ---------------------------------------------------------------------------
create or replace function public.pair_device_for(p_person uuid, p_device_type public.patient_device_type, p_ble_device_id text, p_model text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_person <> v_uid and not private.can_act_for(p_person) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(length(btrim(p_ble_device_id)), 0) = 0 then raise exception 'a device id is needed' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = p_person and role = 'patient';
  if v_org is null then raise exception 'unknown person' using errcode = '22023'; end if;
  select id into v_id from public.patient_devices where patient_id = p_person and ble_device_id = p_ble_device_id and status = 'active';
  if v_id is not null then return v_id; end if;
  insert into public.patient_devices (organisation_id, patient_id, device_type, ble_device_id, model)
  values (v_org, p_person, p_device_type, p_ble_device_id, left(p_model, 120))
  returning id into v_id;
  perform private.log_audit('device.paired_for_person', 'patient_devices', v_id, jsonb_build_object('by_supporter', p_person <> v_uid));
  return v_id;
end $$;
revoke all on function public.pair_device_for(uuid, public.patient_device_type, text, text) from public, anon;
grant execute on function public.pair_device_for(uuid, public.patient_device_type, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10b. Who a posted device reading belongs to (shared phones). A person's own device, or the device of someone they manage, else nothing.
--      The caller (the device-readings route) then writes the reading for THAT person, logged by the caller.
-- ---------------------------------------------------------------------------
create or replace function public.device_target_for_reading(p_device_id uuid) returns table (patient_id uuid, organisation_id uuid, is_supporter boolean)
language sql stable security definer set search_path = '' as $$
  select d.patient_id, d.organisation_id, d.patient_id <> (select auth.uid())
    from public.patient_devices d
   where d.id = p_device_id and d.status = 'active' and (select auth.uid()) is not null
     and (d.patient_id = (select auth.uid()) or private.can_act_for(d.patient_id))
$$;
revoke all on function public.device_target_for_reading(uuid) from public, anon;
grant execute on function public.device_target_for_reading(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10c. 18.9 wrist SpO2 is informational only (A12). With the module on, an oxygen reading that arrives through a wearable or a phone health
--      bridge is saved and shown but never opens an alert or an emergency on its own. A fingertip oximeter paired by Bluetooth (source device),
--      a photo of an oximeter, and a typed value are untouched. The trigger keeps its body: only its WHEN condition gains one test, and the
--      test function must be executable by the inserting role (a trigger condition runs with the caller's privileges).
-- ---------------------------------------------------------------------------
create or replace function private.spo2_may_triage(p_source text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not (p_source = 'wearable' and private.module_enabled('device_wrist_spo2_informational'))
$$;
revoke all on function private.spo2_may_triage(text) from public, anon;
grant execute on function private.spo2_may_triage(text) to authenticated, service_role;

drop trigger vitals_readings_spo2_red_flag on public.vitals_readings;
create trigger vitals_readings_spo2_red_flag
  after insert on public.vitals_readings
  for each row when (new.vital_type = 'spo2'::public.vital_type and private.spo2_may_triage(new.source::text))
  execute function private.handle_spo2_reading_red_flag();

-- ---------------------------------------------------------------------------
-- 11. Assertions: the migration aborts if any of this is not true
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.platform_modules where key like 'device\_%' and is_enabled;
  if v_n <> 0 then raise exception 'FAIL: a device module is switched on'; end if;
  select count(*) into v_n from public.platform_modules where key in ('device_plausibility_hold', 'device_cross_source_dedupe', 'device_cgm_sustained_events',
    'device_ecg_rhythm_alerts', 'device_photo_capture', 'device_recommended_list', 'device_wrist_spo2_informational');
  if v_n <> 7 then raise exception 'FAIL: expected 7 device modules, found %', v_n; end if;
  if (select count(*) from public.device_config where is_active) <> 4 then raise exception 'FAIL: expected 4 active device_config rows'; end if;
  if exists (select 1 from public.device_config where status <> 'proposed') then raise exception 'FAIL: a device_config row is marked confirmed'; end if;
  if exists (select 1 from public.device_catalog where clinically_reviewed) then raise exception 'FAIL: a device is marked reviewed by this migration'; end if;
  if has_table_privilege('anon', 'public.vitals_readings_held', 'SELECT') or has_table_privilege('anon', 'public.vitals_reading_links', 'SELECT')
     or has_table_privilege('anon', 'public.device_rhythm_results', 'SELECT') or has_table_privilege('anon', 'public.device_config', 'SELECT') then
    raise exception 'FAIL: anon can read a new table';
  end if;
  if has_table_privilege('authenticated', 'public.vitals_readings_held', 'INSERT') or has_table_privilege('authenticated', 'public.vitals_reading_links', 'UPDATE')
     or has_table_privilege('authenticated', 'public.device_rhythm_results', 'DELETE') or has_table_privilege('authenticated', 'public.device_config', 'UPDATE') then
    raise exception 'FAIL: authenticated can write a new table';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('resolve_held_reading', 'report_device_synced', 'record_device_rhythm_result', 'review_device_catalog_entry', 'recommended_devices', 'pair_device_for', 'device_target_for_reading')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_n <> 0 then raise exception 'FAIL: % new public function(s) with the wrong anon or authenticated execute', v_n; end if;
  if (select count(*) from public.task_types where code in ('cgm_glucose_review', 'device_rhythm_review') and is_active) <> 2 then raise exception 'FAIL: task types missing'; end if;
  if (select count(*) from public.event_types where event_type in ('device.synced', 'device.alert')) <> 2 then raise exception 'FAIL: event types missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.vitals_readings'::regclass and tgname = 'vitals_readings_a_hold_impossible') then raise exception 'FAIL: hold trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.vitals_readings'::regclass and tgname = 'vitals_readings_z_cross_source_dedupe') then raise exception 'FAIL: dedupe trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.vitals_readings'::regclass and tgname = 'vitals_readings_cgm_sustained') then raise exception 'FAIL: cgm trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.vitals_readings'::regclass and tgname = 'vitals_readings_spo2_red_flag' and not tgisinternal) then raise exception 'FAIL: spo2 trigger missing'; end if;
  raise notice 'PASS: S70a device core installed (all new capabilities are off)';
end $$;
