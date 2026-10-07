-- S36j proof: the Chief Medical Officer may approve payouts (migration *_s36j_cmo_may_approve_payouts.sql). One rolled-back transaction. Proves:
--   1. An admin can still approve (unchanged); an active CMO can approve a draft that is not theirs; the audit row says who approved by role.
--   2. A CMO cannot approve a draft where they are the payee (payout_self_approval); guard off refuses even the CMO (payout_guard_off).
--   3. An ordinary clinician, finance, analyst, care coordinator, a suspended CMO, a patient and anon are refused (approve and the queue).
--   4. The CMO may NOT build, discard, prepare a send, retry or list payouts (payout_not_authorised): those stay admin only.
--   5. The queue lists only drafts, never a test clinician (INV-13), and exposes no bank data.
--   5b. (S36k) payout_events.source is 'cmo' for a CMO approval and 'admin' for an admin one; the queue marks the caller's own draft
--       is_mine and total_waiting equals the real count of waiting drafts; the source check allows 'cmo'.
--   6. SABOTAGE: the approver check put back to admin only; the CMO checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table saved(k text primary key, v text) on commit drop;
grant all on saved to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's36j-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S36j ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S36j ' || p_label, 'MDCN', 'S36j-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_as_state(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;

create function pg_temp.go_real(p_uid uuid, p_name text) returns void language plpgsql as
$f$ begin
  update public.profiles set is_test = false where id = p_uid;
  update public.clinical_staff set is_test = false, full_name = p_name where profile_id = p_uid;
end $f$;
-- a ledger line (adjustment kind, so no fee schedule is needed) earned `p_ago` ago
create function pg_temp.line(p_org uuid, p_doc uuid, p_admin uuid, p_kobo bigint, p_ago text, p_test boolean default false) returns uuid language sql as
$$ select private.ledger_insert(p_org, p_doc, 'adjustment', 'manual', gen_random_uuid(), p_kobo, null, '{"proof": true}'::jsonb,
     now() - p_ago::interval, p_test, 'proof line for S31 payouts', p_admin) $$;
-- the payout guard, for the proof only (the real guard row cannot be switched by anyone but set_go_live_guard)
create function pg_temp.guard_on() returns void language plpgsql as
$f$ begin
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
  as 'select true';
end $f$;


do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_e uuid; v_f uuid; v_cmo uuid; v_t uuid; v_d uuid; v_fin uuid; v_an uuid; v_cc uuid; v_pat uuid; v_cmo2 uuid;
  v_n integer; r jsonb; v_pa uuid; v_pe uuid; v_pf uuid; v_pc uuid; v_pt uuid; v_cols text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  v_a := pg_temp.mkdoc(v_org, 'docA', 'medical_officer', 'contracted', '{}', v_admin); perform pg_temp.go_real(v_a, 'Ada Chinwe Okafor');
  v_e := pg_temp.mkdoc(v_org, 'docE', 'medical_officer', 'contracted', '{}', v_admin); perform pg_temp.go_real(v_e, 'Emeka Paul Eze');
  v_f := pg_temp.mkdoc(v_org, 'docF', 'medical_officer', 'contracted', '{}', v_admin); perform pg_temp.go_real(v_f, 'Funke Ola Bello');
  v_t := pg_temp.mkdoc(v_org, 'docT', 'medical_officer', 'contracted', '{}', v_admin); perform pg_temp.go_real(v_t, 'Tunde Kay Ade');
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{}', v_admin); perform pg_temp.go_real(v_cmo, 'Chioma Ngozi Cole');
  v_cmo2 := pg_temp.mkdoc(v_org, 'cmo2', 'chief_medical_officer', 'contracted', '{}', v_admin);
  update public.clinical_staff set active = false where profile_id = v_cmo2;
  v_d := pg_temp.mkdoc(v_org, 'docD', 'senior_medical_officer', 'contracted', '{}', v_admin);
  v_fin := pg_temp.mkuser(v_org, 'fin', 'finance'); v_an := pg_temp.mkuser(v_org, 'an', 'analyst');
  v_cc := pg_temp.mkuser(v_org, 'cc', 'care_coordinator'); v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');

  perform pg_temp.line(v_org, v_a, v_admin, 180000, '14 days');
  perform pg_temp.line(v_org, v_e, v_admin, 150000, '14 days');
  perform pg_temp.line(v_org, v_f, v_admin, 130000, '14 days');
  perform pg_temp.line(v_org, v_cmo, v_admin, 200000, '14 days');
  perform pg_temp.line(v_org, v_t, v_admin, 120000, '14 days');
  perform pg_temp.act(v_admin); v_n := public.build_payout_drafts_now(); perform pg_temp.back();
  perform pg_temp.ck('five drafts made (A, E, F, the CMO as payee, T)', '5', v_n::text);
  select id into v_pa from public.payouts where clinician_id = v_a; select id into v_pe from public.payouts where clinician_id = v_e;
  select id into v_pf from public.payouts where clinician_id = v_f; select id into v_pc from public.payouts where clinician_id = v_cmo;
  select id into v_pt from public.payouts where clinician_id = v_t;
  perform pg_temp.setf('pa', v_pa); perform pg_temp.setf('pe', v_pe); perform pg_temp.setf('pf', v_pf); perform pg_temp.setf('cmo', v_cmo);
  -- verified banks for A, E, F and the CMO
  r := public.record_bank_resolution(v_a, '058', 'GTBank', '1111', 'OKAFOR ADA CHINWE'); perform public.attach_bank_recipient((r ->> 'id')::uuid, 'RCP_a');
  r := public.record_bank_resolution(v_e, '058', 'GTBank', '2222', 'EZE EMEKA PAUL'); perform public.attach_bank_recipient((r ->> 'id')::uuid, 'RCP_e');
  r := public.record_bank_resolution(v_f, '058', 'GTBank', '3333', 'BELLO FUNKE OLA'); perform public.attach_bank_recipient((r ->> 'id')::uuid, 'RCP_f');
  r := public.record_bank_resolution(v_cmo, '058', 'GTBank', '4444', 'COLE CHIOMA NGOZI'); perform public.attach_bank_recipient((r ->> 'id')::uuid, 'RCP_c');
  -- T becomes a test account after the draft (INV-13 for the queue)
  update public.profiles set is_test = true where id = v_t;

  -- guard off: even the CMO and the admin are refused
  perform pg_temp.ck('guard off refuses the CMO', 'payout_guard_off', pg_temp.try_as(v_cmo, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('guard off refuses the admin', 'payout_guard_off', pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pe)));
  perform pg_temp.guard_on();

  -- refused callers
  perform pg_temp.ck('an ordinary doctor cannot approve', 'payout_not_authorised', pg_temp.try_as(v_d, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('a suspended CMO cannot approve', 'payout_not_authorised', pg_temp.try_as(v_cmo2, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('finance cannot approve', 'payout_not_authorised', pg_temp.try_as(v_fin, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('an analyst cannot approve', 'payout_not_authorised', pg_temp.try_as(v_an, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('a care coordinator cannot approve', 'payout_not_authorised', pg_temp.try_as(v_cc, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('a patient cannot approve', 'payout_not_authorised', pg_temp.try_as(v_pat, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('anon cannot approve', 'permission denied for function approve_payout', pg_temp.try_anon(format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('anon cannot read the queue', 'permission denied for function payout_approval_queue', pg_temp.try_anon('select * from public.payout_approval_queue()'));
  perform pg_temp.ck('a doctor cannot read the queue', 'payout_not_authorised', pg_temp.try_as(v_d, 'select * from public.payout_approval_queue()'));
  perform pg_temp.ck('finance cannot read the queue', 'payout_not_authorised', pg_temp.try_as(v_fin, 'select * from public.payout_approval_queue()'));
  perform pg_temp.ck('an analyst cannot read the queue', 'payout_not_authorised', pg_temp.try_as(v_an, 'select * from public.payout_approval_queue()'));
  perform pg_temp.ck('a care coordinator cannot read the queue', 'payout_not_authorised', pg_temp.try_as(v_cc, 'select * from public.payout_approval_queue()'));
  perform pg_temp.ck('a patient cannot read the queue', 'payout_not_authorised', pg_temp.try_as(v_pat, 'select * from public.payout_approval_queue()'));
  perform pg_temp.ck('a suspended CMO cannot read the queue', 'payout_not_authorised', pg_temp.try_as(v_cmo2, 'select * from public.payout_approval_queue()'));

  -- the queue
  perform pg_temp.ck('the CMO sees four drafts (the test clinician is never listed)', '4', pg_temp.q_as(v_cmo, 'select count(*) from public.payout_approval_queue()'));
  perform pg_temp.ck('the admin sees the same four', '4', pg_temp.q_as(v_admin, 'select count(*) from public.payout_approval_queue()'));
  perform pg_temp.ck('INV-13: the test clinician''s draft is absent', '0', pg_temp.q_as(v_cmo, format('select count(*) from public.payout_approval_queue() where id = %L', v_pt)));
  perform pg_temp.ck('the queue shows A as 180000 over 1 earning, bank ready', '180000/1/true/draft',
    pg_temp.q_as(v_cmo, format($q$select amount_kobo || '/' || line_count || '/' || bank_ready || '/' || state from public.payout_approval_queue() where id = %L$q$, v_pa)));
  select string_agg(a, ',') into v_cols from (select unnest(proargnames) a from pg_proc where proname = 'payout_approval_queue' and pronamespace = 'public'::regnamespace) s;
  perform pg_temp.ck('the queue exposes no bank data', 'false', (v_cols ~ '(account|recipient|last4|number|resolved|bank_name|code)')::text);

  -- S36k: is_mine and total_waiting
  perform pg_temp.ck('the CMO''s own draft is marked is_mine', 'true', pg_temp.q_as(v_cmo, format('select is_mine from public.payout_approval_queue() where id = %L', v_pc)));
  perform pg_temp.ck('another payee''s draft is not is_mine', 'false', pg_temp.q_as(v_cmo, format('select is_mine from public.payout_approval_queue() where id = %L', v_pa)));
  perform pg_temp.ck('for the admin no draft is is_mine', '0', pg_temp.q_as(v_admin, 'select count(*) from public.payout_approval_queue() where is_mine'));
  perform pg_temp.ck('total_waiting equals the real count of waiting drafts', (select count(*)::text from public.payouts p where p.organisation_id = v_org and p.state = 'draft' and not p.is_test
      and not exists (select 1 from public.profiles pr where pr.id = p.clinician_id and pr.is_test)),
    pg_temp.q_as(v_cmo, 'select max(total_waiting) from public.payout_approval_queue()'));
  perform pg_temp.ck('total_waiting is at least the rows returned', 'true', pg_temp.q_as(v_cmo, 'select (min(total_waiting) >= count(*))::text from public.payout_approval_queue()'));
  perform pg_temp.ck('the source check allows cmo', 'true', (select (pg_get_constraintdef(oid) ~ 'cmo')::text from pg_constraint where conname = 'payout_events_source_check' and conrelid = 'public.payout_events'::regclass));

  -- the CMO may not do anything else with payouts
  perform pg_temp.ck('the CMO cannot build drafts', 'payout_not_authorised', pg_temp.try_as(v_cmo, 'select public.build_payout_drafts_now()'));
  perform pg_temp.ck('the CMO cannot discard a draft', 'payout_not_authorised', pg_temp.try_as(v_cmo, format('select public.discard_payout_draft(%L)', v_pe)));
  perform pg_temp.ck('the CMO cannot prepare a send', 'payout_not_authorised', pg_temp.try_as(v_cmo, format('select public.payout_prepare_send(%L)', v_pe)));
  perform pg_temp.ck('the CMO cannot retry', 'payout_not_authorised', pg_temp.try_as(v_cmo, format('select public.retry_payout(%L)', v_pe)));
  perform pg_temp.ck('the CMO cannot list payouts (admin screen)', 'payout_not_authorised', pg_temp.try_as(v_cmo, 'select * from public.list_payouts()'));

  -- the CMO as the payee
  perform pg_temp.ck('a CMO cannot approve their own payout', 'payout_self_approval', pg_temp.try_as(v_cmo, format('select public.approve_payout(%L)', v_pc)));
  perform pg_temp.ck('...and it stays a draft', 'draft', (select state from public.payouts where id = v_pc));

  -- approvals
  perform pg_temp.ck('the CMO approves A''s payout', 'ok', pg_temp.try_as(v_cmo, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('...approved by the CMO, with recipient', format('approved/%s/RCP_a', v_cmo), (select state || '/' || approved_by || '/' || recipient_code from public.payouts where id = v_pa));
  perform pg_temp.ck('...the earnings are linked once', '1/180000', (select count(*) || '/' || sum(amount_kobo) from public.earnings_ledger where payout_id = v_pa));
  perform pg_temp.ck('...audit row says approver_role cmo', 'cmo', (select event ->> 'approver_role' from public.audit_log where entity_id = v_pa and action = 'payout.approved'));
  perform pg_temp.ck('...the event source is cmo (S36k)', 'cmo', (select source from public.payout_events where payout_id = v_pa and to_state = 'approved'));
  perform pg_temp.ck('a second approval is refused', 'payout_not_a_draft', pg_temp.try_as(v_cmo, format('select public.approve_payout(%L)', v_pa)));
  perform pg_temp.ck('the approved draft leaves the queue', '3', pg_temp.q_as(v_cmo, 'select count(*) from public.payout_approval_queue()'));
  perform pg_temp.ck('an admin still approves E''s payout', 'ok', pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pe)));
  perform pg_temp.ck('...the admin approval event source is admin (S36k)', 'admin', (select source from public.payout_events where payout_id = v_pe and to_state = 'approved'));
  perform pg_temp.ck('...audit row says approver_role admin', 'admin', (select event ->> 'approver_role' from public.audit_log where entity_id = v_pe and action = 'payout.approved'));
  perform pg_temp.ck('the CMO still cannot send an approved payout', 'payout_not_authorised', pg_temp.try_as(v_cmo, format('select public.payout_prepare_send(%L)', v_pe)));
  perform pg_temp.ck('exactly one approve_payout overload', '1', (select count(*) from pg_proc where proname = 'approve_payout' and pronamespace = 'public'::regnamespace)::text);
  perform pg_temp.ck('payout_admin_org is still admin only', 'false', (pg_get_functiondef('private.payout_admin_org()'::regprocedure) ~ 'credential_is_cmo')::text);
end $$;

-- SABOTAGE B: the approver check put back to the admin only helper; the CMO checks must flip -------------------------------------------
do $$
declare v_def text;
begin
  v_def := replace(pg_get_functiondef('public.approve_payout(uuid)'::regprocedure), 'private.payout_approver_org()', 'private.payout_admin_org()');
  execute v_def;
  v_def := replace(pg_get_functiondef('public.payout_approval_queue()'::regprocedure), 'private.payout_approver_org()', 'private.payout_admin_org()');
  execute v_def;
end $$;
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_pf uuid := pg_temp.f('pf'); r text;
begin
  r := pg_temp.try_as(v_cmo, format('select public.approve_payout(%L)', v_pf));
  insert into results values ('sabotaged', 'the CMO approves a draft that is not theirs', 'ok', r);
  r := pg_temp.try_as(v_cmo, 'select * from public.payout_approval_queue()');
  insert into results values ('sabotaged', 'the CMO reads the queue', 'ok', r);
end $$;

-- SABOTAGE A (S36k, runs after B): the event source hard-coded to admin again; a CMO approval must then record admin, not cmo.
do $$
declare v_def text;
begin
  -- from the state left by sabotage B: approver check restored, event source hard-coded to admin
  v_def := replace(pg_get_functiondef('public.approve_payout(uuid)'::regprocedure), 'private.payout_admin_org()', 'private.payout_approver_org()');
  execute replace(v_def, 'v_uid, v_role, null', 'v_uid, ''admin'', null');
end $$;
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_pf uuid := pg_temp.f('pf'); r text;
begin
  r := pg_temp.try_as(v_cmo, format('select public.approve_payout(%L)', v_pf));
  insert into results values ('sabotaged', 'the CMO approval event source is cmo', 'cmo', (select source from public.payout_events where payout_id = v_pf and to_state = 'approved'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36j proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
