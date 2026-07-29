-- Tarragon Health
-- Video consultation infrastructure (Zoom)
--
-- Covers two distinct meeting contexts sharing one table, per the 5-level
-- escalation model (docs/Tarragon_Health_Master_Operating_Plan_v4.md §7):
-- Level 4's pre-referral triage call (Tarragon doctor <-> patient, tied to
-- an escalation, to decide whether a referral is even needed) and the
-- post-referral specialist telemedicine consult (specialist <-> patient,
-- tied to a specialist_referral, telemedicine-first per Level 5). Zoom was
-- chosen explicitly over building custom video (user decision) — auth is
-- Server-to-Server OAuth (the current Zoom-recommended flow for backend-
-- created meetings; the old JWT app type is deprecated).
--
-- The patient never writes to this table (read-only party to their own
-- clinical workflow, same posture as escalations/specialist_referrals) —
-- only org staff create/update rows, via the Next.js server actions that
-- call the Zoom API.
--
-- zoom_webhook_events mirrors payment_transactions' audit idiom (a Zoom
-- event isn't a payment, so it's its own table): every webhook delivery
-- recorded idempotently via a unique constraint on provider_event_id,
-- before any side-effect processing, so nothing is ever silently dropped.
-- It has no authenticated RLS policies at all — service-role (the Edge
-- Function) only, same posture as payment_transactions' insert path.

create type public.video_consultation_context as enum ('pre_referral_triage', 'specialist_consult');
create type public.video_consultation_status as enum ('scheduled', 'started', 'completed', 'cancelled', 'no_show');

create table public.video_consultations (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  context                 public.video_consultation_context not null,
  escalation_id           uuid references public.escalations (id) on delete set null,
  specialist_referral_id  uuid references public.specialist_referrals (id) on delete set null,
  initiated_by            uuid references public.profiles (id) on delete set null,
  zoom_meeting_id         text,
  join_url                text,
  host_start_url          text,
  status                  public.video_consultation_status not null default 'scheduled',
  scheduled_at            timestamptz,
  started_at              timestamptz,
  ended_at                timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint video_consultations_context_link check (
    (context = 'pre_referral_triage' and escalation_id is not null)
    or (context = 'specialist_consult' and specialist_referral_id is not null)
  )
);

create index video_consultations_escalation_idx on public.video_consultations (escalation_id);
create index video_consultations_referral_idx on public.video_consultations (specialist_referral_id);
create index video_consultations_patient_idx on public.video_consultations (patient_id);

create trigger video_consultations_set_updated_at
  before update on public.video_consultations
  for each row execute function private.set_updated_at();

alter table public.video_consultations enable row level security;

create policy video_consultations_select on public.video_consultations
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy video_consultations_insert on public.video_consultations
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy video_consultations_update on public.video_consultations
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.video_consultations to authenticated;

create table public.zoom_webhook_events (
  id                      uuid primary key default gen_random_uuid(),
  provider_event_id       text not null,
  event_type              text not null,
  video_consultation_id   uuid references public.video_consultations (id) on delete set null,
  raw_payload             jsonb not null default '{}'::jsonb,
  processed_at            timestamptz,
  error                   text,
  created_at              timestamptz not null default now(),
  unique (provider_event_id)
);

alter table public.zoom_webhook_events enable row level security;
-- Deliberately no authenticated policies at all — service-role (Edge
-- Function) only, same posture as payment_transactions' insert path.
