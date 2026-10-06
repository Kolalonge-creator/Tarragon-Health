-- S20: Quality and safety. Audits, tier 1 counts, hand-back review, the protected speak-up route, removal on expiry.
-- Spec 7.8, 9.1, 9.5, rows 23.15 to 23.21; safety case 16. Design: docs/design/S20.md. Research: docs/research/S20.md.
--
-- Depends on S15 (clinician_is_eligible, credential_notify, suspend/level functions), S16 (clinical_tasks,
-- apply_task_transition, task_handbacks, queue_append_only) and S17 (task_claims use, availability_blocks,
-- clinician_reliability_events, claim_setting). NOT applied to production: apply after S17.
--
-- What this adds:
--   * quality_config (versioned, PROPOSED values, mirrored as `quality.audit` in the code registry).
--   * clinical_audits: a monthly sample (every red event and titration, 10 percent of the rest, a per-clinician floor), every
--     task of a level 1 clinician until the tier 1 count is met, structured scoring done in the database, no self-audit,
--     the case-file read is written to audit_log (INV-10), the result feeds the reliability score (spec 7.8).
--   * handback_reviews: S17's threshold opens one review for the clinical lead. It informs a person; it never sanctions.
--   * safety_concerns (+ messages, backup readers, retaliation reviews): the protected speak-up route. Not readable by
--     admin accounts ("ops"); no domain event or audit_log row ever names a concern.
--   * private.remove_clinician_from_work() (at once) and private.remove_ineligible_from_work() (nightly): a clinician whose
--     licence or indemnity has lapsed leaves the queue and the rota. S15's sweep does the suspending; this does the leaving.
--
-- Counts before this migration (live, 2026-10-06): no clinical_tasks, task_claims or task_handbacks rows exist (S16/S17 are
-- not applied), so there is nothing to convert. Nothing in an event, notice or incident carries a reading, condition,
-- result or the words of a concern (INV-07).

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED values, CMO owned)
-- ---------------------------------------------------------------------------
create table public.quality_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index quality_config_one_active on public.quality_config (is_active) where is_active;

-- quality-audit-begin
insert into public.quality_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "sampling": { "random_rate_percent": 10, "always_reasons": ["red_event", "titration"], "floor_min_tasks": 3, "floor_per_clinician_per_month": 1, "reviewer_monthly_cap": 40, "due_days": 14 },
  "tier1": { "audited_task_count": 20, "graduation_min_score": 85, "max_critical_misses": 0 },
  "form": {
    "version": 1,
    "safety_items": ["identity_and_consent_confirmed", "red_flags_recognised_and_acted_on", "decision_within_competence_and_protocol", "no_unsigned_treatment_change", "safety_netting_and_follow_up_given", "escalated_when_needed"],
    "quality_items": ["history_adequate", "reasoning_documented", "communication_clear", "plan_appropriate", "patient_questions_answered", "documentation_timely"],
    "quality_max": 4
  },
  "outcomes": { "satisfactory_min": 85, "minor_concerns_min": 70, "rationale_min_chars": 20 },
  "reliability": { "audit_weight": 2, "good_by_outcome": { "satisfactory": 1, "minor_concerns": 0.6, "significant_concerns": 0.2, "unsafe": 0 } },
  "speak_up": { "acknowledge_hours": 48, "immediate_acknowledge_hours": 4, "respond_days": 14, "max_per_day": 10, "retaliation_review_months": 12 }
}
$json$::jsonb);
-- quality-audit-end

create function private.quality_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.quality_config where is_active; $$;
revoke all on function private.quality_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Events (ids and neutral facts only). Nothing here is emitted about a safety concern, on purpose.
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('clinical_audit.assigned', 'A completed task was selected for a clinical audit', 'S20', false),
  ('clinical_audit.completed', 'A clinical audit was submitted', 'S20', false),
  ('clinical_audit.concern_found', 'A clinical audit found significant concerns or an unsafe practice; the clinical lead follows up', 'S20', false),
  ('clinician.tier1_audits_complete', 'A level 1 clinician met the audited task count with a passing average; the clinical lead decides about the level', 'S20', false),
  ('clinician.removed_from_work', 'A clinician left the queue and the rota; their lead patients need reassigning (S18)', 'S20', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('clinical_audit.assigned', 1, array['audit_id', 'task_id', 'reason']),
  ('clinical_audit.completed', 1, array['audit_id', 'outcome']),
  ('clinical_audit.concern_found', 1, array['audit_id', 'outcome']),
  ('clinician.tier1_audits_complete', 1, array['clinical_staff_id']),
  ('clinician.removed_from_work', 1, array['clinical_staff_id', 'lead_reassignment_required']);

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- The signed-in user's organisation, and "I am the active chief medical officer of that organisation". Every lead-only read and
-- write is scoped by organisation (CLAUDE.md: every table has organisation_id, RLS at the Postgres level).
create function private.caller_org() returns uuid
language sql stable security definer set search_path = ''
as $$ select organisation_id from public.profiles where id = (select auth.uid()) $$;
revoke all on function private.caller_org() from public, anon;
grant execute on function private.caller_org() to authenticated;

create function private.cmo_of(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_org is not null and private.credential_is_cmo() and p_org = private.caller_org() $$;
revoke all on function private.cmo_of(uuid) from public, anon;
grant execute on function private.cmo_of(uuid) to authenticated;

create function private.lagos_month(p_at timestamptz) returns date
language sql immutable set search_path = ''
as $$ select date_trunc('month', p_at at time zone 'Africa/Lagos')::date $$;
revoke all on function private.lagos_month(timestamptz) from public, anon, authenticated;

-- Tell the active chief medical officers (the clinical lead), except one person. Neutral text only (INV-07).
create function private.notify_clinical_leads(p_org uuid, p_is_test boolean, p_subject text, p_message text, p_payload jsonb, p_exclude uuid default null, p_email boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select cs.profile_id from public.clinical_staff cs
            where cs.organisation_id = p_org and cs.is_test = p_is_test and cs.profile_id is not null and cs.active and cs.status = 'active'
              and cs.doctor_tier = 'chief_medical_officer' and cs.profile_id is distinct from p_exclude loop
    perform private.credential_notify(r.profile_id, p_org, p_subject, p_message, p_payload, p_email);
  end loop;
end;
$$;
revoke all on function private.notify_clinical_leads(uuid, boolean, text, text, jsonb, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Clinical audits
-- ---------------------------------------------------------------------------
create table public.clinical_audits (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  task_id             uuid not null references public.clinical_tasks (id) on delete restrict,
  clinician_id        uuid not null references public.profiles (id) on delete cascade,
  reviewer_id         uuid references public.profiles (id) on delete set null,
  reason              text not null check (reason in ('random_sample', 'floor_top_up', 'red_event', 'titration', 'first_tasks', 'lead_request')),
  audit_month         date not null,
  sample_draw         numeric,                         -- the stored draw (0 to 100) behind a random selection, so it can be replayed
  counts_toward_tier1 boolean not null default false,
  state               text not null default 'unassigned' check (state in ('unassigned', 'assigned', 'submitted', 'cancelled')),
  config_version      integer not null,
  form_version        integer not null,
  due_at              timestamptz not null,
  safety_results      jsonb,                           -- { item: true | false }
  quality_scores      jsonb,                           -- { item: 0 to 4 }
  total_score         numeric check (total_score is null or total_score between 0 and 100),
  critical_miss       boolean,
  outcome             text check (outcome in ('satisfactory', 'minor_concerns', 'significant_concerns', 'unsafe')),
  rationale           text,
  followup_needed     boolean not null default false,
  followup_closed_at  timestamptz,
  followup_note       text,
  overdue_notified_at timestamptz,
  submitted_at        timestamptz,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  check ((state = 'submitted') = (submitted_at is not null)),
  check (state <> 'submitted' or (outcome is not null and total_score is not null and critical_miss is not null and reviewer_id is not null)),
  check (state <> 'assigned' or reviewer_id is not null),
  check (reviewer_id is null or reviewer_id <> clinician_id)         -- no self-audit
);
create unique index clinical_audits_one_per_task on public.clinical_audits (task_id) where state <> 'cancelled';
create index clinical_audits_clinician_idx on public.clinical_audits (clinician_id, created_at desc);
create index clinical_audits_reviewer_idx on public.clinical_audits (reviewer_id, audit_month) where state <> 'cancelled';
create index clinical_audits_open_idx on public.clinical_audits (state, due_at) where state in ('unassigned', 'assigned');

create function private.clinical_audit_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'clinical audits are never deleted' using errcode = '23514'; end if;
  -- once submitted or cancelled only the follow-up bookkeeping may change; every other column is frozen
  if old.state in ('submitted', 'cancelled')
     and (to_jsonb(old) - 'followup_closed_at' - 'followup_note' - 'overdue_notified_at')
         is distinct from (to_jsonb(new) - 'followup_closed_at' - 'followup_note' - 'overdue_notified_at') then
    raise exception 'a submitted clinical audit cannot be changed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger clinical_audits_guard before update or delete on public.clinical_audits
  for each row execute function private.clinical_audit_guard();
revoke all on function private.clinical_audit_guard() from public, anon, authenticated;

create table public.clinician_tier1_audit_extensions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  extra_audits    integer not null check (extra_audits between 1 and 20),
  reason          text not null check (char_length(btrim(reason)) >= 10),
  created_by      uuid references public.profiles (id) on delete set null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create trigger clinician_tier1_audit_extensions_append_only before update or delete on public.clinician_tier1_audit_extensions
  for each row execute function private.queue_append_only();

-- The audited count a level 1 clinician must reach, including any extension the lead granted.
create function private.tier1_target(p_staff uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select ((private.quality_setting('tier1') ->> 'audited_task_count')::integer
          + coalesce((select sum(extra_audits) from public.clinician_tier1_audit_extensions where clinical_staff_id = p_staff), 0))::integer;
$$;
revoke all on function private.tier1_target(uuid) from public, anon, authenticated;

create function private.tier1_count(p_profile uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::integer from public.clinical_audits where clinician_id = p_profile and counts_toward_tier1 and state <> 'cancelled'; $$;
revoke all on function private.tier1_count(uuid) from public, anon, authenticated;

-- A reviewer: an active, eligible chief medical officer who is not the audited clinician and is under the monthly cap.
create function private.audit_reviewer_for(p_org uuid, p_is_test boolean, p_clinician uuid, p_month date) returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.is_test = p_is_test and cs.profile_id is not null and cs.profile_id <> p_clinician
     and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' and private.clinician_is_eligible(cs.profile_id)
     and (select count(*) from public.clinical_audits a where a.reviewer_id = cs.profile_id and a.audit_month = p_month and a.state <> 'cancelled')
         < ((private.quality_setting('sampling') ->> 'reviewer_monthly_cap')::integer)
   order by (select count(*) from public.clinical_audits a where a.reviewer_id = cs.profile_id and a.state = 'assigned'), cs.profile_id
   limit 1;
$$;
revoke all on function private.audit_reviewer_for(uuid, boolean, uuid, date) from public, anon, authenticated;

create function private.create_audit(p_task uuid, p_reason text, p_draw numeric) returns uuid
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
      'A clinical audit has been assigned to you. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', v_id), false);
  else
    perform private.notify_clinical_leads(t.organisation_id, t.is_test, 'A clinical audit has no reviewer',
      'A clinical audit could not be assigned to a reviewer. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', v_id), t.claimed_by, false);
  end if;
  return v_id;
end;
$$;
revoke all on function private.create_audit(uuid, text, numeric) from public, anon, authenticated;

-- Decide whether a completed task is audited, and why. Deterministic: the same task and month always give the same draw.
create function private.consider_task_for_audit(p_task uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype; s public.clinical_staff%rowtype;
  v_reason text; v_draw numeric; v_rate numeric := (private.quality_setting('sampling') ->> 'random_rate_percent')::numeric;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found or t.state <> 'completed' or t.claimed_by is null then return null; end if;
  select * into s from public.clinical_staff where profile_id = t.claimed_by;
  if not found then return null; end if;
  v_draw := (abs(hashtextextended(t.id::text || ':' || private.lagos_month(coalesce(t.completed_at, now()))::text, 0)) % 1000000) / 10000.0;
  if t.priority_class_original = 1 or t.type = 'red_event_unacknowledged' then v_reason := 'red_event';
  elsif t.type = 'titration_signoff' then v_reason := 'titration';
  elsif coalesce(s.credentialing_level, 2) = 1 and private.tier1_count(t.claimed_by) < private.tier1_target(s.id) then v_reason := 'first_tasks';
  elsif v_draw < v_rate then v_reason := 'random_sample';
  else return null;
  end if;
  return private.create_audit(p_task, v_reason, v_draw);
end;
$$;
revoke all on function private.consider_task_for_audit(uuid) from public, anon, authenticated;

-- Scheduling an audit must never be able to stop a clinician completing a task: a failure is logged and the nightly sweep retries.
create function private.trg_task_completed_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.consider_task_for_audit(new.id);
  exception when others then
    raise warning 'audit scheduling failed for task %: %', new.id, sqlerrm;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'clinical_audit.schedule_error', 'clinical_task', new.id, jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;
create trigger clinical_tasks_audit_on_complete after update of state on public.clinical_tasks
  for each row when (new.state = 'completed' and old.state is distinct from 'completed')
  execute function private.trg_task_completed_audit();
revoke all on function private.trg_task_completed_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit functions (clinical lead)
-- ---------------------------------------------------------------------------
create function private.uid_or_deny() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'sign in needed' using errcode = '42501'; end if;
  return v;
end;
$$;
revoke all on function private.uid_or_deny() from public, anon, authenticated;

create function public.clinical_audit_queue(p_state text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can see the audit queue' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'task_id', a.task_id, 'clinician_id', a.clinician_id, 'clinician_name', cs.full_name, 'reviewer_id', a.reviewer_id,
      'reason', a.reason, 'state', a.state, 'due_at', a.due_at, 'overdue', a.due_at < now() and a.state in ('unassigned', 'assigned'),
      'outcome', a.outcome, 'total_score', a.total_score, 'critical_miss', a.critical_miss, 'followup_needed', a.followup_needed and a.followup_closed_at is null,
      'counts_toward_tier1', a.counts_toward_tier1, 'submitted_at', a.submitted_at)
      order by (a.state = 'unassigned') desc, (a.followup_needed and a.followup_closed_at is null) desc, a.due_at)
    from public.clinical_audits a join public.clinical_staff cs on cs.profile_id = a.clinician_id
   where a.organisation_id = private.caller_org()
     and a.is_test = (select coalesce(bool_or(is_test), false) from public.clinical_staff where profile_id = (select auth.uid()))
     and (p_state is null or a.state = p_state)), '[]'::jsonb);
end;
$$;

-- INV-10: reading what a clinician did for a patient is a clinical read. It is logged, and only the assigned reviewer (or
-- the lead, for an unassigned audit) may do it. The clinician being audited can never read their own case file this way.
create function public.audit_case_file(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype; t public.clinical_tasks%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can open an audit case file' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit;
  if not found or not private.cmo_of(a.organisation_id) then raise exception 'audit not found' using errcode = 'P0002'; end if;
  if a.clinician_id = v_uid then raise exception 'you cannot audit your own work' using errcode = '42501'; end if;
  if a.reviewer_id is not null and a.reviewer_id <> v_uid then raise exception 'this audit is assigned to another reviewer' using errcode = '42501'; end if;
  select * into t from public.clinical_tasks where id = a.task_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (a.organisation_id, v_uid, 'clinical_audit.case_file_read', 'clinical_task', t.id, jsonb_build_object('audit_id', a.id, 'patient_id', t.patient_id));
  return jsonb_build_object(
    'audit', jsonb_build_object('id', a.id, 'reason', a.reason, 'state', a.state, 'due_at', a.due_at, 'form_version', a.form_version),
    'form', (select rules -> 'form' from public.quality_config where version = a.config_version),
    'task', jsonb_build_object('id', t.id, 'type', t.type, 'priority_class', t.priority_class_original, 'created_at', t.created_at, 'due_at', t.due_at,
                               'completed_at', t.completed_at, 'handback_count', t.handback_count, 'patient_id', t.patient_id, 'outcome', t.outcome));
end;
$$;

create function public.submit_clinical_audit(p_audit uuid, p_safety jsonb, p_quality jsonb, p_rationale text) returns jsonb
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
  -- exactly the form's items, nothing missing and nothing extra
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
  -- the result feeds the reliability score (advisory, a tie-break only)
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
      'An audit of one of your tasks has been completed. You can read the result under Training and profile.', jsonb_build_object('audit_id', a.id), false);
  end if;
  -- tier 1: the count is met with a passing average and no critical miss; the lead decides, nothing is promoted
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
        'A level 1 clinician has met the audited task count. Open the clinician page to decide about their level.', jsonb_build_object('clinical_staff_id', s.id), a.clinician_id, false);
      end if;
    end if;
  end if;
  return jsonb_build_object('outcome', v_outcome, 'total_score', v_score, 'critical_miss', v_critical);
end;
$$;

create function public.close_audit_followup(p_audit uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can close a follow-up' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'say what was done, in at least 20 characters' using errcode = '22023'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) or a.state <> 'submitted' or not a.followup_needed then raise exception 'there is no open follow-up on this audit' using errcode = '23514'; end if;
  if a.clinician_id = v_uid then raise exception 'you cannot close a follow-up on your own work' using errcode = '42501'; end if;
  update public.clinical_audits set followup_closed_at = now(), followup_note = btrim(p_note) where id = a.id;
end;
$$;

create function public.reassign_clinical_audit(p_audit uuid, p_reviewer uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.clinical_audits%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can reassign an audit' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) or a.state not in ('unassigned', 'assigned') then raise exception 'this audit cannot be reassigned' using errcode = '23514'; end if;
  if p_reviewer = a.clinician_id then raise exception 'the reviewer cannot be the audited clinician' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = p_reviewer and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
                    and cs.is_test = a.is_test and private.clinician_is_eligible(p_reviewer)) then
    raise exception 'the reviewer must be an active chief medical officer' using errcode = '23514';
  end if;
  update public.clinical_audits set reviewer_id = p_reviewer, state = 'assigned' where id = a.id;
end;
$$;

create function public.request_clinical_audit(p_task uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can request an audit' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinical_tasks where id = p_task and organisation_id = private.caller_org()) then
    raise exception 'that task is not a completed task, or it already has an audit' using errcode = '23514';
  end if;
  v_id := private.create_audit(p_task, 'lead_request', null);
  if v_id is null then raise exception 'that task is not a completed task, or it already has an audit' using errcode = '23514'; end if;
  return v_id;
end;
$$;

create function public.tier1_audit_progress(p_staff uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype; t1 jsonb := private.quality_setting('tier1');
begin
  if p_staff is null then select * into s from public.clinical_staff where profile_id = v_uid;
  else select * into s from public.clinical_staff where id = p_staff; end if;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id <> v_uid and not private.cmo_of(s.organisation_id) then raise exception 'you can only see your own progress' using errcode = '42501'; end if;
  return jsonb_build_object('clinical_staff_id', s.id, 'level', coalesce(s.credentialing_level, 2), 'target', private.tier1_target(s.id),
    'audited', private.tier1_count(s.profile_id),
    'submitted', (select count(*) from public.clinical_audits where clinician_id = s.profile_id and counts_toward_tier1 and state = 'submitted'),
    'average_score', (select round(avg(total_score), 1) from public.clinical_audits where clinician_id = s.profile_id and counts_toward_tier1 and state = 'submitted'),
    'critical_misses', (select count(*) from public.clinical_audits where clinician_id = s.profile_id and counts_toward_tier1 and state = 'submitted' and critical_miss),
    'graduation_min_score', (t1 ->> 'graduation_min_score')::numeric);
end;
$$;

create function public.extend_tier1_audits(p_staff uuid, p_extra integer, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can extend the audited count' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found or not private.cmo_of(s.organisation_id) then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = v_uid then raise exception 'you cannot extend your own count' using errcode = '42501'; end if;
  if coalesce(s.credentialing_level, 2) <> 1 then raise exception 'only level 1 clinicians have a tier 1 count' using errcode = '23514'; end if;
  insert into public.clinician_tier1_audit_extensions (organisation_id, clinical_staff_id, extra_audits, reason, created_by, is_test)
  values (s.organisation_id, s.id, p_extra, p_reason, v_uid, s.is_test);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Hand-back review (S17 flags a pattern; the lead decides)
-- ---------------------------------------------------------------------------
create table public.handback_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  state           text not null default 'open' check (state in ('open', 'closed')),
  window_days     integer not null,
  handbacks       integer not null,
  reasons         jsonb not null,
  opened_at       timestamptz not null default now(),
  closed_by       uuid references public.profiles (id) on delete set null,
  closed_at       timestamptz,
  outcome         text check (outcome in ('no_action', 'coaching', 'competency_check', 'capacity_issue', 'concern_raised')),
  note            text,
  is_test         boolean not null default false,
  check ((state = 'closed') = (closed_at is not null)),
  check (state <> 'closed' or (outcome is not null and char_length(btrim(coalesce(note, ''))) >= 10))
);
create unique index handback_reviews_one_open on public.handback_reviews (clinician_id) where state = 'open';

create function private.trg_handback_review() returns trigger
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
            'A hand-back pattern needs your review. Open the reviews page in the clinical lead area.', '{}'::jsonb, new.clinician_id, false);
        end if;
      end if;
    end if;
  exception when others then
    -- never block a hand-back, but never lose the failure either: it is logged and the daily sweep re-checks
    raise warning 'hand-back review check failed for %: %', new.clinician_id, sqlerrm;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      select organisation_id, 'handback_review.error', 'clinical_staff', id, jsonb_build_object('error', sqlerrm) from public.clinical_staff where profile_id = new.clinician_id;
  end;
  return null;
end;
$$;
create trigger task_handbacks_review after insert on public.task_handbacks for each row execute function private.trg_handback_review();
revoke all on function private.trg_handback_review() from public, anon, authenticated;

create function public.handback_review_queue() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can see hand-back reviews' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'clinician_id', h.clinician_id, 'clinician_name', cs.full_name, 'state', h.state,
      'window_days', h.window_days, 'handbacks', h.handbacks, 'reasons', h.reasons, 'opened_at', h.opened_at, 'outcome', h.outcome,
      'reliability_score', cs.reliability_score) order by (h.state = 'open') desc, h.opened_at desc)
    from public.handback_reviews h join public.clinical_staff cs on cs.profile_id = h.clinician_id
   where h.organisation_id = private.caller_org()
     and h.is_test = (select coalesce(bool_or(is_test), false) from public.clinical_staff where profile_id = (select auth.uid()))), '[]'::jsonb);
end;
$$;

create function public.close_handback_review(p_review uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); h public.handback_reviews%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can close a hand-back review' using errcode = '42501'; end if;
  select * into h from public.handback_reviews where id = p_review for update;
  if not found or not private.cmo_of(h.organisation_id) or h.state <> 'open' then raise exception 'there is no open review with that id' using errcode = '23514'; end if;
  if h.clinician_id = v_uid then raise exception 'you cannot review your own hand-backs' using errcode = '42501'; end if;
  if p_outcome not in ('no_action', 'coaching', 'competency_check', 'capacity_issue', 'concern_raised') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'add a note of at least 10 characters' using errcode = '22023'; end if;
  update public.handback_reviews set state = 'closed', outcome = p_outcome, note = btrim(p_note), closed_by = v_uid, closed_at = now() where id = h.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The protected speak-up route (spec 7.8, row 23.19)
--    Readable only by the person who raised it, the clinical lead, and named backup readers once it is overdue.
--    Admin accounts ("ops") have no policy and no function: they cannot read a concern, its messages or its identity.
--    No domain event and no audit_log row is ever written about a concern (both are readable by operations).
-- ---------------------------------------------------------------------------
create table public.safety_concern_readers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  active          boolean not null default true,
  note            text,
  added_by        uuid references public.profiles (id) on delete set null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (profile_id)
);

create table public.safety_concerns (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  raised_by           uuid not null references public.profiles (id) on delete cascade,
  category            text not null check (category in ('patient_safety', 'clinical_practice', 'colleague_conduct', 'system_or_process', 'workload_or_staffing', 'something_else')),
  severity            text not null check (severity in ('low', 'medium', 'high', 'immediate')),
  description         text not null check (char_length(btrim(description)) between 20 and 4000),
  screen              text check (screen is null or char_length(screen) <= 100),
  task_id             uuid references public.clinical_tasks (id) on delete set null,
  state               text not null default 'new' check (state in ('new', 'acknowledged', 'responded', 'closed')),
  acknowledge_due_at  timestamptz not null,
  respond_due_at      timestamptz not null,
  acknowledged_at     timestamptz,
  acknowledged_by     uuid references public.profiles (id) on delete set null,
  responded_at        timestamptz,
  closed_at           timestamptz,
  closed_by           uuid references public.profiles (id) on delete set null,
  close_note          text,
  escalated_at        timestamptz,            -- set when the backup readers may also read it
  respond_overdue_notified_at timestamptz,
  incident_id         uuid references public.ops_incidents (id) on delete set null,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  check ((state = 'closed') = (closed_at is not null))
);
create index safety_concerns_state_idx on public.safety_concerns (state, acknowledge_due_at);
create index safety_concerns_raiser_idx on public.safety_concerns (raised_by, created_at desc);

create table public.safety_concern_messages (
  id          uuid primary key default gen_random_uuid(),
  concern_id  uuid not null references public.safety_concerns (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('raised', 'note', 'response', 'acknowledged', 'closed', 'incident_opened', 'escalated')),
  body        text,
  created_at  timestamptz not null default now()
);
create index safety_concern_messages_idx on public.safety_concern_messages (concern_id, created_at);
create trigger safety_concern_messages_append_only before update or delete on public.safety_concern_messages
  for each row execute function private.queue_append_only();

create table public.retaliation_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  trigger_kind    text not null,
  trigger_ref     text not null,
  state           text not null default 'open' check (state in ('open', 'closed')),
  outcome         text check (outcome in ('no_link', 'link_found', 'needs_follow_up')),
  note            text,
  closed_by       uuid references public.profiles (id) on delete set null,
  closed_at       timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (clinician_id, trigger_kind, trigger_ref),
  check ((state = 'closed') = (closed_at is not null)),
  check (state <> 'closed' or (outcome is not null and char_length(btrim(coalesce(note, ''))) >= 10))
);

-- Who may read a concern: the lead, and (once escalated) a named, active backup reader. Never an admin account as such.
create function private.concern_reader(p_escalated timestamptz, p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.cmo_of(p_org)
      or (p_escalated is not null and exists (select 1 from public.safety_concern_readers r
                                                where r.profile_id = (select auth.uid()) and r.active and r.organisation_id = p_org));
$$;
revoke all on function private.concern_reader(timestamptz, uuid) from public, anon;
grant execute on function private.concern_reader(timestamptz, uuid) to authenticated;

create function private.backup_reader(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.safety_concern_readers r where r.profile_id = (select auth.uid()) and r.active and r.organisation_id = p_org); $$;
revoke all on function private.backup_reader(uuid) from public, anon;
grant execute on function private.backup_reader(uuid) to authenticated;   -- used inside a policy, which runs as the caller

create function private.notify_backup_readers(p_org uuid, p_is_test boolean, p_subject text, p_message text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select profile_id from public.safety_concern_readers where active and organisation_id = p_org and is_test = p_is_test loop
    perform private.credential_notify(r.profile_id, p_org, p_subject, p_message, '{}'::jsonb, true);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.notify_backup_readers(uuid, boolean, text, text) from public, anon, authenticated;

create function public.raise_safety_concern(p_category text, p_severity text, p_description text, p_screen text default null, p_task uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype; c jsonb := private.quality_setting('speak_up'); v_id uuid;
  v_ack interval; v_by_cmo boolean;
begin
  -- any clinician, from any screen: an active or a suspended one (a suspended clinician must still be able to speak up)
  select * into s from public.clinical_staff where profile_id = v_uid;
  if not found then raise exception 'only clinicians can raise a safety concern here' using errcode = '42501'; end if;
  -- the cap only slows routine concerns; a high or immediate one is never refused
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
  -- neutral notices: a concern's words, category and severity are never in them
  if v_by_cmo then
    perform private.notify_backup_readers(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.');
  else
    perform private.notify_clinical_leads(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', '{}'::jsonb, v_uid, true);
  end if;
  return v_id;
end;
$$;

create function public.my_safety_concerns() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'severity', c.severity, 'description', c.description, 'state', c.state,
      'created_at', c.created_at, 'acknowledge_due_at', c.acknowledge_due_at, 'respond_due_at', c.respond_due_at, 'acknowledged_at', c.acknowledged_at,
      'responded_at', c.responded_at, 'closed_at', c.closed_at,
      'messages', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', m.body, 'mine', m.author_id = v_uid, 'created_at', m.created_at) order by m.created_at)
                              from public.safety_concern_messages m where m.concern_id = c.id and m.kind in ('response', 'note', 'acknowledged', 'closed')), '[]'::jsonb))
      order by c.created_at desc) from public.safety_concerns c where c.raised_by = v_uid), '[]'::jsonb);
end;
$$;

create function public.safety_concern_inbox(p_state text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'raised_by', c.raised_by, 'raised_by_name', cs.full_name, 'category', c.category, 'severity', c.severity,
      'description', c.description, 'screen', c.screen, 'task_id', c.task_id, 'state', c.state, 'created_at', c.created_at,
      'acknowledge_due_at', c.acknowledge_due_at, 'respond_due_at', c.respond_due_at, 'overdue', c.state = 'new' and c.acknowledge_due_at < now(),
      'escalated_at', c.escalated_at, 'incident_id', c.incident_id,
      'messages', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', m.body, 'author_id', m.author_id, 'created_at', m.created_at) order by m.created_at)
                              from public.safety_concern_messages m where m.concern_id = c.id), '[]'::jsonb))
      order by (c.state = 'new') desc, c.acknowledge_due_at)
    from public.safety_concerns c left join public.clinical_staff cs on cs.profile_id = c.raised_by
   where private.concern_reader(c.escalated_at, c.organisation_id) and c.is_test = (select coalesce(bool_or(is_test), false) from public.clinical_staff where profile_id = (select auth.uid()))
     and (p_state is null or c.state = p_state)), '[]'::jsonb);
end;
$$;

-- shared guard for the lead's actions: loads the concern the caller may read, or raises
create function private.concern_for_action(p_concern uuid) returns public.safety_concerns
language plpgsql security definer set search_path = ''
as $$
declare c public.safety_concerns%rowtype;
begin
  perform private.uid_or_deny();
  select * into c from public.safety_concerns where id = p_concern for update;
  if not found or not private.concern_reader(c.escalated_at, c.organisation_id) then raise exception 'concern not found' using errcode = 'P0002'; end if;
  return c;
end;
$$;
revoke all on function private.concern_for_action(uuid) from public, anon, authenticated;

create function public.acknowledge_safety_concern(p_concern uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state <> 'new' then return; end if;
  update public.safety_concerns set state = 'acknowledged', acknowledged_at = now(), acknowledged_by = v_uid where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'acknowledged', 'Your concern was received and is being looked at.');
  perform private.credential_notify(c.raised_by, c.organisation_id, 'Your concern was received', 'Your concern was received. You can follow it under Raise a safety concern.', '{}'::jsonb, false);
end;
$$;

create function public.respond_to_safety_concern(p_concern uuid, p_body text) returns void
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
  perform private.credential_notify(c.raised_by, c.organisation_id, 'You have a reply', 'You have a reply to your concern. Open it under Raise a safety concern.', '{}'::jsonb, false);
end;
$$;

create function public.add_to_safety_concern(p_concern uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); c public.safety_concerns%rowtype;
begin
  select * into c from public.safety_concerns where id = p_concern and raised_by = v_uid;
  if not found then raise exception 'concern not found' using errcode = 'P0002'; end if;
  if c.state = 'closed' then raise exception 'this concern is closed; raise a new one' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 5 then raise exception 'write at least a few words' using errcode = '22023'; end if;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'note', btrim(p_body));
  perform private.notify_clinical_leads(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', '{}'::jsonb, v_uid, false);
end;
$$;

create function public.close_safety_concern(p_concern uuid, p_note text) returns void
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
  perform private.credential_notify(c.raised_by, c.organisation_id, 'Your concern was closed', 'Your concern was closed. You can read the outcome under Raise a safety concern.', '{}'::jsonb, false);
end;
$$;

-- Incidents from concerns follow the incident process (spec 7.8) with fixed neutral text: operations learn that a review exists, never why.
create function public.open_incident_for_concern(p_concern uuid, p_severity text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype; v_id uuid;
begin
  c := private.concern_for_action(p_concern);
  if p_severity not in ('sev1', 'sev2', 'sev3', 'sev4') then raise exception 'unknown severity' using errcode = '22023'; end if;
  if c.incident_id is not null then return c.incident_id; end if;
  insert into public.ops_incidents (organisation_id, category, severity, title, summary, reported_by, ack_due_at, resolve_due_at)
  values (c.organisation_id, 'clinical', p_severity::public.ops_incident_severity, 'A clinical safety review was opened',
          'Opened by the clinical lead. Details are held by the clinical lead and are not available to operations.', v_uid, now(), now())
  returning id into v_id;
  update public.safety_concerns set incident_id = v_id where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'incident_opened', null);
  return v_id;
end;
$$;

create function public.add_safety_concern_backup_reader(p_profile uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); v_org uuid; v_test boolean;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can name a backup reader' using errcode = '42501'; end if;
  -- a named reader must be a working member of staff of the caller's own organisation, never a patient or an outsider
  select p.organisation_id, p.is_test into v_org, v_test from public.profiles p
   where p.id = p_profile and p.is_active and p.organisation_id = private.caller_org() and p.role in ('admin', 'clinician');
  if v_org is null then raise exception 'that person was not found' using errcode = 'P0002'; end if;
  insert into public.safety_concern_readers (organisation_id, profile_id, note, added_by, is_test) values (v_org, p_profile, p_note, v_uid, v_test)
  on conflict (profile_id) do update set active = true, note = excluded.note;
end;
$$;

create function public.remove_safety_concern_backup_reader(p_profile uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can remove a backup reader' using errcode = '42501'; end if;
  update public.safety_concern_readers set active = false where profile_id = p_profile and organisation_id = private.caller_org();
end;
$$;

-- Hourly: a concern nobody acknowledged in time also reaches the backup readers; no readers means a neutral incident so the failure is visible.
create function private.safety_concern_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_esc integer := 0; v_noreader integer := 0; v_late integer := 0; v_errors integer := 0; n integer;
begin
  -- 1. not acknowledged in time: also readable by the backup readers
  for r in select * from public.safety_concerns where state = 'new' and escalated_at is null and acknowledge_due_at < now() loop
    begin
      update public.safety_concerns set escalated_at = now() where id = r.id;
      insert into public.safety_concern_messages (concern_id, kind, body) values (r.id, 'escalated', 'Not acknowledged in time; the backup readers can now see it.');
      perform private.notify_backup_readers(r.organisation_id, r.is_test, 'An item needs your attention', 'An item is overdue in the clinical lead area.');
      v_esc := v_esc + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: escalating % failed: %', r.id, sqlerrm;
    end;
  end loop;
  -- 2. overdue and nobody but the lead can read it (no backup reader named, or the lead raised it): a neutral incident makes the gap visible
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
  -- 3. no response in time: tell the lead once
  for r in select * from public.safety_concerns where state in ('new', 'acknowledged') and responded_at is null and respond_due_at < now() and respond_overdue_notified_at is null loop
    begin
      update public.safety_concerns set respond_overdue_notified_at = now() where id = r.id;
      perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.', '{}'::jsonb, r.raised_by, false);
      if r.escalated_at is not null then perform private.notify_backup_readers(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.'); end if;
      v_late := v_late + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: response notice for % failed: %', r.id, sqlerrm;
    end;
  end loop;
  -- a failure here must be visible, and must say nothing about any concern
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'safety_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'The clinical lead area sweep failed for some items',
            format('%s item(s) could not be processed by private.safety_concern_sweep(). Details are not available to operations.', v_errors), 'safety_sweep', now(), now());
  end if;
  return jsonb_build_object('escalated', v_esc, 'no_backup_reader', v_noreader, 'response_overdue', v_late, 'errors', v_errors);
end;
$$;
revoke all on function private.safety_concern_sweep() from public, anon, authenticated;

-- Retaliation review: adverse action against someone who raised a concern in the last 12 months goes to the lead (or the backup reader).
create function private.note_adverse_action(p_profile uuid, p_kind text, p_ref text) returns void
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
    perform private.notify_clinical_leads(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', '{}'::jsonb, p_profile, false);
    perform private.notify_backup_readers(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.');
  end if;
end;
$$;
revoke all on function private.note_adverse_action(uuid, text, text) from public, anon, authenticated;

-- A human suspending, offboarding or lowering the level of a clinician. The credential sweep runs with no signed-in user and is not a person's decision.
create function private.trg_adverse_action() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.profile_id is null or (select auth.uid()) is null then return null; end if;
  if new.status in ('suspended', 'offboarded') and old.status is distinct from new.status then
    perform private.note_adverse_action(new.profile_id, 'status_' || new.status, new.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  elsif coalesce(new.credentialing_level, 2) < coalesce(old.credentialing_level, 2) then
    perform private.note_adverse_action(new.profile_id, 'level_lowered', new.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  return null;
end;
$$;
create trigger clinical_staff_adverse_action after update of status, credentialing_level on public.clinical_staff
  for each row execute function private.trg_adverse_action();
revoke all on function private.trg_adverse_action() from public, anon, authenticated;

create function public.retaliation_review_queue() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not (private.credential_is_cmo() or private.backup_reader(private.caller_org())) then raise exception 'not available' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'clinician_id', r.clinician_id, 'clinician_name', cs.full_name, 'trigger_kind', r.trigger_kind,
      'state', r.state, 'outcome', r.outcome, 'created_at', r.created_at) order by (r.state = 'open') desc, r.created_at desc)
    from public.retaliation_reviews r join public.clinical_staff cs on cs.profile_id = r.clinician_id
   where r.organisation_id = private.caller_org()
     and r.is_test = (select coalesce(bool_or(is_test), false) from public.clinical_staff where profile_id = (select auth.uid()))), '[]'::jsonb);
end;
$$;

create function public.close_retaliation_review(p_review uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); r public.retaliation_reviews%rowtype;
begin
  select * into r from public.retaliation_reviews where id = p_review for update;
  if not found or not (private.cmo_of(r.organisation_id) or private.backup_reader(r.organisation_id)) then raise exception 'not available' using errcode = '42501'; end if;
  if r.state <> 'open' then raise exception 'there is no open review with that id' using errcode = '23514'; end if;
  if r.clinician_id = v_uid then raise exception 'you cannot close a review about yourself' using errcode = '42501'; end if;
  if p_outcome not in ('no_link', 'link_found', 'needs_follow_up') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'add a note of at least 10 characters' using errcode = '22023'; end if;
  update public.retaliation_reviews set state = 'closed', outcome = p_outcome, note = btrim(p_note), closed_by = v_uid, closed_at = now() where id = r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Removal from the queue and the rota (safety case 16)
-- ---------------------------------------------------------------------------
create function private.remove_clinician_from_work(p_profile uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.clinical_staff%rowtype; r record; v_claims integer := 0; v_blocks integer := 0; v_offers integer := 0; v_lead jsonb := null;
begin
  select * into s from public.clinical_staff where profile_id = p_profile;
  if not found then return '{}'::jsonb; end if;
  -- 1. live claims go back to the queue, with no penalty (the task is never closed or dropped)
  for r in select c.id as claim_id, c.task_id from public.task_claims c where c.clinician_id = p_profile and c.ended_at is null loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where id = r.claim_id and ended_at is null;
    if found then
      perform private.apply_task_transition(r.task_id, 'open', 'system', null, 'clinician no longer eligible');
      v_claims := v_claims + 1;
    end if;
  end loop;
  -- 2. work offered or pushed to them returns to the pool
  for r in select id from public.clinical_tasks where state = 'offered_to_lead' and (pushed_to = p_profile or lead_clinician_id = p_profile) loop
    perform private.apply_task_transition(r.id, 'open', 'system', null, 'clinician no longer eligible');
    v_offers := v_offers + 1;
  end loop;
  -- 3. the rota: every queue, on-call and bookable block that has not ended is cancelled
  update public.availability_blocks set state = 'cancelled' where clinician_id = p_profile and state <> 'cancelled' and ends_at > now();
  get diagnostics v_blocks = row_count;
  -- 4. Lead patients and the on-call rota (safety case 16, second half) belong to S18. When S18 is present its idempotent entry point
  --    runs here, so the nightly path reassigns leads too and not only the event-driven suspension path; when it is not present yet,
  --    the event below says reassignment is still required.
  if to_regprocedure('private.lead_on_clinician_removed(uuid)') is not null then
    execute 'select private.lead_on_clinician_removed($1)' into v_lead using s.id;
  end if;
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
    values (s.organisation_id, 'clinician.removed_from_work', 'clinical_staff', s.id,
            jsonb_build_object('reason', p_reason, 'claims_released', v_claims, 'offers_returned', v_offers, 'blocks_cancelled', v_blocks, 'lead_handled', v_lead is not null));
  perform private.emit_domain_event('clinician.removed_from_work', s.organisation_id,
    jsonb_build_object('clinical_staff_id', s.id, 'lead_reassignment_required', v_lead is null, 'claims_released', v_claims, 'blocks_cancelled', v_blocks),
    'clinician.removed_from_work:' || s.id || ':' || to_char(now() at time zone 'Africa/Lagos', 'YYYYMMDD'));
  return jsonb_build_object('claims_released', v_claims, 'offers_returned', v_offers, 'blocks_cancelled', v_blocks, 'lead', v_lead);
end;
$$;
revoke all on function private.remove_clinician_from_work(uuid, text) from public, anon, authenticated;

-- At once, whenever a clinician stops being active (suspension, offboarding, deactivation), not only overnight.
create function private.trg_clinician_stopped() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- the suspension must always go through: a failure here is logged and raised as an incident, and the nightly job retries
  begin
    if new.profile_id is not null then perform private.remove_clinician_from_work(new.profile_id, coalesce(new.suspended_reason, 'no longer active')); end if;
  exception when others then
    raise warning 'removal from work failed for %: %', new.id, sqlerrm;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'clinician.removal_error', 'clinical_staff', new.id, jsonb_build_object('error', sqlerrm, 'step', 'trigger'));
    if not exists (select 1 from public.ops_incidents where external_reference = 'removal_sweep' and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (new.organisation_id, 'technical', 'sev2', 'Removing a suspended clinician from work failed',
              'A clinician was suspended but their queue and rota could not be cleared at once; see audit_log action clinician.removal_error. The nightly job will retry.', 'removal_sweep', now(), now());
    end if;
  end;
  return null;
end;
$$;
create trigger clinical_staff_stopped after update of status, active on public.clinical_staff
  for each row when ((new.status in ('suspended', 'offboarded') and old.status is distinct from new.status) or (old.active and not new.active))
  execute function private.trg_clinician_stopped();
revoke all on function private.trg_clinician_stopped() from public, anon, authenticated;

-- Nightly safety net (05:15 UTC, after S15's 05:00 sweep): anyone who is not eligible but still holds work or a rota slot leaves it.
-- A missing licence date never removes anyone (S15 rule): clinician_is_eligible() treats it as eligible.
create function private.remove_ineligible_from_work() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_removed integer := 0; v_errors integer := 0;
begin
  for r in select cs.profile_id, cs.organisation_id, cs.id from public.clinical_staff cs
            where cs.profile_id is not null and not private.clinician_is_eligible(cs.profile_id)
              and (exists (select 1 from public.task_claims c where c.clinician_id = cs.profile_id and c.ended_at is null)
                or exists (select 1 from public.availability_blocks b where b.clinician_id = cs.profile_id and b.state <> 'cancelled' and b.ends_at > now())
                or exists (select 1 from public.clinical_tasks t where t.state = 'offered_to_lead' and (t.pushed_to = cs.profile_id or t.lead_clinician_id = cs.profile_id))) loop
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
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'removal_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'Removing ineligible clinicians from work failed for some',
            format('%s clinician(s) could not be removed by private.remove_ineligible_from_work(); see audit_log action clinician.removal_error. They may still hold queue or rota slots.', v_errors),
            'removal_sweep', now(), now());
  end if;
  return jsonb_build_object('removed', v_removed, 'errors', v_errors);
end;
$$;
revoke all on function private.remove_ineligible_from_work() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Daily audit sweep: retry unassigned audits, notify the overdue once, top up the monthly floor, catch completions with no audit decision
-- ---------------------------------------------------------------------------
create function private.audit_floor_top_up(p_month date) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  sm jsonb := private.quality_setting('sampling'); r record; v_task uuid; v_made integer := 0;
begin
  for r in
    select t.claimed_by as clinician, count(*) as n from public.clinical_tasks t
     where t.state = 'completed' and t.claimed_by is not null and private.lagos_month(t.completed_at) = p_month
     group by t.claimed_by having count(*) >= (sm ->> 'floor_min_tasks')::integer
  loop
    if (select count(*) from public.clinical_audits a where a.clinician_id = r.clinician and a.audit_month = p_month and a.state <> 'cancelled') >= (sm ->> 'floor_per_clinician_per_month')::integer then continue; end if;
    select t.id into v_task from public.clinical_tasks t
     where t.state = 'completed' and t.claimed_by = r.clinician and private.lagos_month(t.completed_at) = p_month
       and not exists (select 1 from public.clinical_audits a where a.task_id = t.id and a.state <> 'cancelled')
     order by abs(hashtextextended(t.id::text || ':floor:' || p_month::text, 0)) limit 1;
    if v_task is not null and private.create_audit(v_task, 'floor_top_up', null) is not null then v_made := v_made + 1; end if;
  end loop;
  return v_made;
end;
$$;
revoke all on function private.audit_floor_top_up(date) from public, anon, authenticated;

create function private.quality_audit_sweep() returns jsonb
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
      perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'A clinical audit is overdue', 'A clinical audit is overdue. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', r.id), r.clinician_id, false);
      v_late := v_late + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event) values (r.organisation_id, 'clinical_audit.sweep_error', 'clinical_audit', r.id, jsonb_build_object('error', sqlerrm, 'step', 'overdue'));
    end;
  end loop;
  -- a completion whose audit decision failed at the time (the trigger never blocks a completion) is decided now
  for r in select t.id from public.clinical_tasks t
            where t.state = 'completed' and t.completed_at > now() - interval '3 days' and t.claimed_by is not null
              and exists (select 1 from public.audit_log l where l.action = 'clinical_audit.schedule_error' and l.entity_id = t.id) loop
    begin
      if private.consider_task_for_audit(r.id) is not null then v_missed := v_missed + 1; end if;
    exception when others then raise warning 'audit retry failed for %: %', r.id, sqlerrm; end;
  end loop;
  -- the monthly floor for last month, in the first week of the new month (idempotent)
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
revoke all on function private.quality_audit_sweep() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('safety-concern-sweep', 'remove-ineligible-from-work', 'quality-audit-sweep');
  perform cron.schedule('safety-concern-sweep', '7 * * * *', $c$select private.safety_concern_sweep()$c$);
  perform cron.schedule('remove-ineligible-from-work', '15 5 * * *', $c$select private.remove_ineligible_from_work()$c$);
  perform cron.schedule('quality-audit-sweep', '30 5 * * *', $c$select private.quality_audit_sweep()$c$);
end $$;

-- ---------------------------------------------------------------------------
-- 10. RLS and grants. Writes happen only inside the functions above.
-- ---------------------------------------------------------------------------
alter table public.quality_config enable row level security;
alter table public.clinical_audits enable row level security;
alter table public.clinician_tier1_audit_extensions enable row level security;
alter table public.handback_reviews enable row level security;
alter table public.safety_concerns enable row level security;
alter table public.safety_concern_messages enable row level security;
alter table public.safety_concern_readers enable row level security;
alter table public.retaliation_reviews enable row level security;

create policy quality_config_select on public.quality_config for select to authenticated using (private.task_staff_reader());
-- audits: the reviewer, the clinical lead, and the audited clinician once it is submitted. Not admin accounts.
create policy clinical_audits_select on public.clinical_audits for select to authenticated
  using (private.cmo_of(organisation_id) or reviewer_id = (select auth.uid()) or (clinician_id = (select auth.uid()) and state = 'submitted'));
create policy clinician_tier1_audit_extensions_select on public.clinician_tier1_audit_extensions for select to authenticated using (private.cmo_of(organisation_id));
create policy handback_reviews_select on public.handback_reviews for select to authenticated using (private.cmo_of(organisation_id));
-- the speak-up route: no admin, no ops. The raiser, the lead, and named backup readers once it is escalated.
create policy safety_concerns_select on public.safety_concerns for select to authenticated
  using (raised_by = (select auth.uid()) or private.concern_reader(escalated_at, organisation_id));
create policy safety_concern_messages_select on public.safety_concern_messages for select to authenticated
  using (exists (select 1 from public.safety_concerns c where c.id = concern_id
                   and ((c.raised_by = (select auth.uid()) and kind in ('response', 'note', 'acknowledged', 'closed')) or private.concern_reader(c.escalated_at, c.organisation_id))));
create policy safety_concern_readers_select on public.safety_concern_readers for select to authenticated using (private.cmo_of(organisation_id));
create policy retaliation_reviews_select on public.retaliation_reviews for select to authenticated using (private.cmo_of(organisation_id) or private.backup_reader(organisation_id));

revoke all on public.quality_config, public.clinical_audits, public.clinician_tier1_audit_extensions, public.handback_reviews, public.safety_concerns,
  public.safety_concern_messages, public.safety_concern_readers, public.retaliation_reviews from anon, public, authenticated;
grant select on public.quality_config, public.clinical_audits, public.clinician_tier1_audit_extensions, public.handback_reviews, public.safety_concerns,
  public.safety_concern_messages, public.safety_concern_readers, public.retaliation_reviews to authenticated;

-- every public RPC: nobody by default, then signed-in users only
revoke all on function
  public.clinical_audit_queue(text), public.audit_case_file(uuid), public.submit_clinical_audit(uuid, jsonb, jsonb, text), public.close_audit_followup(uuid, text),
  public.reassign_clinical_audit(uuid, uuid), public.request_clinical_audit(uuid, text), public.tier1_audit_progress(uuid), public.extend_tier1_audits(uuid, integer, text),
  public.handback_review_queue(), public.close_handback_review(uuid, text, text),
  public.raise_safety_concern(text, text, text, text, uuid), public.my_safety_concerns(), public.safety_concern_inbox(text), public.acknowledge_safety_concern(uuid),
  public.respond_to_safety_concern(uuid, text), public.add_to_safety_concern(uuid, text), public.close_safety_concern(uuid, text), public.open_incident_for_concern(uuid, text),
  public.add_safety_concern_backup_reader(uuid, text), public.remove_safety_concern_backup_reader(uuid),
  public.retaliation_review_queue(), public.close_retaliation_review(uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.clinical_audit_queue(text), public.audit_case_file(uuid), public.submit_clinical_audit(uuid, jsonb, jsonb, text), public.close_audit_followup(uuid, text),
  public.reassign_clinical_audit(uuid, uuid), public.request_clinical_audit(uuid, text), public.tier1_audit_progress(uuid), public.extend_tier1_audits(uuid, integer, text),
  public.handback_review_queue(), public.close_handback_review(uuid, text, text),
  public.raise_safety_concern(text, text, text, text, uuid), public.my_safety_concerns(), public.safety_concern_inbox(text), public.acknowledge_safety_concern(uuid),
  public.respond_to_safety_concern(uuid, text), public.add_to_safety_concern(uuid, text), public.close_safety_concern(uuid, text), public.open_incident_for_concern(uuid, text),
  public.add_safety_concern_backup_reader(uuid, text), public.remove_safety_concern_backup_reader(uuid),
  public.retaliation_review_queue(), public.close_retaliation_review(uuid, text, text)
  to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.safety_concerns', 'SELECT') or has_table_privilege('authenticated', 'public.safety_concerns', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_audits', 'UPDATE') or has_function_privilege('anon', 'public.raise_safety_concern(text, text, text, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.remove_clinician_from_work(uuid, text)', 'EXECUTE') then
    raise exception 'S20 grants are wrong: concerns must not be readable by anon or writable directly, and private functions must not be callable';
  end if;
end $$;
