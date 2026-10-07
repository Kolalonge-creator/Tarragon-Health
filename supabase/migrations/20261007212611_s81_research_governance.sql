-- S81 (Module 26, research and evidence governance; decision 4: schema, consent function, and an export that is dark by default).
--
-- 26.1 Research consent is its own consent type, off by default. private.research_eligible(patient, protocol) is the ONE test every export uses:
--      research consent granted and not withdrawn, data_processing consent granted, not a test account. Withdrawal takes effect on the next export.
-- 26.2 research_protocols: ethics approval reference, ethics body and date, data-sharing agreement, recipient (never a commercial recipient), the
--      field allow-list, the de-identification method and a minimum cell size of at least 20 (the S38 rule). A protocol is approved only when the
--      CMO and the data protection officer have both approved it, and an approved protocol cannot be edited (a new one is drafted instead).
--      run_research_export(): CMO only, guard research_export_enabled must be ON, protocol approved. Reads only analytics.v_outcome_snapshots,
--      keeps only consented patients, re-keys each participant per protocol (a protocol cannot be joined to another by id), coarsens the computed date
--      to its month, drops organisation, and refuses to release fewer than the minimum number of participants. It stores no data: research_exports
--      records the row count, the fields, a SHA-256 of the released rows, who and when. Every export writes audit_log and the event research_export.created.
-- 26.3 research_evaluations: a question, primary outcome and analysis plan registered (OSF, ClinicalTrials.gov or WHO ICTRP link) and locked before
--      any result can be recorded; a negative result is recorded the same way as a positive one.
-- 26.4 No sale or licensing of health data: recipient_type has no commercial value and there is no price column; the recipient must be an academic,
--      public health, NGO, regulator or internal-quality body.
-- Counts at write time: no research consent rows are read by any code path today, so no data moves. The guard starts OFF.

-- 1. Guard and its conditions
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('research_export_enabled', 'Research export', 'Any de-identified research export',
   'An approved research protocol; counsel has cleared the basis for the recipient; the data protection officer appointment is on record', 'cmo',
   array['run_research_export'], 'Nothing else reads research data.')
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION private.go_live_conditions(p_key text, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_n integer;
  v_gaps integer;
begin
  if p_key = 'clinical_operations_enabled' then
    -- the approved hypertension protocol is a public.protocols row (S24) whose code starts htn or hypertension (the S24 placeholder is htn_hearts_ng)
    select count(*) into v_n from public.protocols where status = 'approved' and code ~ '^(htn|hypertension)';
    return jsonb_build_array(
      private.go_live_cond('hypertension_protocol_approved', 'An approved hypertension protocol', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('triage_rule_set_approved', 'An approved blood pressure triage rule set',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage'), 'data',
        (select count(*) from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage') || ' approved'),
      private.go_live_cond('tier2_clinician_active', 'At least one active tier 2 clinician',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) > 0, 'data',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) || ' active'),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'on_call_cover_ok' then
    select count(*) into v_gaps from private.rota_gaps(p_org, now(), now() + interval '7 days');
    return jsonb_build_array(
      private.go_live_cond('rota_covers_next_7_days', 'The rota covers the next 7 days with a primary and an eligible backup', v_gaps = 0, 'data', v_gaps || ' gaps'));
  elsif p_key = 'lab_booking_enabled' then
    return jsonb_build_array(
      private.go_live_cond('synlab_active', 'SYNLAB is an active laboratory partner',
        exists (select 1 from public.lab_providers where is_active and name ilike 'synlab%'), 'data', null),
      private.go_live_cond('collection_sites', 'SYNLAB has at least one active collection site',
        exists (select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.is_active and p.is_active and p.name ilike 'synlab%'), 'data', null),
      private.go_live_cond('results_flow_tested', 'The results flow has been tested end to end', private.go_live_attested(p_key, 'results_flow_tested'), 'attestation', null));
  elsif p_key = 'prescribing_enabled' then
    select count(*) into v_n from public.pharmacy_partners where is_active and onboarding_status = 'activated';
    -- S28c: sending a prescription to a pharmacy also needs a pharmacy people can actually choose today (active, approved, licence verified and
    -- unexpired, with a verified location), the collection rules confirmed by their owner, and the notification sender deployed.
    return jsonb_build_array(
      private.go_live_cond('pharmacy_partner_active', 'At least one active pharmacy partner', v_n > 0, 'data', v_n || ' active'),
      private.go_live_cond('pharmacy_licence_current', 'At least one approved pharmacy with a current, verified licence and a verified location',
        exists (select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)), 'data',
        (select count(distinct pp.id) from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)) || ' can be chosen'),
      private.go_live_cond('pharmacy_rules_confirmed', 'The pharmacy collection rules are confirmed',
        coalesce((select s.decision = 'confirmed' from public.proposed_config_signoffs s
                   where s.config_key = 'pharmacy.collection_rules'
                     and s.config_version = (select c.version from public.pharmacy_config c where c.is_active)
                   order by s.id desc limit 1), false), 'data', null),
      private.go_live_cond('notification_sender_deployed', 'The notification sender with the pharmacy messages is deployed',
        private.go_live_attested(p_key, 'notification_sender_deployed'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'research_export_enabled' then
    select count(*) into v_n from public.research_protocols where status = 'approved';
    return jsonb_build_array(
      private.go_live_cond('approved_protocol_exists', 'At least one approved research protocol (ethics approval, data-sharing agreement, CMO and data protection officer approval)', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('counsel_cross_border_cleared', 'Counsel has cleared the legal basis for the recipient and any transfer abroad', private.go_live_attested(p_key, 'counsel_cross_border_cleared'), 'attestation', null),
      private.go_live_cond('dpo_registered', 'The data protection officer appointment is on record with NDPC', private.go_live_attested(p_key, 'dpo_registered'), 'attestation', null));
  elsif p_key = 'scribe_enabled' then
    return jsonb_build_array(
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('con001_legal_review_recorded', 'Legal review of consent text CON-001 recorded', private.go_live_attested(p_key, 'con001_legal_review_recorded'), 'attestation', null),
      private.go_live_cond('speech_provider_configured', 'A speech-to-text provider is configured', private.go_live_attested(p_key, 'speech_provider_configured'), 'attestation', null));
  elsif p_key = 'payouts_enabled' then
    return jsonb_build_array(
      private.go_live_cond('fee_schedule_approved', 'A fee schedule is approved', private.go_live_attested(p_key, 'fee_schedule_approved'), 'attestation', null),
      private.go_live_cond('paystack_transfers_configured', 'Paystack transfers are configured', private.go_live_attested(p_key, 'paystack_transfers_configured'), 'attestation', null));
  elsif p_key = 'public_signup_enabled' then
    return jsonb_build_array(
      private.go_live_cond('stage2_exit_criteria_met', 'The Stage 2 exit criteria are met', private.go_live_attested(p_key, 'stage2_exit_criteria_met'), 'attestation', null));
  end if;
  -- An unknown key has no conditions, and a guard with no conditions is never satisfied (fail closed).
  return jsonb_build_array(private.go_live_cond('unknown_guard', 'This guard has no defined condition', false, 'data', null));
end $function$;

-- 2. Tables
create type public.research_protocol_status as enum ('draft', 'approved', 'closed');

create table public.research_protocols (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  title text not null check (length(title) between 5 and 200),
  question text not null check (length(question) >= 20),
  dataset_code text not null check (dataset_code in ('outcome_snapshots_v1')),
  allowed_fields text[] not null check (cardinality(allowed_fields) > 0),
  de_identification_method text not null check (length(de_identification_method) >= 20),
  min_cell_size integer not null default 20 check (min_cell_size >= 20),
  recipient_name text not null check (length(recipient_name) >= 3),
  recipient_type text not null check (recipient_type in ('academic', 'public_health_body', 'ngo', 'regulator', 'internal_quality')),
  ethics_approval_ref text,
  ethics_body text,
  ethics_approved_on date,
  data_sharing_agreement_ref text,
  status public.research_protocol_status not null default 'draft',
  cmo_approved_by uuid references public.profiles(id),
  cmo_approved_at timestamptz,
  dpo_confirmed_by uuid references public.profiles(id),
  dpo_confirmed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (status <> 'approved' or (
    ethics_approval_ref is not null and length(ethics_approval_ref) >= 4
    and ethics_body is not null and length(ethics_body) >= 3
    and ethics_approved_on is not null
    and data_sharing_agreement_ref is not null and length(data_sharing_agreement_ref) >= 4
    and cmo_approved_by is not null and dpo_confirmed_by is not null))
);
alter table public.research_protocols enable row level security;
revoke all on public.research_protocols from anon, authenticated;

create table public.research_exports (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.research_protocols(id),
  organisation_id uuid not null references public.organisations(id),
  requested_by uuid not null references public.profiles(id),
  row_count integer not null check (row_count >= 0),
  participant_count integer not null check (participant_count >= 0),
  fields text[] not null,
  content_sha256 text not null check (length(content_sha256) = 64),
  created_at timestamptz not null default now()
);
alter table public.research_exports enable row level security;
revoke all on public.research_exports from anon, authenticated;
comment on table public.research_exports is 'S81: the audit of each de-identified export. It stores no released data and has no price or licence column (26.4: no sale or licensing of health data).';

create table public.research_evaluations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  protocol_id uuid references public.research_protocols(id),
  title text not null check (length(title) >= 5),
  question text not null check (length(question) >= 20),
  primary_outcome text not null check (length(primary_outcome) >= 10),
  analysis_plan text not null check (length(analysis_plan) >= 40),
  registration_url text not null check (registration_url ~ '^https://(www\.)?(osf\.io|clinicaltrials\.gov|trialsearch\.who\.int|anzctr\.org\.au|isrctn\.com)/'),
  registered_at date not null,
  locked_at timestamptz,
  results_summary text,
  is_negative_result boolean,
  results_recorded_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (results_summary is null or locked_at is not null),
  check ((results_summary is null) = (is_negative_result is null))
);
alter table public.research_evaluations enable row level security;
revoke all on public.research_evaluations from anon, authenticated;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('research_export.created', 'A de-identified research export was released under an approved protocol', 'S81', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('research_export.created', 1, array['export_id', 'protocol_id', 'row_count'])
on conflict (event_type, version) do nothing;

-- 3. An approved protocol is frozen
create or replace function private.research_protocol_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved' and (
       new.allowed_fields is distinct from old.allowed_fields or new.recipient_name is distinct from old.recipient_name
    or new.recipient_type is distinct from old.recipient_type or new.dataset_code is distinct from old.dataset_code
    or new.ethics_approval_ref is distinct from old.ethics_approval_ref or new.data_sharing_agreement_ref is distinct from old.data_sharing_agreement_ref
    or new.de_identification_method is distinct from old.de_identification_method or new.min_cell_size is distinct from old.min_cell_size) then
    raise exception 'an approved research protocol cannot be edited: draft a new one';
  end if;
  return new;
end $$;
create trigger research_protocols_frozen before update on public.research_protocols
  for each row execute function private.research_protocol_frozen();

-- 4. The one eligibility test
create or replace function private.research_eligible(p_patient uuid, p_protocol uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patient_consent_state c where c.patient_id = p_patient and c.consent_type_code = 'research' and c.granted and c.withdrawn_at is null)
     and exists (select 1 from public.patient_consent_state c where c.patient_id = p_patient and c.consent_type_code = 'data_processing' and c.granted and c.withdrawn_at is null)
     and not coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), true)
$$;
revoke all on function private.research_eligible(uuid, uuid) from public, anon;
grant execute on function private.research_eligible(uuid, uuid) to authenticated, service_role;

-- 5. Protocol register
create or replace function private.research_fields_ok(p_fields text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_fields <@ array['pathway_code', 'day', 'enrolment_month', 'bp_avg_7d_sys', 'bp_avg_7d_dia', 'bp_readings_7d', 'bp_status',
                           'target_source', 'adherence_pct', 'adherence_doses_due', 'config_version', 'computed_month']::text[]
$$;

create or replace function public.create_research_protocol(
  p_title text, p_question text, p_allowed_fields text[], p_de_identification_method text, p_recipient_name text, p_recipient_type text,
  p_ethics_approval_ref text, p_ethics_body text, p_ethics_approved_on date, p_data_sharing_agreement_ref text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer drafts a research protocol' using errcode = '42501'; end if;
  if not private.research_fields_ok(p_allowed_fields) then raise exception 'a field is not on the research allow-list (identifiers, organisation and exact dates are never allowed)'; end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  if v_org is null then raise exception 'the acting profile has no organisation'; end if;
  insert into public.research_protocols (organisation_id, title, question, dataset_code, allowed_fields, de_identification_method, recipient_name, recipient_type,
    ethics_approval_ref, ethics_body, ethics_approved_on, data_sharing_agreement_ref, created_by)
  values (v_org, p_title, p_question, 'outcome_snapshots_v1', p_allowed_fields, p_de_identification_method, p_recipient_name, p_recipient_type,
    nullif(trim(p_ethics_approval_ref), ''), nullif(trim(p_ethics_body), ''), p_ethics_approved_on, nullif(trim(p_data_sharing_agreement_ref), ''), v_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_research_protocol(p_id uuid) returns public.research_protocol_status
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_row public.research_protocols%rowtype;
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer approves a research protocol' using errcode = '42501'; end if;
  update public.research_protocols set cmo_approved_by = v_actor, cmo_approved_at = now()
    where id = p_id and status = 'draft' returning * into v_row;
  if not found then raise exception 'protocol not found or not a draft'; end if;
  if v_row.dpo_confirmed_by is not null then
    update public.research_protocols set status = 'approved' where id = p_id;
    return 'approved';
  end if;
  return 'draft';
end $$;

create or replace function public.confirm_research_protocol_dpo(p_id uuid) returns public.research_protocol_status
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_row public.research_protocols%rowtype;
begin
  if not private.is_admin() then raise exception 'not authorised: the data protection officer confirms through an admin account' using errcode = '42501'; end if;
  update public.research_protocols set dpo_confirmed_by = v_actor, dpo_confirmed_at = now()
    where id = p_id and status = 'draft' returning * into v_row;
  if not found then raise exception 'protocol not found or not a draft'; end if;
  if v_row.cmo_approved_by is not null then
    update public.research_protocols set status = 'approved' where id = p_id;
    return 'approved';
  end if;
  return 'draft';
end $$;

create or replace function public.research_protocols_list()
returns table (id uuid, title text, recipient_name text, recipient_type text, status public.research_protocol_status,
               ethics_approval_ref text, data_sharing_agreement_ref text, cmo_approved boolean, dpo_confirmed boolean,
               export_count bigint, can_approve boolean, can_confirm_dpo boolean, can_export boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_active_clinical_director() or private.is_admin()) then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select p.id, p.title, p.recipient_name, p.recipient_type, p.status, p.ethics_approval_ref, p.data_sharing_agreement_ref,
         p.cmo_approved_by is not null, p.dpo_confirmed_by is not null,
         (select count(*) from public.research_exports e where e.protocol_id = p.id),
         private.is_active_clinical_director() and p.status = 'draft' and p.cmo_approved_by is null,
         private.is_admin() and p.status = 'draft' and p.dpo_confirmed_by is null,
         private.is_active_clinical_director() and p.status = 'approved' and private.go_live_guard_on('research_export_enabled')
  from public.research_protocols p order by p.created_at desc;
end $$;

-- 6. The export
create or replace function public.run_research_export(p_protocol_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_p public.research_protocols%rowtype;
  v_rows jsonb;
  v_n integer; v_people integer; v_hash text; v_id uuid;
  v_all text[] := array['pathway_code', 'day', 'enrolment_month', 'bp_avg_7d_sys', 'bp_avg_7d_dia', 'bp_readings_7d', 'bp_status',
                        'target_source', 'adherence_pct', 'adherence_doses_due', 'config_version', 'computed_month'];
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer runs a research export' using errcode = '42501'; end if;
  if not private.go_live_guard_on('research_export_enabled') then raise exception 'research export is switched off'; end if;
  select * into v_p from public.research_protocols where id = p_protocol_id and status = 'approved';
  if not found then raise exception 'the protocol is missing or not approved'; end if;
  if not (v_p.allowed_fields <@ v_all) then raise exception 'the protocol lists a field that is not on the allow-list'; end if;

  with elig as (
    select o.*, s.patient_id
    from analytics.v_outcome_snapshots o
    join analytics.subjects s on s.subject_key = o.subject_key
    where o.organisation_id = v_p.organisation_id and private.research_eligible(s.patient_id, v_p.id)
  ), shaped as (
    select encode(extensions.digest(e.subject_key::text || ':' || v_p.id::text, 'sha256'), 'hex') as participant,
           to_jsonb(e) || jsonb_build_object('computed_month', date_trunc('month', e.computed_on::timestamp)::date) as j
    from elig e
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('participant', participant) ||
           (select coalesce(jsonb_object_agg(k, sh.j -> k), '{}'::jsonb) from unnest(v_p.allowed_fields) k)
           order by participant), '[]'::jsonb),
         count(*), count(distinct participant)
  into v_rows, v_n, v_people
  from shaped sh;

  if v_people < v_p.min_cell_size then
    raise exception 'too few participants to release (% found, at least % needed): nothing was exported', v_people, v_p.min_cell_size;
  end if;
  v_hash := encode(extensions.digest(v_rows::text, 'sha256'), 'hex');
  insert into public.research_exports (protocol_id, organisation_id, requested_by, row_count, participant_count, fields, content_sha256)
  values (v_p.id, v_p.organisation_id, v_actor, v_n, v_people, v_p.allowed_fields, v_hash) returning id into v_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (v_actor, 'research_export.created', 'research_exports', v_id,
          jsonb_build_object('protocol_id', v_p.id, 'row_count', v_n, 'participant_count', v_people, 'sha256', v_hash));
  perform private.emit_domain_event('research_export.created', v_p.organisation_id,
    jsonb_build_object('export_id', v_id, 'protocol_id', v_p.id, 'row_count', v_n),
    'research_export.created:' || v_id, null, 'research_exports', v_id);
  return jsonb_build_object('export_id', v_id, 'fields', to_jsonb(v_p.allowed_fields), 'rows', v_rows, 'sha256', v_hash);
end $$;

-- 7. Pre-registered evaluations
create or replace function public.register_research_evaluation(
  p_title text, p_question text, p_primary_outcome text, p_analysis_plan text, p_registration_url text, p_registered_at date, p_protocol_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  if v_org is null then raise exception 'the acting profile has no organisation'; end if;
  insert into public.research_evaluations (organisation_id, protocol_id, title, question, primary_outcome, analysis_plan, registration_url, registered_at, created_by)
  values (v_org, p_protocol_id, p_title, p_question, p_primary_outcome, p_analysis_plan, p_registration_url, p_registered_at, v_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.lock_research_evaluation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised' using errcode = '42501'; end if;
  update public.research_evaluations set locked_at = now() where id = p_id and locked_at is null;
  if not found then raise exception 'evaluation not found or already locked'; end if;
end $$;

create or replace function public.record_research_evaluation_result(p_id uuid, p_summary text, p_is_negative boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised' using errcode = '42501'; end if;
  if coalesce(length(trim(p_summary)), 0) < 20 then raise exception 'a result summary of at least 20 characters is required, negative results included'; end if;
  update public.research_evaluations set results_summary = p_summary, is_negative_result = p_is_negative, results_recorded_at = now()
    where id = p_id and locked_at is not null and results_summary is null;
  if not found then raise exception 'evaluation not found, not yet locked (registered plan is locked before any result), or a result is already recorded'; end if;
end $$;

-- 8. Grants: authenticated callers only, never anon or the public pseudo-role
revoke execute on function public.create_research_protocol(text, text, text[], text, text, text, text, text, date, text) from public;
revoke execute on function public.approve_research_protocol(uuid) from public;
revoke execute on function public.confirm_research_protocol_dpo(uuid) from public;
revoke execute on function public.research_protocols_list() from public;
revoke execute on function public.run_research_export(uuid) from public;
revoke execute on function public.register_research_evaluation(text, text, text, text, text, date, uuid) from public;
revoke execute on function public.lock_research_evaluation(uuid) from public;
revoke execute on function public.record_research_evaluation_result(uuid, text, boolean) from public;
revoke all on function private.research_fields_ok(text[]) from public, anon;
revoke all on function private.research_protocol_frozen() from public, anon, authenticated;
grant execute on function public.create_research_protocol(text, text, text[], text, text, text, text, text, date, text) to authenticated;
grant execute on function public.approve_research_protocol(uuid) to authenticated;
grant execute on function public.confirm_research_protocol_dpo(uuid) to authenticated;
grant execute on function public.research_protocols_list() to authenticated;
grant execute on function public.run_research_export(uuid) to authenticated;
grant execute on function public.register_research_evaluation(text, text, text, text, text, date, uuid) to authenticated;
grant execute on function public.lock_research_evaluation(uuid) to authenticated;
grant execute on function public.record_research_evaluation_result(uuid, text, boolean) to authenticated;
grant execute on function private.research_fields_ok(text[]) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.run_research_export(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_research_protocol(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.research_protocols_list()', 'EXECUTE')
     or has_function_privilege('anon', 'private.research_eligible(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_research_protocol(text, text, text[], text, text, text, text, text, date, text)', 'EXECUTE') then
    raise exception 'anon must not execute the S81 functions';
  end if;
  if has_table_privilege('authenticated', 'public.research_exports', 'SELECT') or has_table_privilege('authenticated', 'public.research_protocols', 'SELECT') then
    raise exception 'research tables are read only through the functions';
  end if;
end $$;
