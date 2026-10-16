-- S03b follow-up (answers OQ-S03B-06): the 72 hour recovery pause, asked by the Auth Send SMS hook.
--
-- Until now the pause (public.my_phone_recovery_hold) was asked only by our web and phone apps, right after a text code was
-- accepted. A person who sent the code straight to the hosted Auth API got a session without passing it. The Send SMS hook
-- (supabase/functions/auth-send-sms-hook) is the one point every text code passes through, so it now asks this function and
-- WITHHOLDS the code for a paused account (answering Auth with the same success a real send gets, so nothing reveals which
-- accounts are paused). No code is sent, so none can be entered.
--
-- Same rule as my_phone_recovery_hold, but keyed on a user id the hook already holds (service role only; there is no session):
-- held for number_change_hold_hours after the sign-in number moved, unless a recovery contact released the account in the last
-- two hours. A missing user id is treated as held (fail closed). Email links, backup codes and the recovery contact route do
-- not pass through the hook and are unaffected; password sign-in is unaffected.
--
-- Rows at the time of writing: nothing is changed or read destructively; this adds one read-only function.

create function public.auth_sms_hold(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hours integer := (private.recovery_rules() ->> 'number_change_hold_hours')::integer;
begin
  -- no active rules means the window is unknown: raise (the hook then answers 503 and sends nothing) rather than report "not held"
  if v_hours is null then raise exception 'auth_sms_hold: no active recovery rules' using errcode = 'P0001'; end if;
  if p_user is null then return jsonb_build_object('held', true); end if;
  if not private.number_changed_recently(p_user, v_hours) then return jsonb_build_object('held', false); end if;
  if exists (select 1 from public.account_recovery_contact_requests
              where patient_id = p_user and state = 'released' and released_at > now() - interval '2 hours') then
    return jsonb_build_object('held', false, 'released_by_contact', true);
  end if;
  return jsonb_build_object('held', true);
end;
$$;

revoke all on function public.auth_sms_hold(uuid) from public;
revoke all on function public.auth_sms_hold(uuid) from anon;
revoke all on function public.auth_sms_hold(uuid) from authenticated;
grant execute on function public.auth_sms_hold(uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.auth_sms_hold(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.auth_sms_hold(uuid)', 'EXECUTE') then
    raise exception 'S03b-hold: auth_sms_hold is callable by a signed-in or anonymous role';
  end if;
  if not has_function_privilege('service_role', 'public.auth_sms_hold(uuid)', 'EXECUTE') then
    raise exception 'S03b-hold: the hook (service role) cannot call auth_sms_hold';
  end if;
end $$;
