-- Tarragon Health
-- FK-covering indexes for this pass's new tables, flagged by the
-- performance advisor immediately after each migration landed -- same
-- "a freshly created table needs its own indexes" discipline as
-- 20260829213200_safeguarding_concerns_fk_indexes.sql.

create index quality_improvement_cycles_created_by_idx on public.quality_improvement_cycles (created_by);
create index quality_improvement_cycles_owner_staff_idx on public.quality_improvement_cycles (owner_staff);

create index protocol_drafts_authored_by_profile_idx on public.protocol_drafts (authored_by_profile);
create index protocol_drafts_authored_by_staff_idx on public.protocol_drafts (authored_by_staff);
create index protocol_drafts_promoted_to_version_idx on public.protocol_drafts (promoted_to_version_id);

create index protocol_draft_comments_commented_by_staff_idx on public.protocol_draft_comments (commented_by_staff);
create index protocol_draft_comments_organisation_idx on public.protocol_draft_comments (organisation_id);
