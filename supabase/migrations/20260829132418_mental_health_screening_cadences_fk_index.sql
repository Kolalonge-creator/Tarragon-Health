-- Tarragon Health — Mental Health & Wellbeing Platform: covering index for
-- mental_health_screening_cadences.approved_by, flagged by Supabase's
-- performance advisor right after 20260829096000 landed live.

create index mental_health_screening_cadences_approved_by_idx
  on public.mental_health_screening_cadences (approved_by)
  where approved_by is not null;
