-- ---------------------------------------------------------------------------
-- Fix: deleting a public.profiles row (or anything that cascades from one)
-- fails with a foreign-key violation on public.record_corrections.
--
-- public.record_corrections (20260827203620) is an append-only evidence
-- ledger: private.capture_record_correction() (AFTER UPDATE OR DELETE on 20
-- tables) inserts one row per change, and record_corrections_no_update /
-- record_corrections_no_delete (both private.reject_mutation()) hard-block
-- any UPDATE or DELETE on that ledger, unconditionally, for every role.
--
-- record_corrections.patient_id / .corrected_by / .organisation_id were
-- declared as ordinary foreign keys to profiles(id)/profiles(id)/
-- organisations(id), each "on delete set null". That combination is
-- self-contradicting and breaks in three distinct, real ways:
--
-- 1. Deleting a public.profiles row directly. AFTER DELETE fires
--    capture_record_correction_trg on profiles itself, which inserts a new
--    record_corrections row. For a patient-role profile with no
--    patient_id column of its own, the function falls back to
--    v_row->>'id' -- the very row that was just deleted. By the time an
--    AFTER trigger runs, that row is already gone from the table, so the
--    INSERT immediately violates record_corrections_patient_id_fkey.
--    (This is the exact repro reported live against koiplnmbgnqnbywhpjlf
--    on 2026-09-02: inserting into auth.users then deleting the resulting
--    public.profiles row raises 23503.)
--
-- 2. Deleting a profiles row that cascades. patient_id on every one of
--    vitals_readings / medications / medication_logs / medication_reviews
--    / screening_results / lab_result_documents / lab_analyte_readings /
--    escalations / care_plans / emergency_events / patient_risk_scores /
--    care_messages / care_message_threads / wearable_readings /
--    patient_hospital_admissions / symptoms is "references profiles(id)
--    on delete cascade". Deleting a patient's profile cascades into every
--    one of those tables in the same statement; each cascaded DELETE also
--    fires capture_record_correction_trg, and each of those inserts again
--    references the now-already-deleted profile as patient_id -- same
--    23503, just triggered indirectly and far more likely to actually
--    happen in practice (almost every real patient has at least one row
--    in one of these tables). corrected_by hits the identical failure
--    when the acting user (auth.uid()) is the same profile being deleted
--    -- i.e. any patient-initiated self-service account deletion.
--
-- 3. Deleting ANY profiles/organisations row that record_corrections
--    already has history for (patient_id or corrected_by pointing at a
--    profile, or organisation_id pointing at an org) -- which is the
--    common case once the platform has run for any length of time.
--    Postgres implements "on delete set null" as an UPDATE issued against
--    the referencing table (record_corrections), and that UPDATE is not
--    exempt from ordinary trigger machinery: it fires
--    record_corrections_no_update same as any other UPDATE, which
--    unconditionally rejects it. So even the FK's own cleanup action
--    can't complete -- the delete fails with "record_corrections is
--    append-only: UPDATE is not permitted" instead of the 23503 above,
--    but the practical effect (the delete fails) is identical.
--
-- Net effect: deleting almost any profiles row fails today, by one of the
-- three paths above. This is exactly the shape of thing an NDPC/GDPR-style
-- data-deletion-request flow (see public.data_deletion_requests,
-- 2026-08-29) or an admin hard-delete tool would hit immediately.
--
-- Fix: record_corrections only has an INSERT grant via this one
-- SECURITY DEFINER trigger function (no direct authenticated INSERT grant
-- -- see 20260827235832), so a hard existence-enforcing FK buys little
-- protection here, and it is fundamentally incompatible with being both
-- (a) an append-only ledger and (b) a durable record of entities that are
-- allowed to be deleted. Drop the three FKs; keep the columns, indexes,
-- and RLS predicate exactly as they are. A correction row now keeps
-- referencing whatever patient/actor/org it captured at the time even
-- after that row is deleted -- which is what the append-only/durable-
-- evidence design already intended (see the column comment on
-- new_values), the "on delete set null" behaviour just never actually
-- worked. With the FKs gone there is no more RI action to trigger either,
-- so record_corrections_no_update/_no_delete need no change: they will
-- now only ever see real update/delete attempts, which they should keep
-- rejecting outright.
-- ---------------------------------------------------------------------------

do $$
declare
  v_col     text;
  v_conname text;
begin
  foreach v_col in array array['patient_id', 'corrected_by', 'organisation_id'] loop
    select con.conname into v_conname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.conrelid = 'public.record_corrections'::regclass
        and con.contype = 'f'
        and array_length(con.conkey, 1) = 1
        and att.attname = v_col;

    if v_conname is null then
      raise exception
        'expected a single-column foreign key on public.record_corrections.% -- none found (already dropped, or renamed?)',
        v_col;
    end if;

    execute format('alter table public.record_corrections drop constraint %I', v_conname);
  end loop;
end $$;

comment on column public.record_corrections.patient_id is
  'The patient the correction concerns, captured at write time. Deliberately NOT a foreign key (see 20260902183059) -- this ledger is append-only and must keep referencing a patient even after that patient''s profile is deleted.';
comment on column public.record_corrections.corrected_by is
  'The acting user, captured at write time. Deliberately NOT a foreign key (see 20260902183059), same reasoning as patient_id -- a self-service account deletion must not be blocked by its own correction record.';
comment on column public.record_corrections.organisation_id is
  'The organisation the row belonged to, captured at write time. Deliberately NOT a foreign key (see 20260902183059), same reasoning as patient_id.';

-- ---------------------------------------------------------------------------
-- Verification: reproduce the original failure end to end (a profile with a
-- cascaded child row, deleted by itself as the acting user -- exercises all
-- three manifestations above at once) and confirm it now succeeds, then
-- deliberately unwind everything via a sentinel exception so this smoke
-- test leaves no synthetic data behind in a table that can never be
-- cleaned up by a normal DELETE.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid := gen_random_uuid();
  v_org     uuid;
  v_deleted boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'FAIL: no row in public.organisations to run the smoke test against';
  end if;

  begin
    insert into auth.users
      (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (
      v_patient,
      'migration-20260902183059-smoke-' || v_patient || '@example.invalid',
      'x', now(), '{}'::jsonb, '{}'::jsonb
    );

    update public.profiles set organisation_id = v_org where id = v_patient;

    insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm)
    values (v_org, v_patient, 'pulse', 72);

    -- acting as the patient themself, matching the self-service-deletion
    -- corrected_by self-reference case (manifestation 2 above)
    perform set_config('app.audit_actor_id', v_patient::text, true);

    delete from public.profiles where id = v_patient;
    v_deleted := true;

    raise exception using errcode = 'P0001', message = '__migration_20260902183059_smoke_rollback__';
  exception
    when others then
      if sqlerrm <> '__migration_20260902183059_smoke_rollback__' then
        raise exception 'FAIL: deleting a profiles row with a cascaded child row still fails after dropping the FKs: %', sqlerrm;
      end if;
  end;

  if not v_deleted then
    raise exception 'FAIL: smoke test did not reach the profiles delete before the deliberate rollback';
  end if;

  raise notice 'PASS: record_corrections_drop_subject_fks -- profiles delete (direct + cascaded child + self-as-actor) no longer raises, smoke-test rows rolled back';
end $$;
