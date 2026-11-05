-- Health library proof (website upgrade Phase 4, 20261105172209_marketing_resources_provenance_and_review_gate.sql):
-- an article cannot move to published without a clinical reviewer and a review date; an already-published article
-- without a review (the grandfathered set) can still be edited and stays live; a recorded review sets next_review_at
-- a year on; every update and delete keeps the previous version in marketing_resource_revisions, which anon cannot
-- read and nobody can write directly; a scheduled article is hidden from anon until its publish_at.
-- Own fixtures; BEGIN/ROLLBACK; a sabotage step at the end.
begin;

do $$
declare
  v_id uuid;
  v_old uuid;
  v_next timestamptz;
  v_n int;
  v_failed boolean;
begin
  -- 1. publishing without a review is refused, on insert and on unpublished -> published
  v_failed := false;
  begin
    insert into public.marketing_resources (slug, title, description, category, sections, is_published)
    values ('proof-unreviewed', 'Proof', 'Proof', 'General', '[{"heading":"H","paragraphs":["p"]}]', true);
  exception when sqlstate '23514' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: an unreviewed article was inserted as published'; end if;

  insert into public.marketing_resources (slug, title, description, category, sections, is_published)
  values ('proof-draft', 'Proof draft', 'Proof', 'General', '[{"heading":"H","paragraphs":["p"]}]', false)
  returning id into v_id;
  v_failed := false;
  begin
    update public.marketing_resources set is_published = true where id = v_id;
  exception when sqlstate '23514' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: an unreviewed draft was published'; end if;

  -- a blank reviewer name does not count as a review
  v_failed := false;
  begin
    update public.marketing_resources set is_published = true, reviewed_by_name = '   ', reviewed_at = now() where id = v_id;
  exception when sqlstate '23514' then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a blank reviewer name was accepted as a review'; end if;

  -- 2. with a review it publishes, and next_review_at defaults to a year later
  update public.marketing_resources
     set is_published = true, reviewed_by_name = 'Dr Proof', reviewed_at = '2026-11-05T00:00:00Z'
   where id = v_id;
  select next_review_at into v_next from public.marketing_resources where id = v_id;
  if v_next is distinct from '2027-11-05T00:00:00Z'::timestamptz then
    raise exception 'FAIL: next_review_at is %, expected a year after the review', v_next;
  end if;

  -- 3. the grandfathered case: an article already live without a review can still be edited and stays live
  insert into public.marketing_resources (slug, title, description, category, sections, is_published)
  values ('proof-legacy', 'Legacy', 'Legacy', 'General', '[{"heading":"H","paragraphs":["p"]}]', false)
  returning id into v_old;
  alter table public.marketing_resources disable trigger marketing_resources_review_gate;
  update public.marketing_resources set is_published = true where id = v_old;  -- stands in for a pre-gate live row
  alter table public.marketing_resources enable trigger marketing_resources_review_gate;
  update public.marketing_resources set description = 'Legacy, edited' where id = v_old;
  if not (select is_published from public.marketing_resources where id = v_old) then
    raise exception 'FAIL: editing a grandfathered live article unpublished it';
  end if;

  -- 4. revisions: every update and delete keeps the previous version
  select count(*) into v_n from public.marketing_resource_revisions where resource_id = v_old and operation = 'UPDATE';
  if v_n < 2 then raise exception 'FAIL: expected at least 2 update revisions for the legacy article, found %', v_n; end if;
  if not exists (select 1 from public.marketing_resource_revisions
                  where resource_id = v_old and snapshot->>'description' = 'Legacy') then
    raise exception 'FAIL: the revision does not hold the previous description';
  end if;
  delete from public.marketing_resources where id = v_old;
  if not exists (select 1 from public.marketing_resource_revisions where resource_id = v_old and operation = 'DELETE') then
    raise exception 'FAIL: a delete left no revision';
  end if;

  -- 5. revisions are read-only and private
  if has_table_privilege('anon', 'public.marketing_resource_revisions', 'SELECT') then
    raise exception 'FAIL: anon can read revisions';
  end if;
  if has_table_privilege('authenticated', 'public.marketing_resource_revisions', 'INSERT')
     or has_table_privilege('authenticated', 'public.marketing_resource_revisions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.marketing_resource_revisions', 'DELETE') then
    raise exception 'FAIL: authenticated can write revisions directly';
  end if;

  -- 6. references must be an array
  v_failed := false;
  begin
    update public.marketing_resources set source_references = '{"label":"x"}'::jsonb where id = v_id;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a non-array source_references was accepted'; end if;

  -- 7. scheduled: published but publish_at in the future is hidden from anon
  update public.marketing_resources set publish_at = now() + interval '1 day' where id = v_id;
end $$;

set local role anon;
do $$
begin
  if exists (select 1 from public.marketing_resources where slug = 'proof-draft') then
    raise exception 'FAIL: anon can see an article scheduled for the future';
  end if;
end $$;
reset role;

do $$
begin
  update public.marketing_resources set publish_at = now() - interval '1 minute' where slug = 'proof-draft';
end $$;
set local role anon;
do $$
begin
  if not exists (select 1 from public.marketing_resources where slug = 'proof-draft') then
    raise exception 'FAIL: anon cannot see a published article whose publish_at has passed';
  end if;
end $$;
reset role;

-- Sabotage: without the gate trigger an unreviewed article can be published, so step 1 above would have failed.
do $$
declare
  v_caught boolean := false;
begin
  alter table public.marketing_resources disable trigger marketing_resources_review_gate;
  insert into public.marketing_resources (slug, title, description, category, sections, is_published)
  values ('proof-sabotage', 'S', 'S', 'General', '[{"heading":"H","paragraphs":["p"]}]', true);
  if exists (select 1 from public.marketing_resources where slug = 'proof-sabotage' and is_published and reviewed_by_name is null) then
    v_caught := true;  -- the check in step 1 would see this and fail
  end if;
  alter table public.marketing_resources enable trigger marketing_resources_review_gate;
  if not v_caught then raise exception 'FAIL: sabotage did not reproduce the unreviewed publish'; end if;
end $$;

rollback;
