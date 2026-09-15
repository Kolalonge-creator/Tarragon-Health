-- Close the auditability gap on patient_result_explanations (§78.18) --
-- it carries model_id/input_snapshot/generated_at already but was never
-- attached to the platform's row-change audit trigger, unlike its sibling
-- case_briefs. Bounded, single-record content (not a growing conversation
-- transcript like ai_conversations, which is deliberately NOT attached here
-- for that reason -- see apps/web/src/lib/ai-coach/index.ts's comments).
drop trigger if exists audit_row_change_trg on public.patient_result_explanations;
create trigger audit_row_change_trg
  after insert or update or delete on public.patient_result_explanations
  for each row execute function private.audit_row_change();
