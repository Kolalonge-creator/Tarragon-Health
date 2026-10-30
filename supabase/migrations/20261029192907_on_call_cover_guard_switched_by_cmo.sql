-- The on-call cover guard (on_call_cover_ok) is switched by the Chief Medical Officer, from the go-live page on the CMO dashboard.
--
-- Until now the guard named the admin as its switch holder, so the CMO (whose login is `clinician` and can never open /admin) could not turn the intake
-- gate's cover requirement on or off, although the capacity and cover rules it enforces are the CMO's to sign. The go-live machinery already supports
-- CMO-switched guards (63 of them) and the CMO's own page, /clinician/go-live, lists them, so this is one data change and no new screen.
--
-- Counted first (live, read only, 2026-10-29): one row, key on_call_cover_ok, switch_role 'admin', is_on false. Nothing to convert.
--
-- What does NOT change, deliberately:
--   * Switching ON still needs a note and every condition met right now (the rota covers the next 7 days with a primary and an eligible backup), and the
--     ops-desk checklist trigger still applies. set_go_live_guard is untouched.
--   * Switching OFF was already allowed for an admin or the CMO with no paperwork (the stop button). It still is, for both.
--   * Admins lose only the power to switch it ON; they can still switch it off.
update public.go_live_guards set switch_role = 'cmo' where key = 'on_call_cover_ok' and switch_role <> 'cmo';

do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'on_call_cover_ok' and switch_role = 'cmo') then
    raise exception 'on_call_cover_ok is not a CMO-switched guard';
  end if;
  if exists (select 1 from public.go_live_guards where key = 'on_call_cover_ok' and is_on) then
    raise exception 'on_call_cover_ok must not be switched on by this migration';
  end if;
end $$;
