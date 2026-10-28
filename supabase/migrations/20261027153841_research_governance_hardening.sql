-- Research governance hardening (follow-up to S81, from the S81-S85 review: docs/research/S81-S85-competitor-gap-analysis-2026-10-22.md).
--
-- What S81 already enforces and this does not touch: research consent separate and off by default; consented, non-test patients only; per-protocol
-- participant key; at least 20 participants; no commercial recipient type and no price column; CMO plus data protection officer approval; an approved
-- protocol frozen; the guard research_export_enabled shipped OFF; every export audited.
--
-- Five additions, each a lesson from a named case:
--   1. BARRED RECIPIENTS (UK Biobank's disputed insurer access). recipient_type has no commercial value, but the NAME is free text, so an insurer could be
--      typed in as "academic". private.research_recipient_barred() checks the name against research_barred_recipient_terms (insurers, HMOs, employers,
--      pharmaceutical companies, advertisers, data brokers, and the HMOs named in CLAUDE.md). It runs when a protocol is drafted AND when it is approved.
--      A name check is a safety net, not a legal control: the recipient_type and the signed data-sharing agreement remain the real ones.
--   2. TWO PEOPLE PER RELEASE (OpenSAFELY checks every output with two trained people). run_research_export now needs an authorised request: the CMO asks,
--      a DIFFERENT person (an admin, the data protection officer's route) authorises, and the export consumes that one authorisation within 7 days.
--   3. NO SUBTRACTING TWO EXPORTS (All of Us bars counts derivable from small cells; S38f holds back small month-to-month changes). Each export privately
--      keeps its participant keys (per-protocol, not joinable to any other protocol, never returned to anyone). A new export for the same protocol is
--      refused if its participants differ from the previous export's by fewer than min_cell_size people but not zero.
--   4. A PUBLIC LEDGER. research_ledger() lists every approved or closed protocol (title, question, recipient, ethics body, how many releases and when),
--      readable by any signed-in person. A protocol can only release data once approved, so it is on the ledger before its first release.
--   5. A WAY TO CHALLENGE. research_challenges: any signed-in person can ask a question or object about a research use; the data protection officer
--      (admin route) sees and answers it. Limited to 3 open at a time per person.
--
-- Counts at write time: no existing rows are touched. research_exports has 0 rows live (the guard is off), so no backfill of participant keys is needed.
-- This does not switch anything on: research_export_enabled stays as it is. ROLLBACK: restore the S81 bodies of create_research_protocol,
-- approve_research_protocol and run_research_export; drop the new functions and tables; drop column research_exports.participant_keys.

-- ---------------------------------------------------------------------------
-- 1. Barred recipients
-- ---------------------------------------------------------------------------
create table public.research_barred_recipient_terms (
  term text primary key check (term = lower(term) and term <> ''),
  why text not null
);
alter table public.research_barred_recipient_terms enable row level security;
revoke all on public.research_barred_recipient_terms from public, anon, authenticated;
comment on table public.research_barred_recipient_terms is
  'Word beginnings that bar a research recipient by name (insurers, HMOs, employers, pharma, advertisers, data brokers). A safety net on a free-text name, not a legal control. PROPOSED by engineering; counsel and the CMO confirm the list.';

insert into public.research_barred_recipient_terms (term, why) values
  ('insur',         'insurers and insurance bodies: health data must never reach a payer or risk assessor'),
  ('assurance',     'insurance by another name'),
  ('hmo',           'health maintenance organisations'),
  ('health maintenance', 'health maintenance organisations'),
  ('underwrit',     'underwriting'),
  ('employer',      'employers: an employer sees aggregates only (rule I9), never research data'),
  ('pharma',        'pharmaceutical companies'),
  ('drug compan',   'pharmaceutical companies'),
  ('advertis',      'advertisers'),
  ('marketing',     'marketing bodies'),
  ('data broker',   'data brokers'),
  ('broker',        'data brokers'),
  ('analytics compan', 'commercial analytics resellers'),
  ('reliance',      'an HMO named in CLAUDE.md (Key Partners)'),
  ('avon',          'an HMO named in CLAUDE.md (Key Partners)'),
  ('ronsberger',    'an HMO named in CLAUDE.md (Key Partners)'),
  ('wellahealth',   'an HMO named in CLAUDE.md (Key Partners)')
on conflict (term) do nothing;

-- Returns the first barred term the name starts a word with, or null. Word start only, so "Avondale University" is caught by "avon" on purpose
-- (a human then clears it by renaming or by counsel's note), and "Pharmacology Department" is caught by "pharma"; a false catch costs a rename, a miss costs trust.
create or replace function private.research_recipient_barred(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select t.term from public.research_barred_recipient_terms t
   where lower(coalesce(p_name, '')) ~ ('(^|[^a-z0-9])' || regexp_replace(t.term, '([.\[\]()*+?{}|^$\\])', '\\\1', 'g'))
   order by t.term limit 1
$$;
revoke all on function private.research_recipient_barred(text) from public, anon;
grant execute on function private.research_recipient_barred(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Exports keep their participant set, privately
-- ---------------------------------------------------------------------------
alter table public.research_exports add column participant_keys text[];
comment on column public.research_exports.participant_keys is
  'The per-protocol participant keys released in this export. Never returned by any function; read only inside run_research_export to refuse a release that differs from the previous one by a small number of people.';

-- True when the new release cannot be subtracted from the previous one to expose a few people: identical, or different by at least min_cell people.
create or replace function private.research_difference_ok(p_prev text[], p_curr text[], p_min integer) returns boolean
language sql immutable set search_path = '' as $$
  select case when p_prev is null then true
    else (
      with a as (select distinct unnest(coalesce(p_prev, '{}')) k), b as (select distinct unnest(coalesce(p_curr, '{}')) k),
           d as (select count(*) n from ((select k from a except select k from b) union all (select k from b except select k from a)) x)
      select (select n from d) = 0 or (select n from d) >= p_min
    ) end
$$;
revoke all on function private.research_difference_ok(text[], text[], integer) from public, anon;
grant execute on function private.research_difference_ok(text[], text[], integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Two people per release
-- ---------------------------------------------------------------------------
create table public.research_export_requests (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.research_protocols(id),
  organisation_id uuid not null references public.organisations(id),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  note text not null check (char_length(btrim(note)) between 10 and 1000),
  authorised_by uuid references public.profiles(id),
  authorised_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  export_id uuid references public.research_exports(id),
  constraint research_export_requests_two_people check (authorised_by is null or authorised_by <> requested_by),
  constraint research_export_requests_authorised_complete check ((authorised_by is null) = (authorised_at is null)),
  constraint research_export_requests_consumed_after_authorised check (consumed_at is null or authorised_at is not null),
  constraint research_export_requests_not_both check (consumed_at is null or cancelled_at is null)
);
create unique index research_export_requests_one_open on public.research_export_requests (protocol_id) where consumed_at is null and cancelled_at is null;
alter table public.research_export_requests enable row level security;
revoke all on public.research_export_requests from public, anon, authenticated;

create or replace function public.request_research_export(p_protocol_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_p public.research_protocols%rowtype; v_id uuid;
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer requests a research export' using errcode = '42501'; end if;
  select * into v_p from public.research_protocols where id = p_protocol_id and status = 'approved';
  if not found then raise exception 'the protocol is missing or not approved'; end if;
  -- An unused request older than 7 days is retired, so it cannot block a new one for ever (an authorisation is good for 7 days).
  update public.research_export_requests set cancelled_at = now()
   where protocol_id = v_p.id and consumed_at is null and cancelled_at is null and coalesce(authorised_at, requested_at) <= now() - interval '7 days';
  begin
    insert into public.research_export_requests (protocol_id, organisation_id, requested_by, note)
    values (v_p.id, v_p.organisation_id, v_actor, btrim(p_note)) returning id into v_id;
  exception when unique_violation then
    raise exception 'there is already an open export request for this protocol' using errcode = '55000';
  end;
  perform private.log_audit('research_export.requested', 'research_export_requests', v_id, jsonb_build_object('protocol_id', v_p.id));
  return v_id;
end $$;

create or replace function public.authorise_research_export(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); r public.research_export_requests%rowtype;
begin
  if not private.is_admin() then raise exception 'not authorised: the second person authorises through an admin account (the data protection officer)' using errcode = '42501'; end if;
  select * into r from public.research_export_requests where id = p_request_id for update;
  if not found or r.organisation_id is distinct from (select private.current_org_id()) then raise exception 'that export request was not found' using errcode = '22023'; end if;
  if r.requested_by = v_actor then raise exception 'separation of duties: you requested this export, so someone else must authorise it' using errcode = '42501'; end if;
  if r.consumed_at is not null or r.cancelled_at is not null or r.authorised_by is not null then raise exception 'this request has already been authorised or used' using errcode = '55000'; end if;
  update public.research_export_requests set authorised_by = v_actor, authorised_at = now() where id = p_request_id;
  perform private.log_audit('research_export.authorised', 'research_export_requests', p_request_id, jsonb_build_object('protocol_id', r.protocol_id));
end $$;

create or replace function public.research_export_requests_list()
returns table (id uuid, protocol_id uuid, protocol_title text, requested_at timestamptz, note text, authorised boolean, expired boolean, is_mine boolean, can_authorise boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_active_clinical_director() or private.is_admin()) then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select r.id, r.protocol_id, p.title, r.requested_at, r.note, r.authorised_by is not null,
         coalesce(r.authorised_at, r.requested_at) <= now() - interval '7 days',
         r.requested_by = (select auth.uid()),
         private.is_admin() and r.authorised_by is null and r.requested_by <> (select auth.uid())
    from public.research_export_requests r join public.research_protocols p on p.id = r.protocol_id
   where r.consumed_at is null and r.cancelled_at is null and r.organisation_id = (select private.current_org_id())
   order by r.requested_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- Protocol drafting and approval now refuse a barred recipient
-- ---------------------------------------------------------------------------
create or replace function public.create_research_protocol(
  p_title text, p_question text, p_allowed_fields text[], p_de_identification_method text, p_recipient_name text, p_recipient_type text,
  p_ethics_approval_ref text, p_ethics_body text, p_ethics_approved_on date, p_data_sharing_agreement_ref text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_org uuid; v_id uuid; v_bar text;
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer drafts a research protocol' using errcode = '42501'; end if;
  if not private.research_fields_ok(p_allowed_fields) then raise exception 'a field is not on the research allow-list (identifiers, organisation and exact dates are never allowed)'; end if;
  v_bar := private.research_recipient_barred(p_recipient_name);
  if v_bar is not null then raise exception 'that recipient is barred (matches "%"): health data is never shared with insurers, HMOs, employers, pharmaceutical companies, advertisers or data brokers', v_bar using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  if v_org is null then raise exception 'the acting profile has no organisation'; end if;
  insert into public.research_protocols (organisation_id, title, question, dataset_code, allowed_fields, de_identification_method, recipient_name, recipient_type,
    ethics_approval_ref, ethics_body, ethics_approved_on, data_sharing_agreement_ref, created_by)
  values (v_org, p_title, p_question, 'outcome_snapshots_v1', p_allowed_fields, p_de_identification_method, p_recipient_name, p_recipient_type,
    nullif(trim(p_ethics_approval_ref), ''), nullif(trim(p_ethics_body), ''), p_ethics_approved_on, nullif(trim(p_data_sharing_agreement_ref), ''), v_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_research_protocol(p_id uuid) returns public.research_protocol_status
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_row public.research_protocols%rowtype; v_bar text;
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer approves a research protocol' using errcode = '42501'; end if;
  select recipient_name into v_row.recipient_name from public.research_protocols where id = p_id and status = 'draft';
  v_bar := private.research_recipient_barred(v_row.recipient_name);
  if v_bar is not null then raise exception 'that recipient is barred (matches "%"): this protocol cannot be approved', v_bar using errcode = '22023'; end if;
  update public.research_protocols set cmo_approved_by = v_actor, cmo_approved_at = now()
    where id = p_id and status = 'draft' returning * into v_row;
  if not found then raise exception 'protocol not found or not a draft'; end if;
  if v_row.dpo_confirmed_by is not null then
    update public.research_protocols set status = 'approved' where id = p_id;
    return 'approved';
  end if;
  return 'draft';
end $$;

-- The data protection officer's confirmation also re-checks the name, so a protocol cannot reach 'approved' by either route with a barred recipient.
create or replace function public.confirm_research_protocol_dpo(p_id uuid) returns public.research_protocol_status
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_row public.research_protocols%rowtype; v_bar text;
begin
  if not private.is_admin() then raise exception 'not authorised: the data protection officer confirms through an admin account' using errcode = '42501'; end if;
  select recipient_name into v_row.recipient_name from public.research_protocols where id = p_id and status = 'draft';
  v_bar := private.research_recipient_barred(v_row.recipient_name);
  if v_bar is not null then raise exception 'that recipient is barred (matches "%"): this protocol cannot be approved', v_bar using errcode = '22023'; end if;
  update public.research_protocols set dpo_confirmed_by = v_actor, dpo_confirmed_at = now()
    where id = p_id and status = 'draft' returning * into v_row;
  if not found then raise exception 'protocol not found or not a draft'; end if;
  if v_row.cmo_approved_by is not null then
    update public.research_protocols set status = 'approved' where id = p_id;
    return 'approved';
  end if;
  return 'draft';
end $$;

-- ---------------------------------------------------------------------------
-- The export: S81's body plus the authorised request and the subtraction check
-- ---------------------------------------------------------------------------
create or replace function public.run_research_export(p_protocol_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_p public.research_protocols%rowtype;
  v_req public.research_export_requests%rowtype;
  v_rows jsonb;
  v_n integer; v_people integer; v_hash text; v_id uuid;
  v_keys text[]; v_prev text[];
  v_all text[] := array['pathway_code', 'day', 'enrolment_month', 'bp_avg_7d_sys', 'bp_avg_7d_dia', 'bp_readings_7d', 'bp_status',
                        'target_source', 'adherence_pct', 'adherence_doses_due', 'config_version', 'computed_month'];
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer runs a research export' using errcode = '42501'; end if;
  if not private.go_live_guard_on('research_export_enabled') then raise exception 'research export is switched off'; end if;
  select * into v_p from public.research_protocols where id = p_protocol_id and status = 'approved';
  if not found then raise exception 'the protocol is missing or not approved'; end if;
  if private.research_recipient_barred(v_p.recipient_name) is not null then raise exception 'the recipient of this protocol is barred'; end if;
  if not (v_p.allowed_fields <@ v_all) then raise exception 'the protocol lists a field that is not on the allow-list'; end if;

  -- Two people: an authorisation by someone other than the requester, for this protocol, not used, not older than 7 days.
  select * into v_req from public.research_export_requests r
   where r.protocol_id = v_p.id and r.requested_by = v_actor and r.authorised_by is not null and r.consumed_at is null and r.cancelled_at is null
     and r.authorised_at > now() - interval '7 days'
   order by r.authorised_at limit 1 for update;
  if not found then raise exception 'a second person must authorise this export first (request it, then ask the data protection officer to authorise it)' using errcode = '55000'; end if;

  with elig as (
    select o.*, s.patient_id
    from analytics.v_outcome_snapshots o
    join analytics.subjects s on s.subject_key = o.subject_key
    join public.patient_consent_state c on c.patient_id = s.patient_id and c.consent_type_code = 'research' and c.granted and c.withdrawn_at is null
    -- only data recorded AFTER the person agreed: nothing collected before their consent is released (the day they agreed is left out too)
    where o.organisation_id = v_p.organisation_id
      and private.research_eligible(s.patient_id, v_p.id)
      and o.computed_on > (c.granted_at at time zone 'UTC')::date
  ), enrol_n as (
    select enrolment_month m, count(distinct subject_key) n from elig group by 1
  ), month_n as (
    select date_trunc('month', computed_on::timestamp)::date m, count(distinct subject_key) n from elig group by 1
  ), shaped as (
    select encode(extensions.digest(e.subject_key::text || ':' || v_p.id::text, 'sha256'), 'hex') as participant,
           to_jsonb(e)
             -- a month value shared by fewer participants than the protocol's minimum would single someone out: it is released as empty
             || jsonb_build_object('enrolment_month', case when en.n >= v_p.min_cell_size then to_jsonb(e.enrolment_month) else 'null'::jsonb end)
             || jsonb_build_object('computed_month', case when mn.n >= v_p.min_cell_size then to_jsonb(date_trunc('month', e.computed_on::timestamp)::date) else 'null'::jsonb end) as j
    from elig e
    join enrol_n en on en.m = e.enrolment_month
    join month_n mn on mn.m = date_trunc('month', e.computed_on::timestamp)::date
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('participant', participant) ||
           (select coalesce(jsonb_object_agg(k, sh.j -> k), '{}'::jsonb) from unnest(v_p.allowed_fields) k)
           order by participant), '[]'::jsonb),
         count(*), count(distinct participant), coalesce(array_agg(distinct participant), '{}')
  into v_rows, v_n, v_people, v_keys
  from shaped sh;

  if v_people < v_p.min_cell_size then
    raise exception 'too few participants to release (% found, at least % needed): nothing was exported', v_people, v_p.min_cell_size;
  end if;

  -- Not a subtraction of the last release: the people must be the same, or differ by at least the minimum cell size.
  select e.participant_keys into v_prev from public.research_exports e
   where e.protocol_id = v_p.id and e.participant_keys is not null order by e.created_at desc limit 1;
  if not private.research_difference_ok(v_prev, v_keys, v_p.min_cell_size) then
    raise exception 'held back: this release differs from the previous one by fewer than % people, which could expose them by subtraction; nothing was exported', v_p.min_cell_size using errcode = '55000';
  end if;

  v_hash := encode(extensions.digest(v_rows::text, 'sha256'), 'hex');
  insert into public.research_exports (protocol_id, organisation_id, requested_by, row_count, participant_count, fields, content_sha256, participant_keys)
  values (v_p.id, v_p.organisation_id, v_actor, v_n, v_people, v_p.allowed_fields, v_hash, v_keys) returning id into v_id;
  update public.research_export_requests set consumed_at = now(), export_id = v_id where id = v_req.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (v_actor, 'research_export.created', 'research_exports', v_id,
          jsonb_build_object('protocol_id', v_p.id, 'row_count', v_n, 'participant_count', v_people, 'sha256', v_hash, 'authorised_by', v_req.authorised_by));
  perform private.emit_domain_event('research_export.created', v_p.organisation_id,
    jsonb_build_object('export_id', v_id, 'protocol_id', v_p.id, 'row_count', v_n),
    'research_export.created:' || v_id, null, 'research_exports', v_id);
  return jsonb_build_object('export_id', v_id, 'fields', to_jsonb(v_p.allowed_fields), 'rows', v_rows, 'sha256', v_hash);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The public ledger
-- ---------------------------------------------------------------------------
create or replace function public.research_ledger()
returns table (id uuid, title text, question text, recipient_name text, recipient_type text, ethics_body text, ethics_approved_on date,
               status public.research_protocol_status, listed_on date, release_count bigint, last_release_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query
  select p.id, p.title, p.question, p.recipient_name, p.recipient_type, p.ethics_body, p.ethics_approved_on, p.status,
         greatest(p.cmo_approved_at, p.dpo_confirmed_at)::date,
         (select count(*) from public.research_exports e where e.protocol_id = p.id),
         (select max(e.created_at)::date from public.research_exports e where e.protocol_id = p.id)
    from public.research_protocols p
   where p.status in ('approved', 'closed') and p.organisation_id = (select private.current_org_id())
   order by greatest(p.cmo_approved_at, p.dpo_confirmed_at) desc;
end $$;
comment on function public.research_ledger() is
  'The public list of research uses. Returns no reference numbers, no agreement ids, no participant counts and no data: only what a member needs to know and to question.';

-- ---------------------------------------------------------------------------
-- 5. A way to challenge
-- ---------------------------------------------------------------------------
create table public.research_challenges (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  protocol_id uuid references public.research_protocols(id),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'answered')),
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  answer text check (answer is null or char_length(btrim(answer)) between 10 and 4000),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  constraint research_challenges_answered_complete check ((status = 'open' and answered_by is null and answered_at is null and answer is null)
                                                       or (status = 'answered' and answered_by is not null and answered_at is not null and answer is not null))
);
create index research_challenges_open_idx on public.research_challenges (organisation_id, status, created_at desc);
alter table public.research_challenges enable row level security;
revoke all on public.research_challenges from public, anon, authenticated;

create or replace function public.raise_research_challenge(p_protocol_id uuid, p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_org uuid; v_test boolean; v_id uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_actor;
  if v_org is null then raise exception 'no organisation' using errcode = '22023'; end if;
  if p_protocol_id is not null and not exists (select 1 from public.research_protocols where id = p_protocol_id and status in ('approved', 'closed')) then
    raise exception 'that research use was not found' using errcode = '22023';
  end if;
  if (select count(*) from public.research_challenges where patient_id = v_actor and status = 'open') >= 3 then
    raise exception 'you already have 3 open questions; please wait for an answer' using errcode = '55000';
  end if;
  insert into public.research_challenges (organisation_id, patient_id, protocol_id, message, is_test)
  values (v_org, v_actor, p_protocol_id, btrim(p_message), v_test) returning id into v_id;
  perform private.log_audit('research_challenge.raised', 'research_challenges', v_id, jsonb_build_object('protocol_id', p_protocol_id));
  return v_id;
end $$;

create or replace function public.my_research_challenges()
returns table (id uuid, protocol_id uuid, message text, status text, answer text, created_at timestamptz, answered_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.protocol_id, c.message, c.status, c.answer, c.created_at, c.answered_at
    from public.research_challenges c where c.patient_id = (select auth.uid()) order by c.created_at desc
$$;

create or replace function public.research_challenges_list()
returns table (id uuid, protocol_id uuid, protocol_title text, message text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorised: the data protection officer reads these through an admin account' using errcode = '42501'; end if;
  -- The person's identity is not returned: the officer answers the question, and the answer reaches the person who asked.
  return query
  select c.id, c.protocol_id, p.title, c.message, c.status, c.created_at
    from public.research_challenges c left join public.research_protocols p on p.id = c.protocol_id
   where c.organisation_id = (select private.current_org_id()) and not c.is_test
   order by (c.status = 'open') desc, c.created_at desc;
end $$;

create or replace function public.answer_research_challenge(p_id uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_admin() then raise exception 'not authorised: the data protection officer answers through an admin account' using errcode = '42501'; end if;
  update public.research_challenges set status = 'answered', answered_by = v_actor, answered_at = now(), answer = btrim(p_answer)
   where id = p_id and status = 'open' and organisation_id = (select private.current_org_id());
  if not found then raise exception 'that question was not found or has already been answered' using errcode = '22023'; end if;
  perform private.log_audit('research_challenge.answered', 'research_challenges', p_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only, never anon or the public pseudo-role (anon inherits EXECUTE through PUBLIC)
-- ---------------------------------------------------------------------------
revoke all on function public.request_research_export(uuid, text) from public, anon;
revoke all on function public.authorise_research_export(uuid) from public, anon;
revoke all on function public.research_export_requests_list() from public, anon;
revoke all on function public.research_ledger() from public, anon;
revoke all on function public.raise_research_challenge(uuid, text) from public, anon;
revoke all on function public.my_research_challenges() from public, anon;
revoke all on function public.research_challenges_list() from public, anon;
revoke all on function public.answer_research_challenge(uuid, text) from public, anon;
revoke all on function public.create_research_protocol(text, text, text[], text, text, text, text, text, date, text) from public, anon;
revoke all on function public.approve_research_protocol(uuid) from public, anon;
revoke all on function public.confirm_research_protocol_dpo(uuid) from public, anon;
revoke all on function public.run_research_export(uuid) from public, anon;
grant execute on function public.request_research_export(uuid, text) to authenticated;
grant execute on function public.authorise_research_export(uuid) to authenticated;
grant execute on function public.research_export_requests_list() to authenticated;
grant execute on function public.research_ledger() to authenticated;
grant execute on function public.raise_research_challenge(uuid, text) to authenticated;
grant execute on function public.my_research_challenges() to authenticated;
grant execute on function public.research_challenges_list() to authenticated;
grant execute on function public.answer_research_challenge(uuid, text) to authenticated;
grant execute on function public.create_research_protocol(text, text, text[], text, text, text, text, text, date, text) to authenticated;
grant execute on function public.approve_research_protocol(uuid) to authenticated;
grant execute on function public.confirm_research_protocol_dpo(uuid) to authenticated;
grant execute on function public.run_research_export(uuid) to authenticated;

-- The S39d data registry refuses any table with a uuid patient_id and no registry row (the two-tier replay assertion). A member's own questions are
-- theirs: they go in the member's data export, and the default class is kept until the CMO and DPO review it (reviewed stays false).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select 'research_challenges', 'patient_id', private.retention_class_for('research_challenges'),
       case when private.retention_class_for('research_challenges') = 'operational' then 'delete' else 'review' end,
       private.retention_class_for('research_challenges') <> 'audit',
       'Registered with the default S39d classification when the research objection route was added; awaiting review.'
on conflict (table_name) do nothing;

do $$
declare f text;
begin
  foreach f in array array[
    'public.request_research_export(uuid, text)', 'public.authorise_research_export(uuid)', 'public.research_export_requests_list()',
    'public.research_ledger()', 'public.raise_research_challenge(uuid, text)', 'public.my_research_challenges()',
    'public.research_challenges_list()', 'public.answer_research_challenge(uuid, text)', 'public.run_research_export(uuid)',
    'private.research_recipient_barred(text)', 'private.research_difference_ok(text[], text[], integer)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.research_export_requests', 'SELECT') or has_table_privilege('authenticated', 'public.research_challenges', 'SELECT')
     or has_table_privilege('authenticated', 'public.research_barred_recipient_terms', 'SELECT') then
    raise exception 'the new research tables are read only through their functions';
  end if;
  if (select count(*) from public.research_barred_recipient_terms) < 10 then raise exception 'barred recipient terms were not seeded'; end if;
end $$;
