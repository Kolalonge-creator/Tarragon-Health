-- Tarragon Health — AI-drafted reply assist for the in-app care-messages inbox.
--
-- The doctor-cost-optimization / Care Coordinator scaling work
-- (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4, "Cost Compression
-- Model") called for "AI drafts, coordinator reviews and sends" on the
-- care_messages inbox, matching the pattern already shipped for doctors on
-- case_briefs (Claude Haiku, assistive-only, never auto-anything). This is
-- that table for the Care Coordinator/staff side of care_message_threads.
--
-- AI drafts, never sends: no write path back into care_messages, no
-- auto-reply, one row per thread (upserted on regenerate). The app layer
-- displays draft_text as text for a staff member to read and write their own
-- reply from — it must never pre-load the actual compose/send field, same
-- discipline as case_briefs.draft_review_note (see case-brief-card.tsx) and
-- for the same reason: a draft that occupies the field whose submission
-- reaches the patient invites sending it unread, which is the exact "AI
-- rubber-stamps, human doesn't actually look" failure this feature must not
-- create for a non-clinical role.
--
-- needs_clinical_review / review_reason let the drafting prompt refuse to
-- draft a substantive reply when the patient's message sounds like it needs
-- clinical judgment (a new/worsening symptom, a medication or result
-- question) — mirroring the AI Coach's clinician_review tier
-- (lib/ai-coach/prompts.ts) so the Care Coordinator's existing "never
-- interprets a result, never adjusts medication, never closes an
-- escalation" limit (master plan §4) is respected by the drafting content
-- itself, not just by a separate write-access gate.

create type public.care_message_draft_reply_status as enum ('generated', 'failed');

create table public.care_message_draft_replies (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  -- One live draft per thread — regenerating overwrites via upsert, same
  -- shape as case_briefs' one-per-clinician_alert_id key.
  thread_id             uuid not null unique references public.care_message_threads (id) on delete cascade,
  status                public.care_message_draft_reply_status not null,
  model_id              text not null,
  draft_text            text,
  needs_clinical_review boolean not null default false,
  review_reason         text,
  -- The exact minimized data sent to the model (recent thread messages only,
  -- already visible to the reader on the same page) — audit/reproducibility
  -- record, same discipline as case_briefs.input_snapshot.
  input_snapshot        jsonb not null,
  error_message         text,
  generated_at          timestamptz not null default now()
);

comment on table public.care_message_draft_replies is
  'AI-drafted (Claude Haiku) reply suggestions for staff replying in a care_messages thread. Assistive only -- see this migration''s header for the guardrails. Written only by the server-role draft-reply generator, never by a user session.';
comment on column public.care_message_draft_replies.input_snapshot is
  'The exact minimized thread snapshot sent to the model -- recent message bodies/authors only. Kept for audit and to detect staleness.';
comment on column public.care_message_draft_replies.needs_clinical_review is
  'Set by the drafting prompt when the patient''s message sounds like it needs clinical judgment. When true, draft_text is a short holding reply only -- the UI must show a review banner, not a normal suggested reply.';

alter table public.care_message_draft_replies enable row level security;

-- Read-only from a normal session: any org-staff member (is_org_staff) can
-- see the draft for a thread in their org. Deliberately NO insert/update/
-- delete policy -- every write goes through the service-role generator
-- function, matching case_briefs' write-boundary exactly. A patient never
-- sees this table; care_message_threads staff access is already staff-only
-- for this purpose (a patient's own thread still only exposes their own
-- care_messages rows, never this table).
create policy care_message_draft_replies_select on public.care_message_draft_replies
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- No separate index on thread_id -- the unique constraint above already
-- creates one.

-- Default privileges grant ALL on a freshly created table (the root-cause
-- fix documented in CLAUDE.md) -- explicitly grant only SELECT and revoke
-- the rest so intent and reality read the same way, not "safe by omission."
grant select on public.care_message_draft_replies to authenticated;
revoke insert, update, delete on public.care_message_draft_replies from authenticated;

do $$
declare
  v_select_def text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'care_message_draft_replies'
  ) then
    raise exception 'care_message_draft_replies was not created';
  end if;

  if not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'care_message_draft_replies'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'authenticated is missing SELECT on care_message_draft_replies';
  end if;
  if exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'care_message_draft_replies'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'care_message_draft_replies should only be writable by the service role';
  end if;

  select pg_get_expr(polqual, polrelid) into v_select_def
  from pg_policy where polname = 'care_message_draft_replies_select';
  if v_select_def not like '%is_org_staff%' then
    raise exception 'care_message_draft_replies_select does not gate on is_org_staff';
  end if;
end $$;
