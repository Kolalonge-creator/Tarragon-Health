-- Notification delivery-state + forced-channel fallback, part 2/6.
--
-- Adds real delivery-state tracking to `notifications`. Today only `sent_at`
-- exists — nothing records whether a channel actually delivered or whether
-- the recipient opened it, so a silently-failed WhatsApp send to a doctor is
-- indistinguishable from one they read and ignored. This is the columns half
-- of closing that gap (I5-shaped: a clinical SLA with no structural
-- backstop) — see 20260730130400_critical_notification_engine.sql for the
-- engine that uses them.
--
-- `delivered_at`/`opened_at`/`failed_at` are precise instants alongside the
-- existing coarse `status` enum (mirrors how `sent_at` already sits next to
-- `status`). `delivered_at` is only ever set from a real provider receipt
-- (WhatsApp's Meta delivery callback) — web push has no delivery receipt, so
-- a push notification's only positive confirmation signal is `opened_at`
-- (the notificationclick handler). That asymmetry is deliberate and honest,
-- not a gap: the escalation engine below treats "delivered_at OR opened_at
-- is set" as confirmed, so push requires an actual open to stop escalating.
alter table public.notifications
  add column delivered_at timestamptz,
  add column opened_at timestamptz,
  add column failed_at timestamptz,
  -- WhatsApp's `wamid` (needed to correlate Meta's delivery/read status
  -- callbacks back to this row — see the whatsapp-webhook extension) or a
  -- push service's opaque send id. Nothing sets this today; send-pending-
  -- notifications is extended in the same pass to capture it.
  add column provider_message_id text,
  add column priority public.notification_priority not null default 'routine',
  -- The escalation_slas pathway/tier this row belongs to (e.g.
  -- 'screening_abnormal_result' / 'emergency') — null for routine rows.
  -- Drives both the forced-channel ladder (private.escalation_channel_sequence)
  -- and its timing (the existing private.escalation_sla_minutes).
  add column escalation_pathway text,
  add column escalation_alert_tier public.alert_level,
  -- 1-based position in the resolved channel_sequence this row represents
  -- (1 = first hop, e.g. push). A row with escalation_hop=2 is itself the
  -- WhatsApp fallback that the engine created because hop 1 went unconfirmed.
  add column escalation_hop smallint not null default 1,
  add column escalated_from_id uuid references public.notifications (id) on delete set null,
  -- Generic origin reference, same source_table/source_id idiom already used
  -- by patient_timeline — lets the engine (and an admin reading a surfaced
  -- escalation-exhausted failure) trace back to the clinician_alerts/
  -- escalations row that started this notification chain.
  add column source_table text,
  add column source_id uuid;

-- The escalation engine's own scan: "critical rows that have been attempted
-- (or definitively failed) and not yet confirmed". Partial index keeps this
-- cheap even as the routine-notification volume (28 templates) grows.
create index notifications_critical_unconfirmed_idx
  on public.notifications (priority, status, sent_at)
  where priority = 'critical' and opened_at is null;

create index notifications_escalated_from_idx
  on public.notifications (escalated_from_id)
  where escalated_from_id is not null;
