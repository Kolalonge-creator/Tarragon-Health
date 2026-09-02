-- Module 20 (Health Education Platform) §20.15 — patient feedback on a content item
-- (helpful / not helpful / unclear / want more information / report incorrect
-- information), and §20.15's "clinical content reports should enter a governance
-- queue" — `status`/`review_note`/`reviewed_by`/`reviewed_at` on the same row is that
-- queue; no separate table, same "one row IS the record" discipline used across this
-- codebase (e.g. escalations, clinician_alerts).
--
-- Content is a GLOBAL catalogue (no organisation_id on health_education_content itself),
-- but each piece of feedback is raised by a patient inside their own org, so
-- organisation_id is carried here the same way it's carried on health_education_progress
-- — for RLS/is_org_staff consistency, not because the content is org-scoped.
--
-- unique (patient_id, content_id, feedback_type): a patient's repeat tap on the same
-- reaction (e.g. tapping "helpful" again) upserts rather than piling up duplicate rows —
-- keeps the analytics rollup (health_education_analytics()) counting people, not clicks.
-- A patient can still hold multiple DIFFERENT reactions on the same content (e.g.
-- "helpful" and, separately, "want more information").

create type public.health_education_feedback_type as enum (
  'helpful',
  'not_helpful',
  'unclear',
  'want_more_information',
  'report_incorrect'
);

create type public.health_education_feedback_status as enum ('open', 'reviewed', 'resolved');

create table public.health_education_feedback (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  content_id       uuid not null references public.health_education_content (id) on delete cascade,
  feedback_type    public.health_education_feedback_type not null,
  comment          text,
  status           public.health_education_feedback_status not null default 'open',
  review_note      text,
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (patient_id, content_id, feedback_type)
);

create index health_education_feedback_content_idx
  on public.health_education_feedback (content_id);

-- The governance queue's primary read pattern: open reports first.
create index health_education_feedback_open_idx
  on public.health_education_feedback (status, created_at)
  where status = 'open';

alter table public.health_education_feedback enable row level security;

create policy health_education_feedback_select on public.health_education_feedback
  for select to authenticated using (patient_id = auth.uid() or private.is_admin());

create policy health_education_feedback_insert on public.health_education_feedback
  for insert to authenticated
  with check (patient_id = auth.uid() and organisation_id = private.current_org_id());

-- One combined update policy (patient can adjust their own reaction/comment; admin
-- resolves the governance queue) — column-level separation (a patient can't literally
-- set status themselves in the UI) is an app-layer convenience, not a security boundary:
-- a patient marking their own feedback "resolved" early is a data-hygiene nit, not a
-- privilege escalation, the same trade-off already accepted for medications_confirm_refill
-- and similar single-owner-writes-back-to-their-own-row tables.
create policy health_education_feedback_update on public.health_education_feedback
  for update to authenticated
  using (patient_id = auth.uid() or private.is_admin())
  with check (patient_id = auth.uid() or private.is_admin());

grant select, insert, update on public.health_education_feedback to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.health_education_feedback', 'SELECT') then
    raise exception 'health_education_feedback: authenticated grant did not take';
  end if;
end $$;
