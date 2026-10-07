-- S55 review fixes (code review of 20261007140317 and 20261007141852).
-- Rows affected: none (one function replaced, one added, one privilege revoked).
--
-- 1. learn_shared_article() is callable signed out, and share_enabled defaults to true, so every one of the 235 grandfathered
--    published items (no review date, often no named reviewer) was publicly readable by guessing a code, with no expiry ever.
--    The link now opens an article only while it carries the same facts the publish gate demands of a new one: a named
--    reviewer, a review date and a next review date in the future (the servable rule already handles "in the future").
--    A grandfathered item becomes shareable again as soon as its review details are filled in.
-- 2. learning_creators granted INSERT/UPDATE/DELETE to authenticated under an admin "for all" policy, so an admin could set
--    status = 'verified' (with verified_by of their own choosing) straight on the table, skipping the audit row and the
--    refusal in verify_learning_creator(). Every write goes through the SECURITY DEFINER functions, so the grant is removed.

create or replace function public.learn_shared_article(p_code text)
returns table (
  code text, title text, summary text, body text, estimated_minutes integer,
  reviewed_by_name text, reviewed_at timestamptz, next_review_due date,
  source_reference text, evidence_source text, self_care_action text, creator_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.title, c.summary, c.body, c.estimated_minutes,
         c.reviewed_by_name, c.reviewed_at, c.next_review_due, c.source_reference, c.evidence_source,
         c.self_care_action, case when cr.status = 'verified' then cr.display_name end
    from public.health_education_content c
    left join public.learning_creators cr on cr.id = c.creator_id
   where c.code = p_code
     and private.learning_item_is_shareable(c);
$$;

revoke insert, update, delete on public.learning_creators from authenticated;

-- 3. A suspended or declined creator had no way back. Reinstating does NOT restore trust: the creator returns to "invited" with
--    the old MDCN number, evidence and indemnity cleared, so they must send credentials again and an admin must verify again;
--    their earlier content stays down (review_due) until a clinician re-reviews and republishes it.
create or replace function public.reinstate_learning_creator(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.learning_creators%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may reinstate a creator' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'A note of at least 10 characters is required' using errcode = '22023';
  end if;
  select * into v_row from public.learning_creators where id = p_id for update;
  if not found then raise exception 'Unknown creator' using errcode = '22023'; end if;
  if v_row.status not in ('suspended', 'declined') then
    raise exception 'Only a suspended or declined creator can be reinstated' using errcode = '22023';
  end if;
  -- the earlier evidence may be why they were suspended or declined, so it is cleared and has to be sent again
  update public.learning_creators
     set status = 'invited', mdcn_number = null, credential_evidence = null, indemnity_confirmed = false,
         verified_by = null, verified_at = null, status_note = btrim(p_note)
   where id = p_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_row.organisation_id, (select auth.uid()), 'learning_creator.reinstated', 'learning_creator', p_id,
            jsonb_build_object('from', v_row.status, 'note', btrim(p_note)));
end;
$$;
revoke execute on function public.reinstate_learning_creator(uuid, text) from public;
revoke execute on function public.reinstate_learning_creator(uuid, text) from anon;
grant execute on function public.reinstate_learning_creator(uuid, text) to authenticated, service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.learning_creators', 'INSERT')
     or has_table_privilege('authenticated', 'public.learning_creators', 'UPDATE')
     or has_table_privilege('authenticated', 'public.learning_creators', 'DELETE') then
    raise exception 'S55 review fix: authenticated can still write learning_creators directly';
  end if;
  if not has_table_privilege('authenticated', 'public.learning_creators', 'SELECT') then
    raise exception 'S55 review fix: authenticated lost read access to learning_creators';
  end if;
  if has_function_privilege('anon', 'public.reinstate_learning_creator(uuid, text)', 'EXECUTE') then
    raise exception 'S55 review fix: anon can reinstate a creator';
  end if;
  if not has_function_privilege('anon', 'public.learn_shared_article(text)', 'EXECUTE') then
    raise exception 'S55 review fix: the shared article function must stay callable signed out';
  end if;
end $$;
