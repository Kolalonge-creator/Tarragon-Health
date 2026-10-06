-- S21 (part 6): remove the phone-bridge store. The phone fallback is now the vendor's own dial-in number (OQ-131 revised, founder
-- decision 2026-10-06): the person rings a number Zoom publishes and types the meeting id and passcode, so Tarragon never rings
-- anyone and never holds anyone's number. The bridge table, its number-forgetting trigger and its sweep have no remaining reader or writer.
--
-- Row counts at writing: public.phone_bridges has 0 rows on the live project (checked 2026-10-06), so there is nothing to convert
-- or keep. Code that used it (the Africa's Talking adapter, the callback route, the store) was removed in the same change, and
-- code is shipped first: nothing deployed from before this change reads the table, because the bridge was never switched on.
--
-- service_set_phone_mode() stays: the ladder's last step is still "phone" for the in-app SDK later (OQ-136), and the database
-- function is the only way a consultation is marked as ended on the phone.

do $$
begin
  if exists (select 1 from cron.job where jobname = 's21-phone-bridge-sweep') then
    perform cron.unschedule('s21-phone-bridge-sweep');
  end if;
end $$;

drop table public.phone_bridges;
drop function private.sweep_phone_bridges();
drop function private.phone_bridges_forget_number();

do $$
begin
  if to_regclass('public.phone_bridges') is not null then
    raise exception 'S21f: phone_bridges still exists';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'private'::regnamespace and proname in ('sweep_phone_bridges', 'phone_bridges_forget_number')) then
    raise exception 'S21f: a phone-bridge function is still defined';
  end if;
  if exists (select 1 from cron.job where jobname = 's21-phone-bridge-sweep') then
    raise exception 'S21f: the phone-bridge sweep is still scheduled';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'service_set_phone_mode') then
    raise exception 'S21f: service_set_phone_mode must remain';
  end if;
end $$;
