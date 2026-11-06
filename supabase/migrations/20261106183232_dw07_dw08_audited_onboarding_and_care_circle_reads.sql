-- DW-07 and DW-08 (founder decisions, 2026-11-06; docs/DECISIONS.md): two logged, care-tie-gated reads for the doctor's patient record.
--
-- WHAT THIS ADDS
--   1. public.read_patient_onboarding_answers_audited(patient, reason): the patient's own onboarding answers (goals, conditions ticked
--      at sign-up). DW-07 narrows S41's "never read by staff through the API": staff still cannot read public.onboarding_answers
--      directly (its only policy is the patient's own select, unchanged here); they read it only through this function, which
--      checks the care tie and writes an audit_log row for every call, allowed or refused.
--   2. public.read_patient_care_circle_audited(patient, reason): who the patient's active supporters are, what each may see, and
--      whether sharing is paused. DW-08 goes further than S35's "count only" by founder decision.
--
-- GATE (both): private.can_staff_read_clinical(patient, 'medical_history'), the same gate read_patient_chart_audited uses for
-- allergies and conditions (INV-12 tie, or break-glass for that category, or an active support-view session). A patient calling
-- either raises and writes nothing, as read_patient_chart_audited does. Each call writes one row through private.audit_chart_read
-- with the section name ('onboarding_answers' or 'care_circle') and the result ('success' or 'denied').
--
-- DPO NOTE: the answers are self-reported and never a diagnosis; the record labels them so. Supporter names are already visible to
-- the patient's tied care team elsewhere only through the family-note flow; this makes them visible on the record to the same tied
-- staff. No new column, table or policy; nothing is widened for anon or for staff without a tie.
--
-- Counts before this change: no data change (functions only).

create or replace function public.read_patient_onboarding_answers_audited(p_patient uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['onboarding_answers'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(p_patient, array['onboarding_answers'], p_reason, 'success');
  return jsonb_build_object(
    'status', 'ok',
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('question_code', a.question_code, 'answer', a.answer, 'answered_at', a.answered_at)
                       order by a.question_code)
        from public.onboarding_answers a
       where a.patient_id = p_patient), '[]'::jsonb));
end;
$$;

comment on function public.read_patient_onboarding_answers_audited(uuid, text) is
  'DW-07: the patient''s own onboarding answers for their tied care team; self-reported, never a diagnosis. Gated and audited per call.';

create or replace function public.read_patient_care_circle_audited(p_patient uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['care_circle'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(p_patient, array['care_circle'], p_reason, 'success');
  return jsonb_build_object(
    'status', 'ok',
    'supporters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'supporter_name', s.full_name,
               'relationship', m.relationship,
               'permissions', to_jsonb(m.permissions),
               'contact_role', m.contact_role,
               'since', m.created_at,
               'expires_at', m.expires_at)
             order by m.created_at)
        from public.care_circle_members m
        -- Same rule as every Care Circle gate (private.circle_member_for): a closed supporter account sees nothing, so is not listed.
        join public.profiles s on s.id = m.supporter_id and s.is_active
       where m.patient_id = p_patient
         and m.state = 'active'
         and m.expires_at > now()), '[]'::jsonb),
    'pause', (
      select jsonb_build_object('paused_until', p.paused_until, 'pause_alerts', p.pause_alerts)
        from public.care_circle_pauses p
       where p.patient_id = p_patient
         and p.paused_from <= now()
         and p.paused_until > now()));
end;
$$;

comment on function public.read_patient_care_circle_audited(uuid, text) is
  'DW-08: the patient''s active Care Circle supporters (name, relationship, permissions) and any current pause, for their tied care team. Gated and audited per call.';

-- anon's EXECUTE comes through PUBLIC, so it is revoked there (CLAUDE.md: not "from anon").
revoke all on function public.read_patient_onboarding_answers_audited(uuid, text) from public, anon;
revoke all on function public.read_patient_care_circle_audited(uuid, text) from public, anon;
grant execute on function public.read_patient_onboarding_answers_audited(uuid, text) to authenticated;
grant execute on function public.read_patient_care_circle_audited(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.read_patient_onboarding_answers_audited(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_patient_care_circle_audited(uuid, text)', 'EXECUTE') then
    raise exception 'DW-07/08 self-check: anon can execute an audited read';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'onboarding_answers' and policyname <> 'onboarding_answers_own_select') then
    raise exception 'DW-07 self-check: onboarding_answers gained a policy; staff must read only through the audited function';
  end if;
end;
$$;
