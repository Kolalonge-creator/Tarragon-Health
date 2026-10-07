-- S27d: follow-ups decided 2026-10-06 ("fix all").
--  1. CMO sign-off of the lab ranges (OQ-176): lab_panel_signoffs (the shared governed-config shape) and sign_lab_panels().
--     Until it is signed NOTHING auto-releases: every result is held for a clinician (INV-14, fail closed).
--  2. Competitor research changes 1 to 4 (docs/research/S27-competitors.md):
--     a. bounded fallback for a held sensitive result: attempts are recorded; after the configured number, or after the
--        configured hours with no release, the CMO is told through an incident. It is never released by default.
--     b. one neutral "under review" state for every held result, with an expected time read from escalation_slas.
--     c. corrections are first class: a new result that names what it replaces, with a kind and a reason, goes back through the
--        same gate; the old one is marked replaced only when the new one is released; a clinician can withdraw a released result.
--     d. wording only (screening, not diagnosis): handled in the screens and strings, not here.
--  3. The staff emailed-result path (and any other writer into lab_result_documents) can no longer show a result to a patient
--     before a clinician has reviewed it: the patient policy hides non-patient documents until reviewed, and the insert
--     trigger no longer announces them. Live rows in lab_result_documents before this migration: 0, so there is no data step.
--  4. Explain gate: a replaced or withdrawn result may never be explained.

-- 1. -------------------------------------------------------------------------------------------------------------------
create table public.lab_panel_signoffs (
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
create unique index lab_panel_signoffs_one_active on public.lab_panel_signoffs (is_active) where is_active;

-- lab-config-begin
insert into public.lab_panel_signoffs (version, is_active, config, notes)
values (1, true, $json${
 "disclosure": {
  "maxAttempts": 3,
  "escalateAfterHours": 72
 },
 "expectedFromSla": {
  "pathway": "screening_abnormal_result",
  "tier": "urgent_escalation",
  "fallbackMinutes": 1440
 }
}$json$::jsonb,
        'Covers the ranges and critical limits in lab_panel_versions v1 and the disclosure policy. PROPOSED, unsigned: sign_lab_panels() by the CMO. Until then no result auto-releases.');
-- lab-config-end

create function private.lab_panels_signed() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.lab_panel_signoffs where is_active and approved_by is not null); $$;
revoke all on function private.lab_panels_signed() from public, anon, authenticated;

create function private.lab_config(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config -> p_key from public.lab_panel_signoffs where is_active; $$;
revoke all on function private.lab_config(text) from public, anon, authenticated;

create function public.sign_lab_panels(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.lab_panel_signoffs where id = p_id) then raise exception 'Lab panel sign-off version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the lab panels'; end if;
  update public.lab_panel_signoffs set is_active = false where is_active and id <> p_id;
  update public.lab_panel_signoffs set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('lab_panels.signed', 'lab_panel_signoffs', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_lab_panels(uuid) from public, anon;
grant execute on function public.sign_lab_panels(uuid) to authenticated;

alter table public.lab_panel_signoffs enable row level security;
create policy lab_panel_signoffs_read on public.lab_panel_signoffs for select to authenticated using (true);
revoke all on public.lab_panel_signoffs from public, anon, authenticated;
grant select on public.lab_panel_signoffs to authenticated;

-- 2c. columns for corrections and withdrawals ---------------------------------------------------------------------------
alter table public.lab_results
  add column corrects_result_id uuid references public.lab_results (id),
  add column correction_kind text check (correction_kind in ('corrected', 'amended', 'appended')),
  add column correction_reason text,
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references public.profiles (id),
  add column withdrawn_reason text,
  add column disclosure_escalated_at timestamptz,
  add constraint lab_results_correction_complete
    check ((corrects_result_id is null) = (correction_kind is null) and (corrects_result_id is null or coalesce(btrim(correction_reason), '') <> ''));
create index lab_results_corrects_idx on public.lab_results (corrects_result_id) where corrects_result_id is not null;


-- the state machine, with the correction and withdrawal fields
create or replace function private.guard_lab_result() returns trigger language plpgsql security definer set search_path = ''
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
     or new.document_id is distinct from old.document_id or new.received_at is distinct from old.received_at
     or new.corrects_result_id is distinct from old.corrects_result_id or new.correction_kind is distinct from old.correction_kind
     or new.correction_reason is distinct from old.correction_reason then
    raise exception 'lab_result_immutable' using errcode = '42501';
  end if;
  new.updated_at := now();

  if new.release_state = old.release_state then
    -- the only thing that may change without a state change is a supersede link, set once
    if new.superseded_by is distinct from old.superseded_by and old.superseded_by is not null then
      raise exception 'lab_result_immutable' using errcode = '42501';
    end if;
    -- a withdrawal is recorded once, on a released result, with a reason and the clinician who did it
    if new.withdrawn_at is distinct from old.withdrawn_at then
      if old.withdrawn_at is not null or old.release_state <> 'released' or new.withdrawn_by is null or coalesce(btrim(new.withdrawn_reason), '') = '' then
        raise exception 'lab_result_withdraw_invalid' using errcode = '42501';
      end if;
    elsif new.withdrawn_by is distinct from old.withdrawn_by or new.withdrawn_reason is distinct from old.withdrawn_reason then
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
      if v_items = 0 or v_bad > 0 or new.source <> 'portal_entry' or old.release_reason is distinct from 'RES-001' then
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



-- the one writer, with corrections and the unsigned-ranges rule
drop function private.submit_lab_result(uuid, uuid, text, jsonb, jsonb, text, uuid, uuid);
create function private.submit_lab_result(
  p_patient uuid, p_order uuid, p_panel_code text, p_items jsonb, p_file jsonb, p_kind text, p_actor uuid, p_partner uuid,
  p_corrects uuid default null, p_correction_kind text default null, p_correction_reason text default null
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

  -- a correction names the result it replaces, says what kind of change it is and why; the old one must belong to this patient,
  -- be released and not already replaced. The correction then goes through the same gate as any new result (S27d).
  if p_corrects is not null then
    if p_correction_kind not in ('corrected', 'amended', 'appended') or coalesce(btrim(p_correction_reason), '') = '' then
      raise exception 'lab_correction_needs_kind_and_reason' using errcode = '22023';
    end if;
    if not exists (select 1 from public.lab_results r where r.id = p_corrects and r.patient_id = p_patient
                    and r.release_state = 'released' and r.superseded_by is null and r.withdrawn_at is null) then
      raise exception 'lab_correction_target_invalid' using errcode = '22023';
    end if;
  end if;

  if p_order is not null then
    select * into o from public.lab_orders where id = p_order and patient_id = p_patient;
    if not found then raise exception 'lab_order_not_found' using errcode = '22023'; end if;
    if o.status in ('pending_payment', 'cancelled') then raise exception 'lab_order_not_payable_state' using errcode = '22023'; end if;
  end if;

  if p_file is not null then
    -- a file path must sit in this patient's own folder: nobody can attach another patient's file to a result
    if (p_file ->> 'file_path') is null or (p_file ->> 'file_path') not like p_patient::text || '/%' or (p_file ->> 'file_path') like '%..%' then
      raise exception 'lab_file_path_invalid' using errcode = '22023';
    end if;
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

  -- Ranges that no CMO has signed never auto-release anything (INV-14): the result is held for a clinician instead.
  if v_state = 'released' and not private.lab_panels_signed() then
    v_state := 'awaiting_review'; v_reason := 'ranges_not_signed'; v_task := 'routine_result_review';
  end if;

  -- always inserted held; the guard allows the one automatic step below
  insert into public.lab_results (id, organisation_id, patient_id, lab_order_id, partner_id, panel_code, panel_version_id, source,
                                  submitted_by_kind, submitted_by, release_state, release_reason, document_id, is_test,
                                  corrects_result_id, correction_kind, correction_reason)
  values (v_id, pr.organisation_id, p_patient, p_order, p_partner, case when v_has_items then p_panel_code end,
          case when v_has_items then v_ver.id end, v_source, p_kind, p_actor,
          case when v_state = 'clinician_disclosure_required' then v_state else 'awaiting_review' end, v_reason, v_file, pr.is_test,
          p_corrects, p_correction_kind, btrim(p_correction_reason));

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

  -- Tarragon Free consumes no doctor time: a patient's own outside upload on no order reaches a clinician only for a Member.
  -- It stays held either way and is never visible as reviewed.
  if v_task is not null and not (p_kind = 'patient' and p_order is null and not private.patient_is_member(p_patient)) then
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
revoke all on function private.submit_lab_result(uuid, uuid, text, jsonb, jsonb, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- 2c. corrections -----------------------------------------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('lab_result_corrected', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Something in your record was updated. Names no analyte, value or flag (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('lab_result_corrected', 'en', 'in_app', 'An update to your record', 'Your care team has updated something in your health record. Open the app to see what changed.'),
  ('lab_result_corrected', 'en', 'push', 'An update to your record', 'Open the app to see what changed.')
on conflict (template_key, locale, channel) do nothing;

-- When a correcting result is released (automatically or by a clinician) the one it replaces is marked replaced, once.
create function private.lab_apply_correction() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.lab_results set superseded_by = new.id where id = new.corrects_result_id and superseded_by is null;
  perform private.lab_notify(new.patient_id, new.organisation_id, 'lab_result_corrected', jsonb_build_object('lab_result_id', new.id));
  perform private.log_audit('lab_result.replaced', 'lab_results', new.corrects_result_id,
    jsonb_build_object('by', new.id, 'kind', new.correction_kind));
  return null;
end;
$$;
revoke all on function private.lab_apply_correction() from public, anon, authenticated;
create trigger lab_results_apply_correction after update of release_state on public.lab_results
  for each row when (new.release_state = 'released' and old.release_state <> 'released' and new.corrects_result_id is not null)
  execute function private.lab_apply_correction();

create function public.lab_partner_submit_correction(p_order uuid, p_corrects uuid, p_kind text, p_reason text, p_panel text, p_items jsonb, p_file jsonb default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o public.lab_orders%rowtype; v_provider uuid := private.lab_partner_provider();
begin
  if v_provider is null then raise exception 'This action is for partner labs' using errcode = '42501'; end if;
  select * into o from public.lab_orders where id = p_order and provider_id = v_provider;
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;
  if not exists (select 1 from public.lab_results r where r.id = p_corrects and r.lab_order_id = p_order) then
    raise exception 'lab_correction_target_invalid' using errcode = '22023';
  end if;
  return private.submit_lab_result(o.patient_id, p_order, coalesce(o.panel_code, p_panel), p_items, p_file, 'partner', (select auth.uid()), v_provider,
                                   p_corrects, p_kind, p_reason);
end;
$$;

create function public.withdraw_lab_result(p_result uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype;
begin
  r := private.lab_review_actor(p_result, true);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  if r.release_state <> 'released' or r.withdrawn_at is not null then raise exception 'lab_result_not_withdrawable' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  update public.lab_results set withdrawn_at = now(), withdrawn_by = (select auth.uid()), withdrawn_reason = btrim(p_reason) where id = p_result;
  perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_corrected', jsonb_build_object('lab_result_id', p_result));
  perform private.log_audit('lab_result.withdrawn', 'lab_results', p_result, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;

-- patient visibility and the explain gate: a withdrawn result is gone from the patient, a replaced one is never explained
drop policy lab_results_patient_read on public.lab_results;
create policy lab_results_patient_read on public.lab_results for select to authenticated
  using (patient_id = (select auth.uid()) and withdrawn_at is null
         and (release_state = 'released' or (submitted_by_kind = 'patient' and release_state <> 'withheld')));
drop policy lab_result_items_patient_read on public.lab_result_items;
create policy lab_result_items_patient_read on public.lab_result_items for select to authenticated
  using (patient_id = (select auth.uid())
         and exists (select 1 from public.lab_results r where r.id = lab_result_id and r.release_state = 'released' and r.withdrawn_at is null));

create or replace function private.lab_result_explainable(p_result uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
         and r.submitted_by_kind <> 'patient'
         and not exists (select 1 from public.lab_result_items i where i.lab_result_id = r.id and i.sensitive_positive)
    from public.lab_results r where r.id = p_result;
$$;

create or replace function public.lab_result_file_path(p_result uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select f.file_path from public.lab_results r join public.lab_result_files f on f.id = r.document_id
   where r.id = p_result and r.patient_id = (select auth.uid()) and r.withdrawn_at is null
     and (r.release_state = 'released' or r.submitted_by_kind = 'patient');
$$;

-- 2b. one neutral waiting state and an expected time -------------------------------------------------------------------------
create function private.lab_expected_minutes() returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select (c ->> 'sla_minutes')::integer
       from public.escalation_slas s, jsonb_array_elements(s.config) c
      where s.is_active and c ->> 'pathway' = (private.lab_config('expectedFromSla') ->> 'pathway')
        and c ->> 'tier' = (private.lab_config('expectedFromSla') ->> 'tier') limit 1),
    (private.lab_config('expectedFromSla') ->> 'fallbackMinutes')::integer, 1440);
$$;
revoke all on function private.lab_expected_minutes() from public, anon, authenticated;

create or replace function public.my_lab_results() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'received_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'lab_result_id', r.id, 'received_at', r.received_at, 'panel_code', r.panel_code, 'own_upload', r.submitted_by_kind = 'patient',
      -- every held result looks the same to the patient (no hint of which one is sensitive or abnormal)
      'status', case when r.release_state = 'released' then 'released' else 'under_review' end,
      'expected_by', case when r.release_state = 'released' then null else r.received_at + make_interval(mins => private.lab_expected_minutes()) end,
      'explain_allowed', coalesce(private.lab_result_explainable(r.id), false),
      'replaced', r.superseded_by is not null,
      'correction_kind', r.correction_kind,
      'has_file', r.document_id is not null and (r.release_state = 'released' or r.submitted_by_kind = 'patient'),
      'items', case when r.release_state = 'released' then coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric,
          'value_text', i.value_text, 'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'sensitive_positive', i.sensitive_positive) order by i.analyte_code)
          from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb) else '[]'::jsonb end) as x
    from public.lab_results r
   where r.patient_id = (select auth.uid()) and r.release_state <> 'withheld' and r.withdrawn_at is null
  ) s;
$$;

-- 2a. bounded fallback for a held sensitive result ---------------------------------------------------------------------------
create table public.lab_disclosure_attempts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  lab_result_id   uuid not null references public.lab_results (id),
  attempted_by    uuid not null references public.profiles (id),
  attempted_at    timestamptz not null default now(),
  outcome         text not null check (outcome in ('no_answer', 'wrong_number', 'asked_to_call_back', 'declined_to_hear', 'other')),
  note            text check (note is null or char_length(note) <= 500),
  is_test         boolean not null default false
);
create index lab_disclosure_attempts_result_idx on public.lab_disclosure_attempts (lab_result_id, attempted_at);
alter table public.lab_disclosure_attempts enable row level security;
revoke all on public.lab_disclosure_attempts from public, anon, authenticated;

create function private.lab_escalate_disclosure(p_result uuid, p_why text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; v_ref text := 'lab-disclosure:' || p_result;
begin
  select * into r from public.lab_results where id = p_result;
  if r.id is null or r.release_state <> 'clinician_disclosure_required' or r.disclosure_escalated_at is not null then return; end if;
  update public.lab_results set disclosure_escalated_at = now() where id = p_result;
  -- The incident names no patient, analyte or result (INV-07): only the id of the held item.
  insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
  values (r.organisation_id, 'clinical', 'sev2', 'A held result still needs a personal disclosure',
          'Result ' || p_result || ' needs a clinician to tell the patient in person and has not been released: ' || p_why ||
          '. It is never released by default. The CMO decides how to reach the patient.',
          v_ref, now() + interval '4 hours', now() + interval '24 hours');
  perform private.log_audit('lab_result.disclosure_escalated', 'lab_results', p_result, jsonb_build_object('why', p_why));
end;
$$;
revoke all on function private.lab_escalate_disclosure(uuid, text) from public, anon, authenticated;

create function public.record_lab_disclosure_attempt(p_result uuid, p_outcome text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; n integer; v_max integer := coalesce((private.lab_config('disclosure') ->> 'maxAttempts')::integer, 3);
begin
  r := private.lab_review_actor(p_result, true);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  if r.release_state <> 'clinician_disclosure_required' then raise exception 'lab_result_not_for_disclosure' using errcode = '22023'; end if;
  insert into public.lab_disclosure_attempts (organisation_id, lab_result_id, attempted_by, outcome, note, is_test)
  values (r.organisation_id, p_result, (select auth.uid()), p_outcome, nullif(btrim(coalesce(p_note, '')), ''), r.is_test);
  select count(*) into n from public.lab_disclosure_attempts where lab_result_id = p_result;
  if n >= v_max then perform private.lab_escalate_disclosure(p_result, n || ' attempts to reach the patient have not succeeded'); end if;
  perform private.log_audit('lab_result.disclosure_attempt', 'lab_results', p_result, jsonb_build_object('outcome', p_outcome, 'attempt', n));
  return jsonb_build_object('ok', true, 'attempts', n, 'escalated', n >= v_max);
end;
$$;

create function private.lab_disclosure_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_hours integer := coalesce((private.lab_config('disclosure') ->> 'escalateAfterHours')::integer, 72); n integer := 0;
begin
  for r in select id from public.lab_results
            where release_state = 'clinician_disclosure_required' and disclosure_escalated_at is null
              and received_at < now() - make_interval(hours => v_hours) loop
    perform private.lab_escalate_disclosure(r.id, 'no disclosure within ' || v_hours || ' hours');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.lab_disclosure_sweep() from public, anon, authenticated;
select cron.schedule('lab-disclosure-sweep', '17 * * * *', $$select private.lab_disclosure_sweep();$$);

-- 3. the older document table can no longer show a result before review ---------------------------------------------------------
drop policy lab_result_documents_select on public.lab_result_documents;
create policy lab_result_documents_select on public.lab_result_documents for select to authenticated
  using ((patient_id = (select auth.uid()) and (source = 'patient' or reviewed_at is not null))
         or private.is_org_staff(organisation_id)
         or (private.is_lab_liaison() and organisation_id = private.current_org_id()));

create or replace function private.handle_lab_result_document()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
  v_order_status public.lab_order_status;
begin
  if (select auth.uid()) is not null then new.uploaded_by := (select auth.uid()); end if;
  new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;

  if new.lab_order_id is not null then
    select status into v_order_status from public.lab_orders where id = new.lab_order_id;
    v_has_review_access := v_order_status is not null and v_order_status not in ('pending_payment', 'cancelled');
  else
    v_has_review_access := exists (select 1 from public.programme_purchases pp where pp.patient_id = new.patient_id and pp.status = 'active' and pp.ends_at >= current_date);
  end if;

  if v_has_review_access then
    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (new.organisation_id, new.patient_id, 'clinician_review', 'open', 'Lab result document uploaded — review needed',
      format('A lab result document was uploaded (%s)%s. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)',
        new.source, case when new.note is not null and length(btrim(new.note)) > 0 then format(' — %s', new.note) else '' end), 2)
    returning id into v_alert_id;
    new.clinician_alert_id := v_alert_id;
  else
    new.clinician_alert_id := null;
  end if;

  -- S27d (INV-03): the patient is NOT told on upload for a document someone else supplied. The older path announced it at once,
  -- before any clinician had looked. The document is also hidden from the patient until reviewed (policy above).

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.uploaded_by, 'lab_result_document.uploaded', 'lab_result_documents', new.id,
          jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id, 'review_gated_by_purchase', not v_has_review_access));
  return new;
end;
$$;

-- the partner portal addresses a correction to the latest result of an order (an id only: the partner never sees its state)
drop function public.lab_partner_portal_orders();
create function public.lab_partner_portal_orders() returns table (
  order_id uuid, order_number text, partner_reference text, status text, panel_code text, patient_name text, patient_number text,
  ordered_at timestamptz, sample_collected_at timestamptz, result_received boolean, latest_result_id uuid)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.order_number, o.partner_reference, o.status::text, o.panel_code, p.full_name, p.patient_number, o.ordered_at, o.sample_collected_at,
         exists (select 1 from public.lab_results r where r.lab_order_id = o.id),
         (select r.id from public.lab_results r where r.lab_order_id = o.id and r.release_state <> 'withheld' and r.superseded_by is null and r.withdrawn_at is null
           order by r.received_at desc limit 1)
    from public.lab_orders o join public.profiles p on p.id = o.patient_id
   where private.lab_partner_provider() is not null and o.provider_id = private.lab_partner_provider()
     and o.status not in ('pending_payment', 'cancelled')
   order by o.ordered_at desc;
$$;
revoke all on function public.lab_partner_portal_orders() from public, anon;
grant execute on function public.lab_partner_portal_orders() to authenticated;

-- grants -------------------------------------------------------------------------------------------------------------------------
revoke all on function public.lab_partner_submit_correction(uuid, uuid, text, text, text, jsonb, jsonb),
  public.withdraw_lab_result(uuid, text), public.record_lab_disclosure_attempt(uuid, text, text) from public, anon;
grant execute on function public.lab_partner_submit_correction(uuid, uuid, text, text, text, jsonb, jsonb),
  public.withdraw_lab_result(uuid, text), public.record_lab_disclosure_attempt(uuid, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sign_lab_panels(uuid)', 'execute') or has_function_privilege('anon', 'public.withdraw_lab_result(uuid, text)', 'execute')
     or has_table_privilege('authenticated', 'public.lab_disclosure_attempts', 'select') then
    raise exception 'S27d self-check: grants too wide';
  end if;
  if private.lab_panels_signed() then raise exception 'S27d self-check: ranges must start unsigned'; end if;
end $$;
