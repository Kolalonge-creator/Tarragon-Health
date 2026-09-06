-- Two clinical-content sign-off gaps, closed the same well-established way
-- this codebase already signs cv_risk_config: a SECURITY DEFINER RPC that
-- only an active Clinical Director can call, which stamps approved_by from
-- their own clinical_staff row (never client-supplied) and writes an
-- audit_log entry. Neither gap had ANY way to sign before this migration —
-- not a UI gap, a genuine "nothing in the app or the database can flip this
-- flag" gap.
--
-- lpe_content_blocks: the §78.15/16 AI Coach retrieval pipeline reads only
-- clinician_reviewed=true rows, but the table's write RLS only ever
-- required private.is_admin() -- any admin, not necessarily a clinician,
-- could already flip the flag directly, unlike every other clinical
-- sign-off surface in this codebase. Tightened to match cv_risk_config's
-- discipline: an admin can freely draft/edit content, but can never
-- themselves set clinician_reviewed=true through a direct write -- only
-- sign_lpe_content_block() can, and it requires an active Clinical
-- Director.
--
-- triage_protocols: the §78.10 symptom-checker's draft v1 protocol has sat
-- unsignable since the migration that created it (its own INSERT policy
-- already correctly requires is_admin() + unsigned/inactive; there was
-- simply no UPDATE policy or RPC at all, so nothing could ever move it to
-- signed/active).

alter table public.lpe_content_blocks
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;

drop policy if exists lpe_content_blocks_write on public.lpe_content_blocks;

-- An admin may insert/update/delete DRAFT content freely, but the result
-- must always be unreviewed -- editing an already-signed block means it
-- reverts to draft and needs re-signing, same as cv_risk_config never
-- letting an edit mutate a signed version in place.
create policy lpe_content_blocks_admin_write on public.lpe_content_blocks
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin() and clinician_reviewed = false);

create or replace function public.sign_lpe_content_block(p_block_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.lpe_content_blocks where id = p_block_id) then
    raise exception 'Content block not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can approve patient-facing content';
  end if;

  update public.lpe_content_blocks
    set clinician_reviewed = true, reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_block_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (
    (select auth.uid()), 'lpe_content_blocks.reviewed', 'lpe_content_blocks', p_block_id,
    jsonb_build_object('signed_by_clinical_staff', v_staff)
  );

  return p_block_id;
end $$;

revoke execute on function public.sign_lpe_content_block(uuid) from public;
grant execute on function public.sign_lpe_content_block(uuid) to authenticated;

create or replace function public.sign_triage_protocol(p_protocol_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.triage_protocols where id = p_protocol_id) then
    raise exception 'Triage protocol not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the symptom triage protocol';
  end if;

  -- Platform-wide, not per-organisation (triage_protocols has no
  -- organisation_id) -- one active version at a time, same "retire the
  -- prior one" discipline as sign_cv_risk_config.
  update public.triage_protocols set is_active = false where is_active and id <> p_protocol_id;

  update public.triage_protocols
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_protocol_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (
    (select auth.uid()), 'triage_protocols.signed', 'triage_protocols', p_protocol_id,
    jsonb_build_object('signed_by_clinical_staff', v_staff)
  );

  return p_protocol_id;
end $$;

revoke execute on function public.sign_triage_protocol(uuid) from public;
grant execute on function public.sign_triage_protocol(uuid) to authenticated;
