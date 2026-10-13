-- Signing function for the point-of-care panels (urinalysis dipstick, HbA1c). poc_panel_versions has no UPDATE grant and, until now,
-- no function that records the CMO's approval, so approved_at could never be set and no point-of-care result could auto-release.
-- Mirrors public.sign_lab_panels: only the active Chief Medical Officer, one approval stamps that version and an audit row is written.
-- It signs nothing by itself: the CMO calls it for a version they have reviewed. Counts before: 2 versions, 0 approved (live 2026-10-13).

create function public.sign_poc_panels(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_ver public.poc_panel_versions%rowtype;
begin
  select * into v_ver from public.poc_panel_versions where id = p_id;
  if not found then raise exception 'point-of-care panel version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the point-of-care panels'; end if;
  if not v_ver.is_active then raise exception 'only the active version of a point-of-care panel can be signed'; end if;
  if v_ver.approved_at is not null then raise exception 'this point-of-care panel version is already signed'; end if;
  update public.poc_panel_versions set approved_by = v_staff, approved_at = now() where id = p_id;
  perform private.log_audit('poc_panels.signed', 'poc_panel_versions', p_id, jsonb_build_object('panel_code', v_ver.panel_code, 'version', v_ver.version));
  return p_id;
end;
$$;

revoke all on function public.sign_poc_panels(uuid) from public, anon;
grant execute on function public.sign_poc_panels(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sign_poc_panels(uuid)', 'EXECUTE') then raise exception 'self-check: anon can execute sign_poc_panels'; end if;
  if exists (select 1 from public.poc_panel_versions where approved_at is not null) then
    raise exception 'self-check: nothing may be signed by this migration';
  end if;
end $$;
