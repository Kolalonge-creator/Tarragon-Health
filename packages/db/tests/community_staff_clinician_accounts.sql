-- Community moderation and safety review may be granted to an active clinician account (migration 20261031000005).
--   1. A clinician can be granted moderator and safety_reviewer; a patient account still cannot; only an admin grants.
--   2. Under that clinician's own session, community_staff_context reports moderator and safety reviewer.
--   3. A deactivated clinician reads as neither (the helpers still require an active profile).
--   4. A clinician with no grant reads as neither.
--   SABOTAGE: the staff guard put back to the old care-coordinator-only rule; the clinician grant must then be refused, and the script raises if it is not.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_doc uuid := gen_random_uuid(); v_doc2 uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid();
  v_ctx jsonb; v_caught boolean;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'cscl-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_doc, v_doc2, v_pat]) u;
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values
    (v_admin, v_org, 'admin'::public.user_role, 'Proof admin', true),
    (v_doc, v_org, 'clinician'::public.user_role, 'Proof clinician', true),
    (v_doc2, v_org, 'clinician'::public.user_role, 'Proof clinician without a grant', true),
    (v_pat, v_org, 'patient'::public.user_role, 'Proof patient', true)
  on conflict (id) do update set is_test = true, is_active = true, role = excluded.role, organisation_id = excluded.organisation_id;

  -- 1. grants
  insert into public.community_staff (profile_id, scope, group_id, granted_by) values (v_doc, 'moderator', null, v_admin);
  insert into public.community_staff (profile_id, scope, group_id, granted_by) values (v_doc, 'safety_reviewer', null, v_admin);
  v_caught := false;
  begin insert into public.community_staff (profile_id, scope, group_id, granted_by) values (v_pat, 'moderator', null, v_admin);
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'FAIL 1a: a patient account was granted moderation'; end if;
  v_caught := false;
  begin insert into public.community_staff (profile_id, scope, group_id, granted_by) values (v_doc2, 'moderator', null, v_doc);
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'FAIL 1b: a non-admin granted moderation'; end if;

  -- 2. the clinician's own session
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_doc::text, true);
  set local role authenticated;
  v_ctx := public.community_staff_context();
  reset role;
  if not coalesce((v_ctx ->> 'is_moderator')::boolean, false) then raise exception 'FAIL 2a: granted clinician is not a moderator'; end if;
  if not coalesce((v_ctx ->> 'is_safety_reviewer')::boolean, false) then raise exception 'FAIL 2b: granted clinician is not a safety reviewer'; end if;

  -- 4. ungranted clinician
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc2, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_doc2::text, true);
  set local role authenticated;
  v_ctx := public.community_staff_context();
  reset role;
  if (v_ctx ->> 'is_moderator')::boolean or (v_ctx ->> 'is_safety_reviewer')::boolean then raise exception 'FAIL 4: a clinician with no grant reads as staff'; end if;

  -- 3. deactivated
  update public.profiles set is_active = false where id = v_doc;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_doc::text, true);
  set local role authenticated;
  v_ctx := public.community_staff_context();
  reset role;
  if (v_ctx ->> 'is_moderator')::boolean or (v_ctx ->> 'is_safety_reviewer')::boolean then raise exception 'FAIL 3: a deactivated clinician still reads as staff'; end if;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- sabotage: the old guard rule, a clinician grant must now be refused
  create or replace function private.community_staff_guard() returns trigger language plpgsql set search_path to '' as $f$
  begin
    if tg_op = 'INSERT' and not exists (select 1 from public.profiles where id = new.profile_id and is_active and role = 'care_coordinator') then
      raise exception 'old rule' using errcode = '42501';
    end if;
    return new;
  end $f$;
  update public.profiles set is_active = true where id = v_doc;
  v_caught := false;
  begin insert into public.community_staff (profile_id, scope, group_id, granted_by) values (v_doc2, 'moderator', null, v_admin);
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'FAIL sabotage: the proof did not discriminate'; end if;
end $$;

rollback;
