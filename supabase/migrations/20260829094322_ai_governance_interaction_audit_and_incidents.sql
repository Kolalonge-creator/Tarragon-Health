-- see supabase/migrations/20260829095431_ai_governance_interaction_audit_and_incidents.sql
create type public.ai_output_flag as enum (
  'unsupported_claim',
  'incorrect_medical_information',
  'fabricated_citation',
  'inappropriate_recommendation',
  'out_of_scope_population',
  'guardrail_bypass_attempt'
);

comment on type public.ai_output_flag is
  'Hallucination and output-quality monitoring categories (40.8). Set on ai_interaction_log by automated post-checks or by a reviewer; the same vocabulary a clinician uses when reporting an AI safety incident.';

create type public.ai_interaction_status as enum ('completed', 'blocked', 'fallback', 'failed');

comment on type public.ai_interaction_status is
  'completed = the AI answered; blocked = a guardrail suppressed the output; fallback = the AI was unavailable or switched off and the non-AI path ran (40.18); failed = the call errored and nothing was returned.';

create type public.ai_incident_category as enum (
  'incorrect_information',
  'unsupported_claim',
  'fabricated_citation',
  'inappropriate_recommendation',
  'missed_escalation',
  'guardrail_bypass',
  'privacy_concern',
  'availability_failure',
  'unexpected_model_change',
  'other'
);

create type public.ai_incident_severity as enum ('low', 'moderate', 'high', 'critical');

create type public.ai_incident_status as enum ('open', 'triaged', 'investigating', 'resolved', 'dismissed');

comment on type public.ai_incident_status is
  'An incident is closed by a clinician, never by the reporter. ''dismissed'' still requires a recorded clinical review -- it means "reviewed and found not to be a safety problem", not "ignored".';

create table public.ai_interaction_log (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  ai_system_id          uuid not null references public.ai_systems (id) on delete restrict,
  ai_system_version_id  uuid references public.ai_system_versions (id) on delete set null,
  prompt_version_id     uuid references public.ai_prompt_versions (id) on delete set null,
  model_identifier      text not null,
  subject_profile_id    uuid references public.profiles (id) on delete set null,
  actor_profile_id      uuid references public.profiles (id) on delete set null,
  input_category        text not null,
  output_summary        text check (output_summary is null or char_length(output_summary) <= 4000),
  safety_classification public.alert_level,
  status                public.ai_interaction_status not null,
  guardrails_triggered  text[] not null default '{}'::text[],
  output_flags          public.ai_output_flag[] not null default '{}'::public.ai_output_flag[],
  flagged_for_review    boolean not null default false,
  human_override        boolean not null default false,
  human_override_by     uuid references public.profiles (id) on delete set null,
  human_override_at     timestamptz,
  human_override_note   text,
  resulting_action      text,
  resulting_entity_type text,
  resulting_entity_id   uuid,
  fallback_used         boolean not null default false,
  fallback_reason       text,
  latency_ms            integer check (latency_ms is null or latency_ms >= 0),
  input_token_count     integer check (input_token_count is null or input_token_count >= 0),
  output_token_count    integer check (output_token_count is null or output_token_count >= 0),
  error_message         text,
  created_at            timestamptz not null default now(),

  constraint ai_interaction_log_override_paired
    check (human_override = (human_override_at is not null)),
  constraint ai_interaction_log_override_actor
    check (human_override_at is null or human_override_by is not null),
  constraint ai_interaction_log_fallback_reason
    check (not fallback_used or fallback_reason is not null),
  constraint ai_interaction_log_status_matches_fallback
    check ((status = 'fallback') = fallback_used)
);

comment on table public.ai_interaction_log is
  'The clinical AI audit trail (40.11): one row per clinically meaningful AI interaction, carrying the model and version that answered, the governed prompt in force, the input category (never the raw input -- see the migration header), a bounded output summary, the safety classification, which guardrails fired, whether a human overrode it, and what happened as a result. Written only by public.record_ai_interaction(); there is deliberately no INSERT policy.';

comment on column public.ai_interaction_log.input_category is
  'A category, never the patient''s words. Raw conversation content stays in ai_conversations under the patient''s own RLS; this table is staff-readable governance data.';

comment on column public.ai_interaction_log.output_flags is
  'Hallucination-monitoring findings (40.8), set by automated post-checks or a reviewer. A non-empty array should normally coincide with flagged_for_review.';

create index ai_interaction_log_system_time_idx on public.ai_interaction_log (ai_system_id, created_at desc);
create index ai_interaction_log_org_time_idx on public.ai_interaction_log (organisation_id, created_at desc);
create index ai_interaction_log_subject_idx on public.ai_interaction_log (subject_profile_id, created_at desc)
  where subject_profile_id is not null;
create index ai_interaction_log_review_idx on public.ai_interaction_log (created_at desc)
  where flagged_for_review;
create index ai_interaction_log_override_idx on public.ai_interaction_log (ai_system_id, created_at desc)
  where human_override;

alter table public.ai_interaction_log enable row level security;

create policy ai_interaction_log_select on public.ai_interaction_log
  for select to authenticated
  using (subject_profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.ai_interaction_log to authenticated;

create table public.ai_interaction_sources (
  interaction_id      uuid not null references public.ai_interaction_log (id) on delete cascade,
  knowledge_source_id uuid not null references public.ai_knowledge_sources (id) on delete restrict,
  primary key (interaction_id, knowledge_source_id)
);

comment on table public.ai_interaction_sources is
  'Which approved knowledge sources (40.7) an AI answer was grounded in (40.11''s "retrieved sources"). ON DELETE RESTRICT on the source side deliberately: a source that has ever grounded a real answer cannot be deleted out from under the audit trail, only deactivated.';

create index ai_interaction_sources_source_idx on public.ai_interaction_sources (knowledge_source_id);

alter table public.ai_interaction_sources enable row level security;

create policy ai_interaction_sources_select on public.ai_interaction_sources
  for select to authenticated
  using (exists (
    select 1 from public.ai_interaction_log l
    where l.id = interaction_id
      and (l.subject_profile_id = (select auth.uid()) or private.is_org_staff(l.organisation_id))
  ));

grant select on public.ai_interaction_sources to authenticated;

create table public.ai_safety_incidents (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  ai_system_id            uuid not null references public.ai_systems (id) on delete restrict,
  interaction_id          uuid references public.ai_interaction_log (id) on delete set null,
  reported_by             uuid references public.profiles (id) on delete set null,
  reporter_kind           text not null check (reporter_kind in ('patient', 'clinician', 'staff', 'automated_monitor')),
  category                public.ai_incident_category not null,
  severity                public.ai_incident_severity not null default 'moderate',
  description             text not null,
  status                  public.ai_incident_status not null default 'open',
  triaged_by              uuid references public.clinical_staff (id) on delete restrict,
  triaged_at              timestamptz,
  clinical_review_summary text,
  patient_harm_occurred   boolean,
  harm_description        text,
  corrective_action       text,
  resolved_by             uuid references public.clinical_staff (id) on delete restrict,
  resolved_at             timestamptz,
  kill_switch_applied     boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint ai_safety_incidents_triage_paired check ((triaged_by is null) = (triaged_at is null)),
  constraint ai_safety_incidents_resolution_paired check ((resolved_by is null) = (resolved_at is null)),
  constraint ai_safety_incidents_closed_requires_review
    check (
      status not in ('resolved', 'dismissed')
      or (resolved_at is not null and clinical_review_summary is not null)
    ),
  constraint ai_safety_incidents_harm_described
    check (patient_harm_occurred is not true or harm_description is not null)
);

comment on table public.ai_safety_incidents is
  'AI safety incidents (40.12), raised by a patient, a clinician, staff, or an automated monitor (drift breach, unexpected vendor model change). Reported through public.report_ai_safety_incident(); triaged and closed only through the clinician-gated RPCs, so "resolved" always carries a real clinical review.';

comment on column public.ai_safety_incidents.severity is
  'Defaults to moderate on report. A reporter does not set severity -- triage does. Treating a patient''s "this was wrong" as automatically low would bury exactly the reports worth reading.';

create index ai_safety_incidents_open_idx on public.ai_safety_incidents (severity desc, created_at desc)
  where status in ('open', 'triaged', 'investigating');
create index ai_safety_incidents_system_idx on public.ai_safety_incidents (ai_system_id, created_at desc);
create index ai_safety_incidents_org_idx on public.ai_safety_incidents (organisation_id, created_at desc);

create trigger ai_safety_incidents_set_updated_at
  before update on public.ai_safety_incidents
  for each row execute function private.set_updated_at();

alter table public.ai_safety_incidents enable row level security;

create policy ai_safety_incidents_select on public.ai_safety_incidents
  for select to authenticated
  using (reported_by = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.ai_safety_incidents to authenticated;

create or replace function private.record_ai_model_observation(
  p_ai_system_id uuid,
  p_model_identifier text,
  p_organisation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_vendor   uuid;
  v_new      boolean := false;
begin
  select s.vendor_id into v_vendor from public.ai_systems s where s.id = p_ai_system_id;

  select v.model_identifier into v_expected
  from public.ai_system_versions v
  where v.ai_system_id = p_ai_system_id
    and v.approved_at is not null
    and v.retired_at is null
  order by v.deployed_at desc nulls last, v.approved_at desc
  limit 1;

  insert into public.ai_vendor_model_observations
    (ai_system_id, vendor_id, observed_model_identifier, expected_model_identifier, is_expected)
  values (
    p_ai_system_id, v_vendor, p_model_identifier, v_expected,
    v_expected is null or v_expected = p_model_identifier
  )
  on conflict (ai_system_id, observed_model_identifier) do update
    set last_seen_at = now(),
        observation_count = ai_vendor_model_observations.observation_count + 1,
        expected_model_identifier = excluded.expected_model_identifier
  returning (xmax = 0) into v_new;

  if v_new and v_expected is not null and v_expected <> p_model_identifier then
    insert into public.ai_safety_incidents
      (organisation_id, ai_system_id, reporter_kind, category, severity, description)
    values (
      p_organisation_id, p_ai_system_id, 'automated_monitor', 'unexpected_model_change', 'high',
      format(
        'The model answering for this AI system was %L, but the approved active version specifies %L. Either a vendor changed the underlying model without notice, or a deploy is running an unapproved model.',
        p_model_identifier, v_expected
      )
    );
  end if;
end;
$$;

comment on function private.record_ai_model_observation(uuid, text, uuid) is
  'Records which model actually answered and raises a one-off high-severity incident the first time it differs from the approved active version (40.19). Deliberately fires once per distinct model identifier, not once per request.';

revoke all on function private.record_ai_model_observation(uuid, text, uuid) from public, anon;

create or replace function public.record_ai_interaction(
  p_system_code           text,
  p_model_identifier      text,
  p_input_category        text,
  p_status                public.ai_interaction_status,
  p_subject_profile_id    uuid    default null,
  p_output_summary        text    default null,
  p_safety_classification public.alert_level default null,
  p_guardrails_triggered  text[]  default '{}'::text[],
  p_output_flags          public.ai_output_flag[] default '{}'::public.ai_output_flag[],
  p_prompt_version_id     uuid    default null,
  p_knowledge_source_ids  uuid[]  default '{}'::uuid[],
  p_resulting_action      text    default null,
  p_resulting_entity_type text    default null,
  p_resulting_entity_id   uuid    default null,
  p_fallback_reason       text    default null,
  p_latency_ms            integer default null,
  p_input_token_count     integer default null,
  p_output_token_count    integer default null,
  p_error_message         text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system  record;
  v_org     uuid;
  v_actor   uuid := (select auth.uid());
  v_version uuid;
  v_id      uuid;
  v_flag    boolean;
begin
  select s.id, s.clinically_meaningful into v_system
  from public.ai_systems s where s.system_code = p_system_code;

  if v_system.id is null then
    raise exception 'unknown AI system code % -- register it in ai_systems before calling it', p_system_code;
  end if;

  select organisation_id into v_org from public.profiles
  where id = coalesce(p_subject_profile_id, v_actor);

  if v_org is null then
    raise exception 'could not derive an organisation for this AI interaction';
  end if;

  if coalesce(p_subject_profile_id, v_actor) <> v_actor and not private.is_org_staff(v_org) then
    raise exception 'not authorised: cannot record an AI interaction about another organisation''s patient';
  end if;

  select v.id into v_version
  from public.ai_system_versions v
  where v.ai_system_id = v_system.id
    and v.approved_at is not null
    and v.retired_at is null
  order by v.deployed_at desc nulls last, v.approved_at desc
  limit 1;

  v_flag := array_length(p_output_flags, 1) is not null
            or p_safety_classification in ('urgent_escalation', 'emergency')
            or p_status = 'blocked';

  insert into public.ai_interaction_log (
    organisation_id, ai_system_id, ai_system_version_id, prompt_version_id,
    model_identifier, subject_profile_id, actor_profile_id, input_category,
    output_summary, safety_classification, status, guardrails_triggered,
    output_flags, flagged_for_review, resulting_action, resulting_entity_type,
    resulting_entity_id, fallback_used, fallback_reason, latency_ms,
    input_token_count, output_token_count, error_message
  ) values (
    v_org, v_system.id, v_version, p_prompt_version_id,
    p_model_identifier, p_subject_profile_id, v_actor, p_input_category,
    left(p_output_summary, 4000), p_safety_classification, p_status, coalesce(p_guardrails_triggered, '{}'),
    coalesce(p_output_flags, '{}'), v_flag, p_resulting_action, p_resulting_entity_type,
    p_resulting_entity_id, p_status = 'fallback',
    case when p_status = 'fallback' then coalesce(p_fallback_reason, 'unspecified') else p_fallback_reason end,
    p_latency_ms, p_input_token_count, p_output_token_count, p_error_message
  )
  returning id into v_id;

  if p_knowledge_source_ids is not null and array_length(p_knowledge_source_ids, 1) is not null then
    insert into public.ai_interaction_sources (interaction_id, knowledge_source_id)
    select v_id, sid
    from unnest(p_knowledge_source_ids) as sid
    where exists (select 1 from public.ai_knowledge_sources k where k.id = sid)
    on conflict do nothing;
  end if;

  if p_status <> 'fallback' then
    perform private.record_ai_model_observation(v_system.id, p_model_identifier, v_org);
  end if;

  return v_id;
end;
$$;

comment on function public.record_ai_interaction(text, text, text, public.ai_interaction_status, uuid, text, public.alert_level, text[], public.ai_output_flag[], uuid, uuid[], text, text, uuid, text, integer, integer, integer, text) is
  'The only way a row reaches ai_interaction_log (40.11). organisation_id and actor_profile_id are server-derived; output_summary is truncated to the 4,000-char governance bound; retrieved knowledge sources are linked; and the model that actually answered is checked against the approved version (40.19). Never pass raw patient input as p_input_category.';

revoke all on function public.record_ai_interaction(text, text, text, public.ai_interaction_status, uuid, text, public.alert_level, text[], public.ai_output_flag[], uuid, uuid[], text, text, uuid, text, integer, integer, integer, text) from public, anon;
grant execute on function public.record_ai_interaction(text, text, text, public.ai_interaction_status, uuid, text, public.alert_level, text[], public.ai_output_flag[], uuid, uuid[], text, text, uuid, text, integer, integer, integer, text) to authenticated;

create or replace function public.record_ai_human_override(
  p_interaction_id uuid,
  p_note text,
  p_resulting_action text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.ai_interaction_log where id = p_interaction_id;

  if v_org is null then
    raise exception 'AI interaction not found';
  end if;

  if not private.is_org_staff(v_org) then
    raise exception 'not authorised: only staff of the owning organisation can record an override';
  end if;

  update public.ai_interaction_log
     set human_override      = true,
         human_override_by   = (select auth.uid()),
         human_override_at   = now(),
         human_override_note = p_note,
         resulting_action    = coalesce(p_resulting_action, resulting_action)
   where id = p_interaction_id;

  return p_interaction_id;
end;
$$;

comment on function public.record_ai_human_override(uuid, text, text) is
  'Records that a human overrode an AI output (40.11). The override rate per system is the measured version of "the human is genuinely in the loop", and it is the headline number on the governance dashboard for that reason.';

revoke all on function public.record_ai_human_override(uuid, text, text) from public, anon;
grant execute on function public.record_ai_human_override(uuid, text, text) to authenticated;

create or replace function public.report_ai_safety_incident(
  p_system_code    text,
  p_category       public.ai_incident_category,
  p_description    text,
  p_interaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system_id uuid;
  v_actor     uuid := (select auth.uid());
  v_role      public.user_role;
  v_org       uuid;
  v_kind      text;
  v_id        uuid;
begin
  if v_actor is null then
    raise exception 'not authorised: sign in to report an AI safety incident';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'an AI safety incident needs a description of what went wrong';
  end if;

  select id into v_system_id from public.ai_systems where system_code = p_system_code;
  if v_system_id is null then
    raise exception 'unknown AI system code %', p_system_code;
  end if;

  select role, organisation_id into v_role, v_org from public.profiles where id = v_actor;

  if v_org is null then
    raise exception 'your account is not attached to an organisation, so an AI safety incident cannot be filed against it -- contact support';
  end if;

  v_kind := case
    when v_role = 'patient' then 'patient'
    when v_role in ('clinician', 'care_coordinator') then 'clinician'
    else 'staff'
  end;

  if p_interaction_id is not null and not exists (
    select 1 from public.ai_interaction_log l
    where l.id = p_interaction_id
      and (l.subject_profile_id = v_actor or private.is_org_staff(l.organisation_id))
  ) then
    p_interaction_id := null;
  end if;

  insert into public.ai_safety_incidents
    (organisation_id, ai_system_id, interaction_id, reported_by, reporter_kind,
     category, description)
  values (v_org, v_system_id, p_interaction_id, v_actor, v_kind, p_category, p_description)
  returning id into v_id;

  if p_interaction_id is not null then
    update public.ai_interaction_log set flagged_for_review = true where id = p_interaction_id;
  end if;

  return v_id;
end;
$$;

comment on function public.report_ai_safety_incident(text, public.ai_incident_category, text, uuid) is
  'Patient/clinician-facing AI incident report (40.12). Deliberately open to any signed-in account: a patient saying "the AI gave me incorrect information" is the highest-value safety signal here. Severity is NOT taken from the reporter -- triage sets it.';

revoke all on function public.report_ai_safety_incident(text, public.ai_incident_category, text, uuid) from public, anon;
grant execute on function public.report_ai_safety_incident(text, public.ai_incident_category, text, uuid) to authenticated;

create or replace function private.notify_ai_safety_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system text;
  v_rec    uuid;
begin
  if new.severity not in ('high', 'critical') then
    return new;
  end if;

  select name into v_system from public.ai_systems where id = new.ai_system_id;

  for v_rec in
    select distinct cs.profile_id
    from public.clinical_staff cs
    where cs.active and cs.is_clinical_director and cs.profile_id is not null
      and cs.organisation_id = new.organisation_id
    union
    select p.id from public.profiles p where p.role = 'admin'
  loop
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload,
       content_class, priority, source_table, source_id)
    values (
      new.organisation_id, v_rec, 'in_app', 'pending', 'ai_safety_incident_raised',
      jsonb_build_object(
        'ai_system', v_system,
        'severity', new.severity,
        'category', new.category,
        'reporter_kind', new.reporter_kind
      ),
      'clinical', 'critical', 'ai_safety_incidents', new.id
    );
  end loop;

  return new;
end;
$$;

comment on function private.notify_ai_safety_incident() is
  'Pages active Clinical Directors and admins in-app when a high or critical AI safety incident is raised (40.12, and the "clinical operations notified" step of 40.17). Carries no incident detail: the description can contain a patient''s own words, and only the in_app rail may ever carry clinical content.';

create trigger ai_safety_incidents_notify
  after insert on public.ai_safety_incidents
  for each row execute function private.notify_ai_safety_incident();

create or replace function public.triage_ai_safety_incident(
  p_id uuid,
  p_severity public.ai_incident_severity,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_org   uuid;
begin
  select organisation_id into v_org from public.ai_safety_incidents where id = p_id;
  if v_org is null then
    raise exception 'AI safety incident not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid()) and cs.active
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active clinician can triage an AI safety incident';
  end if;

  update public.ai_safety_incidents
     set severity   = p_severity,
         status     = case when status = 'open' then 'triaged'::public.ai_incident_status else status end,
         triaged_by = v_staff,
         triaged_at = now(),
         clinical_review_summary = coalesce(p_note, clinical_review_summary)
   where id = p_id;

  return p_id;
end;
$$;

comment on function public.triage_ai_safety_incident(uuid, public.ai_incident_severity, text) is
  'Clinician-only triage of an AI safety incident: sets the real severity and takes ownership. triaged_by is derived from the caller''s own clinical_staff record, never client-supplied.';

revoke all on function public.triage_ai_safety_incident(uuid, public.ai_incident_severity, text) from public, anon;
grant execute on function public.triage_ai_safety_incident(uuid, public.ai_incident_severity, text) to authenticated;

create or replace function public.resolve_ai_safety_incident(
  p_id uuid,
  p_status public.ai_incident_status,
  p_clinical_review_summary text,
  p_corrective_action text default null,
  p_patient_harm_occurred boolean default null,
  p_harm_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_org   uuid;
begin
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'resolve_ai_safety_incident closes an incident: pass ''resolved'' or ''dismissed''';
  end if;

  if p_clinical_review_summary is null or btrim(p_clinical_review_summary) = '' then
    raise exception 'closing an AI safety incident requires a clinical review summary';
  end if;

  select organisation_id into v_org from public.ai_safety_incidents where id = p_id;
  if v_org is null then
    raise exception 'AI safety incident not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid()) and cs.active
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active clinician can close an AI safety incident';
  end if;

  update public.ai_safety_incidents
     set status                  = p_status,
         clinical_review_summary = p_clinical_review_summary,
         corrective_action       = coalesce(p_corrective_action, corrective_action),
         patient_harm_occurred   = coalesce(p_patient_harm_occurred, patient_harm_occurred),
         harm_description        = coalesce(p_harm_description, harm_description),
         resolved_by             = v_staff,
         resolved_at             = now()
   where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, (select auth.uid()), 'ai_safety_incident.' || p_status, 'ai_safety_incidents', p_id,
    jsonb_build_object('closed_by_clinical_staff', v_staff, 'harm', p_patient_harm_occurred)
  );

  return p_id;
end;
$$;

comment on function public.resolve_ai_safety_incident(uuid, public.ai_incident_status, text, text, boolean, text) is
  'Clinician-only closure of an AI safety incident, with a mandatory clinical review summary. ''dismissed'' means "reviewed and found not to be a safety problem", and is audit-logged exactly like ''resolved'' -- there is no way to close one silently.';

revoke all on function public.resolve_ai_safety_incident(uuid, public.ai_incident_status, text, text, boolean, text) from public, anon;
grant execute on function public.resolve_ai_safety_incident(uuid, public.ai_incident_status, text, text, boolean, text) to authenticated;

do $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('ai_interaction_log', 'ai_interaction_sources', 'ai_safety_incidents')) <> 3
  then
    raise exception 'not every part-3 AI governance table was created';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ai_interaction_log', 'ai_interaction_sources', 'ai_safety_incidents')
      and not c.relrowsecurity
  ) then
    raise exception 'a part-3 AI governance table was created without row level security';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_interaction_log' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'ai_interaction_log gained a write policy -- the audit trail must only be written by public.record_ai_interaction()';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_safety_incidents' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'ai_safety_incidents gained a write policy -- incidents must go through the report/triage/resolve RPCs';
  end if;

  if has_function_privilege('anon', 'public.record_ai_interaction(text, text, text, public.ai_interaction_status, uuid, text, public.alert_level, text[], public.ai_output_flag[], uuid, uuid[], text, text, uuid, text, integer, integer, integer, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.report_ai_safety_incident(text, public.ai_incident_category, text, uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.triage_ai_safety_incident(uuid, public.ai_incident_severity, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.resolve_ai_safety_incident(uuid, public.ai_incident_status, text, text, boolean, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.record_ai_human_override(uuid, text, text)', 'EXECUTE')
  then
    raise exception 'anon can still execute an AI governance writer';
  end if;

  if not has_function_privilege('authenticated', 'public.report_ai_safety_incident(text, public.ai_incident_category, text, uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot report an AI safety incident -- 40.12 is unreachable';
  end if;
end;
$$;
