-- S57b step 4: seed the DRAFT narration scripts for CMO review (24 rows: 10 meditations, 8 sleep, 6 breathing).
--
-- WHAT THIS IS. The agent-drafted narration text in docs/content/{meditations,sleep,breathing} (copied from branch s55-60/content-drafts) is stored
-- in media_library so the CMO can read each script in the admin screen (Settings, Calm and sleep library) and approve, amend or reject it.
-- Nothing here is approved, nothing has audio, nothing is servable to a patient:
--   * content_status 'draft', is_active false, is_placeholder TRUE (the publish gate refuses a placeholder; the CMO unticks it only after reading),
--     reviewed_by_name / reviewed_at / next_review_due null, no audio_url, no duration or size. Even with the placeholder flag removed the gate
--     still refuses an audio item with no audio file, and a breathing item with no steps or pattern.
--   * the script text sits in `script` ->> 'narration' with the draft file, sources and runtime estimate beside it (script.needs_clinical_review true).
--   * the two faith-compatible reflection drafts in that folder are NOT seeded: founder decision 2026-10-07, the CMO writes that content and a named faith
--     leader reviews it (the publish gate now demands that reviewer). Their placeholder row draft-faith-1 stays.
--   * ids are deterministic from the code (md5 of 'tarragon-media-library:' || code, as a uuid), so a re-run or another environment gets the same ids.
-- COUNTS: media_library rows before this migration: the 12 structure placeholders from step 1 (none of these codes exists). Rows added: 24.
-- Idempotent: on conflict (code) do nothing. Regenerate with the script described in docs/OPEN-QUESTIONS.md if the draft files change (a later
-- migration should update, never silently overwrite, a script the CMO has already edited).

insert into public.media_library (id, code, kind, title, series, series_position, language, content_status, is_placeholder, is_active, downloadable, script)
select md5('tarragon-media-library:' || v.code)::uuid, v.code, v.kind, v.title, v.series, v.pos, 'en', 'draft', true, false, true, v.script
from (values
  ('med-exams-01', 'meditation', 'Calm before the exam', 'exams', 1,
   jsonb_build_object('narration', $narr$Hello. An exam can make the heart race. That is your body getting ready. It is not a sign that you will fail.
Let us give it a few minutes to settle.
Sit comfortably. Put your notes down.
If you feel dizzy or unwell at any point, stop, open your eyes, and drink some water.
[pause 7s]
Breathe in slowly. [pause 4s] And out, a little longer. [pause 9s]
Again. In. [pause 4s] Out. [pause 9s]
Notice your hands. Your stomach. Your shoulders.
Say to yourself: "I have prepared as well as I could."
[pause 13s]
Even if you do not feel ready, you know more than you think.
[pause 13s]
Now picture yourself walking into the room. You sit down. You take a breath.
You read the first question slowly. You are calm enough to think.
[pause 18s]
If your mind goes blank in the exam, remember this: pause, breathe out slowly, read the question again.
[pause 13s]
Your worth is not one result. You are more than a grade.
[pause 13s]
Breathe in. [pause 4s] And out. [pause 11s]
When you are ready, open your eyes.
Eat something light, drink water, and go well.$narr$::text) || '{"voice_note": "steady, encouraging, never \"you must pass\". Suitable for students and adults sitting professional exams.", "sources": ["S13", "S14"], "estimated_minutes": 3.9, "spoken_word_count": 172, "draft_file": "docs/content/meditations/med-exams-01.md", "needs_clinical_review": true}'::jsonb),
  ('med-grief-01', 'meditation', 'Sitting with a heavy heart', 'grief', 1,
   jsonb_build_object('narration', $narr$Welcome. I am glad you are here.
This is for a heavy heart. Maybe you have lost someone. Maybe you are missing a person, a time, or a way of life.
There is no right way to feel. There is no schedule for grief.
You may feel sadness, anger, numbness, or nothing at all. All of it is allowed.
[pause 9s]
Sit or lie down in a way that feels safe.
If this becomes too much at any point, you can stop. Open your eyes, drink some water, and speak to someone you trust.
[pause 9s]
Let us start with the breath.
Breathe in. [pause 4s] Breathe out slowly. [pause 9s]
Place a hand on your chest, if that feels right.
Feel the warmth of your own hand.
[pause 13s]
Just notice what is here. A heaviness. A tightness. An ache.
You do not need to push it away. You do not need to explain it.
[pause 18s]
Say quietly to yourself: "This is hard. And I am allowed to feel this."
[pause 18s]
Perhaps you notice tears. Let them come, or not. Either way is fine.
[pause 18s]
Grief is a kind of love that has nowhere to go right now.
You can let it sit beside you, like a person on a bench.
You do not have to talk. You can just sit together.
[pause 22s]
Breathe in. [pause 4s] Breathe out. [pause 11s]
Notice your feet on the ground, or your body on the bed.
You are here. You are still here.
[pause 18s]
When you are ready, take a slow breath, and slowly open your eyes.
Be gentle with yourself for the rest of today. Drink water. Eat something small.
If the sadness is not lifting, or you feel you cannot go on, or you have thoughts of harming yourself, please speak to someone right away. Tell a person close to you, or message your care team in the app, or go to the nearest hospital.
You matter. Take care of yourself today.$narr$::text) || '{"voice_note": "very soft, steady, never rushing, no cheerfulness. The fixed care-team and urgent-help note is shown by the app template as well.", "sources": ["S13"], "estimated_minutes": 6.0, "spoken_word_count": 313, "draft_file": "docs/content/meditations/med-grief-01.md", "needs_clinical_review": true}'::jsonb),
  ('med-grief-02', 'meditation', 'Remembering with thanks', 'grief', 2,
   jsonb_build_object('narration', $narr$Welcome. This practice is about remembering someone you miss.
It is not about forgetting, and it is not about moving on. It is about carrying love in a gentle way.
Sit comfortably. Close your eyes if you like.
You can stop at any time.
[pause 9s]
Take a slow breath in. [pause 4s] And out. [pause 9s]
Bring to mind the person you are remembering.
You might see their face. Hear their voice. Remember how they laughed, or how they cooked, or how they walked into a room.
Let whatever comes, come.
[pause 22s]
Now think of one small thing they gave you.
It might be advice. A habit. A joke. A way of doing something.
Notice that you still carry it.
[pause 22s]
If you would like to, say in your mind, or out loud, "Thank you."
[pause 18s]
If there is something unsaid, you can say it now, quietly.
They do not need to answer. You are saying it for you.
[pause 26s]
Notice what is happening in your body. Is your chest warm? Heavy? Both?
Place a hand there.
[pause 18s]
Love and sadness can sit together. That is normal.
[pause 18s]
Breathe in. [pause 4s] And out. [pause 11s]
Slowly bring your attention back to the room. The sounds. The light.
Open your eyes when you are ready.
If you would like, you can do one small thing today in their memory. Cook something they loved. Call someone who knew them. Write one line down.
If grief starts to feel too heavy for too long, please tell your care team. Support is there.$narr$::text) || '{"voice_note": "warm, slow. Pauses are long on purpose. No religious claims, no claims about where the person is now.", "sources": ["S13"], "estimated_minutes": 5.4, "spoken_word_count": 245, "draft_file": "docs/content/meditations/med-grief-02.md", "needs_clinical_review": true}'::jsonb),
  ('med-intro-01', 'meditation', 'A first three minutes', 'intro', 1,
   jsonb_build_object('narration', $narr$Hello, and welcome.
This is a short pause for you. It is only three minutes.
There is nothing to get right. You cannot do this wrong.
Sit somewhere comfortable. A chair, a bed, the edge of a sofa. If you are lying down, that is fine too.
[pause 7s]
Let your hands rest wherever they like.
You can close your eyes. Or you can look softly at one spot on the floor.
[pause 7s]
Now just notice that you are breathing.
You do not need to change it. Your body already knows how.
Breathe in. [pause 4s] Breathe out. [pause 7s]
Notice where you feel the breath most. Maybe the nose. Maybe the chest. Maybe the belly.
Rest your attention there, like resting a hand on a table.
[pause 11s]
Your mind will wander. That is normal. Everyone's does.
Maybe you will think about food, or work, or the light bill. That is fine.
When you notice, just come back to the breath. Gently.
Coming back is the whole practice.
[pause 11s]
Breathe in. [pause 4s] Breathe out. [pause 11s]
Let your shoulders be a little heavier.
Let your jaw be a little softer.
[pause 11s]
One more slow breath. [pause 9s]
When you are ready, open your eyes. Look around the room.
You have just practised something. Well done.
You can come back tomorrow, for the same three minutes.
Meditation is a calm helper. It is not a replacement for care. If something is troubling your health, tell your care team.
Take care of yourself today.$narr$::text) || '{"voice_note": "slow, smiling, welcoming. This is the first session most people hear.", "sources": ["S13"], "estimated_minutes": 4.0, "spoken_word_count": 237, "draft_file": "docs/content/meditations/med-intro-01.md", "needs_clinical_review": true}'::jsonb),
  ('med-intro-02', 'meditation', 'A short body scan', 'intro', 2,
   jsonb_build_object('narration', $narr$Welcome. This is a five minute body scan.
Find a comfortable place to sit or lie down.
If you feel dizzy or uneasy at any point, open your eyes and stop. You can always stop.
[pause 7s]
Take a slow breath in. [pause 4s] And let it go. [pause 7s]
Bring your attention to your feet.
Notice them. The weight of them. Warm, cool, or just there.
You do not have to change anything. Just notice.
[pause 13s]
Let your attention move up to your legs. Your calves. Your knees. Your thighs.
Notice where they touch the chair or the bed.
[pause 13s]
Now your stomach and your lower back.
Notice the small movement of the breath here.
[pause 13s]
Move up to your chest, and your shoulders.
Many of us carry the day in our shoulders. See if they can drop a little.
[pause 13s]
Now your hands and arms. Fingers. Wrists. Elbows.
[pause 13s]
Your neck. Your jaw. Your face.
Let the small muscles around your eyes soften.
Let your forehead be smooth.
[pause 13s]
Now feel your whole body, all at once, resting here.
You are held by the chair, the bed, the floor.
[pause 18s]
If you noticed pain or tightness, that is just information. If it keeps bothering you, mention it to your care team.
Take one more slow breath. [pause 7s]
When you are ready, wiggle your fingers and toes, and open your eyes.
Thank you for giving yourself five minutes.$narr$::text) || '{"voice_note": "unhurried. Leave the pauses long.", "sources": ["S13"], "estimated_minutes": 4.5, "spoken_word_count": 225, "draft_file": "docs/content/meditations/med-intro-02.md", "needs_clinical_review": true}'::jsonb),
  ('med-intro-03', 'meditation', 'Listening to the sounds around you', 'intro', 3,
   jsonb_build_object('narration', $narr$Hello. This session uses something you already have. The sounds around you.
Sit comfortably. Close your eyes if you like.
[pause 7s]
Do not try to make the room quiet. It does not need to be quiet.
In Nigeria, there is rarely silence. A generator. A motorbike. Someone calling a neighbour. A radio. Rain on zinc.
We will let all of it be part of this.
[pause 9s]
First, notice the sound that is loudest right now.
Just listen. You do not need to like it or name it.
[pause 18s]
Now find a sound a little further away.
Maybe it is a voice, a bird, a gate.
[pause 18s]
Now see if you can find the quietest sound. Maybe it is your own breath.
[pause 18s]
Notice that sounds come, and sounds go.
You can listen without having to do anything about them.
[pause 13s]
If your mind starts telling stories about a sound, like "that generator is too loud," just notice the story, and come back to listening.
[pause 18s]
Take a slow breath in. [pause 4s] And out. [pause 7s]
When you are ready, open your eyes.
You listened for four minutes. That was enough.$narr$::text) || '{"voice_note": "curious, light. Works well with a generator hum or street noise in the background.", "sources": ["S13"], "estimated_minutes": 3.9, "spoken_word_count": 180, "draft_file": "docs/content/meditations/med-intro-03.md", "needs_clinical_review": true}'::jsonb),
  ('med-stress-01', 'meditation', 'Letting the shoulders drop', 'stress', 1,
   jsonb_build_object('narration', $narr$Welcome. If today has been heavy, you are in the right place.
This is a five minute practice for when stress is sitting in your body.
Sit or lie down. Let your feet touch the floor if you are sitting.
Stop at any time. You are in charge.
[pause 7s]
Take a breath in through your nose. [pause 4s] Let it out slowly through your mouth. [pause 7s]
Again. In. [pause 4s] And out, a little longer. [pause 9s]
Now bring your attention to your shoulders.
Notice if they are lifted up, close to your ears.
On your next breath in, lift them gently. [pause 4s]
And as you breathe out, let them fall. [pause 9s]
Once more. Lift. [pause 4s] And let go. [pause 9s]
Now notice your hands. Are they clenched? See if they can open.
[pause 11s]
Notice your jaw. Let your teeth part a little.
[pause 11s]
Stress is not a fault. It is what a busy body does when there is a lot to carry.
Right now, for these few minutes, there is nothing you need to fix.
[pause 13s]
Say quietly to yourself: "I am doing what I can."
[pause 11s]
Breathe in. [pause 4s] Breathe out. [pause 9s]
If a worry comes, picture setting it on a table beside you. It will still be there later. You can pick it up when you want to.
[pause 18s]
One more slow breath. [pause 11s]
Open your eyes when you are ready.
If stress feels too big to carry, or it is not easing over many days, please tell your care team. You do not have to manage it alone.$narr$::text) || '{"voice_note": "warm, slightly lower pitch. Never urgent.", "sources": ["S13", "S14"], "estimated_minutes": 5.1, "spoken_word_count": 241, "draft_file": "docs/content/meditations/med-stress-01.md", "needs_clinical_review": true}'::jsonb),
  ('med-stress-02', 'meditation', 'A pause in the go-slow', 'stress', 2,
   jsonb_build_object('narration', $narr$Hello. Please do not use this recording while you are driving. Save it for when you are a passenger, or when you are parked, or at home.
Many of us know the go-slow. Hot afternoon. Horns. Nowhere to go.
You cannot change the traffic. But you can change how your body sits in it.
[pause 7s]
Settle into your seat. Feel the seat holding you.
Let your hands rest on your lap.
[pause 7s]
Breathe in slowly. [pause 4s] Breathe out slowly. [pause 7s]
Notice what your body is doing. Is your stomach tight? Your hands? Your shoulders?
[pause 13s]
Say to yourself: "This is a pause I did not choose. I can rest inside it."
[pause 11s]
Every time you breathe out, let your body sink a little into the seat.
[pause 13s]
You are still going to arrive. A calm body arrives just as fast as a tense one.
[pause 13s]
Look outside, softly. Notice a colour. A shape. A cloud.
Let your eyes rest on it for a moment.
[pause 18s]
One more slow breath in. [pause 4s] And out. [pause 7s]
Thank you for the pause. The road will be there when you return.$narr$::text) || '{"voice_note": "gentle humour allowed, then calm. Suitable for someone stuck in traffic as a passenger. Do NOT use while driving: the intro says so.", "sources": ["S13"], "estimated_minutes": 3.7, "spoken_word_count": 176, "draft_file": "docs/content/meditations/med-stress-02.md", "needs_clinical_review": true}'::jsonb),
  ('med-work-01', 'meditation', 'A reset between tasks', 'work', 1,
   jsonb_build_object('narration', $narr$Hello. This is a three minute reset. You can do it at your desk, in your shop, or in the car park.
Put down whatever is in your hands.
Sit or stand. Let your feet feel the floor.
[pause 7s]
Take one slow breath in. [pause 4s] And out. [pause 7s]
Notice that you have been working hard. Your body has been holding itself up.
Roll your shoulders back, once. [pause 7s]
Let your hands drop and soften.
[pause 7s]
Now ask yourself a simple question: "What is the one thing that matters next?"
Not ten things. Just one.
[pause 18s]
Breathe in. [pause 4s] And out. [pause 9s]
Look away from the screen, or away from the counter. Let your eyes rest on something far away.
[pause 13s]
Let the last task go. It is done. Or it is not yet. Either way, it can wait for one minute.
[pause 11s]
One more slow breath. [pause 9s]
Now go back to your work, with the one next thing in mind.
Drink some water. Thank you for the pause.$narr$::text) || '{"voice_note": "brisk but calm. Good for desk workers and shop owners.", "sources": ["S13", "S14"], "estimated_minutes": 3.3, "spoken_word_count": 157, "draft_file": "docs/content/meditations/med-work-01.md", "needs_clinical_review": true}'::jsonb),
  ('med-work-02', 'meditation', 'Ending the workday', 'work', 2,
   jsonb_build_object('narration', $narr$Welcome. The day is ending. This practice helps you put work down before you go home.
Sit comfortably. If you are on the bus or in a car as a passenger, that is fine too.
Take a long breath in. [pause 4s] And out. [pause 9s]
Think back over the day. Not to judge it. Just to see it, like watching a market from a balcony.
[pause 18s]
What went well today? Even something small. A message answered. A customer helped. A cup of tea.
[pause 18s]
What was hard? Let it show itself without fighting it.
[pause 18s]
Now picture a door. This is the door between work and home.
Imagine placing the day on the work side of the door. The emails. The targets. The worries.
They will be there tomorrow. They do not need to come in with you.
[pause 18s]
Take a breath in. [pause 4s] And out, slowly. [pause 9s]
Let your shoulders drop. Let your jaw soften.
[pause 13s]
Think of one thing you are looking forward to tonight. A meal. A call. A rest.
Let yourself feel that, even a little.
[pause 18s]
When you are ready, open your eyes.
You are allowed to rest. Enjoy your evening.$narr$::text) || '{"voice_note": "unwinding, a little slower toward the end.", "sources": ["S13"], "estimated_minutes": 4.2, "spoken_word_count": 185, "draft_file": "docs/content/meditations/med-work-02.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-story-01', 'sleep_story', 'Rain on the zinc roof, Ibadan', 'sleep', 1,
   jsonb_build_object('narration', $narr$Welcome. This is a story to help you rest.
You do not need to listen to every word. If you fall asleep, that is perfect.
Lie down. Let the bed take your weight.
Take a slow breath in. [pause 9s] And out. [pause 15s]
Imagine a quiet evening in Ibadan. The city is spread over its hills like a soft blanket of rooftops.
You are inside a small house in Mokola. The day has been long, and now it is done.
[pause 15s]
Outside, the sky is turning the colour of warm tea.
You hear the first drops on the zinc roof. Tap. [pause 6s] Tap. [pause 6s] Tap tap.
Then more. Then a steady, gentle rain.
[pause 18s]
The sound fills the room, soft and even, like many small hands patting a drum.
You do not have to do anything. The rain is doing it all.
[pause 18s]
Your bed is clean and warm. The cloth is cool against your skin.
You pull the blanket up, just to your shoulder.
[pause 15s]
In the next room, someone has left a small lamp on. The light is yellow and low.
You can smell the wet earth through the window. That fresh smell after the dust.
[pause 18s]
You breathe it in slowly. [pause 9s] And let it go. [pause 15s]
Somewhere down the street, a gate creaks. A dog barks once and then thinks better of it.
The rain carries on.
[pause 18s]
Your feet feel heavy and warm. Your legs feel heavy and warm.
The rain taps on. [pause 15s]
Your belly rises and falls, slowly, like the tide.
Your shoulders sink into the mattress.
[pause 24s]
The rain on the roof has a rhythm now. Slow. Even. Kind.
You are safe in this room. There is nothing you need to do until morning.
[pause 24s]
You watch the water run down the glass, one drop joining another.
Each drop is a small thought. Each one slides away.
[pause 30s]
Tap. [pause 9s] Tap. [pause 9s] Tap tap tap.
The rain is softer now. The street is quiet.
Your breathing is slow and deep.
[pause 30s]
The night settles over the city like a sheet.
You let yourself drift.
[pause 45s]
Sleep well.
[pause 30s]$narr$::text) || '{"voice_note": "low, slow, almost whispered. Fade the voice gently; leave a long tail of room tone. No jump sounds.", "sources": ["S15"], "estimated_minutes": 10.0, "spoken_word_count": 334, "draft_file": "docs/content/sleep/sleep-story-01.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-story-02', 'sleep_story', 'A slow canoe near Calabar', 'sleep', 2,
   jsonb_build_object('narration', $narr$Welcome. This is a story to help you drift off.
Lie down comfortably. Let your arms rest by your sides.
Breathe in slowly. [pause 9s] Breathe out. [pause 15s]
Picture the late afternoon near Calabar. The air is warm and green.
You are sitting in a small wooden canoe on a calm river.
Someone you trust is paddling quietly behind you. You do not have to do a thing.
[pause 18s]
The water is the colour of weak tea, smooth as glass.
The paddle dips in. [pause 9s] And lifts out. [pause 9s] The ripples spread softly.
[pause 18s]
Along the bank, tall trees lean over the water. The leaves move a little in the breeze.
A bird calls in the distance. Another answers.
[pause 18s]
The light is golden. It lies across the water in long soft lines.
You trail your fingers in the cool river. It feels like silk.
[pause 18s]
A small fishing boat floats by in the distance. The fisherman lifts a hand. You lift yours.
No words are needed.
[pause 18s]
The canoe glides on. The paddle dips. [pause 9s] And lifts. [pause 9s]
You feel the slow rocking in your body. Side to side. Slow, like a cradle.
[pause 24s]
Breathe in the warm air. It smells of wet wood and green leaves.
[pause 15s]
Your arms feel heavy. Your legs feel heavy.
Your jaw is soft. Your forehead is smooth.
[pause 24s]
The sun is lower now. The sky turns peach, then pale pink.
The water takes on the colour of the sky.
[pause 24s]
The paddle dips. [pause 12s] And lifts. [pause 12s]
There is no hurry. There is nowhere you have to be.
[pause 24s]
Somewhere, frogs begin their evening song. Soft, round sounds, like small bells.
[pause 24s]
The canoe drifts into the shade of the trees. It is cool and still.
You rest your head back. The sky above is the deep blue of early night.
[pause 30s]
Your breath is slow. Slow like the river.
Your whole body is quiet.
[pause 45s]
The river carries you gently on.
Sleep well.
[pause 30s]$narr$::text) || '{"voice_note": "slow and flowing, gentle rise and fall in the voice. Nothing frightening: no animals attack, no storms.", "sources": ["S15"], "estimated_minutes": 10.3, "spoken_word_count": 310, "draft_file": "docs/content/sleep/sleep-story-02.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-story-03', 'sleep_story', 'Harmattan evening, Jos', 'sleep', 3,
   jsonb_build_object('narration', $narr$Welcome. This is a story for a cool, quiet night.
Lie down and pull the blanket up. Take a breath in. [pause 9s] And out. [pause 15s]
Imagine an evening in Jos, up on the plateau.
The harmattan has come. The air is dry and cool. The light is soft and hazy.
[pause 15s]
You are inside a small warm room. Outside, the sun is going down behind the hills.
Everything is the colour of honey and dust.
[pause 18s]
You are wearing a soft old cardigan. It smells of home.
A thick blanket is tucked around your feet.
[pause 18s]
Someone has brought you a warm cup of tea. You hold it in both hands.
The steam rises. It smells sweet and gentle.
You take a small sip. [pause 9s] The warmth moves down into your chest.
[pause 24s]
From the window, you can see the rocky hills turning purple.
The air outside is crisp. But in here, it is warm.
[pause 18s]
You feel your toes warming. Then your feet. Then your ankles.
The warmth climbs slowly up your legs.
[pause 24s]
You put the cup down. Your hands are heavy and warm.
The blanket is soft against your chin.
[pause 24s]
In the distance, you hear someone sweeping a yard, the soft brush of a broom.
Swish. [pause 9s] Swish. [pause 9s] It is a slow, steady sound.
[pause 24s]
A light breeze moves the curtain. It brings in the smell of woodsmoke, far away.
[pause 18s]
Breathe in the cool air. [pause 9s] Breathe out the day. [pause 15s]
Your body is sinking into the bed now, as if the bed were made of warm sand.
[pause 30s]
The stars come out over the plateau. There are so many.
They twinkle slowly, one by one.
[pause 30s]
You are warm. You are safe. The night is quiet.
[pause 45s]
Sleep well.
[pause 30s]$narr$::text) || '{"voice_note": "cosy and warm. Cool-air imagery, warm-blanket contrast.", "sources": ["S15"], "estimated_minutes": 9.6, "spoken_word_count": 277, "draft_file": "docs/content/sleep/sleep-story-03.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-story-04', 'sleep_story', 'The farm road after harvest', 'sleep', 4,
   jsonb_build_object('narration', $narr$Welcome. This is a story to carry you towards sleep.
Lie down. Let your body soften. Breathe in. [pause 9s] And out. [pause 15s]
Picture a long, quiet farm road in Benue, late in the afternoon.
The harvest is in. The hard work is done. The air is calm.
[pause 18s]
You are walking slowly, with no load to carry.
The red earth under your feet is warm and soft.
[pause 18s]
On both sides, the fields are golden and brown. Stacks of yam lie in the shade.
The leaves rustle gently.
[pause 18s]
Ahead, a small group of people are sitting under a big tree, sharing a drink and a laugh.
They wave at you. You wave back. You keep walking.
[pause 18s]
Your steps are easy. Left. [pause 6s] Right. [pause 6s]
Each step is slower than the last.
[pause 24s]
The sun is low, and the light is the colour of ripe mango.
Long shadows stretch across the road.
[pause 24s]
Somewhere, a goat bleats. A child laughs, far off.
The sounds are small and kind.
[pause 24s]
You reach a wooden bench by the roadside, under a shady tree.
You sit down. The wood is smooth and warm from the sun.
You lean back and let your arms rest.
[pause 24s]
A soft evening wind comes by. It cools your face.
You breathe it in. [pause 9s] And out. [pause 15s]
[pause 15s]
Your legs feel heavy after the walk. Your back feels held by the bench.
Your eyelids feel heavy.
[pause 30s]
The sky turns from gold to rose to deep blue.
One star appears above the tree. Then another.
[pause 30s]
The sounds of the fields grow quieter.
Everything slows down.
[pause 45s]
You rest here, in the calm of the harvest evening.
Sleep well.
[pause 30s]$narr$::text) || '{"voice_note": "slow, pastoral. Mention of food is light, no hunger imagery.", "sources": ["S15"], "estimated_minutes": 9.2, "spoken_word_count": 265, "draft_file": "docs/content/sleep/sleep-story-04.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-story-05', 'sleep_story', 'The market after closing, Kano', 'sleep', 5,
   jsonb_build_object('narration', $narr$Welcome. This is a gentle story for the end of the day.
Settle into your bed. Breathe in. [pause 9s] And out. [pause 15s]
Imagine the old market in Kano, in the evening, long after the noise has gone.
The traders have packed up. The stalls are covered in cloth.
It is cool and quiet. The sky is soft and orange.
[pause 18s]
You walk slowly down a narrow lane between the stalls. There is no one to hurry you.
The ground is swept clean. The air smells of dust and faint spices.
[pause 18s]
A light breeze lifts the edge of a cloth and lets it fall.
[pause 15s]
A cat sits on a table, washing its paw. It looks at you calmly and then goes back to it.
[pause 18s]
You pass bright bundles of cloth, folded neatly in the half-light.
Blue. Green. Gold. They glow gently.
[pause 24s]
A watchman nods at you from his stool. He is sipping tea. He smiles.
You nod back. Everything is as it should be.
[pause 24s]
You come to a quiet corner, where a low bench stands under an old wall.
You sit down. The stone is cool and smooth.
[pause 18s]
From somewhere far off, you hear a call, long and soft, drifting over the rooftops.
The sound is steady, like a slow wave.
[pause 24s]
Your breath slows to match it. In. [pause 9s] And out. [pause 12s]
Your shoulders are loose. Your hands are open.
[pause 24s]
The sky darkens to violet, and then to deep blue.
The first lights come on, soft and yellow, one by one.
[pause 30s]
The market is asleep now. So are the lanes. So are you, almost.
[pause 45s]
Sleep well.
[pause 30s]$narr$::text) || '{"voice_note": "slow, hushed. The market is empty and peaceful, not busy or noisy.", "sources": ["S15"], "estimated_minutes": 8.4, "spoken_word_count": 260, "draft_file": "docs/content/sleep/sleep-story-05.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-story-06', 'sleep_story', 'A lamp-lit veranda in the Enugu hills', 'sleep', 6,
   jsonb_build_object('narration', $narr$Welcome. This is a story for settling down.
Lie back and let go of the day. Breathe in. [pause 9s] And out. [pause 15s]
Imagine a veranda in the hills near Enugu, at the end of a soft evening.
You are sitting in a wide, comfortable chair. A light blanket lies across your knees.
[pause 18s]
A small lamp glows on the table beside you. The light is warm and low.
Moths drift around it, lazy and quiet.
[pause 18s]
Below the veranda, the valley is full of shadows and soft green.
A few lights twinkle far away, like small stars on the ground.
[pause 24s]
The air is cool and clean. It smells of leaves and earth.
You breathe it in slowly. [pause 9s] And out. [pause 15s]
[pause 15s]
In the garden, crickets begin to sing. A slow, even song.
Chirr. [pause 9s] Chirr. [pause 9s] It rises and falls with the night.
[pause 24s]
Someone in the house is moving about softly. A cup clinks. A door closes.
Home sounds. Safe sounds.
[pause 24s]
You feel the weight of your arms on the chair. The weight of your legs.
You feel the cloth of the blanket, soft against your hands.
[pause 24s]
A cool breeze moves through the trees, and the leaves whisper.
Shhh. [pause 9s] Shhh. [pause 9s]
[pause 18s]
Your thoughts slow down. They drift past like clouds, one after another.
You do not have to hold on to any of them.
[pause 30s]
The lamp flickers gently. The night grows deeper.
Your eyes feel heavy. Your whole body feels heavy and warm.
[pause 36s]
You are right where you need to be.
[pause 45s]
Sleep well.
[pause 30s]$narr$::text) || '{"voice_note": "warm and quiet, close to the microphone. A cosy ending with a long silence.", "sources": ["S15"], "estimated_minutes": 9.2, "spoken_word_count": 244, "draft_file": "docs/content/sleep/sleep-story-06.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-winddown-01', 'sleep_story', 'Winding down in ten steps', 'sleep', 1,
   jsonb_build_object('narration', $narr$Welcome. This is a wind-down for the last ten minutes before bed.
You can do it in bed, or on the edge of it.
Nothing here is a rule. It is a gentle way to tell your body that the day is over.
[pause 12s]
Step one. Put your phone down, or turn the screen face-down. If you are listening to this, that is fine. Lower the brightness.
[pause 12s]
Step two. Dim the lights, if you can. If you have no control of the lights, close your eyes for a moment.
[pause 12s]
Step three. Let go of tomorrow. If something is on your mind, imagine writing it on a piece of paper and leaving it on the table. You can pick it up in the morning.
[pause 24s]
Step four. Take three slow breaths. In through the nose. [pause 6s] Out through the mouth, a little longer. [pause 9s]
In. [pause 6s] Out. [pause 9s]
In. [pause 6s] Out. [pause 12s]
Step five. Unclench your jaw. Let your tongue rest. Let your teeth part.
[pause 18s]
Step six. Let your shoulders sink. Let your arms get heavy.
[pause 18s]
Step seven. Feel your back against the bed. Let it hold you.
[pause 18s]
Step eight. Notice your legs. Let them be heavy and still.
[pause 18s]
Step nine. Listen to the night. A fan. A far-off sound. Your own breath. It is all just background.
[pause 24s]
Step ten. Say softly to yourself, "The day is done."
[pause 30s]
You do not have to try to sleep. Just rest. Sleep comes by itself when you stop chasing it.
[pause 30s]
If you have had trouble sleeping for weeks, or you feel very tired in the day, or someone says you stop breathing in your sleep, please tell your care team. It helps to get it looked at.
Goodnight.
[pause 30s]$narr$::text) || '{"voice_note": "calm coach voice, a little more instruction than a story. Not a medical programme. No promise of sleep.", "sources": ["S15"], "estimated_minutes": 8.0, "spoken_word_count": 276, "draft_file": "docs/content/sleep/sleep-winddown-01.md", "needs_clinical_review": true}'::jsonb),
  ('sleep-winddown-02', 'sleep_story', 'A slow count down through the body', 'sleep', 2,
   jsonb_build_object('narration', $narr$Welcome. This is a slow count to help your body let go.
Lie down. Let your arms rest by your sides.
Take a slow breath in. [pause 9s] And out. [pause 15s]
We will count down from ten. With each number, you will let one part of your body rest.
There is no need to count out loud.
[pause 12s]
Ten. Let your forehead be smooth. [pause 15s]
Nine. Let your eyes be heavy. [pause 15s]
Eight. Let your jaw be loose. [pause 15s]
Seven. Let your neck be soft. [pause 15s]
Six. Let your shoulders drop. [pause 18s]
Five. Let your arms be heavy. [pause 18s]
Four. Let your chest rise and fall by itself. [pause 18s]
Three. Let your belly be soft. [pause 18s]
Two. Let your legs be heavy. [pause 18s]
One. Let your feet be warm and still. [pause 24s]
Now just rest in the quiet.
If your mind wanders, that is okay. Start again at any number.
[pause 30s]
There is nothing to do. Nowhere to go. The day is finished.
[pause 45s]
Breathing in. [pause 9s] Breathing out. [pause 15s]
Goodnight. Rest well.
[pause 30s]$narr$::text) || '{"voice_note": "very slow, hypnotic rhythm but never instructing to \"go deeper\". No claim of treating insomnia.", "sources": ["S15"], "estimated_minutes": 7.4, "spoken_word_count": 155, "draft_file": "docs/content/sleep/sleep-winddown-02.md", "needs_clinical_review": true}'::jsonb),
  ('breath-01', 'breathing', 'Slow belly breathing', 'general', 1,
   jsonb_build_object('narration', $narr$Welcome. This is three minutes of slow breathing.
Sit comfortably, with your back supported. Or lie down.
Rest one hand on your belly.
Before we start, one safety note. If you feel dizzy, light-headed, or tingly, stop. Breathe normally and open your eyes. If it keeps happening, or you ever feel chest pain or trouble breathing, stop and get help from someone near you or your care team. Breathe gently. Never force it.
[pause 5s]
Now. Let your breath be easy.
Breathe in through your nose, and feel your belly rise under your hand. [pause 5s]
Breathe out gently through your mouth, and feel your belly fall. [pause 6s]
In. [pause 5s] Out. [pause 6s]
In. [pause 5s] Out. [pause 6s]
There is no need to take a big breath. A gentle, comfortable breath is enough.
In. [pause 5s] Out. [pause 6s]
In. [pause 5s] Out. [pause 6s]
If your mind wanders, that is normal. Come back to your hand on your belly.
In. [pause 5s] Out. [pause 6s]
In. [pause 5s] Out. [pause 6s]
Let your shoulders drop as you breathe out.
In. [pause 5s] Out. [pause 8s]
Now let your breathing go back to its own pace.
Open your eyes when you are ready.
Well done. You can do this any time of day.$narr$::text) || '{"voice_note": "steady, even pace. Count slowly in the voice so the person can follow.", "sources": ["S14"], "estimated_minutes": 3.6, "spoken_word_count": 182, "draft_file": "docs/content/breathing/breath-01.md", "needs_clinical_review": true}'::jsonb),
  ('breath-02', 'breathing', 'A longer breath out', 'general', 2,
   jsonb_build_object('narration', $narr$Welcome. This is a four minute breathing practice.
Sit comfortably. Let your feet rest on the floor.
Safety first. Breathe gently and never strain. If you feel dizzy, light-headed, or tingly, stop and breathe normally. If it does not pass, or you feel chest pain or short of breath, stop and get help. If you have a lung condition or you are pregnant, or you are not sure this is right for you, ask your care team first.
[pause 5s]
Let us begin.
Breathe in gently through your nose, to a count of four. In, two, three, four. [pause 2s]
Breathe out slowly through your mouth, to a count of six. Out, two, three, four, five, six. [pause 5s]
Again. In, two, three, four. [pause 2s]
Out, two, three, four, five, six. [pause 5s]
If six feels too long, make it five. Whatever feels easy.
In, two, three, four. [pause 2s]
Out, two, three, four, five, six. [pause 5s]
In, two, three, four. [pause 2s]
Out, two, three, four, five, six. [pause 5s]
You may notice your body slowing down.
In, two, three, four. [pause 2s]
Out, two, three, four, five, six. [pause 5s]
In, two, three, four. [pause 2s]
Out, two, three, four, five, six. [pause 5s]
Let your shoulders drop.
Now let go of counting, and just breathe in your own way. [pause 13s]
Open your eyes when you are ready.
Well done.$narr$::text) || '{"voice_note": "calm and measured. The out-breath is slightly longer than the in-breath, but comfortable.", "sources": ["S14"], "estimated_minutes": 3.3, "spoken_word_count": 207, "draft_file": "docs/content/breathing/breath-02.md", "needs_clinical_review": true}'::jsonb),
  ('breath-03', 'breathing', 'Five in, five out', 'general', 3,
   jsonb_build_object('narration', $narr$Welcome. This is five minutes of simple breathing.
Sit or lie down in a comfortable way.
A note for your safety. Breathe gently. If you feel dizzy, light-headed, or your hands tingle, stop and breathe normally. If it does not settle, or you have chest pain or trouble breathing, stop and get help from someone close by or your care team.
[pause 5s]
Let your belly be soft.
Breathe in through your nose, counting gently to five. One, two, three, four, five. [pause 2s]
Breathe out through your mouth, counting to five. One, two, three, four, five. [pause 3s]
Again. In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
You do not need to breathe deeply. Just evenly.
In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
If your mind wanders, bring it back to the counting.
In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
Notice how your shoulders feel.
In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
In. One, two, three, four, five. [pause 2s]
Out. One, two, three, four, five. [pause 3s]
Now let go of the counting. Breathe in your own way. [pause 16s]
Open your eyes when you are ready.
Thank you for taking this time.$narr$::text) || '{"voice_note": "even, quiet counting. Based on the common five-count pattern; the script is original wording.", "sources": ["S14"], "estimated_minutes": 3.5, "spoken_word_count": 226, "draft_file": "docs/content/breathing/breath-03.md", "needs_clinical_review": true}'::jsonb),
  ('breath-04', 'breathing', 'Desk breaks: breathe and soften', 'general', 4,
   jsonb_build_object('narration', $narr$Hello. This is a short breathing break for the middle of a busy day. Please do not do it while driving or using machinery.
Sit upright in your chair. Let your feet rest on the floor.
As always, breathe gently. If you feel dizzy or light-headed, stop and breathe normally. If you feel chest pain or trouble breathing, stop and get help.
[pause 5s]
Put your hands on your lap.
Breathe in slowly through your nose. [pause 5s]
Breathe out slowly through your mouth. [pause 6s]
Now do it again, and as you breathe out, let your shoulders fall. [pause 6s]
Again. In. [pause 5s] Out, and drop the shoulders. [pause 6s]
Now unclench your jaw. Let your tongue rest.
In. [pause 5s] Out. [pause 6s]
Look at something far from you, across the room or out of the window.
In. [pause 5s] Out. [pause 6s]
One more. In. [pause 5s] Out. [pause 8s]
Stretch your arms up gently, and then let them fall.
You are ready to go back. Take a sip of water.$narr$::text) || '{"voice_note": "practical, light. Sitting only. Not while driving.", "sources": ["S14"], "estimated_minutes": 2.8, "spoken_word_count": 151, "draft_file": "docs/content/breathing/breath-04.md", "needs_clinical_review": true}'::jsonb),
  ('breath-05', 'breathing', 'Breathing before sleep', 'general', 5,
   jsonb_build_object('narration', $narr$Welcome. This is a gentle breathing practice for bedtime.
Lie down in bed. Let your eyes close if you like.
Breathe gently. Never force a breath. If you feel dizzy or tingly, stop and breathe normally. If you ever feel chest pain or trouble breathing, stop and get help.
[pause 6s]
Rest your hands on your belly, or by your sides.
Breathe in slowly through your nose. [pause 6s]
Breathe out slowly, through your nose or mouth, whichever feels easier. [pause 10s]
In. [pause 6s] Out. [pause 10s]
Let the out-breath be a little longer, like a sigh. [pause 10s]
In. [pause 6s] Out, long and soft. [pause 10s]
With each breath out, feel yourself sinking into the bed. [pause 10s]
In. [pause 6s] Out. [pause 10s]
Your arms are heavy. Your legs are heavy. [pause 10s]
In. [pause 6s] Out. [pause 10s]
If a thought comes, let it float past. Come back to your breathing. [pause 10s]
In. [pause 6s] Out. [pause 13s]
Now stop counting, and let your breath breathe itself. [pause 24s]
Goodnight.
If you have had trouble sleeping for a long time, tell your care team.$narr$::text) || '{"voice_note": "slow, warm, sleepy. Sections with long pauses.", "sources": ["S14", "S15"], "estimated_minutes": 4.5, "spoken_word_count": 154, "draft_file": "docs/content/breathing/breath-05.md", "needs_clinical_review": true}'::jsonb),
  ('breath-06', 'breathing', 'Settling after a hard conversation', 'general', 6,
   jsonb_build_object('narration', $narr$Welcome. Sometimes a hard conversation leaves us shaky. This is a few minutes to settle.
Sit down if you can. Put your feet on the floor.
Breathe gently, and do not force it. If you feel dizzy, light-headed, or tingly, stop and breathe normally. If you feel chest pain or trouble breathing, or you are afraid you may harm yourself, stop, and get help from someone near you or your care team straight away.
[pause 5s]
First, just notice that you are shaken. That is okay. It makes sense.
Place a hand on your chest. Feel it rising and falling.
[pause 8s]
Breathe in slowly through your nose. [pause 5s]
Breathe out slowly through your mouth. [pause 6s]
In. [pause 5s] Out, a little longer. [pause 8s]
Feel your feet on the floor. Press them down gently.
In. [pause 5s] Out. [pause 8s]
Look around the room. Name three things you can see. A table. A cup. A wall. [pause 10s]
In. [pause 5s] Out. [pause 8s]
Say to yourself, "That was hard. I am okay right now." [pause 10s]
In. [pause 5s] Out. [pause 10s]
Drink some water when you can.
You do not have to decide anything right now. Take one more slow breath and open your eyes. [pause 6s]
Be gentle with yourself.$narr$::text) || '{"voice_note": "kind and steady. For after a quarrel, hard news, or a busy bus ride.", "sources": ["S14"], "estimated_minutes": 3.8, "spoken_word_count": 186, "draft_file": "docs/content/breathing/breath-06.md", "needs_clinical_review": true}'::jsonb)
) as v(code, kind, title, series, pos, script)
on conflict (code) do nothing;

do $$
begin
  if (select count(*) from public.media_library where script ->> 'narration' is not null and script ->> 'needs_clinical_review' = 'true') < 24 then
    raise exception 'FAIL: the 24 draft narration scripts were not all seeded';
  end if;
  if exists (select 1 from public.media_library where script ->> 'needs_clinical_review' = 'true'
              and (content_status <> 'draft' or is_active or not is_placeholder or reviewed_by_name is not null or reviewed_at is not null
                   or audio_url is not null or audio_clip_id is not null)) then
    raise exception 'FAIL: a seeded draft script is approved, live, reviewed or has audio';
  end if;
  if exists (select 1 from public.media_library where script ->> 'needs_clinical_review' = 'true'
              and private.media_is_servable(is_active, content_status, is_placeholder, next_review_due)) then
    raise exception 'FAIL: a seeded draft script is servable';
  end if;
  if exists (select 1 from public.media_library where script ->> 'needs_clinical_review' = 'true' and series = 'faith_reflection') then
    raise exception 'FAIL: a faith-compatible script was seeded by the build';
  end if;
end $$;
