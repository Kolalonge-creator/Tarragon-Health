-- Ops desk contacts: a number is "confirmed" by a recorded TEST CALL when no texted code is possible.
--
-- Why: the ops desk only let a contact go active when the sign-in system had confirmed their number by a texted code
-- (auth.users.phone_confirmed_at). No SMS provider has ever been live on this platform (sms_delivery_log has 0 rows; the Termii sender
-- ID application is still a draft), so nobody could ever be confirmed and the on-call cover guard could never be switched on.
--
-- What changes: an administrator or the Chief Medical Officer can RECORD that they phoned a number and the person answered
-- (public.record_ops_contact_test_call). The row names who, when and what was said, and is append-only. private.verified_profile_phone
-- keeps its original rule first (a code-confirmed number that matches the profile) and falls back to the NEWEST recorded test call for
-- that profile, so a later number replaces an earlier one. Nothing else about activation changes: still an administrator account,
-- active, a real-looking number, at least one window of hours. No row is created or changed by this migration.
-- private.verified_profile_phone was redefined from its LIVE definition (checked 2026-10-29): the original select, unchanged, plus the fallback.

create table public.ops_desk_contact_phones (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  phone           text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  tested_by       uuid not null references public.profiles (id) on delete restrict,
  tested_at       timestamptz not null default now(),
  note            text not null check (char_length(btrim(note)) >= 10),
  is_test         boolean not null default false
);
create index ops_desk_contact_phones_profile_idx on public.ops_desk_contact_phones (profile_id, tested_at desc);
create index ops_desk_contact_phones_org_idx on public.ops_desk_contact_phones (organisation_id);
create index ops_desk_contact_phones_tested_by_idx on public.ops_desk_contact_phones (tested_by);

alter table public.ops_desk_contact_phones enable row level security;
create policy ops_desk_contact_phones_read on public.ops_desk_contact_phones for select to authenticated
  using ((private.is_admin() or private.credential_is_cmo())
         and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid())));
revoke all on public.ops_desk_contact_phones from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.ops_desk_contact_phones from authenticated;
grant select on public.ops_desk_contact_phones to authenticated;

create or replace function private.verified_profile_phone(p_profile uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select pr.phone
       from public.profiles pr
       join auth.users u on u.id = pr.id
      where pr.id = p_profile
        and not private.phone_looks_placeholder(pr.phone)
        and u.phone_confirmed_at is not null
        and regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(pr.phone, '\D', '', 'g')),
    (select t.phone
       from public.ops_desk_contact_phones t
      where t.profile_id = p_profile
        and not private.phone_looks_placeholder(t.phone)
      order by t.tested_at desc, t.id desc
      limit 1)
  )
$$;
revoke all on function private.verified_profile_phone(uuid) from public, anon, authenticated;

create function public.record_ops_contact_test_call(p_profile uuid, p_phone text, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles%rowtype;
  pr public.profiles%rowtype;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g');
  v_id uuid;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'only an administrator or the chief medical officer can record a test call' using errcode = '42501'; end if;
  select * into me from public.profiles where id = (select auth.uid());
  select * into pr from public.profiles where id = p_profile;
  if not found or pr.organisation_id is distinct from me.organisation_id then raise exception 'that person was not found' using errcode = 'P0002'; end if;
  if pr.role <> 'admin' then raise exception 'an ops desk contact must be an administrator account' using errcode = '23514'; end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'enter the number with its country code, for example +2348012345678' using errcode = '22023'; end if;
  if private.phone_looks_placeholder(v_phone) then raise exception 'that number looks like a placeholder, not a real number' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say who answered and when, in at least 10 characters' using errcode = '22023'; end if;
  insert into public.ops_desk_contact_phones (organisation_id, profile_id, phone, tested_by, note, is_test)
    values (me.organisation_id, p_profile, v_phone, me.id, btrim(p_note), pr.is_test)
    returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (me.organisation_id, me.id, 'ops_desk.contact_test_call_recorded', 'profile', p_profile, jsonb_build_object('record_id', v_id, 'phone_masked', private.mask_phone(v_phone)));
  return jsonb_build_object('ok', true, 'phone_masked', private.mask_phone(v_phone));
end;
$$;
revoke all on function public.record_ops_contact_test_call(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_ops_contact_test_call(uuid, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_ops_contact_test_call(uuid, text, text)'::regprocedure, 'EXECUTE') then raise exception 'record_ops_contact_test_call is executable by anon'; end if;
  if has_function_privilege('authenticated', 'private.verified_profile_phone(uuid)'::regprocedure, 'EXECUTE') then raise exception 'verified_profile_phone is callable by authenticated'; end if;
  if has_table_privilege('anon', 'public.ops_desk_contact_phones', 'SELECT') then raise exception 'ops_desk_contact_phones readable by anon'; end if;
end $$;
