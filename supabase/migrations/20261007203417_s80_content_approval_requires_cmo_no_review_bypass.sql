-- S80 fix-first (25.1, spec safety rule: "Clinical content cannot be published
-- without the clinical reviewer role").
--
-- Live defects fixed in public.set_health_education_content_status:
--   1. Any admin could move clinical_review -> approved, which stamps
--      clinician_reviewed = true. Only an active Chief Medical Officer may.
--   2. The quick-toggle migration (20260830015108) let draft -> published and
--      updated -> published skip review entirely.
--   3. review_due -> published re-affirmed expired content with no review.
--   4. The function required is_admin(), so a CMO (a clinician login) could
--      never call it. Ordinary moves now accept an admin or an active CMO.
--
-- Live counts when written (2026-10-07): 219 published, 30 draft; 213 published
-- rows have clinician_reviewed not true. Nothing here rewrites those rows: the
-- gate applies to transitions from now on, so no data conversion step exists.
-- Whether to withdraw or re-review the 213 is a CMO decision (see
-- docs/plans/S80-S85-cmo-decision-pack.md), not made here.

create or replace function public.set_health_education_content_status(
  p_content_id uuid,
  p_new_status public.health_education_content_status,
  p_note text default null
)
returns public.health_education_content_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.health_education_content_status;
  v_actor uuid := (select auth.uid());
  v_cmo boolean := private.is_active_clinical_director();
  v_legal boolean := false;
begin
  if not (private.is_admin() or v_cmo) then
    raise exception 'Only an admin or the Chief Medical Officer may change health-education content status';
  end if;

  select content_status into v_current
    from public.health_education_content where id = p_content_id for update;
  if v_current is null then
    raise exception 'Unknown health_education_content id %', p_content_id;
  end if;

  -- No path reaches published without passing through approved, except
  -- re-affirming already-reviewed expired content, which needs the CMO.
  v_legal := case
    when v_current = 'draft' and p_new_status = 'clinical_review' then true
    when v_current = 'clinical_review' and p_new_status in ('approved', 'draft') then true
    when v_current = 'approved' and p_new_status in ('published', 'clinical_review') then true
    when v_current = 'published' and p_new_status in ('review_due', 'updated', 'draft') then true
    when v_current = 'review_due' and p_new_status in ('updated', 'published', 'draft') then true
    when v_current = 'updated' and p_new_status = 'clinical_review' then true
    else false
  end;
  if not v_legal then
    raise exception 'Illegal health-education status transition: % -> %', v_current, p_new_status;
  end if;

  if (p_new_status = 'approved' or (v_current = 'review_due' and p_new_status = 'published'))
     and not v_cmo then
    raise exception 'not authorised: only an active Chief Medical Officer can approve patient-facing content';
  end if;

  update public.health_education_content
    set content_status = p_new_status,
        content_version = case when p_new_status = 'updated' then content_version + 1 else content_version end,
        clinician_reviewed = case when p_new_status = 'approved' then true else clinician_reviewed end,
        reviewed_at = case when p_new_status = 'approved' then now() else reviewed_at end
    where id = p_content_id;

  insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
  values (p_content_id, v_current, p_new_status, v_actor, p_note);

  return p_new_status;
end;
$$;

revoke execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) from public;
grant execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.set_health_education_content_status(uuid, public.health_education_content_status, text)', 'EXECUTE') then
    raise exception 'anon must not execute set_health_education_content_status';
  end if;
end $$;
