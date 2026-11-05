-- Tarragon Health: an audit_log row written from a signed-in user's session always names that user as the actor.
--
-- Security audit 2026-11-05, finding M-9. audit_log_insert let org staff insert rows with ANY actor_id (another
-- person's id, or null) for their organisation, so a staff session could write entries attributed to someone else.
--
-- Fix: a BEFORE INSERT trigger on rows written directly by the `authenticated` role fills a missing actor_id with
-- auth.uid() (some callers pass null) and REFUSES a row naming anyone else, so a forgery is an error, never silently
-- rewritten (an existing proof, prescription_pdf_license_flag_and_download_audit.sql, already expects the refusal).
-- Rows written by SECURITY DEFINER functions (current_user is the function owner) and by the service role keep the
-- actor they name, since that is server code choosing it. The policy below then holds for every authenticated row.

create or replace function private.audit_log_actor_is_session_user()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if current_user = 'authenticated' then
    if new.actor_id is null then
      new.actor_id := (select auth.uid());
    elsif new.actor_id is distinct from (select auth.uid()) then
      raise exception 'An audit entry can only name the signed-in user as its actor.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_actor_is_session_user on public.audit_log;
create trigger audit_log_actor_is_session_user
  before insert on public.audit_log
  for each row execute function private.audit_log_actor_is_session_user();

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (actor_id = (select auth.uid()));

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname = 'audit_log_actor_is_session_user') then
    raise exception 'M-9: actor trigger missing';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_insert'
             and with_check !~ 'actor_id = \( SELECT auth\.uid') then
    raise exception 'M-9: audit_log_insert must require actor_id = auth.uid()';
  end if;
end $$;
