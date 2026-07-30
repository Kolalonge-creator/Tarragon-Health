-- Tarragon Control — M4: I2, every reading produces exactly one
-- classification row
-- Source: spec §3 (I2), §7.2 pipeline step 2-3, Phase 2 §1 (L1 guard)
--
-- M4 scope, stated plainly: no real classification engine exists yet.
-- packages/triage (pure functions), protocol-driven thresholds, AI
-- assist, and batch clear are ALL M5. This trigger exists only to satisfy
-- I2 honestly -- every reading gets exactly one triage_classifications
-- row, unconditionally forced to 'needs_review', never pretending to
-- have clinical judgment M5 hasn't built yet.
--
-- This is also, not coincidentally, exactly Phase 2 L1's stated runtime
-- effect while who_hearts v1 is unapproved: "every classification is
-- forced to needs_review and no batch clear is permitted." The
-- app_config guard is seeded now so M5 has the exact key to check when it
-- replaces this unconditional force with the real engine; M4 itself has
-- no conditional branch on it yet because there is nothing to switch to.

insert into app_config (key, value, set_by, set_at)
values ('who_hearts_v1_approved', 'false'::jsonb, null, now())
on conflict (key) do nothing;

create or replace function private.classify_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protocol_config_id uuid;
begin
  select id into v_protocol_config_id
  from protocol_configs
  where code = 'who_hearts'
    and effective_from <= new.taken_at
    and (effective_to is null or effective_to > new.taken_at)
  order by effective_from desc
  limit 1;

  if v_protocol_config_id is null then
    raise exception
      'Cannot classify reading % (patient %): no active who_hearts protocol_configs row covers taken_at %. Seed at least one (v0-provisional at minimum, clinician-approved) before capturing readings -- I2 requires every reading to be classifiable.', new.id, new.patient_id, new.taken_at
      using errcode = '23514';
  end if;

  insert into triage_classifications (
    reading_id, patient_id, classification, protocol_config_id, rule_fired, ai_assisted
  ) values (
    new.id, new.patient_id, 'needs_review', v_protocol_config_id, 'm4_placeholder_forced_review', false
  );

  return new;
end;
$$;

create trigger trg_classify_reading
  after insert on readings
  for each row
  execute function private.classify_reading();
