-- Triage rule BP-P5 (postpartum raised reading) creates task key postpartum_review; no task type answered it,
-- so approve_triage_rule_set refused v2. CMO chose amber_bp_review as its queue (2026-10-06).
update public.task_types
   set source_task_keys = source_task_keys || array['postpartum_review']
 where code = 'amber_bp_review' and is_active
   and not (source_task_keys @> array['postpartum_review']);

do $$
begin
  if not exists (select 1 from public.task_types where code = 'amber_bp_review' and is_active and creatable and source_task_keys @> array['postpartum_review']) then
    raise exception 'postpartum_review is not answered by amber_bp_review';
  end if;
end $$;
