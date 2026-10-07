-- S36h proof: pharmacy "Flag a problem" on a prescription (migration *_s36h_pharmacy_flag_a_problem.sql). Spec 9.6; INV-02, INV-07, INV-10, INV-13.
--
--   1. A pharmacist sees only prescriptions SENT to their own pharmacy (not another pharmacy's, not a draft).
--   2. A flag records kind, reason, pharmacy and flagger; makes one prescriber task (repeat flags merge into it); sends the prescriber ONE neutral
--      in-app notice (template text passes the INV-07 lint; payload holds ids only); writes an audit row.
--   3. The prescription is byte-for-byte unchanged afterwards: state still sent, signature kept, not dispensed (INV-02).
--   4. Only the pharmacy the prescription was sent to may flag it; another pharmacy gets 42501 and nothing is written.
--   5. A prescription that is dispensed or only signed (not open at the pharmacy) cannot be flagged (22023).
--   6. A reason under 10 or over 500 characters, a null reason and an unknown kind are refused and write nothing.
--   7. A clinician, a patient and anon cannot flag. A pharmacist cannot write or read the table directly; the table is append only for everyone.
--   8. The prescriber reads the flag through clinician_pharmacy_flags (one audit row); a clinician with no tie to it sees nothing and writes no audit row;
--      a patient is refused; a clinician cannot read the table directly.
--   9. SABOTAGE: the own-pharmacy check removed (another pharmacy can then flag), and the state check removed (a dispensed one can then be flagged); each flips a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table snap(k text primary key, v text) on commit drop;
grant all on snap to public;

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's36h-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, p_name, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- flag as a user; returns the new flag id as text, or ERR:sqlstate
create function pg_temp.flag_as(p_uid uuid, p_rx uuid, p_kind text, p_reason text) returns text language plpgsql as
$f$ declare r uuid;
begin
  perform pg_temp.act(p_uid);
  begin r := public.pharmacist_flag_prescription(p_rx, p_kind, p_reason); exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r::text;
end $f$;
create function pg_temp.anon_flag(p_rx uuid) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform public.pharmacist_flag_prescription(p_rx, 'other', 'A long enough reason here'); r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.list_as(p_uid uuid) returns text language plpgsql as
$f$ declare n integer;
begin
  perform pg_temp.act(p_uid);
  begin select count(*) into n from public.pharmacist_prescriptions(); exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return n::text;
end $f$;
create function pg_temp.flags_as(p_uid uuid) returns text language plpgsql as
$f$ declare n integer;
begin
  perform pg_temp.act(p_uid);
  begin select count(*) into n from public.clinician_pharmacy_flags(); exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return n::text;
end $f$;
create function pg_temp.table_count_as(p_uid uuid) returns text language plpgsql as
$f$ declare n integer;
begin
  perform pg_temp.act(p_uid);
  begin select count(*) into n from public.prescription_pharmacy_flags; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return n::text;
end $f$;
create function pg_temp.rx_hash(p_rx uuid) returns text language sql as
$$ select md5(to_jsonb(rx)::text) from public.prescriptions rx where id = p_rx $$;

do $$
declare v_org uuid; v_pA uuid; v_pB uuid; v_phA uuid; v_phB uuid; v_doc uuid; v_doc2 uuid; v_pat uuid;
        v_rxA uuid; v_rxB uuid; v_rxDraft uuid; v_rxDisp uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.pharmacy_partners (name, is_active) values ('S36h Pharmacy A', false) returning id into v_pA;
  insert into public.pharmacy_partners (name, is_active) values ('S36h Pharmacy B', false) returning id into v_pB;
  v_phA := pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'S36h Pharmacist A');
  v_phB := pg_temp.mkuser(v_org, 'phB', 'pharmacist', 'S36h Pharmacist B');
  update public.profiles set pharmacy_partner_id = v_pA where id = v_phA;
  update public.profiles set pharmacy_partner_id = v_pB where id = v_phB;
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'S36h Prescriber');
  v_doc2 := pg_temp.mkuser(v_org, 'doc2', 'clinician', 'S36h Other Clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'S36h Patient');
  -- signed and sent prescriptions, written as the table owner (no session), so the signing triggers are not what is under test
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, sent_at, pharmacy_partner_id, collection_code, is_test)
  values (v_org, v_pat, '[{"drug":"Proofdrug"}]', 'sent', v_doc, now(), now(), v_pA, 'AAAA11', true) returning id into v_rxA;
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, sent_at, pharmacy_partner_id, collection_code, is_test)
  values (v_org, v_pat, '[{"drug":"Proofdrug"}]', 'sent', v_doc, now(), now(), v_pB, 'BBBB22', true) returning id into v_rxB;
  insert into public.prescriptions (organisation_id, patient_id, items, state, pharmacy_partner_id, is_test)
  values (v_org, v_pat, '[{"drug":"Proofdrug"}]', 'draft', v_pA, true) returning id into v_rxDraft;
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, sent_at, dispensed_at, pharmacy_partner_id, collection_code, is_test)
  values (v_org, v_pat, '[{"drug":"Proofdrug"}]', 'dispensed', v_doc, now(), now(), now(), v_pA, 'CCCC33', true) returning id into v_rxDisp;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('phA', v_phA); perform pg_temp.setf('phB', v_phB);
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('doc2', v_doc2); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('rxA', v_rxA); perform pg_temp.setf('rxB', v_rxB); perform pg_temp.setf('rxDraft', v_rxDraft); perform pg_temp.setf('rxDisp', v_rxDisp);
  perform pg_temp.setf('pA', v_pA);
end $$;

-- 1. the pharmacy's own list: A has one sent and one dispensed (the draft and B's are not shown)
insert into results values ('real', 'pharmacy A lists its two sent or dispensed prescriptions', '2', pg_temp.list_as(pg_temp.f('phA')));
insert into results values ('real', 'pharmacy B lists only its own', '1', pg_temp.list_as(pg_temp.f('phB')));
insert into results values ('real', 'a clinician cannot list pharmacy prescriptions', '0', pg_temp.list_as(pg_temp.f('doc')));

-- snapshot the prescription before any flag (3)
insert into snap values ('rxA_before', pg_temp.rx_hash(pg_temp.f('rxA')));

-- 6. refusals write nothing
insert into results values ('real', 'a short reason is refused', 'ERR:22023', pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxA'), 'other', 'too short'));
insert into results values ('real', 'a null reason is refused', 'ERR:22023', pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxA'), 'other', null));
insert into results values ('real', 'a 501 character reason is refused', 'ERR:22023', pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxA'), 'other', repeat('x', 501)));
insert into results values ('real', 'an unknown kind is refused', 'ERR:22023', pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxA'), 'dispensed', 'A long enough reason here'));
insert into results values ('real', 'refusals wrote no flag', '0', (select count(*)::text from public.prescription_pharmacy_flags));

-- 4/5/7. who may not flag
insert into results values ('real', 'another pharmacy cannot flag it', 'ERR:42501', pg_temp.flag_as(pg_temp.f('phB'), pg_temp.f('rxA'), 'other', 'Not our prescription at all'));
insert into results values ('real', 'a dispensed prescription cannot be flagged', 'ERR:22023', pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxDisp'), 'other', 'Raised too late to matter'));
insert into results values ('real', 'a draft prescription cannot be flagged', 'ERR:22023', pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxDraft'), 'other', 'Not even signed yet'));
insert into results values ('real', 'a clinician cannot flag', 'ERR:42501', pg_temp.flag_as(pg_temp.f('doc'), pg_temp.f('rxA'), 'other', 'A clinician is not a pharmacy'));
insert into results values ('real', 'a patient cannot flag', 'ERR:42501', pg_temp.flag_as(pg_temp.f('pat'), pg_temp.f('rxA'), 'other', 'A patient is not a pharmacy'));
insert into results values ('real', 'anon cannot flag', '42501', pg_temp.anon_flag(pg_temp.f('rxA')));
insert into results values ('real', 'nothing written by any refusal', '0', (select count(*)::text from public.prescription_pharmacy_flags));

-- 2. a real flag, then a second one on the same prescription
do $$
declare v1 text; v2 text; r record; n integer; v_body text;
begin
  v1 := pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxA'), 'out_of_stock', 'We do not have this in stock until Thursday');
  insert into results values ('real', 'pharmacy A can flag its own sent prescription', 'true', (v1 !~ '^ERR')::text);
  select * into r from public.prescription_pharmacy_flags where id = v1::uuid;
  insert into results values ('real', 'flag keeps the kind', 'out_of_stock', r.kind);
  insert into results values ('real', 'flag keeps the pharmacy', pg_temp.f('pA')::text, r.pharmacy_partner_id::text);
  insert into results values ('real', 'flag keeps the flagger', pg_temp.f('phA')::text, r.flagged_by::text);
  insert into results values ('real', 'flag carries is_test from the prescription (INV-13)', 'true', r.is_test::text);
  insert into results values ('real', 'flag points at a task', 'true', (r.task_id is not null)::text);
  select count(*), max(type) into n, v_body from public.clinical_tasks where patient_id = pg_temp.f('pat') and dedup_key = 'pharmacy_flag:' || pg_temp.f('rxA');
  insert into results values ('real', 'one prescriber task of the right type', '1 pharmacy_flag_review', n || ' ' || v_body);
  select count(*), max(payload::text) into n, v_body from public.notifications where recipient_id = pg_temp.f('doc') and template = 'pharmacy_flag_notice';
  insert into results values ('real', 'the prescriber got exactly one notice', '1', n::text);
  insert into results values ('real', 'the notice payload holds an id only (no medicine, patient or reason)', 'true',
    (v_body !~* 'proofdrug|stock|S36h|Thursday' and v_body ~ 'flag_id')::text);
  select body into v_body from public.notification_template_locales where template_key = 'pharmacy_flag_notice' and locale = 'en' and channel = 'in_app';
  insert into results values ('real', 'the notice text passes the INV-07 lint', '0', cardinality(private.notification_text_violations(v_body))::text);
  insert into results values ('real', 'the notice names no medicine', 'false', (v_body ~* 'proofdrug')::text);
  select count(*) into n from public.audit_log where action = 'prescription.pharmacy_flagged' and entity_id = pg_temp.f('rxA') and actor_id = pg_temp.f('phA');
  insert into results values ('real', 'one audit row for the flag', '1', n::text);
  insert into results values ('real', 'the audit row does not carry the written reason', 'false',
    (select (event::text ~ 'Thursday')::text from public.audit_log where action = 'prescription.pharmacy_flagged' and entity_id = pg_temp.f('rxA')));

  v2 := pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxA'), 'query_to_prescriber', 'Please confirm the quantity written on this one');
  insert into results values ('real', 'a second flag is recorded', '2', (select count(*)::text from public.prescription_pharmacy_flags where prescription_id = pg_temp.f('rxA')));
  select count(*), max(merged_count) into n, v_body from public.clinical_tasks where patient_id = pg_temp.f('pat') and dedup_key = 'pharmacy_flag:' || pg_temp.f('rxA');
  insert into results values ('real', 'the second flag merges into the same live task', '1 1', n || ' ' || v_body);
end $$;

-- 3. the prescription is unchanged
insert into results values ('real', 'the prescription row is byte for byte unchanged by two flags', (select v from snap where k = 'rxA_before'), pg_temp.rx_hash(pg_temp.f('rxA')));
insert into results values ('real', 'still sent, signature kept, not dispensed', 'sent true null',
  (select state::text || ' ' || (signed_by = pg_temp.f('doc') and signed_at is not null)::text || ' ' || coalesce(dispensed_at::text, 'null') from public.prescriptions where id = pg_temp.f('rxA')));

-- 7. direct table access and append-only
insert into results values ('real', 'a pharmacist reads only its own flags from the table', '2', pg_temp.table_count_as(pg_temp.f('phA')));
insert into results values ('real', 'the other pharmacy sees none of them', '0', pg_temp.table_count_as(pg_temp.f('phB')));
insert into results values ('real', 'a clinician cannot read the table directly', '0', pg_temp.table_count_as(pg_temp.f('doc')));
do $$
declare r text;
begin
  perform pg_temp.act(pg_temp.f('phA'));
  begin
    insert into public.prescription_pharmacy_flags (organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason)
    values (pg_temp.f('org'), pg_temp.f('rxA'), pg_temp.f('pA'), pg_temp.f('phA'), 'other', 'Written straight to the table');
    r := 'inserted';
  exception when others then r := sqlstate; end;
  perform pg_temp.back();
  insert into results values ('real', 'a pharmacist cannot insert straight into the table', '42501', r);
  begin update public.prescription_pharmacy_flags set reason = 'Edited after the fact, never allowed'; r := 'updated'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'even the table owner cannot edit a flag', '42501', r);
  begin delete from public.prescription_pharmacy_flags; r := 'deleted'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'even the table owner cannot delete a flag', '42501', r);
end $$;

-- 8. the prescriber side
insert into results values ('real', 'the prescriber sees both flags', '2', pg_temp.flags_as(pg_temp.f('doc')));
insert into results values ('real', 'the prescriber read wrote one audit row', '1',
  (select count(*)::text from public.audit_log where action = 'prescription.pharmacy_flags_read' and actor_id = pg_temp.f('doc')));
insert into results values ('real', 'a clinician with no tie to it sees nothing', '0', pg_temp.flags_as(pg_temp.f('doc2')));
insert into results values ('real', 'the untied read wrote no audit row', '0',
  (select count(*)::text from public.audit_log where action = 'prescription.pharmacy_flags_read' and actor_id = pg_temp.f('doc2')));
insert into results values ('real', 'a patient cannot read the flags', 'ERR:42501', pg_temp.flags_as(pg_temp.f('pat')));
insert into results values ('real', 'a pharmacist cannot read the prescriber view', 'ERR:42501', pg_temp.flags_as(pg_temp.f('phA')));

-- 9. sabotage
do $$
declare v_orig text; v_def text; r text;
begin
  v_orig := pg_get_functiondef('public.pharmacist_flag_prescription(uuid,text,text)'::regprocedure);
  v_def := replace(v_orig, 'where id = p_prescription and pharmacy_partner_id = v_partner;', 'where id = p_prescription;');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  r := pg_temp.flag_as(pg_temp.f('phB'), pg_temp.f('rxA'), 'other', 'Sabotaged: not our prescription');
  insert into results values ('sabotaged', 'another pharmacy cannot flag it', 'ERR:42501', case when r ~ '^ERR' then r else 'accepted' end);
  execute v_orig;

  v_def := replace(v_orig, 'if rx.state <> ''sent'' then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.flag_as(pg_temp.f('phA'), pg_temp.f('rxDisp'), 'other', 'Sabotaged: already dispensed');
  insert into results values ('sabotaged', 'a dispensed prescription cannot be flagged', 'ERR:22023', case when r ~ '^ERR' then r else 'accepted' end);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36h proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
