-- S15 follow-up, from the founder's decisions on OQ-103, OQ-104 and OQ-108.
--
--  OQ-103  A CMO-approved QA applicant came out as a real-flag clinician (is_test = false) because only an admin may
--          set the flag, so the fake doctor was active, senior tier and routable by case assignment. Approval now
--          carries the application's own flag. The flag on an application is copied from the applicant's profile, which
--          only an admin can mark as a test account, so this lets nobody mint a test row for themselves.
--  OQ-104  A verified phone number can be required to apply. It is a config rule, off for now: no real account has a
--          confirmed phone yet and SMS delivery is not live, so switching it on today would stop every applicant.
--  OQ-108  Documents past their retention date, and documents of rejected applications past a retention period, can be
--          purged, one audited row each. Off until counsel confirms the periods; the periods below are PROPOSED.

-- OQ-103 -----------------------------------------------------------------------------------------------------------

create or replace function private.guard_is_test_flag() returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- auth.uid() is null for service_role, the migration connection and pg_cron: those may set the flag.
  if (select auth.uid()) is null or private.is_admin() then
    return new;
  end if;
  -- The approval function sets this for one clinician record when the application it approves is itself a test
  -- application. It is transaction-local and names the person, so it cannot be reused for anyone else.
  -- (Nested on purpose: this trigger sits on many tables, and only clinical_staff has a profile_id to read.)
  if tg_op = 'INSERT' and tg_table_name = 'clinical_staff' then
    if new.is_test
       and nullif(current_setting('tarragon.credential_carry_test_flag', true), '') = new.profile_id::text then
      return new;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.is_test then
      raise exception '%.is_test can only be set by an admin or a service context', tg_table_name using errcode = '42501';
    end if;
  elsif new.is_test is distinct from old.is_test then
    raise exception '%.is_test can only be changed by an admin or a service context', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approve_clinician_application';
  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;
  v_new := replace(v_new, 'select * into prof from public.profiles where id = a.profile_id;',
    'select * into prof from public.profiles where id = a.profile_id;' || chr(10) ||
    '  perform set_config(''tarragon.credential_carry_test_flag'', case when a.is_test then a.profile_id::text else '''' end, true);');
  v_new := replace(v_new, 'coalesce(a.is_test and private.is_admin(), false))', 'coalesce(a.is_test, false))');
  v_new := replace(v_new, 'returning id into v_staff;',
    'returning id into v_staff;' || chr(10) ||
    '  perform set_config(''tarragon.credential_carry_test_flag'', '''', true);');
  if v_new = v_def or position('credential_carry_test_flag' in v_new) = 0 or position('coalesce(a.is_test, false))' in v_new) = 0 then
    raise exception 'approve_clinician_application did not have the expected text to replace';
  end if;
  execute v_new;
end $$;

-- OQ-104 -----------------------------------------------------------------------------------------------------------

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'start_clinician_application';
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def,
    'if p.phone is null or btrim(p.phone) = '''' then raise exception ''add your phone number first'' using errcode = ''42501''; end if;',
    'if p.phone is null or btrim(p.phone) = '''' then raise exception ''add your phone number first'' using errcode = ''42501''; end if;' || chr(10) ||
    '  if coalesce((private.credential_rule(''require_verified_phone''))::boolean, false) and not p.is_test' || chr(10) ||
    '     and not exists (select 1 from auth.users where id = v_uid and phone_confirmed_at is not null) then' || chr(10) ||
    '    raise exception ''verify your phone number first: sign in once with the code we text you'' using errcode = ''42501''; end if;');
  if v_new = v_def then
    raise exception 'start_clinician_application did not have the expected text to replace';
  end if;
  execute v_new;
end $$;

-- Config version 2: the same rules plus the three new keys. -----------------------------------------------------------
update public.credentialing_config set is_active = false where is_active;
-- credentialing-rules-begin
insert into public.credentialing_config (version, is_active, effective_from, rules) values (2, true, '2026-10-06', $json$
{
  "min_practice_years": 2,
  "pass_percent": 80,
  "all_red_correct": true,
  "audited_task_count": 20,
  "referees_required": 2,
  "referee_independent_contact": true,
  "test_max_attempts": 3,
  "test_retake_cooldown_hours": 24,
  "test_scenarios_per_attempt": 10,
  "notice_windows_days": [90, 30, 0],
  "grace_max_days": 14,
  "separate_verifier_and_approver": true,
  "document_max_bytes": 8388608,
  "document_retention_years_after_offboarding": 7,
  "require_verified_phone": false,
  "document_purge_enabled": false,
  "rejected_application_document_retention_months": 24
}
$json$::jsonb);
-- credentialing-rules-end

-- OQ-108 -----------------------------------------------------------------------------------------------------------

create function private.credential_purge_reason(d public.clinician_documents) returns text
language sql stable
set search_path = ''
as $$
  select case
    when d.retain_until is not null and d.retain_until < current_date
         and not exists (select 1 from public.clinical_staff s
                          where s.profile_id = d.owner_profile_id and s.status in ('active', 'suspended'))
      then 'retention_elapsed'
    when d.clinical_staff_id is null and d.application_id is not null
         and exists (select 1 from public.clinician_applications a where a.id = d.application_id and a.state = 'rejected')
         and (select max(t.created_at) from public.clinician_application_transitions t
               where t.application_id = d.application_id and t.to_state = 'rejected')
             < now() - make_interval(months => coalesce((private.credential_rule('rejected_application_document_retention_months'))::int, 24))
      then 'rejected_application_retention_elapsed'
  end
$$;
revoke all on function private.credential_purge_reason(public.clinician_documents) from public, anon, authenticated;

create function public.credential_documents_due_for_purge(p_limit int default 50)
returns table (document_id uuid, storage_path text, reason text)
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not coalesce((private.credential_rule('document_purge_enabled'))::boolean, false) then
    return;
  end if;
  return query
    select d.id, d.storage_path, private.credential_purge_reason(d)
      from public.clinician_documents d
     where private.credential_purge_reason(d) is not null
     order by d.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create function public.purge_credential_document(p_document uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  d public.clinician_documents%rowtype;
  v_reason text;
  v_opens int;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not coalesce((private.credential_rule('document_purge_enabled'))::boolean, false) then
    raise exception 'document purge is switched off' using errcode = '23514';
  end if;
  select * into d from public.clinician_documents where id = p_document for update;
  if not found then return; end if;
  v_reason := private.credential_purge_reason(d);
  if v_reason is null then raise exception 'this document is not due for purge' using errcode = '23514'; end if;
  select count(*) into v_opens from public.clinician_document_access_log where document_id = d.id;
  -- The audit row keeps the facts that matter (what, whose, why, how often it was opened), not the file or its path.
  perform private.credential_audit(d.organisation_id, null, 'clinician_document.purged', 'clinician_document', d.id,
    jsonb_build_object('kind', d.kind, 'owner_profile_id', d.owner_profile_id, 'reason', v_reason, 'times_opened', v_opens,
                       'retain_until', d.retain_until));
  delete from public.clinician_documents where id = d.id;
end;
$$;

revoke all on function public.credential_documents_due_for_purge(int) from public, anon, authenticated;
revoke all on function public.purge_credential_document(uuid) from public, anon, authenticated;
grant execute on function public.credential_documents_due_for_purge(int) to service_role;
grant execute on function public.purge_credential_document(uuid) to service_role;

-- Proof the new functions are closed to signed-in callers and anon.
do $$
begin
  if has_function_privilege('anon', 'public.credential_documents_due_for_purge(int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.credential_documents_due_for_purge(int)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_credential_document(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_credential_document(uuid)', 'EXECUTE') then
    raise exception 'a purge function is executable by anon or authenticated';
  end if;
end $$;
