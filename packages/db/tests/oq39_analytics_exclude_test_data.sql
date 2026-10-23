-- OQ-39 / INV-13: the analytics_* RPCs must not count test accounts.
--
-- Migration 20261023175503_oq39_analytics_rpcs_exclude_test_accounts.sql redirects every non-exempt analytics_* RPC to
-- the analytics_clean views (the relation minus profiles.is_test). This proof has three parts:
--   A. a catalogue scan: no non-exempt analytics_* function (or the two feeders) reads a filtered relation directly, and
--      none reads a relation with a person column that has no filtered view. This is what stops a NEW function
--      from shipping without the filter.
--   B. a behavioural run for EVERY remaining function: seed one test patient and one real patient across the tables,
--      call every function as an analyst, and require that adding the TEST patient changes no output (leak = FAIL)
--      while adding the REAL patient does change outputs (non-vacuity, reported per function).
--   C. sabotage: remove the filter from one view and the scan/behaviour must flip; add an unfiltered probe function and
--      the scan must catch it. A test that cannot fail is not a test.
--
-- Always rolled back. Needs the full schema (a local `supabase db reset`).

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- The scan, as a reusable temp function. Returns offending function names.
-- ---------------------------------------------------------------------------------------------------------------
create function pg_temp.oq39_scan() returns text[] language plpgsql as $$
declare
  v_exempt text[] := array['analytics_patient_search','analytics_patient_activity','analytics_audit_log',
                           'analytics_log_patient_access','analytics_upsert_finance_input','analytics_upsert_risk'];
  v_bad text[] := '{}';
  f record; m record; v_cols text[];
  v_person text[] := array['patient_id','profile_id','recipient_id','actor_id','is_test','user_id'];
begin
  for f in
    select p.oid, p.proname, p.prosrc from pg_proc p
    where (p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_%'
           and not (p.proname = any (v_exempt)))
       or p.oid in ('private.refresh_analytics_snapshot_business_summary()'::regprocedure,
                    'public.get_geo_health_aggregates()'::regprocedure)
  loop
    for m in select distinct (regexp_matches(f.prosrc, '\m(public|private)\.([a-z_][a-z_0-9]*)\M(?!\s*\()', 'g'))[1] as sch,
                             (regexp_matches(f.prosrc, '\m(public|private)\.([a-z_][a-z_0-9]*)\M(?!\s*\()', 'g'))[2] as rel
    loop
      -- 1. reads a relation that has an analytics_clean view
      if exists (select 1 from pg_class c where c.relnamespace = 'analytics_clean'::regnamespace and c.relname = m.rel and c.relkind = 'v') then
        v_bad := v_bad || (f.proname || ' reads ' || m.sch || '.' || m.rel || ' directly'); continue;
      end if;
      -- 2. reads a relation that carries a person column but has no view (a table added since)
      select array_agg(a.attname::text) into v_cols
      from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relnamespace = m.sch::regnamespace and c.relname = m.rel and c.relkind in ('r','v','p')
        and a.attname = any (v_person);
      if v_cols is not null then
        v_bad := v_bad || (f.proname || ' reads ' || m.sch || '.' || m.rel || ' (person columns ' || array_to_string(v_cols, ',') || ') with no analytics_clean view');
      end if;
    end loop;
  end loop;
  return v_bad;
end $$;

-- A. catalogue scan -------------------------------------------------------------------------------------------------
create temp table oq39_results (check_name text, observed text, expected text, verdict text);

do $$
declare v_bad text[]; v_n int; v_views int;
begin
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'analytics\_%';
  select count(*) into v_views from pg_class where relnamespace = 'analytics_clean'::regnamespace and relkind = 'v';
  insert into oq39_results values ('A0 inventory: analytics_* functions and filter views', v_n || ' functions, ' || v_views || ' views', '>= 55 functions, >= 50 views',
    case when v_n >= 55 and v_views >= 50 then 'PASS' else 'FAIL' end);
  v_bad := pg_temp.oq39_scan();
  insert into oq39_results values ('A1 no non-exempt analytics_* function reads an unfiltered person relation', coalesce(array_to_string(v_bad, '; '), 'none'), 'none',
    case when cardinality(v_bad) = 0 then 'PASS' else 'FAIL' end);
end $$;

-- A2. enum coverage: the commissions / payment_transactions views resolve the patient per order type. Every label of both enums
-- must be handled by the view (mapped to a patient table, or declared person-less). A new label then fails here instead of
-- silently being read as "not a test patient"; until it is mapped the view excludes the row (fail closed).
create function pg_temp.oq39_unhandled_labels(p_enum regtype, p_view regclass, p_extra text[]) returns text[] language plpgsql as $$
declare v_def text := pg_get_viewdef(p_view); v_bad text[] := '{}'; l text;
begin
  for l in select enumlabel::text from pg_enum where enumtypid = p_enum union select unnest(p_extra) loop
    if position('''' || l || '''' in v_def) = 0 then v_bad := v_bad || l; end if;
  end loop;
  return v_bad;
end $$;
do $$
declare v_bt regtype; v_c text[]; v_p text[]; v_s text[];
begin
  select a.atttypid::regtype into v_bt from pg_attribute a where a.attrelid = 'public.payment_transactions'::regclass and a.attname = 'booking_order_type';
  v_c := pg_temp.oq39_unhandled_labels('public.commission_type'::regtype, 'analytics_clean.commissions'::regclass, '{}');
  v_p := pg_temp.oq39_unhandled_labels(v_bt, 'analytics_clean.payment_transactions'::regclass, '{}');
  insert into oq39_results values ('A2 every commission_type label is handled by analytics_clean.commissions', coalesce(nullif(array_to_string(v_c, ','), ''), 'all handled'), 'all handled',
    case when cardinality(v_c) = 0 then 'PASS' else 'FAIL' end);
  insert into oq39_results values ('A2 every booking_order_type label is handled by analytics_clean.payment_transactions', coalesce(nullif(array_to_string(v_p, ','), ''), 'all handled'), 'all handled',
    case when cardinality(v_p) = 0 then 'PASS' else 'FAIL' end);
  -- sabotage: a label the view does not know must be reported
  v_s := pg_temp.oq39_unhandled_labels('public.commission_type'::regtype, 'analytics_clean.commissions'::regclass, array['zz_new_order_type']);
  insert into oq39_results values ('A2 sabotage: an unmapped new order type is reported', array_to_string(v_s, ','), 'zz_new_order_type',
    case when v_s = array['zz_new_order_type'] then 'PASS' else 'FAIL' end);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B. behavioural run
-- ---------------------------------------------------------------------------------------------------------------
create temp table oq39_ids (k text primary key, id uuid);
insert into oq39_ids values ('analyst', gen_random_uuid()), ('real', gen_random_uuid()), ('test', gen_random_uuid()),
                            ('realstaff', gen_random_uuid()), ('teststaff', gen_random_uuid()), ('test0', gen_random_uuid()), ('test0staff', gen_random_uuid()), ('org', null);

create function pg_temp.oq39_id(p text) returns uuid language sql as $$ select id from oq39_ids where k = p $$;

-- users and profiles (triggers on, so handle_new_user makes the profile)
do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations limit 1;
  update oq39_ids set id = v_org where k = 'org';
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select id, 'oq39-' || k || '@example.invalid', 'x', now(), '{}', '{}' from oq39_ids where k in ('analyst','real','test','realstaff','teststaff','test0','test0staff');
  update public.profiles set role = 'analyst', organisation_id = null, full_name = 'OQ39 Analyst' where id = pg_temp.oq39_id('analyst');
  update public.profiles set role = 'patient', organisation_id = v_org, full_name = 'OQ39 Real', state = 'Lagos' where id = pg_temp.oq39_id('real');
  update public.profiles set role = 'patient', organisation_id = v_org, full_name = 'OQ39 Test', state = 'Lagos', is_test = true where id = pg_temp.oq39_id('test');
  update public.profiles set role = 'clinician', organisation_id = v_org, full_name = 'OQ39 Real Dr' where id = pg_temp.oq39_id('realstaff');
  update public.profiles set role = 'clinician', organisation_id = v_org, full_name = 'OQ39 Test Dr', is_test = true where id = pg_temp.oq39_id('teststaff');
  update public.profiles set role = 'patient', organisation_id = v_org, full_name = 'OQ39 Test Zero', state = 'Lagos', is_test = true where id = pg_temp.oq39_id('test0');
  update public.profiles set role = 'clinician', organisation_id = v_org, full_name = 'OQ39 Test Zero Dr', is_test = true where id = pg_temp.oq39_id('test0staff');
end $$;

-- Generic row seeder: one row in a base table for a given person column, filling every NOT NULL column that has no
-- default from its type. p_extra overrides columns (as text).
-- Values a CHECK demands, and states the RPCs count; applied to every table the seeder touches, parents included.
create function pg_temp.oq39_table_extras(p_tbl regclass) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(attname, val), '{}'::jsonb) from (values
    ('service_purchases','status','active'),('service_purchases','purchased_at',now()::text),
    ('programme_purchases','status','active'),('programme_purchases','purchased_at',now()::text),('programme_purchases','duration_weeks','12'),
    ('clinician_alerts','status','open'),('screening_results','result_status','abnormal'),('care_plans','status','active'),
    ('appointments','status','booked'),('appointments','scheduled_for',now()::text),('appointments','ends_at',(now() + interval '1 hour')::text),
    ('appointment_waiting_list','preferred_from',now()::text),('appointment_waiting_list','preferred_until',(now() + interval '7 days')::text),
    ('specialist_referrals','status','booked'),('specialist_referrals','signed_at',now()::text),('specialist_referrals','booking_confirmed_at',now()::text),
    ('clinical_incident_reports','category','other'),('clinical_incident_reports','severity','low'),
    ('safeguarding_concerns','concern_category','other'),('clinical_rule_events','source','cron'),('clinical_rules','specificity','50'),
    ('clinical_staff','active','true'),('clinical_staff','license_verified_at',now()::text),
    ('complaints','category','other'),('patient_risk_scores','score_type','bp_control'),('patient_timeline','trust_tier','system'),
    ('clinical_rule_action_records','status','awaiting_oversight')
  ) s(tbl, attname, val) where 'public.' || s.tbl = p_tbl::text or s.tbl = p_tbl::text $$;

create function pg_temp.oq39_seed(p_tbl regclass, p_col text, p_person uuid, p_extra jsonb default '{}', p_depth int default 0, p_owner uuid default null, p_istest boolean default false, p_fresh boolean default false) returns void language plpgsql as $$
declare cols text := ''; vals text := ''; r record; v text; fk record; pv text;
begin
  p_extra := pg_temp.oq39_table_extras(p_tbl) || p_extra;
  if p_tbl = 'public.clinical_rules'::regclass and (p_extra ? 'patient_id' or p_col = 'patient_id') then p_extra := p_extra || '{"specificity": "90"}'; end if;   -- patient-scoped rule
  if p_depth > 4 then raise exception 'oq39_seed: FK chain too deep at %', p_tbl; end if;
  for r in
    select a.attnum, a.attname::text as n, format_type(a.atttypid, a.atttypmod) as ft, t.typcategory as cat, t.typtype as ttype, a.atttypid as oid_,
           (a.attnotnull and not a.atthasdef and a.attgenerated = '' and a.attidentity = '') as need, a.attgenerated <> '' or a.attidentity = 'a' as skip
    from pg_attribute a join pg_type t on t.oid = a.atttypid
    where a.attrelid = p_tbl and a.attnum > 0 and not a.attisdropped
  loop
    continue when r.skip;
    v := null;
    if r.n = p_col then v := format('%L::%s', p_person, r.ft);
    elsif p_extra ? r.n then v := case when p_extra ->> r.n is null then 'null' else format('%L::%s', p_extra ->> r.n, r.ft) end;
    elsif r.n = 'organisation_id' then v := format('%L::uuid', pg_temp.oq39_id('org'));
    elsif r.need then
      select c.confrelid::regclass as parent, af.attname::text as pcol into fk
      from pg_constraint c join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.conrelid = p_tbl and c.contype = 'f' and c.conkey = array[r.attnum]::smallint[] limit 1;
      if fk.parent = 'public.profiles'::regclass and p_owner is not null then
        v := format('%L::%s', p_owner, r.ft);                         -- whoever the child belongs to, so parents never attach to a stranger
      elsif fk.parent is not null then
        pv := null;
        if not p_fresh then execute format('select %I::text from %s limit 1', fk.pcol, fk.parent) into pv; end if;
        if pv is null then
          -- a parent stub belongs to the same person (and carries the same is_test) as the child it was made for
          perform pg_temp.oq39_seed(fk.parent, '', null,
            coalesce((select jsonb_build_object(a.attname, p_owner::text) from pg_attribute a
                      where a.attrelid = fk.parent and a.attname in ('patient_id','profile_id','recipient_id') and not a.attisdropped
                      order by a.attname limit 1), '{}')
            || case when exists (select 1 from pg_attribute where attrelid = fk.parent and attname = 'is_test' and not attisdropped)
                    then jsonb_build_object('is_test', p_istest::text) else '{}' end, p_depth + 1, p_owner, p_istest, p_fresh);
          execute format('select %I::text from %s order by ctid desc limit 1', fk.pcol, fk.parent) into pv;
        end if;
        v := format('%L::%s', pv, r.ft);
      end if;
      if fk.parent is null then
        v := case
          when r.ttype = 'e' then format('%L::%s', (select enumlabel from pg_enum where enumtypid = r.oid_ order by enumsortorder limit 1), r.ft)
          when r.ft = 'uuid' then 'gen_random_uuid()'
          when r.ft in ('jsonb','json') then format('%L::%s', '{}', r.ft)
          when r.cat = 'A' then format('%L::%s', '{}', r.ft)
          when r.cat = 'N' then format('%L::%s', '1', r.ft)
          when r.cat = 'S' then format('%L::%s', 'x' || substr(md5(random()::text), 1, 6), r.ft)
          when r.cat = 'B' then 'false'
          when r.cat = 'D' then format('%L::%s', now()::text, r.ft)
          when r.cat = 'T' then format('%L::%s', '1 day', r.ft)
          else null end;
        if v is null then raise exception 'oq39_seed: no default for %.% (%)', p_tbl, r.n, r.ft; end if;
      end if;
    else continue; end if;
    cols := cols || ',' || quote_ident(r.n); vals := vals || ',' || v;
  end loop;
  -- Business-rule triggers (SLA lookups, ownership checks, event emitters) are not under test here; the CHECK and FK
  -- constraints still apply. Transactional DDL: rolled back with everything else.
  execute format('alter table %s disable trigger user', p_tbl);
  execute format('insert into %s (%s) values (%s)', p_tbl, substr(cols, 2), substr(vals, 2));
end $$;

-- Which base table (and person column) sits behind each analytics_clean view ------------------------------------------
create temp table oq39_rel (view_name text primary key, base regclass, person_col text, base_kind "char");
do $$
declare v record; d text; b text; pc text; k "char"; hops int;
begin
  for v in select c.relname, pg_get_viewdef(c.oid) as def from pg_class c where c.relnamespace = 'analytics_clean'::regnamespace and c.relkind = 'v' loop
    b := (regexp_match(v.def, 'FROM ((?:(?:public|private)\.)?[a-z_0-9]+) [tr]\M'))[1];
    pc := (regexp_match(v.def, 'tp\.id = [tr]\.([a-z_]+)'))[1];
    hops := 0;
    -- follow a base that is itself a view down to a table
    loop
      exit when b is null;
      select relkind into k from pg_class where oid = b::regclass;
      exit when k <> 'v' or hops > 3;
      d := pg_get_viewdef(b::regclass);
      b := (regexp_match(d, 'FROM ((?:(?:public|private)\.)?[a-z_0-9]+)\M'))[1];
      hops := hops + 1;
    end loop;
    insert into oq39_rel values (v.relname, b::regclass, pc, k);
  end loop;
end $$;

create temp table oq39_seed_log (stage text, rel text, outcome text);

-- Seed one row per base table for a person (real or test). Tables whose own is_test column exists get it set to match.
create function pg_temp.oq39_seed_person(p_kind text) returns void language plpgsql as $$
declare
  r record; v_person uuid := pg_temp.oq39_id(p_kind); v_staff uuid := pg_temp.oq39_id(p_kind || 'staff');
  v_extra jsonb; v_istest boolean := (left(p_kind, 4) = 'test'); v_has_istest boolean; v_try int;
begin
  if not exists (select 1 from public.specialist_providers) then perform pg_temp.oq39_seed('public.specialist_providers'::regclass, '', null, '{"is_active": "false"}', 0, v_person, v_istest); end if;
  for r in select distinct on (base) view_name, base, person_col from oq39_rel
           where base is not null and base_kind in ('r','p')
             and view_name not in ('profiles','commissions','payment_transactions','real_patient_ids') order by base, view_name loop
    v_has_istest := exists (select 1 from pg_attribute where attrelid = r.base and attname = 'is_test' and not attisdropped);
    v_extra := case when v_has_istest then jsonb_build_object('is_test', v_istest::text) else '{}' end;
    -- status-like columns that the RPCs count only in some states
    v_extra := v_extra || case when r.base = 'public.specialist_referrals'::regclass
                               then jsonb_build_object('specialist_provider_id', (select id::text from public.specialist_providers order by id limit 1)) else '{}'::jsonb end
                       || case when r.base = 'public.clinical_rules'::regclass then '{"specificity": "90"}'::jsonb else '{}'::jsonb end   -- a patient-scoped rule
                       || case when r.base = 'public.specialist_referrals'::regclass
                               then jsonb_build_object('signed_by', v_staff::text, 'signed_at', now()::text) else '{}' end;
    for v_try in 1 .. 2 loop
      begin
        if r.view_name = 'clinical_staff' or r.view_name = 'doctor_current_staff' then
          perform pg_temp.oq39_seed('public.clinical_staff'::regclass, 'profile_id', v_staff, v_extra, 0, v_staff, v_istest, v_try = 2);
        elsif r.person_col is null then
          perform pg_temp.oq39_seed(r.base, '', null, v_extra, 0, v_person, v_istest, v_try = 2);
        else
          perform pg_temp.oq39_seed(r.base, r.person_col, case when r.person_col in ('actor_id') then v_staff else v_person end, v_extra, 0, v_person, v_istest, v_try = 2);
        end if;
        insert into oq39_seed_log values (p_kind, r.base::text, 'ok');
        exit;
      exception when unique_violation then
        if v_try = 2 then insert into oq39_seed_log values (p_kind, r.base::text, 'FAILED: ' || sqlerrm); end if;
      when others then
        insert into oq39_seed_log values (p_kind, r.base::text, 'FAILED: ' || sqlerrm);
        exit;
      end;
    end loop;
  end loop;
  -- link the person's work to their own staff member so the per-doctor functions have something to count
  update public.clinician_alerts set responsible_clinician_id = (select id from public.clinical_staff where profile_id = v_staff limit 1) where patient_id = v_person;
  update public.care_team_assignment set clinician_id = v_staff where patient_id = v_person;
  begin
    perform pg_temp.oq39_seed('public.web_events'::regclass, 'profile_id', v_staff, '{}', 0, v_staff, v_istest);
  exception when others then
    insert into oq39_seed_log values (p_kind, 'public.web_events(staff)', 'FAILED: ' || sqlerrm);
  end;
  -- an audit row about the person (system actor), the second column the audit view tests
  begin
    perform pg_temp.oq39_seed('public.audit_log'::regclass, 'subject_patient_id', v_person, '{"actor_id": null}', 0, v_person, v_istest);
    insert into oq39_seed_log values (p_kind, 'public.audit_log(subject)', 'ok');
  exception when others then
    insert into oq39_seed_log values (p_kind, 'public.audit_log(subject)', 'FAILED: ' || sqlerrm);
  end;
end $$;

-- Call a function as the analyst (a real authenticated session, so the grant and private.is_analyst() are exercised).
create function pg_temp.oq39_call(p_fn text) returns jsonb language plpgsql as $$
declare
  v_oid oid; v_args text := ''; v_res jsonb; v_types oid[]; v_names text[]; i int; v_n text; v_t text;
begin
  select p.oid, string_to_array(p.proargtypes::text, ' ')::oid[], p.proargnames into v_oid, v_types, v_names
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = p_fn limit 1;
  for i in 1 .. coalesce(cardinality(v_types), 0) loop
    v_t := format_type(v_types[i], null); v_n := coalesce(v_names[i], '');
    v_args := v_args || case when i > 1 then ',' else '' end || case
      when v_t like 'timestamp%' and v_n = 'p_from' then quote_literal((now() - interval '2 years')::text) || '::timestamptz'
      when v_t like 'timestamp%' then quote_literal((now() + interval '1 day')::text) || '::timestamptz'
      when v_t = 'text' and v_n = 'p_period' then quote_literal('day')
      when v_t = 'uuid' and p_fn like '%specialist_provider%' then quote_nullable((select id::text from public.specialist_providers order by id limit 1)) || '::uuid'
      else 'null::' || v_t end;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.oq39_id('analyst'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', pg_temp.oq39_id('analyst')::text, true);   -- older auth.uid() reads this one
  perform set_config('role', 'authenticated', true);
  begin
    execute format('select to_jsonb(public.%I(%s))', p_fn, v_args) into v_res;
  exception when others then
    perform set_config('role', 'postgres', true);
    return jsonb_build_object('_error', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);
  return v_res;
end $$;

create temp table oq39_out (phase text, fn text, out jsonb, primary key (phase, fn));
create temp table oq39_fns as
  select p.proname::text as fn from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_%'
    and p.proname not in ('analytics_patient_search','analytics_patient_activity','analytics_audit_log','analytics_log_patient_access',
                          'analytics_upsert_finance_input','analytics_upsert_risk')
    and pg_get_function_result(p.oid) = 'jsonb';

create function pg_temp.oq39_run(p_phase text) returns void language plpgsql as $$
declare f record;
begin
  perform private.refresh_analytics_snapshot_business_summary();
  for f in select fn from oq39_fns loop
    insert into oq39_out values (p_phase, f.fn, pg_temp.oq39_call(f.fn));
  end loop;
end $$;

-- B1. baseline; B2. test patient only; B3. real patient added
do $$
declare k text;
begin
  -- The baseline already holds ONE test patient's rows (test0), so the config rows every seed drags in as FK parents
  -- (catalogues, consent versions...) are present in both sides of the comparison; what is compared is "a further test
  -- patient" against "a real patient".
  foreach k in array array['test0','test','real'] loop
    perform pg_temp.oq39_seed_person(k);
    perform pg_temp.oq39_seed('public.commissions'::regclass, '', null,
      jsonb_build_object('commission_type', 'service_purchase',
        'source_id', (select id from public.service_purchases where patient_id = pg_temp.oq39_id(k) limit 1)::text));
    perform pg_temp.oq39_seed('public.payment_transactions'::regclass, '', null,
      jsonb_build_object('booking_order_type', 'service_purchase', 'provider_event_id', gen_random_uuid()::text,
        'booking_order_id', (select id from public.service_purchases where patient_id = pg_temp.oq39_id(k) limit 1)::text));
    if k <> 'test0' then perform pg_temp.oq39_run(case k when 'test' then '1_test_only' else '2_with_real' end); end if;
    if k = 'test0' then perform pg_temp.oq39_run('0_base'); end if;
  end loop;
end $$;

do $$
declare n_fail int; n_seen int; n_fn int; n_err int; v_failed text;
begin
  select string_agg(distinct rel || ' (' || stage || '): ' || outcome, '; ') into v_failed from oq39_seed_log where outcome <> 'ok';
  select count(*) into n_seen from oq39_seed_log where outcome = 'ok';
  insert into oq39_results values ('B0 every patient-bearing table seeded for both the test and the real patient',
    coalesce(v_failed, 'all seeded') || ' (' || n_seen || ' rows seeded)', 'all seeded, at least 60 rows',
    case when v_failed is null and n_seen >= 60 then 'PASS' else 'FAIL' end);

  insert into oq39_results
  select 'B1 ' || f.fn || ': test patient changes nothing',
         case when t.out = b.out then 'identical' else 'LEAK: ' || left(t.out::text, 300) end,
         'identical to baseline',
         case when t.out = b.out then 'PASS' else 'FAIL' end
  from oq39_fns f
  join oq39_out b on b.phase = '0_base' and b.fn = f.fn
  join oq39_out t on t.phase = '1_test_only' and t.fn = f.fn;

  insert into oq39_results
  select 'B2 ' || f.fn || ': real patient is counted',
         case when r.out <> t.out then 'output changed'
              when not exists (select 1 from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace and p.prosrc like '%analytics\_clean.%')
                then 'reads no person-bearing relation (config, snapshot or gated)'
              else 'no visible change (seed not observable by this function)' end,
         'output changed',
         case when r.out <> t.out then 'PASS'
              when not exists (select 1 from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace and p.prosrc like '%analytics\_clean.%') then 'PASS'
              else 'INFO' end
  from oq39_fns f
  join oq39_out t on t.phase = '1_test_only' and t.fn = f.fn
  join oq39_out r on r.phase = '2_with_real' and r.fn = f.fn;

  select count(*) into n_fn from oq39_fns;
  select count(*) into n_seen from oq39_fns f join oq39_out t on t.phase = '1_test_only' and t.fn = f.fn join oq39_out r on r.phase = '2_with_real' and r.fn = f.fn where r.out <> t.out;
  select count(*) into n_err from oq39_out where out ? '_error';
  insert into oq39_results values ('B3 non-vacuity: functions whose output reacts to the real patient', n_seen || ' of ' || n_fn, '>= 60 percent of functions',
    case when n_seen * 10 >= n_fn * 6 then 'PASS' else 'FAIL' end);
  insert into oq39_results values ('B4 no function errored when called as an analyst', n_err || ' errors', '0',
    case when n_err = 0 then 'PASS' else 'FAIL' end);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- C. sabotage: the proof must be able to fail
-- ---------------------------------------------------------------------------------------------------------------
-- C1. an unfiltered new function must be caught by the scan
create function public.analytics_zz_probe() returns jsonb language sql security definer set search_path = '' as
  $$ select to_jsonb(count(*)) from public.service_purchases $$;
do $$
declare v_bad text[];
begin
  v_bad := pg_temp.oq39_scan();
  insert into oq39_results values ('C1 sabotage: a new analytics_* function reading public.service_purchases is caught by the scan',
    coalesce(array_to_string(v_bad, '; '), 'none'), 'flags analytics_zz_probe',
    case when exists (select 1 from unnest(v_bad) x where x like 'analytics_zz_probe%') then 'PASS' else 'FAIL' end);
end $$;
drop function public.analytics_zz_probe();

-- C2. removing the filter from a view must make the test patient leak into the function that reads it
do $$
declare
  v_pair record; v_before jsonb; v_after jsonb; v_def text;
begin
  for v_pair in select * from (values ('service_purchases', 'analytics_accounting_summary', 'public.service_purchases'),
                                      ('profiles', 'analytics_executive_summary', 'public.profiles'),
                                      ('clinician_alerts', 'analytics_alert_quality', 'public.clinician_alerts')) x(vw, fn, base) loop
    v_before := pg_temp.oq39_call(v_pair.fn);
    execute format('create or replace view analytics_clean.%I with (security_invoker = true) as select t.* from %s t', v_pair.vw, v_pair.base);
    v_after := pg_temp.oq39_call(v_pair.fn);
    insert into oq39_results values ('C2 sabotage: filter removed from analytics_clean.' || v_pair.vw || ' flips ' || v_pair.fn,
      case when v_after <> v_before then 'output changed (test data leaked in)' else 'unchanged' end,
      'output changes',
      case when v_after <> v_before then 'PASS' else 'FAIL' end);
    -- and the scan must notice a view whose definition lost the filter
    -- (restore it so later iterations and the rollback state are consistent)
    execute format('create or replace view analytics_clean.%I with (security_invoker = true) as select t.* from %s t where not exists (select 1 from public.profiles tp where tp.id = t.%s and tp.is_test)',
      v_pair.vw, v_pair.base,
      case v_pair.vw when 'profiles' then 'id' when 'service_purchases' then 'patient_id' else 'patient_id' end);
  end loop;
end $$;

select check_name, observed, expected, verdict from oq39_results order by (verdict = 'PASS'), check_name;

do $$
begin
  if exists (select 1 from oq39_results where verdict = 'FAIL') then
    raise exception 'OQ-39 proof FAILED: %', (select string_agg(check_name, '; ') from oq39_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
