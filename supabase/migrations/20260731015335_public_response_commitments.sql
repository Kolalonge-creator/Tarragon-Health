-- Publish the response-time promise, sourced from the signed config itself.
--
-- escalation_slas (20260730105131) turned a set of hardcoded interval literals
-- scattered across eight trigger functions into one versioned, Clinical
-- Director-signable table. Version 2 is signed and active. Nothing outside the
-- admin screen could read it, so the only response-time claims a prospective
-- patient could see were whatever marketing copy happened to say, maintained by
-- hand, free to drift from what the platform actually does.
--
-- Reading the promise out of the signed row closes that off structurally. The
-- public page cannot claim a number the Clinical Director has not put their
-- name to, and cannot keep claiming an old one after a new version is signed.
--
-- Three deliberate narrowings, because publishing the raw config would be worse
-- than publishing nothing:
--
--   Ceilings, not best cases. Per tier this returns the SLOWEST commitment
--   across every pathway, not the fastest. The founder confirmed on 2026-07-30
--   that pathways legitimately differ (a red-flagged home BP reading is not a
--   routine abnormal screening result), so a single per-tier number can only
--   honestly be the one always kept. Emergency reads as two hours even though
--   most emergency pathways are fifteen minutes.
--
--   No internals. source_function and channel_sequence are implementation
--   detail and stay unexposed. A patient needs the promise, not the plumbing.
--
--   Nothing until it is signed. The join on approved_by is an inner join, so an
--   unsigned or draft config publishes no numbers at all rather than quietly
--   advertising something nobody has approved. The signer's name is included on
--   purpose: a commitment nobody is named against is not a commitment.
--
-- 'routine' is excluded because no trigger emits it; it exists only for parity
-- with the v3 spec's four-tier table.
create or replace function public.public_response_commitments()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'version',          s.version,
        'approved_at',      s.approved_at,
        'approved_by_name', cs.full_name,
        'commitments',      (
          select coalesce(jsonb_agg(t order by t.ceiling_minutes), '[]'::jsonb)
          from (
            select e->>'tier' as tier,
                   max((e->>'sla_minutes')::int) as ceiling_minutes
            from jsonb_array_elements(s.config) e
            where e->>'tier' <> 'routine'
            group by e->>'tier'
          ) t
        )
      )
      from public.escalation_slas s
      join public.clinical_staff cs on cs.id = s.approved_by
      where s.is_active
        and s.approved_by is not null
      order by s.version desc
      limit 1
    ),
    jsonb_build_object('version', null, 'commitments', '[]'::jsonb)
  );
$$;

-- Deliberately anon-callable. Clear the inherited PUBLIC grant first, then grant
-- back by name, so the access is explicit rather than accidental.
revoke all on function public.public_response_commitments() from public, anon;
grant execute on function public.public_response_commitments() to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.public_response_commitments()', 'EXECUTE') then
    raise exception 'anon must be able to read the published response commitments';
  end if;
end $$;
