-- S80b seeded the Vercel crons that existed on 2026-10-07 into public.automations (the owner registry). Seven more crons were added to apps/web/vercel.json by
-- other builds afterwards (S66 reproductive-deletions, S75-S80 assistant and community jobs, S61 testing-day reminders, S57 skin-photo purge). They are
-- registered here so the owner screen lists every scheduled job. Idempotent: a row already there is left alone; owners stay unassigned until a person sets one.
insert into public.automations (name, kind, schedule, source_ref) values
  ('vercel:reproductive-deletions', 'vercel_cron', '30 6 * * *', '/api/cron/reproductive-deletions'),
  ('vercel:assistant-nudges', 'vercel_cron', '30 7 * * *', '/api/cron/assistant-nudges'),
  ('vercel:testing-day-reminders', 'vercel_cron', '35 6 * * *', '/api/cron/testing-day-reminders'),
  ('vercel:community-housekeeping', 'vercel_cron', '50 3 * * *', '/api/cron/community-housekeeping'),
  ('vercel:skin-photo-purge', 'vercel_cron', '35 3 * * *', '/api/cron/skin-photo-purge'),
  ('vercel:assistant-silence', 'vercel_cron', '40 7 * * *', '/api/cron/assistant-silence'),
  ('vercel:assistant-review-sample', 'vercel_cron', '0 4 1 * *', '/api/cron/assistant-review-sample')
on conflict (name) do nothing;
