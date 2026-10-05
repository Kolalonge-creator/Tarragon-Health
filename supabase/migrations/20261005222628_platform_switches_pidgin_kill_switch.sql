-- Platform kill switches, first row: the Nigerian Pidgin interface.
--
-- WHY: the Pidgin strings were written without a native speaker reviewing them
-- (OQ-19, OQ-61, OQ-63, OQ-74). If an admin finds something wrong, they need to
-- turn Pidgin off for everyone in one step and have the whole product fall back
-- to English, without a redeploy and without touching anyone's saved choice.
--
-- A SWITCH, NOT A DATA CHANGE: `profiles.language` is left alone. A patient who
-- chose Pidgin keeps that choice on file, so switching Pidgin back on after the
-- wording is fixed restores their screens; while it is off, every surface reads
-- the effective language as English.
--
-- Deliberately not `platform_modules`: that table models a platform that ships
-- built-but-dormant (off by default, switching ON needs a reason, an enabled row
-- must carry attribution). This is the opposite shape: ON by default, and turning
-- it OFF in a hurry must never be blocked by paperwork, so the note is optional.
--
-- Fail-closed for the reader: an unknown key, or a switch that is off, answers
-- false, which every client treats as "English only".

create table if not exists public.platform_switches (
  key              text primary key,
  label            text not null,
  description      text not null,
  is_on            boolean not null default true,
  -- A signed-out screen (login, sign-up) offers the language choice too, so a
  -- few switches must be answerable by `anon`. This is an explicit opt-in per row.
  readable_by_anon boolean not null default false,
  changed_at       timestamptz,
  changed_by       uuid references public.profiles (id) on delete set null,
  change_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.platform_switches is
  'One row per platform-wide on/off switch that is ON by default and can be turned OFF in one step by an admin (a kill switch). Flip only via public.set_platform_switch(). Read via public.platform_switch_is_on().';

drop trigger if exists platform_switches_set_updated_at on public.platform_switches;
create trigger platform_switches_set_updated_at
  before update on public.platform_switches
  for each row execute function private.set_updated_at();

alter table public.platform_switches enable row level security;

drop policy if exists platform_switches_select on public.platform_switches;
create policy platform_switches_select on public.platform_switches
  for select to authenticated using (true);

-- No insert/update/delete grant: set_platform_switch() is the only door.
grant select on public.platform_switches to authenticated;
revoke all on public.platform_switches from anon;

-- ---------------------------------------------------------------------------
-- Reader. SECURITY DEFINER so a signed-out screen can ask without any table
-- access; the row-level opt-in (`readable_by_anon`) is what limits what `anon`
-- can learn. An unknown key is false.
-- ---------------------------------------------------------------------------
create or replace function public.platform_switch_is_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select s.is_on
        from public.platform_switches s
       where s.key = p_key
         and (s.readable_by_anon or (select auth.uid()) is not null)
    ),
    false
  );
$$;

comment on function public.platform_switch_is_on(text) is
  'True only when the named switch exists, is on, and the caller may see it (anon only for readable_by_anon rows). Unknown key = false, so a typo turns a feature off, never on.';

-- `anon` inherits EXECUTE through the PUBLIC pseudo-role, so revoke from public,
-- then grant to anon on purpose: this one function is meant to be anon-callable.
revoke all on function public.platform_switch_is_on(text) from public;
grant execute on function public.platform_switch_is_on(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one deliberate writer. Admin only; audited; the note is optional in both
-- directions so switching something off in a hurry is never blocked.
-- ---------------------------------------------------------------------------
create or replace function public.set_platform_switch(
  p_key  text,
  p_on   boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.platform_switches%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only an admin can change a platform switch'
      using errcode = '42501';
  end if;

  select * into v_row from public.platform_switches where key = p_key;
  if v_row.key is null then
    raise exception 'no such platform switch: %', p_key using errcode = '22023';
  end if;

  update public.platform_switches
     set is_on       = p_on,
         changed_at  = now(),
         changed_by  = (select auth.uid()),
         change_note = nullif(btrim(coalesce(p_note, '')), '')
   where key = p_key;

  perform private.log_audit(
    case when p_on then 'platform_switch.on' else 'platform_switch.off' end,
    'platform_switch',
    null,
    jsonb_build_object('key', p_key, 'note', p_note, 'was_on', v_row.is_on)
  );

  return jsonb_build_object('ok', true, 'key', p_key, 'is_on', p_on);
end;
$$;

revoke all on function public.set_platform_switch(text, boolean, text) from public;
revoke all on function public.set_platform_switch(text, boolean, text) from anon;
grant execute on function public.set_platform_switch(text, boolean, text) to authenticated;

insert into public.platform_switches (key, label, description, is_on, readable_by_anon) values
  ('pidgin_language',
   'Nigerian Pidgin',
   'Offers the Pidgin interface on web and mobile, signed in and signed out. Turn off to show English everywhere: saved Pidgin choices are kept and come back when this is turned on again. Clinical, emergency, dosing and consent text is English-only whatever this is set to.',
   true,
   true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.platform_switches where key = 'pidgin_language' and is_on and readable_by_anon) then
    raise exception 'FAIL: pidgin_language switch should exist, on, and anon-readable';
  end if;
  if public.platform_switch_is_on('no_such_switch_at_all') then
    raise exception 'FAIL: an unknown switch key answered true';
  end if;
  if has_function_privilege('anon', 'public.set_platform_switch(text,boolean,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute set_platform_switch';
  end if;
  if not has_function_privilege('anon', 'public.platform_switch_is_on(text)', 'EXECUTE') then
    raise exception 'FAIL: anon cannot read a switch (signed-out screens need it)';
  end if;
  if has_table_privilege('anon', 'public.platform_switches', 'SELECT') then
    raise exception 'FAIL: anon can read the platform_switches table directly';
  end if;
  raise notice 'PASS: platform_switches ships pidgin_language on, fail-closed, admin-write only';
end $$;
