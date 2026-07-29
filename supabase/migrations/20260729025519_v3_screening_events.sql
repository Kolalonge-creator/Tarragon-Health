-- forward-declared ahead of readings/triage (§5.10 in the spec, moved earlier for FK order)
create table screening_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),
  name text not null,
  held_on date not null,
  location text,
  operator_profile_id uuid references profiles(id),
  participants_expected int,
  created_at timestamptz not null default now()
);

