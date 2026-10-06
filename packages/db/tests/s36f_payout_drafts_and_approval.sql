-- S36f proof: payout drafts and approval (migration *_s36f_payout_drafts_and_approval.sql). One rolled-back transaction.
--   1. Prepare (ops, permission-gated): a contracted clinician's unpaid, non-test earnings are drafted in integer kobo with the fee
--      schedule version recorded; a test clinician, an employed clinician, a test line, a line after the period end and a line still
--      waiting for a correction are never included; a negative total makes no draft; a plain clinician, a patient and anon are refused.
--   2. Idempotent: a second prepare adds nothing; a new line tops the SAME draft up; no earning sits in two non-cancelled payouts.
--   3. Maker-checker: ops cannot approve; the preparer (an admin) cannot approve their own draft; a note is required; a different admin can.
--   4. Immutability: an approved payout cannot be edited, deleted or re-linked, by the table owner either; ops cannot cancel it, the admin can,
--      and cancelling releases its lines for a later draft.
--   5. No money moves: mark sent is refused while the payouts_enabled guard is off.
--   6. Reads: a clinician sees only their own approved payout; unpaid totals exclude test and employed clinicians.
--   SABOTAGE: the different-person check removed; the test filter removed; the one-active-line index dropped. Each must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
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
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
-- as the table owner, with the write flag on or off
create function pg_temp.owner_try(p_sql text, p_flag boolean) returns text language plpgsql as
$f$ begin
  perform set_config('tarragon.payout_write', case when p_flag then 'on' else 'off' end, true);
  begin execute p_sql; perform set_config('tarragon.payout_write', 'off', true); return 'ok';
  exception when others then perform set_config('tarragon.payout_write', 'off', true); return sqlerrm; end;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's36f-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S36f ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_emp text, p_test boolean, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', p_test);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S36f ' || p_label, 'MDCN', 'S36F-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'medical_officer'::public.doctor_tier, p_emp::public.staff_employment_type, 1, p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test);
  return v;
end $f$;
create function pg_temp.line(p_clin uuid, p_amount bigint, p_days_ago integer, p_test boolean default false, p_calc jsonb default '{}') returns uuid language plpgsql as $f$
begin
  return private.ledger_insert(pg_temp.f('org'), p_clin, 'task', 'clinical_task', gen_random_uuid(), p_amount, pg_temp.f('sched'), p_calc,
                               now() - make_interval(days => p_days_ago), p_test);
end $f$;
create function pg_temp.payout_of(p_clin uuid) returns uuid language sql as
$$ select id from public.payouts where clinician_id = p_clin and state <> 'cancelled' $$;

do $$
declare
  v_org uuid; v_admin uuid; v_admin2 uuid; v_ops uuid; v_doc uuid; v_pat uuid;
  cA uuid; cB uuid; cE uuid; cC uuid; cN uuid; cD uuid; cF uuid; v_sched uuid; v_ver integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin1', 'admin');
  v_admin2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_doc := pg_temp.mkuser(v_org, 'plain', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_ops, 'payouts.prepare', v_admin);
  cA := pg_temp.mkdoc(v_org, 'cA', 'contracted', false, v_admin);
  cB := pg_temp.mkdoc(v_org, 'cB-test', 'contracted', true, v_admin);
  cE := pg_temp.mkdoc(v_org, 'cE', 'contracted', false, v_admin);
  cC := pg_temp.mkdoc(v_org, 'cC', 'contracted', false, v_admin);
  cN := pg_temp.mkdoc(v_org, 'cN', 'contracted', false, v_admin);
  cD := pg_temp.mkdoc(v_org, 'cD', 'contracted', false, v_admin);
  cF := pg_temp.mkdoc(v_org, 'cF', 'contracted', false, v_admin);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('admin2', v_admin2); perform pg_temp.setf('ops', v_ops);
  perform pg_temp.setf('plain', v_doc); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('cA', cA); perform pg_temp.setf('cB', cB); perform pg_temp.setf('cE', cE); perform pg_temp.setf('cC', cC);
  perform pg_temp.setf('cN', cN); perform pg_temp.setf('cD', cD); perform pg_temp.setf('cF', cF);

  select id, version into v_sched, v_ver from public.fee_schedules where organisation_id = v_org and status = 'approved';
  if v_sched is null then
    perform set_config('tarragon.fee_write', 'on', true);
    insert into public.fee_schedules (organisation_id, version, status, items, created_by)
    values (v_org, coalesce((select max(version) from public.fee_schedules where organisation_id = v_org), 0) + 1, 'draft',
            '{"task_types":{"t":{"base_fee_kobo":1000,"wait_multiplier_steps":[]}},"on_call_shift_fee_kobo":0,"lead_fee_per_patient_month_kobo":0,"pilot_minimum_per_declared_hour_kobo":0,"consultation_share_pct":{"video":0,"audio":0,"phone":0}}'::jsonb,
            v_admin) returning id into v_sched;
    update public.fee_schedules set status = 'approved', approved_by = v_admin, approved_at = now() where id = v_sched;
    perform set_config('tarragon.fee_write', 'off', true);
  end if;
  perform pg_temp.setf('sched', v_sched);

  -- cA: 1500 + 2500 eligible; a test line, a line earned today (after the period end) and a zero line awaiting correction are not
  perform pg_temp.line(cA, 1500, 10); perform pg_temp.line(cA, 2500, 9);
  perform pg_temp.line(cA, 9999, 9, true); perform pg_temp.line(cA, 7777, 0);
  perform pg_temp.line(cA, 0, 8, false, '{"needs_review":"no_fee_for_task_type"}');
  perform pg_temp.line(cB, 4000, 9, true);          -- a test clinician
  perform pg_temp.line(cE, 3000, 9);                -- becomes an employed clinician below
  update public.clinical_staff set employment_type = 'employed' where profile_id = cE;
  perform pg_temp.line(cC, 1200, 9); perform pg_temp.line(cD, 800, 9); perform pg_temp.line(cF, 600, 9);
  perform pg_temp.line(cN, 1000, 9);
  perform private.ledger_insert(v_org, cN, 'adjustment', 'adjustment', gen_random_uuid(), -5000, null, '{}'::jsonb, now() - interval '9 days', false,
                                'S36f proof: a larger correction than the earnings', v_admin);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Access, unpaid totals, prepare
-- ---------------------------------------------------------------------------
select pg_temp.ck('a plain clinician cannot prepare', 'payout_not_authorised',
  pg_temp.try_as(pg_temp.f('plain'), format('select public.prepare_payout_drafts(%L, %L)', current_date - 8, current_date - 1)));
select pg_temp.ck('a patient cannot read unpaid totals', 'payout_not_authorised', pg_temp.try_as(pg_temp.f('pat'), 'select * from public.payout_unpaid_summary()'));
select pg_temp.ck('anon cannot prepare', '42501', pg_temp.try_anon(format('select public.prepare_payout_drafts(%L, %L)', current_date - 8, current_date - 1)));
select pg_temp.ck('anon cannot approve', '42501', pg_temp.try_anon(format('select public.approve_payout(%L, %L)', gen_random_uuid(), 'a long enough note')));
select pg_temp.ck('anon cannot read payouts', '42501', pg_temp.try_anon('select * from public.payouts'));
select pg_temp.ck('ops cannot prepare a period that has not ended', 'payout_period_not_ended',
  pg_temp.try_as(pg_temp.f('ops'), format('select public.prepare_payout_drafts(%L, %L)', current_date - 3, current_date + 1)));
select pg_temp.ck('ops cannot prepare a backwards period', 'payout_bad_period',
  pg_temp.try_as(pg_temp.f('ops'), format('select public.prepare_payout_drafts(%L, %L)', current_date - 1, current_date - 3)));

select pg_temp.ck('unpaid total for the real contracted clinician (kobo, flagged zero line counted as waiting)', '4000/1',
  pg_temp.q_as(pg_temp.f('ops'), format($q$select unpaid_kobo || '/' || waiting_for_correction from public.payout_unpaid_summary(%L) where clinician_id = %L$q$, current_date - 1, pg_temp.f('cA'))));
select pg_temp.ck('unpaid totals leave out the test clinician', '0',
  pg_temp.q_as(pg_temp.f('ops'), format($q$select count(*) from public.payout_unpaid_summary(%L) where clinician_id = %L$q$, current_date - 1, pg_temp.f('cB'))));
select pg_temp.ck('unpaid totals leave out the employed clinician', '0',
  pg_temp.q_as(pg_temp.f('ops'), format($q$select count(*) from public.payout_unpaid_summary(%L) where clinician_id = %L$q$, current_date - 1, pg_temp.f('cE'))));

create temp table prep(r jsonb) on commit drop;
grant all on prep to public;
insert into prep select public.prepare_payout_drafts(current_date - 7, current_date - 1) where false;
do $$ declare r jsonb; begin
  perform pg_temp.act(pg_temp.f('ops'));
  r := public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
  insert into prep values (r);
end $$;

select pg_temp.ck('ops prepared a draft for the real clinician (4000 kobo, 2 lines, draft)', '4000/2/draft',
  (select amount_kobo || '/' || line_count || '/' || state from public.payouts where id = pg_temp.payout_of(pg_temp.f('cA'))));
select pg_temp.ck('the preparer is recorded', pg_temp.f('ops')::text, (select prepared_by::text from public.payouts where id = pg_temp.payout_of(pg_temp.f('cA'))));
select pg_temp.ck('the fee schedule version used is recorded (INV-16)', 'true',
  (select (pg_temp.f('sched') = any (fee_schedule_version_ids))::text from public.payouts where id = pg_temp.payout_of(pg_temp.f('cA'))));
select pg_temp.ck('a test clinician gets no payout', '0', (select count(*) from public.payouts where clinician_id = pg_temp.f('cB'))::text);
select pg_temp.ck('an employed clinician gets no payout', '0', (select count(*) from public.payouts where clinician_id = pg_temp.f('cE'))::text);
select pg_temp.ck('a test earning is never in a payout', '0',
  (select count(*) from public.payout_lines pl join public.earnings_ledger l on l.id = pl.ledger_id where l.is_test and pl.payout_id = pg_temp.payout_of(pg_temp.f('cA')))::text);
select pg_temp.ck('a negative total makes no draft', '0', (select count(*) from public.payouts where clinician_id = pg_temp.f('cN'))::text);
select pg_temp.ck('and is counted as skipped', 'true', (select ((r ->> 'skipped_not_positive')::integer >= 1)::text from prep));
select pg_temp.ck('every payout is owed to a clinician, never a patient balance (INV-09)', '0',
  (select count(*) from public.payouts p where not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.clinician_id))::text);

-- ---------------------------------------------------------------------------
-- 2. Idempotent, top-up, nothing double counted
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; begin
  perform pg_temp.act(pg_temp.f('ops'));
  r := public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
  perform pg_temp.setf('dummy', gen_random_uuid());
  insert into results values ('real', 'a second prepare for the same period creates and tops up nothing', '0/0', (r ->> 'created') || '/' || (r ->> 'topped_up'));
end $$;
select pg_temp.ck('still one payout for the clinician and period', '1',
  (select count(*) from public.payouts where clinician_id = pg_temp.f('cA') and state <> 'cancelled')::text);
select pg_temp.ck('and the amount is unchanged', '4000', (select amount_kobo::text from public.payouts where id = pg_temp.payout_of(pg_temp.f('cA'))));

select pg_temp.line(pg_temp.f('cA'), 700, 8) is not null as _ \gset
do $$ declare r jsonb; begin
  perform pg_temp.act(pg_temp.f('ops'));
  r := public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
  insert into results values ('real', 'a new earning tops the same draft up', '1/0', (r ->> 'topped_up') || '/' || (r ->> 'created'));
end $$;
select pg_temp.ck('draft is now 4700 over 3 lines, still one payout', '4700/3/1',
  (select amount_kobo || '/' || line_count || '/' || (select count(*) from public.payouts where clinician_id = pg_temp.f('cA') and state <> 'cancelled')
     from public.payouts where id = pg_temp.payout_of(pg_temp.f('cA'))));
select pg_temp.ck('no earning is in two non-cancelled payouts', '0',
  (select count(*) from (select ledger_id from public.payout_lines where released_at is null group by ledger_id having count(*) > 1) d)::text);
select pg_temp.ck('a second active link for one earning is refused by the table', '23505',
  (select case when pg_temp.owner_try(format('insert into public.payout_lines (payout_id, ledger_id, amount_kobo) select %L, ledger_id, amount_kobo from public.payout_lines where payout_id = %L limit 1',
        pg_temp.payout_of(pg_temp.f('cC')), pg_temp.payout_of(pg_temp.f('cA'))), true) like '%payout_lines_one_active_per_ledger_line%' then '23505' else 'other' end));

-- ---------------------------------------------------------------------------
-- 3. Maker-checker
-- ---------------------------------------------------------------------------
-- an admin prepares cD and cF drafts too (period same); ops prepared cA, cC (all in the first run). Make admin1 the preparer of a draft by cancelling and redoing cF.
do $$ declare r jsonb; begin
  -- cF's line was drafted by ops in the first run; ops withdraws it, then admin1 prepares it again
  perform pg_temp.act(pg_temp.f('ops'));
  perform public.cancel_payout(pg_temp.payout_of(pg_temp.f('cF')), 'withdrawn so the admin prepares this one');
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('admin'));
  r := public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
end $$;
select pg_temp.ck('the admin can prepare too (a draft by admin1 exists for cF)', pg_temp.f('admin')::text,
  (select prepared_by::text from public.payouts where id = pg_temp.payout_of(pg_temp.f('cF'))));

select pg_temp.ck('ops cannot approve a draft', 'payout_not_authorised',
  pg_temp.try_as(pg_temp.f('ops'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'ops tries to approve this')));
select pg_temp.ck('a plain clinician cannot approve', 'payout_not_authorised',
  pg_temp.try_as(pg_temp.f('plain'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'a clinician tries to approve')));
select pg_temp.ck('the preparer cannot approve their own draft (admin1 on cF)', 'payout_same_person',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cF')), 'approving my own draft')));
select pg_temp.ck('the draft is still a draft after that refusal', 'draft', (select state from public.payouts where id = pg_temp.payout_of(pg_temp.f('cF'))));
select pg_temp.ck('a note is required', 'payout_note_needed',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'short')));
select pg_temp.ck('a different admin approves with a note', 'ok',
  pg_temp.try_as(pg_temp.f('admin2'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cF')), 'Checked the lines against the ledger')));
select pg_temp.ck('admin1 approves the ops-prepared draft', 'ok',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'Checked the lines against the ledger')));
select pg_temp.ck('the approver and note are recorded', pg_temp.f('admin')::text || '/approved',
  (select approved_by::text || '/' || state from public.payouts where id = pg_temp.payout_of(pg_temp.f('cA'))));
select pg_temp.ck('an already approved payout cannot be approved again', 'payout_not_draft',
  pg_temp.try_as(pg_temp.f('admin2'), format('select public.approve_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'approving it a second time')));
select pg_temp.ck('every approval and every prepare wrote an audit row (cA: create and top-up, cF: one)', '2/3',
  (select (select count(*) from public.audit_log where action = 'payout.approved' and entity_id in (pg_temp.payout_of(pg_temp.f('cA')), pg_temp.payout_of(pg_temp.f('cF'))))
          || '/' || (select count(*) from public.audit_log where action = 'payout.prepared' and entity_id in (pg_temp.payout_of(pg_temp.f('cA')), pg_temp.payout_of(pg_temp.f('cF'))) and actor_id in (pg_temp.f('ops'), pg_temp.f('admin')))));

-- ---------------------------------------------------------------------------
-- 4. Immutability and cancellation
-- ---------------------------------------------------------------------------
select pg_temp.ck('an approved payout amount cannot be edited (owner, flag on)', 'an approved payout cannot be edited',
  pg_temp.owner_try(format('update public.payouts set amount_kobo = 1 where id = %L', pg_temp.payout_of(pg_temp.f('cA'))), true));
select pg_temp.ck('nor the approver or note rewritten', 'an approved payout cannot be edited',
  pg_temp.owner_try(format('update public.payouts set approval_note = %L where id = %L', 'rewritten note text', pg_temp.payout_of(pg_temp.f('cA'))), true));
select pg_temp.ck('nor edited with the flag off', 'payouts are written only by the payout functions',
  pg_temp.owner_try(format('update public.payouts set amount_kobo = 1 where id = %L', pg_temp.payout_of(pg_temp.f('cA'))), false));
select pg_temp.ck('an approved payout cannot be sent back to draft', 'a payout cannot move from approved to draft',
  pg_temp.owner_try(format('update public.payouts set state = %L where id = %L', 'draft', pg_temp.payout_of(pg_temp.f('cA'))), true));
select pg_temp.ck('a payout is never deleted', 'payouts are never deleted: cancel one instead',
  pg_temp.owner_try(format('delete from public.payouts where id = %L', pg_temp.payout_of(pg_temp.f('cA'))), true));
select pg_temp.ck('a line cannot be added to an approved payout', 'lines can only be added to a draft payout',
  pg_temp.owner_try(format('insert into public.payout_lines (payout_id, ledger_id, amount_kobo) values (%L, %L, 1)', pg_temp.payout_of(pg_temp.f('cA')), (select id from public.earnings_ledger where clinician_id = pg_temp.f('cN') limit 1)), true));
select pg_temp.ck('a payout line cannot be edited', 'payout lines cannot be edited',
  pg_temp.owner_try(format('update public.payout_lines set amount_kobo = 1 where payout_id = %L', pg_temp.payout_of(pg_temp.f('cA'))), true));
select pg_temp.ck('a signed-in user cannot write the table directly', 'permission denied for table payouts',
  pg_temp.try_as(pg_temp.f('admin'), format('update public.payouts set amount_kobo = 1 where id = %L', pg_temp.payout_of(pg_temp.f('cA')))));
select pg_temp.ck('ops cannot cancel an approved payout', 'payout_not_authorised',
  pg_temp.try_as(pg_temp.f('ops'), format('select public.cancel_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'ops tries to cancel an approved one')));
select pg_temp.ck('a cancel needs a reason', 'payout_reason_needed',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.cancel_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'no')));

-- the clinician sees their own approved payout, not a draft; others see nothing
select pg_temp.ck('a clinician reads their own approved payout', '1', pg_temp.q_as(pg_temp.f('cA'), 'select count(*) from public.payouts'));
select pg_temp.ck('a clinician does not read a draft (cC is still a draft)', '0', pg_temp.q_as(pg_temp.f('cC'), 'select count(*) from public.payouts'));
select pg_temp.ck('a patient reads no payout', '0', pg_temp.q_as(pg_temp.f('pat'), 'select count(*) from public.payouts'));
select pg_temp.ck('a plain clinician reads no payout', '0', pg_temp.q_as(pg_temp.f('plain'), 'select count(*) from public.payouts'));

-- cancel releases the lines for a later draft
select pg_temp.ck('ops withdraws a draft (cD)', 'ok',
  pg_temp.try_as(pg_temp.f('ops'), format('select public.cancel_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cD')), 'withdrawn while checking the period')));
select pg_temp.ck('the withdrawn draft released its line', '0',
  (select count(*) from public.payout_lines pl join public.payouts p on p.id = pl.payout_id where p.clinician_id = pg_temp.f('cD') and pl.released_at is null)::text);
do $$ declare r jsonb; begin
  perform pg_temp.act(pg_temp.f('ops'));
  r := public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
  insert into results values ('real', 'a later prepare re-drafts the released earning once', '1', (r ->> 'created'));
end $$;
select pg_temp.ck('cD has one live payout again and one cancelled', '1/1',
  (select count(*) filter (where state <> 'cancelled') || '/' || count(*) filter (where state = 'cancelled') from public.payouts where clinician_id = pg_temp.f('cD')));

-- ---------------------------------------------------------------------------
-- 5. No money moves
-- ---------------------------------------------------------------------------
select pg_temp.ck('mark sent is refused while the payouts_enabled guard is off', 'payouts_guard_off',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.mark_payout_sent(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'TRF_test_code')));
select pg_temp.ck('ops can read the guard state (off)', 'false', pg_temp.q_as(pg_temp.f('ops'), 'select public.payouts_guard_is_on()'));
select pg_temp.ck('a patient cannot read the guard state', 'ERR:payout_not_authorised', pg_temp.q_as(pg_temp.f('pat'), 'select public.payouts_guard_is_on()'));
select pg_temp.ck('and the guard really is off in this proof database', 'false', (select is_on::text from public.go_live_guards where key = 'payouts_enabled'));
select pg_temp.ck('ops cannot mark sent', 'payout_not_authorised',
  pg_temp.try_as(pg_temp.f('ops'), format('select public.mark_payout_sent(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'TRF_test_code')));
select pg_temp.ck('nothing is linked to the ledger as paid', '0', (select count(*) from public.earnings_ledger where payout_id is not null)::text);

-- the open path, with the guard stubbed ON for this transaction only
do $$ begin
  execute 'create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable as $b$ select true $b$';
end $$;
select pg_temp.ck('with the guard on, a transfer code is required', 'payout_transfer_code_needed',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.mark_payout_sent(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'x')));
select pg_temp.ck('with the guard on, the admin records it as sent', 'ok',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.mark_payout_sent(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'TRF_test_code')));
select pg_temp.ck('and the earnings are linked as paid', '3',
  (select count(*) from public.earnings_ledger where payout_id = pg_temp.payout_of(pg_temp.f('cA')))::text);
select pg_temp.ck('a sent payout cannot be cancelled', 'payout_not_cancellable',
  pg_temp.try_as(pg_temp.f('admin'), format('select public.cancel_payout(%L, %L)', pg_temp.payout_of(pg_temp.f('cA')), 'trying to cancel a sent one')));

-- ---------------------------------------------------------------------------
-- SABOTAGE
-- ---------------------------------------------------------------------------
do $$
declare
  v_orig text; v_def text; v_elig text; v_pid uuid;
begin
  -- a fresh draft prepared by admin1 for a new clinician
  perform pg_temp.setf('cS', pg_temp.mkdoc(pg_temp.f('org'), 'cS', 'contracted', false, pg_temp.f('admin')));
  perform pg_temp.line(pg_temp.f('cS'), 900, 9);
  perform pg_temp.act(pg_temp.f('admin'));
  perform public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
  v_pid := pg_temp.payout_of(pg_temp.f('cS'));
  insert into results values ('real', 'control: the preparer cannot approve their own draft', 'payout_same_person',
    pg_temp.try_as(pg_temp.f('admin'), format('select public.approve_payout(%L, %L)', v_pid, 'approving my own draft')));

  v_orig := pg_get_functiondef('public.approve_payout(uuid,text)'::regprocedure);
  v_def := replace(v_orig, 'if p.prepared_by = v_uid then raise exception ''payout_same_person'' using errcode = ''42501''; end if;', '');
  if v_def = v_orig then raise exception 'SABOTAGE not applied (maker-checker)'; end if;
  execute v_def;
  alter table public.payouts drop constraint payouts_maker_checker;
  insert into results values ('sabotaged', 'the preparer cannot approve their own draft', 'payout_same_person',
    pg_temp.try_as(pg_temp.f('admin'), format('select public.approve_payout(%L, %L)', v_pid, 'approving my own draft')));
  execute v_orig;

  -- test filter removed from the eligible lines: the test clinician must now be drafted
  v_elig := pg_get_functiondef('private.payout_eligible_lines(uuid,date)'::regprocedure);
  v_def := replace(v_elig, 'and not l.is_test and not cs.is_test and not coalesce(p.is_test, false)', '');
  if v_def = v_elig then raise exception 'SABOTAGE not applied (test filter)'; end if;
  execute v_def;
  perform pg_temp.act(pg_temp.f('ops'));
  perform public.prepare_payout_drafts(current_date - 7, current_date - 1);
  perform pg_temp.back();
  insert into results values ('sabotaged', 'a test clinician gets no payout', '0', (select count(*) from public.payouts where clinician_id = pg_temp.f('cB'))::text);
  execute v_elig;

  -- the one-active-link index dropped: a second active link for one earning is accepted
  drop index public.payout_lines_one_active_per_ledger_line;
  insert into results values ('sabotaged', 'a second active link for one earning is refused by the table', '23505',
    case when pg_temp.owner_try(format('insert into public.payout_lines (payout_id, ledger_id, amount_kobo) select %L, ledger_id, amount_kobo from public.payout_lines where payout_id = %L limit 1',
        pg_temp.payout_of(pg_temp.f('cC')), pg_temp.payout_of(pg_temp.f('cC'))), true) like '%payout_lines_one_active_per_ledger_line%' then '23505' else 'other' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36f proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
