-- ===========================================================================
-- The emergency synchronous-contact rule does not apply to a test account's escalation.
--
-- WHAT WAS WRONG
--   private.enforce_emergency_escalation_synchronous_contact() refuses to resolve an EMERGENCY escalation unless a started or
--   completed video consultation exists for the patient (I5, 2026-07-30). Right for a real person; impossible for a test
--   account, which cannot take a call. The is_test patient "First Patient" has had an unclaimed emergency escalation on the
--   Chief Medical Officer's dashboard since 2026-09-16 (1,134 hours overdue on 2026-11-02) with no way to close it except
--   purging the whole account.
--
-- FIX
--   The rule is skipped when the escalation's patient profile is flagged is_test (INV-13: test people are a separate world).
--   Everything else is unchanged; a real patient's emergency escalation still needs the contact.
--
-- Body redefined from the LIVE definition (pg_get_functiondef, 2026-11-02).
-- ===========================================================================

create or replace function private.enforce_emergency_escalation_synchronous_contact()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_level public.alert_level;
  v_has_contact boolean;
begin
  -- Only gate the transition INTO 'resolved'; touching an already-resolved
  -- row for an unrelated reason (e.g. a later note edit) doesn't re-check.
  if new.status is distinct from 'resolved' or old.status = 'resolved' then
    return new;
  end if;

  -- A test account cannot take a call: its escalation closes on a note (INV-13).
  if coalesce((select p.is_test from public.profiles p where p.id = new.patient_id), false) then
    return new;
  end if;

  select level into v_level
  from public.clinician_alerts
  where id = new.clinician_alert_id;

  if v_level is distinct from 'emergency' then
    return new;
  end if;

  select exists (
    select 1
    from public.video_consultations vc
    where vc.status in ('started', 'completed')
      and (
        vc.escalation_id = new.id
        or (
          vc.patient_id = new.patient_id
          and vc.started_at is not null
          and vc.started_at between new.created_at and now()
        )
      )
  ) into v_has_contact;

  if not v_has_contact then
    raise exception 'An emergency escalation cannot be resolved with only a note -- complete a synchronous voice or video contact with the patient first (start a virtual review)' using errcode = '23514';
  end if;

  return new;
end;
$function$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'enforce_emergency_escalation_synchronous_contact') !~ 'is_test' then
    raise exception 'FAIL: the synchronous-contact rule does not read is_test';
  end if;
end $$;
