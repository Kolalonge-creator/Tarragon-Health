-- Tarragon Health — region_waitlist: "notify me when partner services reach {state}"
--
-- When a logged-in patient hits a partner-dependent action in a dark (or unpartnered)
-- state, the UI offers a one-tap "notify me when it's live". That intent lands here. When
-- an admin later flips that state's service_regions.is_active on, a trigger
-- (20260717104000_notify_region_waitlist.sql) enqueues a "services are now available near
-- you" notification to every open waitlist row for that state and stamps notified_at.
--
-- Because registration is already open to everyone (Free/self-service works anywhere), the
-- waitlister is always an existing authenticated profile — so unlike public.leads (which is
-- an anonymous, service-role-only marketing capture) this is a normal patient-owned row:
-- the patient inserts and reads their own entries under RLS; no service-role needed.
--
--   • requester_id       — who to notify (the account holder, = auth.uid()).
--   • care_recipient_id  — optional: the family member / parent the request is on behalf of
--                          (a diaspora child waitlisting for a parent in Nigeria). The
--                          gated *state* is the care-recipient's, but the *notification*
--                          goes to the requester. Null when the requester is the patient.
--   • service_type       — 'lab' | 'pharmacy' | 'home_visit' | 'delivery' | 'specialist'.
--   • to_email/to_phone  — contact snapshot at capture time (so a later contact-detail
--                          change doesn't silently redirect the go-live alert).

create table if not exists public.region_waitlist (
  id                uuid primary key default gen_random_uuid(),
  requester_id      uuid not null references public.profiles (id) on delete cascade,
  care_recipient_id uuid references public.profiles (id) on delete cascade,
  state             text not null,
  service_type      text not null,
  to_email          text,
  to_phone          text,
  notified_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint region_waitlist_service_type_valid
    check (service_type in ('lab', 'pharmacy', 'home_visit', 'delivery', 'specialist'))
);

create index if not exists region_waitlist_state_open_idx
  on public.region_waitlist (state)
  where notified_at is null;

create index if not exists region_waitlist_requester_idx
  on public.region_waitlist (requester_id, created_at desc);

-- One open (un-notified) row per requester + care-recipient + state + service. A resolved
-- (notified) row doesn't block re-joining if the state is later toggled off then on again.
create unique index if not exists region_waitlist_open_unique_idx
  on public.region_waitlist (requester_id, coalesce(care_recipient_id, requester_id), state, service_type)
  where notified_at is null;

alter table public.region_waitlist enable row level security;

-- Patient owns their own waitlist rows; admins may read all for ops demand-planning.
drop policy if exists region_waitlist_select on public.region_waitlist;
create policy region_waitlist_select on public.region_waitlist
  for select to authenticated
  using (requester_id = (select auth.uid()) or private.is_admin());

drop policy if exists region_waitlist_insert on public.region_waitlist;
create policy region_waitlist_insert on public.region_waitlist
  for insert to authenticated
  with check (requester_id = (select auth.uid()));

drop policy if exists region_waitlist_delete on public.region_waitlist;
create policy region_waitlist_delete on public.region_waitlist
  for delete to authenticated
  using (requester_id = (select auth.uid()));

grant select, insert, delete on public.region_waitlist to authenticated;
