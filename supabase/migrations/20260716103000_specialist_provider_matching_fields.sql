-- Tarragon Health
-- Specialist-matching expansion
--
-- specialist_providers has always only supported filtering by
-- specialist_type — no state/telemedicine/HMO/language matching, per the
-- 5-level model in docs/Tarragon_Health_Master_Operating_Plan_v4.md §7
-- Level 5b. `state` is plain text, not a Nigerian-states enum: no such
-- enum/list exists anywhere else in this codebase, and a 37-value enum is
-- unwarranted for today's 9-row placeholder catalogue. accepted_hmos and
-- languages are arrays, not junction tables, matching this codebase's
-- existing pattern for small tag-like data (screening_results.abnormal_flags).
-- contact_email/contact_phone exist so a Zoom join link (a later, separate
-- piece of work) has somewhere to be delivered — specialists have no
-- platform login.

alter table public.specialist_providers
  add column state text,
  add column supports_telemedicine boolean not null default false,
  add column supports_in_person boolean not null default true,
  add column accepted_hmos text[] not null default '{}',
  add column languages text[] not null default '{}',
  add column contact_email text,
  add column contact_phone text;

create index specialist_providers_matching_idx
  on public.specialist_providers (specialist_type, state, is_active)
  where is_active;
