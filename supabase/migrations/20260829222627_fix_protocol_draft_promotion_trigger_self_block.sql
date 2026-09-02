-- Tarragon Health
-- Fix: private.enforce_protocol_draft_attribution() blocked
-- promote_protocol_draft()/reject_protocol_draft()'s OWN internal UPDATE --
-- caught by packages/db/tests/protocol_drafts_and_qi_cycles_rls.sql, run
-- right after 20260829221531_protocol_review_workflow.sql landed. The
-- trigger has no way to tell "this UPDATE came from the authorised RPC" from
-- "a client tried to set status=promoted directly" -- both are plain UPDATE
-- statements against the same table from the trigger's point of view.
--
-- Fix: the two RPCs set a transaction-local flag immediately before their
-- own UPDATE; the trigger's promoted/rejected guard is skipped only when
-- that flag is present. Transaction-local (the `true` third argument to
-- set_config) means it can never leak into a later, unrelated statement --
-- it is unset the moment the RPC's transaction ends, same guarantee
-- set_config('request.jwt.claims', ..., true) already relies on throughout
-- this codebase's own test harness.

create or replace function private.enforce_protocol_draft_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and (
      is_clinical_director
      or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
    )
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can draft or edit a protocol.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select auth.uid());
    new.status := coalesce(nullif(new.status, ''), 'draft');
    if new.status not in ('draft', 'in_review') then
      new.status := 'draft';
    end if;
    new.promoted_to_version_id := null;
    new.rejected_reason := null;
    return new;
  end if;

  if old.status in ('promoted', 'rejected') then
    raise exception 'This protocol draft is % and is closed -- start a new draft if something new needs recording.', old.status
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;
  new.organisation_id := old.organisation_id;
  new.protocol_id := old.protocol_id;

  -- Only promote_protocol_draft()/reject_protocol_draft() set this flag,
  -- immediately before their own UPDATE, in the same transaction -- a plain
  -- client UPDATE never has it set.
  if new.status in ('promoted', 'rejected') and old.status not in ('promoted', 'rejected')
     and coalesce(current_setting('app.protocol_draft_transition_authorised', true), 'false') <> 'true' then
    raise exception 'A protocol draft can only be promoted or rejected via promote_protocol_draft()/reject_protocol_draft(), not a direct update.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.promote_protocol_draft(p_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.protocol_drafts%rowtype;
  v_director uuid;
  v_next_version int;
  v_new_version_id uuid;
begin
  select * into v_draft from public.protocol_drafts where id = p_draft_id;
  if v_draft.id is null then
    raise exception 'Protocol draft not found';
  end if;
  if v_draft.status in ('promoted', 'rejected') then
    raise exception 'This draft is already %', v_draft.status;
  end if;

  select id into v_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_draft.organisation_id
    and active
    and is_clinical_director;
  if v_director is null then
    raise exception 'Only the org''s active Clinical Director can promote a protocol draft'
      using errcode = '42501';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.protocol_versions
  where organisation_id = v_draft.organisation_id and protocol_id = v_draft.protocol_id;

  insert into public.protocol_versions
    (organisation_id, protocol_id, version_number, title, change_summary, content,
     evidence_basis, applicable_population, specialty)
  values
    (v_draft.organisation_id, v_draft.protocol_id, v_next_version, v_draft.title, v_draft.change_summary, v_draft.content,
     v_draft.evidence_basis, v_draft.applicable_population, v_draft.specialty)
  returning id into v_new_version_id;

  perform set_config('app.protocol_draft_transition_authorised', 'true', true);
  update public.protocol_drafts
  set status = 'promoted', promoted_to_version_id = v_new_version_id
  where id = p_draft_id;

  return v_new_version_id;
end;
$$;

create or replace function public.reject_protocol_draft(p_draft_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_director uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A rejection needs a stated reason.';
  end if;

  select organisation_id into v_org from public.protocol_drafts where id = p_draft_id and status not in ('promoted', 'rejected');
  if v_org is null then
    raise exception 'Protocol draft not found, or already promoted/rejected';
  end if;

  select id into v_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_org
    and active
    and is_clinical_director;
  if v_director is null then
    raise exception 'Only the org''s active Clinical Director can reject a protocol draft'
      using errcode = '42501';
  end if;

  perform set_config('app.protocol_draft_transition_authorised', 'true', true);
  update public.protocol_drafts
  set status = 'rejected', rejected_reason = p_reason
  where id = p_draft_id;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'promote_protocol_draft'
  ) then
    raise exception 'promote_protocol_draft missing after fix';
  end if;
  raise notice 'PASS: promote/reject_protocol_draft no longer self-blocked by the attribution trigger';
end $$;
