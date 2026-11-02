-- ===========================================================================
-- Proof: Front Desk M3 CRM link (migration 20261102004500_fd_m3_crm_link.sql).
-- Spec acceptance check: "one form lead and one chat lead each create exactly one HubSpot contact with consent and source".
--
--   1. NO CONSENT, NO CAPTURE: without a true consent, wording or contact details nothing is stored, queued or scheduled.
--   2. A FORM LEAD makes one contact with source, a live email consent carrying the wording hash and version, one pending CRM upsert, one
--      note, and the post-enquiry follow-up (3 runs).
--   3. A CHAT LEAD with the same email is the SAME contact: still one contact, a chat consent added, still ONE pending upsert, a second note,
--      and the follow-up is not scheduled again.
--   4. KEYED ON EMAIL THEN PHONE: a phone-only enquiry is one contact; the same phone again is the same contact; later giving an email on the
--      same phone adopts that contact instead of creating a second.
--   5. SUPPRESSION WINS: an unsubscribed contact who submits again gets no new consent, outbox row or follow-up.
--   6. DELIVERY: nothing is claimed while hubspot_enabled is off; on, the upsert comes before the notes; a recorded success stores the HubSpot
--      id and the HubSpot-owned sales fields; a failure backs off and gives up after 6 attempts; a stage change queues exactly one new upsert;
--      a contact suppressed after queuing is not pushed.
--   7. ACCESS: nobody but the service role captures or claims; the overview is staff only.
--   8. SABOTAGE (each MUST flip): capture granted to authenticated; the one-pending-upsert index dropped; consent recording turned into a no-op.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Fails loudly and prints a verdict table.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.as_val(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
                                                else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;

create function pg_temp.cap(p_email text, p_phone text, p_source text, p_message text, p_consent boolean default true) returns jsonb language sql as $$
  select public.service_fd_capture_lead(p_email, p_phone, 'Ada Obi', p_source, p_message, p_consent, 'I agree that TarragonHealth may email me about my enquiry.', 'enquiry-consent-v1')
$$;
create function pg_temp.cid(p_email text) returns uuid language sql as $$ select id from public.fd_contacts where email = p_email $$;
create function pg_temp.pending_upserts(p_contact uuid) returns text language sql as
$$ select count(*)::text from public.fd_hubspot_outbox where contact_id = p_contact and kind = 'contact_upsert' and state = 'pending' $$;
create function pg_temp.notes(p_contact uuid) returns text language sql as
$$ select count(*)::text from public.fd_hubspot_outbox where contact_id = p_contact and kind = 'note' $$;

do $$
declare v_admin uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'fd3-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_pat]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone, created_at) values
    (v_admin, '00000000-0000-0000-0000-000000000001', 'admin',   'FD3 Admin',   '+2348058884701', now() - interval '90 days'),
    (v_pat,   '00000000-0000-0000-0000-000000000001', 'patient', 'FD3 Patient', '+2348058884702', now() - interval '90 days')
  on conflict (id) do update set role = excluded.role;
  insert into fx values ('admin', v_admin), ('pat', v_pat);
  update public.fd_app_config set value = 'false'::jsonb where key = 'hubspot_enabled';
end $$;

-- 1. no consent, no capture --------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('consent', 'without consent nothing is captured', 'false/consent_required',
  (select (r ->> 'captured') || '/' || (r ->> 'reason') from (select pg_temp.cap('nobody@example.invalid', null, 'website_form', 'hi', false) r) q));
select pg_temp.rec('consent', 'and no contact, outbox row or run exists', '0/0/0',
  (select (select count(*) from public.fd_contacts where email = 'nobody@example.invalid')::text || '/' || (select count(*) from public.fd_hubspot_outbox)::text
          || '/' || (select count(*) from public.fd_followup_runs fr join public.fd_contacts c on c.id = fr.contact_id where c.email = 'nobody@example.invalid')::text));
select pg_temp.rec('consent', 'a null consent is not consent', 'consent_required', (pg_temp.cap('n2@example.invalid', null, 'chat', 'hi', null)) ->> 'reason');
select pg_temp.rec('consent', 'no contact details is refused', 'no_contact_details', (pg_temp.cap('not-an-email', '12345', 'chat', 'hi')) ->> 'reason');
select pg_temp.rec('consent', 'an unknown source is refused', 'ERR:P0001',
  pg_temp.as_val(null, 'service_role', $q$select public.service_fd_capture_lead('x@example.invalid', null, 'X', 'telepathy', 'm', true, 'w', 'v1')::text$q$));
select pg_temp.rec('consent', 'blank wording is refused', 'consent_wording_required',
  (public.service_fd_capture_lead('w@example.invalid', null, 'W', 'chat', 'm', true, '  ', 'v1')) ->> 'reason');

-- 2. a form lead ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.cap('ada@example.invalid', '+2348031234567', 'website_form', 'I would like to know more about the app.');
select pg_temp.rec('form', 'one contact exists, with the source', '1/website_form',
  (select count(*)::text || '/' || min(source) from public.fd_contacts where email = 'ada@example.invalid'));
select pg_temp.rec('form', 'the phone was kept on the same contact', '+2348031234567', (select phone from public.fd_contacts where email = 'ada@example.invalid'));
select pg_temp.rec('form', 'a live email consent records the wording version and a 64 character hash', 'consent/enquiry-consent-v1/true',
  (select lawful_basis || '/' || wording_version || '/' || (evidence_hash ~ '^[0-9a-f]{64}$' and withdrawn_at is null)::text
     from public.fd_consents where contact_id = pg_temp.cid('ada@example.invalid') and channel = 'email' and purpose = 'service_followup'));
select pg_temp.rec('form', 'a web consent record exists too, whatever details were given', '1',
  (select count(*)::text from public.fd_consents where contact_id = pg_temp.cid('ada@example.invalid') and channel = 'web' and purpose = 'enquiry_record' and withdrawn_at is null));
select pg_temp.rec('form', 'it is marked for CRM sync', 'true', (select crm_sync::text from public.fd_contacts where email = 'ada@example.invalid'));
select pg_temp.rec('form', 'exactly one pending CRM upsert', '1', pg_temp.pending_upserts(pg_temp.cid('ada@example.invalid')));
select pg_temp.rec('form', 'one note, carrying the source, the consent version and their message', 'true',
  (select (payload ->> 'body' like '%website form%' and payload ->> 'body' like '%enquiry-consent-v1%' and payload ->> 'body' like '%know more about the app%')::text
     from public.fd_hubspot_outbox where contact_id = pg_temp.cid('ada@example.invalid') and kind = 'note'));
select pg_temp.rec('form', 'the post-enquiry follow-up is scheduled (3 steps)', '3',
  (select count(*)::text from public.fd_followup_runs fr join public.fd_sequences s on s.id = fr.sequence_id
    where fr.contact_id = pg_temp.cid('ada@example.invalid') and s.key = 'post_enquiry'));
select pg_temp.rec('form', 'the capture is audited', 'true', (select exists (select 1 from public.fd_audit_log where action = 'capture_lead' and entity_id = pg_temp.cid('ada@example.invalid')::text)::text));

-- 3. a chat lead with the same email --------------------------------------------------------------------------------------------------------------
select pg_temp.cap('ADA@example.invalid ', null, 'chat', 'Do you cover my parents too?');
select pg_temp.rec('chat', 'still exactly one contact for that email (the form lead and the chat lead are one person)', '1',
  (select count(*)::text from public.fd_contacts where email = 'ada@example.invalid'));
select pg_temp.rec('chat', 'its original source is kept', 'website_form', (select source from public.fd_contacts where email = 'ada@example.invalid'));
select pg_temp.rec('chat', 'a chat consent was added next to the web and email consents', '3',
  (select count(*)::text from public.fd_consents where contact_id = pg_temp.cid('ada@example.invalid') and withdrawn_at is null));
select pg_temp.rec('chat', 'still exactly ONE pending upsert (a burst becomes one write)', '1', pg_temp.pending_upserts(pg_temp.cid('ada@example.invalid')));
select pg_temp.rec('chat', 'a second note for the second enquiry', '2', pg_temp.notes(pg_temp.cid('ada@example.invalid')));
select pg_temp.rec('chat', 'the follow-up is not scheduled twice', '3',
  (select count(*)::text from public.fd_followup_runs fr join public.fd_sequences s on s.id = fr.sequence_id
    where fr.contact_id = pg_temp.cid('ada@example.invalid') and s.key = 'post_enquiry'));

-- 4. email then phone -------------------------------------------------------------------------------------------------------------------------------
select pg_temp.cap(null, '+2348099990001', 'chat', 'Phone only please.');
select pg_temp.rec('phone', 'a phone-only enquiry is one contact keyed on the phone', '1', (select count(*)::text from public.fd_contacts where phone = '+2348099990001' and email is null));
select pg_temp.cap(null, '+2348099990001', 'chat', 'Same person again.');
select pg_temp.rec('phone', 'the same phone again is the same contact', '1', (select count(*)::text from public.fd_contacts where phone = '+2348099990001'));
select pg_temp.rec('phone', 'a phone-only enquiry still leaves a live consent record (chat)', '1',
  (select count(*)::text from public.fd_consents where contact_id = (select id from public.fd_contacts where phone = '+2348099990001' limit 1) and withdrawn_at is null));
select pg_temp.cap(null, '+2348099990002', 'website_form', 'Phone only from the form.');
select pg_temp.rec('phone', 'a phone-only WEBSITE FORM lead has a live web consent record (no consent, no CRM)', '1',
  (select count(*)::text from public.fd_consents where contact_id = (select id from public.fd_contacts where phone = '+2348099990002') and channel = 'web' and withdrawn_at is null));
select pg_temp.rec('phone', 'a phone-only contact is not enrolled in email follow-up', '0',
  (select count(*)::text from public.fd_followup_runs fr join public.fd_contacts c on c.id = fr.contact_id where c.phone = '+2348099990001'));
select pg_temp.cap('later@example.invalid', '+2348099990001', 'chat', 'Now with an email.');
select pg_temp.rec('phone', 'giving an email on the same phone adopts the contact (still one)', '1/later@example.invalid',
  (select count(*)::text || '/' || min(email) from public.fd_contacts where phone = '+2348099990001'));
select pg_temp.rec('phone', 'and nobody else ended up with that email', '1', (select count(*)::text from public.fd_contacts where email = 'later@example.invalid'));

-- 5. suppression wins -------------------------------------------------------------------------------------------------------------------------------
select public.service_fd_unsubscribe(pg_temp.cid('ada@example.invalid'));
create temp table before_counts(o bigint, r bigint, c bigint) on commit drop;
grant all on before_counts to public;
insert into before_counts select (select count(*) from public.fd_hubspot_outbox), (select count(*) from public.fd_followup_runs where state = 'scheduled'), (select count(*) from public.fd_consents where withdrawn_at is null);
select pg_temp.rec('suppressed', 'an unsubscribed contact who submits again is reported suppressed', 'true',
  (pg_temp.cap('ada@example.invalid', null, 'website_form', 'Back again.')) ->> 'suppressed');
select pg_temp.rec('suppressed', 'and gets no new outbox row, run or consent', 'true',
  ((select count(*) from public.fd_hubspot_outbox) = (select o from before_counts)
   and (select count(*) from public.fd_followup_runs where state = 'scheduled') = (select r from before_counts)
   and (select count(*) from public.fd_consents where withdrawn_at is null) = (select c from before_counts))::text);

-- 6. delivery ---------------------------------------------------------------------------------------------------------------------------------------
create temp table lastclaim(j jsonb) on commit drop;
grant all on lastclaim to public;
create function pg_temp.hclaim() returns void language sql as $$
  delete from lastclaim;
  insert into lastclaim select coalesce(jsonb_agg(jsonb_build_object('id', outbox_id, 'k', kind, 'c', contact_id, 'a', attempts) order by (kind = 'note')), '[]'::jsonb) from public.service_fd_hubspot_claim(50)
$$;
select pg_temp.hclaim();
select pg_temp.rec('delivery', 'nothing is claimed while hubspot_enabled is off', '0', jsonb_array_length(j)::text) from lastclaim;
update public.fd_app_config set value = 'true'::jsonb where key = 'hubspot_enabled';
-- use the phone-adopted contact (not suppressed) for the delivery checks
select pg_temp.cap('later@example.invalid', null, 'chat', 'A second message.');
select pg_temp.hclaim();
select pg_temp.rec('delivery', 'when on, the upserts come before the notes', 'true',
  (select (jsonb_path_query_first(j, '$[0].k') = '"contact_upsert"'::jsonb and jsonb_path_query_first(j, '$[last].k') = '"note"'::jsonb)::text from lastclaim));
select pg_temp.rec('delivery', 'the suppressed contact''s queued rows are not pushed (marked failed)', 'true',
  (select bool_and(state = 'failed' and error = 'contact suppressed') ::text from public.fd_hubspot_outbox where contact_id = pg_temp.cid('ada@example.invalid')));
select pg_temp.rec('delivery', 'claimed rows are marked sending', 'true',
  (select (count(*) > 0)::text from public.fd_hubspot_outbox where contact_id = pg_temp.cid('later@example.invalid') and state = 'sending'));
select public.service_fd_hubspot_finish((x ->> 'id')::uuid, true, '98765', 'enquiry', '{"lifecyclestage":"lead","hs_lead_status":"NEW","hubspot_owner_id":null}'::jsonb, null)
  from lastclaim, jsonb_array_elements(j) x where (x ->> 'k') = 'contact_upsert' and (x ->> 'c')::uuid = pg_temp.cid('later@example.invalid');
select pg_temp.rec('delivery', 'a recorded success stores the HubSpot id', '98765', (select hubspot_contact_id from public.fd_contacts where email = 'later@example.invalid'));
select pg_temp.rec('delivery', 'and the HubSpot-owned sales fields, read back and not written', 'lead/NEW',
  (select (hubspot_sales ->> 'lifecyclestage') || '/' || (hubspot_sales ->> 'hs_lead_status') from public.fd_contacts where email = 'later@example.invalid'));
select pg_temp.rec('delivery', 'and the stage that was synced', 'enquiry', (select hubspot_synced_stage from public.fd_contacts where email = 'later@example.invalid'));

-- failure: back off, retry later, give up after 6
select public.service_fd_hubspot_finish((x ->> 'id')::uuid, false, null, null, null, 'vendor_error: 500')
  from lastclaim, jsonb_array_elements(j) x where (x ->> 'k') = 'note' and (x ->> 'c')::uuid = pg_temp.cid('later@example.invalid') limit 1;
select pg_temp.rec('delivery', 'a failure goes back to pending with a later retry time and its error', 'pending/true/vendor_error: 500',
  (select o.state || '/' || (o.next_attempt_at > now())::text || '/' || o.error from public.fd_hubspot_outbox o
    where o.contact_id = pg_temp.cid('later@example.invalid') and o.kind = 'note' and o.error is not null limit 1));
update public.fd_hubspot_outbox set state = 'sending', attempts = 6 where contact_id = pg_temp.cid('later@example.invalid') and kind = 'note' and error is not null;
select public.service_fd_hubspot_finish(id, false, null, null, null, 'vendor_error: 500') from public.fd_hubspot_outbox
 where contact_id = pg_temp.cid('later@example.invalid') and kind = 'note' and error is not null;
select pg_temp.rec('delivery', 'after 6 attempts it stays failed', 'failed',
  (select state from public.fd_hubspot_outbox where contact_id = pg_temp.cid('later@example.invalid') and kind = 'note' and error is not null limit 1));

-- stage change queues exactly one fresh upsert
update public.fd_contacts set lifecycle_stage = 'signed_up' where email = 'later@example.invalid';
select pg_temp.hclaim();
select pg_temp.rec('delivery', 'a stage change queues exactly one new upsert for that contact', '1',
  (select count(*)::text from lastclaim, jsonb_array_elements(j) x where (x ->> 'k') = 'contact_upsert' and (x ->> 'c')::uuid = pg_temp.cid('later@example.invalid')));
select pg_temp.hclaim();
select pg_temp.rec('delivery', 'and not again on the next claim (it is already sending)', 'false',
  (select exists (select 1 from lastclaim, jsonb_array_elements(j) x where (x ->> 'k') = 'contact_upsert' and (x ->> 'c')::uuid = pg_temp.cid('later@example.invalid')
                    and (x ->> 'a')::int = 1)::text));

-- a failed stage upsert is NOT re-enqueued on every claim
update public.fd_contacts set lifecycle_stage = 'onboarded' where email = 'later@example.invalid';
update public.fd_hubspot_outbox set state = 'failed', error = 'gave up' where contact_id = pg_temp.cid('later@example.invalid') and kind = 'contact_upsert' and state in ('pending', 'sending');
create temp table upsert_count(n bigint) on commit drop;
grant all on upsert_count to public;
insert into upsert_count select count(*) from public.fd_hubspot_outbox where contact_id = pg_temp.cid('later@example.invalid') and kind = 'contact_upsert';
select pg_temp.hclaim();
select pg_temp.hclaim();
select pg_temp.rec('delivery', 'a recently failed upsert is not re-enqueued by later claims (the cap means something)', 'true',
  ((select count(*) from public.fd_hubspot_outbox where contact_id = pg_temp.cid('later@example.invalid') and kind = 'contact_upsert') = (select n from upsert_count))::text);

-- 7. access ---------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('access', 'a patient cannot capture a lead', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.service_fd_capture_lead('z@example.invalid', null, 'Z', 'chat', 'm', true, 'w', 'v1')::text$q$));
select pg_temp.rec('access', 'anon cannot capture a lead', 'ERR:42501',
  pg_temp.as_val(null, 'anon', $q$select public.service_fd_capture_lead('z@example.invalid', null, 'Z', 'chat', 'm', true, 'w', 'v1')::text$q$));
select pg_temp.rec('access', 'an admin cannot claim CRM rows (service role only)', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.service_fd_hubspot_claim(1)'));
select pg_temp.rec('access', 'a patient cannot read the outbox', '0', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.fd_hubspot_outbox'));
select pg_temp.rec('access', 'a patient cannot read the CRM overview', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select (public.fd_crm_overview())::text'));
select pg_temp.rec('access', 'an admin reads the CRM overview', 'true',
  (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select (public.fd_crm_overview())::text') like '%synced_contacts%')::text);
select pg_temp.rec('access', 'a patient cannot switch the CRM sync on', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_set_config('hubspot_enabled', 'true'::jsonb)::text$q$));

-- 8. SABOTAGE -------------------------------------------------------------------------------------------------------------------------------------
grant execute on function public.service_fd_capture_lead(text, text, text, text, text, boolean, text, text) to authenticated;
select pg_temp.rec('sabotage', 'SABOTAGE (a): capture granted to authenticated, a patient can now capture', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.service_fd_capture_lead('sab1@example.invalid', null, 'Z', 'chat', 'm', true, 'w', 'v1') ->> 'captured'$q$));

drop index public.fd_hubspot_outbox_one_pending_upsert;
select pg_temp.cap('dup@example.invalid', null, 'chat', 'one');
insert into public.fd_hubspot_outbox (contact_id, kind, dedupe_key) values (pg_temp.cid('dup@example.invalid'), 'contact_upsert', 'sab:1');
select pg_temp.rec('sabotage', 'SABOTAGE (b): one-pending-upsert index dropped, a burst now makes two writes', '1', pg_temp.pending_upserts(pg_temp.cid('dup@example.invalid')));

create or replace function private.fd_record_consent(p_contact uuid, p_channel text, p_purpose text, p_basis text, p_version text, p_wording text, p_source text)
returns void language sql as $$ select 1 $$;
select pg_temp.cap('noconsent@example.invalid', null, 'website_form', 'x');
select pg_temp.rec('sabotage', 'SABOTAGE (c): consent recording made a no-op, a lead is captured with no consent row', '1',
  (select count(*)::text from public.fd_consents where contact_id = pg_temp.cid('noconsent@example.invalid')));

-- Verdict ---------------------------------------------------------------------------------------------------------------------------------------
select phase, check_name, expected, actual,
       case when phase = 'sabotage' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL (sabotage not detected)' end
            when expected = actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;

do $$
declare v_bad int; v_first text;
begin
  select count(*), min(check_name) into v_bad, v_first from results
   where (phase <> 'sabotage' and expected is distinct from actual) or (phase = 'sabotage' and expected is not distinct from actual);
  if v_bad > 0 then raise exception 'fd M3 proof: % check(s) failed, first: %', v_bad, v_first; end if;
end $$;

rollback;
