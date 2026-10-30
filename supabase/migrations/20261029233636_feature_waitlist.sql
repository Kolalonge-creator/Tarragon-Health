-- Waitlist for features that are not open yet (design audit P5: a page that cannot be used offers "tell me when it opens"
-- instead of a dead end). One row says "this patient wants to hear when <feature> opens". No health data is stored.
--
-- Access: a patient reads, adds and removes only their own rows. There is deliberately NO staff read policy: this is a
-- patient's own note to themselves, and counts for planning are taken by a superadmin with the service role, not by the
-- tied staff-read path (S39b). feature_key is a closed list so a typo cannot create a waitlist for nothing.
-- Nothing here sends a message: the app shows a patient they are on the list; telling them it opened is a separate job
-- that does not exist yet, and no feature may depend on a send succeeding.

create table public.feature_waitlist (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  feature_key     text not null check (feature_key in ('consultations', 'membership', 'directory')),
  created_at      timestamptz not null default now(),
  constraint feature_waitlist_one_per_feature unique (patient_id, feature_key)
);

create index feature_waitlist_org_idx on public.feature_waitlist (organisation_id);

alter table public.feature_waitlist enable row level security;

create policy feature_waitlist_select on public.feature_waitlist for select to authenticated
  using (patient_id = (select auth.uid()));

create policy feature_waitlist_insert on public.feature_waitlist for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

create policy feature_waitlist_delete on public.feature_waitlist for delete to authenticated
  using (patient_id = (select auth.uid()));

-- A new table needs its own grant (RLS restricts rows, it does not grant access). No update: a row is on or off. The default
-- privileges would otherwise hand authenticated UPDATE too, so it is revoked by name.
grant select, insert, delete on public.feature_waitlist to authenticated;
revoke all on public.feature_waitlist from anon;
revoke update, truncate, references, trigger on public.feature_waitlist from authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.feature_waitlist', 'SELECT') then
    raise exception 'anon must not read feature_waitlist';
  end if;
  if not has_table_privilege('authenticated', 'public.feature_waitlist', 'INSERT') then
    raise exception 'authenticated must be able to insert into feature_waitlist';
  end if;
  if has_table_privilege('authenticated', 'public.feature_waitlist', 'UPDATE') then
    raise exception 'authenticated must not update feature_waitlist';
  end if;
end $$;
