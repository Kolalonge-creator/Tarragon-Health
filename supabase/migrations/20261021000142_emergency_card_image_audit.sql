-- Emergency card as a lock-screen picture (LSI-1): the audit door.
-- Design: docs/design/LSI-1.md. Research: docs/research/LSI-1.md.
--
-- WHAT. One function, public.record_emergency_card_image(include_qr, minimum): called by the two image routes (web and mobile) before they draw the
-- picture. It refuses unless the caller is an active patient AND has switched the lock-screen option on (emergency_card_fields.lock_screen_opt_in,
-- off by default since S43), and writes one audit row (`emergency_card.image_generated`) holding two booleans and nothing else: no field names,
-- no health value, no name. The picture is drawn only after this returns, so a picture cannot exist without its audit row.
-- No data change, no new table. The option and the card choices already exist (S43 emergency_card_fields).

create function public.record_emergency_card_image(p_include_qr boolean default true, p_minimum boolean default true) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'card_image_not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'patient' and is_active) then
    raise exception 'card_image_not_authorised' using errcode = '42501';
  end if;
  -- the person's own switch, off unless they turned it on
  if not exists (select 1 from public.emergency_card_fields where patient_id = v_uid and lock_screen_opt_in) then
    raise exception 'card_image_not_opted_in' using errcode = '42501';
  end if;
  perform private.log_audit('emergency_card.image_generated', 'profile', v_uid, jsonb_build_object('include_qr', coalesce(p_include_qr, true), 'minimum', coalesce(p_minimum, true)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.record_emergency_card_image(boolean, boolean) from public, anon;
grant execute on function public.record_emergency_card_image(boolean, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_emergency_card_image(boolean, boolean)', 'EXECUTE') then raise exception 'anon can execute record_emergency_card_image'; end if;
  if not has_function_privilege('authenticated', 'public.record_emergency_card_image(boolean, boolean)', 'EXECUTE') then raise exception 'authenticated cannot execute record_emergency_card_image'; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'emergency_card_fields' and column_name = 'lock_screen_opt_in') <> 'false' then
    raise exception 'lock_screen_opt_in is no longer off by default';
  end if;
end $$;
