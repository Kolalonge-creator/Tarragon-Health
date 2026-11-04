-- The founder, acting as DPO, confirmed the retention classes of the four Care Circle tables added on 2026-11-03 and 2026-11-04, in chat
-- on 2026-11-04 (docs/DECISIONS.md, CC-REG). Classes are unchanged; this records the review.
--   family_doctor_notes                  clinical_record, review at end of retention, in export
--   care_circle_gift_payer_dismissals    consent, review, in export
--   care_circle_permission_history       audit, review, in export
--   care_circle_task_responses           operational, delete (with the request), not in export
update public.data_registry
   set reviewed = true,
       reviewed_at = now(),
       reviewed_note = 'Retention class confirmed by Kola Longe, DPO, in chat 2026-11-04 (docs/DECISIONS.md CC-REG)'
 where table_name in ('family_doctor_notes', 'care_circle_gift_payer_dismissals', 'care_circle_permission_history', 'care_circle_task_responses')
   and not reviewed;

do $$
begin
  if exists (select 1 from public.data_registry
              where table_name in ('family_doctor_notes', 'care_circle_gift_payer_dismissals', 'care_circle_permission_history', 'care_circle_task_responses')
                and not reviewed) then
    raise exception 'CC-REG self-check: a Care Circle table is still unreviewed';
  end if;
  if (select count(*) from public.data_registry
       where table_name in ('family_doctor_notes', 'care_circle_gift_payer_dismissals', 'care_circle_permission_history', 'care_circle_task_responses')) <> 4 then
    raise exception 'CC-REG self-check: expected four registry rows';
  end if;
end $$;
