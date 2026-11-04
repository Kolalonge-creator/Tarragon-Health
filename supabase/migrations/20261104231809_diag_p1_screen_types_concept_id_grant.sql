-- Diagnostic directory Phase 1 follow-up: screen_types uses column-level SELECT grants (Track E 8.16,
-- 20261007105817: commission_rate must stay unreadable), so a new column is unreadable until granted.
-- 20261104225509 added screen_types.concept_id without the grant; the standing proof
-- e_lab_screen_therapy_commission_columns_not_readable.sql (check F) caught it. concept_id is not commercial.
grant select (concept_id) on public.screen_types to authenticated;

do $$
begin
  if not has_column_privilege('authenticated', 'public.screen_types', 'concept_id', 'SELECT') then
    raise exception 'screen_types.concept_id is still not readable by authenticated';
  end if;
  if has_column_privilege('authenticated', 'public.screen_types', 'commission_rate', 'SELECT') then
    raise exception 'commission_rate became readable';
  end if;
end;
$$;
