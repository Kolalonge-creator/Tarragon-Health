-- Follow-up (OQ-350), part 1 of 2: the lead_end_reason value for a clinician who fails the credential verification gate.
-- Alone in its own file on purpose: a new enum value cannot be used in the transaction that adds it, and part 2 (the next
-- migration) returns it from private.lead_ineligibility_reason. Nothing uses the value yet, so this changes no behaviour by itself.
alter type public.lead_end_reason add value if not exists 'verification_missing';
