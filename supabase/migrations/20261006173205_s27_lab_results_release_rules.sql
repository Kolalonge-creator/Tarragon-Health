-- S27: partner portal, lab orders, result entry and release rules.
-- Spec 4.4 and 9.6; safety cases 11, 12, 13; INV-03, INV-04, INV-07, INV-10, INV-12, INV-13, INV-16.
--
-- What this adds:
--   lab_panel_versions   versioned analyte lists with units, reference ranges and critical limits (PROPOSED, OQ-176)
--   lab_result_files     the PDF a lab, patient or Tarragon team attached; private, never readable by a patient until released
--   lab_results          one received result and its release state (the INV-03 / INV-04 state machine)
--   lab_result_items     one row per analyte; append only
-- The legacy path (lab_result_documents) is NOT touched; it conflicts with INV-03 and is recorded as OQ-177.
--
-- Live counts before this migration: 0 rows in lab_results / lab_result_items (neither table existed).

alter table public.lab_orders add column if not exists panel_code text check (panel_code in ('essential', 'annual_health_check'));

-- ---------------------------------------------------------------------------
-- 1. Panel versions (data, not code; INV-16)
-- ---------------------------------------------------------------------------
create table public.lab_panel_versions (
  id             uuid primary key default gen_random_uuid(),
  panel_code     text not null check (panel_code in ('essential', 'annual_health_check')),
  version        integer not null check (version >= 1),
  is_active      boolean not null default true,
  effective_from date not null default current_date,
  analytes       jsonb not null check (jsonb_typeof(analytes) = 'array'),
  note           text,
  created_at     timestamptz not null default now(),
  unique (panel_code, version)
);
create unique index lab_panel_versions_one_active on public.lab_panel_versions (panel_code) where is_active;

-- lab-panels-begin
insert into public.lab_panel_versions (panel_code, version, is_active, analytes, note)
select p.key, 1, true, p.value -> 'analytes',
       'PROPOSED adult ranges and critical limits, not signed. The CMO sets them (OQ-176). A wrong range only makes more results wait for review.'
  from jsonb_each($json${
 "panels": {
  "essential": {
   "analytes": [
    {
     "code": "fasting_glucose",
     "label": "Fasting glucose",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 70,
     "refHigh": 99,
     "criticalLow": 40,
     "criticalHigh": 400
    },
    {
     "code": "hba1c",
     "label": "HbA1c",
     "kind": "numeric",
     "unit": "%",
     "refLow": 4.0,
     "refHigh": 5.6,
     "criticalHigh": 14
    },
    {
     "code": "creatinine",
     "label": "Creatinine",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 0.6,
     "refHigh": 1.3,
     "criticalHigh": 4.0
    },
    {
     "code": "potassium",
     "label": "Potassium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 3.5,
     "refHigh": 5.1,
     "criticalLow": 2.5,
     "criticalHigh": 6.5
    },
    {
     "code": "sodium",
     "label": "Sodium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 135,
     "refHigh": 145,
     "criticalLow": 120,
     "criticalHigh": 160
    },
    {
     "code": "total_cholesterol",
     "label": "Total cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 200
    },
    {
     "code": "ldl_cholesterol",
     "label": "LDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 130
    },
    {
     "code": "hdl_cholesterol",
     "label": "HDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 40
    },
    {
     "code": "triglycerides",
     "label": "Triglycerides",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 150
    },
    {
     "code": "alt",
     "label": "ALT",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 7,
     "refHigh": 56
    }
   ]
  },
  "annual_health_check": {
   "analytes": [
    {
     "code": "fasting_glucose",
     "label": "Fasting glucose",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 70,
     "refHigh": 99,
     "criticalLow": 40,
     "criticalHigh": 400
    },
    {
     "code": "hba1c",
     "label": "HbA1c",
     "kind": "numeric",
     "unit": "%",
     "refLow": 4.0,
     "refHigh": 5.6,
     "criticalHigh": 14
    },
    {
     "code": "creatinine",
     "label": "Creatinine",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 0.6,
     "refHigh": 1.3,
     "criticalHigh": 4.0
    },
    {
     "code": "potassium",
     "label": "Potassium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 3.5,
     "refHigh": 5.1,
     "criticalLow": 2.5,
     "criticalHigh": 6.5
    },
    {
     "code": "sodium",
     "label": "Sodium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 135,
     "refHigh": 145,
     "criticalLow": 120,
     "criticalHigh": 160
    },
    {
     "code": "total_cholesterol",
     "label": "Total cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 200
    },
    {
     "code": "ldl_cholesterol",
     "label": "LDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 130
    },
    {
     "code": "hdl_cholesterol",
     "label": "HDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 40
    },
    {
     "code": "triglycerides",
     "label": "Triglycerides",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 150
    },
    {
     "code": "alt",
     "label": "ALT",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 7,
     "refHigh": 56
    },
    {
     "code": "ast",
     "label": "AST",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 10,
     "refHigh": 40
    },
    {
     "code": "haemoglobin",
     "label": "Haemoglobin",
     "kind": "numeric",
     "unit": "g/dL",
     "refLow": 12.0,
     "refHigh": 17.5,
     "criticalLow": 7.0,
     "criticalHigh": 20.0
    },
    {
     "code": "wbc",
     "label": "White cell count",
     "kind": "numeric",
     "unit": "10^9/L",
     "refLow": 4.0,
     "refHigh": 11.0,
     "criticalLow": 1.0,
     "criticalHigh": 30.0
    },
    {
     "code": "platelets",
     "label": "Platelets",
     "kind": "numeric",
     "unit": "10^9/L",
     "refLow": 150,
     "refHigh": 450,
     "criticalLow": 20,
     "criticalHigh": 1000
    },
    {
     "code": "tsh",
     "label": "TSH",
     "kind": "numeric",
     "unit": "mIU/L",
     "refLow": 0.4,
     "refHigh": 4.0
    },
    {
     "code": "hiv_screen",
     "label": "HIV screen",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    },
    {
     "code": "hbsag",
     "label": "Hepatitis B surface antigen",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    },
    {
     "code": "hcv_ab",
     "label": "Hepatitis C antibody",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    }
   ]
  }
 }
}$json$::jsonb -> 'panels') p;
-- lab-panels-end

-- ---------------------------------------------------------------------------
-- 2. Results
-- ---------------------------------------------------------------------------
create table public.lab_result_files (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id),
  patient_id        uuid not null references public.profiles (id),
  file_path         text not null check (btrim(file_path) <> ''),
  original_filename text,
  mime_type         text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size_bytes   bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  uploaded_by       uuid references public.profiles (id),
  is_test           boolean not null default false,
  created_at        timestamptz not null default now()
);

create table public.lab_results (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id),
  patient_id        uuid not null references public.profiles (id),
  lab_order_id      uuid references public.lab_orders (id),
  partner_id        uuid references public.lab_providers (id),
  panel_code        text check (panel_code in ('essential', 'annual_health_check')),
  panel_version_id  uuid references public.lab_panel_versions (id),
  source            text not null check (source in ('portal_entry', 'pdf_upload', 'api')),
  submitted_by_kind text not null check (submitted_by_kind in ('partner', 'patient', 'tarragon_team')),
  submitted_by      uuid references public.profiles (id),
  received_at       timestamptz not null default now(),
  release_state     text not null default 'awaiting_review'
                    check (release_state in ('awaiting_review', 'released', 'clinician_disclosure_required', 'withheld')),
  release_reason    text,
  reviewed_by       uuid references public.profiles (id),
  reviewed_at       timestamptz,
  review_note       text,
  disclosure_method text check (disclosure_method in ('in_person', 'phone', 'video')),
  disclosure_attested boolean not null default false,
  released_at       timestamptz,
  withheld_reason   text,
  document_id       uuid references public.lab_result_files (id),
  superseded_by     uuid references public.lab_results (id),
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- a structured entry always names its panel version (INV-16)
  check (source <> 'portal_entry' or panel_version_id is not null),
  check (release_state <> 'released' or (released_at is not null and release_reason is not null)),
  check (release_state <> 'withheld' or withheld_reason is not null)
);
create index lab_results_patient_idx on public.lab_results (patient_id, received_at desc);
create index lab_results_held_idx on public.lab_results (release_state) where release_state in ('awaiting_review', 'clinician_disclosure_required');
create index lab_results_order_idx on public.lab_results (lab_order_id);

create table public.lab_result_items (
  id               uuid primary key default gen_random_uuid(),
  lab_result_id    uuid not null references public.lab_results (id),
  organisation_id  uuid not null references public.organisations (id),
  patient_id       uuid not null references public.profiles (id),
  analyte_code     text not null,
  value_numeric    numeric,
  value_text       text check (value_text in ('positive', 'negative')),
  unit             text not null,
  ref_low          numeric,
  ref_high         numeric,
  flag             text not null check (flag in ('normal', 'low', 'high', 'critical', 'positive', 'negative')),
  sensitive_positive boolean not null default false,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (lab_result_id, analyte_code),
  check ((value_numeric is not null) <> (value_text is not null)),
  check (not sensitive_positive or flag = 'positive')
);
create index lab_result_items_patient_idx on public.lab_result_items (patient_id);

-- Items are append only: a correction is a new result that supersedes the old one.
create function private.lab_result_items_append_only() returns trigger language plpgsql security definer set search_path = ''
as $$ begin raise exception 'lab_result_items_append_only' using errcode = '42501'; end; $$;
revoke all on function private.lab_result_items_append_only() from public, anon, authenticated;
create trigger lab_result_items_no_change before update or delete on public.lab_result_items
  for each row execute function private.lab_result_items_append_only();

-- The state machine (INV-03, INV-04). Every release passes through here, whoever or whatever writes the row.
create function private.guard_lab_result() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_bad integer; v_items integer;
begin
  if tg_op = 'INSERT' then
    if new.release_state not in ('awaiting_review', 'clinician_disclosure_required') then raise exception 'lab_result_must_start_held' using errcode = '42501'; end if;
    return new;
  end if;

  -- immutable facts
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.lab_order_id is distinct from old.lab_order_id or new.panel_version_id is distinct from old.panel_version_id
     or new.source is distinct from old.source or new.submitted_by is distinct from old.submitted_by
     or new.document_id is distinct from old.document_id or new.received_at is distinct from old.received_at then
    raise exception 'lab_result_immutable' using errcode = '42501';
  end if;
  new.updated_at := now();

  if new.release_state = old.release_state then
    -- the only thing that may change without a state change is a supersede link, set once
    if new.superseded_by is distinct from old.superseded_by and old.superseded_by is not null then
      raise exception 'lab_result_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.release_state in ('released', 'withheld') then
    raise exception 'lab_result_final' using errcode = '42501';
  end if;

  if new.release_state = 'released' then
    select count(*), count(*) filter (where flag not in ('normal', 'negative') or sensitive_positive)
      into v_items, v_bad from public.lab_result_items where lab_result_id = new.id;
    if old.release_state = 'clinician_disclosure_required' then
      if new.reviewed_by is null or not new.disclosure_attested or new.disclosure_method is null then
        raise exception 'lab_result_disclosure_needs_clinician' using errcode = '42501';
      end if;
      new.release_reason := 'disclosure_recorded';
    elsif new.release_reason = 'RES-001' then
      -- automatic release: only a complete, all-normal result
      if v_items = 0 or v_bad > 0 or new.source <> 'portal_entry' then
        raise exception 'lab_result_not_auto_releasable' using errcode = '42501';
      end if;
    else
      if new.reviewed_by is null then raise exception 'lab_result_release_needs_clinician' using errcode = '42501'; end if;
      new.release_reason := 'clinician_review';
    end if;
    new.released_at := coalesce(new.released_at, now());
  elsif new.release_state = 'withheld' then
    if new.reviewed_by is null or coalesce(btrim(new.withheld_reason), '') = '' then
      raise exception 'lab_result_withhold_needs_reason' using errcode = '42501';
    end if;
  else
    raise exception 'lab_result_bad_transition' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_lab_result() from public, anon, authenticated;
create trigger lab_results_guard before insert or update on public.lab_results
  for each row execute function private.guard_lab_result();

-- ---------------------------------------------------------------------------
-- 3. Events, task type, neutral notice
-- ---------------------------------------------------------------------------
-- Events: lab_result.received and lab_result.released were registered by S10 (owner S27, required key lab_result_id); reused as is.

-- task-types-s27-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('sensitive_result_disclosure', 1, 2, 120, 'senior_medical_officer', '{result_review}', 0, 30, false, true, '{}',
   'S27: a result that must be disclosed by a clinician in person (INV-04). Never pushed to a coordinator or explained by audio or AI.');
-- task-types-s27-end

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('lab_result_ready', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Something new is waiting in the app. Names no analyte, value or flag (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('lab_result_ready', 'en', 'in_app', 'Something is waiting for you', 'Your care team has added something to your health record. Open the app to see it.'),
  ('lab_result_ready', 'en', 'push', 'Something is waiting for you', 'Open the app to see it.')
on conflict (template_key, locale, channel) do nothing;

create function private.lab_notify(p_recipient uuid, p_org uuid, p_template text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (p_org, p_recipient, 'in_app', 'pending', p_template, coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke all on function private.lab_notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The classifier (the rule in section 4.4). Mirrors packages/clinical/src/lab-release.ts.
-- ---------------------------------------------------------------------------
create function private.classify_lab_result(p_panel_version uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_analytes jsonb;
  v_def jsonb;
  v_it jsonb;
  v_code text;
  v_unit text;
  v_num numeric;
  v_txt text;
  v_flag text;
  v_sens boolean;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_missing text[];
  v_state text;
  v_reason text;
  v_task text;
  v_any_sens boolean := false;
  v_any_crit boolean := false;
  v_any_abn boolean := false;
begin
  select analytes into v_analytes from public.lab_panel_versions where id = p_panel_version;
  if v_analytes is null then raise exception 'lab_unknown_panel' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'lab_value_missing' using errcode = '22023'; end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    v_code := v_it ->> 'analyte_code';
    select a into v_def from jsonb_array_elements(v_analytes) a where a ->> 'code' = v_code;
    if v_def is null then raise exception 'lab_unknown_analyte' using errcode = '22023'; end if;
    if v_code = any(v_seen) then raise exception 'lab_duplicate_analyte' using errcode = '22023'; end if;
    v_seen := v_seen || v_code;
    v_unit := coalesce(v_def ->> 'unit', '');
    if coalesce(v_it ->> 'unit', '') <> '' and (v_it ->> 'unit') <> v_unit then raise exception 'lab_unit_mismatch' using errcode = '22023'; end if;

    if v_def ->> 'kind' = 'numeric' then
      if v_it ->> 'value_numeric' is null then raise exception 'lab_value_missing' using errcode = '22023'; end if;
      v_num := (v_it ->> 'value_numeric')::numeric;
      if v_num < 0 or v_num > 1000000 then raise exception 'lab_value_out_of_bounds' using errcode = '22023'; end if;
      v_flag := case
        when (v_def ? 'criticalLow') and v_num < (v_def ->> 'criticalLow')::numeric then 'critical'
        when (v_def ? 'criticalHigh') and v_num > (v_def ->> 'criticalHigh')::numeric then 'critical'
        when (v_def ? 'refLow') and v_num < (v_def ->> 'refLow')::numeric then 'low'
        when (v_def ? 'refHigh') and v_num > (v_def ->> 'refHigh')::numeric then 'high'
        else 'normal' end;
      v_out := v_out || jsonb_build_object('analyte_code', v_code, 'value_numeric', v_num, 'unit', v_unit, 'flag', v_flag, 'sensitive_positive', false,
        'ref_low', v_def -> 'refLow', 'ref_high', v_def -> 'refHigh');
    else
      v_txt := lower(btrim(coalesce(v_it ->> 'value_text', '')));
      if v_txt = '' then raise exception 'lab_value_missing' using errcode = '22023'; end if;
      if v_txt not in ('positive', 'negative') then raise exception 'lab_value_not_recognised' using errcode = '22023'; end if;
      v_sens := v_txt = 'positive' and coalesce((v_def ->> 'sensitive')::boolean, false);
      v_flag := v_txt;
      v_out := v_out || jsonb_build_object('analyte_code', v_code, 'value_text', v_txt, 'unit', v_unit, 'flag', v_flag, 'sensitive_positive', v_sens,
        'ref_low', null, 'ref_high', null);
    end if;
    if v_sens then v_any_sens := true; end if;
    if v_flag = 'critical' then v_any_crit := true; end if;
    if v_flag not in ('normal', 'negative') then v_any_abn := true; end if;
    v_sens := false;
  end loop;

  select coalesce(array_agg(a ->> 'code'), '{}') into v_missing
    from jsonb_array_elements(v_analytes) a
   where not coalesce((a ->> 'optional')::boolean, false) and not ((a ->> 'code') = any(v_seen));

  if v_any_sens then v_state := 'clinician_disclosure_required'; v_reason := 'sensitive_positive'; v_task := 'sensitive_result_disclosure';
  elsif v_any_crit then v_state := 'awaiting_review'; v_reason := 'critical'; v_task := 'critical_result_review';
  elsif v_any_abn then v_state := 'awaiting_review'; v_reason := 'abnormal'; v_task := 'routine_result_review';
  elsif coalesce(array_length(v_missing, 1), 0) > 0 or jsonb_array_length(v_out) = 0 then v_state := 'awaiting_review'; v_reason := 'incomplete'; v_task := 'routine_result_review';
  else v_state := 'released'; v_reason := 'RES-001'; v_task := null;
  end if;

  return jsonb_build_object('release_state', v_state, 'reason', v_reason, 'task', v_task, 'items', v_out, 'missing', to_jsonb(v_missing));
end;
$$;
revoke all on function private.classify_lab_result(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The one writer
-- ---------------------------------------------------------------------------
create function private.submit_lab_result(
  p_patient uuid, p_order uuid, p_panel_code text, p_items jsonb, p_file jsonb, p_kind text, p_actor uuid, p_partner uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles%rowtype;
  v_ver public.lab_panel_versions%rowtype;
  v_class jsonb;
  v_file uuid;
  v_id uuid := gen_random_uuid();
  v_has_items boolean := p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
  v_source text;
  v_state text;
  v_reason text;
  v_task text;
  it jsonb;
  o public.lab_orders%rowtype;
begin
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'lab_patient_not_found' using errcode = '22023'; end if;

  if p_order is not null then
    select * into o from public.lab_orders where id = p_order and patient_id = p_patient;
    if not found then raise exception 'lab_order_not_found' using errcode = '22023'; end if;
    if o.status in ('pending_payment', 'cancelled') then raise exception 'lab_order_not_payable_state' using errcode = '22023'; end if;
  end if;

  if p_file is not null then
    insert into public.lab_result_files (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, uploaded_by, is_test)
    values (pr.organisation_id, p_patient, p_file ->> 'file_path', p_file ->> 'original_filename', p_file ->> 'mime_type',
            (p_file ->> 'file_size_bytes')::bigint, p_actor, pr.is_test)
    returning id into v_file;
  end if;

  if v_has_items then
    if p_panel_code is null then raise exception 'lab_panel_required' using errcode = '22023'; end if;
    select * into v_ver from public.lab_panel_versions where panel_code = p_panel_code and is_active;
    if not found then raise exception 'lab_unknown_panel' using errcode = '22023'; end if;
    v_class := private.classify_lab_result(v_ver.id, p_items);
    v_source := 'portal_entry';
    v_state := v_class ->> 'release_state'; v_reason := v_class ->> 'reason'; v_task := v_class ->> 'task';
  else
    if v_file is null then raise exception 'lab_nothing_to_record' using errcode = '22023'; end if;
    v_source := 'pdf_upload';
    v_state := 'awaiting_review'; v_reason := 'pdf_only'; v_task := 'routine_result_review';
  end if;

  -- always inserted held; the guard allows the one automatic step below
  insert into public.lab_results (id, organisation_id, patient_id, lab_order_id, partner_id, panel_code, panel_version_id, source,
                                  submitted_by_kind, submitted_by, release_state, release_reason, document_id, is_test)
  values (v_id, pr.organisation_id, p_patient, p_order, p_partner, case when v_has_items then p_panel_code end,
          case when v_has_items then v_ver.id end, v_source, p_kind, p_actor,
          case when v_state = 'clinician_disclosure_required' then v_state else 'awaiting_review' end, v_reason, v_file, pr.is_test);

  if v_has_items then
    for it in select * from jsonb_array_elements(v_class -> 'items') loop
      insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit,
                                           ref_low, ref_high, flag, sensitive_positive, is_test)
      values (v_id, pr.organisation_id, p_patient, it ->> 'analyte_code', (it ->> 'value_numeric')::numeric, it ->> 'value_text', it ->> 'unit',
              (it ->> 'ref_low')::numeric, (it ->> 'ref_high')::numeric, it ->> 'flag', (it ->> 'sensitive_positive')::boolean, pr.is_test);
    end loop;
  end if;

  -- the one automatic step; the guard re-checks every item before it allows it
  if v_state = 'released' then
    update public.lab_results set release_state = 'released', release_reason = 'RES-001' where id = v_id;
  end if;

  if p_order is not null then
    -- 'resulted' is what the older triggers act on (timeline, rewards), so a held result moves the order only to 'processing'
    update public.lab_orders
       set panel_code = coalesce(panel_code, case when v_has_items then p_panel_code end),
           status = case when status in ('resulted', 'cancelled') then status
                         when v_state = 'released' then 'resulted'::public.lab_order_status
                         else 'processing'::public.lab_order_status end,
           resulted_at = case when v_state = 'released' then coalesce(resulted_at, now()) else resulted_at end
     where id = p_order;
  end if;

  if v_task is not null then
    perform private.create_clinical_task(p_patient, v_task, null, 'lab_result:' || v_id);
  end if;

  perform private.emit_domain_event('lab_result.received', pr.organisation_id, jsonb_build_object('lab_result_id', v_id),
    'lab_result_received:' || v_id, p_patient, 'lab_result', v_id);
  perform private.log_audit('lab_result.submitted', 'lab_results', v_id,
    jsonb_build_object('kind', p_kind, 'source', v_source, 'state', v_state, 'reason', v_reason));

  if v_state = 'released' then
    perform private.lab_notify(p_patient, pr.organisation_id, 'lab_result_ready', jsonb_build_object('lab_result_id', v_id));
    perform private.emit_domain_event('lab_result.released', pr.organisation_id, jsonb_build_object('lab_result_id', v_id),
      'lab_result_released:' || v_id, p_patient, 'lab_result', v_id);
    perform private.log_audit('lab_result.released', 'lab_results', v_id, jsonb_build_object('reason', 'RES-001'));
  end if;

  return jsonb_build_object('lab_result_id', v_id, 'release_state', v_state, 'reason', v_reason);
end;
$$;
revoke all on function private.submit_lab_result(uuid, uuid, text, jsonb, jsonb, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Partner (laboratory) functions: own provider, own orders only
-- ---------------------------------------------------------------------------
create function public.lab_partner_portal_orders() returns table (
  order_id uuid, order_number text, partner_reference text, status text, panel_code text, patient_name text, patient_number text,
  ordered_at timestamptz, sample_collected_at timestamptz, result_received boolean)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.order_number, o.partner_reference, o.status::text, o.panel_code, p.full_name, p.patient_number, o.ordered_at, o.sample_collected_at,
         exists (select 1 from public.lab_results r where r.lab_order_id = o.id)
    from public.lab_orders o join public.profiles p on p.id = o.patient_id
   where private.lab_partner_provider() is not null and o.provider_id = private.lab_partner_provider()
     and o.status not in ('pending_payment', 'cancelled')
   order by o.ordered_at desc;
$$;

create function public.lab_partner_mark_collected(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.lab_orders%rowtype;
begin
  select * into o from public.lab_orders where id = p_order and provider_id = private.lab_partner_provider();
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;
  if o.status not in ('payment_confirmed', 'ordered') then raise exception 'lab_order_not_collectable' using errcode = '22023'; end if;
  update public.lab_orders set status = 'sample_collected', sample_collected_at = coalesce(sample_collected_at, now()) where id = p_order;
  perform private.log_audit('lab_order.collected', 'lab_orders', p_order, '{}'::jsonb);
end;
$$;

create function public.lab_panel_definition(p_panel text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('panel_code', v.panel_code, 'version', v.version, 'analytes', v.analytes)
    from public.lab_panel_versions v
   where v.panel_code = p_panel and v.is_active
     and (select auth.uid()) is not null
     and (private.lab_partner_provider() is not null
          or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role in ('clinician', 'admin', 'lab_liaison')));
$$;

create function public.lab_partner_submit_result(p_order uuid, p_panel text, p_items jsonb, p_file jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare o public.lab_orders%rowtype; v_provider uuid := private.lab_partner_provider();
begin
  if v_provider is null then raise exception 'This action is for partner labs' using errcode = '42501'; end if;
  select * into o from public.lab_orders where id = p_order and provider_id = v_provider;
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;
  if exists (select 1 from public.lab_results r where r.lab_order_id = p_order and r.release_state <> 'withheld' and r.superseded_by is null) then
    raise exception 'lab_result_already_received' using errcode = '22023';
  end if;
  return private.submit_lab_result(o.patient_id, p_order, coalesce(o.panel_code, p_panel), p_items, p_file, 'partner', (select auth.uid()), v_provider);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Patient and Tarragon team entries
-- ---------------------------------------------------------------------------
create function public.patient_add_lab_result(p_file jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if v is null or not exists (select 1 from public.profiles where id = v and role = 'patient') then
    raise exception 'This action is for patients' using errcode = '42501';
  end if;
  return private.submit_lab_result(v, null, null, null, p_file, 'patient', v, null);
end;
$$;

create function public.team_submit_lab_result(p_patient uuid, p_order uuid, p_panel text, p_items jsonb, p_file jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); r public.user_role;
begin
  select role into r from public.profiles where id = v;
  if r is null or r not in ('admin', 'lab_liaison', 'clinician') then raise exception 'This action is for the care team' using errcode = '42501'; end if;
  if not private.is_org_staff((select organisation_id from public.profiles where id = p_patient)) and r <> 'lab_liaison' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if r = 'clinician' and not private.clinician_has_patient_access(p_patient) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r = 'lab_liaison' and (select organisation_id from public.profiles where id = p_patient) is distinct from private.current_org_id() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return private.submit_lab_result(p_patient, p_order, p_panel, p_items, p_file, 'tarragon_team', v, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Clinician: queue, audited read, release, disclosure, withhold
-- ---------------------------------------------------------------------------
create function private.lab_review_actor(p_result uuid, p_need_senior boolean) returns public.lab_results
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; v uuid := (select auth.uid());
begin
  select * into r from public.lab_results where id = p_result;
  if not found then raise exception 'lab_result_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = v and role = 'clinician') or not private.clinician_is_eligible(v) then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  if not private.clinician_has_patient_access(r.patient_id) then
    perform private.audit_chart_read(r.patient_id, array['lab_results'], 'lab result action', 'denied');
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_need_senior and not exists (select 1 from public.clinical_staff cs where cs.profile_id = v and cs.active
        and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')) then
    raise exception 'lab_disclosure_needs_senior_clinician' using errcode = '42501';
  end if;
  return r;
end;
$$;
revoke all on function private.lab_review_actor(uuid, boolean) from public, anon, authenticated;


create function private.lab_order_resulted(p_order uuid) returns void language sql security definer set search_path = ''
as $$ update public.lab_orders set status = 'resulted', resulted_at = coalesce(resulted_at, now())
       where id = p_order and status not in ('resulted', 'cancelled'); $$;
revoke all on function private.lab_order_resulted(uuid) from public, anon, authenticated;

create function public.lab_results_review_queue() returns table (lab_result_id uuid, patient_id uuid, release_state text, release_reason text, received_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.patient_id, r.release_state, r.release_reason, r.received_at
    from public.lab_results r
   where r.release_state in ('awaiting_review', 'clinician_disclosure_required')
     and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'clinician')
     and private.clinician_has_patient_access(r.patient_id)
   order by (r.release_state = 'clinician_disclosure_required') desc, r.received_at;
$$;

create function public.lab_result_for_review(p_result uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; f public.lab_result_files%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  r := private.lab_review_actor(p_result, false);
  perform private.audit_chart_read(r.patient_id, array['lab_results'], p_reason, 'success');
  select * into f from public.lab_result_files where id = r.document_id;
  return jsonb_build_object(
    'lab_result_id', r.id, 'patient_id', r.patient_id, 'release_state', r.release_state, 'release_reason', r.release_reason,
    'panel_code', r.panel_code, 'received_at', r.received_at, 'submitted_by_kind', r.submitted_by_kind,
    'file_path', f.file_path,
    'items', coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric, 'value_text', i.value_text,
        'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'sensitive_positive', i.sensitive_positive) order by i.analyte_code)
        from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb));
end;
$$;

create function public.release_lab_result(p_result uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, false);
  if r.release_state <> 'awaiting_review' then raise exception 'lab_result_not_awaiting_review' using errcode = '22023'; end if;
  update public.lab_results set release_state = 'released', reviewed_by = (select auth.uid()), reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_result;
  perform private.lab_order_resulted(r.lab_order_id);
  perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_ready', jsonb_build_object('lab_result_id', p_result));
  perform private.emit_domain_event('lab_result.released', r.organisation_id, jsonb_build_object('lab_result_id', p_result),
    'lab_result_released:' || p_result, r.patient_id, 'lab_result', p_result);
  perform private.log_audit('lab_result.released', 'lab_results', p_result, jsonb_build_object('reason', 'clinician_review'));
end;
$$;

create function public.record_lab_disclosure(p_result uuid, p_method text, p_attested boolean, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, true);
  if r.release_state <> 'clinician_disclosure_required' then raise exception 'lab_result_not_for_disclosure' using errcode = '22023'; end if;
  if p_method not in ('in_person', 'phone', 'video') or p_attested is not true then
    raise exception 'lab_disclosure_needs_attestation' using errcode = '22023';
  end if;
  update public.lab_results set release_state = 'released', reviewed_by = (select auth.uid()), reviewed_at = now(), disclosure_method = p_method,
         disclosure_attested = true, review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_result;
  perform private.lab_order_resulted(r.lab_order_id);
  -- the content was disclosed by a person; the notice is the same neutral one and names nothing
  perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_ready', jsonb_build_object('lab_result_id', p_result));
  perform private.emit_domain_event('lab_result.released', r.organisation_id, jsonb_build_object('lab_result_id', p_result),
    'lab_result_released:' || p_result, r.patient_id, 'lab_result', p_result);
  perform private.log_audit('lab_result.disclosed', 'lab_results', p_result, jsonb_build_object('method', p_method));
end;
$$;

create function public.withhold_lab_result(p_result uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, false);
  if r.release_state not in ('awaiting_review', 'clinician_disclosure_required') then raise exception 'lab_result_final' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  update public.lab_results set release_state = 'withheld', reviewed_by = (select auth.uid()), reviewed_at = now(), withheld_reason = btrim(p_reason)
   where id = p_result;
  perform private.log_audit('lab_result.withheld', 'lab_results', p_result, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Patient reads
-- ---------------------------------------------------------------------------
create function public.my_lab_results() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'received_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'lab_result_id', r.id, 'received_at', r.received_at, 'panel_code', r.panel_code, 'own_upload', r.submitted_by_kind = 'patient',
      -- the only thing a patient learns about a held result is that it is being looked at
      'status', case r.release_state when 'released' then 'released' when 'withheld' then 'under_review' when 'clinician_disclosure_required' then 'care_team_will_contact' else 'under_review' end,
      'explain_allowed', r.release_state = 'released' and not exists (select 1 from public.lab_result_items i where i.lab_result_id = r.id and i.sensitive_positive)
                         and r.submitted_by_kind <> 'patient',
      'has_file', r.document_id is not null and (r.release_state = 'released' or r.submitted_by_kind = 'patient'),
      'items', case when r.release_state = 'released' then coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric,
          'value_text', i.value_text, 'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag) order by i.analyte_code)
          from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb) else '[]'::jsonb end) as x
    from public.lab_results r
   where r.patient_id = (select auth.uid()) and r.release_state <> 'withheld'
  ) s;
$$;

create function public.lab_result_file_path(p_result uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select f.file_path from public.lab_results r join public.lab_result_files f on f.id = r.document_id
   where r.id = p_result and r.patient_id = (select auth.uid())
     and (r.release_state = 'released' or r.submitted_by_kind = 'patient');
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.lab_panel_versions enable row level security;
alter table public.lab_result_files enable row level security;
alter table public.lab_results enable row level security;
alter table public.lab_result_items enable row level security;

create policy lab_panel_versions_read on public.lab_panel_versions for select to authenticated using (true);
-- INV-03: a patient reads only released rows (and the row of a file they added themselves). Staff read through the audited functions.
create policy lab_results_patient_read on public.lab_results for select to authenticated
  using (patient_id = (select auth.uid()) and (release_state = 'released' or submitted_by_kind = 'patient'));
create policy lab_result_items_patient_read on public.lab_result_items for select to authenticated
  using (patient_id = (select auth.uid()) and exists (select 1 from public.lab_results r where r.id = lab_result_id and r.release_state = 'released'));

revoke all on public.lab_panel_versions, public.lab_result_files, public.lab_results, public.lab_result_items from public, anon, authenticated;
grant select on public.lab_panel_versions, public.lab_results, public.lab_result_items to authenticated;

revoke all on function
  public.lab_partner_portal_orders(), public.lab_partner_mark_collected(uuid), public.lab_panel_definition(text),
  public.lab_partner_submit_result(uuid, text, jsonb, jsonb), public.patient_add_lab_result(jsonb),
  public.team_submit_lab_result(uuid, uuid, text, jsonb, jsonb), public.lab_results_review_queue(),
  public.lab_result_for_review(uuid, text), public.release_lab_result(uuid, text), public.record_lab_disclosure(uuid, text, boolean, text),
  public.withhold_lab_result(uuid, text), public.my_lab_results(), public.lab_result_file_path(uuid)
  from public, anon;
grant execute on function
  public.lab_partner_portal_orders(), public.lab_partner_mark_collected(uuid), public.lab_panel_definition(text),
  public.lab_partner_submit_result(uuid, text, jsonb, jsonb), public.patient_add_lab_result(jsonb),
  public.team_submit_lab_result(uuid, uuid, text, jsonb, jsonb), public.lab_results_review_queue(),
  public.lab_result_for_review(uuid, text), public.release_lab_result(uuid, text), public.record_lab_disclosure(uuid, text, boolean, text),
  public.withhold_lab_result(uuid, text), public.my_lab_results(), public.lab_result_file_path(uuid)
  to authenticated;

-- private bucket: no policy for any signed-in role. Files are written and signed by the server with the service role,
-- after lab_result_file_path / lab_result_for_review has checked the caller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lab-results', 'lab-results', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.lab_results', 'select') or has_table_privilege('authenticated', 'public.lab_result_files', 'select')
     or has_table_privilege('authenticated', 'public.lab_results', 'insert') then
    raise exception 'S27 self-check: table grants too wide';
  end if;
  if has_function_privilege('anon', 'public.my_lab_results()', 'execute') or has_function_privilege('anon', 'public.release_lab_result(uuid, text)', 'execute') then
    raise exception 'S27 self-check: anon can execute a lab function';
  end if;
  if (select count(*) from public.lab_panel_versions where is_active) <> 2 then raise exception 'S27 self-check: panels not seeded'; end if;
end $$;
