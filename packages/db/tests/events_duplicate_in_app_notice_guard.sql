-- Tarragon Health: the same in-app notice is never shown twice (2026-10-30)
--
-- Events harness sweep. About 22 producers wrote an explicit in-app row and a second row on the patient's reminder channel, which falls
-- back to the in-app inbox, so most patients saw the same notice twice (docs/design/EVENTS-HARNESS-NOTICE-SWEEP.md). The guard
-- (private.suppress_duplicate_in_app_notice, trigger notifications_zz_suppress_duplicate_in_app) marks an identical in-app row from the
-- same transaction `suppressed`; the inbox already hides suppressed rows.
--
--   1  shapes        two plain inserts, two sibling CTEs in one statement, and one INSERT ... SELECT yielding two rows are each
--                    reduced to one visible notice; the duplicate keeps its id (producers that `returning id` still get one)
--   2  not too much  a different payload, template, recipient or source is not suppressed; another channel is never touched; a repeat
--                    from a later transaction (a different created_at) is not suppressed
--   3  a real producer a doctor prescribing a medicine gives the patient exactly one visible "prescribed" notice in the app, where
--                    before the guard the same insert wrote two
--   4  what the patient sees the inbox query (status not in failed, suppressed) returns the one notice
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_duplicate_in_app_notice_guard.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ev10-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'EV10 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.visible(p_recipient uuid, p_template text) returns integer language sql as
$$ select count(*)::integer from public.notifications
    where recipient_id = p_recipient and template = p_template and channel = 'in_app' and status not in ('failed', 'suppressed') $$;
create function pg_temp.ins(p_recipient uuid, p_template text, p_payload jsonb, p_channel text default 'in_app', p_source uuid default null) returns uuid
language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, source_id)
  values (pg_temp.f('org'), p_recipient, p_channel::public.notification_channel, 'pending', p_template, p_payload, p_source)
  returning id into v_id;
  return v_id;
end $f$;

do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into fx values ('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into fx values ('pat', pg_temp.mkuser(v_org, 'pat', 'patient')), ('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  if not exists (select 1 from pg_trigger where tgname = 'notifications_zz_suppress_duplicate_in_app' and tgrelid = 'public.notifications'::regclass and not tgisinternal) then
    raise exception 'FAIL setup: the duplicate in-app guard is not installed';
  end if;
end $$;

-- ================================================================ 1 shapes
do $$
declare
  p uuid := pg_temp.f('pat'); o uuid := pg_temp.f('org'); a uuid; b uuid; v_dummy int;
begin
  -- two plain statements
  a := pg_temp.ins(p, 'ev10_plain', '{"x":1}'); b := pg_temp.ins(p, 'ev10_plain', '{"x":1}');
  if a is null or b is null then raise exception 'FAIL 1: a suppressed duplicate lost its id'; end if;
  if pg_temp.visible(p, 'ev10_plain') <> 1 then raise exception 'FAIL 1: two identical plain inserts show % notices', pg_temp.visible(p, 'ev10_plain'); end if;
  if (select status::text from public.notifications where id = a) <> 'pending' or (select status::text from public.notifications where id = b) <> 'suppressed' then
    raise exception 'FAIL 1: the first notice must stay and the repeat be the suppressed one';
  end if;

  -- two sibling CTEs in one statement (how most reminder producers write their rows)
  with c1 as (insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
                values (o, p, 'in_app', 'pending', 'ev10_cte', '{"x":2}') returning id),
       c2 as (insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
                values (o, p, 'in_app', 'pending', 'ev10_cte', '{"x":2}') returning id)
  select 1 into v_dummy;
  if pg_temp.visible(p, 'ev10_cte') <> 1 then raise exception 'FAIL 1: two sibling CTE inserts show % notices', pg_temp.visible(p, 'ev10_cte'); end if;

  -- one INSERT ... SELECT yielding two identical rows
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select o, p, 'in_app', 'pending', 'ev10_select', '{"x":3}' from generate_series(1, 2);
  if pg_temp.visible(p, 'ev10_select') <> 1 then raise exception 'FAIL 1: an INSERT ... SELECT of two identical rows shows % notices', pg_temp.visible(p, 'ev10_select'); end if;
end $$;

-- ================================================================ 2 not too much
do $$
declare p uuid := pg_temp.f('pat'); p2 uuid := pg_temp.f('pat2'); a uuid; b uuid; s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); v_n int;
begin
  a := pg_temp.ins(p, 'ev10_keep', '{"x":1}'); b := pg_temp.ins(p, 'ev10_keep', '{"x":2}');
  if pg_temp.visible(p, 'ev10_keep') <> 2 then raise exception 'FAIL 2: a different payload was suppressed'; end if;

  a := pg_temp.ins(p, 'ev10_t1', '{"x":1}'); b := pg_temp.ins(p, 'ev10_t2', '{"x":1}');
  if pg_temp.visible(p, 'ev10_t1') <> 1 or pg_temp.visible(p, 'ev10_t2') <> 1 then raise exception 'FAIL 2: a different template was suppressed'; end if;

  a := pg_temp.ins(p, 'ev10_who', '{"x":1}'); b := pg_temp.ins(p2, 'ev10_who', '{"x":1}');
  if pg_temp.visible(p, 'ev10_who') <> 1 or pg_temp.visible(p2, 'ev10_who') <> 1 then raise exception 'FAIL 2: a different recipient was suppressed'; end if;

  a := pg_temp.ins(p, 'ev10_src', '{"x":1}', 'in_app', s1); b := pg_temp.ins(p, 'ev10_src', '{"x":1}', 'in_app', s2);
  if pg_temp.visible(p, 'ev10_src') <> 2 then raise exception 'FAIL 2: a different source was suppressed'; end if;

  -- other channels are never touched
  a := pg_temp.ins(p, 'ev10_mail', '{"x":1}', 'email'); b := pg_temp.ins(p, 'ev10_mail', '{"x":1}', 'email');
  select count(*) into v_n from public.notifications where recipient_id = p and template = 'ev10_mail' and channel = 'email' and status = 'pending';
  if v_n <> 2 then raise exception 'FAIL 2: an identical email was suppressed (% of 2 pending)', v_n; end if;

  -- a repeat from a later transaction has a later created_at and is not suppressed
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, created_at)
  values (pg_temp.f('org'), p, 'in_app', 'pending', 'ev10_later', '{"x":1}', now() - interval '1 second');
  perform pg_temp.ins(p, 'ev10_later', '{"x":1}');
  if pg_temp.visible(p, 'ev10_later') <> 2 then raise exception 'FAIL 2: a repeat from a later transaction was suppressed'; end if;
end $$;

-- ================================================================ 3 a real producer
-- A doctor adds a clinician-sourced medicine; private.enqueue_medication_prescribed_notifications writes the patient's notice. That
-- function writes an explicit in-app row and a row on the reminder channel (in-app for this patient), so before the guard the patient
-- had two.
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid; v_med uuid; v_all int; v_visible int;
begin
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test)
  values (v_org, v_doc, 'EV10 doc', true, now(), 'senior_medical_officer', 'MDCN', 'EV10-1', 'Probe', 'EV10-1', now() + interval '1 year', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'EV10 Drug', '5 mg', 'Daily', 'clinician', v_doc) returning id into v_med;

  select count(*), count(*) filter (where status not in ('failed', 'suppressed')) into v_all, v_visible
    from public.notifications where recipient_id = v_pat and channel = 'in_app' and template = 'medication_prescribed_patient' and payload->>'drug_name' = 'EV10 Drug';
  if v_visible <> 1 then raise exception 'FAIL 3: the patient sees % "prescribed" notices in the app, expected 1 (% written)', v_visible, v_all; end if;
  if v_all < 2 then raise exception 'FAIL 3: only % in-app row(s) were written, so this producer no longer double-writes and the check proves nothing', v_all; end if;
end $$;

-- ================================================================ 4 what the patient sees
do $$
declare v_n int;
begin
  -- the same filter the web and mobile inboxes use
  select count(*) into v_n from public.notifications
   where recipient_id = pg_temp.f('pat') and channel = 'in_app' and status not in ('failed', 'suppressed')
     and template = 'medication_prescribed_patient';
  if v_n <> 1 then raise exception 'FAIL 4: the inbox query returns % prescribed notices, expected 1', v_n; end if;
end $$;

rollback;

select 'events_duplicate_in_app_notice_guard: ok' as result;
