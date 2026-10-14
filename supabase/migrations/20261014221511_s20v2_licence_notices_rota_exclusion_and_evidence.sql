-- S20 v2 licences (plan Stage 4, defect Q6, CMO decision 8 recorded 2026-10-07).
--
--   * Notices at 90/30/7/0 days and the proof-of-renewal deadline (15 December for the 31 December cycle): credentialing_config
--     version 3 (INACTIVE, unsigned), read by the existing sweep, which now also sends the "proof overdue" notice once per cycle.
--   * Availability and rota exclude anyone whose licence or indemnity ends before the shift starts: a new availability block that
--     starts after expiry is refused, and the nightly net cancels future blocks and strips future rota slots that start after expiry.
--   * Rota-only clinicians (on the rota, no claim and no block) and clinicians who still lead patients are now inside the nightly
--     removal net (they were outside it).
--   * A missing licence date counts as ineligible once credentialing_config says so (v3). The two legacy rows without a date must be
--     given one first: activating a version that turns this on is REFUSED while any active clinician has no licence date, so nobody is
--     stranded. A clinician still in onboarding has no active clinical_staff row and a licence date is already required to approve.
--   * Each verification records its evidence source, the checker and the time (credential_verifications, append only); renewals write
--     one automatically.
--   * Grace stays 1 to 14 days, now the chief medical officer ONLY (it was any reviewer), never self-granted, enforced again by a trigger.
--
-- Nothing here activates credentialing_config version 3. Replay note: the functions restated below keep their exact signatures.

-- ---------------------------------------------------------------------------
-- 1. Configuration: version 3 (PROPOSED, inactive). Versions 1 and 2 are untouched.
-- ---------------------------------------------------------------------------
-- credentialing-rules-begin
insert into public.credentialing_config (version, is_active, effective_from, rules) values (3, false, '2026-10-14', $json$
{
  "min_practice_years": 2,
  "pass_percent": 80,
  "all_red_correct": true,
  "audited_task_count": 20,
  "referees_required": 2,
  "referee_independent_contact": true,
  "test_max_attempts": 3,
  "test_retake_cooldown_hours": 24,
  "test_scenarios_per_attempt": 10,
  "notice_windows_days": [90, 30, 7, 0],
  "grace_max_days": 14,
  "separate_verifier_and_approver": true,
  "document_max_bytes": 8388608,
  "document_retention_years_after_offboarding": 7,
  "require_verified_phone": false,
  "document_purge_enabled": false,
  "rejected_application_document_retention_months": 24,
  "renewal_cycle": { "cycle_end_month": 12, "cycle_end_day": 31, "proof_deadline_month": 12, "proof_deadline_day": 15 },
  "missing_licence_date_ineligible": true,
  "verification_sources": ["mdcn_register_lookup", "document_sighted", "insurer_confirmation", "other"]
}
$json$::jsonb);
-- credentialing-rules-end

create function private.credential_missing_date_ineligible() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((private.credential_rule('missing_licence_date_ineligible'))::boolean, false); $$;
revoke all on function private.credential_missing_date_ineligible() from public, anon, authenticated;

-- Never switch on "a missing licence date is ineligible" while an active clinician has no date: that would remove them from work overnight.
create function private.guard_credentialing_activation() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if coalesce((new.rules ->> 'missing_licence_date_ineligible')::boolean, false) then
    select count(*) into v_n from public.clinical_staff where active and status = 'active' and profile_id is not null and license_expires_at is null;
    if v_n > 0 then
      raise exception 'record the licence expiry date of % active clinician(s) before a missing date counts as ineligible', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_credentialing_activation() from public, anon, authenticated;
create trigger credentialing_config_missing_date_guard before update of is_active on public.credentialing_config
  for each row when (new.is_active and not old.is_active)
  execute function private.guard_credentialing_activation();

-- ---------------------------------------------------------------------------
-- 2. Eligibility: a missing licence date is ineligible once the active configuration says so (restated from S15, otherwise identical)
-- ---------------------------------------------------------------------------
create or replace function private.clinician_is_eligible(p_profile uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs
    where cs.profile_id = p_profile and cs.active and cs.status = 'active'
      and not private.provider_work_restricted(cs.id)
      and (cs.license_expires_at is null or private.credential_valid_on(cs.license_expires_at, p_at) or private.credential_in_grace(cs.id, 'licence', p_at))
      and (cs.license_expires_at is not null or not private.credential_missing_date_ineligible())
      and (not coalesce(private.indemnity_required(cs.id), false)
           or (cs.indemnity_expires_at is not null and cs.indemnity_expires_at > p_at)
           or private.credential_in_grace(cs.id, 'indemnity', p_at))
  );
$$;

create or replace function public.my_credential_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_blockers text[] := '{}';
begin
  select * into s from public.clinical_staff where profile_id = auth.uid();
  if not found then return null; end if;
  if s.status <> 'active' then v_blockers := array_append(v_blockers, 'status:' || s.status::text); end if;
  if not s.active and s.status = 'active' then v_blockers := array_append(v_blockers, 'not_yet_activated'::text); end if;
  if s.license_expires_at is not null and not (private.credential_valid_on(s.license_expires_at) or private.credential_in_grace(s.id, 'licence')) then v_blockers := array_append(v_blockers, 'licence_expired'::text); end if;
  if s.license_expires_at is null and private.credential_missing_date_ineligible() then v_blockers := array_append(v_blockers, 'licence_date_missing'::text); end if;
  if coalesce(private.indemnity_required(s.id), false) and not ((s.indemnity_expires_at is not null and s.indemnity_expires_at > now()) or private.credential_in_grace(s.id, 'indemnity')) then v_blockers := array_append(v_blockers, 'indemnity_expired'::text); end if;
  return jsonb_build_object(
    'clinical_staff_id', s.id, 'status', s.status, 'active', s.active, 'level', s.credentialing_level,
    'licence_expires_at', s.license_expires_at, 'indemnity_expires_at', s.indemnity_expires_at,
    'indemnity_required', coalesce(private.indemnity_required(s.id), false),
    'licence_in_grace', private.credential_in_grace(s.id, 'licence'), 'indemnity_in_grace', private.credential_in_grace(s.id, 'indemnity'),
    'audited_task_count', s.audited_task_count, 'audit_required_count', coalesce((private.credential_rule('audited_task_count'))::int, 20),
    'eligible', private.clinician_is_eligible(s.profile_id), 'blockers', to_jsonb(v_blockers),
    'competencies', (select coalesce(jsonb_agg(competency_code order by competency_code), '[]'::jsonb) from public.clinician_competencies where clinical_staff_id = s.id and revoked_at is null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Evidence: source, checker and time of every verification
-- ---------------------------------------------------------------------------
create table public.credential_verifications (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id   uuid not null references public.clinical_staff (id) on delete cascade,
  kind                text not null check (kind in ('licence', 'indemnity')),
  evidence_source     text not null check (evidence_source in ('mdcn_register_lookup', 'document_sighted', 'insurer_confirmation', 'other')),
  evidence_reference  text check (evidence_reference is null or char_length(evidence_reference) <= 500),
  observed_expires_at timestamptz,
  checked_by          uuid references public.profiles (id) on delete set null,
  checked_at          timestamptz not null default now(),
  is_test             boolean not null default false
);
create index credential_verifications_idx on public.credential_verifications (clinical_staff_id, kind, checked_at desc);
create trigger credential_verifications_append_only before update or delete on public.credential_verifications
  for each row execute function private.credential_append_only();
alter table public.credential_verifications enable row level security;
create policy credential_verifications_select on public.credential_verifications for select to authenticated
  using ((private.can_credential_review() and organisation_id = private.caller_org())
         or exists (select 1 from public.clinical_staff cs where cs.id = clinical_staff_id and cs.profile_id = (select auth.uid())));
revoke all on public.credential_verifications from public, anon, authenticated;
grant select on public.credential_verifications to authenticated;

create function public.record_credential_verification(p_staff uuid, p_kind text, p_source text, p_reference text default null, p_observed_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_stored timestamptz;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('licence', 'indemnity') then raise exception 'unknown credential kind' using errcode = '23514'; end if;
  if not (coalesce(private.credential_rule('verification_sources'), '["mdcn_register_lookup","document_sighted","insurer_confirmation","other"]'::jsonb)) ? p_source then
    raise exception 'unknown evidence source' using errcode = '23514';
  end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found or s.organisation_id is distinct from private.caller_org() then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot verify your own credential' using errcode = '42501'; end if;
  v_stored := case when p_kind = 'licence' then s.license_expires_at else s.indemnity_expires_at end;
  insert into public.credential_verifications (organisation_id, clinical_staff_id, kind, evidence_source, evidence_reference, observed_expires_at, checked_by, is_test)
  values (s.organisation_id, p_staff, p_kind, p_source, left(p_reference, 500), p_observed_expires_at, auth.uid(), s.is_test);
  return jsonb_build_object('recorded', true, 'matches_stored_date',
    case when p_observed_expires_at is null or v_stored is null then null else (p_observed_expires_at at time zone 'Africa/Lagos')::date = (v_stored at time zone 'Africa/Lagos')::date end);
end;
$$;

-- a renewal records its own evidence (the sighted document, who recorded it, when). Restated from the i18n migration plus the insert.
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
  insert into public.credential_verifications (organisation_id, clinical_staff_id, kind, evidence_source, evidence_reference, observed_expires_at, checked_by, is_test)
    values (s.organisation_id, p_staff, p_kind, 'document_sighted', 'document ' || p_document::text, p_expires_at, auth.uid(), s.is_test);
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.credential_renewed', 'clinical_staff', s.id, jsonb_build_object('kind', p_kind, 'expires_at', p_expires_at));
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'Renewal recorded', 'Your renewed ' || p_kind || ' was recorded. Thank you.',
      jsonb_build_object('clinical_staff_id', s.id,
        'i18n_key', 'credential.renewal_recorded', 'i18n_params', jsonb_build_object('kind', p_kind)),
      false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grace: the chief medical officer only, never self-granted, 1 to 14 days (restated, plus a trigger that holds even for a direct insert)
-- ---------------------------------------------------------------------------
create or replace function public.grant_credential_grace(p_staff uuid, p_kind text, p_days integer, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_max int := coalesce((private.credential_rule('grace_max_days'))::int, 14); v_id uuid;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can grant a grace period' using errcode = '42501'; end if;
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

create function private.guard_credential_grace() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_max int := coalesce((private.credential_rule('grace_max_days'))::int, 14); v_profile uuid;
begin
  if new.ends_at > new.starts_at + make_interval(days => v_max) then
    raise exception 'a grace period is at most % days', v_max using errcode = '23514';
  end if;
  select profile_id into v_profile from public.clinical_staff where id = new.clinical_staff_id;
  if v_profile is not null and new.granted_by = v_profile then
    raise exception 'a grace period cannot be granted to yourself' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_credential_grace() from public, anon, authenticated;
create trigger credential_grace_periods_guard before insert on public.credential_grace_periods
  for each row execute function private.guard_credential_grace();

-- ---------------------------------------------------------------------------
-- 5. The nightly sweep: adds the proof-of-renewal deadline notice (restated from the i18n migration; the notice windows come from config)
-- ---------------------------------------------------------------------------
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
  v_rows int := 0; v_suspended int := 0; v_missing int := 0; v_errors int := 0; v_proof int := 0;
  v_label text; v_msg text; v_inserted boolean;
  v_date_str text; v_i18n_key text;
  v_cycle jsonb := private.credential_rule('renewal_cycle'); v_cycle_end date; v_deadline date;
begin
  if v_cycle is not null and jsonb_typeof(v_cycle) = 'object' then
    v_cycle_end := make_date(extract(year from v_today)::int, (v_cycle ->> 'cycle_end_month')::int, (v_cycle ->> 'cycle_end_day')::int);
    v_deadline := make_date(extract(year from v_today)::int, (v_cycle ->> 'proof_deadline_month')::int, (v_cycle ->> 'proof_deadline_day')::int);
  end if;
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
          -- the proof-of-renewal deadline: past it, and the licence still ends with this cycle, the clinician and the reviewers are told once (window -1)
          if v_kind = 'licence' and v_deadline is not null and v_today >= v_deadline and (v_exp at time zone 'Africa/Lagos')::date <= v_cycle_end then
            insert into public.credential_expiry_notices (organisation_id, clinical_staff_id, kind, expires_on, window_days)
              values (r.organisation_id, r.id, v_kind, (v_exp at time zone 'Africa/Lagos')::date, -1) on conflict do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              perform private.credential_notify(r.profile_id, r.organisation_id, 'Your licence renewal proof is due',
                format('The date for proof of your renewed %s has passed. Please upload it under Training and profile so your access is not paused.', v_label),
                jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind, 'i18n_key', 'credential.renewal_proof_overdue', 'i18n_params', jsonb_build_object('label', v_label)), true);
              perform private.credential_notify_reviewers(r.organisation_id, 'Clinician renewal proof overdue',
                format('%s: proof of renewal for the %s has not been recorded.', r.full_name, v_label),
                jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind));
              v_proof := v_proof + 1;
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
  return jsonb_build_object('suspended', v_suspended, 'missing_dates', v_missing, 'proof_overdue_notices', v_proof, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Availability: nobody can declare hours that start after their licence or indemnity ends (restated from S18, plus one rule)
-- ---------------------------------------------------------------------------
create or replace function private.availability_s18_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into cs from public.clinical_staff where profile_id = new.clinician_id;
    if extract(epoch from (new.ends_at - new.starts_at)) / 3600.0 < (private.lead_rule('block_min_hours') #>> '{}')::numeric then
      raise exception 'availability_too_short' using errcode = '22023';
    end if;
    if new.kind = 'on_call' and not private.has_competency(new.clinician_id, 'on_call') then
      raise exception 'availability_needs_on_call_competency' using errcode = '42501';
    end if;
    if new.state <> 'cancelled' and private.clinician_on_leave_during(new.clinician_id, new.starts_at, new.ends_at) then
      raise exception 'availability_during_leave' using errcode = '22023';
    end if;
    -- decision 8: no hours on a day the licence or indemnity no longer covers (grace periods still count)
    if new.state <> 'cancelled' and cs.id is not null and not private.clinician_is_eligible(new.clinician_id, new.starts_at) then
      raise exception 'availability_after_credential_expiry' using errcode = '22023';
    end if;
    new.minimum_guarantee_eligible := coalesce(cs.employment_type = 'contracted', false)
      and (private.lead_rule('minimum_guarantee_kinds') ? new.kind);
  elsif new.state = 'cancelled' and old.state <> 'cancelled' and new.kind = 'on_call'
        and coalesce(current_setting('tarragon.lead_write', true), '') <> 'on'
        and exists (select 1 from public.on_call_rota r
          where r.cancelled_at is null and r.ends_at > now() and r.starts_at < new.ends_at and r.ends_at > new.starts_at
            and (r.primary_clinician_id = new.clinician_id or r.backup_clinician_id = new.clinician_id)) then
    raise exception 'availability_on_the_rota: ask for a swap instead' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The nightly net: rota-only clinicians, lead patients, and shifts that start after the licence or indemnity ends
-- ---------------------------------------------------------------------------
-- Future shifts that start after the person's cover ends. A clinician who is still eligible today keeps today's work.
create function private.trim_future_shifts_after_expiry() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c record; rr public.on_call_rota%rowtype; v_blocks integer := 0; v_rota integer := 0; v_n integer; v_errors integer := 0; v_orgs uuid[] := '{}'; v_changed boolean;
begin
  for c in select cs.profile_id, cs.organisation_id from public.clinical_staff cs where cs.active and cs.status = 'active' and cs.profile_id is not null loop
    begin
      v_changed := false;
      perform set_config('tarragon.lead_write', 'on', true);
      update public.availability_blocks set state = 'cancelled'
       where clinician_id = c.profile_id and state <> 'cancelled' and starts_at > now() and not private.clinician_is_eligible(c.profile_id, starts_at);
      get diagnostics v_n = row_count;
      v_blocks := v_blocks + v_n; v_changed := v_changed or v_n > 0;
      for rr in select * from public.on_call_rota where cancelled_at is null and starts_at > now()
                 and (primary_clinician_id = c.profile_id or backup_clinician_id = c.profile_id)
                 and not private.clinician_is_eligible(c.profile_id, starts_at) for update loop
        update public.rota_swaps set state = 'cancelled' where rota_id = rr.id and state in ('requested', 'accepted');
        if rr.backup_clinician_id = c.profile_id then
          update public.on_call_rota set backup_clinician_id = null where id = rr.id;
        elsif rr.backup_clinician_id is not null and private.clinician_is_eligible(rr.backup_clinician_id, rr.starts_at)
              and private.clinician_is_eligible(rr.backup_clinician_id, rr.ends_at) then
          update public.on_call_rota set primary_clinician_id = rr.backup_clinician_id, backup_clinician_id = null where id = rr.id;
        else
          update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'licence or indemnity ends before the shift' where id = rr.id;
        end if;
        v_rota := v_rota + 1; v_changed := true;
        if not c.organisation_id = any (v_orgs) then v_orgs := v_orgs || c.organisation_id; end if;
      end loop;
      perform set_config('tarragon.lead_write', 'off', true);
      if v_changed then
        perform private.credential_notify(c.profile_id, c.organisation_id, 'Some future shifts were removed',
          'Some of your future shifts were removed because your licence or indemnity ends before they start. Upload your renewed document under Training and profile to be scheduled again.',
          jsonb_build_object('i18n_key', 'credential.shifts_removed'), false);
      end if;
    exception when others then
      perform set_config('tarragon.lead_write', 'off', true);
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (c.organisation_id, 'clinician.removal_error', 'profile', c.profile_id, jsonb_build_object('error', sqlerrm, 'step', 'trim_future_shifts'));
    end;
  end loop;
  for c in select unnest(v_orgs) as org loop
    begin perform private.rota_gap_alert(c.org); exception when others then v_errors := v_errors + 1; end;
  end loop;
  return jsonb_build_object('blocks_cancelled', v_blocks, 'rota_rows_changed', v_rota, 'errors', v_errors);
end;
$$;
revoke all on function private.trim_future_shifts_after_expiry() from public, anon, authenticated;

create or replace function private.remove_ineligible_from_work() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_removed integer := 0; v_errors integer := 0; v_trim jsonb;
begin
  for r in select cs.profile_id, cs.organisation_id, cs.id from public.clinical_staff cs
            where cs.profile_id is not null and not private.clinician_is_eligible(cs.profile_id)
              and (exists (select 1 from public.task_claims c where c.clinician_id = cs.profile_id and c.ended_at is null)
                or exists (select 1 from public.availability_blocks b where b.clinician_id = cs.profile_id and b.state <> 'cancelled' and b.ends_at > now())
                or exists (select 1 from public.clinical_tasks t where t.state = 'offered_to_lead' and (t.pushed_to = cs.profile_id or t.lead_clinician_id = cs.profile_id))
                -- Q6: rota-only clinicians (on the on-call rota, no claim and no block) and anyone who still leads patients were outside this net
                or exists (select 1 from public.on_call_rota o where o.cancelled_at is null and o.ends_at > now()
                             and (o.primary_clinician_id = cs.profile_id or o.backup_clinician_id = cs.profile_id))
                or exists (select 1 from public.lead_assignments la where la.clinician_id = cs.profile_id and la.state = 'active')) loop
    begin
      perform private.remove_clinician_from_work(r.profile_id, 'not eligible at the nightly check');
      v_removed := v_removed + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'remove_ineligible_from_work failed for %: %', r.profile_id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinician.removal_error', 'clinical_staff', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  v_trim := private.trim_future_shifts_after_expiry();
  v_errors := v_errors + coalesce((v_trim ->> 'errors')::integer, 0);
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'removal_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'Removing ineligible clinicians from work failed for some',
            format('%s clinician(s) could not be removed by private.remove_ineligible_from_work(); see audit_log action clinician.removal_error. They may still hold queue or rota slots.', v_errors),
            'removal_sweep', now(), now());
  end if;
  return jsonb_build_object('removed', v_removed, 'shifts_trimmed', v_trim, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.record_credential_verification(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_credential_verification(uuid, text, text, text, timestamptz) to authenticated;
revoke all on function public.grant_credential_grace(uuid, text, integer, text), public.renew_clinician_credential(uuid, text, timestamptz, uuid), public.my_credential_status() from public, anon, authenticated;
grant execute on function public.grant_credential_grace(uuid, text, integer, text), public.renew_clinician_credential(uuid, text, timestamptz, uuid), public.my_credential_status() to authenticated;

do $$
begin
  if exists (select 1 from public.credentialing_config where version = 3 and is_active) then
    raise exception 'S20 v2: credentialing_config version 3 must be created inactive';
  end if;
  if has_function_privilege('anon', 'public.record_credential_verification(uuid, text, text, text, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.trim_future_shifts_after_expiry()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.clinician_is_eligible(uuid, timestamptz)', 'EXECUTE')
     or has_table_privilege('anon', 'public.credential_verifications', 'SELECT') or has_table_privilege('authenticated', 'public.credential_verifications', 'INSERT') then
    raise exception 'S20 v2 licence grants are wrong';
  end if;
end $$;
