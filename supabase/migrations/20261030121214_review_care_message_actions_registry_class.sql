-- The CMO and DPO review of public.data_registry for care_message_actions (registered by 20261030101027_staff_chat_attachments_reminders_owner_actions.sql
-- with reviewed = false). The founder, who holds both roles, confirmed the proposed class in chat on 2026-10-30:
--   retention_class clinical_record, end_of_retention review, included in the patient's data export. No correction.
-- Same wording as the S39f class review (20261007190000): the reviewer, the date and the outcome are recorded here.
update public.data_registry
   set reviewed = true,
       reviewed_at = now(),
       reviewed_note = 'CMO and DPO review 2026-10-30 (founder, in chat): confirmed clinical_record / review / in export, no correction'
 where table_name = 'care_message_actions'
   and not reviewed;

do $$
begin
  if not exists (select 1 from public.data_registry where table_name = 'care_message_actions' and reviewed and retention_class = 'clinical_record' and in_export) then
    raise exception 'FAIL: care_message_actions was not marked reviewed as expected';
  end if;
end $$;
