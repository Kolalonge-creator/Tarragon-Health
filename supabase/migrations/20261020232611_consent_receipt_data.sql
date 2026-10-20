-- Consent receipts as a one-page PDF (RCPT-1): the data door.
-- Design: docs/design/RCPT-1.md. Research: docs/research/RCPT-1.md.
--
-- WHAT. One function, public.consent_receipt_data(scope, ref): the caller's OWN consent facts for one change or for their whole current picture, and
-- one audit row per call. The PDF route calls it and renders; there is no way to get a receipt without the audit row (read and audit are one
-- function). It reads only the two append-only consent histories (consent_matrix_events from S42, patient_consents from S04b-2) and the policy
-- tables that name the wording. No clinical value is read or returned: a data type is named (for example "vitals"), never a reading.
-- Also restates my_consent_matrix_history so each entry carries its id (so a screen can link to that entry's receipt). Additive only.
--
-- WORDING. The event keeps the wording VERSION, not the words, so a single-change receipt says whether the version in force is still the one
-- the person acted on (wording_current); if not, the PDF shows neither today's wording nor today's status as if it were what they saw.
-- The audit row is written when the data is read, before the PDF is drawn: a render failure still leaves a row. That errs on the side of
-- over-recording a disclosure, never under-recording it.
--
-- RULES. Own rows only: the caller is auth.uid(); there is no patient argument, so a guardian, clinician or admin cannot ask for someone else's
-- (a guardian's own receipts are the guardian's own). Only an active patient-role account may call it (the same gate as set_consent_cell). An id
-- that is not the caller's is "not found" (no existence oracle). The audit row holds the scope and the ref id only.
-- Counted first, live 2026-10-20: not needed (no data change, two new objects).

create or replace function public.my_consent_matrix_history(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'data_type', h.data_type, 'purpose', h.purpose, 'action', h.action,
           'source', h.source, 'at', h.created_at) order by h.created_at desc, h.id desc), '[]'::jsonb)
    from (select * from public.consent_matrix_events where patient_id = (select auth.uid())
           order by created_at desc, id desc limit greatest(1, least(coalesce(p_limit, 50), 200))) h
$$;
revoke all on function public.my_consent_matrix_history(integer) from public, anon;
grant execute on function public.my_consent_matrix_history(integer) to authenticated;

create function public.consent_receipt_data(p_scope text, p_ref uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles%rowtype;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  if p_scope is null or p_scope not in ('all', 'matrix_event', 'document_event') then
    raise exception 'consent_receipt_scope_unknown' using errcode = '22023';
  end if;
  if p_scope <> 'all' and p_ref is null then
    raise exception 'consent_receipt_ref_needed' using errcode = '22023';
  end if;

  if p_scope = 'matrix_event' then
    select jsonb_build_object('scope', 'matrix_event', 'person', p.full_name, 'generated_at', now(),
             'change', jsonb_build_object('data_type', e.data_type, 'purpose', e.purpose, 'action', e.action, 'source', e.source,
                'policy_version', e.policy_version, 'text_key', c.text_key, 'wording_status', c.wording_status,
                'required_for_care', c.required_for_care, 'wording_current', (c.policy_version = e.policy_version), 'at', e.created_at))
      into v_out
      from public.consent_matrix_events e
      join public.consent_matrix_cells c on c.data_type = e.data_type and c.purpose = e.purpose
     where e.id = p_ref and e.patient_id = v_uid;
  elsif p_scope = 'document_event' then
    select jsonb_build_object('scope', 'document_event', 'person', p.full_name, 'generated_at', now(),
             'change', jsonb_build_object('consent_type', pc.consent_type, 'action', pc.action, 'version', pc.version, 'title', cv.title, 'body', cv.body,
                'is_optional', cv.is_optional, 'is_draft', cv.is_draft, 'text_sha256', pc.text_sha256,
                'channel', coalesce(pc.channel, 'unknown'), 'consented_by_relation', coalesce(pc.consented_by_relation, 'legacy'), 'at', pc.created_at))
      into v_out
      from public.patient_consents pc
      join public.consent_versions cv on cv.id = pc.consent_version_id
     where pc.id = p_ref and pc.patient_id = v_uid;
  else
    select jsonb_build_object('scope', 'all', 'person', p.full_name, 'generated_at', now(),
             'cells', coalesce((select jsonb_agg(jsonb_build_object('data_type', c.data_type, 'purpose', c.purpose, 'required_for_care', c.required_for_care,
                         'text_key', c.text_key, 'wording_status', c.wording_status, 'policy_version', c.policy_version,
                         'granted', private.consent_in_force(v_uid, c.data_type, c.purpose),
                         'changed_at', (select max(e.created_at) from public.consent_matrix_events e
                                         where e.patient_id = v_uid and e.data_type = c.data_type and e.purpose = c.purpose)) order by c.sort_order)
                       from public.consent_matrix_cells c), '[]'::jsonb),
             'documents', coalesce((select jsonb_agg(jsonb_build_object('consent_type', d.consent_type, 'version', d.version, 'title', d.title,
                         'is_optional', d.is_optional, 'is_draft', d.is_draft, 'at', d.created_at) order by d.created_at desc)
                       from (select distinct on (pc.consent_type) pc.consent_type, pc.action, pc.version, pc.created_at, cv.title, cv.is_optional, cv.is_draft
                               from public.patient_consents pc join public.consent_versions cv on cv.id = pc.consent_version_id
                              where pc.patient_id = v_uid order by pc.consent_type, pc.created_at desc, pc.id desc) d
                      where d.action = 'accepted'), '[]'::jsonb))
      into v_out;
  end if;

  if v_out is null then raise exception 'consent_receipt_not_found' using errcode = 'P0002'; end if;
  perform private.log_audit('consent.receipt_downloaded', 'profile', v_uid, jsonb_build_object('scope', p_scope, 'ref', p_ref));
  return v_out;
end $$;
revoke all on function public.consent_receipt_data(text, uuid) from public, anon;
grant execute on function public.consent_receipt_data(text, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.consent_receipt_data(text, uuid)', 'EXECUTE') then raise exception 'anon can execute consent_receipt_data'; end if;
  if not has_function_privilege('authenticated', 'public.consent_receipt_data(text, uuid)', 'EXECUTE') then raise exception 'authenticated cannot execute consent_receipt_data'; end if;
  if has_function_privilege('anon', 'public.my_consent_matrix_history(integer)', 'EXECUTE') then raise exception 'anon can execute my_consent_matrix_history'; end if;
end $$;
