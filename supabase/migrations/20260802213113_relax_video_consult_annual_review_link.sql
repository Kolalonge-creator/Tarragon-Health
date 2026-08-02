-- video_consultations_context_link required annual_review_id NOT NULL
-- whenever context='annual_review' — a constraint written back when the only
-- source of that context value was the now-retired standalone annual_reviews
-- orchestration table. Comprehensive Screen's bundled consult reuses the
-- same context value (no product-facing meaning attached to the enum label
-- itself) but has no annual_reviews row to link to — it links via the
-- lab_orders row instead (implicit, through the resulted-order trigger that
-- created it). Widened, not removed: pre_referral_triage/specialist_consult
-- keep their required link untouched.
alter table public.video_consultations drop constraint if exists video_consultations_context_link;
alter table public.video_consultations add constraint video_consultations_context_link
  check (
    (context = 'pre_referral_triage' and escalation_id is not null)
    or (context = 'specialist_consult' and specialist_referral_id is not null)
    or (context = 'annual_review')
    or (context = 'general_checkin')
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'video_consultations_context_link'
  ) then
    raise exception 'video_consultations_context_link constraint missing after widen';
  end if;
end $$;
