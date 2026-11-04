-- D5 (founder decisions 2026-11-04): pregnancy tests and STI tests are sensitive across the platform, as an ACCESS rule only.
--
-- What the founder decided, in chat, 2026-11-04:
--   1. Scope: "Access only". Pregnancy and STI tests are hidden from caregivers, family and other people's views. The patient's own
--      results, messages and the doctor-disclosure rules are NOT changed: screen_types.sensitive, lab_panel_versions analyte flags,
--      sensitive_result_codes / patterns, ai_excluded_analyte_tokens, private.is_sensitive_analyte_code and result_release_policies are
--      deliberately left alone (each of those also changes what the patient herself is told, which is a CMO result-release decision).
--   2. Emergency access: UNCHANGED. Break-glass emergency access is held only by an active clinician from another organisation (logged,
--      8 hours, reason required), and emergency treatment can depend on pregnancy or infection status. The founder first answered "hide
--      even in emergencies" to a question that wrongly called it a caregiver's access; asked again with the correct description, the
--      founder chose "clinicians see them" (OQ-S98-7 stands). Every has_emergency_access branch below is kept exactly as it was.
--   3. Emergency card: "Hide STIs from the card". An STI condition is treated like a pregnancy one: kept in the record, not printed on the
--      emergency card or in an adolescent's export.
--
-- How:
--   * private.screen_code_access_sensitive(code): the existing screen_types.sensitive flag (HIV, hepatitis, syphilis, chlamydia and
--     gonorrhoea, cervical, breast, prostate, bowel and the rest) OR a pregnancy-related screen ('antenatal_booking', 'pcos_panel'). Used
--     ONLY by access gates. Bundle and order sensitivity (and through them the seven caregiver policies of 20261030122751) now use it.
--   * private.analyte_access_sensitive(code): the existing analyte rules OR pregnancy hormone. Used ONLY to filter caregiver and emergency
--     reads of lab_analyte_readings.
--   * Two caregiver gaps closed: screening_schedules had no sensitivity filter at all, and screening_results rows with no lab order were
--     not filtered by screen type.
--
-- Unchanged: the patient's own access, staff access (category-scoped), emergency clinician access, the support view (audited staff), and
-- Care Circle (already stricter).
-- Policies are recreated from their LIVE definitions (pg_policies, 2026-11-04); changed parts are marked "D5".

-- ---------------------------------------------------------------------------
-- 1. Access-only sensitivity helpers
-- ---------------------------------------------------------------------------
create function private.screen_code_access_sensitive(p_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_code is not null and (
    lower(p_code) = any (array['antenatal_booking', 'pcos_panel'])
    or exists (select 1 from public.screen_types st where st.sensitive and lower(st.code) = lower(p_code)))
$$;
comment on function private.screen_code_access_sensitive(text) is
  'D5 (2026-11-04): a screen type other people (caregivers, emergency access) must not see. The catalogue''s sensitive flag plus '
  'pregnancy-related screens. ACCESS ONLY: never use it for result release, disclosure, messaging or AI explanation.';

create function private.analyte_access_sensitive(p_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_code is null
      or private.lab_analyte_is_sensitive(p_code)
      or private.is_sensitive_analyte_code(p_code)
      or lower(p_code) ~ '(^|_)(b_?|beta_?)?hcg($|_)|pregnan|^upt$'
$$;
comment on function private.analyte_access_sensitive(text) is
  'D5 (2026-11-04): an analyte value other people must not see (the existing sensitive-analyte rules plus pregnancy hormone). ACCESS ONLY.';

-- bundle sensitivity is an access gate only (its readers: lab_order_is_sensitive, the caregiver policies, S98b masking)
CREATE OR REPLACE FUNCTION private.lab_bundle_is_sensitive(p_bundle uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.panel_bundles b
      cross join lateral unnest(b.test_codes) c(code)
     where b.id = p_bundle and private.screen_code_access_sensitive(c.code));                                        -- D5
$function$;

-- an order is sensitive if its bundle is, OR (D5) if it was raised for a sensitive screening on the patient's plan
CREATE OR REPLACE FUNCTION private.lab_order_is_sensitive(p_order uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.lab_orders o
      left join public.screening_schedules ss on ss.id = o.screening_schedule_id
      left join public.screen_types st on st.id = ss.screen_type_id
     where o.id = p_order
       and (private.lab_bundle_is_sensitive(o.panel_bundle_id) or private.screen_code_access_sensitive(st.code)));  -- D5
$function$;

create function private.screen_type_id_access_sensitive(p_screen_type uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.screen_code_access_sensitive((select code from public.screen_types where id = p_screen_type)) $$;

-- ---------------------------------------------------------------------------
-- 2. Policies (recreated from live; the patient's own branch and staff branches unchanged)
-- ---------------------------------------------------------------------------
drop policy lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders for select to authenticated using (
  (patient_id = (select auth.uid()))
  or private.is_org_staff(organisation_id)
  or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
  or ((private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
       or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))
      and not private.lab_bundle_is_sensitive(panel_bundle_id) and not private.lab_order_is_sensitive(id)));                          -- D5

drop policy screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results for select to authenticated using (
  private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
  or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
  or ((not private.patient_result_blocked(screen_type_code, result_status))
      and ((patient_id = (select auth.uid()))
           or ((private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
                or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))
               and not private.lab_order_is_sensitive(lab_order_id)
               and not private.screen_code_access_sensitive(screen_type_code)))));                                                    -- D5

drop policy screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules for select to authenticated using (
  (patient_id = (select auth.uid()))
  or private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
  or (private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)                                               -- D5
      and not private.screen_type_id_access_sensitive(screen_type_id))
  or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
  or private.can_support_view(patient_id));

drop policy patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline for select to authenticated using (
  (patient_id = (select auth.uid()))
  or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category)
  or (private.can_read_clinical(patient_id, event_category) and not private.timeline_source_is_sensitive_order(source_table, source_id))
  or private.has_emergency_access(patient_id, event_category));

drop policy lab_analyte_readings_select on public.lab_analyte_readings;
create policy lab_analyte_readings_select on public.lab_analyte_readings for select to authenticated using (
  (patient_id = (select auth.uid()))
  or private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
  or ((private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)                                              -- D5
       or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))
      and not private.analyte_access_sensitive(code))
  or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category));

-- ---------------------------------------------------------------------------
-- 3. Caregiver read of screening requests: the same access rule
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_screening_requests(p_patient uuid DEFAULT NULL::uuid)
 RETURNS TABLE(schedule_id uuid, lab_order_id uuid, order_status text, requested_at timestamp with time zone, upload_count integer, last_uploaded_at timestamp with time zone, doctor_reviewed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_patient uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_patient := coalesce(p_patient, v_uid);
  if v_patient <> v_uid and not private.can_read_clinical(v_patient, 'view_results'::public.caregiver_permission) then
    raise exception 'not allowed to see this patient' using errcode = '42501';
  end if;
  return query
  select o.screening_schedule_id, o.id, o.status::text, o.created_at,
         coalesce(d.n, 0)::integer, d.last_at, coalesce(d.reviewed, false)
    from public.lab_orders o
    join public.screening_schedules ss on ss.id = o.screening_schedule_id
    join public.screen_types st on st.id = ss.screen_type_id
    left join lateral (
      select count(*) as n, max(x.created_at) as last_at, bool_or(x.reviewed_at is not null) as reviewed
        from public.lab_result_documents x where x.lab_order_id = o.id and x.superseded_by_document_id is null) d on true
   where o.patient_id = v_patient and o.status <> 'cancelled'
     -- someone acting for the patient (a caregiver with view_results) never learns that a sensitive screening has a request
     and (v_patient = v_uid or not private.screen_code_access_sensitive(st.code))                                                       -- D5
   order by o.created_at desc;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Emergency card: STI conditions are kept off the card, like pregnancy (founder decision 2026-11-04)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.emergency_card_sensitive_condition(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_text ~* '(pregnan|antenatal|postnatal|fertil|contracepti|menstru|menopaus|reproduct|obstetric|gynae|gynec|syphil|chlamyd|gonorrh|treponem|sexually transmitted)' then 'reproductive'   -- D5
    when p_text ~* '(mental|depress|anxiet|psych|bipolar|schizo|suicid|self.?harm|ptsd|trauma|panic|mood)' then 'mental_health'
    else null end
$function$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not private.screen_code_access_sensitive('antenatal_booking') or not private.screen_code_access_sensitive('pcos_panel')
     or not private.screen_code_access_sensitive('syphilis') or not private.screen_code_access_sensitive('hiv')
     or private.screen_code_access_sensitive('hba1c') then
    raise exception 'D5 self-check: screen access sensitivity is wrong';
  end if;
  if not private.analyte_access_sensitive('beta_hcg') or not private.analyte_access_sensitive('hcg') or private.analyte_access_sensitive('hba1c')
     or private.analyte_access_sensitive('creatinine') then
    raise exception 'D5 self-check: analyte access sensitivity is wrong';
  end if;
  if private.emergency_card_sensitive_condition('Syphilis') is distinct from 'reproductive'
     or private.emergency_card_sensitive_condition('Hypertension') is not null then
    raise exception 'D5 self-check: the emergency card rule is wrong';
  end if;
  -- the release machinery is untouched: the catalogue flag on the pregnancy screens is still false
  if exists (select 1 from public.screen_types where code in ('antenatal_booking', 'pcos_panel') and sensitive) then
    raise exception 'D5 self-check: screen_types.sensitive must not be changed by an access-only rule';
  end if;
end $$;
