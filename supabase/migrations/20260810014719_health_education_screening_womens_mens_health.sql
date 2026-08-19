-- Tarragon Health — Health Education library expansion: cancer screening,
-- women's health, and men's health. These are pure browse categories
-- (condition mostly null) — the point is a patient can choose to read about
-- them out of interest, not only if a matching chronic diagnosis is on file.
-- Same honesty rule as the previous batch: clinician_reviewed left at its
-- default false, no fabricated reviewed_by_name/reviewed_at.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

-- ============================================================================
-- Cancer & preventive screening
-- ============================================================================
('screen-breast-cancer', 'Breast cancer screening: what to expect and when',
 'Mammograms and clinical exams explained, and typical starting ages.',
 E'Breast cancer screening aims to catch changes before they can be felt, when treatment tends to be most effective. It typically combines a clinical breast exam by a professional with imaging (mammogram) from a certain age or risk level, which your care team can advise based on your own history.\n\nA mammogram itself takes only a few minutes and involves brief compression of breast tissue to get a clear image — uncomfortable for some, but brief.\n\nAn abnormal-looking screening result is common and does not mean cancer — most callbacks lead to a clearer picture, not a diagnosis. Your screening calendar in the app is built around your age and history so you know when you are due.',
 'article', 4, null, 'cancer_screening', 10, null),

('screen-cervical-cancer', 'Cervical cancer screening: what it involves',
 'Pap smear and HPV testing, in plain terms, and why this screening is unusually effective.',
 E'Cervical cancer screening (a Pap smear, sometimes paired with an HPV test) looks for early cell changes on the cervix, years before they could develop into cancer — which is part of why this particular screening has been so effective at reducing cervical cancer rates where it is widely used.\n\nThe test itself is brief: a small sample of cells is gently collected during a short exam. It can be uncomfortable but is not usually painful, and takes only a few minutes.\n\nMost abnormal results reflect minor, common changes that resolve on their own or need simple monitoring, not cancer. Your care team will explain exactly what any result means for you and what, if anything, happens next.',
 'article', 4, null, 'cancer_screening', 20, null),

('screen-hpv-vaccine', 'The HPV vaccine: what it protects against',
 'A vaccine that prevents the infection behind most cervical cancer cases.',
 E'HPV (human papillomavirus) is a very common infection, and certain types are the main cause of cervical cancer, along with a share of some other cancers. The HPV vaccine protects against the types responsible for most of these cases.\n\nIt works best given before exposure to HPV, which is why it is often recommended in the pre-teen or teen years, though catch-up vaccination is available for older people too — ask your care team what applies to you or your child.\n\nThe vaccine does not replace cervical screening later in life; the two work together, one preventing infection, the other catching any changes that still occur.',
 'article', 3, null, 'cancer_screening', 30, null),

('screen-prostate-conversation', 'Prostate cancer screening: the conversation to have',
 'Why this screening decision is more personal than most, and what it involves.',
 E'Prostate cancer screening, usually a blood test called PSA sometimes alongside a physical exam, is one where the decision to test is genuinely more personal than most screenings — it depends on your age, family history, and how you feel about the trade-offs, which your care team should walk through with you rather than apply as a blanket rule.\n\nThe reason: an elevated PSA can come from prostate cancer, but also from non-cancerous causes, so results are not always straightforward, and screening carries real trade-offs worth understanding before testing, not after an unexpected result.\n\nIf you are approaching the age where this becomes relevant, or have a family history, raise it with your care team so you can make an informed decision together.',
 'article', 4, null, 'cancer_screening', 40, null),

('screen-colorectal-cancer', 'Colorectal cancer screening: signs and when to start',
 'What changes are worth mentioning, and why earlier screening ages are becoming more common.',
 E'Colorectal (bowel) cancer often develops slowly from polyps that screening can catch and remove before they become cancer at all — which makes this one of the more preventable cancers when caught through screening.\n\nSymptoms worth mentioning to your care team, especially if new and persistent: a change in bowel habits lasting more than a couple of weeks, blood in the stool, unexplained weight loss, or persistent abdominal discomfort. Most of these have far more common, non-cancer explanations — but they are worth checking rather than assuming.\n\nScreening recommendations vary by risk and family history, and ages are trending earlier in many guidelines — ask your care team what applies to you.',
 'article', 4, null, 'cancer_screening', 50, null),

('screen-skin-checks', 'Skin checks: what to look for',
 'The ABCDE rule for spotting a mole worth getting checked.',
 E'Most skin marks are completely harmless, but it helps to know what is worth a second look. The ABCDE rule is a simple guide: Asymmetry (one half looks different from the other), Border (irregular or blurred edges), Colour (uneven, or multiple colours in one mark), Diameter (larger than about a pencil eraser), and Evolving (changing in size, shape or colour over time).\n\nA new mark that appears suddenly in someone past mid-life, or any mark that itches, bleeds, or will not heal, is also worth mentioning.\n\nMost checked marks turn out to be nothing serious. The goal of checking early is exactly that reassurance, or catching the rare exception while it is easiest to treat.',
 'article', 3, null, 'cancer_screening', 60,
 '[{"question": "What does the ''E'' in the ABCDE skin check stand for?", "options": ["Extra pigmentation", "Evolving — changing over time", "Elevated above the skin"], "answer_index": 1}]'::jsonb),

('screen-what-abnormal-means', 'What an abnormal screening result actually means',
 'A callback is far more often reassurance in disguise than a diagnosis.',
 E'Hearing "your screening result needs a closer look" understandably raises anxiety immediately. It helps to know what that phrase usually means in practice: screening tests are deliberately built to be sensitive, catching anything that might be worth a second look — which means they also flag a good number of things that turn out to be completely normal on closer inspection.\n\nA callback for more testing is a normal, expected part of how screening works, not a sign that something is definitely wrong. The follow-up test — often more detailed or more specific — is what actually clarifies the picture.\n\nIf you get a callback, it is completely reasonable to ask your care team directly what the range of likely outcomes is, so the wait feels less like the worst-case default.',
 'article', 3, null, 'cancer_screening', 70, null),

('screen-breast-self-exam', 'Breast self-awareness: what''s normal, what''s not',
 'Getting familiar with your own normal is more useful than a rigid monthly ritual.',
 E'Rather than a strict monthly checklist, the more useful habit is simply getting familiar with how your own breasts normally look and feel, so a genuine change stands out.\n\nWorth mentioning to your care team: a new lump or thickening, a change in size or shape, skin dimpling or puckering, nipple changes (including discharge, unless you are breastfeeding), or persistent pain in one specific spot.\n\nMost breast changes, including most lumps, are not cancer — cysts and fibrous tissue changes are common and often harmless. But any new, persistent change is worth getting checked rather than watched indefinitely on your own.',
 'article', 3, null, 'cancer_screening', 80, null),

('screen-family-history-earlier', 'Family history and screening: when to start earlier',
 'A close relative''s early diagnosis can move your own screening age forward.',
 E'Standard screening ages are built around average risk. If a close relative — a parent, sibling, or child — was diagnosed with certain cancers, especially at a younger-than-typical age, your own screening may reasonably start earlier or happen more often.\n\nThis applies most clearly to breast, colorectal, and some other cancers with a stronger hereditary pattern. It does not mean you will develop the same condition — it means your risk profile is different enough from average to plan around.\n\nIf you know of this kind of family history, make sure it is on your record here, even if nobody has specifically asked recently — it directly shapes your personal screening calendar.',
 'article', 3, null, 'cancer_screening', 90, null),

('screen-hepatitis-liver', 'Hepatitis B and C: why liver screening matters here',
 'Common, often silent infections that a simple blood test can catch early.',
 E'Hepatitis B and C are viral infections that can silently damage the liver over years, and both are more common in Nigeria than in many other regions — which is part of why liver-related screening is a genuinely relevant topic here specifically.\n\nBoth can be present for years with no symptoms at all, discovered only through a blood test. Hepatitis B has an effective vaccine; hepatitis C does not, but has effective treatment once found.\n\nIf you have never been tested, or do not know your status, it is a reasonable, simple test to ask your care team about — especially if you have a family history of liver disease or hepatitis.',
 'article', 3, null, 'cancer_screening', 100, null),

('screen-oral-cancer', 'What doctors and dentists check for in your mouth',
 'A quick, often-overlooked part of a regular check-up.',
 E'A quick look inside the mouth during a check-up is looking for more than cavities. Persistent mouth sores that will not heal, unexplained white or red patches, or a lump that does not go away are things a doctor or dentist checks for as part of routine care.\n\nTobacco use in any form (including chewing tobacco) and heavy alcohol use both raise risk meaningfully, and combined raise it further — one more reason both are worth discussing with your care team if they apply to you.\n\nMost mouth changes are minor and heal on their own. Anything unusual lasting more than two to three weeks is worth mentioning rather than waiting it out.',
 'article', 3, null, 'cancer_screening', 110, null),

('screen-lung-cancer-who', 'Lung cancer screening: who it''s generally for',
 'A targeted screening, not a universal one — mainly relevant with a significant smoking history.',
 E'Unlike breast or cervical screening, lung cancer screening (a low-dose CT scan) is not typically recommended for everyone — it is generally aimed at people with a significant smoking history, particularly those who smoked heavily over many years, whether currently or in the past.\n\nIf that description applies to you, it is worth asking your care team whether screening makes sense for your specific history, rather than assuming it does or doesn''t apply.\n\nWhatever your screening status, a persistent cough lasting more than three weeks, coughing up blood, or unexplained weight loss are worth mentioning to your care team regardless of screening eligibility.',
 'article', 3, null, 'cancer_screening', 120, null),

('screen-your-risk-factors', 'Understanding your personal cancer risk factors',
 'Age, family history, and lifestyle each play a role — none of them alone decides the outcome.',
 E'Cancer risk is shaped by several things together: age (risk generally rises over time for most cancers), family and genetic history, and lifestyle factors like smoking, alcohol, diet, weight and sun exposure.\n\nHaving a risk factor does not mean cancer is inevitable, and having none does not mean it is impossible — screening exists precisely because risk is a spectrum, not a guarantee in either direction.\n\nWhat you can act on: the lifestyle factors are the ones within your control, and staying current with the screenings that match your age and history is the most effective response to the factors that aren''t.',
 'article', 3, null, 'cancer_screening', 130, null),

('screen-coping-with-callback', 'Coping with a screening callback',
 'The waiting period is genuinely hard — a few things that help.',
 E'Being called back after a screening test for more investigation is one of the more anxious waits in healthcare, and it is completely normal to feel that. It helps to remember that callbacks are a routine, expected part of how screening is designed to work, and most resolve as nothing serious.\n\nA few things that help through the wait: ask your care team directly what the realistic range of outcomes is, rather than filling the gap with worst-case guessing; bring someone with you to the follow-up appointment if that helps you take in information; and know that "needs more testing" is a different, much more common category than "cancer confirmed."\n\nHowever it resolves, you are not waiting alone — your care team is available for questions the whole way through.',
 'article', 3, null, 'cancer_screening', 140, null),

-- ============================================================================
-- Women's health
-- ============================================================================
('women-menstrual-cycle', 'Understanding your menstrual cycle',
 'What''s actually happening hormonally, and what counts as a "normal" range.',
 E'A typical cycle runs anywhere from about 21 to 35 days, counted from the first day of one period to the first day of the next — there is a wide normal range, not one universal number.\n\nHormones rise and fall through the cycle to prepare and then shed the uterine lining if pregnancy does not occur. This is also why mood, energy, skin and appetite can shift predictably through the month for many people — it is a real hormonal pattern, not "just in your head."\n\nTracking your cycle here, even roughly, makes it much easier for you and your care team to spot when something has genuinely changed versus normal month-to-month variation.',
 'article', 4, null, 'womens_health', 10, null),

('women-irregular-periods', 'Irregular periods: when to get it checked',
 'Occasional variation is normal — a pattern of irregularity is worth investigating.',
 E'A period arriving a few days early or late occasionally is normal and usually not worth worrying about — stress, travel, illness and weight changes can all shift a single cycle.\n\nWorth checking with your care team: periods consistently outside the typical 21–35 day range, periods that stop for three months or more (without pregnancy or menopause), bleeding between periods, or periods that become dramatically heavier or more painful than your normal.\n\nCommon causes include hormonal shifts, PCOS, thyroid changes, or stress — most are manageable once identified. Tracking your cycle here helps turn "it feels off" into a clear pattern your care team can actually act on.',
 'article', 3, null, 'womens_health', 20, null),

('women-pcos-explained', 'PCOS explained',
 'A common hormonal condition affecting periods, skin, and fertility — very manageable once identified.',
 E'PCOS (polycystic ovary syndrome) is a common hormonal condition, affecting a significant share of women of reproductive age. It can show up as irregular periods, acne, excess hair growth, weight changes, and difficulty conceiving — though the specific combination varies a lot between people, and not everyone has all of these.\n\nIt is diagnosed through a combination of symptoms, blood tests, and sometimes an ultrasound — no single test confirms it alone.\n\nPCOS is very manageable, though not curable: treatment is tailored to what matters most to you personally, whether that is regulating periods, managing skin symptoms, supporting fertility, or a combination — which is why the conversation with your care team about priorities matters as much as the diagnosis itself.',
 'article', 4, null, 'womens_health', 30,
 '[{"question": "Is PCOS diagnosed with one single test?", "options": ["Yes, always a blood test alone", "No, a combination of symptoms and tests", "Yes, always an ultrasound alone"], "answer_index": 1}]'::jsonb),

('women-fertility-basics', 'Fertility basics: what affects it',
 'Age, timing, and health conditions all play a role — understanding the basics helps planning.',
 E'Fertility is influenced by several things together: age (fertility gradually declines over time, more noticeably from the mid-30s for many people), overall health conditions like PCOS or thyroid issues, weight, and simply the timing of intercourse relative to ovulation, which typically occurs roughly midway through a cycle.\n\nIf you are trying to conceive, tracking your cycle helps identify your fertile window more accurately than guessing.\n\nIf you have been trying for a year without success (or six months if you are over 35), that is a reasonable point to talk to your care team rather than waiting longer — many fertility factors are very treatable once identified, and earlier evaluation gives more options.',
 'article', 4, null, 'womens_health', 40, null),

('women-preconception-health', 'Preparing your body before pregnancy',
 'A few specific steps in the months before trying to conceive make a real difference.',
 E'If you are planning a pregnancy, a few specific steps in the months beforehand genuinely improve outcomes. Starting a folic acid supplement before conception, not just after a positive test, meaningfully reduces certain birth defect risks — this is one of the most evidence-backed preconception steps there is.\n\nOther worthwhile steps: getting chronic conditions like diabetes or high blood pressure well controlled beforehand, reviewing any regular medicines with your care team (some need adjusting before pregnancy), and catching up on any due vaccinations.\n\nIt is also a good time to raise any family history or personal health concerns with your care team, so the pregnancy itself starts from the clearest possible picture.',
 'article', 3, null, 'womens_health', 50, null),

('women-pregnancy-first-trimester', 'Pregnancy: the first trimester essentials',
 'What''s typical in the early weeks, and the appointments worth not delaying.',
 E'The first trimester (roughly weeks 1–12) is when many of the foundational pregnancy checks happen, even though it can be a quiet time symptom-wise for some, and an intense one (nausea, fatigue) for others — both are normal ranges.\n\nBooking your first antenatal appointment early, rather than waiting, matters: it is when baseline blood tests, dating, and risk screening typically happen, and earlier identification of any issue generally means more options to address it.\n\nContinuing (or starting) folic acid, avoiding alcohol and smoking, and mentioning any regular medicines to your care team for a pregnancy-safety review are the practical essentials of this stage.',
 'article', 4, null, 'womens_health', 60, null),

('women-pregnancy-warning-signs', 'Pregnancy warning signs that need urgent care',
 'Most pregnancy symptoms are ordinary discomforts — a specific short list is not.',
 E'Most of what pregnancy brings — nausea, fatigue, aches — is uncomfortable but ordinary. A specific, shorter list of signs is different, and warrants urgent care rather than waiting for a routine appointment: heavy vaginal bleeding, severe abdominal pain, a severe headache that does not ease with rest or usual pain relief, sudden vision changes, severe swelling in the face or hands, reduced or absent baby movement after the point you would normally feel it, or fever.\n\nThese signs can point to serious but very treatable complications when caught early. If any of them apply, contact your care team or go to emergency care immediately rather than waiting to see if it passes — this is exactly the kind of situation where acting promptly makes the difference.',
 'article', 3, null, 'womens_health', 70,
 '[{"question": "You notice reduced baby movement compared to normal. What should you do?", "options": ["Wait until your next scheduled appointment", "Contact your care team promptly, don''t wait", "Only worry if it happens for a week"], "answer_index": 1}]'::jsonb),

('women-postpartum-recovery', 'Postpartum recovery: physical and emotional',
 'Recovery takes longer than the six-week mark most people expect — and the emotional side is just as real.',
 E'Physical recovery after birth genuinely extends well beyond the commonly cited six-week mark, especially for the pelvic floor, abdominal muscles, and if there was a caesarean, the surgical site. Rest, gradual return to activity, and attending your postpartum check-up matter more than rushing back to "normal."\n\nEmotionally, mood changes in the first couple of weeks ("baby blues") are common and usually settle on their own. What is different, and worth reporting to your care team promptly, is persistent low mood, anxiety, or difficulty bonding lasting beyond two weeks, or any thoughts of harming yourself or the baby — postpartum depression and anxiety are common, treatable, and nothing to be ashamed of.\n\nAsking for practical and emotional support in this period is a sign of good planning, not a failure to cope.',
 'article', 4, null, 'womens_health', 80, null),

('women-breastfeeding-basics', 'Breastfeeding basics and common challenges',
 'Latch, supply, and the challenges that have real solutions.',
 E'A good latch — the baby taking in enough of the areola, not just the nipple — is the foundation of comfortable, effective breastfeeding, and is worth getting help with early if it feels wrong, rather than pushing through pain.\n\nWorries about milk supply are extremely common, but true low supply is less common than the worry itself — frequent feeding, particularly in the first weeks, is usually what builds and maintains supply.\n\nCommon challenges — soreness, engorgement, blocked ducts — usually have straightforward fixes with the right guidance. If breastfeeding is causing ongoing pain, or you are worried about your baby''s feeding or weight gain, ask your care team for support early rather than struggling alone.',
 'article', 3, null, 'womens_health', 90, null),

('women-contraception-options', 'Contraception options explained',
 'The main categories, and how to think about which fits your life.',
 E'Contraception broadly falls into a few categories: hormonal methods (pills, injections, implants, hormonal IUDs), non-hormonal methods (copper IUD, condoms, natural family planning), and permanent methods (sterilisation) for those certain they want no future pregnancies.\n\nEach category has real trade-offs in effectiveness, how much daily effort it takes, side effects, and reversibility — there is no single "best" option, only the best fit for your health, life stage, and priorities right now.\n\nThis is a genuinely personal decision worth a real conversation with your care team rather than picking from a list alone — they can walk through what fits your specific health history and what you are optimising for.',
 'article', 4, null, 'womens_health', 100, null),

('women-menopause-what-to-expect', 'Menopause: what to expect',
 'The transition is usually gradual, not sudden — and highly individual.',
 E'Menopause is officially marked by twelve months without a period, but the transition leading up to it (perimenopause) is often gradual, sometimes lasting several years, with irregular periods and shifting symptoms along the way.\n\nCommon symptoms include hot flushes, night sweats, sleep disruption, mood changes, and vaginal dryness — though the combination and intensity vary enormously between people; some notice very little.\n\nMenopause is a normal life stage, not a medical problem to fix, but the symptoms are very treatable if they are affecting your quality of life — there is no need to simply endure them if they are disruptive. Talk to your care team about what is bothering you most.',
 'article', 4, null, 'womens_health', 110, null),

('women-menopause-symptom-management', 'Managing menopause symptoms',
 'Practical options, from lifestyle adjustments to medical treatment.',
 E'A range of approaches can ease menopause symptoms, and most people benefit from combining a few. For hot flushes: dressing in layers, identifying personal triggers (caffeine, alcohol, spicy food, stress are common ones), and cooling strategies at night. For sleep: a consistent routine and a cool bedroom help meaningfully.\n\nFor symptoms significantly affecting daily life, hormone therapy and other medical treatments are genuinely effective options for many people — worth discussing directly with your care team rather than assuming they aren''t suitable for you specifically, as suitability depends on your individual health history.\n\nVaginal dryness, often under-discussed, has simple and effective treatments too — it is a completely reasonable thing to raise.',
 'article', 3, null, 'womens_health', 120, null),

('women-fibroids-explained', 'Fibroids explained',
 'Very common, usually harmless growths — but worth knowing the signs that need attention.',
 E'Fibroids are non-cancerous growths in or around the uterus, and they are extremely common — many women have them without ever knowing, especially when small and symptom-free.\n\nWhen they do cause symptoms, the most common are heavy or prolonged periods, pelvic pressure or pain, frequent urination (from pressure on the bladder), or, less commonly, fertility difficulties depending on size and location.\n\nTreatment ranges widely depending on symptoms and plans for future pregnancy — from monitoring, to medicine, to procedures that remove fibroids while preserving the uterus, to more significant surgery in some cases. Most fibroids do not need treatment at all; the right approach depends entirely on what they are actually doing for you.',
 'article', 3, null, 'womens_health', 130, null),

('women-pelvic-pain-causes', 'Pelvic pain: common causes',
 'A wide range of causes, from ordinary to needing prompt attention.',
 E'Pelvic pain has a genuinely wide range of causes — period cramps, ovulation pain, urinary tract infections, and digestive issues are common and usually manageable. Some causes, like endometriosis or fibroids, are chronic and benefit from a proper diagnosis rather than being lived with indefinitely.\n\nA smaller set of causes need prompt attention: sudden, severe pelvic pain, especially with fever, fainting, or heavy bleeding, can point to something needing urgent care rather than a routine appointment.\n\nPain that is dismissed as "normal" for too long is a common and unfortunate pattern — persistent or worsening pelvic pain deserves a proper look, not just reassurance that it is probably nothing.',
 'article', 3, null, 'womens_health', 140, null),

('women-bone-health-menopause', 'Bone health after menopause',
 'Falling oestrogen speeds bone loss — a few habits protect against it.',
 E'Oestrogen helps maintain bone density, so bone loss speeds up notably after menopause, raising the risk of osteoporosis and fractures over time — this is a real, measurable shift, not a vague ageing concern.\n\nWhat helps: adequate calcium and vitamin D (from food, sunlight, or supplements as advised), regular weight-bearing exercise (walking counts, and resistance work helps more), and avoiding smoking, which independently accelerates bone loss.\n\nA bone density scan may be recommended depending on your risk factors — ask your care team whether and when that applies to you, particularly if you have other risk factors like a family history of fractures.',
 'article', 3, null, 'womens_health', 150, null),

('women-vaginal-health', 'Vaginal health and infections: common and treatable',
 'Most vaginal symptoms have simple, well-understood explanations.',
 E'Vaginal discharge, itching, or odour changes are common and usually have straightforward, treatable explanations — yeast infections and bacterial vaginosis are both frequent and respond well to treatment, not something to be embarrassed about mentioning.\n\nWhat is worth getting checked rather than self-treating repeatedly: symptoms that keep recurring despite treatment, symptoms alongside pelvic pain or fever, or any new symptom after a new sexual partner, which could indicate a sexually transmitted infection worth specifically testing for.\n\nThis is one of the more common reasons people delay seeking care out of discomfort discussing it — your care team handles these conversations routinely and without judgment.',
 'article', 3, null, 'womens_health', 160, null),

-- ============================================================================
-- Men's health
-- ============================================================================
('men-prostate-basics', 'Prostate health basics: BPH vs cancer',
 'An enlarged prostate is common with age and usually not cancer — but the symptoms overlap.',
 E'The prostate commonly enlarges with age — a condition called BPH (benign prostatic hyperplasia), which is not cancer, though it can cause bothersome urinary symptoms: a weaker stream, frequent urination (especially at night), or a sense of incomplete emptying.\n\nProstate cancer can cause similar urinary symptoms, or none at all in its earlier stages, which is exactly why symptoms alone cannot reliably tell the two apart — a proper evaluation is what does.\n\nIf you are noticing new or worsening urinary symptoms, mention them to your care team rather than assuming it is "just age" — the evaluation is straightforward and the vast majority of the time, the explanation is the benign one.',
 'article', 4, null, 'mens_health', 10, null),

('men-psa-test-explained', 'The PSA test explained',
 'What it measures, and why a raised result needs context, not panic.',
 E'PSA (prostate-specific antigen) is a protein the prostate produces; a blood test measures its level. It can be raised by prostate cancer, but also by BPH, prostatitis (inflammation), recent ejaculation, or even a recent bike ride or exam — so a single raised result needs context and often a repeat test, not an immediate alarm.\n\nWhether to have PSA testing at all is a personal decision your care team should walk you through, since it carries genuine trade-offs, not just benefits.\n\nIf your result comes back raised, your care team will explain what it likely means for you specifically and what, if anything, happens next — most raised results do not turn out to be cancer.',
 'article', 3, null, 'mens_health', 20, null),

('men-erectile-dysfunction-signal', 'Erectile dysfunction: often an early cardiovascular signal',
 'A common, treatable issue that can also be useful early information about heart health.',
 E'Erectile dysfunction (ED) is common, especially with age, and very treatable — but it is worth knowing it can also be an early signal of cardiovascular issues, since the small blood vessels involved are often affected before larger ones show symptoms elsewhere.\n\nThis is genuinely useful information rather than something to be alarmed by: if ED shows up, especially in a younger man or alongside other risk factors, it is a reasonable prompt to check blood pressure, cholesterol and blood sugar, catching a cardiovascular issue earlier than it might otherwise be found.\n\nED is a completely normal, common thing to bring up with your care team — it is one of the more effectively treated conditions in medicine, with several options depending on the cause.',
 'article', 3, null, 'mens_health', 30, null),

('men-testosterone-myths', 'Testosterone: myths and facts',
 'What it actually does, and why "low T" symptoms often have other explanations.',
 E'Testosterone naturally declines gradually with age, but the dramatic "low T" symptoms attributed to it in some marketing (fatigue, low mood, reduced muscle) often have other, more common explanations — poor sleep, stress, weight changes, or other health conditions.\n\nA genuinely low testosterone level is diagnosed with a proper blood test, ideally morning, sometimes repeated — not from a symptom checklist alone, since the symptoms overlap heavily with several other common conditions.\n\nIf you are concerned, ask your care team for a proper evaluation rather than starting supplements or treatments on your own — inappropriate testosterone use carries real risks and is not something to self-manage.',
 'article', 3, null, 'mens_health', 40, null),

('men-fertility-basics', 'Male fertility basics',
 'Sperm health is affected by more everyday factors than most people expect.',
 E'Male fertility factors are involved in a substantial share of couples'' difficulty conceiving, yet get discussed far less than female fertility factors. Sperm production is affected by everyday things: heat exposure (frequent hot baths, laptops on the lap), smoking, heavy alcohol use, certain medicines, weight, and some health conditions.\n\nA semen analysis is a straightforward, non-invasive first test if a couple has been trying to conceive without success — and is a reasonable thing to check alongside, not instead of, female fertility evaluation.\n\nMany male fertility factors are treatable or improvable with lifestyle changes or medical treatment once identified — it is worth a proper evaluation rather than assuming nothing can be done.',
 'article', 3, null, 'mens_health', 50, null),

('men-testicular-self-exam', 'Testicular self-checks: what''s normal, what''s not',
 'A quick monthly habit that catches one of the most treatable cancers early.',
 E'Testicular cancer is relatively rare but is one of the most treatable cancers when caught early, and it tends to affect younger men more than most cancers do — which makes early awareness particularly worthwhile in this age group.\n\nA simple monthly check, ideally after a warm shower when tissue is relaxed, involves gently feeling each testicle for any new lump, hardness, or change in size or texture compared to what feels normal for you. A little size difference between the two sides is normal; a new, distinct lump is what to note.\n\nIf you notice something new, mention it to your care team promptly rather than waiting — most findings are not cancer, but the ones that are respond very well to early treatment.',
 'article', 2, null, 'mens_health', 60, null),

('men-mental-health-underreporting', 'Men and mental health: why the numbers hide the problem',
 'Men report distress less often, which doesn''t mean they experience it less.',
 E'Men are, on average, diagnosed with depression and anxiety less often than women — but this gap reflects underreporting more than a real difference in how often these conditions occur. Symptoms in men also sometimes look different: irritability, anger, or physical complaints rather than sadness, which can make them harder to recognise as mental health symptoms at all.\n\nThe practical cost of underreporting is real: delayed treatment, and higher rates of the most serious outcomes among men who do struggle.\n\nMentioning persistent low mood, irritability, loss of interest in things you normally enjoy, or difficulty coping to your care team is exactly the kind of thing worth raising — it is treated with the same seriousness and privacy as any physical symptom.',
 'article', 3, null, 'mens_health', 70, null),

('men-preventive-care-gap', 'Men and preventive care: closing the gap',
 'Men attend routine check-ups less often, and it shows up in outcomes.',
 E'Men are, on average, less likely to attend routine check-ups and screenings than women, and less likely to seek care early when something feels wrong — a pattern that contributes to men being diagnosed later, on average, across several conditions.\n\nThere is no single reason, but common ones include feeling fine so seeing no urgency, discomfort discussing symptoms, or simply not having a routine built around it.\n\nThe fix is mostly structural rather than about willpower: building a habit around your screening calendar here, the same way you would for a car service, turns "I should probably get that checked sometime" into something that actually happens on schedule.',
 'article', 3, null, 'mens_health', 80, null),

('men-hair-loss-normal-vs-medical', 'Hair loss: normal ageing vs worth checking',
 'Most male hair loss is genetic pattern baldness — common, and not usually a sign of illness.',
 E'Most hair loss in men follows a predictable pattern (receding hairline, thinning crown) driven by genetics and hormones — extremely common, and not a sign of an underlying illness on its own.\n\nWorth mentioning to your care team: sudden, patchy hair loss (rather than gradual thinning), hair loss alongside other symptoms like fatigue or weight changes, or hair loss that starts unusually early and rapidly — these patterns are less typical of standard pattern baldness and are worth a proper look.\n\nSeveral treatments exist for standard pattern hair loss if it bothers you, ranging in effectiveness — a reasonable, low-stakes conversation to have with your care team if you are interested.',
 'article', 2, null, 'mens_health', 90, null),

('men-hernia-signs', 'Hernias: signs and when to get checked',
 'A bulge that appears with straining is a common, fixable issue worth not ignoring.',
 E'A hernia happens when tissue pushes through a weak spot in the abdominal wall, often showing as a bulge in the groin or abdomen that becomes more noticeable when straining, lifting, or coughing, and may ease when lying down.\n\nMost hernias are uncomfortable rather than dangerous, but they do not fix themselves and generally need a procedure eventually if they are causing symptoms.\n\nA hernia that suddenly becomes very painful, firm, and will not push back in — sometimes with nausea or vomiting — can mean the tissue has become trapped, which is a genuine emergency needing immediate care, not a routine appointment. A straightforward, non-urgent hernia is still worth getting evaluated rather than living around indefinitely.',
 'article', 3, null, 'mens_health', 100, null),

('men-heart-risk-earlier', 'Why men''s heart risk often starts earlier',
 'On average, cardiovascular risk rises earlier in men — worth knowing, not worth fearing.',
 E'On average, men tend to develop cardiovascular risk factors and heart disease earlier in life than women, who are relatively protected until after menopause by hormonal factors — though the gap narrows with age, and heart disease remains a leading cause of death for both.\n\nThis is a reason for men to take blood pressure, cholesterol and blood sugar screening seriously from a somewhat earlier age, not a reason for alarm — the same well-understood, manageable factors (diet, movement, smoking, weight, medicine when needed) apply.\n\nIf heart disease runs in your family, particularly a father or brother diagnosed relatively young, mention it to your care team — it may reasonably shift how early or how closely you are screened.',
 'article', 3, null, 'mens_health', 110, null),

('men-weight-muscle-balance', 'Balancing weight and muscle as men age',
 'Muscle mass declines from the 30s onward unless actively maintained — a different problem than weight alone.',
 E'From around the 30s onward, muscle mass gradually declines unless it is actively maintained — a separate issue from body weight, since it is possible for weight to stay stable while muscle quietly gives way to fat over years.\n\nThis matters beyond appearance: muscle supports metabolism, blood sugar control, and physical independence later in life. Resistance exercise (bodyweight work, weights, resistance bands) two to three times a week, alongside adequate protein, is what specifically counters this, more than cardio alone.\n\nIt is never too late to start — muscle responds to training at any age, and the health benefits (including for blood sugar and joint support) show up relatively quickly once a routine sticks.',
 'article', 3, null, 'mens_health', 120, null)

on conflict (code) do nothing;

-- Assertion: prove every row in this file actually landed.
do $$
declare
  inserted integer;
begin
  select count(*) into inserted
  from public.health_education_content
  where category in ('cancer_screening', 'womens_health', 'mens_health');
  if inserted < 40 then
    raise exception 'expected at least 40 screening/women/men rows, found %', inserted;
  end if;
end $$;
