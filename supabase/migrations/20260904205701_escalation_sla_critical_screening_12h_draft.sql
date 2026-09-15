-- Tarragon Health — draft v6 of the escalation SLA table: critical screening
-- result moves from 120 minutes to 12 hours.
--
-- FOUNDER DECISION (2026-09-04): critical screening results get a 12-hour
-- contact SLA, abnormal non-critical results stay at 24 hours.
--
-- This LOOSENS the critical pathway from 2 hours to 12. That pathway is the
-- Category 2 -> 1 upgrade CLAUDE.md calls the platform's highest-priority
-- business event, so the change is recorded here explicitly rather than
-- being quietly edited: a doctor now has up to 12 hours to make first
-- contact after a critical screening result, where previously the target
-- was 2 hours. The abnormal non-critical entry is untouched -- it was
-- already 1440 minutes, and the founder confirmed 24 hours is correct for
-- it.
--
-- Note this also resolves a long-standing documentation error rather than
-- creating one. CLAUDE.md described a "4-hour contact SLA" on this pathway;
-- no live entry has ever been 4 hours. The real values were 120 and 1440
-- minutes. After this migration and its companion doc fix they are 720 and
-- 1440, and the doc says so.
--
-- INSERTED AS AN UNSIGNED DRAFT, NOT ACTIVATED. escalation_slas rows are
-- append-only versions; a version only comes into force when a Clinical
-- Director signs it via public.sign_escalation_slas, which stamps
-- approved_by from their own clinical_staff record and deactivates the prior
-- active version. A migration must not forge that signature, so this leaves
-- v6 waiting at /admin/settings/escalation-slas for one click.
--
-- Until it is signed, v5 (120 minutes) remains in force.

do $$
declare
  v_active_config jsonb;
  v_next_version  int;
  v_new_config    jsonb;
  v_before        int;
  v_after         int;
begin
  select config into v_active_config
  from public.escalation_slas where is_active limit 1;

  if v_active_config is null then
    raise exception 'no active escalation_slas config to draft from';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version from public.escalation_slas;

  -- Only the emergency-tier screening_abnormal_result entry moves. Every
  -- other entry is carried through byte-for-byte.
  select jsonb_agg(
           case
             when entry->>'tier' = 'emergency'
              and entry->>'pathway' = 'screening_abnormal_result'
             then jsonb_set(
                    jsonb_set(entry, '{sla_minutes}', to_jsonb(720)),
                    '{note}',
                    to_jsonb(
                      'Critical screening result (e.g. critical BP/glucose flag, positive sensitive result). '
                      || '12-hour contact SLA, founder decision 2026-09-04 (was 120 minutes).'
                    )
                  )
             else entry
           end
         )
    into v_new_config
  from jsonb_array_elements(v_active_config) as entry;

  select (entry->>'sla_minutes')::int into v_before
  from jsonb_array_elements(v_active_config) as entry
  where entry->>'tier' = 'emergency' and entry->>'pathway' = 'screening_abnormal_result';

  select (entry->>'sla_minutes')::int into v_after
  from jsonb_array_elements(v_new_config) as entry
  where entry->>'tier' = 'emergency' and entry->>'pathway' = 'screening_abnormal_result';

  if v_before is null then
    raise exception 'could not find the emergency/screening_abnormal_result entry to change';
  end if;
  if v_after <> 720 then
    raise exception 'critical screening SLA did not become 720 minutes (got %)', v_after;
  end if;
  if jsonb_array_length(v_new_config) <> jsonb_array_length(v_active_config) then
    raise exception 'entry count changed: % -> %',
      jsonb_array_length(v_active_config), jsonb_array_length(v_new_config);
  end if;

  -- The non-critical entry must be untouched at 24 hours.
  if (select (entry->>'sla_minutes')::int
        from jsonb_array_elements(v_new_config) as entry
       where entry->>'tier' = 'urgent_escalation'
         and entry->>'pathway' = 'screening_abnormal_result') <> 1440 then
    raise exception 'abnormal non-critical screening SLA is no longer 1440 minutes';
  end if;

  insert into public.escalation_slas (version, config, notes)
  values (
    v_next_version,
    v_new_config,
    format(
      'Critical screening result contact SLA %s min -> 720 min (12 hours); abnormal non-critical unchanged at 1440 min (24 hours). Founder decision 2026-09-04. Unsigned draft: not in force until a Clinical Director signs it.',
      v_before
    )
  );

  raise notice 'drafted escalation_slas v% (critical screening % -> 720 min), unsigned',
    v_next_version, v_before;
end $$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_draft record;
begin
  select * into v_draft
  from public.escalation_slas
  where approved_by is null and not is_active
  order by version desc limit 1;

  if v_draft is null then
    raise exception 'no unsigned draft was created';
  end if;

  -- The draft must NOT be in force, and must not carry a signature.
  if v_draft.is_active then
    raise exception 'the draft must not be active before it is signed';
  end if;

  -- v5 (or whatever was active) must still be the one in force.
  if (select count(*) from public.escalation_slas where is_active) <> 1 then
    raise exception 'exactly one config must remain in force';
  end if;

  if (select (entry->>'sla_minutes')::int
        from public.escalation_slas s,
             jsonb_array_elements(s.config) as entry
       where s.is_active
         and entry->>'tier' = 'emergency'
         and entry->>'pathway' = 'screening_abnormal_result') = 720 then
    raise exception 'the 12-hour value is already in force; it should wait for a signature';
  end if;
end $$;
