-- S22c proof: a paid credit returned on a missed window, grant_membership with a nullable end date, and notes withdrawn as
-- entered in error (migration *_s22c_credit_return_nullable_end_withdrawn_notes.sql). Proves in one rolled-back transaction:
--   1. A question paid for with a credit gets the credit back when its window is missed, once, and the patient can spend it again.
--   2. grant_membership(patient, reason, ends_at default null): no end date works, a dated one works, the old argument order is gone.
--   3. Withdrawn notes: author or CMO only (a clinician with a tie who is not the author is refused), a reason is required, a draft
--      cannot be withdrawn, the flag is permanent, the patient sees that the note was withdrawn and why but none of its text, the
--      staff view keeps it with the state, it cannot be amended or disputed, and only a patient who could see it is told.
--   4. SABOTAGE: the credit return turned off and the author-or-CMO rule removed; both checks must flip.
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
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general,on_call,prescribing,result_review,hypertension}', v_admin));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc'));
  perform pg_temp.mkblock(v_org, pg_temp.f('doc2'));
  perform pg_temp.mkblock(v_org, pg_temp.f('cmo'));
  perform pg_temp.setf('pc', pg_temp.mkuser(v_org, 'pc', 'patient'));
  perform pg_temp.setf('pg', pg_temp.mkuser(v_org, 'pg', 'patient'));
  perform pg_temp.setf('np', pg_temp.mkuser(v_org, 'np', 'patient'));
  perform pg_temp.setf('pat', pg_temp.f('np'));
end $$;

-- 1. A paid credit comes back when the window is missed ---------------------------------------------------------------
do $$
declare
  v_pc uuid := pg_temp.f('pc'); v_org uuid := pg_temp.f('org'); c1 uuid; c2 text; v_prod uuid; v_pur uuid;
begin
  select id into v_prod from public.service_products where code = 'async_consult_credit';
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_pc, v_prod, 'active', 250000, 'NGN', now(), now() + interval '90 days') returning id into v_pur;
  perform pg_temp.setf('pur', v_pur);
  perform pg_temp.ck('a non-member with a paid credit can send a written question', 'true',
    (pg_temp.submit(v_pc, 'My knee has been swollen for two days') ~ '^[0-9a-f-]{36}$')::text);
  c1 := pg_temp.consult_of(v_pc);
  perform pg_temp.setf('c1', c1);
  perform pg_temp.ck('...which spends the credit', 'true', ((select redeemed_at from public.service_purchases where id = v_pur) is not null)::text);
  perform pg_temp.ck('...and is marked as paid with a credit', 'true', (select paid_with_credit::text from public.async_consults where id = c1));
  perform pg_temp.ck('with the credit spent, a second question is refused', 'true',
    (pg_temp.submit(v_pc, 'Another question while no credit is left') like 'ERR:Written messages to your care team are part of Membership%')::text);
  update public.async_consults set window_started_at = now() - interval '1500 minutes' where id = c1;
  perform private.sweep_written_question_windows();
  perform pg_temp.ck('a missed window returns the credit', 'false', ((select redeemed_at from public.service_purchases where id = v_pur) is not null)::text);
  perform pg_temp.ck('...clearing all three redemption fields', 'true',
    (select (redeemed_entity_type is null and redeemed_entity_id is null)::text from public.service_purchases where id = v_pur));
  perform pg_temp.ck('...and records the return once', 'true', ((select allowance_returned_at from public.async_consults where id = c1) is not null)::text);
  perform private.sweep_written_question_windows();
  perform pg_temp.ck('a second sweep changes nothing', 'false', ((select redeemed_at from public.service_purchases where id = v_pur) is not null)::text);
  c2 := pg_temp.submit(v_pc, 'Now I can use the returned credit again');
  perform pg_temp.ck('the patient can spend the returned credit on a new question', 'true', (c2 ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.ck('...which spends it again', 'true', ((select redeemed_at from public.service_purchases where id = v_pur) is not null)::text);
end $$;

-- 2. grant_membership with a nullable end date ------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pg uuid := pg_temp.f('pg'); v_np uuid := pg_temp.f('np');
begin
  perform pg_temp.ck('a grant with no end date works (two arguments)', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, 'Pilot member with no end date set')$q$, v_pg)));
  perform pg_temp.ck('...and the patient is a member', 'true', (select private.patient_is_member(v_pg)::text));
  perform pg_temp.ck('a dated grant works with the end date by name', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(p_patient => %L, p_reason => 'Pilot member with an end date', p_ends_at => now() + interval '30 days')$q$, v_np)));
  perform pg_temp.ck('the old argument order no longer exists', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, null::timestamptz, 'The old order of arguments')$q$, pg_temp.f('pc'))) like '%does not exist%')::text);
  perform pg_temp.ck('a past end date is still refused', 'membership_end_in_past',
    pg_temp.try_as(v_admin, format($q$select public.grant_membership(%L, 'Granting with a past end date here', now() - interval '1 day')$q$, pg_temp.f('pc'))));
  perform pg_temp.ck('a patient still cannot grant themselves', 'true',
    (pg_temp.try_as(pg_temp.f('pc'), format($q$select public.grant_membership(%L, 'Granting myself a membership here')$q$, pg_temp.f('pc'))) like 'membership_not_authorised%')::text);
end $$;

-- 3. Notes withdrawn as entered in error --------------------------------------------------------------------------------
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



do $$
declare
  v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_cmo uuid := pg_temp.f('cmo'); v_np uuid := pg_temp.f('np');
  n1 uuid; n2 uuid; n3 uuid; nd uuid; t1 uuid; t2 uuid; t3 uuid; v_before integer;
begin
  perform pg_temp.clear_queue();
  t1 := pg_temp.mktask(v_np, 'async_question');
  perform pg_temp.ck('the author holds a claim on the patient', t1::text, pg_temp.next_task(v_doc)::text);
  t2 := pg_temp.mktask(v_np, 'async_question');
  perform pg_temp.ck('a second clinician holds one too (a tie, but not the author)', t2::text, pg_temp.next_task(v_doc2)::text);
  t3 := pg_temp.mktask(v_np, 'async_question');
  perform pg_temp.ck('the CMO holds one', t3::text, pg_temp.next_task(v_cmo)::text);

  n1 := pg_temp.signed_note(v_doc, v_np);
  n2 := pg_temp.signed_note(v_doc, v_np);
  n3 := pg_temp.signed_note(v_doc, v_np);
  perform pg_temp.act(v_doc);
  nd := public.create_encounter_note(v_np, 'phone', 'S22c proof draft');
  perform pg_temp.back();
  perform pg_temp.ck('a release makes n1 visible to the patient', 'ok', pg_temp.try_as(v_doc, format('select public.decide_note_release(%L, true, null)', n1)));
  perform pg_temp.ck('...and the patient reads its text', 'true',
    (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%Reviewed the readings%')::text);

  perform pg_temp.ck('a clinician with a tie who is not the author cannot withdraw it', 'note_withdraw_author_or_cmo',
    pg_temp.try_as(v_doc2, format($q$select public.mark_note_entered_in_error(%L, 'Entered on the wrong patient chart')$q$, n1)));
  perform pg_temp.ck('a withdrawal needs a real reason', 'note_withdraw_reason_needed',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'oops')$q$, n1)));
  perform pg_temp.ck('a draft cannot be withdrawn', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered on the wrong patient chart')$q$, nd)) like 'only a signed note can be withdrawn%')::text);
  perform pg_temp.ck('the author withdraws a released note', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered on the wrong patient chart')$q$, n1)));
  perform pg_temp.ck('...the flag is stored with the reason', 'Entered on the wrong patient chart', (select reason from public.note_error_flags where note_id = n1));
  perform pg_temp.ck('...staff still see the note, now in the entered-in-error state', 'entered_in_error', (select state from public.notes where id = n1));
  perform pg_temp.ck('...the audited chart read carries the flag and the reason', 'true',
    (pg_temp.q_as(v_doc, format($q$select public.read_patient_encounter_notes_audited(%L, 'checking the withdrawn flag on the chart')::text$q$, v_np)) like '%"entered_in_error": true%'
      and pg_temp.q_as(v_doc, format($q$select public.read_patient_encounter_notes_audited(%L, 'checking the withdrawn flag on the chart')::text$q$, v_np)) like '%"withdrawn_reason": "Entered on the wrong patient chart"%')::text);
  perform pg_temp.ck('...the patient sees that it was withdrawn and why', 'true',
    (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%"entered_in_error": true%'
      and pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%Entered on the wrong patient chart%')::text);
  perform pg_temp.ck('...and none of its clinical text', 'false',
    (pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%Reviewed the readings%' or pg_temp.q_as(v_np, $q$select public.my_released_notes()::text$q$) like '%Continue as planned%')::text);
  perform pg_temp.ck('...the index says it was withdrawn', 'true', (pg_temp.q_as(v_np, $q$select public.my_note_index()::text$q$) like '%"entered_in_error": true%')::text);
  perform pg_temp.ck('...the patient was told, neutrally', '1', (select count(*)::text from public.notifications where recipient_id = v_np and template = 'note_withdrawn'));
  perform pg_temp.ck('...an event with the id only', jsonb_build_object('note_id', n1)::text,
    (select payload::text from public.domain_events where event_type = 'note.withdrawn' and aggregate_id = n1));
  perform pg_temp.ck('a note cannot be withdrawn twice', 'note_already_withdrawn',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered on the wrong patient chart')$q$, n1)));
  perform pg_temp.ck('a withdrawn note cannot be amended', 'note_withdrawn_cannot_amend',
    pg_temp.try_as(v_doc, format($q$select public.create_note_amendment(%L, 'correction', 'Trying to correct a withdrawn note')$q$, n1)));
  perform pg_temp.ck('a withdrawn note cannot be disputed', 'true',
    (pg_temp.try_as(v_np, format($q$select public.request_note_correction(%L, 'This note does not match what happened')$q$, n1)) like 'not found%')::text);
  perform pg_temp.ck('the flag cannot be changed or removed', 'true',
    (pg_temp.try_sql(format('delete from public.note_error_flags where note_id = %L', n1)) = '42501'
      and pg_temp.try_sql(format($q$update public.note_error_flags set reason = 'A different reason entirely' where note_id = %L$q$, n1)) = '42501')::text);
  perform pg_temp.ck('a signed-in user still sees zero rows of the flag table', '0', pg_temp.q_as(v_np, 'select count(*)::text from public.note_error_flags'));

  -- an unreleased note: withdrawn without telling a patient who could never see it
  select count(*) into v_before from public.notifications where recipient_id = v_np and template = 'note_withdrawn';
  perform pg_temp.ck('a note the patient could not see can be withdrawn', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.mark_note_entered_in_error(%L, 'Entered before the visit happened')$q$, n2)));
  perform pg_temp.ck('...without a notification to the patient', v_before::text,
    (select count(*)::text from public.notifications where recipient_id = v_np and template = 'note_withdrawn'));
  -- the CMO may withdraw another clinician's note (the gate opens)
  perform pg_temp.ck('the CMO can withdraw a note another clinician wrote', 'ok',
    pg_temp.try_as(v_cmo, format($q$select public.mark_note_entered_in_error(%L, 'Wrong patient identified on review')$q$, n3)));
  perform pg_temp.f('np');
end $$;

-- 4. SABOTAGE: credit return off, and the author-or-CMO rule removed; both checks must flip ----------------------------
create or replace function private.return_async_consult_credit(p_consult uuid) returns boolean
language sql security definer set search_path = '' as $$ select false $$;
create or replace function public.mark_note_entered_in_error(p_note uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.clinical_encounter_notes%rowtype;
begin
  perform private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note;
  insert into public.note_error_flags (note_id, organisation_id, patient_id, flagged_by, reason, is_test)
  values (n.id, n.organisation_id, n.patient_id, (select auth.uid()), btrim(p_reason), n.is_test);
end $$;

do $$
declare
  v_pc uuid := pg_temp.f('pc'); v_pur uuid := pg_temp.f('pur'); c uuid; v_doc2 uuid := pg_temp.f('doc2'); v_np uuid := pg_temp.f('np'); n4 uuid; v_doc uuid := pg_temp.f('doc');
begin
  -- the credit was spent again above; spend path: a fresh question window missed with the return turned off
  c := pg_temp.consult_of(v_pc);
  update public.async_consults set window_started_at = now() - interval '1500 minutes', window_missed_at = null, answered_at = null where id = c;
  perform private.sweep_written_question_windows();
  insert into results values ('sabotaged', 'a missed window returns the credit', 'returned',
    case when (select redeemed_at from public.service_purchases where id = v_pur) is null then 'returned' else 'kept' end);
  n4 := pg_temp.signed_note(v_doc, v_np);
  insert into results values ('sabotaged', 'a clinician who is not the author cannot withdraw a note', 'refused',
    case when pg_temp.try_as(v_doc2, format($q$select public.mark_note_entered_in_error(%L, 'Trying to withdraw someone else''s note')$q$, n4)) = 'ok' then 'allowed' else 'refused' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S22c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
