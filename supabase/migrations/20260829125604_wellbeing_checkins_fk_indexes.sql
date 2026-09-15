-- Tarragon Health — Mental Health & Wellbeing Platform: covering indexes for
-- wellbeing_checkins/wellbeing_checkin_preferences' organisation_id and
-- logged_by_profile_id foreign keys, flagged by Supabase's performance
-- advisor right after 20260829092000_wellbeing_checkins.sql landed live.

create index wellbeing_checkins_organisation_id_idx
  on public.wellbeing_checkins (organisation_id);

create index wellbeing_checkins_logged_by_profile_id_idx
  on public.wellbeing_checkins (logged_by_profile_id)
  where logged_by_profile_id is not null;

create index wellbeing_checkin_preferences_organisation_id_idx
  on public.wellbeing_checkin_preferences (organisation_id);
