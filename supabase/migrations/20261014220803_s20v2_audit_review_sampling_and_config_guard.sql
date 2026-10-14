-- S20 v2 (plan Stage 4, defects Q1, Q3, Q4, Q7; CMO decisions 5, 6 recorded 2026-10-07): the audit can now detect a wrong clinical
-- decision, the draw cannot be predicted, the config cannot be edited under open audits, and the unused RPCs get a hand-back retry.
--
--   Q1  audit_case_file returns the task's clinical content (outcome note, the triage trigger and reading, the care messages in the
--       claim window, a matched scribe note) through an audited read (audit_log row with subject_patient_id, INV-10), with the
--       patient pseudonymised (no id, no name). submit_clinical_audit refuses until THIS reviewer opened the file. A critical miss or
--       an unsafe outcome needs a second, independent reviewer (not the first, not the audited clinician) before the audit is
--       final; the audited clinician can reply (append-only, visible to the lead); the form gains per-phase comments and an
--       avoidability rating (config, versioned); close_audit_followup is append-only history, never an overwrite.
--   Q3  The sampling draw is a SHA-256 of a secret seed (a table authenticated cannot read, one seed per Lagos month) so it cannot
--       be predicted; a clinician's floor is topped up with a seeded choice, with a catch-up later in the month; AI-scribe-assisted
--       notes are sampled and scored separately for omission and invented content (the task to note link is a time-window match,
--       see docs/design/S16-S20-quality-v2.md).
--   Q4  quality_config gets an immutability trigger (a version used by an audit, or signed, is frozen and cannot be deleted) and
--       joins the governed-config activation guard (private.refuse_activating_superseded_version).
--   Q7  The hand-back review check is a function the daily sweep retries (hand-backs with the queue.claims exempt reasons are not
--       counted); the sweep also assigns second reviewers and tops up the floor.
--
-- The new quality_config version 2 is INSERTED INACTIVE and unsigned. Nothing here signs or activates a configuration.
-- Counts before this migration (live 2026-10-14): checked by list_migrations only; the S20 tables hold fixture-free rows, so there
-- is no data conversion except marking already submitted audits final (no second review ever applied to them).
-- Replay note: public.submit_clinical_audit(uuid, jsonb, jsonb, text) is DROPPED and replaced by one function with defaulted
-- trailing parameters, so a 4-argument call stays unambiguous (a second overload would make every bare call ambiguous).

-- ---------------------------------------------------------------------------
-- 1. quality_config: approval columns, immutability and the activation guard (Q4)
-- ---------------------------------------------------------------------------
alter table public.quality_config
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null;

create function private.quality_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_used boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_active or old.approved_at is not null or exists (select 1 from public.clinical_audits a where a.config_version = old.version) then
      raise exception 'quality_config version % is active, signed or used by an audit and cannot be deleted; draft a new version', old.version using errcode = '23514';
    end if;
    return old;
  end if;
  v_used := exists (select 1 from public.clinical_audits a where a.config_version = old.version);
  if (new.version is distinct from old.version or new.rules is distinct from old.rules or new.effective_from is distinct from old.effective_from)
     and (v_used or old.approved_at is not null) then
    raise exception 'quality_config version % is signed or used by an audit and cannot be edited; draft a new version', old.version using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed quality_config keeps its signature' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.quality_config_guard() from public, anon, authenticated;
create trigger quality_config_guard before update or delete on public.quality_config
  for each row execute function private.quality_config_guard();

create trigger refuse_superseded_activation before update of is_active on public.quality_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- The CMO's own act. Not called by anything here; the sign-off hub wires it (docs/design/S16-S20-quality-v2.md section 6).
create function public.sign_quality_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.quality_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the quality configuration' using errcode = '42501'; end if;
  select * into c from public.quality_config where version = p_version for update;
  if not found then raise exception 'no such quality configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.quality_config set is_active = false where is_active and version <> p_version;
  update public.quality_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
end;
$$;
revoke all on function public.sign_quality_config(integer) from public, anon, authenticated;
grant execute on function public.sign_quality_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. quality_config version 2 (PROPOSED, inactive, unsigned). Version 1 is untouched.
-- ---------------------------------------------------------------------------
-- quality-audit-v2-begin
insert into public.quality_config (version, is_active, effective_from, rules) values (2, false, '2026-10-14', $json$
{
  "sampling": {
    "random_rate_percent": 10, "always_reasons": ["red_event", "titration"], "floor_min_tasks": 3, "floor_per_clinician_per_month": 1,
    "reviewer_monthly_cap": 40, "due_days": 14,
    "seed": { "rotation": "monthly" }, "stratified": true, "floor_catchup_until_day": 21, "floor_current_month_from_day": 20,
    "scribe_assisted_rate_percent": 20
  },
  "tier1": { "audited_task_count": 20, "graduation_min_score": 85, "max_critical_misses": 0 },
  "form": {
    "version": 2,
    "safety_items": ["identity_and_consent_confirmed", "red_flags_recognised_and_acted_on", "decision_within_competence_and_protocol", "no_unsigned_treatment_change", "safety_netting_and_follow_up_given", "escalated_when_needed"],
    "quality_items": ["history_adequate", "reasoning_documented", "communication_clear", "plan_appropriate", "patient_questions_answered", "documentation_timely"],
    "quality_max": 4,
    "phases": ["assessment", "decision", "action", "documentation"],
    "phase_comment_max_chars": 2000,
    "avoidability": { "required_unless_outcome": "satisfactory", "scale": ["not_applicable", "not_avoidable", "slightly_avoidable", "possibly_avoidable", "probably_avoidable", "definitely_avoidable"] },
    "scribe_items": ["no_clinically_relevant_omission", "no_invented_content"],
    "scribe_critical_items": ["no_invented_content"]
  },
  "outcomes": { "satisfactory_min": 85, "minor_concerns_min": 70, "rationale_min_chars": 20 },
  "second_review": { "required_on": ["critical_miss"], "reply_max_per_audit": 5, "reply_min_chars": 20 },
  "reliability": { "audit_weight": 2, "good_by_outcome": { "satisfactory": 1, "minor_concerns": 0.6, "significant_concerns": 0.2, "unsafe": 0 } },
  "speak_up": {
    "acknowledge_hours": 48, "immediate_acknowledge_hours": 4, "respond_days": 14, "max_per_day": 10, "retaliation_review_months": 12,
    "checkin_days": [30, 90], "anonymous_max_per_day_per_org": 10, "about_lead_routes_to": "independent_reader"
  }
}
$json$::jsonb);
-- quality-audit-v2-end

-- ---------------------------------------------------------------------------
-- 3. Secret sampling seed (Q3). Row level security on, no policy, no grant: only the definer functions below read it.
-- ---------------------------------------------------------------------------
create table public.quality_sampling_seeds (
  month      date primary key,
  seed       text not null check (char_length(seed) >= 32),
  created_at timestamptz not null default now()
);
alter table public.quality_sampling_seeds enable row level security;
revoke all on public.quality_sampling_seeds from public, anon, authenticated;
comment on table public.quality_sampling_seeds is 'S20 v2: one secret seed per Lagos month for the audit draw. Unreadable by every API role; rotated by month.';

create function private.sampling_seed(p_month date) returns text
language plpgsql security definer set search_path = ''
as $$
declare v text;
begin
  select seed into v from public.quality_sampling_seeds where month = p_month;
  if v is null then
    insert into public.quality_sampling_seeds (month, seed) values (p_month, gen_random_uuid()::text || gen_random_uuid()::text) on conflict (month) do nothing;
    select seed into v from public.quality_sampling_seeds where month = p_month;
  end if;
  return v;
end;
$$;
revoke all on function private.sampling_seed(date) from public, anon, authenticated;

-- A draw between 0 and 100 that nobody without the month's seed can compute in advance.
create function private.sampling_draw(p_task uuid, p_month date, p_salt text) returns numeric
language sql volatile security definer set search_path = ''
as $$
  select (('x' || encode(substring(extensions.digest(private.sampling_seed(p_month) || ':' || p_salt || ':' || p_task::text, 'sha256') from 1 for 6), 'hex'))::bit(48)::bigint)::numeric
         / 281474976710656 * 100;
$$;
revoke all on function private.sampling_draw(uuid, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. clinical_audits additions
-- ---------------------------------------------------------------------------
alter table public.clinical_audits drop constraint if exists clinical_audits_reason_check;
alter table public.clinical_audits add constraint clinical_audits_reason_check
  check (reason in ('random_sample', 'floor_top_up', 'red_event', 'titration', 'first_tasks', 'lead_request', 'scribe_sample'));

alter table public.clinical_audits
  add column case_opened_at         timestamptz,
  add column phase_comments         jsonb,
  add column avoidability           text,
  add column scribe_assisted        boolean not null default false,
  add column scribe_results         jsonb,
  add column second_review_required boolean not null default false,
  add column second_reviewer_id     uuid references public.profiles (id) on delete set null,
  add column second_notified_at     timestamptz,
  add column final_at               timestamptz,
  add column final_outcome          text check (final_outcome is null or final_outcome in ('satisfactory', 'minor_concerns', 'significant_concerns', 'unsafe')),
  add column second_review_agrees   boolean,
  add constraint clinical_audits_second_not_first check (second_reviewer_id is null or (second_reviewer_id <> clinician_id and second_reviewer_id is distinct from reviewer_id));

-- audits already submitted before this migration never had a second review: they are final as they stand
do $$
begin
  perform set_config('tarragon.audit_backfill', 'on', true);
  update public.clinical_audits set final_at = submitted_at, final_outcome = outcome where state = 'submitted' and final_at is null;
end $$;

-- the frozen columns after submit or cancel: everything except the bookkeeping below. The follow-up fields are set once.
create or replace function private.clinical_audit_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_loose text[] := array['followup_closed_at', 'followup_note', 'overdue_notified_at', 'second_reviewer_id', 'second_notified_at', 'final_at', 'final_outcome', 'second_review_agrees'];
begin
  if tg_op = 'DELETE' then raise exception 'clinical audits are never deleted' using errcode = '23514'; end if;
  if old.state in ('submitted', 'cancelled')
     and (to_jsonb(old) - v_loose) is distinct from (to_jsonb(new) - v_loose) then
    raise exception 'a submitted clinical audit cannot be changed' using errcode = '23514';
  end if;
  if old.followup_closed_at is not null and (new.followup_closed_at is distinct from old.followup_closed_at or new.followup_note is distinct from old.followup_note) then
    raise exception 'a closed follow-up is history and cannot be overwritten' using errcode = '23514';
  end if;
  if old.final_at is not null and (new.final_at is distinct from old.final_at or new.final_outcome is distinct from old.final_outcome) then
    raise exception 'a final audit cannot be changed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create table public.clinical_audit_case_opens (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  audit_id        uuid not null references public.clinical_audits (id) on delete cascade,
  reader_id       uuid not null references public.profiles (id) on delete restrict,
  role            text not null check (role in ('first', 'second')),
  opened_at       timestamptz not null default now(),
  is_test         boolean not null default false
);
create index clinical_audit_case_opens_idx on public.clinical_audit_case_opens (audit_id, reader_id, role);
create trigger clinical_audit_case_opens_append_only before update or delete on public.clinical_audit_case_opens
  for each row execute function private.queue_append_only();

create table public.clinical_audit_second_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  audit_id        uuid not null unique references public.clinical_audits (id) on delete cascade,
  reviewer_id     uuid not null references public.profiles (id) on delete restrict,
  safety_results  jsonb not null,
  quality_scores  jsonb not null,
  total_score     numeric not null check (total_score between 0 and 100),
  critical_miss   boolean not null,
  outcome         text not null check (outcome in ('satisfactory', 'minor_concerns', 'significant_concerns', 'unsafe')),
  rationale       text not null check (char_length(btrim(rationale)) >= 20),
  phase_comments  jsonb,
  submitted_at    timestamptz not null default now(),
  is_test         boolean not null default false
);
create trigger clinical_audit_second_reviews_append_only before update or delete on public.clinical_audit_second_reviews
  for each row execute function private.queue_append_only();

create table public.clinical_audit_replies (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  audit_id        uuid not null references public.clinical_audits (id) on delete cascade,
  author_id       uuid not null references public.profiles (id) on delete restrict,
  body            text not null check (char_length(btrim(body)) between 20 and 4000),
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false
);
create index clinical_audit_replies_idx on public.clinical_audit_replies (audit_id, created_at);
create trigger clinical_audit_replies_append_only before update or delete on public.clinical_audit_replies
  for each row execute function private.queue_append_only();

create table public.clinical_audit_followups (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  audit_id        uuid not null references public.clinical_audits (id) on delete cascade,
  kind            text not null check (kind in ('note', 'closed')),
  note            text not null check (char_length(btrim(note)) >= 20),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false
);
create index clinical_audit_followups_idx on public.clinical_audit_followups (audit_id, created_at);
create trigger clinical_audit_followups_append_only before update or delete on public.clinical_audit_followups
  for each row execute function private.queue_append_only();

-- carry the follow-ups that were closed under version 1 into the history (their note is kept once, not overwritten)
insert into public.clinical_audit_followups (organisation_id, audit_id, kind, note, created_at, is_test)
  select organisation_id, id, 'closed', followup_note, followup_closed_at, is_test
    from public.clinical_audits where followup_closed_at is not null and followup_note is not null and char_length(btrim(followup_note)) >= 20;

-- ---------------------------------------------------------------------------
-- 5. Helpers: scribe link, scoring, reviewers
-- ---------------------------------------------------------------------------
-- There is no task to note foreign key (S23 notes are keyed by patient and author). This is a time-window match: a note the same
-- clinician wrote for the same patient, drafted by the scribe, created between the claim and a day after completion.
create function private.task_scribe_note(p_task uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select n.id from public.clinical_tasks t
    join public.clinical_encounter_notes n on n.patient_id = t.patient_id and n.authored_by_profile = t.claimed_by and n.scribe_consent_id is not null
   where t.id = p_task and t.claimed_by is not null and t.completed_at is not null
     and n.created_at between coalesce(t.claimed_at, t.created_at) - interval '1 hour' and t.completed_at + interval '1 day'
   order by n.created_at desc limit 1;
$$;
revoke all on function private.task_scribe_note(uuid) from public, anon, authenticated;

create function private.outcome_rank(p_outcome text) returns integer
language sql immutable set search_path = ''
as $$ select case p_outcome when 'satisfactory' then 0 when 'minor_concerns' then 1 when 'significant_concerns' then 2 when 'unsafe' then 3 else null end $$;
revoke all on function private.outcome_rank(text) from public, anon, authenticated;

-- The shared form check and score. Raises for anything malformed; returns { score, critical, outcome, scribe_critical }.
create function private.score_audit_form(p_cfg integer, p_safety jsonb, p_quality jsonb, p_rationale text, p_scribe jsonb, p_scribe_assisted boolean) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  f jsonb; o jsonb; v_key text; v_val jsonb; v_max integer; v_sum numeric := 0; v_n integer := 0; v_critical boolean := false;
  v_score numeric; v_outcome text; v_scribe_critical boolean := false;
begin
  select rules -> 'form', rules -> 'outcomes' into f, o from public.quality_config where version = p_cfg;
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
  -- the scribe items are scored on their own, never folded into the total; an invented-content failure is a critical miss
  if p_scribe_assisted and f ? 'scribe_items' then
    if p_scribe is null or jsonb_typeof(p_scribe) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_scribe) k) is distinct from (select array_agg(i order by i) from jsonb_array_elements_text(f -> 'scribe_items') i) then
      raise exception 'this note was drafted by the scribe: score every scribe item and no others' using errcode = '22023';
    end if;
    for v_key, v_val in select * from jsonb_each(p_scribe) loop
      if jsonb_typeof(v_val) <> 'boolean' then raise exception 'scribe item % must be true or false', v_key using errcode = '22023'; end if;
      if not (v_val #>> '{}')::boolean and coalesce(f -> 'scribe_critical_items', '[]'::jsonb) ? v_key then v_scribe_critical := true; end if;
    end loop;
  elsif p_scribe is not null and not (p_scribe_assisted and f ? 'scribe_items') then
    raise exception 'this audit has no scribe items' using errcode = '22023';
  end if;
  v_score := round(100 * v_sum / (v_max * v_n), 1);
  v_critical := v_critical or v_scribe_critical;
  v_outcome := case when v_critical then 'unsafe'
                    when v_score >= (o ->> 'satisfactory_min')::numeric then 'satisfactory'
                    when v_score >= (o ->> 'minor_concerns_min')::numeric then 'minor_concerns'
                    else 'significant_concerns' end;
  if v_outcome <> 'satisfactory' and char_length(btrim(coalesce(p_rationale, ''))) < (o ->> 'rationale_min_chars')::integer then
    raise exception 'give a written reason of at least % characters for anything other than satisfactory', o ->> 'rationale_min_chars' using errcode = '22023';
  end if;
  return jsonb_build_object('score', v_score, 'critical', v_critical, 'outcome', v_outcome, 'scribe_critical', v_scribe_critical);
end;
$$;
revoke all on function private.score_audit_form(integer, jsonb, jsonb, text, jsonb, boolean) from public, anon, authenticated;

-- phase comments: only the form's phases, each a short string; null when the form has none
create function private.clean_phase_comments(p_cfg integer, p_comments jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare f jsonb; v_key text; v_val jsonb; v_max integer; v_out jsonb := '{}'::jsonb;
begin
  select rules -> 'form' into f from public.quality_config where version = p_cfg;
  if p_comments is null or p_comments = '{}'::jsonb then return null; end if;
  if not (f ? 'phases') then raise exception 'this form has no phase comments' using errcode = '22023'; end if;
  if jsonb_typeof(p_comments) <> 'object' then raise exception 'send the phase comments as an object' using errcode = '22023'; end if;
  v_max := coalesce((f ->> 'phase_comment_max_chars')::integer, 2000);
  for v_key, v_val in select * from jsonb_each(p_comments) loop
    if not (f -> 'phases') ? v_key then raise exception 'unknown phase %', v_key using errcode = '22023'; end if;
    if jsonb_typeof(v_val) <> 'string' or char_length(v_val #>> '{}') > v_max then raise exception 'the % comment must be text of at most % characters', v_key, v_max using errcode = '22023'; end if;
    if btrim(v_val #>> '{}') <> '' then v_out := v_out || jsonb_build_object(v_key, btrim(v_val #>> '{}')); end if;
  end loop;
  return nullif(v_out, '{}'::jsonb);
end;
$$;
revoke all on function private.clean_phase_comments(integer, jsonb) from public, anon, authenticated;

-- a second reviewer: another active, eligible chief medical officer who is neither the first reviewer nor the audited clinician
create function private.audit_second_reviewer_for(p_audit uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_audits a
    join public.clinical_staff cs on cs.organisation_id = a.organisation_id and cs.is_test = a.is_test
   where a.id = p_audit and cs.profile_id is not null and cs.profile_id <> a.clinician_id and cs.profile_id is distinct from a.reviewer_id
     and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' and private.clinician_is_eligible(cs.profile_id)
     and (select count(*) from public.clinical_audits b where b.second_reviewer_id = cs.profile_id and b.audit_month = a.audit_month)
         < ((private.quality_setting('sampling') ->> 'reviewer_monthly_cap')::integer)
   order by (select count(*) from public.clinical_audits b where b.second_reviewer_id = cs.profile_id and b.final_at is null), cs.profile_id
   limit 1;
$$;
revoke all on function private.audit_second_reviewer_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Creating and deciding audits (Q3): the secret-seeded draw, the scribe sample, the floor
-- ---------------------------------------------------------------------------
create or replace function private.create_audit(p_task uuid, p_reason text, p_draw numeric) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype; s public.clinical_staff%rowtype;
  v_cfg integer; v_form integer; v_month date; v_reviewer uuid; v_id uuid; v_due integer; v_scribe boolean;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found or t.state <> 'completed' or t.claimed_by is null then return null; end if;
  select * into s from public.clinical_staff where profile_id = t.claimed_by;
  if not found then return null; end if;
  select version, (rules -> 'form' ->> 'version')::integer into v_cfg, v_form from public.quality_config where is_active;
  v_due := (private.quality_setting('sampling') ->> 'due_days')::integer;
  v_month := private.lagos_month(coalesce(t.completed_at, now()));
  v_reviewer := private.audit_reviewer_for(t.organisation_id, t.is_test, t.claimed_by, v_month);
  v_scribe := private.task_scribe_note(t.id) is not null;
  insert into public.clinical_audits (organisation_id, task_id, clinician_id, reviewer_id, reason, audit_month, sample_draw, counts_toward_tier1,
                                     state, config_version, form_version, due_at, is_test, scribe_assisted)
  values (t.organisation_id, t.id, t.claimed_by, v_reviewer, p_reason, v_month, p_draw, coalesce(s.credentialing_level, 2) = 1,
          case when v_reviewer is null then 'unassigned' else 'assigned' end, v_cfg, v_form, now() + make_interval(days => v_due), t.is_test, v_scribe)
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

create or replace function private.consider_task_for_audit(p_task uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype; s public.clinical_staff%rowtype; sm jsonb := private.quality_setting('sampling');
  v_reason text; v_draw numeric; v_rate numeric := (sm ->> 'random_rate_percent')::numeric; v_month date; v_scribe_rate numeric;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found or t.state <> 'completed' or t.claimed_by is null then return null; end if;
  select * into s from public.clinical_staff where profile_id = t.claimed_by;
  if not found then return null; end if;
  v_month := private.lagos_month(coalesce(t.completed_at, now()));
  -- Q3: a keyed draw. The seed is secret and rotates monthly, so the sample cannot be predicted or steered.
  v_draw := private.sampling_draw(t.id, v_month, 'random');
  v_scribe_rate := (sm ->> 'scribe_assisted_rate_percent')::numeric;
  if t.priority_class_original = 1 or t.type = 'red_event_unacknowledged' then v_reason := 'red_event';
  elsif t.type = 'titration_signoff' then v_reason := 'titration';
  elsif coalesce(s.credentialing_level, 2) = 1 and private.tier1_count(t.claimed_by) < private.tier1_target(s.id) then v_reason := 'first_tasks';
  elsif v_scribe_rate is not null and private.task_scribe_note(t.id) is not null and private.sampling_draw(t.id, v_month, 'scribe') < v_scribe_rate then v_reason := 'scribe_sample';
  elsif v_draw < v_rate then v_reason := 'random_sample';
  else return null;
  end if;
  return private.create_audit(p_task, v_reason, v_draw);
end;
$$;

-- the floor: one audit per clinician per month once they completed enough tasks, chosen by the secret seed
create or replace function private.audit_floor_top_up(p_month date) returns integer
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
     order by private.sampling_draw(t.id, p_month, 'floor') limit 1;
    if v_task is not null and private.create_audit(v_task, 'floor_top_up', null) is not null then v_made := v_made + 1; end if;
  end loop;
  return v_made;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Hand-back review (Q7): one function the trigger and the daily sweep both call. The queue.claims exempt reasons are not counted.
-- ---------------------------------------------------------------------------
create function private.check_handback_review(p_clinician uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := private.claim_setting('handback_review'); v_ex jsonb := coalesce(private.claim_setting('handback_cooldown') -> 'exempt_reasons', '[]'::jsonb);
  v_days integer; v_more integer; v_n integer; v_reasons jsonb; v_org uuid; v_test boolean; v_ins integer;
begin
  v_days := (r ->> 'window_days')::integer; v_more := (r ->> 'more_than')::integer;
  select coalesce(sum(c), 0)::integer, coalesce(jsonb_object_agg(reason_code, c), '{}'::jsonb) into v_n, v_reasons
    from (select reason_code, count(*) c from public.task_handbacks
           where clinician_id = p_clinician and created_at > now() - make_interval(days => v_days) and not (v_ex ? reason_code::text) group by reason_code) x;
  if v_n <= v_more then return false; end if;
  select organisation_id, is_test into v_org, v_test from public.clinical_staff where profile_id = p_clinician;
  if v_org is null then return false; end if;
  insert into public.handback_reviews (organisation_id, clinician_id, window_days, handbacks, reasons, is_test)
  values (v_org, p_clinician, v_days, v_n, v_reasons, v_test) on conflict (clinician_id) where state = 'open' do nothing;
  get diagnostics v_ins = row_count;
  if v_ins > 0 then
    perform private.notify_clinical_leads(v_org, v_test, 'A hand-back pattern needs review',
      'A hand-back pattern needs your review. Open the reviews page in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.handback_review'), p_clinician, false);
  end if;
  return v_ins > 0;
end;
$$;
revoke all on function private.check_handback_review(uuid) from public, anon, authenticated;

create or replace function private.trg_handback_review() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.check_handback_review(new.clinician_id);
  exception when others then
    raise warning 'hand-back review check failed for %: %', new.clinician_id, sqlerrm;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      select organisation_id, 'handback_review.error', 'clinical_staff', id, jsonb_build_object('error', sqlerrm) from public.clinical_staff where profile_id = new.clinician_id;
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The audit functions (Q1)
-- ---------------------------------------------------------------------------
-- Whoever opens the case file reads clinical content: it is an audited clinical read (INV-10) and the patient is pseudonymised.
create or replace function public.audit_case_file(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype; t public.clinical_tasks%rowtype; v_role text;
  v_ref text; v_age integer; v_trig jsonb; v_reading jsonb; v_msgs jsonb; v_note jsonb; v_te public.triage_events%rowtype; v_note_id uuid;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can open an audit case file' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit;
  if not found or not private.cmo_of(a.organisation_id) then raise exception 'audit not found' using errcode = 'P0002'; end if;
  if a.clinician_id = v_uid then raise exception 'you cannot audit your own work' using errcode = '42501'; end if;
  if a.state in ('assigned', 'unassigned') then
    if a.reviewer_id is not null and a.reviewer_id <> v_uid then raise exception 'this audit is assigned to another reviewer' using errcode = '42501'; end if;
    v_role := 'first';
  elsif a.state = 'submitted' and a.second_review_required and a.final_at is null and a.second_reviewer_id = v_uid then
    v_role := 'second';
  elsif a.state = 'submitted' and a.second_review_required and a.final_at is null and a.second_reviewer_id is not null then
    raise exception 'this audit is assigned to another reviewer' using errcode = '42501';
  else
    raise exception 'this audit is not open for review by you' using errcode = '42501';
  end if;
  select * into t from public.clinical_tasks where id = a.task_id;

  -- the audited read: one audit_log row per opening, with the patient as the subject, and one row in the opens table
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (a.organisation_id, v_uid, 'clinical_audit.case_file_read', 'clinical_task', t.id, jsonb_build_object('audit_id', a.id, 'role', v_role), t.patient_id);
  insert into public.clinical_audit_case_opens (organisation_id, audit_id, reader_id, role, is_test) values (a.organisation_id, a.id, v_uid, v_role, a.is_test);
  if v_role = 'first' and a.case_opened_at is null then update public.clinical_audits set case_opened_at = now() where id = a.id; end if;

  -- pseudonymised patient: a reference that is stable within this audit, and an age band. No id, name, phone or address.
  v_ref := 'P-' || upper(substr(encode(extensions.digest(a.id::text || ':' || t.patient_id::text, 'sha256'), 'hex'), 1, 6));
  select extract(year from age(date_of_birth))::integer into v_age from public.profiles where id = t.patient_id;

  select * into v_te from public.triage_events where id = t.triage_event_id;
  if found then
    v_trig := jsonb_build_object('kind', v_te.trigger_type, 'grade', v_te.grade, 'rule_id', v_te.rule_id, 'rule_set_version', v_te.rule_set_version,
                                 'explanation_key', v_te.explanation_key, 'basis', v_te.basis, 'at', v_te.created_at);
    if v_te.trigger_type = 'observation' then
      select jsonb_build_object('vital_type', vr.vital_type, 'systolic', vr.systolic, 'diastolic', vr.diastolic, 'pulse_bpm', vr.pulse_bpm, 'glucose_mmol_l', vr.glucose_mmol_l,
                                'temperature_c', vr.temperature_c, 'spo2_pct', vr.spo2_pct, 'taken_at', vr.taken_at, 'patient_note', vr.note)
        into v_reading from public.vitals_readings vr where vr.id = v_te.trigger_id and vr.patient_id = t.patient_id;
    end if;
  end if;

  -- the conversation around the work: messages between this patient and the care team from the task's creation to a day after completion
  select coalesce(jsonb_agg(jsonb_build_object('from', case when m.author_role::text = 'patient' then 'patient' else 'care_team' end,
                                               'by_audited_clinician', m.author_profile_id = a.clinician_id, 'body', m.body, 'at', m.created_at) order by m.created_at), '[]'::jsonb)
    into v_msgs from public.care_messages m
   where m.patient_id = t.patient_id and m.created_at between t.created_at and coalesce(t.completed_at, now()) + interval '1 day';

  v_note_id := private.task_scribe_note(t.id);
  if v_note_id is not null then
    select jsonb_build_object('scribe_drafted', true, 'reason', n.reason_for_encounter, 'history', n.history, 'examination', n.examination_findings,
                              'assessment', n.assessment, 'diagnosis', n.diagnosis, 'plan', n.plan, 'follow_up', n.follow_up_instructions, 'status', n.status)
      into v_note from public.clinical_encounter_notes n where n.id = v_note_id;
  end if;

  return jsonb_build_object(
    'audit', jsonb_build_object('id', a.id, 'reason', a.reason, 'state', a.state, 'due_at', a.due_at, 'form_version', a.form_version,
                                'opened_as', v_role, 'scribe_assisted', a.scribe_assisted),
    'form', (select rules -> 'form' from public.quality_config where version = a.config_version),
    'patient', jsonb_build_object('ref', v_ref, 'age', v_age),
    'task', jsonb_build_object('id', t.id, 'type', t.type, 'priority_class', t.priority_class_original, 'created_at', t.created_at, 'due_at', t.due_at,
                               'completed_at', t.completed_at, 'handback_count', t.handback_count, 'outcome', t.outcome),
    'trigger', v_trig, 'reading', v_reading, 'messages', v_msgs, 'scribe_note', v_note);
end;
$$;

drop function if exists public.submit_clinical_audit(uuid, jsonb, jsonb, text);

-- private: everything after the first reviewer's score is saved, and again after a second review. Runs once an audit is final.
create function private.finalise_audit(p_audit uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinical_audits%rowtype; s public.clinical_staff%rowtype; v_rel jsonb; v_cqv integer; v_done integer; v_avg numeric; v_miss integer; t1 jsonb; v_first boolean;
begin
  select * into a from public.clinical_audits where id = p_audit;
  select rules -> 'reliability' into v_rel from public.quality_config where version = a.config_version;
  select version into v_cqv from public.queue_claim_config where is_active;
  select * into s from public.clinical_staff where profile_id = a.clinician_id;
  insert into public.clinician_reliability_events (organisation_id, clinician_id, task_id, kind, good, weight, config_version, is_test)
  values (a.organisation_id, a.clinician_id, a.task_id, 'audit_result', (v_rel -> 'good_by_outcome' ->> a.final_outcome)::numeric, (v_rel ->> 'audit_weight')::numeric, v_cqv, a.is_test);
  perform private.recompute_reliability(a.clinician_id);
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, a.organisation_id, 'An audit of your work is complete',
      'An audit of one of your tasks has been completed. You can read the result under Training and profile.',
      jsonb_build_object('audit_id', a.id, 'i18n_key', 'quality.audit_complete'), false);
  end if;
  if a.counts_toward_tier1 and s.id is not null then
    t1 := private.quality_setting('tier1');
    select count(*), coalesce(avg(total_score), 0), count(*) filter (where critical_miss or final_outcome = 'unsafe')
      into v_done, v_avg, v_miss from public.clinical_audits where clinician_id = a.clinician_id and counts_toward_tier1 and state = 'submitted' and final_at is not null;
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
end;
$$;
revoke all on function private.finalise_audit(uuid) from public, anon, authenticated;

create function public.submit_clinical_audit(p_audit uuid, p_safety jsonb, p_quality jsonb, p_rationale text,
                                             p_phase_comments jsonb default null, p_avoidability text default null, p_scribe jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype; f jsonb; sr jsonb; v_res jsonb; v_outcome text; v_critical boolean; v_comments jsonb;
  v_second boolean; v_second_reviewer uuid;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can submit an audit' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) then raise exception 'audit not found' using errcode = 'P0002'; end if;
  if a.clinician_id = v_uid then raise exception 'you cannot audit your own work' using errcode = '42501'; end if;
  if a.state not in ('assigned', 'unassigned') then raise exception 'this audit is already %', a.state using errcode = '23514'; end if;
  if a.reviewer_id is not null and a.reviewer_id <> v_uid then raise exception 'this audit is assigned to another reviewer' using errcode = '42501'; end if;
  -- Q1: a score cannot be signed without having read the case. The reader must be the one submitting.
  if not exists (select 1 from public.clinical_audit_case_opens o where o.audit_id = a.id and o.reader_id = v_uid and o.role = 'first') then
    raise exception 'open the case file before you submit the audit' using errcode = '23514';
  end if;
  select rules -> 'form', rules -> 'second_review' into f, sr from public.quality_config where version = a.config_version;
  v_res := private.score_audit_form(a.config_version, p_safety, p_quality, p_rationale, p_scribe, a.scribe_assisted);
  v_outcome := v_res ->> 'outcome'; v_critical := (v_res ->> 'critical')::boolean;
  v_comments := private.clean_phase_comments(a.config_version, p_phase_comments);
  if f ? 'avoidability' then
    if p_avoidability is not null and not (f -> 'avoidability' -> 'scale') ? p_avoidability then raise exception 'unknown avoidability rating' using errcode = '22023'; end if;
    if p_avoidability is null and v_outcome <> coalesce(f -> 'avoidability' ->> 'required_unless_outcome', 'satisfactory') then
      raise exception 'rate how avoidable the problem was' using errcode = '22023';
    end if;
  elsif p_avoidability is not null then
    raise exception 'this form has no avoidability rating' using errcode = '22023';
  end if;
  -- decision 5: any critical miss (an unsafe outcome is one) needs a second, independent reviewer before the audit is final
  v_second := (v_critical or v_outcome = 'unsafe') and coalesce(sr -> 'required_on', '["critical_miss"]'::jsonb) ? 'critical_miss';
  update public.clinical_audits set state = 'submitted', reviewer_id = v_uid, safety_results = p_safety, quality_scores = p_quality, total_score = (v_res ->> 'score')::numeric,
         critical_miss = v_critical, outcome = v_outcome, rationale = nullif(btrim(coalesce(p_rationale, '')), ''), submitted_at = now(),
         followup_needed = v_outcome in ('significant_concerns', 'unsafe'), phase_comments = v_comments, avoidability = p_avoidability,
         scribe_results = case when a.scribe_assisted then p_scribe else null end, second_review_required = v_second,
         final_at = case when v_second then null else now() end, final_outcome = case when v_second then null else v_outcome end
   where id = a.id;
  perform private.emit_domain_event('clinical_audit.completed', a.organisation_id, jsonb_build_object('audit_id', a.id, 'outcome', v_outcome),
    'clinical_audit.completed:' || a.id, null, 'clinical_audit', a.id);
  if v_outcome in ('significant_concerns', 'unsafe') then
    perform private.emit_domain_event('clinical_audit.concern_found', a.organisation_id, jsonb_build_object('audit_id', a.id, 'outcome', v_outcome),
      'clinical_audit.concern_found:' || a.id, null, 'clinical_audit', a.id);
  end if;
  if v_second then
    v_second_reviewer := private.audit_second_reviewer_for(a.id);
    if v_second_reviewer is not null then
      update public.clinical_audits set second_reviewer_id = v_second_reviewer where id = a.id;
      perform private.credential_notify(v_second_reviewer, a.organisation_id, 'A clinical audit is waiting for you',
        'A clinical audit has been assigned to you. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', a.id, 'i18n_key', 'quality.audit_assigned'), false);
    else
      perform private.notify_clinical_leads(a.organisation_id, a.is_test, 'A clinical audit has no reviewer',
        'A clinical audit could not be assigned to a reviewer. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', a.id, 'i18n_key', 'quality.audit_no_reviewer'), a.clinician_id, false);
    end if;
  else
    perform private.finalise_audit(a.id);
  end if;
  return jsonb_build_object('outcome', v_outcome, 'total_score', v_res -> 'score', 'critical_miss', v_critical, 'needs_second_review', v_second, 'second_reviewer_assigned', v_second_reviewer is not null);
end;
$$;

create function public.submit_second_audit_review(p_audit uuid, p_safety jsonb, p_quality jsonb, p_rationale text, p_phase_comments jsonb default null, p_scribe jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype; v_res jsonb; v_outcome text; v_final text; v_agrees boolean;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can submit an audit' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) then raise exception 'audit not found' using errcode = 'P0002'; end if;
  if a.clinician_id = v_uid then raise exception 'you cannot audit your own work' using errcode = '42501'; end if;
  if v_uid = a.reviewer_id then raise exception 'the second review must come from a different reviewer' using errcode = '42501'; end if;
  if a.state <> 'submitted' or not a.second_review_required or a.final_at is not null then raise exception 'this audit does not need a second review' using errcode = '23514'; end if;
  if a.second_reviewer_id is distinct from v_uid then raise exception 'this audit is assigned to another reviewer' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinical_audit_case_opens o where o.audit_id = a.id and o.reader_id = v_uid and o.role = 'second') then
    raise exception 'open the case file before you submit the audit' using errcode = '23514';
  end if;
  v_res := private.score_audit_form(a.config_version, p_safety, p_quality, p_rationale, p_scribe, a.scribe_assisted);
  v_outcome := v_res ->> 'outcome';
  if char_length(btrim(coalesce(p_rationale, ''))) < 20 then raise exception 'a second review always needs a written reason of at least 20 characters' using errcode = '22023'; end if;
  insert into public.clinical_audit_second_reviews (organisation_id, audit_id, reviewer_id, safety_results, quality_scores, total_score, critical_miss, outcome, rationale, phase_comments, is_test)
  values (a.organisation_id, a.id, v_uid, p_safety, p_quality, (v_res ->> 'score')::numeric, (v_res ->> 'critical')::boolean, v_outcome, btrim(p_rationale),
          private.clean_phase_comments(a.config_version, p_phase_comments), a.is_test);
  -- the more severe of the two readings stands (the conservative choice, an open question for the lead); disagreement is recorded
  v_final := case when private.outcome_rank(v_outcome) > private.outcome_rank(a.outcome) then v_outcome else a.outcome end;
  v_agrees := v_outcome = a.outcome;
  update public.clinical_audits set final_at = now(), final_outcome = v_final, second_review_agrees = v_agrees where id = a.id;
  perform private.finalise_audit(a.id);
  return jsonb_build_object('final_outcome', v_final, 'agrees', v_agrees);
end;
$$;

-- the audited clinician can answer the audit once it is final; the lead sees every reply
create function public.reply_to_clinical_audit(p_audit uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype; sr jsonb; v_max integer; v_min integer;
begin
  select * into a from public.clinical_audits where id = p_audit and clinician_id = v_uid;
  if not found or a.state <> 'submitted' or a.final_at is null then raise exception 'there is no finished audit of your work with that id' using errcode = 'P0002'; end if;
  select rules -> 'second_review' into sr from public.quality_config where version = a.config_version;
  v_max := coalesce((sr ->> 'reply_max_per_audit')::integer, 5);
  v_min := coalesce((sr ->> 'reply_min_chars')::integer, 20);
  if char_length(btrim(coalesce(p_body, ''))) < v_min then raise exception 'write a reply of at least % characters', v_min using errcode = '22023'; end if;
  if (select count(*) from public.clinical_audit_replies where audit_id = a.id) >= v_max then raise exception 'you have replied the most times allowed; speak to the clinical lead' using errcode = '54000'; end if;
  insert into public.clinical_audit_replies (organisation_id, audit_id, author_id, body, is_test) values (a.organisation_id, a.id, v_uid, btrim(p_body), a.is_test);
  perform private.notify_clinical_leads(a.organisation_id, a.is_test, 'A clinical audit has a reply', 'A clinician replied to an audit. Open the audits page in the clinical lead area.',
    jsonb_build_object('audit_id', a.id, 'i18n_key', 'quality.audit_reply'), v_uid, false);
end;
$$;

-- the follow-up is history: each action appends; the close can happen once and is never overwritten
create or replace function public.close_audit_followup(p_audit uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can close a follow-up' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'say what was done, in at least 20 characters' using errcode = '22023'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) or a.state <> 'submitted' or not a.followup_needed or a.followup_closed_at is not null then
    raise exception 'there is no open follow-up on this audit' using errcode = '23514';
  end if;
  if a.clinician_id = v_uid then raise exception 'you cannot close a follow-up on your own work' using errcode = '42501'; end if;
  insert into public.clinical_audit_followups (organisation_id, audit_id, kind, note, created_by, is_test) values (a.organisation_id, a.id, 'closed', btrim(p_note), v_uid, a.is_test);
  update public.clinical_audits set followup_closed_at = now(), followup_note = btrim(p_note) where id = a.id;
end;
$$;

create function public.add_audit_followup_note(p_audit uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); a public.clinical_audits%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can add a follow-up note' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'say what was done, in at least 20 characters' using errcode = '22023'; end if;
  select * into a from public.clinical_audits where id = p_audit for update;
  if not found or not private.cmo_of(a.organisation_id) or a.state <> 'submitted' or not a.followup_needed or a.followup_closed_at is not null then
    raise exception 'there is no open follow-up on this audit' using errcode = '23514';
  end if;
  if a.clinician_id = v_uid then raise exception 'you cannot add to a follow-up on your own work' using errcode = '42501'; end if;
  insert into public.clinical_audit_followups (organisation_id, audit_id, kind, note, created_by, is_test) values (a.organisation_id, a.id, 'note', btrim(p_note), v_uid, a.is_test);
end;
$$;

-- the queue gains the second-review state
create or replace function public.clinical_audit_queue(p_state text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can see the audit queue' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'task_id', a.task_id, 'clinician_id', a.clinician_id, 'clinician_name', cs.full_name, 'reviewer_id', a.reviewer_id,
      'reason', a.reason, 'state', a.state, 'due_at', a.due_at, 'overdue', a.due_at < now() and (a.state in ('unassigned', 'assigned') or (a.second_review_required and a.final_at is null)),
      'outcome', a.outcome, 'total_score', a.total_score, 'critical_miss', a.critical_miss, 'followup_needed', a.followup_needed and a.followup_closed_at is null,
      'counts_toward_tier1', a.counts_toward_tier1, 'submitted_at', a.submitted_at,
      'second_review_required', a.second_review_required, 'second_reviewer_id', a.second_reviewer_id, 'final', a.final_at is not null, 'final_outcome', a.final_outcome,
      'second_review_agrees', a.second_review_agrees, 'scribe_assisted', a.scribe_assisted, 'avoidability', a.avoidability,
      'replies', (select count(*) from public.clinical_audit_replies r where r.audit_id = a.id))
      order by (a.state = 'unassigned') desc, (a.second_review_required and a.final_at is null) desc, (a.followup_needed and a.followup_closed_at is null) desc, a.due_at)
    from public.clinical_audits a join public.clinical_staff cs on cs.profile_id = a.clinician_id
   where a.organisation_id = private.caller_org()
     and a.is_test = (select coalesce(bool_or(is_test), false) from public.clinical_staff where profile_id = (select auth.uid()))
     and (p_state is null or a.state = p_state)), '[]'::jsonb);
end;
$$;

-- one audit's reviewer-side detail for the lead: the scores of both readings, the phase comments, replies and follow-up history
create function public.audit_detail(p_audit uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare a public.clinical_audits%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can see an audit' using errcode = '42501'; end if;
  select * into a from public.clinical_audits where id = p_audit;
  if not found or not private.cmo_of(a.organisation_id) then raise exception 'audit not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', a.id, 'state', a.state, 'outcome', a.outcome, 'final_outcome', a.final_outcome, 'total_score', a.total_score, 'rationale', a.rationale,
    'phase_comments', a.phase_comments, 'avoidability', a.avoidability, 'scribe_results', a.scribe_results, 'second_review_required', a.second_review_required,
    'second_review_agrees', a.second_review_agrees,
    'replies', coalesce((select jsonb_agg(jsonb_build_object('body', r.body, 'at', r.created_at) order by r.created_at) from public.clinical_audit_replies r where r.audit_id = a.id), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'note', f.note, 'at', f.created_at) order by f.created_at) from public.clinical_audit_followups f where f.audit_id = a.id), '[]'::jsonb));
end;
$$;

-- what the audited clinician sees about themselves: finished audits, tier 1 progress and the reliability score (advisory)
create function public.my_quality_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype;
begin
  select * into s from public.clinical_staff where profile_id = v_uid;
  if not found then raise exception 'only clinicians have a quality summary' using errcode = '42501'; end if;
  return jsonb_build_object(
    'reliability_score', s.reliability_score, 'level', coalesce(s.credentialing_level, 2),
    'tier1', case when coalesce(s.credentialing_level, 2) = 1 then public.tier1_audit_progress(null) else null end,
    'audits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'reason', a.reason, 'outcome', a.final_outcome, 'total_score', a.total_score, 'rationale', a.rationale, 'phase_comments', a.phase_comments,
        'avoidability', a.avoidability, 'submitted_at', a.submitted_at, 'final_at', a.final_at,
        'replies', coalesce((select jsonb_agg(jsonb_build_object('body', r.body, 'at', r.created_at) order by r.created_at) from public.clinical_audit_replies r where r.audit_id = a.id), '[]'::jsonb))
        order by a.final_at desc)
      from public.clinical_audits a where a.clinician_id = v_uid and a.state = 'submitted' and a.final_at is not null), '[]'::jsonb));
end;
$$;

-- scribe quality for the lead: omission and invented-content findings, counts only
create function public.scribe_audit_summary(p_months integer default 3) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can see this' using errcode = '42501'; end if;
  return (select jsonb_build_object(
      'audited', count(*),
      'omission_found', count(*) filter (where scribe_results ->> 'no_clinically_relevant_omission' = 'false'),
      'invented_content_found', count(*) filter (where scribe_results ->> 'no_invented_content' = 'false'))
    from public.clinical_audits
   where organisation_id = private.caller_org() and state = 'submitted' and scribe_assisted and scribe_results is not null
     and audit_month >= private.lagos_month(now() - make_interval(months => greatest(p_months, 1) - 1)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The daily audit sweep: second reviewers, the hand-back retry, the floor catch-up (Q3, Q7)
-- ---------------------------------------------------------------------------
create or replace function private.quality_audit_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_rev uuid; v_assigned integer := 0; v_late integer := 0; v_floor integer := 0; v_missed integer := 0; v_errors integer := 0; v_second integer := 0; v_hb integer := 0;
  v_prev date := private.lagos_month(now() - interval '1 month'); v_this date := private.lagos_month(now()); sm jsonb := private.quality_setting('sampling');
  v_day integer := extract(day from (now() at time zone 'Africa/Lagos'))::integer; v_win integer;
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
  -- a critical miss still waiting for its second, independent reviewer
  for r in select * from public.clinical_audits where state = 'submitted' and second_review_required and final_at is null and second_reviewer_id is null loop
    begin
      v_rev := private.audit_second_reviewer_for(r.id);
      if v_rev is not null then
        update public.clinical_audits set second_reviewer_id = v_rev where id = r.id;
        perform private.credential_notify(v_rev, r.organisation_id, 'A clinical audit is waiting for you',
          'A clinical audit has been assigned to you. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', r.id, 'i18n_key', 'quality.audit_assigned'), false);
        v_second := v_second + 1;
      elsif r.second_notified_at is null and r.due_at < now() then
        update public.clinical_audits set second_notified_at = now() where id = r.id;
        perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'A clinical audit has no reviewer',
          'A clinical audit could not be assigned to a reviewer. Open the audits page in the clinical lead area.', jsonb_build_object('audit_id', r.id, 'i18n_key', 'quality.audit_no_reviewer'), r.clinician_id, false);
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event) values (r.organisation_id, 'clinical_audit.sweep_error', 'clinical_audit', r.id, jsonb_build_object('error', sqlerrm, 'step', 'second'));
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
  -- Q7: a failed hand-back review check is retried here (idempotent: one open review per clinician)
  v_win := coalesce((private.claim_setting('handback_review') ->> 'window_days')::integer, 7);
  for r in select distinct h.clinician_id from public.task_handbacks h where h.created_at > now() - make_interval(days => v_win) loop
    begin
      if private.check_handback_review(r.clinician_id) then v_hb := v_hb + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, event) values ('clinical_audit.sweep_error', 'clinical_audit', jsonb_build_object('error', sqlerrm, 'step', 'handback'));
    end;
  end loop;
  -- Q3: the floor for last month during its catch-up days (7 until version 2 says otherwise), and the current month once it is far enough on
  begin
    if v_day <= coalesce((sm ->> 'floor_catchup_until_day')::integer, 7) then v_floor := v_floor + private.audit_floor_top_up(v_prev); end if;
    if sm ? 'floor_current_month_from_day' and v_day >= (sm ->> 'floor_current_month_from_day')::integer then v_floor := v_floor + private.audit_floor_top_up(v_this); end if;
  exception when others then
    v_errors := v_errors + 1;
    insert into public.audit_log (action, entity_type, event) values ('clinical_audit.sweep_error', 'clinical_audit', jsonb_build_object('error', sqlerrm, 'step', 'floor'));
  end;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'audit_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev3', 'The clinical audit sweep failed for some items',
            format('%s item(s) could not be processed by private.quality_audit_sweep(); see audit_log action clinical_audit.sweep_error.', v_errors), 'audit_sweep', now(), now());
  end if;
  return jsonb_build_object('assigned', v_assigned, 'second_assigned', v_second, 'overdue_notified', v_late, 'retried', v_missed, 'handback_reviews_opened', v_hb, 'floor_top_up', v_floor, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS and grants for the new tables and functions
-- ---------------------------------------------------------------------------
alter table public.clinical_audit_case_opens enable row level security;
alter table public.clinical_audit_second_reviews enable row level security;
alter table public.clinical_audit_replies enable row level security;
alter table public.clinical_audit_followups enable row level security;

-- the audited clinician sees an audit only once it is final; the lead sees all in the organisation; a reviewer sees their own
drop policy clinical_audits_select on public.clinical_audits;
create policy clinical_audits_select on public.clinical_audits for select to authenticated
  using (private.cmo_of(organisation_id) or reviewer_id = (select auth.uid()) or second_reviewer_id = (select auth.uid())
         or (clinician_id = (select auth.uid()) and state = 'submitted' and final_at is not null));
create policy clinical_audit_case_opens_select on public.clinical_audit_case_opens for select to authenticated using (private.cmo_of(organisation_id));
create policy clinical_audit_second_reviews_select on public.clinical_audit_second_reviews for select to authenticated using (private.cmo_of(organisation_id));
create policy clinical_audit_replies_select on public.clinical_audit_replies for select to authenticated
  using (private.cmo_of(organisation_id) or author_id = (select auth.uid()));
create policy clinical_audit_followups_select on public.clinical_audit_followups for select to authenticated using (private.cmo_of(organisation_id));

revoke all on public.clinical_audit_case_opens, public.clinical_audit_second_reviews, public.clinical_audit_replies, public.clinical_audit_followups from public, anon, authenticated;
grant select on public.clinical_audit_case_opens, public.clinical_audit_second_reviews, public.clinical_audit_replies, public.clinical_audit_followups to authenticated;

revoke all on function
  public.submit_clinical_audit(uuid, jsonb, jsonb, text, jsonb, text, jsonb), public.submit_second_audit_review(uuid, jsonb, jsonb, text, jsonb, jsonb),
  public.reply_to_clinical_audit(uuid, text), public.add_audit_followup_note(uuid, text), public.audit_detail(uuid), public.my_quality_summary(), public.scribe_audit_summary(integer)
  from public, anon, authenticated;
grant execute on function
  public.submit_clinical_audit(uuid, jsonb, jsonb, text, jsonb, text, jsonb), public.submit_second_audit_review(uuid, jsonb, jsonb, text, jsonb, jsonb),
  public.reply_to_clinical_audit(uuid, text), public.add_audit_followup_note(uuid, text), public.audit_detail(uuid), public.my_quality_summary(), public.scribe_audit_summary(integer)
  to authenticated;
-- create or replace keeps the existing grants of audit_case_file, close_audit_followup and clinical_audit_queue; restate them anyway
revoke all on function public.audit_case_file(uuid), public.close_audit_followup(uuid, text), public.clinical_audit_queue(text) from public, anon, authenticated;
grant execute on function public.audit_case_file(uuid), public.close_audit_followup(uuid, text), public.clinical_audit_queue(text) to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.quality_sampling_seeds', 'SELECT') or has_table_privilege('authenticated', 'public.quality_sampling_seeds', 'SELECT') then
    raise exception 'S20 v2: the sampling seed must not be readable by any API role';
  end if;
  if has_function_privilege('anon', 'public.submit_clinical_audit(uuid, jsonb, jsonb, text, jsonb, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reply_to_clinical_audit(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_quality_config(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sampling_seed(date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sampling_draw(uuid, date, text)', 'EXECUTE') then
    raise exception 'S20 v2 grants are wrong';
  end if;
  if exists (select 1 from public.quality_config where version = 2 and (is_active or approved_at is not null)) then
    raise exception 'S20 v2: quality_config version 2 must be created inactive and unsigned';
  end if;
end $$;
