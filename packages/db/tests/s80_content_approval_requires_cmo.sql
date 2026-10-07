-- S80 fix-first: patient-facing health education content cannot be approved
-- by an ordinary admin, and no transition reaches published without review.
-- Fixtures built here; wrapped in BEGIN/ROLLBACK. Ends with a sabotage step
-- that restores the old function and shows the same attempt would succeed.
begin;

do $$
declare
  v_org uuid;
  v_admin uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_mo uuid := gen_random_uuid();
  v_cat public.health_education_category;
  v_c uuid;
  v_ok boolean;
  v_flag boolean;
  v_hist int;
  v_verifier uuid;
begin
  select id into v_org from public.organisations limit 1;
  select category into v_cat from public.health_education_content limit 1;
  if v_org is null or v_cat is null then raise exception 'fixture missing: organisation or content category'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 's80-admin@example.invalid','x',now(),'{}','{}'),
         (v_cmo,   's80-cmo@example.invalid','x',now(),'{}','{}'),
         (v_mo,    's80-mo@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name='S80 Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name='S80 CMO', is_test = true where id = v_cmo;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name='S80 MO', is_test = true where id = v_mo;
  v_verifier := v_admin;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'S80 CMO', 'chief_medical_officer', true, 'MDCN', 'S80-CMO-1', true, v_verifier, v_verifier, now()),
         (v_mo,  v_org, 'S80 MO', 'medical_officer', true, 'MDCN', 'S80-MO-1', true, v_verifier, v_verifier, now());

  insert into public.health_education_content (code, title, body, category)
  values ('s80-proof-1','S80 proof','body',v_cat) returning id into v_c;
  update public.health_education_content set content_status = 'draft' where id = v_c;

  -- helper: run the RPC as a session, return true if it succeeded
  create temp table _r (who text, step text, ok boolean) on commit drop;
  grant all on _r to authenticated;

  -- CONTROL: admin may move draft -> clinical_review
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'clinical_review'); insert into _r values('admin','draft>review',true);
  exception when others then insert into _r values('admin','draft>review',false); end;
  -- GATE: admin may NOT approve
  begin perform public.set_health_education_content_status(v_c,'approved'); insert into _r values('admin','approve',true);
  exception when others then insert into _r values('admin','approve',false); end;
  reset role;

  -- GATE: a non-CMO clinician may not touch it at all
  perform set_config('request.jwt.claims', json_build_object('sub', v_mo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'approved'); insert into _r values('mo','approve',true);
  exception when others then insert into _r values('mo','approve',false); end;
  reset role;

  -- CONTROL: CMO (a clinician login, not admin) approves
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'approved'); insert into _r values('cmo','approve',true);
  exception when others then insert into _r values('cmo','approve',false); end;
  reset role;

  select clinician_reviewed into v_flag from public.health_education_content where id = v_c;
  if v_flag is not true then raise exception 'FAIL: CMO approval did not stamp clinician_reviewed'; end if;

  -- CONTROL: admin may publish an approved item
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'published'); insert into _r values('admin','approved>published',true);
  exception when others then insert into _r values('admin','approved>published',false); end;
  -- then to review_due (control), and admin may NOT re-affirm it
  begin perform public.set_health_education_content_status(v_c,'review_due'); insert into _r values('admin','published>review_due',true);
  exception when others then insert into _r values('admin','published>review_due',false); end;
  begin perform public.set_health_education_content_status(v_c,'published'); insert into _r values('admin','review_due>published',true);
  exception when others then insert into _r values('admin','review_due>published',false); end;
  reset role;
  -- CMO may re-affirm
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'published'); insert into _r values('cmo','review_due>published',true);
  exception when others then insert into _r values('cmo','review_due>published',false); end;
  reset role;

  -- GATE: draft -> published shortcut gone, even for the CMO
  update public.health_education_content set content_status='draft' where id = v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'published'); insert into _r values('cmo','draft>published',true);
  exception when others then insert into _r values('cmo','draft>published',false); end;
  reset role;
  -- GATE: updated -> published shortcut gone
  update public.health_education_content set content_status='updated' where id = v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_c,'published'); insert into _r values('admin','updated>published',true);
  exception when others then insert into _r values('admin','updated>published',false); end;
  reset role;

  for v_ok in select ok from _r where (who,step) in (('admin','draft>review'),('cmo','approve'),('admin','approved>published'),('admin','published>review_due'),('cmo','review_due>published')) loop
    if not v_ok then raise exception 'FAIL: a control (gate should open) was refused'; end if;
  end loop;
  if exists (select 1 from _r where ok and (who,step) in (('admin','approve'),('mo','approve'),('admin','review_due>published'),('cmo','draft>published'),('admin','updated>published'))) then
    raise exception 'FAIL: a gated transition succeeded: %', (select string_agg(who||':'||step, ', ') from _r where ok and (who,step) in (('admin','approve'),('mo','approve'),('admin','review_due>published'),('cmo','draft>published'),('admin','updated>published')));
  end if;
  select count(*) into v_hist from public.health_education_content_status_history where content_id = v_c;
  if v_hist < 5 then raise exception 'FAIL: expected status history rows, got %', v_hist; end if;
  raise notice 'PASS: approval needs the CMO; draft/updated cannot skip review; controls open';

  -- SABOTAGE: restore the pre-fix gate (admin only, approve unrestricted,
  -- draft>published allowed) and prove the same attempts now succeed, i.e.
  -- the checks above discriminate.
  create or replace function public.set_health_education_content_status(p_content_id uuid, p_new_status public.health_education_content_status, p_note text default null)
  returns public.health_education_content_status language plpgsql security definer set search_path = '' as $f$
  begin
    if not private.is_admin() then raise exception 'admin only'; end if;
    update public.health_education_content set content_status = p_new_status where id = p_content_id;
    return p_new_status;
  end $f$;
  update public.health_education_content set content_status='clinical_review' where id = v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_health_education_content_status(v_c,'approved');
  perform public.set_health_education_content_status(v_c,'published');
  reset role;
  raise notice 'PASS: sabotage confirmed, the old function lets an admin approve and publish';
end $$;

rollback;
