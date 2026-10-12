-- Two-tier decisions (CMO, 2026-10-08, item 1): a red event raised by the triage engine on a Free patient is recorded as an
-- emergency event so the existing acknowledge-gated guidance, emergency-contact notice and follow-up all apply.
-- This only adds the enum label. It is its own file because a new enum value cannot be used in the transaction that adds it;
-- the next migration uses it.
alter type public.emergency_source add value if not exists 'triage_red';
