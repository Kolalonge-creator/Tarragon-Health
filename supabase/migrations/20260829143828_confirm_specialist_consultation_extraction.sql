-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 6/7
-- confirm_specialist_consultation_extraction RPC
--
-- Mirrors public.confirm_ecg_report_extraction (20260814193734) and
-- public.confirm_lab_report_extraction: a clinician's confirmation of a
-- drafted specialist-report extraction, filed in one transaction so every
-- attribution column is derived from the caller's own active clinical_staff
-- row, never client-supplied, and two review tabs can't both file the same
-- draft (SELECT ... FOR UPDATE).
--
-- This is the act that closes spec §70.3/§70.5's loop: filing the extraction
-- both records treatment_plan_received_at/plan_acknowledged_at on the
-- referral (so the existing patient-facing pipeline stepper — unchanged —
-- shows "Treatment plan received" without any UI edit) AND creates one
-- specialist_referral_action_items row per accepted recommendation, which
-- the previous migration's trigger immediately routes onward. One RPC call,
-- both halves of the module's promise.
--
-- DELIBERATELY DOES NOT write to any medication/prescribing table.
-- Medications the specialist mentions are informational
-- (medications_mentioned on the extraction row) — starting or changing a
-- prescription is a distinct clinical act with its own existing flow and
-- its own record-keeping; folding it into this confirm step would let an AI
-- draft indirectly initiate a prescription, which this module explicitly
-- does not do. A recommendation that amounts to "start/adjust a
-- medication" is filed as a 'medication_review' action item instead —
-- routed to the doctor worklist (care_plan_review_prompts), same as any
-- other new-medication signal already routes there, never auto-prescribed.

create or replace function public.confirm_specialist_consultation_extraction(
  p_extraction_id uuid,
  p_diagnosis text,
  p_accepted_recommendations jsonb,
  p_follow_up_interval_days integer default null,
  p_report_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row          public.specialist_consultation_extractions%rowtype;
  v_referral     public.specialist_referrals%rowtype;
  v_staff_id     uuid;
  v_rec          jsonb;
  v_description  text;
  v_action_type  text;
  v_due_at       timestamptz;
  v_created      integer := 0;
  v_indexes      jsonb := '[]'::jsonb;
  v_idx          integer := 0;
begin
  select * into v_row from public.specialist_consultation_extractions where id = p_extraction_id for update;
  if v_row.id is null then
    raise exception 'Extraction not found' using errcode = '42501';
  end if;
  if v_row.status = 'confirmed' then
    raise exception 'This report has already been filed' using errcode = '23505';
  end if;
  if v_row.status = 'failed' then
    raise exception 'This report could not be read, so there is nothing to file' using errcode = '22023';
  end if;

  select * into v_referral from public.specialist_referrals where id = v_row.referral_id for update;
  if v_referral.id is null then
    raise exception 'Referral not found' using errcode = '42501';
  end if;

  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_row.organisation_id
    and cs.active;
  if v_staff_id is null then
    raise exception 'Only an active care-team clinician can file a specialist consultation report'
      using errcode = '42501';
  end if;

  if p_diagnosis is null or length(btrim(p_diagnosis)) = 0 then
    raise exception 'A diagnosis/impression is required to file this report' using errcode = '22023';
  end if;

  -- Each accepted recommendation becomes a real, owned, tracked action item.
  -- Insert (not the RPC) is what triggers private.route_specialist_referral_action_item,
  -- so validation of action_type happens there via the enum cast below.
  for v_rec in select * from jsonb_array_elements(coalesce(p_accepted_recommendations, '[]'::jsonb))
  loop
    v_description := nullif(btrim(v_rec->>'description'), '');
    v_action_type := v_rec->>'action_type';
    v_due_at := nullif(v_rec->>'due_at', '')::timestamptz;

    if v_description is null or v_action_type is null then
      raise exception 'Each accepted recommendation needs a description and an action_type'
        using errcode = '22023';
    end if;

    insert into public.specialist_referral_action_items
      (referral_id, extraction_id, action_type, description, due_at)
    values (
      v_row.referral_id,
      v_row.id,
      v_action_type::public.specialist_referral_action_item_type,
      v_description,
      v_due_at
    );

    v_indexes := v_indexes || to_jsonb(v_idx);
    v_idx := v_idx + 1;
    v_created := v_created + 1;
  end loop;

  update public.specialist_consultation_extractions
     set status = 'confirmed',
         confirmed_by = (select auth.uid()),
         confirmed_at = now(),
         confirmed_recommendation_indexes = v_indexes,
         diagnosis = p_diagnosis,
         follow_up_interval_days = coalesce(p_follow_up_interval_days, follow_up_interval_days),
         report_date = coalesce(p_report_date, report_date)
   where id = p_extraction_id;

  -- File onto the referral itself — reuses the existing pipeline-stage
  -- columns (20260716100000) rather than adding new ones, so
  -- deriveReferralPipelineStages keeps working unchanged.
  update public.specialist_referrals
     set treatment_plan_received_at = coalesce(treatment_plan_received_at, now()),
         treatment_plan_note = format(
           'Diagnosis: %s.%s',
           p_diagnosis,
           case when p_follow_up_interval_days is not null
             then format(' Follow-up recommended in %s days.', p_follow_up_interval_days)
             else '' end
         ),
         plan_acknowledged_at = now(),
         plan_acknowledged_by = (select auth.uid())
   where id = v_row.referral_id;

  return jsonb_build_object(
    'extraction_id', p_extraction_id,
    'referral_id', v_row.referral_id,
    'action_items_created', v_created
  );
end;
$function$;

revoke all on function public.confirm_specialist_consultation_extraction(uuid, text, jsonb, integer, date) from public;
revoke all on function public.confirm_specialist_consultation_extraction(uuid, text, jsonb, integer, date) from anon;
grant execute on function public.confirm_specialist_consultation_extraction(uuid, text, jsonb, integer, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.confirm_specialist_consultation_extraction(uuid,text,jsonb,integer,date)', 'EXECUTE') then
    raise exception 'confirm_specialist_consultation_extraction: anon must not be able to execute this';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_specialist_consultation_extraction(uuid,text,jsonb,integer,date)', 'EXECUTE') then
    raise exception 'confirm_specialist_consultation_extraction: authenticated grant did not take';
  end if;
end $$;
