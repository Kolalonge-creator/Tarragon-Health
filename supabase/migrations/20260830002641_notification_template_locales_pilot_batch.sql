-- Health Communication Engine — template-copy migration, pilot batch.
--
-- Follow-up to 20260828231515_notification_templates_seed.sql, which
-- deliberately left notification_template_locales empty for the ~89
-- pre-existing template keys. This is a first, verified batch (13 keys) —
-- not the full set — done narrowly enough to prove out the method before
-- scaling to the rest. Every body/subject below was checked against the
-- CURRENT TEMPLATE_MAP source in send-pending-notifications/index.ts (and,
-- for two keys, notification-bell.tsx's describe()) with a small Node
-- script substituting a representative payload and diffing byte-for-byte
-- against the live function's output; see the accompanying PR description
-- for the verification transcript.
--
-- IMPORTANT — none of these rows are wired to actually RENDER a live send.
-- Investigation this pass found that the DB-fallback path (send-pending-
-- notifications' "DB-driven template fallback") cannot safely replace a
-- pre-existing TEMPLATE_MAP entry for ANY of the 89 keys without changing
-- behaviour, for two structural reasons — not a per-template judgement
-- call, an architectural constraint of the fallback as it exists today:
--
--   1. WhatsApp is never rendered from this table (by design — Meta-
--      approved templates are a fixed structure this table can't express)
--      and the fallback explicitly skips channel='whatsapp' rows. Live data
--      checked during this pass: 20 of 21 non-in_app sends of six
--      representative reminder templates (vitals_reminder,
--      medication_review_due, screening_due, vaccination_due,
--      lifestyle_review_due, preventive_review_due) were literal
--      channel='whatsapp' — push-remap only fires when the recipient has an
--      active push subscription, and private.remap_notification_channel()
--      explicitly leaves critical-priority rows untouched regardless.
--      Removing a TEMPLATE_MAP case for any whatsapp-eligible template
--      would silently fail that entire population with "unknown template".
--   2. The fallback's single `body` column becomes BOTH the email html and
--      the email text/plain part for an email-channel row (see the
--      fallback code: `html: body, text: body`). Every pre-existing email
--      template pairs styled HTML with a distinct plain-text alternative —
--      collapsing them would put raw HTML markup in front of any mail
--      client that renders the text part. There is no existing template
--      that is sms/push-only with no email and no whatsapp exposure to
--      route around this.
--
-- Net effect: TEMPLATE_MAP stays the sole live render source for all 13
-- keys below (and, per this reasoning, is expected to stay authoritative
-- for the other ~76 too) — these rows exist purely as the registry's
-- documented copy for admin/compliance reading, exactly the role the
-- original migration's header comment already described for this table.
-- Real functional cutover of the channel-safe, branch-free subset (the
-- partner-facing sms+email pair: lab_order_lab_alert,
-- pharmacy_order_pharmacy_alert, referral_specialist_alert) is possible in
-- the future but needs a small additive schema change first (a separate
-- plain-text column for email, so html and text stop being forced
-- identical) — not attempted here since it touches the live render path
-- for more than just documentation.
--
-- Two templates carry real conditional logic (diabetes_complication_check_
-- due's retinal/renal/generic label; sponsored_plan_started's is_payer
-- branch), plus a third with a small optional-clause branch
-- (video_visit_declined's reason suffix) and a fourth with a link that
-- varies by payload (vitals_reminder's suggested_vital_type). The flat
-- {{token}} substitution this table supports cannot express a branch, so
-- each row below documents ONE representative variant (noted in a SQL
-- comment beside it), not every possible rendering — TEMPLATE_MAP remains
-- the only place the real branching logic lives, permanently, for these.
--
-- Also included: three keys — clinician_alert_ack_timeout_backup/senior/
-- admin — that had NO implementation anywhere (no TEMPLATE_MAP entry, no
-- notification-bell case) before the companion change in this same PR.
-- Confirmed live in production during this investigation: 58 real failed
-- notifications ("unknown template") across the three, whatsapp/push/sms
-- alike, as recent as today — every non-in_app hop of this escalation
-- ladder was silently failing. Fixed by adding a minimal TEMPLATE_MAP entry
-- (payload.message passthrough — the enqueuing PL/pgSQL already fully
-- resolves the message text, so there's no branching to reproduce) rather
-- than relying on the DB fallback, precisely because these rows are
-- sometimes critical-priority whatsapp (see reason 1 above) — the fallback
-- alone could not have closed the whatsapp share of the gap. Their locale
-- rows here are catalog documentation of that now-fixed copy, same as
-- every other row in this migration.
insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  -- Channel-safe (never whatsapp), branch-free — the strongest cutover
  -- candidates if the email text/html schema gap above is ever closed.
  ('pharmacy_order_pharmacy_alert', 'en', 'sms', null,
   'New Tarragon Health order {{order_number}}: {{patient_name}} (patient ID {{patient_number}}): {{items_summary}}. Please prepare for collection. Tarragon Health'),
  ('pharmacy_order_pharmacy_alert', 'en', 'email',
   'New Tarragon Health order {{order_number}}: {{patient_name}}',
   'New Tarragon Health order {{order_number}}: {{patient_name}} (patient ID {{patient_number}}): {{items_summary}}. Please prepare for collection. Tarragon Health'),
  ('emergency_card_viewed', 'en', 'email', 'Your emergency card was viewed',
   'Tarragon Health: your emergency card link was viewed on {{viewed_on}}. If that wasn''t expected, replace it at any time from your dashboard.'),
  ('emergency_card_viewed', 'en', 'in_app', null,
   -- notification-bell.tsx's own in_app copy differs slightly from the
   -- sms/email wording and branches on whether viewed_on is present; this
   -- documents the viewed_on-present variant.
   'Your emergency card link was viewed on {{viewed_on}}'),
  ('emergency_card_expiring_soon', 'en', 'email', 'Your emergency card link expires soon',
   'Tarragon Health: your emergency card live link expires in 30 days. Replace it to keep it working. Your printed card is unaffected.'),
  ('emergency_card_expiring_soon', 'en', 'in_app', null,
   'Your emergency card link expires soon; renew it to keep it working'),

  -- Whatsapp-eligible (confirmed live: mostly literal whatsapp sends),
  -- otherwise pure token interpolation with no branching.
  ('medication_review_due', 'en', 'sms', null,
   'Hi, your medication review is due {{due_date}}. Your care team will be in touch; open the app to see details. Tarragon Health'),
  ('lifestyle_review_due', 'en', 'sms', null,
   'Hi, your lifestyle programme review is due {{due_date}}. Your care team will be in touch; open the app to see details. Tarragon Health'),
  ('new_care_message', 'en', 'sms', null,
   'You have a new message from your care team. Open the Tarragon Health app to read and reply. Tarragon Health'),

  -- Real branching logic in TEMPLATE_MAP -- one representative variant each.
  ('diabetes_complication_check_due', 'en', 'sms', null,
   -- Representative variant: check_type='retinal' ("eye screening"). The
   -- other branches are check_type='renal' ("kidney check") and the
   -- generic fallback ("a complication check") -- see TEMPLATE_MAP.
   'Hi, your diabetes eye screening is due {{due_date}}. Your care team can do this at your next visit — open the app for details. — Tarragon Health'),
  ('sponsored_plan_started', 'en', 'sms', null,
   -- Representative variant: is_payer=true (the sponsor's own copy). The
   -- other branch is the sponsored patient's copy -- see TEMPLATE_MAP.
   'Tarragon Health: you are now paying for {{person_name}}''s {{plan_name}}. They keep their own account and can cancel any time.'),
  ('video_visit_declined', 'en', 'sms', null,
   -- Representative variant: reason present. When absent, TEMPLATE_MAP
   -- omits the parenthetical entirely rather than leaving it empty.
   'We couldn''t schedule your video visit ({{reason}}). Your payment will be refunded in full. You can request another time in the app. Tarragon Health'),
  ('vitals_reminder', 'en', 'sms', null,
   -- Representative variant: no suggested_vital_type (the common case --
   -- most patients get the generic vitals link, not a specific type).
   'Hi, it''s time to log your vitals (due {{due_date}}). Tap to log it: https://app.tarragonhealth.ng/patient/vitals Tarragon Health'),

  -- clinician_alert_ack_timeout_* -- previously unimplemented anywhere (see
  -- header); now has a real TEMPLATE_MAP entry as of this same change, so
  -- these are catalog documentation of the fix, not the render source.
  ('clinician_alert_ack_timeout_backup', 'en', 'sms', null, '{{message}}'),
  ('clinician_alert_ack_timeout_backup', 'en', 'push', null, '{{message}}'),
  ('clinician_alert_ack_timeout_senior', 'en', 'sms', null, '{{message}}'),
  ('clinician_alert_ack_timeout_senior', 'en', 'push', null, '{{message}}'),
  ('clinician_alert_ack_timeout_admin', 'en', 'sms', null, '{{message}}'),
  ('clinician_alert_ack_timeout_admin', 'en', 'push', null, '{{message}}')
on conflict (template_key, locale, channel) do nothing;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notification_template_locales
  where template_key in (
    'pharmacy_order_pharmacy_alert', 'emergency_card_viewed', 'emergency_card_expiring_soon',
    'medication_review_due', 'lifestyle_review_due', 'new_care_message',
    'diabetes_complication_check_due', 'sponsored_plan_started', 'video_visit_declined', 'vitals_reminder',
    'clinician_alert_ack_timeout_backup', 'clinician_alert_ack_timeout_senior', 'clinician_alert_ack_timeout_admin'
  );
  if v_count < 18 then
    raise exception 'notification_template_locales pilot batch looks incomplete: only % rows', v_count;
  end if;
  raise notice 'PASS: notification_template_locales pilot batch seeded with % rows', v_count;
end $$;
