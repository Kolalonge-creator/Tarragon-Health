-- S39g: staff WRITES on the tied patient tables need the same relationship as reads (OQ-279, founder 2026-10-07; INV-12). S39b tied the read side of 128 tables;
-- an untied staff member could still INSERT, UPDATE or DELETE rows by policy (they could not read the result back). This closes that.
--   * private.staff_may_write(patient, organisation, category): true for an ACTIVE CLINICIAN who is tied to the patient (care team, open escalation or alert, live
--     consultation, active task, post-consult window, assigned referral) or holds a live S39c opening (open_patient_record, 8 hours, never reproductive_health).
--     Not for a care coordinator (logistics only, no clinical writes), not for an admin, not for a break-glass grant or a support view (both are read only).
--   * The write policies (INSERT, UPDATE, DELETE) of the tied tables that used private.is_org_staff(organisation_id) now use staff_may_write. The old policy text is saved
--     in staff_read_policy_backup first. Server functions and triggers (SECURITY DEFINER) are unaffected: they were never subject to these policies.
--   * Kill switch: platform_modules key tied_staff_writes. Off = the old organisation-wide write at once. private.is_org_staff is NOT edited.
-- Workflow note: a clinician opens the patient (the chart does it, or the shared worklist link goes through the chart) and then acts; the opening lasts 8 hours.
-- No data is changed. Applied with the version pinned to this filename.

insert into public.platform_modules (key, label, description, is_enabled, enabled_at, enabled_by, activation_note)
select 'tied_staff_writes', 'Staff write patient records only through a care relationship or a logged opening',
       'S39g (INV-12). On: writes to the tied patient tables need a tie or a live opening. Off: the old organisation-wide write.',
       true, now(), (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1), 'S39g migration: on from the start, off is the instant rollback'
on conflict (key) do nothing;

create function private.tied_staff_writes_on() returns boolean language sql stable security definer set search_path = '' as
$$ select coalesce((select is_enabled from public.platform_modules where key = 'tied_staff_writes'), true) $$;
revoke all on function private.tied_staff_writes_on() from public, anon, authenticated;

create function private.staff_may_write(p_patient uuid, p_org uuid, p_category public.care_access_category) returns boolean
language sql stable security definer set search_path = '' as
$$
  select case
    when not private.tied_staff_writes_on() then private.is_org_staff(p_org)
    when not exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'clinician' and pr.is_active and pr.organisation_id = p_org
                       and exists (select 1 from public.clinical_staff cs where cs.profile_id = pr.id and cs.active)) then false
    else private.clinician_has_patient_access(p_patient) or private.staff_has_open(p_patient, p_category)
  end
$$;
revoke all on function private.staff_may_write(uuid, uuid, public.care_access_category) from public, anon;
grant execute on function private.staff_may_write(uuid, uuid, public.care_access_category) to authenticated;

do $do$
declare
  s record; p record; v_new_q text; v_new_c text; v_n integer := 0; v_old constant text := 'private.is_org_staff(organisation_id)'; v_call text;
begin
  for s in select * from public.staff_read_scope where mode = 'tied' loop
    v_call := format('private.staff_may_write(%s, organisation_id, %L::public.care_access_category)', s.patient_expr, s.category::text);
    for p in select * from pg_policies where schemaname = 'public' and tablename = s.table_name and cmd in ('INSERT', 'UPDATE', 'DELETE')
              and (coalesce(qual, '') like '%' || v_old || '%' or coalesce(with_check, '') like '%' || v_old || '%') loop
      insert into public.staff_read_policy_backup (table_name, policy_name, cmd, roles, qual, with_check)
      values (p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ','), p.qual, p.with_check) on conflict do nothing;
      v_new_q := case when p.qual is null then null else replace(p.qual, v_old, v_call) end;
      v_new_c := case when p.with_check is null then null else replace(p.with_check, v_old, v_call) end;
      execute format('alter policy %I on public.%I %s %s', p.policyname, p.tablename,
                     case when v_new_q is not null then 'using (' || v_new_q || ')' else '' end,
                     case when v_new_c is not null then 'with check (' || v_new_c || ')' else '' end);
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice 'S39g rewrote % write policies', v_n;
end $do$;

do $$
declare v_left integer;
begin
  select count(*) into v_left from pg_policies pp join public.staff_read_scope s on s.table_name = pp.tablename and s.mode = 'tied'
   where pp.schemaname = 'public' and pp.cmd in ('INSERT', 'UPDATE', 'DELETE')
     and (coalesce(pp.qual, '') like '%private.is_org_staff(organisation_id)%' or coalesce(pp.with_check, '') like '%private.is_org_staff(organisation_id)%');
  if v_left <> 0 then raise exception 'S39g: % tied write policies still use the plain organisation-wide staff check', v_left; end if;
  if not exists (select 1 from public.platform_modules where key = 'tied_staff_writes' and is_enabled) then raise exception 'S39g: the switch is not on'; end if;
  if has_function_privilege('anon', 'private.staff_may_write(uuid,uuid,public.care_access_category)', 'EXECUTE') then raise exception 'S39g: anon can execute'; end if;
end $$;
