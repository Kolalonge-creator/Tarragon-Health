-- AI knowledge source sign-off by the Chief Medical Officer (the guardrail half is 20261030161138_ai_guardrail_cmo_signoff).
-- Live on 2026-10-30: any admin could write the approval columns of ai_knowledge_sources directly, so an approval could be stamped with
-- nothing on record (the 5 current sources were approved by the CMO from chat earlier that day; this route is for every later one). Approving a source is what lets an AI answer cite it (private.approved_ai_knowledge_sources).
-- 1. public.approve_ai_knowledge_sources(ids, note): only an active CMO. Stamps approved_by (their clinical_staff id) and approved_at on the
--    listed unapproved rows, one audit_log row each that keeps the title and the patient-facing citation label. Rows already approved are
--    skipped; an unknown id refuses the whole call. The ids are what the person ticked on the hub, so nothing is stamped unseen.
-- 2. A trigger makes that function the only way to record an approval (no pre-approved insert, no direct write of the approval columns, admins
--    included) and clears an approval when the wording a patient sees or the source it points at is edited afterwards.
-- It approves nothing itself.
create or replace function private.guard_ai_knowledge_source_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.ai_knowledge_source_signoff', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.approved_by is not null or new.approved_at is not null then
      raise exception 'an AI knowledge source approval can only be recorded by approve_ai_knowledge_sources' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at) then
    raise exception 'an AI knowledge source approval can only be recorded by approve_ai_knowledge_sources' using errcode = '42501';
  end if;
  if old.approved_at is not null
     and (new.source_code, new.title, new.source_type, new.reference_table, new.reference_id, new.external_url, new.citation_label, new.ai_system_id)
         is distinct from (old.source_code, old.title, old.source_type, old.reference_table, old.reference_id, old.external_url, old.citation_label, old.ai_system_id) then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

revoke all on function private.guard_ai_knowledge_source_approval() from public, anon;

drop trigger if exists ai_knowledge_sources_approval_guard on public.ai_knowledge_sources;
create trigger ai_knowledge_sources_approval_guard
  before insert or update on public.ai_knowledge_sources
  for each row execute function private.guard_ai_knowledge_source_approval();

create or replace function public.approve_ai_knowledge_sources(p_ids uuid[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_staff uuid;
  v_org uuid;
  v_found integer;
  v_done integer;
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select cs.id, cs.organisation_id into v_staff, v_org
    from public.clinical_staff cs
   where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
   order by cs.created_at
   limit 1;
  if v_staff is null then
    raise exception 'only the active Chief Medical Officer can approve AI knowledge sources' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'pick at least one knowledge source to approve' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'approve at most 200 knowledge sources at a time' using errcode = '22023';
  end if;
  select count(*) into v_found from public.ai_knowledge_sources where id = any (p_ids);
  if v_found <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'one or more of those knowledge sources no longer exists; reload the page and try again' using errcode = '22023';
  end if;

  perform set_config('app.ai_knowledge_source_signoff', 'on', true);
  with approved as (
    update public.ai_knowledge_sources
       set approved_by = v_staff, approved_at = now()
     where id = any (p_ids) and approved_at is null
    returning id, ai_system_id, source_code, title, citation_label
  ), logged as (
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    select coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)), v_actor,
           'ai_knowledge_source.approved', 'ai_knowledge_sources', a.id,
           jsonb_build_object('source_code', a.source_code, 'title', a.title, 'citation_label', a.citation_label,
                              'ai_system_id', a.ai_system_id, 'signed_by_clinical_staff', v_staff,
                              'note', nullif(btrim(coalesce(p_note, '')), ''))
    from approved a
    returning 1
  )
  select count(*) into v_done from logged;
  perform set_config('app.ai_knowledge_source_signoff', '', true);
  return v_done;
end $$;

comment on function public.approve_ai_knowledge_sources(uuid[], text) is
  'Chief Medical Officer only. Records the CMO''s approval of the listed AI knowledge sources, one audit_log row each; already-approved rows are skipped. Returns how many were newly approved.';

revoke all on function public.approve_ai_knowledge_sources(uuid[], text) from public;
revoke all on function public.approve_ai_knowledge_sources(uuid[], text) from anon;
grant execute on function public.approve_ai_knowledge_sources(uuid[], text) to authenticated;

do $$ begin
  if has_function_privilege('anon', 'public.approve_ai_knowledge_sources(uuid[], text)', 'EXECUTE') then
    raise exception 'anon can execute approve_ai_knowledge_sources';
  end if;
end $$;
