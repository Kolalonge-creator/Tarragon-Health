-- Adult-only registration counts the 18th birthday in Lagos time, not server (UTC) time (founder decision 2026-10-21: "Lagos time").
--
-- The rule "timezone always Africa/Lagos" was not applied to the age check. Both sign-up gates compared the date of birth with the SERVER date
-- (current_date, UTC). For the one hour a day when the UTC date is behind the Lagos date (23:00 to 24:00 UTC, midnight to 1am in Lagos), a person whose
-- 18th birthday is "today" in Lagos was still refused as under 18. It also made database proofs that build a "turned 18 today" person fail in that hour.
--
-- Changed (the two registration gates only):
--   private.enforce_adult_registration()  the profiles trigger (counsel-signed adult-only registration)
--   private.handle_new_user()             the sign-up handler that reads the date of birth from the sign-up metadata
-- Both now call one helper, private.adult_cutoff_date(): the Lagos date today minus 18 years. A date of birth AFTER that is under 18.
--
-- NOT changed here, on purpose: the other places that compare a birth date with current_date (the majority-review and hand-over sweeps, the caregiver
-- read of a signed report, written questions, the community age check, the yearly proxy review). They are not registration gates; moving them is a
-- separate change with its own review. They are listed in docs/OPEN-QUESTIONS.md.
--
-- Counts first (live 2026-10-21): 0 profiles that are under 18 and not a minor_child dependant, so nothing needs converting. The rule itself
-- (who may register) is unchanged; only the day the boundary falls on moves by up to one calendar day, for one hour in every 24.
--
-- Patched from the live definitions by anchor (checked on 2026-10-21: each function holds the anchor exactly once), refusing to guess if it is
-- missing or repeated.

create function private.adult_cutoff_date() returns date
language sql stable set search_path = ''
as $$ select ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date $$;
comment on function private.adult_cutoff_date() is
  'The latest date of birth that is 18 or older today in Africa/Lagos. A date of birth AFTER it is under 18. The one definition of the adult-only registration boundary.';
revoke all on function private.adult_cutoff_date() from public, anon, authenticated;

do $$
declare
  c_old constant text := '(current_date - interval ''18 years'')::date';
  c_new constant text := 'private.adult_cutoff_date()';
  v_fn text; v_oid oid; v_def text; v_n integer; v_done integer := 0;
begin
  foreach v_fn in array array['enforce_adult_registration', 'handle_new_user'] loop
    v_n := 0;
    for v_oid in select p.oid from pg_proc p where p.proname = v_fn and p.pronamespace = 'private'::regnamespace loop
      v_def := pg_get_functiondef(v_oid);
      if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
        raise exception 'private.% (%): the anchor is missing or repeated, refusing to guess', v_fn, v_oid::regprocedure;
      end if;
      execute replace(v_def, c_old, c_new);
      v_n := v_n + 1;
    end loop;
    if v_n <> 1 then raise exception 'private.%: expected exactly one function, found %', v_fn, v_n; end if;
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then raise exception 'expected to patch two functions, patched %', v_done; end if;
end $$;

-- Self-checks ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['enforce_adult_registration', 'handle_new_user'] loop
    if pg_get_functiondef(('private.' || v_fn || '()')::regprocedure) not like '%adult_cutoff_date%'
       or pg_get_functiondef(('private.' || v_fn || '()')::regprocedure) like '%current_date - interval ''18 years''%' then
      raise exception 'adult registration self-check: private.% was not patched', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.adult_cutoff_date()', 'EXECUTE') or has_function_privilege('authenticated', 'private.adult_cutoff_date()', 'EXECUTE') then
    raise exception 'adult registration self-check: the helper must not be executable by a session';
  end if;
  if private.adult_cutoff_date() is distinct from ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date then
    raise exception 'adult registration self-check: the helper is not the Lagos boundary';
  end if;
end $$;
