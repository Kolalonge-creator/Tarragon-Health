-- Wire i18n_key (and i18n_params where parameterised) into every credential
-- and quality notification payload.  The Edge Function resolves the key from
-- a bundled English catalogue with {param} interpolation, falling back to the
-- raw SQL text when the key is absent — so the change is fully backwards-
-- compatible and the existing SQL text remains the source of truth for any
-- notification sent before this migration.
--
-- Also gives notify_backup_readers a p_payload parameter (default '{}') so
-- callers can pass i18n_key through it.  The old 4-arg signature is dropped
-- first; plpgsql resolves references at execution, so existing callers
-- (all in this same file's recreated functions) bind to the new 5-arg
-- signature via the default.

-- ======================================================================
-- 1. notify_backup_readers: add p_payload parameter
-- ======================================================================
drop function if exists private.notify_backup_readers(uuid, boolean, text, text);

create function private.notify_backup_readers(p_org uuid, p_is_test boolean, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select profile_id from public.safety_concern_readers where active and organisation_id = p_org and is_test = p_is_test loop
    perform private.credential_notify(r.profile_id, p_org, p_subject, p_message, coalesce(p_payload, '{}'::jsonb), true);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.notify_backup_readers(uuid, boolean, text, text, jsonb) from public, anon, authenticated;

-- ======================================================================
-- 2. notify_clinical_leads: unchanged signature, but the function already
--    passes p_payload through — callers just need to include i18n_key in
--    the payload they pass.  Re-created here only because plpgsql resolves
--    at execution and the old notify_backup_readers signature was just
--    dropped; no functional change to this function.
-- ======================================================================
-- (no change needed — notify_clinical_leads already forwards p_payload)

-- ======================================================================
-- 3. S15 functions: add i18n_key to each credential_notify payload
-- ======================================================================

-- 3a. credential_notify_reviewers: S18 (20261006024602) already replaced the four argument function with this five argument one
--     (audience defaulted to 'reviewer', organisation-scoped, payload passed through, so i18n_key in p_payload reaches the notice).
--     This migration used to re-create the old four argument signature, which on a fresh replay (version order: S18 runs first)
--     made a second overload and every bare-literal call ambiguous (42725). Re-stated here with the identical signature and body so
--     the replay ends with exactly one function; live already has this definition.
create or replace function private.credential_notify_reviewers(p_org uuid, p_subject text, p_message text, p_payload jsonb, p_audience text default 'reviewer')
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p where p.organisation_id = p_org and p.is_active and p.role = 'admin'
    union
    select cs.profile_id from public.clinical_staff cs where cs.organisation_id = p_org and cs.profile_id is not null and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
  loop
    perform private.credential_notify(r.id, p_org, p_subject, p_message, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('audience', p_audience), false);
  end loop;
end;
$$;

-- 3b. apply_application_transition: i18n_key per outcome
create or replace function private.apply_application_transition(p_application uuid, p_to public.clinician_application_state, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
begin
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.clinician_application_transition_rules where from_state = a.state and to_state = p_to) then
    raise exception 'clinician application: % to % is not a valid transition', a.state, p_to using errcode = '23514';
  end if;
  perform set_config('tarragon.credential_transition', 'on', true);
  update public.clinician_applications
    set state = p_to,
        submitted_at = case when p_to = 'documents_submitted' then now() else submitted_at end,
        decided_at = case when p_to in ('rejected', 'approved_tier1', 'offboarded') then now() else decided_at end,
        rejected_reason = case when p_to = 'rejected' then p_reason else rejected_reason end
    where id = p_application;
  perform set_config('tarragon.credential_transition', 'off', true);
  insert into public.clinician_application_transitions (organisation_id, application_id, from_state, to_state, actor_id, reason, is_test)
    values (a.organisation_id, a.id, a.state, p_to, p_actor, p_reason, a.is_test);
  perform private.credential_audit(a.organisation_id, p_actor, 'clinician_application.' || p_to::text, 'clinician_application', a.id,
    jsonb_build_object('from', a.state, 'to', p_to));
  perform private.emit_domain_event('clinician.application_state_changed', a.organisation_id,
    jsonb_build_object('application_id', a.id, 'from_state', a.state, 'to_state', p_to),
    'clinician.application_state_changed:' || a.id || ':' || p_to || ':' || extract(epoch from clock_timestamp())::text);
  if p_to in ('approved_tier1', 'active', 'rejected') then
    perform private.credential_notify(a.profile_id, a.organisation_id, 'Your clinician application',
      case p_to
        when 'approved_tier1' then 'Your application has been approved. Your care team lead will switch you on shortly.'
        when 'active' then 'You are now active on Tarragon Health.'
        else 'Your application was not approved. Your care team lead can tell you more.'
      end,
      jsonb_build_object('application_id', a.id, 'audience', 'applicant',
        'i18n_key', case p_to
          when 'approved_tier1' then 'credential.app_approved'
          when 'active' then 'credential.app_active'
          else 'credential.app_rejected'
        end),
      true);
  end if;
end;
$$;

-- 3c. suspend_clinician_internal: i18n_key for suspension + reviewers
create or replace function private.suspend_clinician_internal(p_staff uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_app uuid;
begin
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found or s.status <> 'active' then return; end if;
  update public.clinical_staff set status = 'suspended', active = false, suspended_at = now(), suspended_reason = p_reason where id = p_staff;
  if s.profile_id is not null then
    update public.profiles set role = 'patient' where id = s.profile_id and role = 'clinician';
  end if;
  select id into v_app from public.clinician_applications where clinical_staff_id = p_staff and state = 'active';
  if v_app is not null then perform private.apply_application_transition(v_app, 'suspended', p_actor, p_reason); end if;
  perform private.credential_audit(s.organisation_id, p_actor, 'clinical_staff.suspended', 'clinical_staff', s.id, jsonb_build_object('reason', p_reason));
  perform private.emit_domain_event('clinician.suspended', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id),
    'clinician.suspended:' || s.id || ':' || extract(epoch from clock_timestamp())::text);
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'Your access is paused',
      'Your clinician access is paused: ' || p_reason || '. Upload your renewed documents under Join as a clinician and your care team lead will reinstate you once they are checked.',
      jsonb_build_object('clinical_staff_id', s.id, 'audience', 'applicant',
        'i18n_key', 'credential.suspended', 'i18n_params', jsonb_build_object('reason', p_reason)),
      true);
  end if;
  perform private.credential_notify_reviewers(s.organisation_id, 'Clinician suspended', s.full_name || ' was suspended: ' || p_reason,
    jsonb_build_object('clinical_staff_id', s.id,
      'i18n_key', 'credential.suspended_reviewers', 'i18n_params', jsonb_build_object('name', s.full_name, 'reason', p_reason)));
end;
$$;

-- 3d. reinstate_clinician: i18n_key for reinstatement
create or replace function public.reinstate_clinician(p_staff uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_app uuid;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found or s.status <> 'suspended' then raise exception 'only a suspended clinician can be reinstated' using errcode = '23514'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot reinstate yourself' using errcode = '42501'; end if;
  if s.license_expires_at is not null and not (private.credential_valid_on(s.license_expires_at) or private.credential_in_grace(s.id, 'licence')) then
    raise exception 'record the renewed licence first' using errcode = '23514'; end if;
  if coalesce(private.indemnity_required(s.id), false) and not ((s.indemnity_expires_at is not null and s.indemnity_expires_at > now()) or private.credential_in_grace(s.id, 'indemnity')) then
    raise exception 'record the renewed indemnity first' using errcode = '23514'; end if;
  update public.clinical_staff set status = 'active', active = true, suspended_at = null, suspended_reason = null where id = p_staff;
  if s.profile_id is not null then update public.profiles set role = 'clinician' where id = s.profile_id and role = 'patient'; end if;
  select id into v_app from public.clinician_applications where clinical_staff_id = p_staff and state = 'suspended';
  if v_app is not null then perform private.apply_application_transition(v_app, 'active', auth.uid(), p_reason); end if;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.reinstated', 'clinical_staff', s.id, jsonb_build_object('reason', p_reason));
  perform private.emit_domain_event('clinician.reinstated', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id),
    'clinician.reinstated:' || s.id || ':' || extract(epoch from clock_timestamp())::text);
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'You are active again', 'Your clinician access is back on.',
      jsonb_build_object('clinical_staff_id', s.id, 'i18n_key', 'credential.reinstated'), true);
  end if;
end;
$$;

-- 3e. renew_clinician_credential: i18n_key for renewal
create or replace function public.renew_clinician_credential(p_staff uuid, p_kind text, p_expires_at timestamptz, p_document uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; d public.clinician_documents%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot verify your own renewal' using errcode = '42501'; end if;
  select * into d from public.clinician_documents where id = p_document and owner_profile_id = s.profile_id and superseded_at is null;
  if not found then raise exception 'renewal document not found' using errcode = 'P0002'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'the new expiry must be in the future' using errcode = '23514'; end if;
  if p_kind = 'licence' then
    if d.kind <> 'mdcn_practising_licence' then raise exception 'attach the licence document' using errcode = '23514'; end if;
    update public.clinical_staff set license_expires_at = p_expires_at, license_verified_at = now(), verified_by = auth.uid(),
      credential_verified_at = now(), credential_verified_by = auth.uid() where id = p_staff;
  elsif p_kind = 'indemnity' then
    if d.kind <> 'indemnity_certificate' then raise exception 'attach the indemnity certificate' using errcode = '23514'; end if;
    update public.clinical_staff set indemnity_expires_at = p_expires_at where id = p_staff;
  else
    raise exception 'unknown credential kind' using errcode = '23514';
  end if;
  update public.clinician_documents set verified_by = auth.uid(), verified_at = now(), expires_at = p_expires_at where id = p_document;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.credential_renewed', 'clinical_staff', s.id, jsonb_build_object('kind', p_kind, 'expires_at', p_expires_at));
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'Renewal recorded', 'Your renewed ' || p_kind || ' was recorded. Thank you.',
      jsonb_build_object('clinical_staff_id', s.id,
        'i18n_key', 'credential.renewal_recorded', 'i18n_params', jsonb_build_object('kind', p_kind)),
      false);
  end if;
end;
$$;

-- 3f. grant_credential_grace: i18n_key for grace period
create or replace function public.grant_credential_grace(p_staff uuid, p_kind text, p_days integer, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_max int := coalesce((private.credential_rule('grace_max_days'))::int, 14); v_id uuid;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('licence', 'indemnity') then raise exception 'unknown credential kind' using errcode = '23514'; end if;
  if p_days is null or p_days < 1 or p_days > v_max then raise exception 'a grace period is between 1 and % days', v_max using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot grant yourself a grace period' using errcode = '42501'; end if;
  insert into public.credential_grace_periods (organisation_id, clinical_staff_id, kind, ends_at, reason, granted_by, is_test)
    values (s.organisation_id, p_staff, p_kind, now() + make_interval(days => p_days), p_reason, auth.uid(), s.is_test) returning id into v_id;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'credential_grace.granted', 'clinical_staff', s.id, jsonb_build_object('kind', p_kind, 'days', p_days, 'reason', p_reason));
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'A short grace period was recorded',
      format('A grace period of %s days was recorded for your %s. Please upload your renewed document before it ends.', p_days, p_kind),
      jsonb_build_object('clinical_staff_id', s.id,
        'i18n_key', 'credential.grace_period', 'i18n_params', jsonb_build_object('days', p_days::text, 'kind', p_kind)),
      true);
  end if;
  return v_id;
end;
$$;

-- 3g. credential_expiry_sweep: i18n_key per expiry window + reviewer notice
create or replace function private.credential_expiry_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_kind text;
  v_exp timestamptz;
  v_days int;
  v_windows int[] := coalesce(array(select jsonb_array_elements_text(private.credential_rule('notice_windows_days'))::int), array[90, 30, 0]);
  v_w int;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_rows int := 0; v_suspended int := 0; v_missing int := 0; v_errors int := 0;
  v_label text; v_msg text; v_inserted boolean;
  v_date_str text; v_i18n_key text;
begin
  for r in select cs.* from public.clinical_staff cs where cs.active and cs.status = 'active' and cs.profile_id is not null loop
    begin
      foreach v_kind in array array['licence', 'indemnity'] loop
        if v_kind = 'indemnity' and not coalesce(private.indemnity_required(r.id), false) then continue; end if;
        v_exp := case when v_kind = 'licence' then r.license_expires_at else r.indemnity_expires_at end;
        if v_exp is null then v_missing := v_missing + 1; continue; end if;
        v_days := (v_exp at time zone 'Africa/Lagos')::date - v_today;
        v_label := case when v_kind = 'licence' then 'MDCN practising licence' else 'professional indemnity cover' end;
        v_date_str := to_char(v_exp at time zone 'Africa/Lagos', 'DD Mon YYYY');

        if v_days >= 0 then
          select min(w) into v_w from unnest(v_windows) w where w >= v_days;
          if v_w is not null then
            insert into public.credential_expiry_notices (organisation_id, clinical_staff_id, kind, expires_on, window_days, was_sent)
              select r.organisation_id, r.id, v_kind, (v_exp at time zone 'Africa/Lagos')::date, w, false from unnest(v_windows) w where w > v_w
              on conflict do nothing;
            insert into public.credential_expiry_notices (organisation_id, clinical_staff_id, kind, expires_on, window_days)
              values (r.organisation_id, r.id, v_kind, (v_exp at time zone 'Africa/Lagos')::date, v_w) on conflict do nothing;
            get diagnostics v_rows = row_count;
            v_inserted := v_rows > 0;
            if v_inserted then
              v_msg := case
                when v_days = 0 then format('Your %s expires today. Upload your renewed document under Training and profile now, so your access is not paused.', v_label)
                when v_days <= 31 then format('Your %s expires on %s, in %s days. Please upload your renewed document under Training and profile.', v_label, v_date_str, v_days)
                else format('Your %s expires on %s. Please plan your renewal and upload it under Training and profile.', v_label, v_date_str) end;
              v_i18n_key := case when v_days = 0 then 'credential.expiry_today' when v_days <= 31 then 'credential.expiry_soon' else 'credential.expiry_plan' end;
              perform private.credential_notify(r.profile_id, r.organisation_id,
                'Your ' || v_label || case when v_days = 0 then ' expires today' else ' is due for renewal' end, v_msg,
                jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind, 'days_left', v_days,
                  'i18n_key', v_i18n_key, 'i18n_params', jsonb_build_object('label', v_label, 'date', v_date_str, 'days', v_days::text)),
                true);
              if v_w <= 30 then
                perform private.credential_notify_reviewers(r.organisation_id, 'Clinician credential expiring',
                  format('%s: %s expires on %s (%s days).', r.full_name, v_label, v_date_str, v_days),
                  jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind,
                    'i18n_key', 'credential.expiry_reviewers', 'i18n_params', jsonb_build_object('name', r.full_name, 'label', v_label, 'date', v_date_str, 'days', v_days::text)));
              end if;
              perform private.emit_domain_event('clinician.credential_expiring', r.organisation_id,
                jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind, 'days_left', v_days),
                'clinician.credential_expiring:' || r.id || ':' || v_kind || ':' || v_exp::date || ':' || v_w);
            end if;
          end if;
        elsif not private.credential_in_grace(r.id, v_kind) then
          perform private.suspend_clinician_internal(r.id,
            format('Your %s expired on %s.', v_label, v_date_str), null);
          v_suspended := v_suspended + 1;
          exit;
        end if;
      end loop;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'credential_expiry_sweep failed for clinician %: %', r.id, sqlerrm;
      perform private.credential_audit(r.organisation_id, null, 'credential_sweep.error', 'clinical_staff', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'credential_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'Credential expiry sweep failed for some clinicians',
            format('%s clinician(s) could not be processed by private.credential_expiry_sweep(); see audit_log action credential_sweep.error. Expiry notices or suspensions for them may be missing.', v_errors),
            'credential_sweep', now(), now());
  end if;
  return jsonb_build_object('suspended', v_suspended, 'missing_dates', v_missing, 'errors', v_errors);
end;
$$;

-- ======================================================================
-- 4. S20 functions: add i18n_key to each quality notification payload
-- ======================================================================

-- 4a. create_audit: i18n_key for audit assignment / no-reviewer
create or replace function private.create_audit(p_task uuid, p_reason text, p_draw numeric) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype; s public.clinical_staff%rowtype;
  v_cfg integer; v_form integer; v_month date; v_reviewer uuid; v_id uuid; v_due integer;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found or t.state <> 'completed' or t.claimed_by is null then return null; end if;
  select * into s from public.clinical_staff where profile_id = t.claimed_by;
  if not found then return null; end if;
  select version, (rules -> 'form' ->> 'version')::integer into v_cfg, v_form from public.quality_config where is_active;
  v_due := (private.quality_setting('sampling') ->> 'due_days')::integer;
  v_month := private.lagos_month(coalesce(t.completed_at, now()));
  v_reviewer := private.audit_reviewer_for(t.organisation_id, t.is_test, t.claimed_by, v_month);
  insert into public.clinical_audits (organisation_id, task_id, clinician_id, reviewer_id, reason, audit_month, sample_draw, counts_toward_tier1,
                                     state, config_version, form_version, due_at, is_test)
  values (t.organisation_id, t.id, t.claimed_by, v_reviewer, p_reason, v_month, p_draw, coalesce(s.credentialing_level, 2) = 1,
          case when v_reviewer is null then 'unassigned' else 'assigned' end, v_cfg, v_form, now() + make_interval(days => v_due), t.is_test)
  on conflict (task_id) where state <> 'cancelled' do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  perform private.emit_domain_event('clinical_audit.assigned', t.organisation_id,
    jsonb_build_object('audit_id', v_id, 'task_id', t.id, 'reason', p_reason), 'clinical_audit.assigned:' || v_id, null, 'clinical_audit', v_id);
  if v_reviewer is not null then
    perform private.credential_notify(v_reviewer, t.organisation_id, 'A clinical audit is waiting for you',
      'A clinical audit has been assigned to you. Open the audits page in the clinical lead area.',
      jsonb_build_object('audit_id', v_id, 'i18n_key', 'quality.audit_assigned'), false);
  else
    perform private.notify_clinical_leads(t.organisation_id, t.is_test, 'A clinical audit has no reviewer',
      'A clinical audit could not be assigned to a reviewer. Open the audits page in the clinical lead area.',
      jsonb_build_object('audit_id', v_id, 'i18n_key', 'quality.audit_no_reviewer'), t.claimed_by, false);
  end if;
  return v_id;
end;
$$;

-- 4b. submit_clinical_audit: i18n_key for audit complete + tier1 met
create or replace function public.submit_clinical_audit(p_audit uuid, p_safety jsonb, p_quality jsonb, p_rationale text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype; s public.clinical_staff%rowtype;
  f jsonb; o jsonb; v_key text; v_val jsonb; v_max integer; v_sum numeric := 0; v_n integer := 0;
  v_critical boolean := false; v_score numeric; v_outcome text; v_rel jsonb; v_cqv integer;
  v_done integer; v_avg numeric; v_miss integer; t1 jsonb; v_first boolean;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can submit an audit' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) then raise exception 'audit not found' using errcode = 'P0002'; end if;
  if a.clinician_id = v_uid then raise exception 'you cannot audit your own work' using errcode = '42501'; end if;
  if a.state not in ('assigned', 'unassigned') then raise exception 'this audit is already %', a.state using errcode = '23514'; end if;
  if a.reviewer_id is not null and a.reviewer_id <> v_uid then raise exception 'this audit is assigned to another reviewer' using errcode = '42501'; end if;
  select rules -> 'form', rules -> 'outcomes', rules -> 'reliability' into f, o, v_rel from public.quality_config where version = a.config_version;
  v_max := (f ->> 'quality_max')::integer;
  if jsonb_typeof(p_safety) <> 'object' or jsonb_typeof(p_quality) <> 'object' then raise exception 'send the safety and quality results as objects' using errcode = '22023'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_safety) k) is distinct from (select array_agg(i order by i) from jsonb_array_elements_text(f -> 'safety_items') i)
     or (select array_agg(k order by k) from jsonb_object_keys(p_quality) k) is distinct from (select array_agg(i order by i) from jsonb_array_elements_text(f -> 'quality_items') i) then
    raise exception 'the audit form needs every item and no others' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_safety) loop
    if jsonb_typeof(v_val) <> 'boolean' then raise exception 'safety item % must be true or false', v_key using errcode = '22023'; end if;
    if not (v_val #>> '{}')::boolean then v_critical := true; end if;
  end loop;
  for v_key, v_val in select * from jsonb_each(p_quality) loop
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) or (v_val #>> '{}')::numeric not between 0 and v_max then
      raise exception 'quality item % must be a whole number from 0 to %', v_key, v_max using errcode = '22023';
    end if;
    v_sum := v_sum + (v_val #>> '{}')::numeric; v_n := v_n + 1;
  end loop;
  v_score := round(100 * v_sum / (v_max * v_n), 1);
  v_outcome := case when v_critical then 'unsafe'
                    when v_score >= (o ->> 'satisfactory_min')::numeric then 'satisfactory'
                    when v_score >= (o ->> 'minor_concerns_min')::numeric then 'minor_concerns'
                    else 'significant_concerns' end;
  if v_outcome <> 'satisfactory' and char_length(btrim(coalesce(p_rationale, ''))) < (o ->> 'rationale_min_chars')::integer then
    raise exception 'give a written reason of at least % characters for anything other than satisfactory', o ->> 'rationale_min_chars' using errcode = '22023';
  end if;
  update public.clinical_audits set state = 'submitted', reviewer_id = v_uid, safety_results = p_safety, quality_scores = p_quality, total_score = v_score,
         critical_miss = v_critical, outcome = v_outcome, rationale = nullif(btrim(coalesce(p_rationale, '')), ''), submitted_at = now(),
         followup_needed = v_outcome in ('significant_concerns', 'unsafe')
   where id = a.id;
  select version into v_cqv from public.queue_claim_config where is_active;
  select * into s from public.clinical_staff where profile_id = a.clinician_id;
  insert into public.clinician_reliability_events (organisation_id, clinician_id, task_id, kind, good, weight, config_version, is_test)
  values (a.organisation_id, a.clinician_id, a.task_id, 'audit_result', (v_rel -> 'good_by_outcome' ->> v_outcome)::numeric, (v_rel ->> 'audit_weight')::numeric, v_cqv, a.is_test);
  perform private.recompute_reliability(a.clinician_id);
  perform private.emit_domain_event('clinical_audit.completed', a.organisation_id, jsonb_build_object('audit_id', a.id, 'outcome', v_outcome),
    'clinical_audit.completed:' || a.id, null, 'clinical_audit', a.id);
  if v_outcome in ('significant_concerns', 'unsafe') then
    perform private.emit_domain_event('clinical_audit.concern_found', a.organisation_id, jsonb_build_object('audit_id', a.id, 'outcome', v_outcome),
      'clinical_audit.concern_found:' || a.id, null, 'clinical_audit', a.id);
  end if;
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, a.organisation_id, 'An audit of your work is complete',
      'An audit of one of your tasks has been completed. You can read the result under Training and profile.',
      jsonb_build_object('audit_id', a.id, 'i18n_key', 'quality.audit_complete'), false);
  end if;
  if a.counts_toward_tier1 and s.id is not null then
    t1 := private.quality_setting('tier1');
    select count(*), coalesce(avg(total_score), 0), count(*) filter (where critical_miss)
      into v_done, v_avg, v_miss from public.clinical_audits where clinician_id = a.clinician_id and counts_toward_tier1 and state = 'submitted';
    if v_done >= private.tier1_target(s.id) and v_avg >= (t1 ->> 'graduation_min_score')::numeric and v_miss <= (t1 ->> 'max_critical_misses')::integer
       and coalesce(s.credentialing_level, 2) = 1 then
      v_first := not exists (select 1 from public.domain_events where event_type = 'clinician.tier1_audits_complete'
                               and idempotency_key = 'clinician.tier1_audits_complete:' || s.id || ':' || private.tier1_target(s.id));
      perform private.emit_domain_event('clinician.tier1_audits_complete', a.organisation_id, jsonb_build_object('clinical_staff_id', s.id),
        'clinician.tier1_audits_complete:' || s.id || ':' || private.tier1_target(s.id));
      if v_first then perform private.notify_clinical_leads(a.organisation_id, a.is_test, 'A clinician met the audited task count',
        'A level 1 clinician has met the audited task count. Open the clinician page to decide about their level.',
        jsonb_build_object('clinical_staff_id', s.id, 'i18n_key', 'quality.tier1_met'), a.clinician_id, false);
      end if;
    end if;
  end if;
  return jsonb_build_object('outcome', v_outcome, 'total_score', v_score, 'critical_miss', v_critical);
end;
$$;

-- 4c. trg_handback_review: i18n_key for handback pattern
create or replace function private.trg_handback_review() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := private.claim_setting('handback_review'); v_days integer; v_more integer; v_n integer; v_reasons jsonb; v_org uuid; v_test boolean; v_ins integer;
begin
  begin
    v_days := (r ->> 'window_days')::integer; v_more := (r ->> 'more_than')::integer;
    select coalesce(sum(c), 0)::integer, coalesce(jsonb_object_agg(reason_code, c), '{}'::jsonb) into v_n, v_reasons
      from (select reason_code, count(*) c from public.task_handbacks
             where clinician_id = new.clinician_id and created_at > now() - make_interval(days => v_days) group by reason_code) x;
    if v_n > v_more then
      select organisation_id, is_test into v_org, v_test from public.clinical_staff where profile_id = new.clinician_id;
      if v_org is not null then
        insert into public.handback_reviews (organisation_id, clinician_id, window_days, handbacks, reasons, is_test)
        values (v_org, new.clinician_id, v_days, v_n, v_reasons, v_test) on conflict (clinician_id) where state = 'open' do nothing;
        get diagnostics v_ins = row_count;
        if v_ins > 0 then
          perform private.notify_clinical_leads(v_org, v_test, 'A hand-back pattern needs review',
            'A hand-back pattern needs your review. Open the reviews page in the clinical lead area.',
            jsonb_build_object('i18n_key', 'quality.handback_review'), new.clinician_id, false);
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'hand-back review check failed for %: %', new.clinician_id, sqlerrm;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      select organisation_id, 'handback_review.error', 'clinical_staff', id, jsonb_build_object('error', sqlerrm) from public.clinical_staff where profile_id = new.clinician_id;
  end;
  return null;
end;
$$;

-- 4d. raise_safety_concern: i18n_key for concern_new
create or replace function public.raise_safety_concern(p_category text, p_severity text, p_description text, p_screen text default null, p_task uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype; c jsonb := private.quality_setting('speak_up'); v_id uuid;
  v_ack interval; v_by_cmo boolean;
begin
  select * into s from public.clinical_staff where profile_id = v_uid;
  if not found then raise exception 'only clinicians can raise a safety concern here' using errcode = '42501'; end if;
  if p_severity in ('low', 'medium')
     and (select count(*) from public.safety_concerns where raised_by = v_uid and created_at > now() - interval '24 hours') >= (c ->> 'max_per_day')::integer then
    raise exception 'you have raised many concerns today; please speak to the clinical lead directly, or mark it high or immediate if it cannot wait' using errcode = '54000';
  end if;
  if p_task is not null and not exists (select 1 from public.task_claims tc where tc.task_id = p_task and tc.clinician_id = v_uid) then
    raise exception 'that task is not one you worked on' using errcode = '22023';
  end if;
  v_ack := make_interval(hours => case when p_severity = 'immediate' then (c ->> 'immediate_acknowledge_hours')::integer else (c ->> 'acknowledge_hours')::integer end);
  v_by_cmo := s.doctor_tier = 'chief_medical_officer';
  insert into public.safety_concerns (organisation_id, raised_by, category, severity, description, screen, task_id, acknowledge_due_at, respond_due_at, escalated_at, is_test)
  values (s.organisation_id, v_uid, p_category, p_severity, p_description, left(p_screen, 100), p_task, now() + v_ack,
          now() + make_interval(days => (c ->> 'respond_days')::integer), case when v_by_cmo then now() end, s.is_test)
  returning id into v_id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (v_id, v_uid, 'raised', null);
  if v_by_cmo then
    perform private.notify_backup_readers(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'));
  else
    perform private.notify_clinical_leads(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'), v_uid, true);
  end if;
  return v_id;
end;
$$;

-- 4e. acknowledge_safety_concern: i18n_key for concern_ack
create or replace function public.acknowledge_safety_concern(p_concern uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state <> 'new' then return; end if;
  update public.safety_concerns set state = 'acknowledged', acknowledged_at = now(), acknowledged_by = v_uid where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'acknowledged', 'Your concern was received and is being looked at.');
  perform private.credential_notify(c.raised_by, c.organisation_id, 'Your concern was received', 'Your concern was received. You can follow it under Raise a safety concern.',
    jsonb_build_object('i18n_key', 'quality.concern_ack'), false);
end;
$$;

-- 4f. respond_to_safety_concern: i18n_key for concern_reply
create or replace function public.respond_to_safety_concern(p_concern uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state = 'closed' then raise exception 'this concern is closed' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 20 then raise exception 'write a response of at least 20 characters' using errcode = '22023'; end if;
  update public.safety_concerns set state = 'responded', responded_at = coalesce(responded_at, now()),
         acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, v_uid) where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'response', btrim(p_body));
  perform private.credential_notify(c.raised_by, c.organisation_id, 'You have a reply', 'You have a reply to your concern. Open it under Raise a safety concern.',
    jsonb_build_object('i18n_key', 'quality.concern_reply'), false);
end;
$$;

-- 4g. add_to_safety_concern: i18n_key for concern_new (same neutral text)
create or replace function public.add_to_safety_concern(p_concern uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); c public.safety_concerns%rowtype;
begin
  select * into c from public.safety_concerns where id = p_concern and raised_by = v_uid;
  if not found then raise exception 'concern not found' using errcode = 'P0002'; end if;
  if c.state = 'closed' then raise exception 'this concern is closed; raise a new one' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 5 then raise exception 'write at least a few words' using errcode = '22023'; end if;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'note', btrim(p_body));
  perform private.notify_clinical_leads(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
    jsonb_build_object('i18n_key', 'quality.concern_new'), v_uid, false);
end;
$$;

-- 4h. close_safety_concern: i18n_key for concern_closed
create or replace function public.close_safety_concern(p_concern uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state = 'closed' then return; end if;
  if c.responded_at is null then raise exception 'respond to the person who raised it before closing' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'say what was done, in at least 20 characters' using errcode = '22023'; end if;
  update public.safety_concerns set state = 'closed', closed_at = now(), closed_by = v_uid, close_note = btrim(p_note) where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'closed', btrim(p_note));
  perform private.credential_notify(c.raised_by, c.organisation_id, 'Your concern was closed', 'Your concern was closed. You can read the outcome under Raise a safety concern.',
    jsonb_build_object('i18n_key', 'quality.concern_closed'), false);
end;
$$;

-- 4i. safety_concern_sweep: i18n_key for concern_overdue + concern_needs_response
create or replace function private.safety_concern_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_esc integer := 0; v_noreader integer := 0; v_late integer := 0; v_errors integer := 0; n integer;
begin
  for r in select * from public.safety_concerns where state = 'new' and escalated_at is null and acknowledge_due_at < now() loop
    begin
      update public.safety_concerns set escalated_at = now() where id = r.id;
      insert into public.safety_concern_messages (concern_id, kind, body) values (r.id, 'escalated', 'Not acknowledged in time; the backup readers can now see it.');
      perform private.notify_backup_readers(r.organisation_id, r.is_test, 'An item needs your attention', 'An item is overdue in the clinical lead area.',
        jsonb_build_object('i18n_key', 'quality.concern_overdue'));
      v_esc := v_esc + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: escalating % failed: %', r.id, sqlerrm;
    end;
  end loop;
  for r in select distinct organisation_id, is_test from public.safety_concerns
            where state = 'new' and acknowledge_due_at < now()
              and not exists (select 1 from public.safety_concern_readers rd where rd.active and rd.organisation_id = safety_concerns.organisation_id and rd.is_test = safety_concerns.is_test) loop
    begin
      v_noreader := v_noreader + 1;
      if not exists (select 1 from public.ops_incidents where external_reference = 'clinical_safety_overdue' and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values (r.organisation_id, 'clinical', 'sev2', 'A clinical safety item is overdue',
                'An item held by the clinical lead was not acknowledged in time and no backup reader is named. Details are not available to operations.',
                'clinical_safety_overdue', now(), now());
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: overdue incident failed: %', sqlerrm;
    end;
  end loop;
  for r in select * from public.safety_concerns where state in ('new', 'acknowledged') and responded_at is null and respond_due_at < now() and respond_overdue_notified_at is null loop
    begin
      update public.safety_concerns set respond_overdue_notified_at = now() where id = r.id;
      perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.',
        jsonb_build_object('i18n_key', 'quality.concern_needs_response'), r.raised_by, false);
      if r.escalated_at is not null then perform private.notify_backup_readers(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.',
        jsonb_build_object('i18n_key', 'quality.concern_needs_response')); end if;
      v_late := v_late + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: response notice for % failed: %', r.id, sqlerrm;
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'safety_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'The clinical lead area sweep failed for some items',
            format('%s item(s) could not be processed by private.safety_concern_sweep(). Details are not available to operations.', v_errors), 'safety_sweep', now(), now());
  end if;
  return jsonb_build_object('escalated', v_esc, 'no_backup_reader', v_noreader, 'response_overdue', v_late, 'errors', v_errors);
end;
$$;

-- 4j. note_adverse_action: i18n_key for concern_new (neutral)
create or replace function private.note_adverse_action(p_profile uuid, p_kind text, p_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_test boolean; v_months integer := (private.quality_setting('speak_up') ->> 'retaliation_review_months')::integer; v_ins integer;
begin
  select organisation_id, is_test into v_org, v_test from public.clinical_staff where profile_id = p_profile;
  if v_org is null or not exists (select 1 from public.safety_concerns where raised_by = p_profile and created_at > now() - make_interval(months => v_months)) then return; end if;
  insert into public.retaliation_reviews (organisation_id, clinician_id, trigger_kind, trigger_ref, is_test) values (v_org, p_profile, p_kind, p_ref, v_test)
  on conflict (clinician_id, trigger_kind, trigger_ref) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins > 0 then
    perform private.notify_clinical_leads(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'), p_profile, false);
    perform private.notify_backup_readers(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'));
  end if;
end;
$$;

-- 4k. quality_audit_sweep: i18n_key for audit_overdue
create or replace function private.quality_audit_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_rev uuid; v_assigned integer := 0; v_late integer := 0; v_floor integer := 0; v_missed integer := 0; v_errors integer := 0; v_prev date := private.lagos_month(now() - interval '1 month');
begin
  for r in select * from public.clinical_audits where state = 'unassigned' loop
    begin
      v_rev := private.audit_reviewer_for(r.organisation_id, r.is_test, r.clinician_id, r.audit_month);
      if v_rev is not null then update public.clinical_audits set reviewer_id = v_rev, state = 'assigned' where id = r.id; v_assigned := v_assigned + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event) values (r.organisation_id, 'clinical_audit.sweep_error', 'clinical_audit', r.id, jsonb_build_object('error', sqlerrm, 'step', 'assign'));
    end;
  end loop;
  for r in select * from public.clinical_audits where state in ('unassigned', 'assigned') and due_at < now() and overdue_notified_at is null loop
    begin
      update public.clinical_audits set overdue_notified_at = now() where id = r.id;
      perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'A clinical audit is overdue', 'A clinical audit is overdue. Open the audits page in the clinical lead area.',
        jsonb_build_object('audit_id', r.id, 'i18n_key', 'quality.audit_overdue'), r.clinician_id, false);
      v_late := v_late + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event) values (r.organisation_id, 'clinical_audit.sweep_error', 'clinical_audit', r.id, jsonb_build_object('error', sqlerrm, 'step', 'overdue'));
    end;
  end loop;
  for r in select t.id from public.clinical_tasks t
            where t.state = 'completed' and t.completed_at > now() - interval '3 days' and t.claimed_by is not null
              and exists (select 1 from public.audit_log l where l.action = 'clinical_audit.schedule_error' and l.entity_id = t.id) loop
    begin
      if private.consider_task_for_audit(r.id) is not null then v_missed := v_missed + 1; end if;
    exception when others then raise warning 'audit retry failed for %: %', r.id, sqlerrm; end;
  end loop;
  if (now() at time zone 'Africa/Lagos')::date < private.lagos_month(now()) + 7 then
    begin
      v_floor := private.audit_floor_top_up(v_prev);
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, event) values ('clinical_audit.sweep_error', 'clinical_audit', jsonb_build_object('error', sqlerrm, 'step', 'floor'));
    end;
  end if;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'audit_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev3', 'The clinical audit sweep failed for some items',
            format('%s item(s) could not be processed by private.quality_audit_sweep(); see audit_log action clinical_audit.sweep_error.', v_errors), 'audit_sweep', now(), now());
  end if;
  return jsonb_build_object('assigned', v_assigned, 'overdue_notified', v_late, 'retried', v_missed, 'floor_top_up', v_floor, 'errors', v_errors);
end;
$$;
