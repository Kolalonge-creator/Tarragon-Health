-- S39 proof: a catalog-wide security sweep over EVERY table and role (spec section 13, INV-10/12/13 surface).
-- One rolled-back transaction. It proves, from the live catalog and a simulated session per role:
--   1. RLS is on for every table in public, private and analytics (no exceptions);
--   2. anon holds table grants only on the reviewed public-content tables and EXECUTE only on the reviewed public RPCs
--      (a new one fails this test until someone reviews it and adds it here);
--   3. every SECURITY DEFINER function pins its search_path;
--   4. the only views that run as their owner are the reviewed ones, and none is readable by anon;
--   5. the only public storage buckets are the reviewed ones;
--   6. a person with no relationship to anyone (a patient, a clinician, a care coordinator and a finance user, each in a brand-new
--      organisation) and anon read ZERO rows about anybody else from every table that carries a patient_id. Not covered: tables with an
--      organisation_id but no patient_id, and the admin role (see the note under the allowlists).
-- SABOTAGE: RLS switched off on one table, a function made anon-executable, a view switched to owner rights and an open policy added to a
-- patient table; each of the four checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;

-- reviewed allowlists (any change needs a reason in the commit; see docs/design/S39.md section 4)
create temp table allow(kind text, name text) on commit drop;
grant all on allow to public;
insert into allow values
  -- public content anon may read
  ('anon_table', 'public.consent_versions'), ('anon_table', 'public.public_impact_metrics'), ('anon_table', 'public.patient_testimonials'),
  ('anon_table', 'public.marketing_resources'), ('anon_table', 'public.passport_signing_keys'), ('anon_table', 'public.doctor_testimonials'),
  -- public RPCs anon may execute (token or serial verified, or public catalogue); each is rate-limited or carries no personal data
  ('anon_fn', 'public.public_service_coverage'), ('anon_fn', 'public.public_response_commitments'), ('anon_fn', 'public.public_partner_locations'),
  ('anon_fn', 'public.emergency_card_by_token'), ('anon_fn', 'public.health_passport_by_serial'), ('anon_fn', 'public.verify_payer_board_report'),
  ('anon_fn', 'public.public_price_list'), ('anon_fn', 'public.record_share_by_token'), ('anon_fn', 'public.platform_switch_is_on'),
  ('anon_fn', 'public.verify_prescription_public'), ('anon_fn', 'public.record_prescription_supply_public'),
  -- views that run with their owner's rights on purpose (each carries its own caller predicate, or is a public directory, or is not granted)
  ('owner_view', 'public.care_message_communication_log'), ('owner_view', 'public.clinical_staff_directory'),
  ('owner_view', 'public.lab_provider_directory'), ('owner_view', 'public.pharmacy_partner_directory'),
  ('owner_view', 'public.specialist_directory'), ('owner_view', 'public.therapy_directory'),
  ('owner_view', 'analytics.v_outcome_snapshots'), ('owner_view', 'analytics.v_bp_control_90d_by_month'),
  -- S39b: organisation-level quality and safety aggregates (counts only, filtered to the caller's organisation staff)
  ('owner_view', 'public.diabetes_quality_metrics'), ('owner_view', 'public.hypertension_quality_metrics'), ('owner_view', 'public.lpe_programme_outcomes'),
  ('owner_view', 'public.obesity_quality_metrics'), ('owner_view', 'public.risk_model_drift_signal'), ('owner_view', 'public.risk_model_performance'),
  ('owner_view', 'public.risk_model_performance_by_subgroup'), ('owner_view', 'public.triage_safety_monitoring'),
  -- S53 pre-fix 8.16: the admin-gated read of pharmacy medicines including commission columns; the view carries its own caller predicate
  -- (admin, partner manager, owning pharmacist) and is revoked from anon and public, so owner rights are the point of it
  ('owner_view', 'public.pharmacy_medications_admin'),
  -- public storage buckets (staff photos are shown on the public directory)
  ('public_bucket', 'clinical-staff-photos'),
  -- patient avatars: a random-named file under the person's own folder, shown by its stored public address; private bucket plus signed
  -- addresses is OQ-S39-avatars (every place that shows an avatar would change)
  ('public_bucket', 'patient-avatars'),
  -- tables with a patient_id that any signed-in person may legitimately read in full (none today)
  ('open_patient_table', '__none__');
-- NOT swept: the platform admin role. It reads across organisations by design (customer support and investigations, INV-12 note); its reads
-- of clinical records are the INV-10 audit question tracked in docs/design/S39.md section 5 and OPEN-QUESTIONS.

-- check functions: each returns the list of offenders as text ('' when clean) so a sabotage can rerun them -------------------------
create function pg_temp.chk_rls_off() returns text language sql as $$
  select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and n.nspname in ('public', 'private', 'analytics') and not c.relrowsecurity $$;

create function pg_temp.chk_anon_tables() returns text language sql as $$
  select coalesce(string_agg(g.table_schema || '.' || g.table_name, ', ' order by g.table_name), '')
    from (select distinct table_schema, table_name from information_schema.role_table_grants
           where grantee = 'anon' and table_schema in ('public', 'private', 'analytics')) g
   where g.table_schema || '.' || g.table_name not in (select name from allow where kind = 'anon_table') $$;

create function pg_temp.chk_anon_fns() returns text language sql as $$
  select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'analytics') and p.prokind = 'f' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and n.nspname || '.' || p.proname not in (select name from allow where kind = 'anon_fn')
     -- extension-owned objects (pgaudit and the like) are not ours
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') $$;

create function pg_temp.chk_definer_search_path() returns text language sql as $$
  select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'analytics') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') $$;

create function pg_temp.chk_owner_views() returns text language sql as $$
  select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v', 'm') and n.nspname in ('public', 'analytics')
     and not coalesce((select option_value in ('true', 'on') from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
     and n.nspname || '.' || c.relname not in (select name from allow where kind = 'owner_view') $$;

create function pg_temp.chk_anon_view_select() returns text language sql as $$
  select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v', 'm') and n.nspname in ('public', 'analytics')
     and not coalesce((select option_value in ('true', 'on') from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
     and has_table_privilege('anon', c.oid, 'SELECT') and n.nspname || '.' || c.relname not in (select name from allow where kind = 'anon_table') $$;

create function pg_temp.chk_public_buckets() returns text language sql as $$
  select coalesce(string_agg(id, ', ' order by id), '') from storage.buckets where public and id not in (select name from allow where kind = 'public_bucket') $$;

create function pg_temp.chk_private_schema_closed() returns text language sql as $$
  select case when has_schema_privilege('anon', 'private', 'USAGE') then 'anon has USAGE on schema private' else '' end $$;

-- the role sweep: how many rows does a stranger of this role read from this table? ---------------------------------------------------
create function pg_temp.count_as(p_uid uuid, p_role text, p_table text) returns text language plpgsql as
$f$ declare r bigint;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'anon', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
  end if;
  begin
    set local statement_timeout = '20s';
    -- a person may of course read rows about themselves (the fixture's own profile write leaves correction rows about them)
    execute format('select count(*) from (select 1 from %s where patient_id is not null and patient_id is distinct from %L::uuid limit 1) x', p_table, p_uid) into r;
  exception when insufficient_privilege then r := 0;     -- refused outright is fine
            when others then r := -1;                      -- anything else is reported below, never hidden
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r::text;
end $f$;

create function pg_temp.sweep(p_label text) returns text language plpgsql as
$f$ declare t record; r text; out_ text := ''; who record;
begin
  for who in select * from (values ('anon', null::uuid), ('patient', pg_temp.f('patient')), ('clinician', pg_temp.f('clinician')),
                                     ('care_coordinator', pg_temp.f('care_coordinator')), ('finance', pg_temp.f('finance'))) v(role_name, uid)
  loop
    for t in select 'public.' || quote_ident(c.relname) as qn, c.relname
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
               join pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped
              where n.nspname = 'public' and c.relkind in ('r', 'p')
                and 'public.' || c.relname not in (select name from allow where kind = 'open_patient_table')
              order by c.relname
    loop
      r := pg_temp.count_as(who.uid, case when who.role_name = 'anon' then 'anon' else 'authenticated' end, t.qn);
      if r <> '0' then out_ := out_ || who.role_name || '>' || t.relname || '=' || r || '; '; end if;
    end loop;
  end loop;
  return out_;
end $f$;

-- fixtures: a brand-new organisation per role, so nothing is related to anything -------------------------------------------------------
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's39-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S39 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare v_org uuid; r text;
begin
  -- one organisation per person, so a staff member shares an organisation with nobody else in the test
  foreach r in array array['patient', 'clinician', 'admin', 'care_coordinator', 'finance'] loop
    insert into public.organisations (name, type) select 'S39 isolated org ' || r || ' ' || gen_random_uuid(), type from public.organisations limit 1 returning id into v_org;
    perform pg_temp.setf(r, pg_temp.mkuser(v_org, r, r));
  end loop;
end $$;

-- real run ---------------------------------------------------------------------------------------------------------------------------
insert into results values
  ('real', '1 RLS is on for every table in public, private and analytics', '', pg_temp.chk_rls_off()),
  ('real', '2a anon table grants are only the reviewed public-content tables', '', pg_temp.chk_anon_tables()),
  ('real', '2b anon EXECUTE is only on the reviewed public functions', '', pg_temp.chk_anon_fns()),
  ('real', '2c anon has no USAGE on schema private', '', pg_temp.chk_private_schema_closed()),
  ('real', '3 every SECURITY DEFINER function pins its search_path', '', pg_temp.chk_definer_search_path()),
  ('real', '4a only the reviewed views run with owner rights', '', pg_temp.chk_owner_views()),
  ('real', '4b no owner-rights view is readable by anon unless reviewed public content', '', pg_temp.chk_anon_view_select()),
  ('real', '5 only the reviewed storage buckets are public', '', pg_temp.chk_public_buckets()),
  ('real', '6 a stranger of every role, and anon, reads zero rows from every patient-scoped table', '', pg_temp.sweep('real'));

-- sabotage: each of the sweeps must flip when the protection is removed ---------------------------------------------------------------
do $$
declare v_t text;
begin
  -- (1) RLS off on a patient table
  select c.relname into v_t from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname = 'medication_logs';
  execute format('alter table public.%I disable row level security', v_t);
  insert into results values ('sabotaged', 'SABOTAGE RLS off is caught', '', pg_temp.chk_rls_off());
  execute format('alter table public.%I enable row level security', v_t);
  -- (2) a function made anon-executable
  create function public.s39_sabotage_fn() returns integer language sql as $f$ select 1 $f$;
  grant execute on function public.s39_sabotage_fn() to anon;
  insert into results values ('sabotaged', 'SABOTAGE anon-executable function is caught', '', pg_temp.chk_anon_fns());
  -- (3) a view switched to owner rights
  create view public.s39_sabotage_view with (security_invoker = off) as select 1 as x;
  insert into results values ('sabotaged', 'SABOTAGE owner-rights view is caught', '', pg_temp.chk_owner_views());
  -- (4) an open policy on a patient table: the sweep must see rows through it. The table needs a row about someone for the sweep to see (a fresh replay has
  -- none), so one is made for the fixture patient (rolled back with everything else).
  insert into public.patient_smoking_profiles (organisation_id, patient_id) select organisation_id, id from public.profiles where id = pg_temp.f('patient') on conflict do nothing;
  create policy s39_sabotage_open on public.patient_smoking_profiles for select to authenticated using (true);
  insert into results values ('sabotaged', 'SABOTAGE open policy is caught by the role sweep', '', pg_temp.sweep('sabotaged'));
  drop policy s39_sabotage_open on public.patient_smoking_profiles;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39 catalog proof FAILED: %',
      (select string_agg(check_name || ' => ' || left(coalesce(actual, 'null'), 1500), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks (rows: %)', v_caught, (select string_agg(check_name || '=' || left(actual, 80), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, case when expected = actual then 'PASS' else 'FAIL' end as result, left(actual, 200) as detail
from results order by phase desc, check_name;

rollback;
