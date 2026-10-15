-- Follow-up OQ-356 and OQ-354 (CMO and founder answers, 2026-10-15).
--
-- OQ-356: the engine's adherence trigger field is `percentWindow` (it was `percent7d`). The window is NOT hard-coded to 7 days: it is
-- medicine_config.adherence_window_days (7 today), read by private.weekly_adherence. public.triage_context_for_coverage now sends `percentWindow`.
-- The engine still accepts the old `percent7d` as input and still exposes the old rule field `adherence.percent7d`, because the stored, approved
-- rule set (bp_care_triage v3, rule BP-A4) names it and an approved row is never edited. DEPLOY ORDER: the process-events edge function from this
-- branch first (it accepts both names), then this migration.
--
-- OQ-354: for a Member with a blood pressure interest the BP-A4 task REPLACES the older clinical-rule alert `medication_adherence_low` raised by
-- `medicine-adherence-signals-daily`; the alert stays for everyone else (a Free patient, a Member with no blood pressure interest). To avoid a gap the
-- replacement happens only while it is really covered: the daily coverage sweep is switched on (triage_coverage_config.enabled), a bp_care_triage rule
-- set with rule BP-A4 is APPROVED (a draft only grades in shadow and makes no task), and the patient is one of the sweep's own candidates. If any of
-- those stops being true the alert simply comes back the next day. Nothing is deleted; the alert row for a past week is not touched.
--
-- Both functions below are rewritten from their LIVE definitions (pg_get_functiondef) with one asserted textual replace each.

create or replace function private.bp_a4_covers_adherence(p_patient uuid, p_now timestamptz default now())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select (c.rules ->> 'enabled')::boolean from public.triage_coverage_config c where c.is_active), false)
     and exists (select 1 from public.triage_rule_sets rs
                  where rs.code = 'bp_care_triage' and rs.status = 'approved'
                    and exists (select 1 from jsonb_array_elements(rs.rules -> 'rules') r where r ->> 'id' = 'BP-A4'))
     and exists (select 1 from private.triage_coverage_candidates(p_now, p_patient));
$$;
revoke all on function private.bp_a4_covers_adherence(uuid, timestamptz) from public, anon, authenticated;
comment on function private.bp_a4_covers_adherence(uuid, timestamptz) is 'OQ-354: true when the BP-A4 task (not the older medication_adherence_low alert) is the live signal for this patient: sweep on, BP-A4 in an APPROVED bp_care_triage, patient a Member with a BP interest.';

do $mig$
declare
  d text;
  old1 constant text := $q$if (a ->> 'below_threshold')::boolean then$q$;
  new1 constant text := $q$if (a ->> 'below_threshold')::boolean and not private.bp_a4_covers_adherence(r.patient_id, p_now) then$q$;
  old2 constant text := $q$'percent7d'$q$;
begin
  d := pg_get_functiondef('private.emit_adherence_signals(timestamp with time zone)'::regprocedure);
  if (length(d) - length(replace(d, old1, ''))) / length(old1) <> 1 then
    raise exception 'OQ-354: emit_adherence_signals live body no longer has the expected condition; review before changing it';
  end if;
  execute replace(d, old1, new1);

  d := pg_get_functiondef('public.triage_context_for_coverage(uuid, text, date)'::regprocedure);
  if (length(d) - length(replace(d, old2, ''))) / length(old2) <> 1 then
    raise exception 'OQ-356: triage_context_for_coverage live body no longer has the expected field; review before changing it';
  end if;
  execute replace(d, old2, $q$'percentWindow'$q$);
end $mig$;

do $$
begin
  if pg_get_functiondef('private.emit_adherence_signals(timestamp with time zone)'::regprocedure) not like '%bp_a4_covers_adherence%' then
    raise exception 'OQ-354 self-check: the alert does not consult the BP-A4 cover';
  end if;
  if pg_get_functiondef('public.triage_context_for_coverage(uuid, text, date)'::regprocedure) like '%percent7d%'
     or pg_get_functiondef('public.triage_context_for_coverage(uuid, text, date)'::regprocedure) not like '%percentWindow%' then
    raise exception 'OQ-356 self-check: the coverage context does not send percentWindow';
  end if;
  if has_function_privilege('anon', 'private.bp_a4_covers_adherence(uuid, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.triage_context_for_coverage(uuid, text, date)', 'EXECUTE') then
    raise exception 'OQ-354/356 self-check: a function became callable by a client';
  end if;
end $$;
