-- Tarragon Health — Patient Support & Service Centre, part 2/8: taxonomy.
--
-- The platform has no formal support-ticketing system today. What exists is
-- `support_messages` (20260712010514), a flat WhatsApp-inbound message log
-- with no category/priority/state machine — CLAUDE.md is explicit that this
-- is a distinct, still-live channel, not a ticketing system, and should not
-- be repurposed. This builds the real thing: a categorised, prioritised,
-- stateful support_tickets table (part 3), threaded comments + status
-- history (part 4), a link into the existing clinical/technical escalation
-- machinery (parts 5-6), a complaints/governance workflow that can become a
-- formal clinical incident (part 7), and analytics (part 8).
--
-- Confirmed genuinely greenfield before writing this: no support_tickets,
-- complaints, knowledge_base, or faq table/type exists anywhere in the
-- codebase (exhaustive grep across supabase/migrations and packages/db).
--
-- Enum shapes below map directly to the spec:
--  * support_ticket_category — §24.2's six categories (technical, clinical
--    navigation, appointment, laboratory, pharmacy, payment).
--  * support_ticket_priority — §24.6 (critical/high/normal/low).
--  * support_ticket_status — §24.5's exact six-state lifecycle (New ->
--    Assigned -> In progress -> Awaiting patient -> Resolved -> Closed).
--  * support_ticket_channel — §24.3's channels a ticket can be raised
--    through. 'chatbot' is included for schema completeness only — §24.12
--    is explicit that an AI support agent is a future ("Eventually AI can
--    handle simple requests"), not something to build now; no functional
--    chatbot is built in this migration set, same discipline CLAUDE.md
--    applies to other Phase 2/3 items.
--  * complaint_status — §24.14's exact seven-stage governance workflow
--    (Complaint -> Acknowledged -> Assigned -> Investigated -> Response ->
--    Resolution -> Governance review). 'received' is the "Complaint" stage
--    (a bare noun doesn't make a good enum value), 'response_sent'/
--    'resolved' are "Response"/"Resolution".
--
-- Internal knowledge-base and patient FAQ content (§24.10/§24.11) are
-- deliberately built as content-as-code (matching the marketing site's own
-- HOMEPAGE_FAQS pattern), not new DB tables — this is genuinely static
-- reference content at this stage, not per-tenant authored material, and a
-- full CMS was not asked for.

create type public.support_ticket_category as enum (
  'technical', 'clinical_navigation', 'appointment', 'laboratory', 'pharmacy', 'payment'
);

create type public.support_ticket_priority as enum ('low', 'normal', 'high', 'critical');

create type public.support_ticket_status as enum (
  'new', 'assigned', 'in_progress', 'awaiting_patient', 'resolved', 'closed'
);

create type public.support_ticket_channel as enum (
  'in_app', 'phone', 'email', 'faq', 'chatbot', 'whatsapp'
);

create type public.complaint_status as enum (
  'received', 'acknowledged', 'assigned', 'investigating', 'response_sent', 'resolved', 'governance_review'
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'support_ticket_category') then
    raise exception 'support_ticket_category was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'support_ticket_priority') then
    raise exception 'support_ticket_priority was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'support_ticket_status') then
    raise exception 'support_ticket_status was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'support_ticket_channel') then
    raise exception 'support_ticket_channel was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'complaint_status') then
    raise exception 'complaint_status was not created';
  end if;
  raise notice 'PASS: support-centre taxonomy enums in place';
end $$;
