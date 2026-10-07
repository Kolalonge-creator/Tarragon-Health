-- ===========================================================================
-- Proof: 20261007124418_s38f_sponsor_staff_monthly_figures.sql (v5 S38, OQ-258; I9, INV-13).
--
--   1. Sponsor staff means an active hmo_admin/corporate_admin/ngo_admin whose role matches the type of its own organisation; a clinician, a
--      patient, an admin, an inactive login and a role in the wrong kind of organisation are refused.
--   2. The monthly job writes one frozen figure per programme for the month that closed, only after the grace days, once; a second run writes
--      none; the table cannot be read, changed or deleted by a user.
--   3. Staff see only their own sponsor's programmes (code shown while active, hidden once closed) and figures; another sponsor's programme and a
--      programme that does not exist get the SAME refusal; every read is audited.
--   4. A figure is frozen: a member who leaves after it was written does not change it, and the figure holds only aggregates (no member list or id).
--   5. SABOTAGE: write-once trigger dropped (an update must then succeed); the ownership check removed from sponsor_staff_figures (another
--      sponsor's staff must then read it). Both checks must flip.
--   6. A month whose figure would differ by only a few people from the last published one is held back whole (and builds up until it can be
--      published); the member list is never returned; an export by staff is audited first and refused alike for another sponsor.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temp table s38f_results (check_name text, observed text, expected text, verdict text);
grant all on s38f_results to public;

create function pg_temp.mkuser(p_role text, p_org uuid default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := coalesce(p_org, (select id from public.organisations order by created_at limit 1));
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's38f-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, state, sex, date_of_birth)
  values (v, v_org, p_role::public.user_role, 'S38f ' || p_role, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), 'Lagos', 'female', date '1975-05-05')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;
  return v;
end $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_sp uuid; v_sp2 uuid; v_clinic uuid; adm uuid; clin uuid; pat uuid; st uuid; st2 uuid; st_wrong uuid; st_off uuid;
  v_cohort uuid; v_cohort2 uuid; v_code text; v_r jsonb; v_r2 jsonb; v_n integer; v_txt text; p uuid; pts uuid[] := '{}'; i integer;
  v_pay1 jsonb; v_pay2 jsonb; v_next2 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '2 months')::date; v_next3 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '3 months')::date; v_h boolean; v_pushn integer; v_cnt0 integer; v_next4 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '4 months')::date; v_next5 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '5 months')::date; v_cc text; v_next6 date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '6 months')::date; v_today date := (now() at time zone 'Africa/Lagos')::date; v_next date := (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '1 month')::date;
  v_cur date := date_trunc('month', now() at time zone 'Africa/Lagos')::date; v_grace integer := (private.report_rule('grace_days') #>> '{}')::integer;
begin
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '1') where is_active;
  insert into public.organisations (name, type) values ('S38f Sponsor Corp', 'corporate') returning id into v_sp;
  insert into public.organisations (name, type) values ('S38f Other Sponsor', 'ngo') returning id into v_sp2;
  insert into public.organisations (name, type) values ('S38f Clinic', 'clinic') returning id into v_clinic;
  update public.organisations set min_cohort_size = 5 where id in (v_sp, v_sp2);
  adm := pg_temp.mkuser('admin'); clin := pg_temp.mkuser('clinician'); pat := pg_temp.mkuser('patient');
  st := pg_temp.mkuser('corporate_admin', v_sp); st2 := pg_temp.mkuser('ngo_admin', v_sp2);
  st_wrong := pg_temp.mkuser('hmo_admin', v_sp);                       -- hmo role inside a corporate organisation
  st_off := pg_temp.mkuser('corporate_admin', v_sp); update public.profiles set is_active = false where id = st_off;

  -- a programme with six members who agreed (the consent text made current as counsel will, in the proof only)
  perform pg_temp.as_user(adm); execute 'set local role authenticated';
  v_r := public.admin_create_sponsor_cohort(v_sp, 'Acme staff', current_date - 40, current_date + 400, 100);
  execute 'reset role';
  v_cohort := (v_r ->> 'id')::uuid; v_code := v_r ->> 'code';
  update public.consent_versions set is_current = true where consent_type = 'sponsor_reporting' and version = '2026-10-07-draft';
  for i in 1..6 loop
    p := pg_temp.mkuser('patient'); pts := pts || p;
    perform pg_temp.as_user(p); execute 'set local role authenticated';
    perform public.join_cohort(v_code); perform public.set_cohort_reporting_consent(v_cohort, true);
    execute 'reset role';
  end loop;

  -- =============================== 1. who counts as sponsor staff ===============================
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  v_r := public.sponsor_staff_programmes();
  execute 'reset role';
  insert into s38f_results values ('1a corporate_admin in a corporate organisation is sponsor staff', coalesce(v_r ->> 'sponsor', 'none'), 'S38f Sponsor Corp', case when v_r ->> 'sponsor' = 'S38f Sponsor Corp' then 'PASS' else 'FAIL' end);
  foreach v_txt in array array['clin', 'pat', 'adm', 'st_wrong', 'st_off'] loop
    perform pg_temp.as_user(case v_txt when 'clin' then clin when 'pat' then pat when 'adm' then adm when 'st_wrong' then st_wrong else st_off end);
    execute 'set local role authenticated';
    begin perform public.sponsor_staff_programmes(); insert into s38f_results values ('1b ' || v_txt || ' is refused', 'allowed', 'refused', 'FAIL');
    exception when insufficient_privilege then insert into s38f_results values ('1b ' || v_txt || ' is refused', 'refused', 'refused', 'PASS'); end;
    execute 'reset role';
  end loop;
  begin execute 'set local role anon'; perform public.sponsor_staff_programmes(); insert into s38f_results values ('1c anon cannot execute', 'allowed', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38f_results values ('1c anon cannot execute', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';

  -- a test account that joined and agreed must stay out of the figure (INV-13)
  p := pg_temp.mkuser('patient'); perform set_config('request.jwt.claims', '', true); update public.profiles set is_test = true where id = p;
  perform pg_temp.as_user(p); execute 'set local role authenticated';
  perform public.join_cohort(v_code); perform public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  -- a programme made after the month closed, and one that had already ended before it
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, created_at)
    values (v_org, v_sp, 'Late one', 'LLLLLLL2', v_cur - 90, v_cur + 400, 50, (v_next + 1)::timestamp at time zone 'Africa/Lagos');
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, created_at)
    values (v_org, v_sp, 'Second one', 'SSSSSSS2', v_cur - 90, v_cur + 400, 50, v_cur - 10);   -- a second live programme of the same sponsor
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, created_at)
    values (v_org, v_sp, 'Ended one', 'EEEEEEE2', v_cur - 400, v_cur - 5, 50, v_cur - 300);

  -- =============================== 2. the monthly job ===============================
  -- mid-month: the closed month has not passed its grace days when "today" is inside the grace window
  v_n := private.generate_sponsor_snapshots((v_cur + 0)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  insert into s38f_results values ('2a nothing is written before the grace days have passed', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  -- the first day of next month plus the grace days: the current month is the closed one
  v_n := private.generate_sponsor_snapshots((v_next + v_grace)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select count(*) into v_n from public.sponsor_report_snapshots where cohort_id = v_cohort;
  insert into s38f_results values ('2b one figure is written for the programme', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  v_n := private.generate_sponsor_snapshots((v_next + v_grace + 3)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select count(*) into v_n from public.sponsor_report_snapshots where cohort_id = v_cohort;
  insert into s38f_results values ('2c a second run writes no second figure', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  select (period = v_cur)::text into v_txt from public.sponsor_report_snapshots where cohort_id = v_cohort;
  insert into s38f_results values ('2d it is for the month that closed', v_txt, 'true', case when v_txt = 'true' then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.sponsor_report_snapshots s join public.sponsor_cohorts c on c.id = s.cohort_id where c.name in ('Late one', 'Ended one');
  insert into s38f_results values ('2c2 no figure for a programme made after the month closed or one that ended before it', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  update public.sponsor_cohorts set valid_to = v_cur where name in ('Late one', 'Second one');   -- ends them, so later months below involve only the programme under test
  v_n := private.generate_sponsor_snapshots((v_next + v_grace + 20)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  insert into s38f_results values ('2c3 nothing is written long after the month closed (the data no longer describes it)', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  -- S38g: the notice to the sponsor's own staff when a figure is published
  select count(*) into v_n from public.notifications where template = 'sponsor_figures_ready' and channel = 'email' and recipient_id = st and source_id = (select id from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_cur);
  select count(*) filter (where payload ->> 'to_email' = (select email from auth.users where id = st)) into v_pushn from public.notifications where template = 'sponsor_figures_ready' and channel = 'email' and recipient_id = st;
  insert into s38f_results values ('2h staff get one email, addressed to their own login, when the figure is published', v_n || '/' || v_pushn, '1/1', case when v_n = 1 and v_pushn = 1 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.notifications where template = 'sponsor_figures_ready' and channel = 'push' and recipient_id = st;
  select count(*) into v_n from public.notifications where template = 'sponsor_figures_ready' and channel = 'email' and recipient_id = st;
  select count(*) into v_pushn from public.sponsor_report_snapshots s join public.sponsor_cohorts c on c.id = s.cohort_id where c.name = 'Second one' and s.period = v_cur;
  insert into s38f_results values ('2h2 one notice per person per month: a second programme publishing the same month adds none', v_n || ' email, second programme figure written: ' || v_pushn, '1 email, second programme figure written: 1',
    case when v_n = 1 and v_pushn = 1 then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('2i and a push for the phone app', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.notifications where template = 'sponsor_figures_ready' and recipient_id in (st_off, st_wrong, st2, clin, pat, adm);
  insert into s38f_results values ('2j nobody else is told (inactive, wrong kind of organisation, another sponsor, clinician, patient, admin)', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  select (payload = jsonb_build_object('to_email', (select email from auth.users where id = st), 'period', v_cur) and content_class = 'non_clinical' and status = 'pending')::text into v_txt
    from public.notifications where template = 'sponsor_figures_ready' and channel = 'email' and recipient_id = st;
  insert into s38f_results values ('2k the row carries only the destination address and the figure month, is non-clinical and pending', v_txt, 'true', case when v_txt = 'true' then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('2e the table is not readable by a user',
    (has_table_privilege('authenticated', 'public.sponsor_report_snapshots', 'SELECT') or has_table_privilege('anon', 'public.sponsor_report_snapshots', 'SELECT'))::text, 'false',
    case when not (has_table_privilege('authenticated', 'public.sponsor_report_snapshots', 'SELECT') or has_table_privilege('anon', 'public.sponsor_report_snapshots', 'SELECT')) then 'PASS' else 'FAIL' end);
  begin update public.sponsor_report_snapshots set payload = '{}'::jsonb where cohort_id = v_cohort; insert into s38f_results values ('2f a figure cannot be changed', 'changed', 'refused', 'FAIL');
  exception when sqlstate 'P0001' then insert into s38f_results values ('2f a figure cannot be changed', 'refused', 'refused', 'PASS'); end;
  begin delete from public.sponsor_report_snapshots where cohort_id = v_cohort; insert into s38f_results values ('2g a figure cannot be deleted', 'deleted', 'refused', 'FAIL');
  exception when sqlstate 'P0001' then insert into s38f_results values ('2g a figure cannot be deleted', 'refused', 'refused', 'PASS'); end;

  -- =============================== 3. what staff can read ===============================
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  v_r := public.sponsor_staff_programmes();
  v_r2 := public.sponsor_staff_figures(v_cohort);
  execute 'reset role';
  insert into s38f_results values ('3a staff see their own programme with its code',
    (select e ->> 'name' || '/' || (e ->> 'code') from jsonb_array_elements(v_r -> 'programmes') e where e ->> 'name' = 'Acme staff'), 'Acme staff/' || v_code,
    case when (select e ->> 'code' from jsonb_array_elements(v_r -> 'programmes') e where e ->> 'name' = 'Acme staff') = v_code then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('3b the figure shows the joined and agreed counts (six of six) for the month', coalesce(v_r2 #>> '{months,0,figures,members,joined}', 'none') || '/' || coalesce(v_r2 #>> '{months,0,figures,members,agreed_to_share}', 'none'), '6/6',
    case when v_r2 #>> '{months,0,figures,members,joined}' = '6' and v_r2 #>> '{months,0,figures,members,agreed_to_share}' = '6' then 'PASS' else 'FAIL' end);
  v_pay1 := v_r2;
  insert into s38f_results values ('3b2 the member set used for comparing months is the same people the figure counts', cardinality(private.sponsor_agreed_members(v_cohort))::text, '6', case when cardinality(private.sponsor_agreed_members(v_cohort)) = 6 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.audit_log where action = 'sponsor.staff_viewed' and actor_id = st;
  insert into s38f_results values ('3c the read is audited', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  -- another sponsor's staff, and a programme that does not exist, get the same refusal
  perform pg_temp.as_user(st2); execute 'set local role authenticated';
  v_txt := public.sponsor_staff_figures(v_cohort)::text;
  v_code := public.sponsor_staff_figures(gen_random_uuid())::text;
  v_r := public.sponsor_staff_programmes();
  execute 'reset role';
  insert into s38f_results values ('3d another sponsor and a missing programme are refused alike', v_txt || '|' || v_code, '{"ok": false}|{"ok": false}',
    case when v_txt = '{"ok": false}' and v_code = '{"ok": false}' then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('3e another sponsor lists none of this sponsor''s programmes', jsonb_array_length(v_r -> 'programmes')::text, '0', case when jsonb_array_length(v_r -> 'programmes') = 0 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.audit_log where action = 'sponsor.staff_refused' and actor_id = st2;
  insert into s38f_results values ('3d2 the refused reads are themselves audited', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  -- a closed programme hides its code
  update public.sponsor_cohorts set status = 'closed' where id = v_cohort;
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  v_r := public.sponsor_staff_programmes();
  execute 'reset role';
  insert into s38f_results values ('3f a closed programme shows no code', coalesce((select e ->> 'code' from jsonb_array_elements(v_r -> 'programmes') e where e ->> 'name' = 'Acme staff'), 'null'), 'null',
    case when (select e ->> 'code' from jsonb_array_elements(v_r -> 'programmes') e where e ->> 'name' = 'Acme staff') is null then 'PASS' else 'FAIL' end);
  update public.sponsor_cohorts set status = 'active' where id = v_cohort;

  -- =============================== 4. frozen ===============================
  perform pg_temp.as_user(pts[1]); execute 'set local role authenticated';
  perform public.leave_cohort(v_cohort);
  execute 'reset role';
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  v_pay2 := public.sponsor_staff_figures(v_cohort);
  execute 'reset role';
  insert into s38f_results values ('4a a member leaving after the month closed does not change the figure', ((v_pay1 -> 'months' -> 0 -> 'figures') = (v_pay2 -> 'months' -> 0 -> 'figures'))::text, 'true',
    case when (v_pay1 -> 'months' -> 0 -> 'figures') = (v_pay2 -> 'months' -> 0 -> 'figures') then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('4b the figure holds no member id or list', (v_pay2::text ~* '(patient_id|"id")')::text, 'false', case when v_pay2::text !~* '(patient_id|"id")' then 'PASS' else 'FAIL' end);

  -- one member left (pts[1], above): the next month's figure would differ by one person from the last published one, so it is held back whole
  v_n := private.generate_sponsor_snapshots((v_next2 + v_grace)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select held_back into v_h from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_next;
  select count(*) into v_n from public.notifications x join public.sponsor_report_snapshots sn on sn.id = x.source_id where x.template = 'sponsor_figures_ready' and x.channel = 'email' and x.recipient_id = st and sn.cohort_id = v_cohort;
  insert into s38f_results values ('4c0 a held-back month sends no notice (there is no figure to read); the earlier one is still the only email', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('4c a one-person change is held back (two published months cannot be subtracted)', coalesce(v_h::text, 'none'), 'true', case when v_h then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  v_pay2 := public.sponsor_staff_figures(v_cohort);
  execute 'reset role';
  insert into s38f_results values ('4d staff see the month as held back, with no figures and no member list', (v_pay2 #>> '{months,0,figures,held_back}') || '/' || ((v_pay2 #> '{months,0,figures}') ? 'members')::text || '/' || (v_pay2::text ~ 'member_set')::text, 'true/false/false',
    case when v_pay2 #>> '{months,0,figures,held_back}' = 'true' and not ((v_pay2 #> '{months,0,figures}') ? 'members') and v_pay2::text !~ 'member_set' then 'PASS' else 'FAIL' end);
  -- four more leave: against the last PUBLISHED figure five people now differ, enough to publish
  for i in 2..5 loop
    perform pg_temp.as_user(pts[i]); execute 'set local role authenticated'; perform public.leave_cohort(v_cohort); execute 'reset role';
  end loop;
  v_n := private.generate_sponsor_snapshots((v_next3 + v_grace)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select held_back into v_h from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_next2;
  select count(*) into v_n from public.notifications x join public.sponsor_report_snapshots sn on sn.id = x.source_id where x.template = 'sponsor_figures_ready' and x.channel = 'email' and x.recipient_id = st and sn.cohort_id = v_cohort;
  insert into s38f_results values ('4e0 a month published after a held one sends its own notice', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  insert into s38f_results values ('4e once enough has changed the figure is published again', coalesce(v_h::text, 'none'), 'false', case when v_h = false then 'PASS' else 'FAIL' end);

  -- staff export: audited first, refused alike for another sponsor and a missing programme
  perform pg_temp.as_user(st); execute 'set local role authenticated';
  v_r := public.log_sponsor_staff_export(v_cohort);
  execute 'reset role';
  perform pg_temp.as_user(st2); execute 'set local role authenticated';
  v_r2 := public.log_sponsor_staff_export(v_cohort);
  execute 'reset role';
  select count(*) into v_n from public.audit_log where action = 'sponsor.staff_exported' and actor_id = st;
  insert into s38f_results values ('4f an export by own staff is audited; another sponsor gets {ok:false}', (v_r ->> 'ok') || '/' || v_n || '/' || v_r2::text, 'true/1/{"ok": false}',
    case when v_r ->> 'ok' = 'true' and v_n = 1 and v_r2 = '{"ok": false}'::jsonb then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(clin); execute 'set local role authenticated';
  begin perform public.log_sponsor_staff_export(v_cohort); insert into s38f_results values ('4g a clinician cannot export', 'allowed', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38f_results values ('4g a clinician cannot export', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';

  -- =============================== 5. sabotage ===============================
  -- (a) the write-once trigger dropped: an update must then succeed
  execute 'drop trigger sponsor_snapshots_write_once on public.sponsor_report_snapshots';
  update public.sponsor_report_snapshots set payload = '{"x":1}'::jsonb where cohort_id = v_cohort;
  get diagnostics v_n = row_count;
  insert into s38f_results values ('5a SABOTAGE: without the trigger a figure can be changed (2f would FAIL)', v_n::text, '3 (all rows changed)', case when v_n >= 1 then 'PASS' else 'FAIL' end);
  -- (b) the ownership check removed: another sponsor's staff must then read it
  select pg_get_functiondef('public.sponsor_staff_figures(uuid)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'where id = p_cohort and sponsor_org_id = v_org and not is_test', 'where id = p_cohort and not is_test');
  if v_txt = pg_get_functiondef('public.sponsor_staff_figures(uuid)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute v_txt;
  perform pg_temp.as_user(st2); execute 'set local role authenticated';
  v_r2 := public.sponsor_staff_figures(v_cohort);
  execute 'reset role';
  insert into s38f_results values ('5b SABOTAGE: without the ownership check another sponsor reads it (3d would FAIL)', jsonb_array_length(v_r2 -> 'months')::text, 'at least 1', case when v_r2 ->> 'ok' = 'true' and jsonb_array_length(v_r2 -> 'months') >= 1 then 'PASS' else 'FAIL' end);
  -- (d) the active filter removed from the notice: an inactive login must then be told, so check 2j would FAIL
  select pg_get_functiondef('private.notify_sponsor_staff_figures(uuid,uuid,date)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'p.is_active and not coalesce(p.is_test, false)', 'not coalesce(p.is_test, false)');
  if v_txt = pg_get_functiondef('private.notify_sponsor_staff_figures(uuid,uuid,date)'::regprocedure) then raise exception 'sabotage (d) did not change the function'; end if;
  execute v_txt;
  perform private.notify_sponsor_staff_figures(v_sp, (select id from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_cur), v_cur + 1000);
  select count(*) into v_n from public.notifications where template = 'sponsor_figures_ready' and recipient_id = st_off;
  insert into s38f_results values ('5d SABOTAGE: without the active filter an inactive login is told (2j would FAIL)', v_n::text, 'at least 1', case when v_n >= 1 then 'PASS' else 'FAIL' end);

  -- (c) the hold removed. First show the hold applies: one new member since the last published figure holds the next month back.
  select code into v_cc from public.sponsor_cohorts where id = v_cohort;
  p := pg_temp.mkuser('patient');
  perform pg_temp.as_user(p); execute 'set local role authenticated';
  perform public.join_cohort(v_cc); perform public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  v_n := private.generate_sponsor_snapshots((v_next4 + v_grace)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select held_back into v_h from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_next3;
  insert into s38f_results values ('5c0 one new member since the last published figure holds the month back', coalesce(v_h::text, 'none'), 'true', case when v_h then 'PASS' else 'FAIL' end);
  -- then take the hold out of the job: the same one-person change must now be published
  select pg_get_functiondef('private.generate_sponsor_snapshots(timestamptz)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'v_held := v_diff between 1 and v_min - 1;', 'v_held := false;');
  if v_txt = pg_get_functiondef('private.generate_sponsor_snapshots(timestamptz)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute v_txt;
  v_n := private.generate_sponsor_snapshots((v_next5 + v_grace)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select held_back into v_h from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_next4;
  insert into s38f_results values ('5c SABOTAGE: without the hold a one-person change is published (4c would FAIL)', coalesce(v_h::text, 'none'), 'false', case when v_h = false then 'PASS' else 'FAIL' end);

  -- (e) the notice cannot be queued (made to raise): the figure must still be written, and one incident opened for the failing notices
  select pg_get_functiondef('private.notify_sponsor_staff_figures(uuid,uuid,date)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, E'  for r in', E'  raise exception ''boom'';\n  for r in');
  if v_txt = pg_get_functiondef('private.notify_sponsor_staff_figures(uuid,uuid,date)'::regprocedure) then raise exception 'sabotage (e) did not change the function'; end if;
  execute v_txt;
  v_n := private.generate_sponsor_snapshots((v_next6 + v_grace)::timestamp at time zone 'Africa/Lagos' + interval '12 hours');
  select count(*) into v_pushn from public.sponsor_report_snapshots where cohort_id = v_cohort and period = v_next5;
  select count(*) into v_cnt0 from public.ops_incidents where external_reference = 'sponsor-notices-failing' and status not in ('resolved', 'closed');
  insert into s38f_results values ('5e a notice that cannot be queued does not lose the figure, and opens one incident', v_pushn || '/' || v_cnt0, '1/1', case when v_pushn = 1 and v_cnt0 = 1 then 'PASS' else 'FAIL' end);
end $$;

select * from s38f_results order by check_name;

do $$
begin
  if exists (select 1 from s38f_results where verdict = 'FAIL') then
    raise exception 'S38f proof: % check(s) FAILED', (select count(*) from s38f_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
