-- S38d: share the monthly progress report with the Care Circle (closes OQ-252). Needs S29 (merged 2026-10-06) and S38c.
--
-- No new permission and no sharing flag. A supporter sees a "monthly" block through the ticks the patient already gave:
--   * weekly_bp_trend  -> per month: whether there were enough readings, the average (whole numbers, as the weekly block), under or
--                          above the person's target, and the direction against the month before;
--   * adherence_summary -> per month: the share of medicines taken as planned.
-- With neither tick the block is absent, which means "not shared", never "zero". Nothing else of the report is shared: not the
-- target numbers, not the week split, not a reading count, not a risk score. The block is built by the one function that builds every
-- supporter block (so the patient's "see what they see" preview shows it too), reads only the patient's own stored reports, appears
-- only while the circle is not paused and the member is not expired or removed (circle_member_for is still the gate), and every read is
-- already logged by circle_supporter_view. A supporter has no table access to monthly_reports (RLS: the patient's own rows only).
--
-- Done by renaming S29's function and wrapping it, so S29's body is not copied and cannot drift. The proof asserts the block comes back
-- through circle_supporter_view, so a later migration that redefines circle_view_blocks without it fails CI.

alter function private.circle_view_blocks(uuid, text[]) rename to circle_view_blocks_core;

create function private.circle_monthly_block(p_patient uuid, p_permissions text[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_bp boolean := 'weekly_bp_trend' = any (p_permissions); v_adh boolean := 'adherence_summary' = any (p_permissions); v_rows jsonb;
begin
  if not (v_bp or v_adh) then return '{}'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'month', r.month,
           'enough_readings', case when v_bp then (r.payload ->> 'enough_readings')::boolean end,
           'average', case when v_bp and (r.payload ->> 'enough_readings')::boolean
                           then jsonb_build_object('systolic', round((r.payload #>> '{average,systolic}')::numeric)::integer,
                                                   'diastolic', round((r.payload #>> '{average,diastolic}')::numeric)::integer,
                                                   'versus_target', r.payload #>> '{average,versus_target}') end,
           'direction', case when v_bp then r.payload ->> 'direction_vs_last_month' end,
           'adherence_pct', case when v_adh then (r.payload ->> 'adherence_pct')::integer end,
           'adherence_shared', case when v_adh then true end)) order by r.month desc), '[]'::jsonb)
    into v_rows
    from (select month, payload from public.monthly_reports where patient_id = p_patient order by month desc limit 3) r;
  return jsonb_build_object('monthly', v_rows);
end $$;
revoke all on function private.circle_monthly_block(uuid, text[]) from public, anon, authenticated;

create function private.circle_view_blocks(p_patient uuid, p_permissions text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$ select private.circle_view_blocks_core(p_patient, p_permissions) || private.circle_monthly_block(p_patient, p_permissions) $$;
revoke all on function private.circle_view_blocks(uuid, text[]) from public, anon, authenticated;
revoke all on function private.circle_view_blocks_core(uuid, text[]) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.circle_view_blocks(uuid,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.circle_monthly_block(uuid,text[])', 'EXECUTE')
     or has_function_privilege('anon', 'private.circle_view_blocks_core(uuid,text[])', 'EXECUTE') then
    raise exception 'S38d: a circle block function is callable by a user';
  end if;
end $$;

-- S38d: the aggregate pilot report can be downloaded as a file (Module 22.9, company level). The export is the report that is already on
-- the page (aggregate, small groups withheld, no individual); this only writes the access to the audit log first, so a download that
-- could not be logged is not given. Admin or the active CMO, the same gate as the report itself. A sponsor-specific export needs a
-- sponsor and a cohort, which do not exist yet (OQ-254).
create function public.log_outcome_export(p_from date default null, p_to date default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  perform private.log_audit('outcomes.bp_control_export', 'outcome_report', null, jsonb_build_object('from', p_from, 'to', p_to, 'format', 'csv'));
end $$;
revoke all on function public.log_outcome_export(date, date) from public, anon;
grant execute on function public.log_outcome_export(date, date) to authenticated;
