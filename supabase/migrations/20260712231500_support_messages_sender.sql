-- Tarragon Health
-- support_messages.sender_id: lets outbound WhatsApp replies carry a real
-- clinician's identity instead of a generic "Tarragon" sender —
-- docs/CLINICAL_TRUST_MODEL_SPEC.md §2/§4 (message_log.sender_id). Only
-- ever set by the send-support-reply Edge Function under the service-role
-- key (same as every other column on this table — see the no-insert-policy
-- comment on the original support_messages migration), never by a direct
-- client write. References profiles (the sending clinician's login), not
-- clinical_staff directly — the real name/credential used in the message
-- signature is resolved via clinical_staff.profile_id at send time, same
-- pattern as escalations.reviewed_by / ReviewedByDoctor.

alter table public.support_messages
  add column sender_id uuid references public.profiles (id) on delete set null;

create index support_messages_sender_id_idx on public.support_messages (sender_id);
