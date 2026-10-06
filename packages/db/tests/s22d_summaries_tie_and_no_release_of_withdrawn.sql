-- S22d proof: consultation_patient_summaries is readable by staff only through a real relationship with the patient (INV-12), and a
-- withdrawn note can be neither requested nor released (migration *_s22d_summaries_tie_and_no_release_of_withdrawn.sql).
-- SABOTAGE: the old org-wide summaries policy and the release without the withdrawn check; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.mktask(p_patient uuid, p_type text, p_due integer default null) returns uuid language sql as
$$ select private.create_clinical_task(p_patient, p_type, p_due) $$;
-- fixture cleanup without deleting (the logs are append only): end any live claim and cancel what is left
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.state_of(p_task uuid) returns text language sql as $$ select state::text from public.clinical_tasks where id = p_task $$;
create function pg_temp.score_of(p_uid uuid) returns text language sql as $$ select reliability_score::text from public.clinical_staff where profile_id = p_uid $$;




-- S22b helpers
create function pg_temp.staff_of(p_uid uuid) returns uuid language sql as $$ select id from public.clinical_staff where profile_id = p_uid $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.submit(p_uid uuid, p_q text, p_client uuid default null) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.submit_written_question(%L, %L, null, %L)::text', 'symptom', p_q, p_client)) $$;
create function pg_temp.queue_as(p_uid uuid, p_types text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute format('select public.queue_next(%s)', p_types) into r; exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;



create function pg_temp.consult_of(p_patient uuid) returns uuid language sql as
$$ select id from public.async_consults where patient_id = p_patient order by created_at desc limit 1 $$;


-- a signed note authored by the given clinician for the patient, using the real functions
create function pg_temp.signed_note(p_doc uuid, p_patient uuid, p_protected boolean default false) returns uuid language plpgsql as
$f$ declare v_note uuid; v_r text;
begin
  perform pg_temp.act(p_doc);
  v_note := public.create_encounter_note(p_patient, 'phone', 'S22 proof note');
  if p_protected then perform public.set_note_protected(v_note, true); end if;
  perform public.update_encounter_note_draft(v_note, '{"assessment":"Reviewed the readings together.","plan":"Continue as planned."}'::jsonb);
  perform public.finalize_encounter_note(v_note, 'continue_monitoring', true);
  perform pg_temp.back();
  return v_note;
end $f$;




-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', 'medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc'));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc2'));
  perform pg_temp.setf('np', pg_temp.mkuser(v_org, 'np', 'patient'));
  perform pg_temp.setf('pat', pg_temp.f('np'));
end $$;

-- 1. Summaries -------------------------------------------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_admin uuid := pg_temp.f('admin'); v_np uuid := pg_temp.f('np');
  v_org uuid := pg_temp.f('org'); n1 uuid; t1 uuid;
begin
  perform pg_temp.clear_queue();
  t1 := pg_temp.mktask(v_np, 'async_question');
  perform pg_temp.ck('the author holds a claim on the patient', t1::text, pg_temp.next_task(v_doc)::text);
  n1 := pg_temp.signed_note(v_doc, v_np);
  insert into public.consultation_patient_summaries (organisation_id, patient_id, clinical_encounter_note_id, what_we_discussed, published_by_staff)
  values (v_org, v_np, n1, 'We talked through your readings and the plan.', pg_temp.staff_of(v_doc));
  perform pg_temp.ck('the patient reads their own summary', '1', pg_temp.q_as(v_np, 'select count(*)::text from public.consultation_patient_summaries'));
  perform pg_temp.ck('the clinician tied to the patient reads it', '1', pg_temp.q_as(v_doc, 'select count(*)::text from public.consultation_patient_summaries'));
  perform pg_temp.ck('a clinician with no tie to the patient reads nothing', '0', pg_temp.q_as(v_doc2, 'select count(*)::text from public.consultation_patient_summaries'));
  perform pg_temp.ck('an admin account with no tie reads nothing', '0', pg_temp.q_as(v_admin, 'select count(*)::text from public.consultation_patient_summaries'));
  perform pg_temp.ck('only one select policy exists', '1', (select count(*)::text from pg_policies where tablename = 'consultation_patient_summaries' and cmd = 'SELECT'));
  perform pg_temp.setf('n1', n1);
end $$;

-- 2. A withdrawn note cannot be requested or released -------------------------------------------------------------------
do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_np uuid := pg_temp.f('np'); nw uuid; nr uuid; ok uuid;
begin
  nw := pg_temp.signed_note(v_doc, v_np);
  nr := pg_temp.signed_note(v_doc, v_np);
  ok := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.setf('nw', nw); perform pg_temp.setf('nr', nr); perform pg_temp.setf('ok', ok);
  perform pg_temp.ck('a normal note can be requested', 'ok', pg_temp.try_as(v_np, format('select public.request_note_release(%L)', ok)));
  perform pg_temp.ck('...and released (the gate opens)', 'ok', pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', ok)));
  -- a note requested, then withdrawn before anyone answered
  perform pg_temp.ck('a request is made on a note', 'ok', pg_temp.try_as(v_np, format('select public.request_note_release(%L)', nr)));
  perform pg_temp.ck('the note is then withdrawn', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered on the wrong patient chart')$q$, nr)));
  perform pg_temp.ck('a clinician cannot release a withdrawn note', 'note_withdrawn_cannot_release',
    pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', nr)));
  perform pg_temp.ck('...or withhold one with a reason (it no longer stands)', 'note_withdrawn_cannot_release',
    pg_temp.try_as(v_doc, format($q$select public.decide_note_release(%L, false, 'No longer relevant to this patient')$q$, nr)));
  -- a note withdrawn before any request
  perform pg_temp.ck('a second note is withdrawn', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered before the visit happened')$q$, nw)));
  perform pg_temp.ck('the patient cannot ask to open it', 'true',
    (pg_temp.try_as(v_np, format('select public.request_note_release(%L)', nw)) like 'not found%')::text);
  perform pg_temp.ck('no release row was created for it', '0', (select count(*)::text from public.note_releases where note_id = nw));
  perform pg_temp.ck('the author was not told a patient asked to open a withdrawn note', '0',
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'note_release_requested' and payload ->> 'note_id' = nw::text));
end $$;

-- 3. SABOTAGE: the old org-wide summaries policy and the release without the withdrawn check -------------------------
drop policy consultation_patient_summaries_select on public.consultation_patient_summaries;
create policy consultation_patient_summaries_select on public.consultation_patient_summaries
  for select to authenticated using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create or replace function public.decide_note_release(p_note uuid, p_release boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.clinical_encounter_notes%rowtype;
begin
  perform private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note and status = 'finalized';
  insert into public.note_releases (organisation_id, note_id, patient_id, state, decided_at, decided_by, is_test)
  values (n.organisation_id, n.id, n.patient_id, 'released', now(), (select auth.uid()), n.is_test)
  on conflict (note_id) do update set state = 'released', decided_at = now(), decided_by = (select auth.uid());
end $$;

do $$
declare v_doc uuid := pg_temp.f('doc'); v_admin uuid := pg_temp.f('admin'); nw uuid := pg_temp.f('nw');
begin
  insert into results values ('sabotaged', 'an admin account with no tie reads nothing', '0', pg_temp.q_as(v_admin, 'select count(*)::text from public.consultation_patient_summaries'));
  insert into results values ('sabotaged', 'a clinician cannot release a withdrawn note', 'refused',
    case when pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', nw)) = 'ok' then 'allowed' else 'refused' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S22d proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
