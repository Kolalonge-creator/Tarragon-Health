-- Tarragon Health — clinician audit gaps (Care Team / Provider Workspace §5.20)
--
-- Three closable gaps confirmed by grepping the whole codebase before writing this:
--
-- 1. specialist_referrals was never added to the row-change audit trigger
--    (20260812030853_row_change_audit_triggers.sql) — that migration's own header
--    calls extending the covered-table list "a mechanical follow-up." It has both
--    id and organisation_id, so it qualifies as-is; no new columns needed. Written
--    as its own small DO block against just this one table rather than re-running
--    the full 21-table loop, so the diff doesn't re-touch triggers that already work.
-- 2. "Result viewed" had no equivalent to log_patient_record_view
--    (20260812034612_clinician_patient_record_view_audit.sql) — that migration
--    covered opening a patient's chart, not opening a specific result document.
--    Same pattern, same RPC-called-after-the-read shape (a trigger can't fire on
--    SELECT, as that migration's header explains).
-- 3. No login audit event existed anywhere — confirmed by grepping for
--    login+audit/log across every migration. auth.users already has a working
--    precedent for a trigger on it (on_auth_user_created, 20260705211044). This
--    adds the update-side equivalent, firing only when last_sign_in_at actually
--    changes (a genuine new session, not any other auth.users write) and only for
--    a non-patient profile — patient logins aren't part of "clinician audit."
--    auth.uid() is not reliable inside this trigger (GoTrue's own internal write
--    to auth.users has no end-user JWT claims set), so the actor is NEW.id
--    directly, not a session lookup.

do $$
begin
  drop trigger if exists audit_row_change_trg on public.specialist_referrals;
  create trigger audit_row_change_trg
    after insert or update or delete on public.specialist_referrals
    for each row execute function private.audit_row_change();
end $$;

create or replace function public.log_result_document_viewed(p_document_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_patient_id uuid;
begin
  select organisation_id, patient_id into v_org, v_patient_id
  from public.lab_result_documents where id = p_document_id;

  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, auth.uid(), 'clinician.result_document_viewed', 'lab_result_document', p_document_id,
    jsonb_build_object('patient_id', v_patient_id)
  );
end;
$$;

comment on function public.log_result_document_viewed(uuid) is
  'Logs a clinician/doctor opening a specific lab_result_documents row. Same shape as '
  'log_patient_record_view (20260812034612) — call after confirming the document loaded, not before.';

revoke all on function public.log_result_document_viewed(uuid) from public;
grant execute on function public.log_result_document_viewed(uuid) to authenticated;
revoke execute on function public.log_result_document_viewed(uuid) from anon;

create or replace function private.log_clinician_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_org  uuid;
begin
  if old.last_sign_in_at is not distinct from new.last_sign_in_at then
    return new;
  end if;

  select role, organisation_id into v_role, v_org
  from public.profiles where id = new.id;

  if v_role is null or v_role = 'patient' then
    return new;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, new.id, 'clinician.logged_in', 'profile', new.id, '{}'::jsonb);

  return new;
end;
$$;

drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login
  after update on auth.users
  for each row execute function private.log_clinician_login();

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if (
    select count(*) from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'specialist_referrals'
      and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) <> 1 then
    raise exception 'audit_row_change_trg missing or duplicated on public.specialist_referrals';
  end if;

  if has_function_privilege('anon', 'public.log_result_document_viewed(uuid)', 'EXECUTE') then
    raise exception 'log_result_document_viewed is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.log_result_document_viewed(uuid)', 'EXECUTE') then
    raise exception 'log_result_document_viewed is NOT EXECUTE-able by authenticated — grant failed';
  end if;

  if not exists (
    select 1 from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
      and tg.tgname = 'on_auth_user_login' and not tg.tgisinternal
  ) then
    raise exception 'on_auth_user_login trigger was not created';
  end if;
end $$;
