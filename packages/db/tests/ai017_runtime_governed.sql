-- Proof: AI-017 is runtime-governed and still off (migration *_ai017_runtime_governed.sql).
--
--   1. The flag is true, the system is not enabled, and ai_runtime_config reports exactly that (what scribe-draft reads).
--   2. The gate stays closed: the switch-on RPC refuses a caller who is not the CMO, and the flip did not enable anything.
--   3. The scribe consent rule is in the database, not only in the function: the transcript and note triggers exist.
--   4. SABOTAGE: with the flag put back to false in this transaction, the governed check must flip (a proof that cannot fail is not a proof).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create function pg_temp.snapshot(p_phase text) returns void language plpgsql as $$
begin
  insert into results
  select p_phase, 'flag true, system off', 'true:false', (runtime_governed::text || ':' || is_enabled::text)
    from public.ai_systems where system_code = 'AI-017';
  insert into results
  select p_phase, 'ai_runtime_config reports governed and off', 'true:false',
         ((public.ai_runtime_config('AI-017')->>'runtime_governed') || ':' || (public.ai_runtime_config('AI-017')->>'enabled'));
end $$;

select pg_temp.snapshot('real');

insert into results
select 'real', 'transcript consent trigger present', '1', count(*)::text
  from pg_trigger t where t.tgrelid = 'public.scribe_transcripts'::regclass and t.tgname = 'scribe_transcripts_require_active_consent' and not t.tgisinternal;
insert into results
select 'real', 'note consent trigger present', '1', count(*)::text
  from pg_trigger t where t.tgrelid = 'public.clinical_encounter_notes'::regclass and t.tgname = 'clinical_encounter_notes_require_active_scribe_consent' and not t.tgisinternal;

-- Switch-on is refused to a caller who is not signed in as the CMO (no JWT set: auth.uid() is null).
do $$
declare v_id uuid; v_refused boolean := false;
begin
  select id into v_id from public.ai_systems where system_code = 'AI-017';
  begin
    perform public.set_ai_system_enabled(v_id, true, 'proof: must be refused');
  exception when others then v_refused := true;
  end;
  insert into results values ('real', 'unauthenticated switch-on refused', 'true', v_refused::text);
  insert into results
  select 'real', 'still off after the attempt', 'false', is_enabled::text from public.ai_systems where system_code = 'AI-017';
end $$;

-- Sabotage.
update public.ai_systems set runtime_governed = false where system_code = 'AI-017';
select pg_temp.snapshot('sabotage');

do $$
declare v_bad text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || actual || ')', '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'FAIL real: %', v_bad; end if;

  if (select count(*) from results where phase = 'sabotage' and expected is distinct from actual) < 2 then
    raise exception 'FAIL sabotage: putting the flag back did not flip both governed checks, so the proof cannot fail';
  end if;
  raise notice 'PASS: AI-017 runtime-governed and off; 2 sabotage checks flipped';
end $$;

rollback;
