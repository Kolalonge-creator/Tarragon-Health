-- S05b-a (2 of 3): one supersede-with-status rule for corrections to a recorded clinical value.
--
-- RULE. A clinical value that was recorded is never edited and never hard-deleted. A correction creates a NEW row that supersedes the old
-- one, the old row stays exactly as it was and is marked with a status (corrected, amended, entered_in_error, or cancelled when a clinician
-- already acted on it), and the actor and the reason are stored. docs/design/S05b.md has the per-table inventory.
--
-- REUSE, NOT A PARALLEL MECHANISM. What already exists is kept and is the evidence trail:
--   * public.record_corrections (21 tables) keeps recording old and new values of every change; the correction function sets
--     app.change_reason so that row carries the reason, and the existing capture trigger fires on the marking UPDATE.
--   * Tables that already supersede (medications.superseded_at, clinical_encounter_notes.amends_note_id, screening_results.corrects_result_id,
--     lab_result_documents.supersedes_document_id, lab_results.superseded_by) are left as they are; the doc maps their words to the four statuses.
-- This migration closes the gap on the tables where a value could still be changed in place.
--
-- COUNTED FIRST (live, 2026-10-13): vitals_readings 12, patient_conditions 0, patient_allergies 0, lab_analyte_readings 0.
-- Nothing is converted: the new columns are all null for existing rows, which means "never corrected".
--
-- WHAT IS ENFORCED (trigger private.enforce_clinical_value_supersession, one function, four tables):
--   * UPDATE cannot change a value column of the table (the list is passed per table as trigger arguments);
--   * the correction columns can only be written by public.correct_clinical_value (a transaction-local flag it sets), and once a row is
--     marked superseded they never change again;
--   * INSERT cannot set supersedes_id unless it comes from that function (no forged chains);
--   * DELETE is refused, except a cascade from a parent row (account removal, pg_trigger_depth > 1) and the patient's own
--     wearable data erasure, which sets app.allow_clinical_value_delete (see section 4).
-- Superuser maintenance migrations that must rewrite a value can disable the trigger for that statement; nothing else can.

create type public.correction_status as enum ('corrected', 'amended', 'entered_in_error', 'cancelled');

-- 1. The guard -----------------------------------------------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user is then the role running the statement. A client statement runs as authenticated or
-- service_role; public.correct_clinical_value (a definer function owned by postgres) runs as postgres. A custom setting alone could be
-- forged by a client, so the correction flag counts only together with the privileged role.
create function private.enforce_clinical_value_supersession() returns trigger
language plpgsql set search_path = '' as
$$
declare
  v_old jsonb;
  v_new jsonb;
  v_col text;
  v_priv boolean := current_user in ('postgres', 'supabase_admin');
  v_ok boolean := current_user in ('postgres', 'supabase_admin')
                  and coalesce(nullif(current_setting('app.in_correction_function', true), ''), 'off') = 'on';
  v_chain constant text[] := array['supersedes_id', 'superseded_by_id', 'correction_status', 'correction_reason', 'corrected_by', 'corrected_at'];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1
       or (v_priv and coalesce(nullif(current_setting('app.allow_clinical_value_delete', true), ''), 'off') = 'on') then
      return old;
    end if;
    raise exception 'a recorded % value is never deleted: supersede it with public.correct_clinical_value (entered_in_error keeps the original)', tg_table_name
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if (new.supersedes_id is not null or new.superseded_by_id is not null or new.correction_status is not null) and not v_ok then
      raise exception 'correction links can only be created by public.correct_clinical_value' using errcode = '42501';
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  -- value columns are frozen once recorded (the list is the trigger argument)
  if tg_nargs > 0 then
    foreach v_col in array string_to_array(tg_argv[0], ',') loop
      if v_old -> v_col is distinct from v_new -> v_col then
        raise exception 'a recorded % value is never edited (column %): supersede it with public.correct_clinical_value', tg_table_name, v_col
          using errcode = '42501';
      end if;
    end loop;
  end if;

  -- correction links: only the function writes them, and a marked row is final
  foreach v_col in array v_chain loop
    if v_old -> v_col is distinct from v_new -> v_col then
      if not v_ok then
        raise exception 'correction columns can only be set by public.correct_clinical_value' using errcode = '42501';
      end if;
      if old.correction_status is not null then
        raise exception 'this % row was already superseded; a correction is never changed again', tg_table_name using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.enforce_clinical_value_supersession() from public, anon, authenticated;

-- 2. Columns, constraint, trigger on each table ---------------------------------------------------------------------------------------
do $$
declare
  t text;
  frozen text;
  tables text[] := array['vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings'];
begin
  foreach t in array tables loop
    execute format($f$
      alter table public.%1$I
        add column supersedes_id     uuid references public.%1$I (id),
        add column superseded_by_id  uuid references public.%1$I (id) deferrable initially deferred,
        add column correction_status public.correction_status,
        add column correction_reason text,
        add column corrected_by      uuid references public.profiles (id) on delete set null,
        add column corrected_at      timestamptz,
        add constraint %2$I check (
          (correction_status is null and correction_reason is null and corrected_at is null and superseded_by_id is null)
          or (correction_status is not null and corrected_at is not null and length(btrim(correction_reason)) >= 5)
        ),
        add constraint %3$I check (supersedes_id is null or supersedes_id <> id)
    $f$, t, t || '_correction_complete', t || '_no_self_supersede');
    execute format('create index %I on public.%I (supersedes_id) where supersedes_id is not null', t || '_supersedes_idx', t);
    execute format('create index %I on public.%I (superseded_by_id) where superseded_by_id is not null', t || '_superseded_by_idx', t);

    frozen := case t
      when 'vitals_readings' then
        'patient_id,vital_type,systolic,diastolic,glucose_mmol_l,glucose_context,weight_kg,pulse_bpm,temperature_c,spo2_pct,taken_at,waist_cm,ketones_mmol_l,ketone_urine,respiratory_rate_bpm,peak_flow_l_min,value_numeric,value_unit,position,arm,cuff_type'
      when 'patient_allergies' then
        'patient_id,allergen,reaction,severity'
      when 'patient_conditions' then
        'patient_id,condition_name,icd10_code,date_identified'
      when 'lab_analyte_readings' then
        'patient_id,code,value,value_text,unit,taken_at,reference_range_low,reference_range_high,reference_range_text,range_source,range_source_ref'
    end;
    execute format(
      'create trigger a_clinical_value_supersession before insert or update or delete on public.%I '
      'for each row execute function private.enforce_clinical_value_supersession(%L)', t, frozen);
  end loop;
end $$;

-- 2b. patient_allergies was unique on (patient_id, allergen): a replacement for the same allergen would collide with the row it
--     supersedes. Uniqueness now applies to the current (never marked) entries, which is what the old constraint meant.
alter table public.patient_allergies drop constraint patient_allergies_patient_id_allergen_key;
create unique index patient_allergies_current_allergen_key on public.patient_allergies (patient_id, allergen) where correction_status is null;

-- 3. The one correction function -----------------------------------------------------------------------------------------------------
-- p_replacement holds only the value columns being changed; everything else is copied from the original. entered_in_error and cancelled
-- need no replacement. corrected and amended require one.
create function public.correct_clinical_value(
  p_table text, p_id uuid, p_status public.correction_status, p_reason text, p_replacement jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_old jsonb;
  v_patient uuid;
  v_is_staff boolean := false;
  v_allowed text[];
  v_drop text[];
  v_new jsonb;
  v_key text;
  v_cols text;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'sign in to correct a record' using errcode = '42501'; end if;
  if p_table not in ('vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings') then
    raise exception 'unknown table for correction: %', p_table using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'say what was wrong and why (at least 5 characters)' using errcode = '22023';
  end if;
  if p_status in ('corrected', 'amended') and (p_replacement is null or jsonb_typeof(p_replacement) <> 'object' or p_replacement = '{}'::jsonb) then
    raise exception 'a % correction needs the replacement values', p_status using errcode = '22023';
  end if;
  if p_status in ('entered_in_error', 'cancelled') and p_replacement is not null and p_replacement <> '{}'::jsonb then
    raise exception 'a % entry has no replacement: record a new reading separately', p_status using errcode = '22023';
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', p_table) into v_old using p_id;
  if v_old is null then raise exception 'record not found' using errcode = 'P0002'; end if;
  v_patient := (v_old ->> 'patient_id')::uuid;

  -- who may correct: the clinician tied to this patient, or the patient on her own entries (never on a lab result, never to 'cancelled')
  select exists (
    select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active
  ) and private.clinician_has_patient_access(v_patient) into v_is_staff;
  if not v_is_staff then
    if v_patient is distinct from v_uid or p_table = 'lab_analyte_readings' then
      raise exception 'you cannot correct this record' using errcode = '42501';
    end if;
    if p_status = 'cancelled' then
      raise exception 'only a clinician can mark an entry cancelled' using errcode = '42501';
    end if;
    if p_table = 'vitals_readings' and v_old ->> 'validated_by' is not null then
      raise exception 'a clinician has already reviewed this reading: ask your care team to correct it' using errcode = '42501';
    end if;
  end if;

  if v_old ->> 'correction_status' is not null then
    raise exception 'this entry was already superseded' using errcode = '22023';
  end if;
  -- once a clinician acted on a reading, "entered in error" would erase that action's basis: it is cancelled instead
  if p_table = 'vitals_readings' and p_status = 'entered_in_error' and v_old ->> 'validated_by' is not null then
    raise exception 'a clinician already acted on this reading: use status cancelled' using errcode = '22023';
  end if;

  perform set_config('app.in_correction_function', 'on', true);
  perform set_config('app.change_reason', p_reason, true);   -- read by private.capture_record_correction (record_corrections)

  if p_status in ('corrected', 'amended') then
    v_allowed := case p_table
      when 'vitals_readings' then array['vital_type','systolic','diastolic','glucose_mmol_l','glucose_context','weight_kg','pulse_bpm','temperature_c','spo2_pct','taken_at','waist_cm','ketones_mmol_l','ketone_urine','respiratory_rate_bpm','peak_flow_l_min','value_numeric','value_unit','position','arm','cuff_type','note']
      when 'patient_allergies' then array['allergen','reaction','severity']
      when 'patient_conditions' then array['condition_name','icd10_code','date_identified']
      else array['code','value','value_text','unit','taken_at','reference_range_low','reference_range_high','reference_range_text','range_source','range_source_ref']
    end;
    for v_key in select jsonb_object_keys(p_replacement) loop
      if not (v_key = any (v_allowed)) then
        raise exception 'column % cannot be part of a correction', v_key using errcode = '22023';
      end if;
    end loop;

    -- columns that identify, time-stamp or de-duplicate the original are not copied
    v_drop := array['id','created_at','updated_at','search_vector','supersedes_id','superseded_by_id','correction_status','correction_reason','corrected_by','corrected_at'];
    if p_table = 'vitals_readings' then
      v_drop := v_drop || array['client_reading_id','external_reading_id','triage_event_id','validation_status','validation_flags','validated_by','validated_at','received_at','client_recorded_at','logged_by_profile_id'];
    elsif p_table = 'patient_allergies' then
      v_drop := v_drop || array['verification_status','verified_by','verified_at','recorded_by','noted_at'];
    elsif p_table = 'patient_conditions' then
      v_drop := v_drop || array['recorded_by'];
    end if;
    select jsonb_object_agg(k, v) into v_new from jsonb_each(v_old) e(k, v) where not (k = any (v_drop));
    v_new_id := gen_random_uuid();
    v_new := v_new || p_replacement || jsonb_build_object('id', v_new_id, 'supersedes_id', p_id);
    if p_table = 'vitals_readings' then v_new := v_new || jsonb_build_object('logged_by_profile_id', v_uid); end if;
    if p_table in ('patient_allergies', 'patient_conditions') then v_new := v_new || jsonb_build_object('recorded_by', v_uid); end if;

  end if;

  -- mark the original first (its superseded_by_id foreign key is deferred), so a unique rule on current entries never sees both
  execute format(
    'update public.%I set correction_status = $1, correction_reason = $2, corrected_by = $3, corrected_at = now(), superseded_by_id = $4 where id = $5',
    p_table) using p_status, btrim(p_reason), v_uid, v_new_id, p_id;

  if v_new_id is not null then
    select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_new) k;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)', p_table, v_cols) using v_new;
  end if;

  perform set_config('app.in_correction_function', 'off', true);
  perform set_config('app.change_reason', '', true);

  return jsonb_build_object('table', p_table, 'original_id', p_id, 'replacement_id', v_new_id, 'status', p_status);
end;
$$;
revoke all on function public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb) from public;
revoke all on function public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb) from anon;
grant execute on function public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb) to authenticated;

-- 4. The patient's own wearable data erasure stays possible (it is a deliberate patient control, not a clinician deleting a relied-on value).
do $$
declare
  v_def text;
  v_old constant text := E'delete from public.vitals_readings where wearable_connection_id = p_connection_id;\n  get diagnostics v_vitals_deleted = row_count;';
  v_new constant text :=
    E'perform set_config(''app.allow_clinical_value_delete'', ''on'', true);\n  delete from public.vitals_readings where wearable_connection_id = p_connection_id;\n  get diagnostics v_vitals_deleted = row_count;\n  perform set_config(''app.allow_clinical_value_delete'', ''off'', true);';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'delete_wearable_connection_data' and p.pronamespace = 'public'::regnamespace;
  if v_def is null or position(v_old in v_def) = 0 then
    raise exception 'delete_wearable_connection_data: expected statement not found, refusing to guess';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 5. Self-check -----------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings'] loop
    if (select count(*) from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname = 'a_clinical_value_supersession') <> 1 then
      raise exception '% is missing the supersession trigger', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'anon can execute correct_clinical_value';
  end if;
  if not has_function_privilege('authenticated', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'authenticated cannot execute correct_clinical_value';
  end if;
end $$;
