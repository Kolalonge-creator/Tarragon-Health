-- S70a x S05b: let cross-source de-duplication replace a reading in place, as S70a designed, despite S05b's value freeze.
--
-- S05b (main-dev, 20261013184219) froze the value columns of recorded vitals: a value is never edited, only superseded through correct_clinical_value. S70a's de-duplication
-- (private.dedupe_cross_source_vitals) replaces a worse source's reading with a better source's reading of the same measurement in place, and keeps the replaced payload
-- in vitals_reading_links. With the freeze, that UPDATE was refused, the function's fail-open handler swallowed it, and both readings were kept (counted twice).
-- The exemption is narrow: the privileged owner role AND the transaction-local flag tarragon.vitals_dedupe that only the dedup function sets. Idempotent.
CREATE OR REPLACE FUNCTION private.enforce_clinical_value_supersession()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    -- only the one explicit, transaction-local flag set by a privileged function that is allowed to remove these rows (the patient's own
    -- wearable erasure). A cascade from a deleted profile is refused too: real accounts are not erased this way, and the test-account purge
    -- disables triggers on the tables it touches.
    if v_priv and coalesce(nullif(current_setting('app.allow_clinical_value_delete', true), ''), 'off') = 'on' then
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
      if v_old -> v_col is distinct from v_new -> v_col
         -- S70a: cross-source de-duplication replaces a worse source's reading with a better one's in place, and keeps the replaced payload in vitals_reading_links, so
         -- nothing is lost. Only the privileged owner role running the dedup function (which sets this transaction-local flag) is let through; a signed-in user setting the flag
         -- is not that role, so the freeze still holds for everyone else.
         and not (v_priv and tg_table_name = 'vitals_readings'
                  and coalesce(nullif(current_setting('tarragon.vitals_dedupe', true), ''), 'off') = 'on') then
        raise exception 'a recorded % value is never edited (column %): supersede it with public.correct_clinical_value', tg_table_name, v_col
          using errcode = '42501';
      end if;
    end loop;
  end if;

  -- correction links: only the function writes them, and a marked row is final
  foreach v_col in array v_chain loop
    if v_old -> v_col is distinct from v_new -> v_col then
      -- the foreign key's own ON DELETE SET NULL (a profile removed later) is the one change that may come from outside the function
      if v_col = 'corrected_by' and new.corrected_by is null and pg_trigger_depth() > 1 then
        continue;
      end if;
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
$function$;
