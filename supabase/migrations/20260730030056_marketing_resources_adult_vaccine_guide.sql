-- Tarragon Health — vaccine-by-vaccine adult immunisation reference article
-- for /resources.
--
-- 'adult-vaccines-you-might-be-missing' (already live) is a narrative piece
-- about commonly-missed gaps. This is a different, complementary shape: a
-- structured, vaccine-by-vaccine reference (what it protects against, dosing
-- interval, who counts as higher-risk) — the format requested after
-- reviewing an external vaccination-clinic reference page for information
-- architecture only; all copy below is written fresh in Tarragon's own
-- voice, not copied.
--
-- Dosing details are pulled from what public.vaccination_catalog already
-- tracks (seed.sql + 20260719142000_additional_adult_vaccines.sql +
-- 20260724024110_who_tetanus_childhood_booster_series.sql), so this article
-- stays consistent with the platform's own vaccination registry/reminder
-- engine rather than asserting different numbers. HPV catch-up age is
-- deliberately left general (the catalogue's `max_catch_up_age: 26` and the
-- sibling article's "up to 45" text disagree, and neither is confirmed with
-- NPHCDA per that migration's own [LOCALISE] note) — this article says "ask
-- your doctor" rather than asserting either figure.

insert into public.marketing_resources
  (slug, title, description, category, read_minutes, related_href, related_label, sections, is_published, sort_order)
values
(
  'which-vaccines-do-adults-need-and-when',
  'Which vaccines do adults need, and when?',
  'A vaccine-by-vaccine guide for adults: what each one protects against, how often it repeats, and who counts as higher-risk.',
  'Screening',
  6,
  '/prevention',
  'Preventive care at Tarragon',
  '[
    {
      "heading": "Why vaccination isn''t just a childhood milestone",
      "paragraphs": [
        "Most people think of vaccines as something finished by the time school starts. In reality, a handful of vaccines wear off over the decades, and adult life adds new exposure altogether, through work, travel, age, or simply being around more people. A vaccination record that follows you from childhood into adulthood as one continuous history, rather than two separate, half-remembered lists, is what actually lets a gap get noticed.",
        "Below is what each commonly needed adult vaccine protects against, how often it repeats, and who benefits most from getting it sooner rather than later."
      ]
    },
    {
      "heading": "Tetanus and Td: the booster almost everyone has let lapse",
      "paragraphs": [
        "Tetanus usually enters through a wound, a rusty nail, a farm injury, a deep cut, and childhood protection does not last a lifetime: a booster is needed roughly every ten years. Because the interval is so long, this is probably the single most commonly overdue adult vaccine, and most people genuinely could not say when their last dose was.",
        "Farmers, construction and factory workers, and anyone who regularly handles soil, metal or machinery carry more day-to-day wound risk and are worth confirming as current rather than assumed. A deep or dirty wound more than five years after your last dose is worth raising with a doctor that same week, not at your next routine visit."
      ]
    },
    {
      "heading": "Hepatitis B: a three-dose series worth confirming, not assuming",
      "paragraphs": [
        "Hepatitis B protection comes from a series of three doses, typically at the start, one month later, and six months later, not a single shot. Because doses are sometimes given at different clinics over the years with no shared record between them, an incomplete series is a common, invisible gap: someone can genuinely believe they are protected and not be.",
        "Healthcare workers, people with multiple sexual partners, and anyone living with someone who carries hepatitis B face higher exposure and are worth confirming a complete series for specifically. A simple blood test can also check whether you are already immune, before deciding whether any further doses are even needed."
      ]
    },
    {
      "heading": "HPV: catch-up doses for anyone who missed the school-age programme",
      "paragraphs": [
        "HPV vaccination is offered free at government primary health centres to girls aged 9 to 14 in Nigeria, timed ahead of likely exposure. Missing that window does not close the door, though: catch-up dosing remains available well beyond adolescence for those who ask, and it still meaningfully lowers the risk of the cancers HPV causes, cervical cancer most prominently.",
        "If you are past your teenage years and never received this vaccine, or are unsure whether you did, that is worth a direct question to a doctor about what catch-up options apply to you, rather than assuming the moment has passed."
      ]
    },
    {
      "heading": "Travel, exposure and outbreak vaccines",
      "paragraphs": [
        "Yellow fever is typically a single, lifelong dose, and proof of vaccination is a genuine entry requirement for travel to and from certain countries, worth checking well before you book rather than the week you fly. Typhoid and hepatitis A are recommended by risk and destination rather than for everyone: frequent travellers, people eating and drinking where water and food safety are less reliable, and higher-exposure occupations are the groups who benefit most. Hepatitis A is a two-dose series six months apart; typhoid is usually a single dose, and both are worth arranging four to six weeks before travel where possible, since that is roughly how long full protection takes to build.",
        "Meningococcal vaccination is not part of routine adult care for most people; it matters most during a local outbreak, in higher-risk meningitis-belt seasons, or where a specific destination requires it. If none of those apply to you, it is not something to seek out on its own, but it is worth knowing exists if your circumstances change."
      ]
    },
    {
      "heading": "Influenza and COVID-19: annual doses, and who benefits most",
      "paragraphs": [
        "Both influenza and COVID-19 vaccines are typically given on a roughly yearly basis, since the viruses shift and protection fades over the year. Either is optional for a healthy adult, but the benefit is clearest for people over 60, anyone with a chronic condition such as diabetes, hypertension or lung disease, and healthcare workers in frequent contact with people who are more vulnerable.",
        "If you fall into one of those groups, this is one of the lowest-effort, lowest-cost things you can do each year to reduce a serious illness landing on top of an existing condition."
      ]
    },
    {
      "heading": "Pneumococcal and shingles: two vaccines that start later in life",
      "paragraphs": [
        "Pneumococcal vaccination protects against a common cause of pneumonia and is generally recommended from age 65, or earlier for anyone with a chronic illness that raises their risk. Shingles, caused by the same virus as chickenpox reactivating later in life, is prevented by a genuine two-dose series, spaced two to six months apart, starting from age 50; a single dose alone does not complete the protection.",
        "Both are easy to overlook precisely because they only become relevant later in life, well after most people have stopped thinking about vaccines as something they still need."
      ]
    },
    {
      "heading": "The point of keeping one record",
      "paragraphs": [
        "None of this needs to live in your memory. The value of tracking vaccination properly is that gaps like these surface on their own: a due booster shows up before it becomes overdue, a completed series stops nagging you, and a doctor reviewing your record sees the full picture instead of piecing it together from what you can recall at each visit."
      ]
    }
  ]'::jsonb,
  true,
  69
)
on conflict (slug) do nothing;
