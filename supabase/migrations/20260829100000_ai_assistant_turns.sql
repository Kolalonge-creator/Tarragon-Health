-- AI Health Assistant §36.17 — per-turn provenance record for the AI Coach chat.
--
-- Closes the audit gap identified in docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4.3:
-- case_briefs and patient_result_explanations both already carry model_id +
-- input_snapshot + status/error_message for their AI outputs (case_briefs'
-- own migration comment calls input_snapshot "the audit/reproducibility
-- record for a clinical-safety-adjacent AI output"). ai_conversations never
-- got the same treatment — a chat turn can open a clinician_alerts row, an
-- escalations row, and an emergency_events row, and until this migration
-- there was no record of which model produced the classification, what
-- context it saw, or what it retrieved. This table is that record, one row
-- per turn (not per conversation), mirroring case_briefs' column shape.
--
-- Deliberately NOT a retention/purge policy for ai_conversations.messages
-- itself — the platform's own published consent text
-- (20260731030000_legal_consent_v3_corrected_product_description.sql) says
-- "a formal retention schedule...is being finalised with counsel," so a
-- hardcoded auto-delete window here would be inventing legal policy this
-- migration has no business inventing. This table's own rows follow the
-- same no-retention-policy convention as audit_log/case_briefs — indefinite
-- until a schedule exists, at which point it applies uniformly.
create table public.ai_assistant_turns (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  conversation_id       uuid not null references public.ai_conversations (id) on delete cascade,

  -- What kind of AI output this is. 'chat_turn' is the only producer today
  -- (runCoachTurn); the other three are reserved for the composed surfaces
  -- in docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §36.5/§36.8/§36.9, which
  -- reuse this same audit table rather than inventing a parallel one.
  interaction_type      text not null
    check (interaction_type in ('chat_turn', 'record_explanation', 'care_plan_summary', 'appointment_prep')),

  -- null on a short-circuited turn (access denied / rate limited) or a
  -- keyword-guardrail-only emergency, where nothing model-generated exists.
  model_id              text,
  prompt_version        text,

  -- The §36.2 safety-classification outcome. Null only on the two
  -- short-circuit statuses below, where classification never ran.
  safety_classification text
    check (safety_classification in ('routine', 'clinician_review', 'emergency')),

  -- Approved-content rows the retrieval stage actually surfaced for this
  -- turn (lpe_content_blocks / health_education_content ids) — the
  -- per-turn answer to "which approved source did this claim come from?"
  -- that docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §6 names as the point of
  -- recording sources at all. Empty array, not null, when retrieval ran
  -- and found nothing (distinct from retrieval never running).
  retrieved_source_ids  uuid[] not null default '{}',

  -- Set only when this turn actually caused one to exist — never inferred,
  -- same null-gating discipline as reviewed_by/reviewed_at elsewhere.
  clinician_alert_id    uuid references public.clinician_alerts (id) on delete set null,
  escalation_id         uuid references public.escalations (id) on delete set null,

  final_action          text not null
    check (final_action in ('replied', 'clinician_alert_created', 'escalation_created', 'declined')),

  status                text not null
    check (status in ('completed', 'degraded', 'access_denied', 'rate_limited')),
  error_message         text,

  -- Exactly what was sent to the model (context lines, retrieved content,
  -- prior-message window) -- same discipline as case_briefs.input_snapshot.
  -- Never the raw patient message body twice over; that already lives in
  -- ai_conversations.messages.
  input_snapshot        jsonb not null default '{}'::jsonb,

  generated_at           timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create index ai_assistant_turns_conversation_idx on public.ai_assistant_turns (conversation_id, generated_at desc);
create index ai_assistant_turns_patient_idx on public.ai_assistant_turns (patient_id, generated_at desc);
create index ai_assistant_turns_org_idx on public.ai_assistant_turns (organisation_id);
-- Partial index -- the escalation-lookback query (RLS policy below, and any
-- future "show me what led to this alert" admin view) only ever filters on
-- rows that actually have one of these set.
create index ai_assistant_turns_clinician_alert_idx on public.ai_assistant_turns (clinician_alert_id) where clinician_alert_id is not null;
create index ai_assistant_turns_escalation_idx on public.ai_assistant_turns (escalation_id) where escalation_id is not null;

alter table public.ai_assistant_turns enable row level security;

-- Patient reads their own turns -- same ownership shape as ai_conversations.
-- Written by the app/service on the patient's behalf (service-role insert
-- from the coach turn, same as clinician_alerts/escalations), never by the
-- patient directly, so there is no patient insert/update/delete policy.
create policy ai_assistant_turns_select_own on public.ai_assistant_turns
  for select to authenticated
  using (patient_id = (select auth.uid()));

-- Staff read is narrower than ai_conversations' blanket is_org_staff() read
-- (see the policy tightened below in this same migration) -- restricted to
-- turns that actually produced a clinician_alert or escalation. Free-text
-- symptom chat is more sensitive than most of what is_org_staff() gates
-- (CLAUDE.md flags is_org_staff as the highest-leverage security function
-- in the codebase, ~110 tables at once), so routine chit-chat that never
-- raised a clinical concern should not be blanket-readable by every staff
-- account in the org -- but staff genuinely need to see the turn(s) that
-- led to an alert they are following up on.
create policy ai_assistant_turns_select_staff on public.ai_assistant_turns
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    and (clinician_alert_id is not null or escalation_id is not null)
  );

grant select on public.ai_assistant_turns to authenticated;
-- No insert/update/delete grant to `authenticated` at all -- every write
-- goes through the service-role client from lib/ai-coach/audit.ts, the same
-- reason escalate.ts already uses service-role for clinician_alerts/
-- escalations: the tier/classification here is a value the app computed on
-- the patient's behalf, not raw patient input, so RLS can't be trusted to
-- let the patient (or anyone) write it directly.

-- ----------------------------------------------------------------------------
-- Tighten ai_conversations' own staff-read policy to the same "only if it
-- was actually escalated" shape, for the same sensitivity reason above.
-- This is a real behaviour change: before this migration every org-staff
-- account could read every patient's full assistant transcript, escalated
-- or not (20260706084944_ai_conversations.sql's own comment says "staff can
-- read (support/audit)" with no further qualifier). Support/audit's actual
-- need is to review what triggered an alert, which this still serves --
-- routine, never-flagged chit-chat no longer is blanket-readable.
-- ----------------------------------------------------------------------------
drop policy ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      private.is_org_staff(organisation_id)
      and exists (
        select 1 from public.ai_assistant_turns t
        where t.conversation_id = ai_conversations.id
          and (t.clinician_alert_id is not null or t.escalation_id is not null)
      )
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_conversations' and policyname = 'ai_conversations_select'
  ) then
    raise exception 'FAIL: ai_conversations_select policy missing after redefinition';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_assistant_turns' and policyname = 'ai_assistant_turns_select_staff'
  ) then
    raise exception 'FAIL: ai_assistant_turns_select_staff policy missing';
  end if;
  raise notice 'PASS: ai_assistant_turns created, ai_conversations staff read narrowed to escalated conversations only';
end $$;
