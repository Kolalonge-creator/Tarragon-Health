-- Patient Communication Architecture (77.3/77.4) — conversation classification.
--
-- 77.4: "Every conversation should have a category." Today care_message_
-- threads has only a free-text `subject` — nothing structured a worklist can
-- filter or triage on. This adds a category to the THREAD (not each
-- message — a conversation stays about one topic; a patient who wants to
-- ask about something else starts a new thread, matching the existing
-- one-subject-per-thread UX in messages-flow.tsx).
--
-- 77.3 (a central platform routing to Clinical/Care coordination/Pharmacy/
-- Laboratory/Support sub-channels) is NOT attempted here — care_messages,
-- support_messages and notifications remain three separate, independently
-- RLS'd systems (see the gap analysis this closes). Unifying them into one
-- routed platform would be a much larger architectural change than "add a
-- category field" and was not asked for. This migration only adds the
-- classification 77.4 explicitly calls for, scoped to the one system that
-- is actually the secure two-way clinical channel (care_messages).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'care_message_category') then
    create type public.care_message_category as enum (
      'clinical', 'appointment', 'medication', 'laboratory', 'pharmacy', 'billing', 'technical', 'general'
    );
  end if;
end $$;

alter table public.care_message_threads
  add column if not exists category public.care_message_category not null default 'general';

comment on column public.care_message_threads.category is
  '77.4 conversation classification. Patient-chosen at compose time (defaults to general); staff opening a thread on a patient''s behalf may also set it. Never inferred from message content — see the gap analysis'' explicit note that automated clinical-urgency routing from message text is a separate, deliberately-not-built concern (77.5), now closed instead by the concurrent Health Communication Engine''s care_messages_safety_screen (20260830002503, deterministic keyword screen, unrelated to this column).';

create index if not exists care_message_threads_category_idx
  on public.care_message_threads (organisation_id, category, status);

-- start_care_thread gains an optional p_category — byte-identical to the
-- live 20260731181318 definition apart from the new parameter and column.
create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null,
  p_category public.care_message_category default 'general'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null then
    -- Staff opening a thread for a patient, or a consented sponsor opening one
    -- for the person they support.
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    if v_org is null
       or not (private.is_org_staff(v_org) or private.can_read_clinical(p_patient_id)) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    -- Patient opening their own thread.
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id, category)
  values (v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id, p_category)
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$$;

revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category) to authenticated;

-- The old 5-arg overload is superseded — drop it so PostgREST resolves the
-- RPC call unambiguously (two overloads differing only in a trailing
-- optional param is a documented PostgREST 300 "Could not choose the best
-- candidate function" footgun).
drop function if exists public.start_care_thread(text, text, uuid, uuid, uuid);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_message_threads' and column_name = 'category'
  ) then
    raise exception 'FAIL: care_message_threads.category was not added';
  end if;
  if exists (
    select 1 from pg_proc where proname = 'start_care_thread'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) = 'text, text, uuid, uuid, uuid'
  ) then
    raise exception 'FAIL: old 5-arg start_care_thread overload still exists';
  end if;
  if has_function_privilege('anon', 'public.start_care_thread(text,text,uuid,uuid,uuid,public.care_message_category)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute start_care_thread';
  end if;
  raise notice 'PASS: care_message_category added, start_care_thread accepts p_category, old overload removed, anon denied';
end $$;
