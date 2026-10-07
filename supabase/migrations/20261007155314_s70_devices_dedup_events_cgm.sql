-- S70 (Module 18): devices, wearables and data connections.
--
-- WHAT THIS DOES, and nothing else:
--   1. Cross-source duplicate readings (18.9, the module's own acceptance test, CMO selection C1). A reading that arrives from a
--      second source (a Bluetooth cuff and Health Connect, a typed value and a wearable) is LINKED to the first, never deleted.
--      Link table, not a column: vitals_readings rows are locked against edits by private.enforce_vitals_reading_source_lock, and a
--      link must be written when the better reading arrives LATER than the worse one. The clinical device or the patient's own
--      typed or photo-confirmed value outranks a wearable estimate. public.vitals_readings_counted is the view that counts once.
--      Linking NEVER suppresses a safety path: every row, duplicate or not, still runs the red-flag triggers on insert.
--   2. device_config: versioned PROPOSED values (INV-16) for the dedup windows and tolerances, the CGM sustained-event rules (C2) and
--      the device-alert task rule (C3). Every decision records the version it used. Mirrored in packages/shared as devices.*.
--   3. device.synced and device.alert in the S10 event registry (ids and counts only, never a reading).
--   4. device_alerts + a clinician TASK (type device_alert_review, class 7, due in one working day). An irregular or inconclusive
--      result from a personal ECG device, or a sustained CGM low or high, creates a task and an event. It never creates a
--      patient-facing diagnosis. Task creation sits behind the go-live guard device_alerts_enabled (INV-14), born OFF.
--   5. CGM sustained-event evaluator (trigger on vitals_readings). Thresholds come from device_config, not code.
--   6. Photo-confirmed flag on vitals_readings (18.3) and the recommended-device criteria on device_catalog (18.2).
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * No device_connections table. The spec's name is satisfied by wearable_connections (cloud and OS health stores), cgm_connections
--     (partner CGM) and patient_devices (Bluetooth); a fourth table would be a second source of truth.
--   * Does not replace private.go_live_conditions: the new guard has the fail-closed "unknown_guard" condition until S37's owner adds a
--     branch for it (recorded as an open question). So it cannot be switched on yet, which is the intent.
--   * Seeds no device model and no distributor (founder supplies them). Seeds no Withings/Samsung flow: only the provider enum value.
--   * Does not sign anything. Every device_config row is 'proposed'; the CMO signs through the S37 sign-off screen.
--
-- Counts checked 2026-10-07 on origin/main-dev's migrations: device_catalog has 3 inactive seed rows, 0 active; no device_* tables exist;
-- the glucose emergency backstop (20260807090308) already fires for a single CGM value under 3.0 mmol/L, so a severe low already reaches
-- the emergency path. The sustained rule adds the clinician task and the 15 minute confirmation, it does not replace that backstop.
--
-- FILENAME: sorts after origin/main-dev's newest (20261007153917) on purpose; the sandbox clock reads earlier than that stamp.

-- ---------------------------------------------------------------------------
-- 0. Provider enum value (a cloud API slot only; no flow is switched on)
-- ---------------------------------------------------------------------------
alter type public.wearable_provider add value if not exists 'withings';

-- ---------------------------------------------------------------------------
-- 1. device_config (PROPOSED values, versioned)
-- ---------------------------------------------------------------------------
create table public.device_config (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('dedup', 'cgm_events', 'device_alert')),
  version    integer not null check (version >= 1),
  is_active  boolean not null default false,
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  rules      jsonb not null check (jsonb_typeof(rules) = 'object'),
  note       text,
  created_at timestamptz not null default now(),
  unique (kind, version)
);
create unique index device_config_one_active on public.device_config (kind) where is_active;
comment on table public.device_config is 'S70: PROPOSED device values, versioned (INV-16). dedup = windows, tolerances and source ranks; cgm_events = sustained low and high rules; device_alert = task timing. Read by admin and the CMO only. The CMO signs each version through the S37 sign-off screen; an agent never does.';

-- dedup-begin
insert into public.device_config (kind, version, is_active, rules, note) values ('dedup', 1, true, $json$
{
  "ranks": { "device": 1, "photo": 1, "manual": 1, "cgm": 2, "wearable": 3, "fhir_import": 4 },
  "types": {
    "blood_pressure": { "window_minutes": 10, "tolerance_systolic": 4, "tolerance_diastolic": 4 },
    "glucose": { "window_minutes": 5, "tolerance_mmol_l": 0.6 },
    "weight": { "window_minutes": 10, "tolerance_kg": 0.3 },
    "temperature": { "window_minutes": 5, "tolerance_c": 0.3 },
    "spo2": { "window_minutes": 5, "tolerance_pct": 2 }
  }
}
$json$::jsonb, 'PROPOSED. Windows for blood pressure (10) and glucose (5) are the CMO pack C1 figures; every tolerance, the other three windows and the rank order are drafted here and need the CMO signature (OQ-309). Pulse is left out on purpose: it is a continuous stream and two sources would link every sample.');
-- dedup-end

-- cgm-begin
insert into public.device_config (kind, version, is_active, rules, note) values ('cgm_events', 1, true, $json$
{
  "events": [
    { "code": "cgm_severe_low", "comparison": "below", "threshold_mmol_l": 3.0, "min_minutes": 15, "due_minutes": 240 },
    { "code": "cgm_low", "comparison": "below", "threshold_mmol_l": 3.9, "min_minutes": 60, "due_minutes": 1440 },
    { "code": "cgm_high", "comparison": "above", "threshold_mmol_l": 13.9, "min_minutes": 120, "due_minutes": 1440 }
  ],
  "max_gap_minutes": 20,
  "lookback_hours": 6,
  "suppress_hours": 6
}
$json$::jsonb, 'PROPOSED. Thresholds and durations are the CMO pack C2 option (a): low under 3.0 for 15 minutes or under 3.9 for 60 minutes, high over 13.9 for 120 minutes. Source: International Consensus on Time in Range (secondary source, primary text not read). max_gap, lookback, suppress and the task due times are drafted here. Needs the CMO signature (OQ-310).');
-- cgm-end

-- device-alert-begin
insert into public.device_config (kind, version, is_active, rules, note) values ('device_alert', 1, true, $json$
{
  "ecg_codes": ["ecg_irregular", "ecg_inconclusive"],
  "ecg_due_minutes": 1440,
  "ecg_daily_cap": 10
}
$json$::jsonb, 'PROPOSED. CMO pack C3 option (a): a routine clinician task within one working day (1440 minutes, the existing convention). The daily cap per patient stops a flood from one device. Needs the CMO signature (OQ-311).');
-- device-alert-end

alter table public.device_config enable row level security;
revoke all on public.device_config from public, anon, authenticated;
grant select on public.device_config to authenticated;
create policy device_config_read on public.device_config for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());

create or replace function private.device_config_active(p_kind text)
returns public.device_config
language sql stable security definer set search_path = ''
as $$ select c from public.device_config c where c.kind = p_kind and c.is_active $$;
revoke all on function private.device_config_active(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Photo-confirmed flag (18.3) and the plausibility trail it rides on
-- ---------------------------------------------------------------------------
alter table public.vitals_readings
  add column if not exists photo_confirmed boolean not null default false;
comment on column public.vitals_readings.photo_confirmed is
  'S70 (18.3): true when the patient typed or confirmed these numbers after taking a photo of a device screen. The photo itself is never uploaded. Stored with source = device and no device_id; same plausibility and triage as a manual entry.';

-- ---------------------------------------------------------------------------
-- 3. Cross-source dedup: links, the linker, the counted view
-- ---------------------------------------------------------------------------
create table public.vitals_reading_links (
  duplicate_id          uuid primary key references public.vitals_readings (id) on delete cascade,
  canonical_id          uuid not null references public.vitals_readings (id) on delete cascade,
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  dedup_config_version  integer not null,
  duplicate_source      text not null,
  canonical_source      text not null,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  check (duplicate_id <> canonical_id)
);
create index vitals_reading_links_canonical_idx on public.vitals_reading_links (canonical_id);
create index vitals_reading_links_patient_idx on public.vitals_reading_links (patient_id, created_at desc);
comment on table public.vitals_reading_links is 'S70 (C1): the same measurement seen from two sources. The duplicate row stays, with every value and its own triage; this link says which row counts. Written only by private.link_duplicate_for_reading().';

alter table public.vitals_reading_links enable row level security;
revoke all on public.vitals_reading_links from public, anon, authenticated;
grant select on public.vitals_reading_links to authenticated;
-- Same reach as vitals_readings itself (S05f closed the direct staff path; staff read through the audited functions).
create policy vitals_reading_links_select on public.vitals_reading_links for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category));

create or replace function private.reading_rank_key(p_source text, p_photo boolean)
returns text language sql immutable set search_path = ''
as $$ select case when p_photo then 'photo' else p_source end $$;

create or replace function private.reading_values_match(a public.vitals_readings, b public.vitals_readings, t jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select case a.vital_type::text
    when 'blood_pressure' then a.systolic is not null and b.systolic is not null and a.diastolic is not null and b.diastolic is not null
      and abs(a.systolic - b.systolic) <= coalesce((t ->> 'tolerance_systolic')::numeric, 0)
      and abs(a.diastolic - b.diastolic) <= coalesce((t ->> 'tolerance_diastolic')::numeric, 0)
    when 'glucose' then a.glucose_mmol_l is not null and b.glucose_mmol_l is not null
      and abs(a.glucose_mmol_l - b.glucose_mmol_l) <= coalesce((t ->> 'tolerance_mmol_l')::numeric, 0)
    when 'weight' then a.weight_kg is not null and b.weight_kg is not null
      and abs(a.weight_kg - b.weight_kg) <= coalesce((t ->> 'tolerance_kg')::numeric, 0)
    when 'temperature' then a.temperature_c is not null and b.temperature_c is not null
      and abs(a.temperature_c - b.temperature_c) <= coalesce((t ->> 'tolerance_c')::numeric, 0)
    when 'spo2' then a.spo2_pct is not null and b.spo2_pct is not null
      and abs(a.spo2_pct - b.spo2_pct) <= coalesce((t ->> 'tolerance_pct')::numeric, 0)
    else false end
$$;

-- Returns true when this reading was linked (either way round). Idempotent: a reading already linked as a duplicate is left alone.
create or replace function private.link_duplicate_for_reading(p_reading_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  cfg  public.device_config%rowtype;
  n    public.vitals_readings%rowtype;
  c    public.vitals_readings%rowtype;
  t    jsonb;
  v_win interval;
  v_nrank integer;
  v_crank integer;
  v_ranks jsonb;
begin
  select * into n from public.vitals_readings where id = p_reading_id;
  if not found then return false; end if;
  if exists (select 1 from public.vitals_reading_links where duplicate_id = n.id) then return false; end if;
  select * into cfg from public.device_config where kind = 'dedup' and is_active;
  if not found then return false; end if;
  t := cfg.rules -> 'types' -> n.vital_type::text;
  if t is null or n.taken_at is null then return false; end if;
  v_ranks := cfg.rules -> 'ranks';
  v_win := make_interval(secs => ((t ->> 'window_minutes')::numeric * 60)::double precision);
  v_nrank := coalesce((v_ranks ->> private.reading_rank_key(n.source::text, n.photo_confirmed))::integer, 99);

  select vr.* into c
    from public.vitals_readings vr
   where vr.patient_id = n.patient_id
     and vr.vital_type = n.vital_type
     and vr.id <> n.id
     and vr.taken_at between n.taken_at - v_win and n.taken_at + v_win
     and not exists (select 1 from public.vitals_reading_links l where l.duplicate_id = vr.id)
     -- a different origin: another source, or another device, connection or sensor of the same kind
     and coalesce(vr.device_id::text, vr.wearable_connection_id::text, vr.cgm_connection_id::text, vr.source::text || ':' || vr.photo_confirmed::text)
         is distinct from
         coalesce(n.device_id::text, n.wearable_connection_id::text, n.cgm_connection_id::text, n.source::text || ':' || n.photo_confirmed::text)
     and private.reading_values_match(n, vr, t)
   order by coalesce((v_ranks ->> private.reading_rank_key(vr.source::text, vr.photo_confirmed))::integer, 99),
            abs(extract(epoch from (vr.taken_at - n.taken_at))),
            vr.created_at
   limit 1;
  if not found then return false; end if;

  v_crank := coalesce((v_ranks ->> private.reading_rank_key(c.source::text, c.photo_confirmed))::integer, 99);
  if v_nrank < v_crank then
    -- the new reading is the better measurement: the earlier one becomes the duplicate, and so does anything that pointed at it
    insert into public.vitals_reading_links (duplicate_id, canonical_id, organisation_id, patient_id, dedup_config_version, duplicate_source, canonical_source, is_test)
    values (c.id, n.id, c.organisation_id, c.patient_id, cfg.version,
            private.reading_rank_key(c.source::text, c.photo_confirmed), private.reading_rank_key(n.source::text, n.photo_confirmed),
            coalesce((select p.is_test from public.profiles p where p.id = c.patient_id), false))
    on conflict (duplicate_id) do nothing;
    update public.vitals_reading_links set canonical_id = n.id where canonical_id = c.id and duplicate_id <> n.id;
  else
    -- equal rank or worse: the first reading stays canonical
    insert into public.vitals_reading_links (duplicate_id, canonical_id, organisation_id, patient_id, dedup_config_version, duplicate_source, canonical_source, is_test)
    values (n.id, c.id, n.organisation_id, n.patient_id, cfg.version,
            private.reading_rank_key(n.source::text, n.photo_confirmed), private.reading_rank_key(c.source::text, c.photo_confirmed),
            coalesce((select p.is_test from public.profiles p where p.id = n.patient_id), false))
    on conflict (duplicate_id) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function private.link_duplicate_for_reading(uuid) from public, anon, authenticated;

-- The trigger never refuses a reading: a failure to link only means the reading is counted twice until the sweep re-links it.
create or replace function private.link_duplicate_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.link_duplicate_for_reading(new.id);
  exception when others then
    raise warning 'S70: could not link a duplicate reading for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.link_duplicate_trigger() from public, anon, authenticated;

create trigger vitals_readings_link_duplicate
  after insert on public.vitals_readings
  for each row
  when (new.vital_type in ('blood_pressure', 'glucose', 'weight', 'temperature', 'spo2'))
  execute function private.link_duplicate_trigger();

-- Re-runs the linker over recent readings (a missed link, or a window changed in a later config version). Service role and admin only.
create or replace function public.sweep_unlinked_duplicates(p_days integer default 2)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_n integer := 0;
begin
  if not (coalesce((select auth.role()), '') = 'service_role' or private.is_admin()) then
    raise exception 'only the service or an admin can re-link readings' using errcode = '42501';
  end if;
  for r in select id from public.vitals_readings
            where created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 2), 30)))
              and vital_type in ('blood_pressure', 'glucose', 'weight', 'temperature', 'spo2')
            order by taken_at loop
    if private.link_duplicate_for_reading(r.id) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.sweep_unlinked_duplicates(integer) from public, anon;
grant execute on function public.sweep_unlinked_duplicates(integer) to authenticated, service_role;

-- Every aggregate that counts or averages readings reads this view. It follows the caller's own access (security_invoker).
create view public.vitals_readings_counted with (security_invoker = true) as
select vr.*
  from public.vitals_readings vr
 where not exists (select 1 from public.vitals_reading_links l where l.duplicate_id = vr.id);
revoke all on public.vitals_readings_counted from public, anon, authenticated;
grant select on public.vitals_readings_counted to authenticated;
comment on view public.vitals_readings_counted is 'S70 (C1): vitals_readings without the rows linked as a duplicate of a better reading. Use this for any count, average or trend. Safety paths (red-flag triggers, CGM sustained events) read the base table and see every row.';

-- ---------------------------------------------------------------------------
-- 4. Events (ids and counts only, INV-07) and the task type
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('device.synced', 'A device, wearable or health-store sync finished. Carries a provider name and counts, never a reading.', 'S70', false),
  ('device.alert', 'A device result or a sustained sensor pattern needs a clinician to look. Carries an alert id and a code, never a value.', 'S70', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('device.synced', 1, array['provider', 'source_kind', 'reading_count']),
  ('device.alert', 1, array['alert_id', 'alert_code', 'source_kind']);

-- task-types-s70-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('device_alert_review', 1, 7, 1440, 'medical_officer', '{adult_general}', 1440, 30, true, true, '{}',
   'S70: a personal ECG device flagged an irregular or inconclusive result, or a CGM stayed low or high for a sustained time. PROPOSED routine class and one working day (CMO pack C3, OQ-311). Never a diagnosis to the patient.');
-- task-types-s70-end

-- ---------------------------------------------------------------------------
-- 5. device_alerts and the go-live guard
-- ---------------------------------------------------------------------------
create table public.device_alerts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  alert_code         text not null check (alert_code in ('ecg_irregular', 'ecg_inconclusive', 'cgm_severe_low', 'cgm_low', 'cgm_high')),
  source_kind        text not null check (source_kind in ('ecg', 'cgm')),
  provider           text not null check (char_length(provider) between 1 and 40),
  device_result_text text check (device_result_text is null or char_length(device_result_text) <= 120),
  vitals_reading_id  uuid references public.vitals_readings (id) on delete set null,
  episode_started_at timestamptz,
  episode_minutes    integer check (episode_minutes is null or episode_minutes >= 0),
  extreme_value      numeric,
  config_kind        text not null,
  config_version     integer not null,
  state              text not null default 'held_guard_off' check (state in ('task_created', 'held_guard_off', 'task_failed')),
  task_id            uuid references public.clinical_tasks (id) on delete set null,
  event_id           uuid,
  dedup_key          text not null unique,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  check ((source_kind = 'ecg') = (alert_code like 'ecg\_%'))
);
create index device_alerts_patient_idx on public.device_alerts (patient_id, created_at desc);
create index device_alerts_open_idx on public.device_alerts (state) where state <> 'task_created';
comment on table public.device_alerts is 'S70: one row per device result or sensor pattern that a clinician must look at. Holds the device''s own wording and, for a sensor, the extreme value and duration. No patient or staff policy: staff read through clinician_device_alerts() (audited, INV-10); the patient sees only a neutral status from my_device_review_status().';
alter table public.device_alerts enable row level security;
revoke all on public.device_alerts from public, anon, authenticated;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('device_alerts_enabled', 'Device alert tasks', 'Clinician tasks raised from a personal ECG result or a sustained CGM low or high',
   'The CMO has signed the dedup, CGM and device alert rules; a clinical safety case covers them; admin confirmation', 'cmo',
   array['private.raise_device_alert (task creation)'],
   'Alerts are always recorded and the device.alert event is always emitted; only the task is held while the guard is off. A manual or device reading is triaged exactly as before, and the glucose emergency backstop still fires on a single severe low. The guard has no data conditions yet (S37 must add a branch to private.go_live_conditions, OQ-343), so it cannot be switched on until then.');

-- Raises one alert. Idempotent on dedup_key. Never throws to its caller: a failed task leaves state task_failed for the sweep.
create or replace function private.raise_device_alert(
  p_patient uuid, p_code text, p_source_kind text, p_provider text, p_result_text text, p_reading uuid,
  p_episode_started timestamptz, p_episode_minutes integer, p_extreme numeric, p_dedup_key text,
  p_config_kind text, p_config_version integer, p_due_minutes integer)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles%rowtype;
  v_id uuid;
  v_event uuid;
  v_task uuid;
begin
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  insert into public.device_alerts
    (organisation_id, patient_id, alert_code, source_kind, provider, device_result_text, vitals_reading_id,
     episode_started_at, episode_minutes, extreme_value, config_kind, config_version, dedup_key, is_test)
  values (pr.organisation_id, p_patient, p_code, p_source_kind, p_provider, left(p_result_text, 120), p_reading,
          p_episode_started, p_episode_minutes, p_extreme, p_config_kind, p_config_version, p_dedup_key, coalesce(pr.is_test, false))
  on conflict (dedup_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.device_alerts where dedup_key = p_dedup_key;
    return v_id;
  end if;

  v_event := private.emit_domain_event('device.alert', pr.organisation_id,
    jsonb_build_object('alert_id', v_id, 'alert_code', p_code, 'source_kind', p_source_kind),
    'device.alert:' || v_id, p_patient, 'device_alert', v_id);
  update public.device_alerts set event_id = v_event where id = v_id;

  if private.go_live_open_patient('device_alerts_enabled', p_patient) then
    begin
      v_task := private.create_clinical_task(p_patient, 'device_alert_review', p_due_minutes, 'device_alert:' || p_patient || ':' || p_code,
                                             null, null, v_event);
      update public.device_alerts set state = 'task_created', task_id = v_task where id = v_id;
    exception when others then
      raise warning 'S70: could not create the task for device alert %: %', v_id, sqlerrm;
      update public.device_alerts set state = 'task_failed' where id = v_id;
    end;
  end if;
  return v_id;
end;
$$;
revoke all on function private.raise_device_alert(uuid, text, text, text, text, uuid, timestamptz, integer, numeric, text, text, integer, integer) from public, anon, authenticated;

-- After the guard is switched on (or a failed task is fixed), creates the tasks that were held. Admin, CMO or the service.
create or replace function public.release_held_device_alerts()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare a record; v_task uuid; v_n integer := 0; v_due integer;
begin
  if not (coalesce((select auth.role()), '') = 'service_role' or private.is_admin() or private.credential_is_cmo()) then
    raise exception 'only the service, an admin or the CMO can release held device alerts' using errcode = '42501';
  end if;
  for a in select * from public.device_alerts where state in ('held_guard_off', 'task_failed') order by created_at loop
    continue when not private.go_live_open_patient('device_alerts_enabled', a.patient_id);
    v_due := case when a.source_kind = 'ecg'
                  then coalesce((private.device_config_active('device_alert')).rules ->> 'ecg_due_minutes', '1440')::integer
                  else coalesce((select (e ->> 'due_minutes')::integer
                                   from jsonb_array_elements((private.device_config_active('cgm_events')).rules -> 'events') e
                                  where e ->> 'code' = a.alert_code), 1440) end;
    begin
      v_task := private.create_clinical_task(a.patient_id, 'device_alert_review', v_due, 'device_alert:' || a.patient_id || ':' || a.alert_code, null, null, a.event_id);
      update public.device_alerts set state = 'task_created', task_id = v_task where id = a.id;
      v_n := v_n + 1;
    exception when others then
      raise warning 'S70: release of device alert % failed: %', a.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.release_held_device_alerts() from public, anon;
grant execute on function public.release_held_device_alerts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. CGM sustained events (C2)
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_cgm_events(p_reading_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.device_config%rowtype;
  r public.vitals_readings%rowtype;
  ev jsonb;
  s record;
  v_cmp text; v_thr numeric; v_min integer; v_code text; v_due integer;
  v_gap interval; v_lookback interval; v_suppress interval;
  v_start timestamptz; v_prev timestamptz; v_extreme numeric;
  v_raised integer := 0;
  v_provider text;
begin
  select * into r from public.vitals_readings where id = p_reading_id;
  if not found or r.vital_type <> 'glucose' or r.glucose_mmol_l is null then return 0; end if;
  v_provider := case when r.source = 'cgm' then 'cgm_partner'
                     else (select wc.provider::text from public.wearable_connections wc
                            where wc.id = r.wearable_connection_id and wc.provider::text in ('dexcom', 'libre')) end;
  if v_provider is null then return 0; end if;
  select * into cfg from public.device_config where kind = 'cgm_events' and is_active;
  if not found then return 0; end if;
  v_gap := make_interval(mins => (cfg.rules ->> 'max_gap_minutes')::integer);
  v_lookback := make_interval(hours => (cfg.rules ->> 'lookback_hours')::integer);
  v_suppress := make_interval(hours => (cfg.rules ->> 'suppress_hours')::integer);

  -- a late arrival that is not the newest sensor reading changes nothing about "now"
  if exists (
    select 1 from public.vitals_readings vr
      left join public.wearable_connections wc on wc.id = vr.wearable_connection_id
     where vr.patient_id = r.patient_id and vr.vital_type = 'glucose' and vr.glucose_mmol_l is not null
       and vr.taken_at > r.taken_at
       and (vr.source = 'cgm' or (vr.source = 'wearable' and wc.provider::text in ('dexcom', 'libre')))) then
    return 0;
  end if;

  for ev in select * from jsonb_array_elements(cfg.rules -> 'events') loop
    v_code := ev ->> 'code'; v_cmp := ev ->> 'comparison'; v_thr := (ev ->> 'threshold_mmol_l')::numeric;
    v_min := (ev ->> 'min_minutes')::integer; v_due := (ev ->> 'due_minutes')::integer;
    v_start := null; v_prev := null; v_extreme := null;
    for s in
      select vr.taken_at, vr.glucose_mmol_l
        from public.vitals_readings vr
        left join public.wearable_connections wc on wc.id = vr.wearable_connection_id
       where vr.patient_id = r.patient_id and vr.vital_type = 'glucose' and vr.glucose_mmol_l is not null
         and vr.taken_at <= r.taken_at and vr.taken_at >= r.taken_at - v_lookback
         and (vr.source = 'cgm' or (vr.source = 'wearable' and wc.provider::text in ('dexcom', 'libre')))
       order by vr.taken_at desc
    loop
      exit when not ((v_cmp = 'below' and s.glucose_mmol_l < v_thr) or (v_cmp = 'above' and s.glucose_mmol_l > v_thr));
      exit when v_prev is not null and (v_prev - s.taken_at) > v_gap;
      v_start := s.taken_at; v_prev := s.taken_at;
      v_extreme := case when v_extreme is null then s.glucose_mmol_l
                        when v_cmp = 'below' then least(v_extreme, s.glucose_mmol_l)
                        else greatest(v_extreme, s.glucose_mmol_l) end;
    end loop;
    continue when v_start is null;
    continue when extract(epoch from (r.taken_at - v_start)) / 60 < v_min;
    continue when exists (select 1 from public.device_alerts a
                           where a.patient_id = r.patient_id and a.alert_code = v_code
                             and a.episode_started_at > r.taken_at - v_suppress);
    perform private.raise_device_alert(r.patient_id, v_code, 'cgm', v_provider, null, r.id, v_start,
      (extract(epoch from (r.taken_at - v_start)) / 60)::integer, v_extreme,
      'cgm:' || r.patient_id || ':' || v_code || ':' || (extract(epoch from v_start))::bigint,
      'cgm_events', cfg.version, v_due);
    v_raised := v_raised + 1;
    if v_code = 'cgm_severe_low' then
      -- the existing emergency safety copy (acknowledge-gated guidance, contact notify); idempotent inside its own 3 hour window
      perform private.raise_glucose_backstop_emergency(r.organisation_id, r.patient_id, r.id,
        'Severe low glucose sustained on a continuous sensor, last reading logged ' || to_char(r.taken_at, 'YYYY-MM-DD HH24:MI') || '.');
    end if;
  end loop;
  return v_raised;
end;
$$;
revoke all on function private.evaluate_cgm_events(uuid) from public, anon, authenticated;

create or replace function private.cgm_events_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.evaluate_cgm_events(new.id);
  exception when others then
    -- A reading is never refused because the evaluator is unhappy. Not silent: the warning is logged, and the glucose backstop is independent.
    raise warning 'S70: could not evaluate CGM events for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.cgm_events_trigger() from public, anon, authenticated;

create trigger vitals_readings_cgm_events
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'glucose' and new.source in ('cgm', 'wearable'))
  execute function private.cgm_events_trigger();

-- ---------------------------------------------------------------------------
-- 7. ECG result from a personal device (C3), device.synced, clinician and patient reads
-- ---------------------------------------------------------------------------
create or replace function public.report_device_ecg_result(
  p_classification text, p_provider text, p_device_result_text text, p_recorded_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  cfg public.device_config%rowtype;
  v_code text;
  v_cap integer;
  v_id uuid;
  v_key text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    raise exception 'only a patient can report a device result' using errcode = '42501';
  end if;
  if p_classification is null or p_classification not in ('sinus_rhythm', 'irregular_rhythm', 'inconclusive', 'not_classified') then
    raise exception 'unknown classification' using errcode = '22023';
  end if;
  if p_provider is null or char_length(btrim(p_provider)) not between 1 and 40 then
    raise exception 'say which device or app the result came from' using errcode = '22023';
  end if;
  if p_recorded_at is null or p_recorded_at > now() + interval '10 minutes' or p_recorded_at < now() - interval '14 days' then
    raise exception 'the recording time is out of range' using errcode = '22023';
  end if;
  if p_classification in ('sinus_rhythm', 'not_classified') then
    return jsonb_build_object('alert', false);
  end if;
  v_code := case p_classification when 'irregular_rhythm' then 'ecg_irregular' else 'ecg_inconclusive' end;
  select * into cfg from public.device_config where kind = 'device_alert' and is_active;
  if not found then raise exception 'the device alert rules are not configured' using errcode = '55000'; end if;
  select count(*) into v_cap from public.device_alerts
   where patient_id = v_uid and source_kind = 'ecg' and created_at > now() - interval '1 day';
  v_key := 'ecg:' || v_uid || ':' || btrim(p_provider) || ':' || to_char(p_recorded_at at time zone 'UTC', 'YYYYMMDDHH24MI');
  if v_cap >= (cfg.rules ->> 'ecg_daily_cap')::integer
     and not exists (select 1 from public.device_alerts where dedup_key = v_key) then
    return jsonb_build_object('alert', false, 'capped', true);
  end if;
  v_id := private.raise_device_alert(v_uid, v_code, 'ecg', btrim(p_provider), p_device_result_text, null,
                                     p_recorded_at, null, null, v_key, 'device_alert', cfg.version, (cfg.rules ->> 'ecg_due_minutes')::integer);
  return jsonb_build_object('alert', true, 'reviewed_by_care_team', true);
end;
$$;
revoke all on function public.report_device_ecg_result(text, text, text, timestamptz) from public, anon;
grant execute on function public.report_device_ecg_result(text, text, text, timestamptz) to authenticated;

create or replace function public.record_device_sync(
  p_patient uuid, p_provider text, p_source_kind text, p_reading_count integer, p_duplicate_count integer default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
  v_org uuid;
begin
  if not v_service and (v_uid is null or v_uid is distinct from p_patient) then
    raise exception 'a sync can only be recorded for yourself' using errcode = '42501';
  end if;
  if p_provider is null or char_length(btrim(p_provider)) not between 1 and 40
     or p_source_kind not in ('ble', 'wearable_cloud', 'health_store', 'cgm', 'photo') then
    raise exception 'invalid sync description' using errcode = '22023';
  end if;
  if p_reading_count is null or p_reading_count < 0 or p_reading_count > 100000 then
    raise exception 'invalid reading count' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  -- one event per patient, provider and minute, so a chatty client cannot flood the bus
  return private.emit_domain_event('device.synced', v_org,
    jsonb_build_object('provider', btrim(p_provider), 'source_kind', p_source_kind, 'reading_count', p_reading_count,
                       'duplicate_count', greatest(coalesce(p_duplicate_count, 0), 0)),
    'device.synced:' || p_patient || ':' || btrim(p_provider) || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI'),
    p_patient);
end;
$$;
revoke all on function public.record_device_sync(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.record_device_sync(uuid, text, text, integer, integer) to authenticated, service_role;

-- A clinician with a tie to the patient reads the alerts through here (INV-10, INV-12): audited, ties checked.
create or replace function public.clinician_device_alerts(p_patient uuid)
returns table (alert_id uuid, alert_code text, source_kind text, provider text, device_result_text text,
               episode_started_at timestamptz, episode_minutes integer, extreme_value numeric, state text,
               config_version integer, task_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'you do not hold a task or assignment for this patient' using errcode = '42501';
  end if;
  perform private.log_audit('device_alert.read', 'device_alerts', null, jsonb_build_object('patient_id', p_patient));
  return query
    select a.id, a.alert_code, a.source_kind, a.provider, a.device_result_text, a.episode_started_at, a.episode_minutes,
           a.extreme_value, a.state, a.config_version, a.task_id, a.created_at
      from public.device_alerts a where a.patient_id = p_patient order by a.created_at desc limit 50;
end;
$$;
revoke all on function public.clinician_device_alerts(uuid) from public, anon;
grant execute on function public.clinician_device_alerts(uuid) to authenticated;

-- What the patient may know: that something is with their care team. No code, no value, no wording.
create or replace function public.my_device_review_status()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from public.device_alerts a
   where a.patient_id = (select auth.uid()) and a.created_at > now() - interval '3 days'
$$;
revoke all on function public.my_device_review_status() from public, anon;
grant execute on function public.my_device_review_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Recommended devices (18.2): the listing criteria are enforced, not just written down (CMO pack C5)
-- ---------------------------------------------------------------------------
alter table public.device_catalog
  add column if not exists validation_standard text,
  add column if not exists validation_reference text,
  add column if not exists nafdac_status text not null default 'unverified',
  add column if not exists nafdac_registration_number text,
  add column if not exists distributor_name text,
  add column if not exists distributor_checked_on date,
  add column if not exists bluetooth_via text not null default 'none';
alter table public.device_catalog
  add constraint device_catalog_nafdac_status_check check (nafdac_status in ('unverified', 'registered', 'authorised_distributor')),
  add constraint device_catalog_validation_standard_check
    check (validation_standard is null or validation_standard in ('validatebp', 'iso_81060_2', 'aami_esh_iso_universal', 'iso_15197', 'other_published')),
  add constraint device_catalog_bluetooth_via_check check (bluetooth_via in ('none', 'direct', 'health_connect', 'apple_health', 'vendor_app')),
  -- a model is listed (active) only when it is validated AND NAFDAC-registered or sold by an authorised distributor whose name is recorded
  add constraint device_catalog_listing_criteria check (
    not active or (
      validation_standard is not null and validation_reference is not null
      and nafdac_status in ('registered', 'authorised_distributor')
      and distributor_name is not null and char_length(btrim(distributor_name)) > 0
      and (nafdac_status <> 'registered' or nafdac_registration_number is not null)));
comment on constraint device_catalog_listing_criteria on public.device_catalog is 'S70 (C5): validated (ValidateBP or a published standard validation) AND NAFDAC-registered or an authorised local distributor, distributor name recorded. Tarragon sells nothing; the CMO owns the list.';

-- ---------------------------------------------------------------------------
-- 9. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.device_config where is_active) <> 3 then raise exception 'S70: expected three active device_config rows'; end if;
  if exists (select 1 from public.device_config where status <> 'proposed') then raise exception 'S70: an agent seeded a confirmed value'; end if;
  if exists (select 1 from public.go_live_guards where key = 'device_alerts_enabled' and is_on) then raise exception 'S70: the guard was born on'; end if;
  if not exists (select 1 from public.event_types where event_type = 'device.synced') or not exists (select 1 from public.event_types where event_type = 'device.alert') then
    raise exception 'S70: events not registered';
  end if;
  if has_table_privilege('authenticated', 'public.device_alerts', 'SELECT') then raise exception 'S70: authenticated can read device_alerts directly'; end if;
  if has_table_privilege('authenticated', 'public.vitals_reading_links', 'INSERT') or has_table_privilege('authenticated', 'public.vitals_reading_links', 'UPDATE') then
    raise exception 'S70: authenticated can write links';
  end if;
  if has_function_privilege('anon', 'public.report_device_ecg_result(text,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_device_sync(uuid,text,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clinician_device_alerts(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_device_review_status()', 'EXECUTE')
     or has_function_privilege('anon', 'public.sweep_unlinked_duplicates(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.release_held_device_alerts()', 'EXECUTE')
     or has_function_privilege('anon', 'private.raise_device_alert(uuid,text,text,text,text,uuid,timestamptz,integer,numeric,text,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.evaluate_cgm_events(uuid)', 'EXECUTE') then
    raise exception 'S70: a function is callable by a role that must not call it';
  end if;
  if exists (select 1 from public.device_catalog where active) then raise exception 'S70: a device is active without anyone listing it'; end if;
end $$;
