-- S57c: the meditation and sleep audio (ElevenLabs masters in audio/library/masters) gets a home, and 46 DRAFT catalogue rows.
--
-- BUCKET: a public Storage bucket `audio` (OQ-204 option a). It holds non-personal wellbeing audio only. Public read needs no policy;
--   there is deliberately NO insert/update/delete policy, so only the service role or the CLI can put a file there. The files are
--   uploaded after this migration is applied (rows exist first, which is safe: a draft row is never served).
-- ROWS: 46 media_library rows (code = the file id in lower case), content_status 'draft', is_active false, is_placeholder false,
--   no reviewer. NONE is servable, so a patient sees nothing until a named reviewer and a future review date are recorded on the
--   admin media-library page (brand for all). The migration signs and publishes nothing.
-- LEFT OUT ON PURPOSE: MED-SER-FAITH (founder decision 2026-10-07: the CMO writes faith-compatible content and a named faith leader
--   reviews it) and MED-BRE-001..005 (the breathing kind is a script item with steps and a pattern, not an audio item, and sits behind the
--   clinical-scripts guard; the five spoken breathing guides need the CMO to decide how they are catalogued).
-- COUNTS: media_library rows before: 12 structure placeholders and 24 draft narration scripts (none has one of these codes).
-- STREAM ONLY (founder, 2026-10-23): every row is downloadable = false, so media_offline_manifest never lists it and the app offers no offline copy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', true, 15728640, array['audio/mpeg'])
on conflict (id) do nothing;

insert into public.media_library (id, code, kind, title, series, series_position, language, voice, duration_seconds, bytes, audio_url,
                                  content_status, is_placeholder, is_active, downloadable)
select md5('tarragon-media-library:' || v.code)::uuid, v.code, v.kind, v.title, v.series, v.pos, 'en', v.voice, v.dur, v.bytes, v.url,
       'draft', false, false, false   -- downloadable = false: stream only (founder, 2026-10-23)
from (values
  ('med-bell', 'soundscape', 'Meditation bell (8 seconds, for timers)', 'general', 90, NULL, 8, 129193, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-BELL.mp3'),
  ('med-body-02', 'meditation', 'Neck and shoulders release', 'general', 20, 'Tarragon woman voice', 436, 6977453, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-BODY-02.mp3'),
  ('med-body-03', 'meditation', 'Heavy legs for a hot night', 'sleep', 20, 'Tarragon woman voice', 350, 5612816, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-BODY-03.mp3'),
  ('med-body-10', 'meditation', 'Ten minute body scan', 'general', 21, 'Tarragon woman voice', 598, 9583847, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-BODY-10.mp3'),
  ('med-crs-01', 'meditation', 'Five-day course, day 1: Arriving', 'intro', 11, 'Tarragon woman voice', 221, 3551860, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-CRS-01.mp3'),
  ('med-crs-02', 'meditation', 'Five-day course, day 2: The body', 'intro', 12, 'Tarragon woman voice', 203, 3252601, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-CRS-02.mp3'),
  ('med-crs-03', 'meditation', 'Five-day course, day 3: Sounds and thoughts', 'intro', 13, 'Tarragon woman voice', 197, 3167755, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-CRS-03.mp3'),
  ('med-crs-04', 'meditation', 'Five-day course, day 4: Kindness', 'intro', 14, 'Tarragon woman voice', 197, 3158142, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-CRS-04.mp3'),
  ('med-crs-05', 'meditation', 'Five-day course, day 5: Carrying it on', 'intro', 15, 'Tarragon woman voice', 189, 3026067, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-CRS-05.mp3'),
  ('med-med-001', 'meditation', 'Open awareness', 'general', 30, 'Tarragon woman voice', 565, 9045933, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-MED-001.mp3'),
  ('med-med-002', 'meditation', 'Gratitude meditation', 'general', 31, 'Tarragon woman voice', 349, 5584813, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-MED-002.mp3'),
  ('med-med-003', 'meditation', 'Counting the breath', 'general', 32, 'Tarragon woman voice', 436, 6983723, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-MED-003.mp3'),
  ('med-ser-exams', 'meditation', 'Calm before an exam or an interview', 'exams', 11, 'Tarragon woman voice', 236, 3782991, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SER-EXAMS.mp3'),
  ('med-ser-grief', 'meditation', 'Sitting with grief', 'grief', 11, 'Tarragon woman voice', 281, 4498955, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SER-GRIEF.mp3'),
  ('med-ser-stress', 'meditation', 'Calm in a stressful time', 'stress', 11, 'Tarragon woman voice', 310, 4973757, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SER-STRESS.mp3'),
  ('med-ser-work', 'meditation', 'A reset in the middle of the working day', 'work', 11, 'Tarragon woman voice', 181, 2905695, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SER-WORK.mp3'),
  ('med-slp-001', 'sleep_story', 'Evening on the veranda', 'sleep', 11, 'Tarragon woman voice', 386, 6178733, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-001.mp3'),
  ('med-slp-002', 'sleep_story', 'Rain on the roof', 'sleep', 12, 'Tarragon woman voice', 321, 5149300, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-002.mp3'),
  ('med-slp-003', 'sleep_story', 'The market at dusk', 'sleep', 13, 'Tarragon woman voice', 472, 7560088, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-003.mp3'),
  ('med-slp-004', 'sleep_story', 'A boat on the lagoon', 'sleep', 14, 'Tarragon woman voice', 430, 6889264, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-004.mp3'),
  ('med-slp-005', 'sleep_story', 'After the rain', 'sleep', 15, 'Tarragon woman voice', 410, 6572033, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-005.mp3'),
  ('med-slp-006', 'sleep_story', 'The village path', 'sleep', 16, 'Tarragon woman voice', 398, 6371412, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-006.mp3'),
  ('med-slp-007', 'sleep_story', 'The night bus home', 'sleep', 17, 'Tarragon woman voice', 444, 7108692, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-007.mp3'),
  ('med-slp-008', 'sleep_story', 'A rooftop at night', 'sleep', 18, 'Tarragon woman voice', 413, 6609649, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-008.mp3'),
  ('med-slp-009', 'sleep_story', 'Grandmother''s compound', 'sleep', 19, 'Tarragon woman voice', 443, 7092392, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-009.mp3'),
  ('med-slp-010', 'sleep_story', 'The library on the hill', 'sleep', 20, 'Tarragon woman voice', 418, 6698674, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SLP-010.mp3'),
  ('med-snd-001', 'soundscape', 'Rain on a zinc roof', 'sleep', 21, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-001.mp3'),
  ('med-snd-002', 'soundscape', 'Harmattan night', 'sleep', 22, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-002.mp3'),
  ('med-snd-003', 'soundscape', 'Gentle waves', 'sleep', 23, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-003.mp3'),
  ('med-snd-004', 'soundscape', 'Evening crickets', 'sleep', 24, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-004.mp3'),
  ('med-snd-005', 'soundscape', 'Distant market murmur at dusk', 'sleep', 25, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-005.mp3'),
  ('med-snd-006', 'soundscape', 'Gentle stream', 'sleep', 26, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-006.mp3'),
  ('med-snd-007', 'soundscape', 'Bedroom fan hum (steady, generator-friendly masking)', 'sleep', 27, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-007.mp3'),
  ('med-snd-008', 'soundscape', 'Heavy steady rain', 'sleep', 28, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-008.mp3'),
  ('med-snd-009', 'soundscape', 'Distant gentle thunder with light rain', 'sleep', 29, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-009.mp3'),
  ('med-snd-010', 'soundscape', 'Harmattan wind', 'sleep', 30, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-010.mp3'),
  ('med-snd-011', 'soundscape', 'Morning birdsong', 'sleep', 31, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-011.mp3'),
  ('med-snd-012', 'soundscape', 'Soft brown noise (masking)', 'sleep', 32, NULL, 22, 353219, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-SND-012.mp3'),
  ('med-wnd-001', 'meditation', 'Wind down after a long day', 'sleep', 41, 'Tarragon woman voice', 280, 4485581, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-001.mp3'),
  ('med-wnd-002', 'meditation', 'Body scan for sleep', 'sleep', 42, 'Tarragon woman voice', 298, 4768957, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-002.mp3'),
  ('med-wnd-003', 'meditation', 'Letting go of the day', 'sleep', 43, 'Tarragon woman voice', 440, 7046416, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-003.mp3'),
  ('med-wnd-004', 'meditation', 'A hot night cool down', 'sleep', 44, 'Tarragon woman voice', 325, 5201545, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-004.mp3'),
  ('med-wnd-005', 'meditation', 'After a hard day', 'sleep', 45, 'Tarragon woman voice', 303, 4855056, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-005.mp3'),
  ('med-wnd-006', 'meditation', 'Before an early start', 'sleep', 46, 'Tarragon woman voice', 305, 4884314, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-006.mp3'),
  ('med-wnd-007', 'meditation', 'When you are worried about your health', 'sleep', 47, 'Tarragon woman voice', 331, 5297257, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-007.mp3'),
  ('med-wnd-008', 'meditation', 'A twenty minute nap reset', 'general', 49, 'Tarragon woman voice', 303, 4855056, 'https://koiplnmbgnqnbywhpjlf.supabase.co/storage/v1/object/public/audio/media-library/MED-WND-008.mp3')
) as v(code, kind, title, series, pos, voice, dur, bytes, url)
on conflict (code) do nothing;

do $$
declare v_n integer; v_bad integer;
begin
  if not exists (select 1 from storage.buckets where id = 'audio' and public) then
    raise exception 'FAIL: the audio bucket is missing or not public';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and (qual ilike '%''audio''%' or with_check ilike '%''audio''%')) then
    raise exception 'FAIL: a write policy names the audio bucket';
  end if;
  select count(*) into v_n from public.media_library where audio_url like '%/storage/v1/object/public/audio/media-library/MED-%';
  if v_n <> 46 then raise exception 'FAIL: expected 46 library audio rows, found %', v_n; end if;
  select count(*) into v_bad from public.media_library
   where audio_url like '%/public/audio/media-library/MED-%'
     and (is_active or content_status <> 'published' and content_status <> 'draft' or reviewed_by_name is not null
          or private.media_is_servable(is_active, content_status, is_placeholder, next_review_due));
  if v_bad <> 0 then raise exception 'FAIL: % library audio rows are active, reviewed or servable', v_bad; end if;
  if exists (select 1 from public.media_library where audio_url like '%/public/audio/media-library/MED-%' and downloadable) then
    raise exception 'FAIL: a library audio row is downloadable (stream only)';
  end if;
  if exists (select 1 from public.media_library where code in ('med-ser-faith') or code like 'med-bre-%') then
    raise exception 'FAIL: a left-out file got a row';
  end if;
end $$;
