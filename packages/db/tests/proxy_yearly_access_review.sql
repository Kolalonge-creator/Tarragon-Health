-- Proof: yearly "still need this person's access?" review (migration *_proxy_yearly_access_review.sql). One rolled-back transaction. Proves:
--   1. A grant 12 months old is due, a fresh one is not (control). The sweep queues one in-app notice for the person and one calm notice for the proxy, writes
--      the history, and removes NO access.
--   2. Reminders repeat at the configured interval, stop at the cap, never remove access, and the item stays on the person's list as due.
--   3. Keep restarts the cycle (earlier reminders no longer count, the proxy is told again next cycle); narrow and remove go through the existing controls and
--      are recorded; the proxy can read neither the history nor the outcome, only a boolean "due".
--   4. Only the person can answer: the proxy, a stranger and anon are refused.
--   5. Out of scope: an under-18 dependant's guardian, a record with no login of its own, a grant past its own expiry.
--   6. A notice that cannot be queued writes no history row and opens an incident, and the next sweep retries it.
--   7. The history is append only; the cron entry exists and runs the sweep.
--   SABOTAGE A: no reminder cap. SABOTAGE B: answer_proxy_review without the owner check. SABOTAGE C: the sweep removes overdue access. All three must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
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
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
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
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_phone text := '+23481' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  insert into auth.users (id, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'pyr-' || p_label || '-' || v || '@example.invalid', v_phone, now(), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'PYR ' || p_label || ' Person', v_phone, (current_date - interval '60 years')::date, true)
  on conflict (id) do update set is_test = true, is_active = true, full_name = excluded.full_name, phone = excluded.phone;
  return v;
end $f$;
-- a grant made some time ago, with categories
create function pg_temp.grant_aged(p_patient uuid, p_proxy uuid, p_age interval, p_cats text[]) returns uuid language plpgsql as
$f$ declare v uuid; v_prev_sub text := current_setting('request.jwt.claim.sub', true); v_prev_claims text := current_setting('request.jwt.claims', true);
begin
  -- profile_access_categories has a guard trigger (insert or delete) that only lets the person whose record it is change it, so act as the patient
  -- (claims only; the role stays the owner) for these two inserts, then put the previous claims back.
  perform set_config('request.jwt.claims', json_build_object('sub', p_patient, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_patient::text, true);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, created_at)
  values (p_patient, p_proxy, 'view', p_patient, now() - p_age) returning id into v;
  insert into public.profile_access_categories (profile_access_id, category)
    select v, c::public.care_access_category from unnest(p_cats) c;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  return v;
end $f$;
-- move the whole history of a pair back in time (a proof cannot wait 31 days)
create function pg_temp.age_history(p_patient uuid, p_proxy uuid, p_by interval) returns void language plpgsql as
$f$ begin
  alter table public.proxy_access_reviews disable trigger proxy_access_reviews_append_only;
  update public.proxy_access_reviews set created_at = created_at - p_by where patient_id = p_patient and grantee_user_id = p_proxy;
  alter table public.proxy_access_reviews enable trigger proxy_access_reviews_append_only;
end $f$;
create function pg_temp.n_hist(p_patient uuid, p_proxy uuid, p_kind text) returns text language sql as
$f$ select count(*)::text from public.proxy_access_reviews where patient_id = p_patient and grantee_user_id = p_proxy and kind = p_kind $f$;
create function pg_temp.n_notif(p_to uuid, p_template text) returns text language sql as
$f$ select count(*)::text from public.notifications where recipient_id = p_to and template = p_template $f$;
create function pg_temp.n_grant(p_patient uuid, p_proxy uuid) returns text language sql as
$f$ select count(*)::text from public.profile_access where profile_id = p_patient and grantee_user_id = p_proxy $f$;

do $$
declare
  v_org uuid; v_pa uuid; v_px uuid; v_px2 uuid; v_stranger uuid; v_fresh uuid; v_child uuid; v_guardian uuid; v_elder uuid; v_elder_px uuid; v_exp uuid; v_exp_px uuid;
  v_grant uuid; v_n integer; v_cfg_rows text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pa := pg_temp.mkuser(v_org, 'person'); v_px := pg_temp.mkuser(v_org, 'proxy'); v_px2 := pg_temp.mkuser(v_org, 'proxy2'); v_stranger := pg_temp.mkuser(v_org, 'stranger');
  insert into fx values ('pa', v_pa), ('px', v_px), ('px2', v_px2), ('stranger', v_stranger);
  -- every other row in this database must not be disturbed by the sweep or counted by it
  delete from public.notifications where template in ('proxy_review_due', 'proxy_review_due_proxy');

  -- config mirrors the proposal
  select interval_months || '|' || repeat_days || '|' || max_reminders || '|' || status into v_cfg_rows from public.proxy_review_config where is_active;
  perform pg_temp.ck('active config is the proposal', '12|30|4|proposed', v_cfg_rows);
  perform pg_temp.ck('shipped default: the proxy is told nothing (OQ-705)', 'false', (select tell_proxy::text from public.proxy_review_config where is_active));
  -- the sections below exercise the notice path, so turn it on for this rolled-back transaction
  update public.proxy_review_config set tell_proxy = true where version = 1;

  -- 1. due and not due
  v_grant := pg_temp.grant_aged(v_pa, v_px, interval '13 months', array['vitals_readings', 'medications']);
  v_fresh := pg_temp.grant_aged(v_pa, v_px2, interval '1 day', array['vitals_readings']);
  insert into fx values ('grant', v_grant);
  perform pg_temp.ck('13 month grant is due', 'true', pg_temp.q_as(v_pa, format($q$select (e ->> 'is_due') from jsonb_array_elements(public.my_proxy_reviews()) e where (e ->> 'grant_id') = %L$q$, v_grant)));
  perform pg_temp.ck('control: a day old grant is not due', 'false', pg_temp.q_as(v_pa, format($q$select (e ->> 'is_due') from jsonb_array_elements(public.my_proxy_reviews()) e where (e ->> 'grant_id') = %L$q$, v_fresh)));
  perform pg_temp.ck('the list names the person by first name', 'PYR', pg_temp.q_as(v_pa, format($q$select (e ->> 'first_name') from jsonb_array_elements(public.my_proxy_reviews()) e where (e ->> 'grant_id') = %L$q$, v_grant)));

  v_n := private.sweep_proxy_access_reviews();
  perform pg_temp.ck('sweep queued exactly one review', '1', v_n::text);
  perform pg_temp.ck('person gets an in-app notice', '1', (select count(*)::text from public.notifications where recipient_id = v_pa and template = 'proxy_review_due' and channel = 'in_app'));
  perform pg_temp.ck('proxy gets one calm in-app notice', '1', pg_temp.n_notif(v_px, 'proxy_review_due_proxy'));
  perform pg_temp.ck('the fresh grant gets nothing', '0', pg_temp.n_notif(v_px2, 'proxy_review_due_proxy'));
  perform pg_temp.ck('the notices name no one (empty payload)', '0', (select count(*)::text from public.notifications where template in ('proxy_review_due', 'proxy_review_due_proxy') and payload <> '{}'::jsonb));
  perform pg_temp.ck('history: one reminder, proxy told once', '1|1', pg_temp.n_hist(v_pa, v_px, 'reminder_sent') || '|' || pg_temp.n_hist(v_pa, v_px, 'proxy_told'));
  perform pg_temp.ck('the review event is on the bus for the person', '1', (select count(*)::text from public.domain_events where event_type = 'proxy.review_due' and patient_id = v_pa));
  perform pg_temp.ck('...and carries no grantee and no grant (who has access to whom stays out of the shared bus)', '0', (select count(*)::text from public.domain_events where event_type = 'proxy.review_due' and patient_id = v_pa and (payload::text like '%' || v_px::text || '%' or payload::text like '%' || v_grant::text || '%' or aggregate_id is not null)));
  perform pg_temp.ck('sweep removed no access', '1', pg_temp.n_grant(v_pa, v_px));
  perform pg_temp.ck('categories untouched', '2', (select count(*)::text from public.profile_access_categories where profile_access_id = v_grant));
  v_n := private.sweep_proxy_access_reviews();
  perform pg_temp.ck('a second sweep the same day sends nothing', '0', v_n::text);
  perform pg_temp.ck('...and still one reminder', '1', pg_temp.n_hist(v_pa, v_px, 'reminder_sent'));
  -- the proxy sees only a boolean "a yearly check was announced", never an outcome, and nothing of the history
  perform pg_temp.ck('proxy sees a flag for the person they help', v_pa::text, pg_temp.q_as(v_px, $q$select (public.proxy_review_due_as_proxy() -> 0 ->> 'patient_id')$q$));
  perform pg_temp.ck('proxy flag carries nothing else', '1', pg_temp.q_as(v_px, $q$select (select count(*) from jsonb_object_keys(public.proxy_review_due_as_proxy() -> 0))::text$q$));
  perform pg_temp.ck('control: the fresh proxy has no flag', '0', pg_temp.q_as(v_px2, $q$select jsonb_array_length(public.proxy_review_due_as_proxy())::text$q$));

  -- 2. repeats, cap, never removes
  perform pg_temp.age_history(v_pa, v_px, interval '31 days');
  v_n := private.sweep_proxy_access_reviews();
  perform pg_temp.ck('after the repeat interval a second reminder is queued', '1', v_n::text);
  perform pg_temp.ck('the proxy is not told a second time', '1', pg_temp.n_hist(v_pa, v_px, 'proxy_told'));
  perform pg_temp.age_history(v_pa, v_px, interval '31 days'); perform private.sweep_proxy_access_reviews();
  perform pg_temp.age_history(v_pa, v_px, interval '31 days'); perform private.sweep_proxy_access_reviews();
  perform pg_temp.ck('four reminders is the cap', '4', pg_temp.n_hist(v_pa, v_px, 'reminder_sent'));
  perform pg_temp.age_history(v_pa, v_px, interval '31 days');
  v_n := private.sweep_proxy_access_reviews();
  perform pg_temp.ck('past the cap nothing more is sent', '0|4', v_n::text || '|' || pg_temp.n_hist(v_pa, v_px, 'reminder_sent'));
  perform pg_temp.age_history(v_pa, v_px, interval '400 days'); perform private.sweep_proxy_access_reviews();
  perform pg_temp.ck('silence for over a year still removes no access', '1', pg_temp.n_grant(v_pa, v_px));
  perform pg_temp.ck('the proxy flag ended by itself after its window, with the review still open', '0', pg_temp.q_as(v_px, $q$select jsonb_array_length(public.proxy_review_due_as_proxy())::text$q$));
  perform pg_temp.ck('the item stays on the list as due, overdue by days', 'true', pg_temp.q_as(v_pa, format($q$select ((e ->> 'is_due') = 'true' and (e ->> 'days_overdue')::int > 30)::text from jsonb_array_elements(public.my_proxy_reviews()) e where (e ->> 'grant_id') = %L$q$, v_grant)));

  -- the proxy sees only a boolean "due", never an outcome, and nothing of the history
  perform pg_temp.ck('proxy cannot read the review history', '0', pg_temp.q_as(v_px, 'select count(*)::text from public.proxy_access_reviews'));
  perform pg_temp.ck('control: the person reads their own history', 'true', pg_temp.q_as(v_pa, 'select (count(*) > 0)::text from public.proxy_access_reviews'));
  perform pg_temp.ck('a stranger reads none', '0', pg_temp.q_as(v_stranger, 'select count(*)::text from public.proxy_access_reviews'));
  perform pg_temp.ck('a stranger sees no list', '0', pg_temp.q_as(v_stranger, 'select jsonb_array_length(public.my_proxy_reviews())::text'));

  -- 4. who can answer
  perform pg_temp.ck('the proxy cannot answer for the person', 'P0002', pg_temp.try_as(v_px, format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_px)));
  perform pg_temp.ck('the proxy cannot answer naming the person', 'P0002', pg_temp.try_as(v_px, format($q$select public.answer_proxy_review(%L, 'remove')$q$, v_pa)));
  perform pg_temp.ck('a stranger cannot answer', 'P0002', pg_temp.try_as(v_stranger, format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_px)));
  perform pg_temp.ck('anon cannot answer', '42501', pg_temp.try_anon(format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_px)));
  perform pg_temp.ck('a bad action is refused', '22023', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'delete')$q$, v_px)));
  perform pg_temp.ck('narrow without categories is refused', '22023', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'narrow')$q$, v_px)));
  perform pg_temp.ck('narrow to nothing is refused (that is a removal, not a narrowing)', '22023', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'narrow', array[]::public.care_access_category[])$q$, v_px)));
  perform pg_temp.ck('a stale list that leaves no shared category is refused and rolled back', '22023', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'narrow', array['labs_results']::public.care_access_category[])$q$, v_px)));
  perform pg_temp.ck('...and the categories are untouched', '2', (select count(*)::text from public.profile_access_categories where profile_access_id = v_grant));
  perform pg_temp.ck('refusals changed nothing', '1|0', pg_temp.n_grant(v_pa, v_px) || '|' || pg_temp.n_hist(v_pa, v_px, 'kept'));

  -- 3. keep restarts the cycle
  perform pg_temp.ck('the person keeps it', 'ok', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_px)));
  perform pg_temp.ck('no longer due', 'false', pg_temp.q_as(v_pa, format($q$select (e ->> 'is_due') from jsonb_array_elements(public.my_proxy_reviews()) e where (e ->> 'grant_id') = %L$q$, v_grant)));
  perform pg_temp.ck('keep is recorded and audited', '1|1', pg_temp.n_hist(v_pa, v_px, 'kept') || '|' || (select count(*)::text from public.audit_log where action = 'proxy_access.review_kept' and actor_id = v_pa));
  v_n := private.sweep_proxy_access_reviews();
  perform pg_temp.ck('a kept grant gets no reminder', '0', v_n::text);
  perform pg_temp.age_history(v_pa, v_px, interval '13 months');   -- a year passes
  v_n := private.sweep_proxy_access_reviews();
  perform pg_temp.ck('a year after keep it is due again with a fresh count', '1|1', v_n::text || '|' || (select count(*)::text from private.proxy_review_state() s where s.grantee_id = v_px and s.reminders_in_cycle = 1));
  perform pg_temp.ck('the proxy is told again in the new cycle', '2', pg_temp.n_hist(v_pa, v_px, 'proxy_told'));

  -- narrow
  perform pg_temp.ck('the person narrows', 'ok', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'narrow', array['vitals_readings']::public.care_access_category[])$q$, v_px)));
  perform pg_temp.ck('one category is left', '1', (select count(*)::text from public.profile_access_categories where profile_access_id = v_grant));
  perform pg_temp.ck('narrowing is recorded', '1', pg_temp.n_hist(v_pa, v_px, 'narrowed'));
  perform pg_temp.ck('narrowing is silent: no notice of change to the proxy', '0', (select count(*)::text from public.notifications where recipient_id = v_px and template = 'proxy_access_changed'));

  -- remove
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_pa, 'weight', 65);
  perform pg_temp.ck('control: the proxy reads the person''s readings before removal', '1', pg_temp.q_as(v_px, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pa)));
  perform pg_temp.ck('the person removes', 'ok', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'remove')$q$, v_px)));
  perform pg_temp.ck('grant gone', '0', pg_temp.n_grant(v_pa, v_px));
  perform pg_temp.ck('the proxy now reads nothing', '0', pg_temp.q_as(v_px, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pa)));
  perform pg_temp.ck('removal is recorded and outlives the grant', '1', pg_temp.n_hist(v_pa, v_px, 'removed'));
  perform pg_temp.ck('answering a removed grant again is refused', 'P0002', pg_temp.try_as(v_pa, format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_px)));
  perform pg_temp.ck('a removed grant is no longer swept', '0', (select count(*)::text from private.proxy_review_state() s where s.grantee_id = v_px));

  -- no active config: never a silent empty list
  update public.proxy_review_config set is_active = false;
  perform pg_temp.ck('with no active config the person''s list errors instead of reading as empty', 'ERR:P0001', pg_temp.q_as(v_stranger, 'select jsonb_array_length(public.my_proxy_reviews())::text'));
  perform pg_temp.ck('...and the proxy''s reader errors too, not an empty list', 'ERR:P0001', pg_temp.q_as(v_px2, 'select jsonb_array_length(public.proxy_review_due_as_proxy())::text'));
  perform pg_temp.ck('...and the sweep sends nothing', '0', private.sweep_proxy_access_reviews()::text);
  perform pg_temp.ck('...and opens an incident', '1', (select count(*)::text from public.ops_incidents where external_reference = 'proxy-review:no-config'));
  update public.proxy_review_config set is_active = true where version = 1;

  -- the safeguarding switch: tell_proxy = false means the proxy hears nothing at all
  update public.proxy_review_config set tell_proxy = false where version = 1;
  declare v_sa uuid := pg_temp.mkuser(v_org, 'silentperson'); v_sb uuid := pg_temp.mkuser(v_org, 'silentproxy');
  begin
    perform pg_temp.grant_aged(v_sa, v_sb, interval '13 months', array['vitals_readings']);
    perform private.sweep_proxy_access_reviews();
    perform pg_temp.ck('tell_proxy off: the person is still reminded', '1', pg_temp.n_notif(v_sa, 'proxy_review_due'));
    perform pg_temp.ck('tell_proxy off: the proxy gets no notice', '0', pg_temp.n_notif(v_sb, 'proxy_review_due_proxy'));
    perform pg_temp.ck('tell_proxy off: the proxy sees no due flag', '0', pg_temp.q_as(v_sb, 'select jsonb_array_length(public.proxy_review_due_as_proxy())::text'));
    perform pg_temp.ck('tell_proxy off: no proxy_told history', '0', pg_temp.n_hist(v_sa, v_sb, 'proxy_told'));
  end;
  update public.proxy_review_config set tell_proxy = true where version = 1;

  -- 5. scope
  v_child := pg_temp.mkuser(v_org, 'child'); v_guardian := pg_temp.mkuser(v_org, 'guardian');
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child', date_of_birth = (current_date - interval '10 years')::date where id = v_child;
  perform pg_temp.grant_aged(v_child, v_guardian, interval '14 months', array['vitals_readings']);
  v_elder := pg_temp.mkuser(v_org, 'elder'); v_elder_px := pg_temp.mkuser(v_org, 'elderproxy');
  update public.profiles set is_dependent_account = true, dependent_kind = 'elder_proxy' where id = v_elder;
  perform pg_temp.grant_aged(v_elder, v_elder_px, interval '14 months', array['vitals_readings']);
  v_exp := pg_temp.mkuser(v_org, 'expired'); v_exp_px := pg_temp.mkuser(v_org, 'expiredproxy');
  perform pg_temp.grant_aged(v_exp, v_exp_px, interval '14 months', array['vitals_readings']);
  update public.profile_access set expires_at = now() - interval '1 day' where profile_id = v_exp and grantee_user_id = v_exp_px;
  perform pg_temp.ck('guardian of an under-18 dependant is not reviewed', '0', (select count(*)::text from private.proxy_review_state() s where s.patient_id = v_child));
  perform pg_temp.ck('a record with no login of its own is not reviewed', '0', (select count(*)::text from private.proxy_review_state() s where s.patient_id = v_elder));
  perform pg_temp.ck('a grant past its own expiry is not reviewed', '0', (select count(*)::text from private.proxy_review_state() s where s.patient_id = v_exp));
  perform private.sweep_proxy_access_reviews();
  perform pg_temp.ck('none of the three got a notice', '0', (select count(*)::text from public.notifications where recipient_id in (v_child, v_guardian, v_elder, v_elder_px, v_exp, v_exp_px) and template like 'proxy_review_due%'));
  perform pg_temp.ck('...and all three grants stand', '3', (select count(*)::text from public.profile_access where profile_id in (v_child, v_elder, v_exp)));

  -- 6. a notice that cannot be queued: no history row, an incident, and a retry
  declare v_a uuid := pg_temp.mkuser(v_org, 'failperson'); v_b uuid := pg_temp.mkuser(v_org, 'failproxy'); v_g uuid;
  begin
    v_g := pg_temp.grant_aged(v_a, v_b, interval '13 months', array['vitals_readings']);
    perform pg_temp.grant_aged(pg_temp.mkuser(v_org, 'failperson2'), pg_temp.mkuser(v_org, 'failproxy2'), interval '13 months', array['vitals_readings']);
    create function public.pyr_fail_notice() returns trigger language plpgsql as $t$ begin raise exception 'notice queue unavailable'; end $t$;
    create trigger pyr_fail_notice before insert on public.notifications for each row when (new.template = 'proxy_review_due') execute function public.pyr_fail_notice();
    v_n := private.sweep_proxy_access_reviews();
    perform pg_temp.ck('a failed notice queues nothing', '0', v_n::text);
    perform pg_temp.ck('...writes no history row', '0', (select count(*)::text from public.proxy_access_reviews where patient_id = v_a));
    perform pg_temp.ck('...leaves no half-written notice for the proxy', '0', pg_temp.n_notif(v_b, 'proxy_review_due_proxy'));
    perform pg_temp.ck('...is opened as one incident for the run', '1', (select count(*)::text from public.ops_incidents where external_reference = 'proxy-review:notices'));
    perform pg_temp.ck('...and not one incident per grant', '0', (select count(*)::text from public.ops_incidents where external_reference like 'proxy-review:%' and external_reference not in ('proxy-review:notices', 'proxy-review:no-config')));
    perform pg_temp.ck('...and removes no access', '1', pg_temp.n_grant(v_a, v_b));
    drop trigger pyr_fail_notice on public.notifications;
    v_n := private.sweep_proxy_access_reviews();
    perform pg_temp.ck('once the queue works the next sweep retries it', '1', v_n::text);
    perform pg_temp.ck('...and the notice exists', '1', pg_temp.n_notif(v_a, 'proxy_review_due'));
    drop function public.pyr_fail_notice();
  end;

  -- one notice per person however many grants are due
  declare v_mp uuid := pg_temp.mkuser(v_org, 'multiperson'); v_m1 uuid := pg_temp.mkuser(v_org, 'multiproxy1'); v_m2 uuid := pg_temp.mkuser(v_org, 'multiproxy2');
  begin
    perform pg_temp.grant_aged(v_mp, v_m1, interval '13 months', array['vitals_readings']);
    perform pg_temp.grant_aged(v_mp, v_m2, interval '13 months', array['vitals_readings']);
    perform private.sweep_proxy_access_reviews();
    perform pg_temp.ck('two due grants give the person one notice, not two', '1', pg_temp.n_notif(v_mp, 'proxy_review_due'));
    perform pg_temp.ck('...but each grant is counted in its own history', '1|1', pg_temp.n_hist(v_mp, v_m1, 'reminder_sent') || '|' || pg_temp.n_hist(v_mp, v_m2, 'reminder_sent'));
    perform pg_temp.ck('...and each proxy is told once', '1|1', pg_temp.n_notif(v_m1, 'proxy_review_due_proxy') || '|' || pg_temp.n_notif(v_m2, 'proxy_review_due_proxy'));
    perform pg_temp.ck('the proxy flag is showing before the person answers', '1', pg_temp.q_as(v_m1, 'select jsonb_array_length(public.proxy_review_due_as_proxy())::text'));
    perform pg_temp.ck('the person keeps it', 'ok', pg_temp.try_as(v_mp, format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_m1)));
    perform pg_temp.ck('the flag does not change when the person answers (no timing signal to the proxy)', '1', pg_temp.q_as(v_m1, 'select jsonb_array_length(public.proxy_review_due_as_proxy())::text'));
  end;

  -- test accounts are never sent real email or push, only the in-app row (control: a real account with a push device gets the extra channel)
  declare v_tp uuid := pg_temp.mkuser(v_org, 'testperson'); v_tx uuid := pg_temp.mkuser(v_org, 'testproxy'); v_rp uuid := pg_temp.mkuser(v_org, 'realperson'); v_rx uuid := pg_temp.mkuser(v_org, 'realproxy');
  begin
    update public.profiles set is_test = false where id = v_rp;
    perform pg_temp.grant_aged(v_tp, v_tx, interval '13 months', array['vitals_readings']);
    perform pg_temp.grant_aged(v_rp, v_rx, interval '13 months', array['vitals_readings']);
    insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (v_org, v_tp, 'https://example.invalid/pyr-test', 'x', 'x'), (v_org, v_rp, 'https://example.invalid/pyr-real', 'x', 'x');
    perform private.sweep_proxy_access_reviews();
    perform pg_temp.ck('a test account gets only the in-app notice', '1|0', (select count(*) filter (where channel = 'in_app')::text || '|' || count(*) filter (where channel <> 'in_app')::text from public.notifications where recipient_id = v_tp and template = 'proxy_review_due'));
    perform pg_temp.ck('control: a real account with a device also gets its own channel', '1|1', (select count(*) filter (where channel = 'in_app')::text || '|' || count(*) filter (where channel <> 'in_app')::text from public.notifications where recipient_id = v_rp and template = 'proxy_review_due'));
  end;
  perform pg_temp.ck('the history table is in the data registry', '1', (select count(*)::text from public.data_registry where table_name = 'proxy_access_reviews'));

  -- 7. append only, privileges, classification, cron
  perform pg_temp.ck('history cannot be updated', '42501', pg_temp.try_as(v_pa, 'update public.proxy_access_reviews set kind = ''kept'''));
  perform pg_temp.ck('a person cannot write history directly', '42501', pg_temp.try_as(v_pa, format($q$insert into public.proxy_access_reviews (organisation_id, patient_id, grantee_user_id, kind) values (%L, %L, %L, 'kept')$q$, v_org, v_pa, v_px)));
  begin
    update public.proxy_access_reviews set kind = 'kept' where patient_id = v_pa;
    insert into results values ('real', 'owner-role update of history is refused', '42501', 'ok');
  exception when others then
    insert into results values ('real', 'owner-role update of history is refused', '42501', sqlstate);
  end;
  begin
    delete from public.proxy_access_reviews where patient_id = v_pa;
    insert into results values ('real', 'owner-role delete of history is refused', '42501', 'ok');
  exception when others then
    insert into results values ('real', 'owner-role delete of history is refused', '42501', sqlstate);
  end;
  declare v_ep uuid := pg_temp.mkuser(v_org, 'erasedperson'); v_ex uuid := pg_temp.mkuser(v_org, 'erasedproxy'); v_eg uuid; v_before text;
  begin
    v_eg := pg_temp.grant_aged(v_ep, v_ex, interval '13 months', array['vitals_readings']);
    perform private.sweep_proxy_access_reviews();
    v_before := (select count(*)::text from public.proxy_access_reviews where patient_id = v_ep);
    begin
      -- Deleting a profile cascades into profile_access_categories, whose guard trigger only lets the person whose record it is change it. The real
      -- erasure path is not under test here, so act as the patient (claims only, still the owner role) for this one delete.
      perform set_config('request.jwt.claims', json_build_object('sub', v_ep, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_ep::text, true);
      delete from public.profiles where id = v_ex;
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform pg_temp.ck('the proxy''s account is erased', '0', (select count(*)::text from public.profiles where id = v_ex));
    exception when others then
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform pg_temp.ck('the proxy''s account is erased', '0', 'could not delete: ' || sqlstate || ' ' || sqlerrm);
    end;
    perform pg_temp.ck('the person keeps their history when the proxy''s account is erased', v_before, (select count(*)::text from public.proxy_access_reviews where patient_id = v_ep));
    perform pg_temp.ck('...with the proxy''s id cleared', '0', (select count(*)::text from public.proxy_access_reviews where patient_id = v_ep and grantee_user_id is not null));
  end;
  perform pg_temp.ck('anon cannot read the history', '42501', pg_temp.try_anon('select count(*) from public.proxy_access_reviews'));
  perform pg_temp.ck('classified for under-18 dependants (guarded by default)', 'guarded', (select policy from public.minor_dependant_table_policy where table_name = 'proxy_access_reviews'));
  perform pg_temp.ck('the daily cron exists, is active and runs the sweep', '1', (select count(*)::text from cron.job where jobname = 'proxy-access-review-daily' and active and command ilike '%sweep_proxy_access_reviews%'));
  perform pg_temp.ck('the sweep is not callable by a session', 'false|false', has_function_privilege('authenticated', 'private.sweep_proxy_access_reviews()', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'private.sweep_proxy_access_reviews()', 'EXECUTE')::text);
  perform pg_temp.ck('templates registered with the neutral wording lint', '2', (select count(*)::text from public.notification_templates where key in ('proxy_review_due', 'proxy_review_due_proxy') and is_active));
end $$;

-- SABOTAGE A: no reminder cap. A fresh overdue grant is swept past the cap and must then keep sending (the real check flips).
create or replace function private.sweep_proxy_access_reviews() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  for r in select * from private.proxy_review_state() s where s.is_due loop
    insert into public.proxy_access_reviews (organisation_id, patient_id, grantee_user_id, grant_id, kind, is_test)
    values (r.organisation_id, r.patient_id, r.grantee_id, r.grant_id, 'reminder_sent', true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
do $$
declare v_org uuid; v_a uuid; v_b uuid; v_g uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'sabA'); v_b := pg_temp.mkuser(v_org, 'sabAproxy');
  v_g := pg_temp.grant_aged(v_a, v_b, interval '13 months', array['vitals_readings']);
  for i in 1..6 loop
    perform private.sweep_proxy_access_reviews();
    perform pg_temp.age_history(v_a, v_b, interval '31 days');
  end loop;
  insert into results values ('sabotaged', 'reminders stop at the cap', '4', pg_temp.n_hist(v_a, v_b, 'reminder_sent'));
end $$;

-- SABOTAGE C: the sweep removes access once overdue. The grant must then be gone (the real check "removed no access" flips).
create or replace function private.sweep_proxy_access_reviews() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select * from private.proxy_review_state() s where s.is_due loop
    -- the category guard trigger needs the owner's claims for the cascade; this stand-in sweep deliberately removes access
    perform set_config('request.jwt.claims', json_build_object('sub', r.patient_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.patient_id::text, true);
    delete from public.profile_access where id = r.grant_id;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return 0;
end $$;
do $$
declare v_org uuid; v_a uuid; v_b uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'sabC'); v_b := pg_temp.mkuser(v_org, 'sabCproxy');
  perform pg_temp.grant_aged(v_a, v_b, interval '13 months', array['vitals_readings']);
  perform private.sweep_proxy_access_reviews();
  insert into results values ('sabotaged', 'sweep removes no access', '1', pg_temp.n_grant(v_a, v_b));
end $$;

-- SABOTAGE B: answer_proxy_review finds the grant by proxy only, so anyone can answer. A stranger must then succeed (the real check "a stranger cannot answer" flips).
create or replace function public.answer_proxy_review(p_grantee uuid, p_action text, p_categories public.care_access_category[] default null, p_notify boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_grant public.profile_access%rowtype;
begin
  select * into v_grant from public.profile_access where grantee_user_id = p_grantee limit 1;
  if v_grant.id is null then raise exception 'no such access' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;
do $$
declare v_org uuid; v_a uuid; v_b uuid; v_s uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'sabB'); v_b := pg_temp.mkuser(v_org, 'sabBproxy'); v_s := pg_temp.mkuser(v_org, 'sabBstranger');
  perform pg_temp.grant_aged(v_a, v_b, interval '13 months', array['vitals_readings']);
  insert into results values ('sabotaged', 'a stranger cannot answer', 'P0002', pg_temp.try_as(v_s, format($q$select public.answer_proxy_review(%L, 'keep')$q$, v_b)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'proxy yearly review proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
