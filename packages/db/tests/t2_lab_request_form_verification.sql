-- Tarragon Health: a printed laboratory request form can be checked as genuine with no login (20261104233138).
--
--  1. every new lab order gets a 64-hex token and a 10-character code; a value the client supplies is thrown away;
--  2. neither can be changed afterwards;
--  3. an anonymous caller with the token, or the code typed with a dash and in lower case, gets proof: status, reference, issue date,
--     the tests, the patient's INITIALS and who requested it; never the name, date of birth or patient number;
--  4. an unknown, malformed or partial reference returns nothing; a cancelled request says cancelled; once a sample has been taken
--     (collected, processing, rejected, resulted) it says used; a scheduled request names the schedule, a patient's own choice the patient;
--  5. the helpers are not callable by a client role.
-- Sabotage (in rolled-back sub-blocks): the stamp keeps a client value -> check 1 flips; the function returns the full name -> check 3 flips;
-- only 'resulted' counts as used -> check 4b flips.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/t2_lab_request_form_verification.sql

begin;

create function pg_temp.verify_as_anon(p_ref text) returns setof jsonb language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  return query select to_jsonb(v) from public.verify_lab_request_public(p_ref) v;
  reset role;
end $f$;

create function pg_temp.check_no_name(p_pat uuid, p_ref text) returns boolean language plpgsql as
$f$ declare j jsonb; pr public.profiles%rowtype;
begin
  select * into pr from public.profiles where id = p_pat;
  select x into j from pg_temp.verify_as_anon(p_ref) x limit 1;
  reset role;
  return j is not null
     and position(lower(pr.full_name) in lower(j::text)) = 0
     and position('okafor' in lower(j::text)) = 0
     and position(coalesce(pr.patient_number, '#none#') in j::text) = 0
     and position(to_char(pr.date_of_birth, 'YYYY-MM-DD') in j::text) = 0
     and j ->> 'patient_initials' = 'A. O.';
end $f$;

do $proof$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_bundle uuid;
  o public.lab_orders%rowtype;
  o2 public.lab_orders%rowtype;
  o3 public.lab_orders%rowtype;
  v_status text; v_expect text;
  v_sched uuid;
  j jsonb;
  v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_bundle from public.panel_bundles where name = 'Diabetes Check' and self_bookable;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 't2rv-' || v_pat || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Adaeze Okafor', is_test = true, is_active = true,
         date_of_birth = '1980-03-14', sex = 'female' where id = v_pat;

  -- 1. stamped, client value thrown away
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, request_verification_token, request_verification_code)
  values (v_org, v_pat, v_bundle, repeat('a', 64), 'AAAAAAAAAA') returning * into o;
  if o.request_verification_token !~ '^[0-9a-f]{64}$' or o.request_verification_code !~ '^[2-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'FAIL 1: token or code missing or malformed';
  end if;
  if o.request_verification_token = repeat('a', 64) or o.request_verification_code = 'AAAAAAAAAA' then
    raise exception 'FAIL 1: a client-supplied token or code was kept';
  end if;

  -- 2. never changed
  update public.lab_orders set request_verification_token = repeat('b', 64), request_verification_code = 'BBBBBBBBBB' where id = o.id;
  select * into o2 from public.lab_orders where id = o.id;
  if o2.request_verification_token <> o.request_verification_token or o2.request_verification_code <> o.request_verification_code then
    raise exception 'FAIL 2: the token or code changed after insert';
  end if;

  -- 2b. the patient's own session can read them (the PDF route reads them with it; lab_orders is read through column grants)
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_orders where id = o.id and request_verification_token = o.request_verification_token
     and request_verification_code = o.request_verification_code;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if v_n <> 1 then raise exception 'FAIL 2b: the patient cannot read the verification code of their own request'; end if;

  -- 3. proof by token and by code; no identifier
  select x into j from pg_temp.verify_as_anon(o.request_verification_token) x limit 1;
  reset role;
  if j is null or j ->> 'status' <> 'valid' or j ->> 'order_number' is distinct from o.order_number
     or (j ->> 'issued_on')::date <> (o.ordered_at at time zone 'Africa/Lagos')::date
     or jsonb_array_length(j -> 'tests') < 2 or j ->> 'requested_by' <> 'the patient, through TarragonHealth' then
    raise exception 'FAIL 3: the token check did not return the expected proof: %', j;
  end if;
  if not pg_temp.check_no_name(v_pat, o.request_verification_token) then raise exception 'FAIL 3: the proof carries an identifier or wrong initials'; end if;
  select count(*) into v_n from pg_temp.verify_as_anon(lower(substr(o.request_verification_code, 1, 5) || '-' || substr(o.request_verification_code, 6)));
  reset role;
  if v_n <> 1 then raise exception 'FAIL 3: the typed code (lower case, with a dash) was not accepted'; end if;

  -- 4. unknown, malformed, partial; cancelled
  select count(*) into v_n from pg_temp.verify_as_anon(repeat('c', 64)); reset role;
  if v_n <> 0 then raise exception 'FAIL 4: an unknown token returned a row'; end if;
  select count(*) into v_n from pg_temp.verify_as_anon(substr(o.request_verification_code, 1, 9)); reset role;
  if v_n <> 0 then raise exception 'FAIL 4: a partial code returned a row'; end if;
  select count(*) into v_n from pg_temp.verify_as_anon('''; select 1; --'); reset role;
  if v_n <> 0 then raise exception 'FAIL 4: a malformed reference returned a row'; end if;
  update public.lab_orders set status = 'cancelled' where id = o.id;
  select x into j from pg_temp.verify_as_anon(o.request_verification_code) x limit 1; reset role;
  if j ->> 'status' <> 'cancelled' then raise exception 'FAIL 4: a cancelled request did not say cancelled'; end if;
  update public.lab_orders set status = 'ordered' where id = o.id;

  -- 4b. once a laboratory has taken a sample against the form it reads as already used, so a second laboratory does not run it
  --     again; before that it is valid. Statuses set with user triggers off: this proves the check's mapping, not the lab workflow.
  alter table public.lab_orders disable trigger user;
  foreach v_status in array array['sample_collected', 'processing', 'sample_rejected', 'resulted', 'pending_payment', 'payment_confirmed', 'ordered'] loop
    update public.lab_orders set status = v_status::public.lab_order_status, rejection_reason = 'proof: sample haemolysed', rejected_at = now() where id = o.id;
    select x into j from pg_temp.verify_as_anon(o.request_verification_code) x limit 1; reset role;
    v_expect := (case when v_status in ('pending_payment', 'payment_confirmed', 'ordered') then 'valid' else 'used' end);
    if j ->> 'status' is distinct from v_expect then
      raise exception 'FAIL 4b: a request in status % reads as %', v_status, j ->> 'status';
    end if;
  end loop;
  alter table public.lab_orders enable trigger user;

  -- 4c. who requested it: a request issued from a screening schedule says the preventive schedule; one the patient chose says the patient
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
  values (v_org, v_pat, (select id from public.screen_types where code = 'hba1c'), 'pending', current_date) returning id into v_sched;
  perform set_config('tarragon.screening_request_job', 'on', true);
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, screening_schedule_id)
  values (v_org, v_pat, (select id from public.panel_bundles where name = 'HbA1c' and test_codes = array['hba1c'] limit 1), v_sched) returning * into o3;
  perform set_config('tarragon.screening_request_job', 'off', true);
  select x into j from pg_temp.verify_as_anon(o3.request_verification_token) x limit 1; reset role;
  if j ->> 'requested_by' <> 'the patient''s TarragonHealth preventive schedule' then
    raise exception 'FAIL 4c: a scheduled request was attributed to %', j ->> 'requested_by';
  end if;

  -- 5. privileges
  if not has_function_privilege('anon', 'public.verify_lab_request_public(text)', 'EXECUTE') then raise exception 'FAIL 5: anon cannot check'; end if;
  if has_function_privilege('anon', 'private.stamp_lab_request_verification()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.new_request_verification_token()', 'EXECUTE') then
    raise exception 'FAIL 5: a private helper is callable by a client role';
  end if;

  -- SABOTAGE A: the stamp keeps whatever the client sent -> check 1 must flip
  begin
    execute $s$create or replace function private.stamp_lab_request_verification() returns trigger language plpgsql security definer set search_path = '' as $b$
      begin
        if tg_op = 'INSERT' then
          new.request_verification_token := coalesce(new.request_verification_token, private.new_request_verification_token());
          new.request_verification_code := coalesce(new.request_verification_code, private.new_request_verification_code());
        end if;
        return new;
      end $b$$s$;
    insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, request_verification_token, request_verification_code)
    values (v_org, v_pat, v_bundle, repeat('d', 64), 'DDDDDDDDDD') returning * into o2;
    if o2.request_verification_token <> repeat('d', 64) then raise exception 'VACUOUS A: sabotaged stamp still threw the client value away'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then
    if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;

  -- SABOTAGE B: the check returns the full name -> the no-identifier check must flip
  begin
    execute replace(pg_get_functiondef('public.verify_lab_request_public(text)'::regprocedure),
                    'private.name_initials((select p.full_name', '((select p.full_name');
    if pg_temp.check_no_name(v_pat, o.request_verification_token) then raise exception 'VACUOUS B: the full name passed the no-identifier check'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then
    if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;
  reset role;

  -- SABOTAGE C: only 'resulted' counts as used (the old mapping) -> a collected sample reads as valid, check 4b must flip
  begin
    execute replace(pg_get_functiondef('public.verify_lab_request_public(text)'::regprocedure),
                    'when o.status in (''sample_collected'', ''processing'', ''sample_rejected'', ''resulted'') then', 'when o.status = ''resulted'' then');
    alter table public.lab_orders disable trigger user;
    update public.lab_orders set status = 'sample_collected' where id = o.id;
    alter table public.lab_orders enable trigger user;
    select x into j from pg_temp.verify_as_anon(o.request_verification_code) x limit 1; reset role;
    if j ->> 'status' = 'used' then raise exception 'VACUOUS C: the used mapping is not tested'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;
  reset role;

  -- restored after the sabotage blocks
  if not pg_temp.check_no_name(v_pat, o.request_verification_token) then raise exception 'FAIL: the function was not restored after sabotage'; end if;
  raise notice 't2_lab_request_form_verification: PASS';
end $proof$;

rollback;
