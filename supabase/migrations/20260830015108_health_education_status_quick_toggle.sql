-- Tarragon Health — Health Education: allow a direct draft<->published
-- toggle alongside the full governance chain.
--
-- The admin catalogue UI (health-education-manager.tsx) has always let an
-- admin instantly flip a content row live/hidden via is_active — described
-- in docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §6 as "management, not a
-- full CMS, deliberate thin slice." The strict state machine added in
-- 20260830013215 (draft -> clinical_review -> approved -> published) would
-- have silently broken that operational escape hatch — there was no direct
-- draft -> published edge, so an admin needing to publish or emergency-pull
-- something right now would be blocked. This adds that direct edge back in
-- both directions: draft <-> published. The full clinical_review -> approved
-- chain remains available for content that wants a documented review trail;
-- this is additive, not a replacement.
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
  v_legal boolean := false;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may change health-education content status';
  end if;

  select content_status into v_current
    from public.health_education_content where id = p_content_id for update;
  if v_current is null then
    raise exception 'Unknown health_education_content id %', p_content_id;
  end if;

  v_legal := case
    when v_current = 'draft' and p_new_status in ('clinical_review', 'published') then true
    when v_current = 'clinical_review' and p_new_status in ('approved', 'draft') then true
    when v_current = 'approved' and p_new_status in ('published', 'clinical_review') then true
    when v_current = 'published' and p_new_status in ('review_due', 'updated', 'draft') then true
    when v_current = 'review_due' and p_new_status in ('updated', 'published', 'draft') then true
    when v_current = 'updated' and p_new_status in ('clinical_review', 'published') then true
    else false
  end;
  if not v_legal then
    raise exception 'Illegal health-education status transition: % -> %', v_current, p_new_status;
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
