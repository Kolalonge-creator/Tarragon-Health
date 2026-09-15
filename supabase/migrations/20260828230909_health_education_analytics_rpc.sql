-- Module 20 (Health Education Platform) §20.18 — education analytics: content viewed,
-- completion, quiz performance, patient feedback, per catalogue item. Admin-only.
--
-- "Knowledge improvement" and "relationship with care-plan adherence" from the same spec
-- section are cross-feature correlations against adherence/vitals-logging signals that
-- live outside this table entirely — deliberately not attempted here; a wrong inferred
-- correlation on a clinical platform is worse than none. This RPC is the per-content
-- rollup the admin surface actually needs today: view/completion/quiz/feedback counts.
--
-- plpgsql (not sql) so the admin check can raise rather than silently return zero rows
-- for a non-admin caller — matches how other admin-only RPCs in this codebase fail
-- loudly instead of degrading to an empty, easy-to-miss result.

create function public.health_education_analytics()
returns table (
  content_id uuid,
  code text,
  title text,
  category public.health_education_category,
  content_type public.health_education_content_type,
  is_active boolean,
  view_count integer,
  understood_count integer,
  needs_review_count integer,
  avg_check_score numeric,
  avg_check_total numeric,
  helpful_count integer,
  not_helpful_count integer,
  unclear_count integer,
  want_more_count integer,
  report_incorrect_count integer
)
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'health_education_analytics: admin only';
  end if;

  return query
  select
    c.id,
    c.code,
    c.title,
    c.category,
    c.content_type,
    c.is_active,
    count(distinct pr.id)::int,
    count(distinct pr.id) filter (where pr.status = 'understood')::int,
    count(distinct pr.id) filter (where pr.status = 'needs_review')::int,
    avg(pr.check_score),
    avg(pr.check_total),
    count(distinct fb.id) filter (where fb.feedback_type = 'helpful')::int,
    count(distinct fb.id) filter (where fb.feedback_type = 'not_helpful')::int,
    count(distinct fb.id) filter (where fb.feedback_type = 'unclear')::int,
    count(distinct fb.id) filter (where fb.feedback_type = 'want_more_information')::int,
    count(distinct fb.id) filter (where fb.feedback_type = 'report_incorrect')::int
  from public.health_education_content c
  left join public.health_education_progress pr on pr.content_id = c.id
  left join public.health_education_feedback fb on fb.content_id = c.id
  group by c.id
  order by count(distinct pr.id) desc nulls last, c.title;
end;
$$;

revoke all on function public.health_education_analytics() from public;
revoke all on function public.health_education_analytics() from anon;
grant execute on function public.health_education_analytics() to authenticated;
