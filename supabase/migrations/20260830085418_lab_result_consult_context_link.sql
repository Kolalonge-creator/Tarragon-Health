-- Widen video_consultations_context_link to accept the new
-- 'lab_result_consult' context added in 20260830085400. Widened, not
-- replaced: every existing branch (pre_referral_triage/specialist_consult
-- required links, annual_review/general_checkin unlinked) is preserved
-- byte-for-byte from the live definition (pulled via pg_get_constraintdef
-- first), matching the precedent set by
-- 20260802213113_relax_video_consult_annual_review_link.sql.
--
-- No link column is required for 'lab_result_consult' because no
-- video_consultations row is ever created with this context yet in this
-- feature pass (see 20260830085400's header) — when the accept-flow that
-- actually books the 15-minute visit is built, this constraint can be
-- tightened again if a link column is added then.

alter table public.video_consultations drop constraint if exists video_consultations_context_link;
alter table public.video_consultations add constraint video_consultations_context_link
  check (
    (context = 'pre_referral_triage' and escalation_id is not null)
    or (context = 'specialist_consult' and specialist_referral_id is not null)
    or (context = 'annual_review')
    or (context = 'general_checkin')
    or (context = 'lab_result_consult')
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'video_consultations_context_link'
  ) then
    raise exception 'video_consultations_context_link constraint missing after widen';
  end if;
end $$;
