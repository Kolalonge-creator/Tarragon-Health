-- Tarragon Health
-- Covers 4 FK columns on safeguarding_concerns the security/performance
-- advisor flagged immediately after that migration landed (reported_by,
-- reviewed_by_staff, closed_by_staff, clinician_alert_id) -- same "a
-- freshly created table needs its own indexes, same as its own grants"
-- discipline CLAUDE.md already calls out for authenticated-table-grants.

create index safeguarding_concerns_reported_by_idx on public.safeguarding_concerns (reported_by);
create index safeguarding_concerns_reviewed_by_staff_idx on public.safeguarding_concerns (reviewed_by_staff);
create index safeguarding_concerns_closed_by_staff_idx on public.safeguarding_concerns (closed_by_staff);
create index safeguarding_concerns_clinician_alert_idx on public.safeguarding_concerns (clinician_alert_id);
