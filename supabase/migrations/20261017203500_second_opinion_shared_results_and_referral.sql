-- Second opinion: the patient chooses which of their released lab results the doctor sees, and the doctor can recommend a
-- specialist referral that the patient accepts (and then downloads as a letter).
--
-- Why this shape
--   * Until now a second opinion carried only free text ("no upload/attachment mechanism in this pass"), so the doctor judged a
--     result from a patient's retelling of it.
--   * The sharing table is closed to every signed-in role (no policy, no grant). A doctor reads only through
--     public.read_second_opinion_audited, which proves an active non-coordinator doctor of the patient's organisation, only while
--     the request is open (or for the doctor who answered it), returns ONLY the results the patient picked for THIS request, and
--     writes an audit_log row (basis second_opinion_share). The patient's explicit choice is the grant; it is not a care-team tie
--     and opens nothing else on the chart.
--   * Only a RELEASED, current (not superseded) result that has structured items can be shared; an unreleased, withheld or
--     disclosure-required result is refused (INV-03), and the check is repeated when the doctor reads.
--   * specialist_referrals stays staff-created only: the doctor's answer creates a DRAFT referral; the patient accepting it moves it
--     to pending as the patient (the existing consent trigger stamps patient_consent_at because the patient asked for it).
--     second_opinion_requests.referral_id is written only by these functions (guard trigger), so a patient cannot point a request
--     at someone else's referral.
-- Live counts before: nothing to convert (new nullable column, new empty table).

alter table public.second_opinion_requests
  add column if not exists referral_id uuid references public.specialist_referrals (id) on delete set null;

create table public.second_opinion_shared_results (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  request_id      uuid not null references public.second_opinion_requests (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  lab_result_id   uuid not null references public.lab_results (id) on delete cascade,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (request_id, lab_result_id)
);
create index second_opinion_shared_results_request_idx on public.second_opinion_shared_results (request_id);
alter table public.second_opinion_shared_results enable row level security;
revoke all on public.second_opinion_shared_results from public, anon, authenticated;

-- referral_id is set only by the functions below.
create function private.guard_second_opinion_referral_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('tarragon.second_opinion_referral_write', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.referral_id is not null)
          or (tg_op = 'UPDATE' and new.referral_id is distinct from old.referral_id)) then
    raise exception 'the referral on a second opinion is set by the care team''s answer only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_second_opinion_referral_link() from public, anon, authenticated;
create trigger second_opinion_requests_guard_referral_link
  before insert or update on public.second_opinion_requests
  for each row execute function private.guard_second_opinion_referral_link();

-- Patient: replace the set of results shared with one of their own open requests.
create function public.share_results_with_second_opinion(p_request uuid, p_lab_results uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.second_opinion_requests%rowtype;
  v_ids uuid[];
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into r from public.second_opinion_requests where id = p_request and patient_id = v_uid;
  if not found then raise exception 'not your request' using errcode = '42501'; end if;
  if r.status not in ('submitted', 'in_review') then
    raise exception 'this request is closed to changes' using errcode = 'P0001';
  end if;
  v_ids := coalesce((select array_agg(distinct x) from unnest(coalesce(p_lab_results, '{}'::uuid[])) x), '{}'::uuid[]);
  if cardinality(v_ids) > 10 then raise exception 'share at most 10 results' using errcode = '22023'; end if;
  if exists (
    select 1 from unnest(v_ids) x
     where not exists (
       select 1 from public.lab_results lr
        where lr.id = x and lr.patient_id = v_uid and lr.release_state = 'released' and lr.superseded_by is null
          and exists (select 1 from public.lab_result_items i where i.lab_result_id = lr.id))
  ) then
    raise exception 'one of those results cannot be shared' using errcode = '42501';
  end if;
  delete from public.second_opinion_shared_results where request_id = p_request and lab_result_id <> all (v_ids);
  insert into public.second_opinion_shared_results (organisation_id, request_id, patient_id, lab_result_id, is_test)
  select r.organisation_id, p_request, v_uid, x, (select pr.is_test from public.profiles pr where pr.id = v_uid)
    from unnest(v_ids) x
  on conflict (request_id, lab_result_id) do nothing;
  return cardinality(v_ids);
end;
$$;

-- Doctor: read one request together with the results the patient shared for it. Audited.
create function public.read_second_opinion_audited(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.second_opinion_requests%rowtype;
  v_staff uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into r from public.second_opinion_requests where id = p_request;
  if not found then raise exception 'request not found' using errcode = '42501'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = v_uid and cs.organisation_id = r.organisation_id and cs.active
     and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator';
  if v_staff is null or (r.status not in ('submitted', 'in_review') and r.answered_by is distinct from v_staff) then
    raise exception 'request not found' using errcode = '42501';
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  values (r.organisation_id, v_uid, 'staff.chart_read', 'second_opinion_request', r.id,
          jsonb_build_object('reason', 'second opinion review', 'sections', jsonb_build_array('shared_lab_results'), 'basis', 'second_opinion_share'),
          'second opinion review', 'success', r.patient_id, private.request_ip());
  return jsonb_build_object(
    'id', r.id, 'patient_id', r.patient_id, 'status', r.status, 'sla_due_at', r.sla_due_at, 'created_at', r.created_at,
    'existing_diagnosis_or_result', r.existing_diagnosis_or_result, 'source_description', r.source_description,
    'specific_question', r.specific_question, 'answer', r.answer, 'referral_id', r.referral_id,
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', lr.id, 'panel_code', lr.panel_code, 'received_at', lr.received_at,
               'items', coalesce((select jsonb_agg(jsonb_build_object(
                          'analyte_code', i.analyte_code, 'value_numeric', i.value_numeric, 'value_text', i.value_text,
                          'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag) order by i.analyte_code)
                        from public.lab_result_items i where i.lab_result_id = lr.id), '[]'::jsonb))
             order by lr.received_at desc)
        from public.second_opinion_shared_results s
        join public.lab_results lr on lr.id = s.lab_result_id
       where s.request_id = r.id and lr.release_state = 'released' and lr.superseded_by is null), '[]'::jsonb));
end;
$$;

-- Doctor: answer, optionally recommending a specialist referral (created as a draft for the patient to accept).
create function public.answer_second_opinion_request(
  p_request uuid, p_answer text, p_specialist_type public.specialist_type default null,
  p_urgency public.referral_urgency default null, p_reason text default null, p_requested_service text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.second_opinion_requests%rowtype;
  v_ref uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_answer is null or length(btrim(p_answer)) < 10 or length(btrim(p_answer)) > 4000 then
    raise exception 'The answer needs a little more substance' using errcode = '22023';
  end if;
  select * into r from public.second_opinion_requests where id = p_request for update;
  if not found or r.status not in ('submitted', 'in_review') then
    raise exception 'request not found or already answered' using errcode = 'P0001';
  end if;
  if p_specialist_type is not null then
    if p_reason is null or length(btrim(p_reason)) < 10 then
      raise exception 'A referral needs a reason' using errcode = '22023';
    end if;
    -- private.enforce_specialist_referral_create requires a clinical-tier member and stamps referred_by.
    insert into public.specialist_referrals
      (organisation_id, patient_id, specialist_type, referral_source, urgency, referral_reason, requested_service, appropriateness_flags, status)
    values (r.organisation_id, r.patient_id, p_specialist_type, 'clinician_initiated', coalesce(p_urgency, 'routine'),
            btrim(p_reason), nullif(btrim(p_requested_service), ''), '[]'::jsonb, 'draft')
    returning id into v_ref;
  end if;
  perform set_config('tarragon.second_opinion_referral_write', 'on', true);
  -- private.stamp_second_opinion_answer derives answered_by from the caller's own active doctor row and refuses anyone else.
  update public.second_opinion_requests set status = 'answered', answer = btrim(p_answer), referral_id = v_ref where id = p_request;
  perform set_config('tarragon.second_opinion_referral_write', 'off', true);
  return v_ref;
end;
$$;

-- Patient: accept the recommended referral. The existing consent trigger stamps patient_consent_at because the patient asked for it.
create function public.accept_second_opinion_referral(p_request uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.second_opinion_requests%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into r from public.second_opinion_requests where id = p_request and patient_id = v_uid;
  if not found or r.referral_id is null then raise exception 'no referral to accept' using errcode = '42501'; end if;
  update public.specialist_referrals set status = 'pending' where id = r.referral_id and patient_id = v_uid and status = 'draft';
  return r.referral_id;
end;
$$;

revoke all on function public.share_results_with_second_opinion(uuid, uuid[]) from public, anon;
revoke all on function public.read_second_opinion_audited(uuid) from public, anon;
revoke all on function public.answer_second_opinion_request(uuid, text, public.specialist_type, public.referral_urgency, text, text) from public, anon;
revoke all on function public.accept_second_opinion_referral(uuid) from public, anon;
grant execute on function public.share_results_with_second_opinion(uuid, uuid[]) to authenticated;
grant execute on function public.read_second_opinion_audited(uuid) to authenticated;
grant execute on function public.answer_second_opinion_request(uuid, text, public.specialist_type, public.referral_urgency, text, text) to authenticated;
grant execute on function public.accept_second_opinion_referral(uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.share_results_with_second_opinion(uuid,uuid[])', 'public.read_second_opinion_audited(uuid)',
      'public.answer_second_opinion_request(uuid,text,public.specialist_type,public.referral_urgency,text,text)',
      'public.accept_second_opinion_referral(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'assertion: anon can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.second_opinion_shared_results', 'SELECT')
     or has_table_privilege('anon', 'public.second_opinion_shared_results', 'SELECT') then
    raise exception 'assertion: second_opinion_shared_results must be closed';
  end if;
end $$;
