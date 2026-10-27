-- S80 gap closure (25.1): dual key, automatic needs-re-review, translation reset, review backlog, F1 expiry refusal restored.
-- Fixtures built here; wrapped in BEGIN/ROLLBACK. Ends with a sabotage step (flag trigger dropped -> an edit no longer flags).
-- Not run against any database when written (no local Supabase stack was available); run it on the CI replay stack.
begin;

do $$
declare
  v_org uuid;
  v_admin uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_cmo2 uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_cat public.health_education_category;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_pub_unrev uuid;
  v_ok boolean;
  v_flag boolean;
  v_state public.translation_state;
  v_n int;
  v_future date := ((now() at time zone 'Africa/Lagos')::date + 40);
begin
  select id into v_org from public.organisations limit 1;
  select category into v_cat from public.health_education_content limit 1;
  if v_org is null or v_cat is null then raise exception 'fixture missing: organisation or content category'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 's80dk-admin@example.invalid','x',now(),'{}','{}'),
         (v_cmo,   's80dk-cmo@example.invalid','x',now(),'{}','{}'),
         (v_patient,'s80dk-pt@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name='S80DK Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name='S80DK CMO', is_test = true where id = v_cmo;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name='S80DK Patient', is_test = true where id = v_patient;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'S80DK CMO', 'chief_medical_officer', true, 'MDCN', 'S80DK-CMO-1', true, v_admin, v_admin, now());

  -- a SECOND active CMO exists, so the author cannot approve (the sole-reviewer exception is tested further down)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_cmo2, 's80dk-cmo2@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name='S80DK CMO Two', is_test = true where id = v_cmo2;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo2, v_org, 'S80DK CMO Two', 'chief_medical_officer', true, 'MDCN', 'S80DK-CMO-2', true, v_admin, v_admin, now());

  create temp table _r (step text, ok boolean) on commit drop;
  grant all on _r to authenticated;

  -- fixtures (postgres session: no auth.uid, so authored_by / last_edited_by are exactly what is set here)
  insert into public.health_education_content (code, title, body, category, reviewed_by_name, source_reference, next_review_due, self_care_action, authored_by, last_edited_by)
  values ('s80dk-a','A authored by the CMO','body',v_cat,'Dr Proof','src',v_future,'Take one step.', v_cmo, v_cmo) returning id into v_a;
  insert into public.health_education_content (code, title, body, category, reviewed_by_name, source_reference, next_review_due, self_care_action, authored_by, last_edited_by)
  values ('s80dk-b','B authored by the admin','body',v_cat,'Dr Proof','src',v_future,'Take one step.', v_admin, v_admin) returning id into v_b;
  insert into public.health_education_content (code, title, body, category, reviewed_by_name, source_reference, next_review_due, self_care_action, authored_by, last_edited_by, safety_relevant)
  values ('s80dk-c','C CMO-authored, not safety relevant','body',v_cat,'Dr Proof','src',v_future,'Take one step.', v_cmo, v_cmo, false) returning id into v_c;
  insert into public.health_education_content (code, title, body, category, reviewed_by_name, source_reference, next_review_due, self_care_action, clinical_author_name)
  values ('s80dk-d','D legacy row named author','body',v_cat,'Dr Proof','src',v_future,'Take one step.', 'S80DK CMO') returning id into v_d;
  insert into public.health_education_content (code, title, body, category, reviewed_by_name, source_reference, next_review_due, self_care_action, authored_by, last_edited_by)
  values ('s80dk-e','E edited last by the CMO','body',v_cat,'Dr Proof','src',v_future,'Take one step.', v_admin, v_cmo) returning id into v_e;
  insert into public.health_education_content (code, title, body, category, reviewed_by_name, source_reference, next_review_due, self_care_action, authored_by, last_edited_by)
  values ('s80dk-f','F expired review date','body',v_cat,'Dr Proof','src',v_future,'Take one step.', v_admin, v_admin) returning id into v_f;
  update public.health_education_content set content_status = 'clinical_review' where id in (v_a, v_b, v_c, v_d, v_e, v_f);

  -- a live published item that was never clinician reviewed (the 213-row shape), inserted as the postgres session
  -- the live rows of this shape were written before the publish guard existed, so build it with triggers off for this one insert
  set local session_replication_role = replica;
  insert into public.health_education_content (code, title, body, category, content_status, clinician_reviewed)
  values ('s80dk-unrev','Published, never reviewed','body',v_cat,'published',false) returning id into v_pub_unrev;
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  -- GATES: the CMO cannot approve what she authored (A), last edited (E), or is named as clinical author of (D)
  begin perform public.set_health_education_content_status(v_a,'approved'); insert into _r values('cmo approves own authored',true);
  exception when others then insert into _r values('cmo approves own authored',false); end;
  begin perform public.set_health_education_content_status(v_e,'approved'); insert into _r values('cmo approves last-edited',true);
  exception when others then insert into _r values('cmo approves last-edited',false); end;
  begin perform public.set_health_education_content_status(v_d,'approved'); insert into _r values('cmo approves named author',true);
  exception when others then insert into _r values('cmo approves named author',false); end;
  -- CONTROLS: B (someone else's), C (safety_relevant = false)
  begin perform public.set_health_education_content_status(v_b,'approved'); insert into _r values('cmo approves others',true);
  exception when others then insert into _r values('cmo approves others',false); end;
  begin perform public.set_health_education_content_status(v_c,'approved'); insert into _r values('cmo approves non-safety own',true);
  exception when others then insert into _r values('cmo approves non-safety own',false); end;
  -- F1 regression: an expired review date blocks publishing
  begin perform public.set_health_education_content_status(v_f,'approved'); exception when others then null; end;
  reset role;
  update public.health_education_content set next_review_due = (now() at time zone 'Africa/Lagos')::date - 1 where id = v_f;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_f,'published'); insert into _r values('publish with past review date',true);
  exception when others then insert into _r values('publish with past review date',false); end;
  reset role;

  if exists (select 1 from _r where ok and step in ('cmo approves own authored','cmo approves last-edited','cmo approves named author','publish with past review date')) then
    raise exception 'FAIL: a gated approval succeeded: %', (select string_agg(step, ', ') from _r where ok and step in ('cmo approves own authored','cmo approves last-edited','cmo approves named author','publish with past review date'));
  end if;
  if exists (select 1 from _r where not ok and step in ('cmo approves others','cmo approves non-safety own')) then
    raise exception 'FAIL: a control (gate should open) was refused';
  end if;
  raise notice 'PASS: dual key refuses author, last editor and named author; others and non-safety content open; expired date refuses publish';

  -- SOLE-REVIEWER EXCEPTION: with the second CMO gone, the lone CMO may approve her own authored item, and it is recorded
  update public.clinical_staff set active = false where profile_id = v_cmo2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_health_education_content_status(v_a,'approved'); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if not v_ok then raise exception 'FAIL: the only active CMO could not approve her own item'; end if;
  if not exists (select 1 from public.health_education_content_status_history h where h.content_id = v_a and h.to_status = 'approved' and h.note like 'Sole-reviewer exception%') then
    raise exception 'FAIL: the sole-reviewer approval was not written into the status history';
  end if;
  if not exists (select 1 from public.audit_log where action = 'content.sole_reviewer_approval' and entity_id = v_a) then
    raise exception 'FAIL: the sole-reviewer approval was not audited';
  end if;
  update public.clinical_staff set active = true where profile_id = v_cmo2;
  raise notice 'PASS: the only active CMO may approve her own item, and it is recorded in history and audit';

  -- NEEDS RE-REVIEW: publish B (admin), admin edits its body, translations drop to draft, admin cannot clear the flag
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_health_education_content_status(v_b,'published');
  reset role;
  insert into public.translations (key, language, text, is_clinical, state, source_hash, reviewed_by, reviewed_at)
  values ('health_education_content.' || v_b || '.body', 'yo', 'x', true, 'clinical_reviewed', 'hash-aaaa-1111', v_cmo, now()),
         ('health_education_content.' || v_a || '.body', 'yo', 'x', true, 'clinical_reviewed', 'hash-aaaa-2222', v_cmo, now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.health_education_content set body = 'body changed after approval' where id = v_b;
  reset role;
  select needs_re_review into v_flag from public.health_education_content where id = v_b;
  if v_flag is not true then raise exception 'FAIL: editing published text did not set needs_re_review'; end if;
  select state into v_state from public.translations where key = 'health_education_content.' || v_b || '.body';
  if v_state <> 'draft' then raise exception 'FAIL: the translation of the edited item was not reset to draft (%)', v_state; end if;
  select state into v_state from public.translations where key = 'health_education_content.' || v_a || '.body';
  if v_state <> 'clinical_reviewed' then raise exception 'FAIL: an unrelated item''s translation was reset'; end if;
  if (select content_status from public.health_education_content where id = v_b) <> 'published' then raise exception 'FAIL: the flag must not hide or unpublish the item'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.health_education_content set needs_re_review = false where id = v_b;
  reset role;
  select needs_re_review into v_flag from public.health_education_content where id = v_b;
  if v_flag is not true then raise exception 'FAIL: an admin cleared needs_re_review with a table write'; end if;
  if (select last_edited_by from public.health_education_content where id = v_b) <> v_admin then raise exception 'FAIL: last_edited_by not stamped'; end if;
  -- the author cannot be rewritten from the client
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.health_education_content set authored_by = v_cmo where id = v_b;
  reset role;
  if (select authored_by from public.health_education_content where id = v_b) <> v_admin then raise exception 'FAIL: authored_by was rewritten by a client'; end if;
  raise notice 'PASS: edit flags, resets own translations only, does not hide, flag and author cannot be rewritten by a client';

  -- CMO re-approval clears the flag (B was last edited by the admin, so the CMO is a second key)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_health_education_content_status(v_b,'updated');
  perform public.set_health_education_content_status(v_b,'clinical_review');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_health_education_content_status(v_b,'approved');
  reset role;
  select needs_re_review into v_flag from public.health_education_content where id = v_b;
  if v_flag then raise exception 'FAIL: CMO approval did not clear needs_re_review'; end if;
  raise notice 'PASS: CMO approval clears the flag';

  -- BACKLOG
  -- approval and publishing normally go through set_health_education_content_status; this fixture state is set directly, past that trigger
  set local session_replication_role = replica;
  update public.health_education_content set content_status = 'published', next_review_due = v_future where id = v_b;
  set local session_replication_role = origin;
  update public.health_education_content set body = 'edited again' where id = v_b;   -- postgres session edit of a published row
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.content_review_backlog() where content_id = v_b and backlog_kind = 'needs_re_review';
  if v_n <> 1 then raise exception 'FAIL: CMO backlog did not list the flagged item (%)', v_n; end if;
  select count(*) into v_n from public.content_review_backlog() where content_id = v_pub_unrev and backlog_kind = 'never_reviewed';
  if v_n <> 1 then raise exception 'FAIL: CMO backlog did not list the never-reviewed published item'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform 1 from public.content_review_backlog() limit 1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from public.content_review_backlog() limit 1; v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: a patient read the content review backlog'; end if;
  set local role anon;
  begin perform 1 from public.content_review_backlog() limit 1; v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: anon read the content review backlog'; end if;
  -- the backlog never changed a status: the unreviewed published row is still published and unreviewed
  if (select content_status from public.health_education_content where id = v_pub_unrev) <> 'published'
     or (select clinician_reviewed from public.health_education_content where id = v_pub_unrev) then
    raise exception 'FAIL: the backlog changed the status of an unreviewed item';
  end if;
  raise notice 'PASS: backlog lists flagged and never-reviewed items for the CMO and admin, refuses patient and anon, changes nothing';

  -- SABOTAGE: drop the flag trigger; the same edit no longer flags (the check above discriminates)
  drop trigger health_education_content_track_source on public.health_education_content;
  update public.health_education_content set needs_re_review = false, needs_re_review_since = null where id = v_b;
  update public.health_education_content set body = 'edited with no trigger' where id = v_b;
  select needs_re_review into v_flag from public.health_education_content where id = v_b;
  if v_flag then raise exception 'FAIL: sabotage did not remove the flagging'; end if;
  raise notice 'PASS: sabotage confirmed, without the trigger an edit leaves the item unflagged';
end $$;

rollback;
