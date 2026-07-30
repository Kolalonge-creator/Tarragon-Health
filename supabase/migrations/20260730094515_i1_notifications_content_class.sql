-- Tarragon Health
-- v3 port: I1 -- "no clinical content on an open rail (whatsapp/sms/email)."
-- CLAUDE.md's "PORT IT IN" list; confirmed as a live gap by
-- packages/db/tests/i1_i10_invariants_platform.sql's I1 check (public.
-- notifications has no content-class distinction at all -- enforced by
-- convention only, per the Non-Negotiable Business Rules: every template
-- in supabase/functions/send-pending-notifications/index.ts is written to
-- be non-clinical -- confirmed by a full read of all 28 live templates
-- before writing this migration, not assumed).
--
-- This is a BACKSTOP, not a retroactive audit/reclassification. Every
-- existing insert path into notifications (every private.enqueue_*/
-- queue_* trigger across ~25 migrations) is untouched and keeps working
-- exactly as today: none of them currently set content_class, so they all
-- land on the new column's default, 'non_clinical', and the new CHECK
-- (clinical content confined to in_app/push/voice) is satisfied
-- automatically by every current row. What changes is that a FUTURE
-- insert can no longer flip a whatsapp/sms/email row to content_class =
-- 'clinical' -- that is now structurally rejected, closing the exact gap
-- CLAUDE.md names, without touching a single existing call site.
--
-- Two real nuances found during the template read, flagged rather than
-- silently resolved -- neither blocks this migration since neither
-- currently sets content_class explicitly:
--   1. broadcast_announcement carries admin-authored FREE TEXT fanned out
--      to whatsapp/sms/email. A column-based CHECK cannot inspect prose,
--      so this stays a policy/UI matter, not something this constraint can
--      catch -- see the companion UI change adding a warning to the
--      broadcast composer.
--   2. referral_specialist_alert's email leg (no WhatsApp leg exists for
--      it) includes `referral_reason` -- short clinical context a
--      receiving specialist needs, per that template's own existing
--      comment. This is professional HCP-to-HCP referral correspondence,
--      not the patient-facing "open rail" the Non-Negotiable Business
--      Rules protect against, and was already a deliberate prior design
--      decision (not an oversight this pass introduces or removes). Left
--      as content_class = 'non_clinical' (the default); flagged here for
--      visibility, not changed.

create type public.notification_content_class as enum ('clinical', 'non_clinical');

alter table public.notifications
  add column content_class public.notification_content_class not null default 'non_clinical';

alter table public.notifications
  add constraint notifications_no_clinical_on_open_rail
  check (
    content_class = 'non_clinical'
    or channel not in ('whatsapp', 'sms', 'email')
  );

comment on column public.notifications.content_class is
  'Structural backstop for the Non-Negotiable Business Rule that whatsapp/sms/email carry reminders/alerts/confirmations only, never clinical content. Every current insert path defaults to non_clinical; the CHECK below rejects any future clinical-content row on those three channels.';
