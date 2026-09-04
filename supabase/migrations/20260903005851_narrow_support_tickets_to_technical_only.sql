-- Patient Support & Service Centre / module 75 reconciliation, part 1/1.
--
-- support_tickets (PR #290, spec §24) and navigation_requests (module 75,
-- PR #337, merged and live 2026-09-02) were built the same day, independently,
-- and substantially overlap: 5 of support_ticket_category's 6 values
-- (technical, appointment, laboratory, pharmacy, payment) duplicate 5 of
-- navigation_request_category's 8, and both independently built a
-- "patient files a non-clinical request by category -> staff triages on a
-- worklist -> resolves with a note -> patient rates satisfaction" pipeline
-- plus a complaint-handling path. Only support_tickets' schema had reached
-- main-dev (recovered by the drift-reconciliation commit fc6545f3) with zero
-- app code ever built against it; navigation_requests has a live, working
-- patient-facing "I need help" card and a Care Coordinator worklist tab
-- already in production use.
--
-- Decision: navigation_requests stays the one patient-facing "get help"
-- surface for appointment/pharmacy/laboratory/payment/insurance/referral/
-- other logistics — it is the incumbent with real UI investment, and
-- rebuilding it as support_tickets would mean a live-data migration for no
-- functional gain. support_tickets is narrowed to what it does that
-- navigation_requests genuinely does not: a dedicated technical-support
-- ticket with a real Tier 1 -> Tier 2 -> Engineering escalation ladder
-- (§24.9), plus the formal seven-stage complaints governance workflow
-- (§24.14/24.15, a separate table, unaffected by this migration) that
-- navigation_requests only approximates with a flat is_complaint flag.
--
-- Per the CLAUDE.md pattern for removing a shipped feature: delete the
-- ability to use the value, not just the app-code path, so the feature can't
-- silently grow back through an unreachable member. Zero rows exist (the
-- schema has never been used by any app code), and no function signature
-- takes support_ticket_category as a parameter (only as a column type and
-- inside jsonb_object_agg reads in the analytics RPCs), so a full enum-type
-- swap was considered but rejected as unnecessary surgery-for-its-own-sake —
-- a CHECK constraint gives the same "cannot silently grow back" guarantee
-- (enforced for every writer, not just the app layer) at materially lower
-- risk to a table whose triggers/RLS/grants are already live. The unused
-- enum values ('clinical_navigation', 'appointment', 'laboratory',
-- 'pharmacy', 'payment') remain in the type but are now unreachable on this
-- table.

alter table public.support_tickets
  add constraint support_tickets_category_technical_only check (category = 'technical');

comment on column public.support_tickets.category is
  'Constrained to ''technical'' only (support_tickets_category_technical_only) — every other category this table originally supported is handled by navigation_requests (module 75) instead. See this migration''s header for the full reconciliation.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'support_tickets_category_technical_only'
      and conrelid = 'public.support_tickets'::regclass
  ) then
    raise exception 'support_tickets_category_technical_only was not created';
  end if;
  raise notice 'PASS: support_tickets narrowed to technical-only category';
end $$;
