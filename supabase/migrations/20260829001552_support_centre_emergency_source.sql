-- Tarragon Health — Patient Support & Service Centre, part 1/8: emergency_source value.
--
-- Building the support-ticket intake flow (docs task: "Patient Support & Service
-- Centre", §24). A support ticket's free-text description can describe a real
-- emergency ("I'm having severe chest pain") — §24.7 requires that this is
-- immediately routed to the existing emergency pathway instead of becoming an
-- ordinary ticket. That pathway is `emergency_events` (20260716224736), whose
-- `source` column is the `emergency_source` enum, not free text — deliberately,
-- per that migration's own design note, so the trigger can never be gamed. This
-- adds the one new value the intake flow needs: 'support_ticket_intake'.
--
-- Own migration, own transaction: Postgres does not allow a new enum value to
-- be used in the same transaction that added it — same split already used for
-- 'pharmacist' (20260716177000) and 'analyst' (20260717180633).

alter type public.emergency_source add value if not exists 'support_ticket_intake';
