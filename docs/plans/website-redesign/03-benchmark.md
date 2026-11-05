# International healthcare website benchmark, for the Tarragon Health marketing redesign

Captured 2026-11-05 with Playwright (Chromium, desktop 1440x900 slices at top / ~900px / ~35% / ~60% / page end, plus mobile 390x844 top and second screen). Screenshots were kept locally and are not committed (they are other companies' pages); filenames are cited as `shots/` (`<site>-desktop-N.png`, `<site>-mobile-N.png`, `<site>-sub-N.png`); per-site contact sheets are in `sheets/<site>.jpg`. Fonts and colours come from computed styles read with `page.evaluate` (raw dumps: `info-all.json`, `info2-*.json`, `info3-*.json`). Hex values are approximate.

Cookie banners were dismissed with the most restrictive option the site offered (Doctolib "Refuser", Maven "Reject all", Ada "Accept only mandatory", Mayo "Reject additional cookies", Teladoc "Reject unnecessary"). Cleveland Clinic's small banner only has a close icon and it stays visible in a few slices. Nothing was signed into and no forms were submitted.

**Blocked:**
- **zocdoc.com**: 403 for headless Chromium, the newer full-Chromium headless mode and WebFetch.
- **carbonhealth.com**: Cloudflare "you have been blocked" for all three methods.

I did not try to get around bot detection, so neither site has screenshots. Their entries below are short and drawn from general product knowledge. They are marked as such.

**Substitutions:**
- teladoc.com now redirects to teladochealth.com.
- doctolib.fr was used; it is French-language.
- hims.com/pricing returns a 404 ("this particular page doesn't exist"), so `hims-sub-*` is the /weight-loss product page, the closest equivalent to a pricing page.

---

## 1. One Medical (onemedical.com, Amazon One Medical)
Shots: `onemedical-desktop-0..4.png`, `onemedical-sub-0..2.png` (/membership), `onemedical-mobile-0..1.png`

- **Hero:** split layout. Left side: a large serif H1 ("Primary care designed for you", 72px, blue), a one-line subhead with key words in bold, and one pill CTA ("Book an appointment"). Below the CTA are two small text links for existing members and sponsored members. Right side: a cropped lifestyle photo of a person holding a phone, crossed by a thin blue arc line. A thin pale-yellow announcement bar sits above the header.
- **Navigation:**
  - Utility links: Log in, plus a dark pill "Sign up".
  - Mega-menus: Locations / For You / For Business.
  - Search and hamburger icons.
  - The menu segments audiences explicitly: "Adults under 65 | Adults 65+ | Kids | Business | Give a membership".
- **Palette:**
  - Deep teal #004D49 / #005450 for text and the primary button.
  - Bright blue #0578FF for the H1 and accent lines.
  - Warm off-white #F5F3EE sections, pale mint #EAF3EF cards.
  - Butter-yellow pill #FFC766 for the CTA on dark sections.
- **Typography:** GT Super Display (serif, weight 500–600, very large: H2s at 88px) over Ginto sans for body text (18px, weight 200, generous 31.5px line height). The editorial serif plus light sans pairing reads premium and calm.
- **Imagery:** warm, natural-light editorial photos of real-looking people, cropped tight. Some images are cut into the arc motif. There is a looping video of a clinic visit with a play button.
- **Layout and spacing:** very generous whitespace, with sections around 120–160px apart. A rotating headline ("Get care today for *weight issues*", cycling through conditions) works as a compact service index. The page has three-column feature cards (eyebrow label, serif title, "Learn more ›").
- **Services:** a rotating condition word with "See all our services ›", three cards (Mental health / Annual wellness / Pharmacy), and an app section with a phone mock-up and a checklist of four app abilities.
- **Trust signals:** "employee benefit at 11,600+ companies" with logos, provider and office counts in the icon row, and the Amazon brand association.
- **Pricing (/membership):**
  - Full-bleed photo hero, "Personal Membership" eyebrow, "Sign up today".
  - One paragraph states the price plainly ("just $199 a year", renews until cancelled).
  - Then a two-group comparison table: "Included in Membership" (Direct Message Care, Video Care) versus "Copay & fees apply" (In-person, Video visit), with service rows marked Yes/No and footnotes.
  - It makes clear what the membership fee covers and what still costs extra.
- **CTAs:** one dominant action ("Book an appointment" / "Sign up") repeated in the header, hero and closing dark-teal band ("Become a One Medical patient").
- **Mobile:** the hero stacks (H1, subhead, CTA) with the photo pushed below the fold. The announcement bar wraps to three lines and eats vertical space.
- **Footer:** dark teal. A location selector, short link rows, and small legal links including "Notice of Privacy Practices" and "Privacy and Deletion Requests".
- **Accessibility:** links say "opens in a new window"; all 5 images have alt text. No skip link was detected. Body text at weight 200 is thin for low-end Android screens.
- **Worth adapting:**
  1. A membership comparison that separates "included in your ₦100,000 Membership" from "pay per item", in a 2-group table.
  2. An audience-segmented nav ("For you / For your family abroad / For employers").
  3. A rotating condition word in a headline as a lightweight service index.

## 2. Zocdoc (zocdoc.com): **blocked (403)**, no screenshots
From general product knowledge, not observed today: a search-first hero (specialty / location / insurance fields), a bright yellow brand, illustrated people, and heavy review-count trust signals.
- **Worth adapting (to verify manually):** if Tarragon gets a "find a test day / lab near you" directory, use a search-first hero for that page only, not the homepage.

## 3. Doctolib (doctolib.fr)
Shots: `doctolib-desktop-0..4.png`, `doctolib-mobile-0..1.png`

- **Hero:**
  - A rounded-corner royal-blue panel holds the H1 "Vivez en meilleure santé" (Montserrat 32px bold, small for a hero).
  - Below it is a two-field search bar (name/specialty/facility + location) with an "around me" geolocation and a dark navy "Rechercher" button.
  - A photo of a clinician with a patient bleeds out of the panel.
  - A floating editorial card ("How do I take care of my mental health?" + photo + "Je découvre") overlaps the panel edge.
- **Navigation:** minimal: "Vous êtes soignant ?" (a pill button for the professional audience), Help centre, and Se connecter.
- **Palette:**
  - Brand blue #107ACA, deep navy #00264C for headings and buttons.
  - Slate text #294056, ice-blue page background #E4EDF6.
  - Accent blobs in sky blue #00A6E8 and yellow #FFC93C.
- **Typography:** Montserrat headings with Roboto body text. The 12px base body text is small.
- **Imagery:**
  - Photos masked into organic blob shapes with overlapping colour blobs, which gives a strong brand signature.
  - 3D-ish spot icons (calendar, chat bubble, heart).
  - An app photo of a hand holding a phone.
- **Layout:** stacked full-width rounded "panels" (#EEF5FC) alternating image left/right, each with one button. The page is short at about 3,900px.
- **Services:** three icon columns ("easier access to care / personalised care / manage your health").
- **Trust signals:**
  - A stat strip: "100 millions de personnes mieux soignées · 580 000 soignants · 18 millions documents partagés", each with a small info icon that sources the figure.
  - A dedicated "Votre santé. Vos données." privacy commitment panel.
  - App-store rating "4,7 ★ 800 000 notes".
  - A B Corp badge in the footer.
  - Links to medical-council directories (CNOM).
- **Pricing:** none (the service is free to patients).
- **CTAs:** search is the primary action. Each panel has one secondary button.
- **Mobile:**
  - A compact blue hero with the search collapsed into a single "RECHERCHER" pill.
  - **A persistent bottom tab bar** (Accueil / Rendez-vous / Documents / Messages / Connexion) that makes the site feel like the app.
- **Footer:** a very large SEO footer (specialties, "frequent searches" by city), country/language selectors, regulator links and a fraud-notification link.
- **Accessibility:** a skip link is present, all 20 images have alt text, and `lang="fr"` is set. The small 12px body text is a weakness.
- **Worth adapting:**
  1. A privacy panel near the top ("Your health. Your data.") that names NDPA compliance and the DPO.
  2. Stat strips with a visible source/info affordance for every number.
  3. A footer link that explains how to spot fraudulent messages claiming to be Tarragon (relevant to Nigerian SMS/WhatsApp scams).

## 4. Maven Clinic (mavenclinic.com)
Shots: `maven-desktop-0..4.png`, `maven-sub-0..2.png` (/for-employers), `maven-mobile-0..1.png`

- **Hero:**
  - A full-bleed warm family photo in a rounded inset frame.
  - The H1 "Evidence-based women's and family *healthcare*" is set in light Helvetica Now Display (74px, weight 300), with one word switched to a serif italic.
  - The subhead is "Expert care across every life stage. Anywhere in the world."
  - Two CTAs: a bright mint fill "Explore platform" and an outline "Get care".
  - Thin animated line art crosses the photo.
- **Navigation:**
  - A floating white rounded nav bar over the hero: For You / Why Maven / Employers / Health Plans / Consultants / Resources.
  - "Login" (outline) and "Book a demo" (teal fill) buttons.
  - "NEW" badges inside mega-menus (GLP-1 Care, Hormone Care, Virtual Clinic).
  - A dismissible top announcement bar promoting a research report.
- **Palette:**
  - Deep forest green #013126 for text and dark sections, teal #00856F for buttons.
  - Mint #5BE3A6 for primary CTA fills.
  - Warm linen background #EDE9E3, with teal-to-aqua gradients on cards.
- **Typography:** Helvetica Now Display light, with serif italic words for emphasis ("*and proven*", "*for all of us*", "*talent and money*"). It is a consistent signature device.
- **Imagery:** candid, warm, emotionally rich photography of diverse families and older women; tall portrait crops in a horizontal filmstrip carousel.
- **Layout:** a bento grid of feature tiles (dark tile with orbit graphic, gradient tile with chat-bubble illustration, photo tile with stat copy: "Backed by 40+ peer-reviewed studies", "Milliman-validated outcomes").
- **Audience segmentation:** a dedicated section lists Employers / Health Plans / Consultants / Employees / Consumers as arrowed rows beside a portrait, plus "See if your company offers Maven".
- **Employer page:**
  - "MAVEN FOR EMPLOYERS" mono eyebrow and serif H1 "Care that moves your workforce forward", with a photo collage.
  - "Chosen by 2,300+ leading employers" over a logo grid.
  - A problem framing ("When benefits fall short, people leave—*and costs rise*") with three big stats (93% / 92% / 69%).
  - A "Calculate your ROI" CTA.
- **Trust signals:** employer count, peer-reviewed studies, Milliman validation, a "Based on 3,695 reviews" star rating in the footer, and a LegitScript badge.
- **Pricing:** not public. The model is "Book a demo".
- **Mobile:** the full-bleed photo hero is kept, with stacked full-width mint and outline buttons. The announcement bar takes about 40px.
- **Footer:** a dark green rounded card with four link columns, newsletter capture, a big wordmark, and privacy links including "Consumer Health Data Privacy Notice".
- **Accessibility:** all 67 images have alt text. White light-weight type on photos depends on image darkness. No skip link was detected.
- **Worth adapting:**
  1. An employer page structure: eyebrow, outcome-led H1, logo or partner strip, problem stats, programme tiles, ROI / "talk to us" CTA.
  2. A light/italic emphasis device inside headlines. Tarragon's equivalent could be a colour or weight shift on one word.
  3. An audience router section ("I'm here for myself / for a parent in Nigeria / for my employees").

## 5. Mayo Clinic (mayoclinic.org)
Shots: `mayo-desktop-0..4.png`, `mayo-mobile-0..1.png` (re-captured with the cookie banner rejected; the first-pass headless request got 403, full-Chromium headless succeeded)

- **Hero:** a full-width video still (lab robotics) with a light serif H1 "Transforming your care" (mayo-display, 76px, weight 300), a text link "Learn how we drive innovation ›" and an outline pill "Request appointment". There is a play/pause control on the video.
- **Navigation:** a two-line text nav (Care at Mayo Clinic / Health Library / For Medical Professionals / Research & Education / Giving), then Request appointment, Register/Log in and Search. The large mega-menus are organised by audience and content type.
- **Palette:**
  - Near-black text #080808 on white.
  - Link/CTA blue #0057B8, deep navy footer #0A2A5E, pale blue legal band #DCE9F8.
- **Typography:** mayo-display serif for headlines; mayo-sans for H2/body text. The body text is large (20px), which is very readable.
- **Imagery:** clinical-authentic photography (masked clinician, mother and baby), with campus photos as location cards.
- **Layout:** directly under the hero is the **health library as a utility**: "Find diseases & conditions by first letter" (A–Z circle chips) plus a search field. Then trust copy ("The right answers the first time", "world's best hospital per Newsweek", with a source link), location cards, and a two-column list of "Featured care areas" with chevrons.
- **Trust signals:** a third-party ranking with a link, an institutional footer (Notice of Nondiscrimination, Digital Accessibility Statement, Price Transparency), and app-store badges.
- **Pricing:** none.
- **CTAs:** Request appointment (outline), International services.
- **Mobile:** the hero shrinks with the CTA as a full-width outline pill. The A–Z chips wrap into a five-column grid, which works well on touch.
- **Footer:** a newsletter signup row, audience link groups (Businesses, Students, Charitable Care), and app badges.
- **Accessibility:** skip link present, video pause control, large body text, an accessibility statement in the footer. This is the strongest of the set.
- **Worth adapting:**
  1. Put the health library on the homepage as a tool (A–Z plus search), not just a blog teaser.
  2. Make every trust claim a link to its source.
  3. A footer "Digital accessibility statement" and "Price transparency" page.

## 6. Teladoc Health (teladochealth.com)
Shots: `teladoc-desktop-0..4.png`, `teladoc-mobile-0..1.png`

- **Hero:** a full-bleed photo (a mother and son on a video call with a doctor visible on a phone), with a centred serif H1 "Connecting you to better health" (Reckless Neue, 52px), a one-line subhead and two pill CTAs: white "Get care now" and outline "No insurance needed".
- **Navigation:** a floating white rounded nav bar with audience tabs on the left (Individuals / Organizations / Clinicians), a centred logo, and Sign in plus a violet "Register now" pill on the right.
- **Palette:**
  - Aubergine #351F65 for headings, violet #5B3FE3 for buttons and links.
  - Text #14161A, lavender section background #EFEDFB.
  - A multicolour brand bar at the very bottom.
- **Typography:** Reckless Neue serif headings with Lexend Deca body text (16px / 26px line height).
- **Imagery:** natural lifestyle photos showing real moments of care (taking a BP reading at the kitchen table, cooking). Member testimonial cards show a portrait, name and "Teladoc Health member".
- **Services:** "The care you need, all in one place": a six-card grid (24/7 Care, Primary Care, Mental Health, Condition Management, Specialty Care, Everyday Healthy Habits). Each card has a photo, a serif title, two lines of copy and sub-links with arrows (Diabetes, Weight, Hypertension…). One centred "Get care now" follows.
- **B2B:** a tabbed block (Health plans / Employers / Hospitals & health systems), each with a serif H3, ROI copy, two large violet stats ("100+", "100M+") and a photo.
- **Trust signals:**
  - "Trusted by millions of consumers and accepted by all major insurers" over a scrolling insurer-logo marquee with a pause button.
  - Sponsorship credentials.
  - A testimonial disclaimer: "The testimonials… reflect one individual's personal experience… the individual in the photo is not the individual who provided this testimonial."
- **Pricing:** not shown; "No insurance needed" signals cash pay.
- **Mobile:** a hamburger on the left, a stacked hero with full-width white and outline buttons, and service cards in a horizontal swipe carousel with dot pagination.
- **Footer:** six columns (Individuals, Organizations, Clinicians, Who we are, Helpful Links), the HQ address and member-support phone, app badges and "Language Assistance Services".
- **Accessibility:** all 44 images have alt text and the marquee has a pause control. No skip link was detected.
- **Worth adapting:**
  1. A service grid where each card lists 2–4 condition sub-links (Hypertension, Diabetes, Preventive screening…).
  2. A plain testimonial disclaimer line. Tarragon must not show unattributed or stock "patients".
  3. A tabbed B2B block on the homepage that keeps employer content one click away without crowding the consumer hero.

## 7. Ada Health (ada.com)
Shots: `ada-desktop-0..4.png`, `ada-mobile-0..1.png`

- **Hero:** a soft blue radial gradient with a short serif H1 "Health. Powered by Ada." (PT Serif 50px), a one-sentence subhead and one pill CTA "Download Ada". No hero image. Minimal and calm.
- **Navigation:** a sticky translucent pill nav: Download Ada (outline) / Medical library / Help / App / Partner with Ada, plus a language switcher (English, Deutsch, Español, Kiswahili, Português, Română).
- **Palette:**
  - Navy #293754 for text and buttons, cornflower #3674D9 for links.
  - Pale blue/aqua gradients #E6F0FF to #E0FAF7.
  - Saturated illustration colours (sunset orange, teal, coral).
- **Typography:** PT Serif headings with Noto Sans body text (17px / 28px line height). Readable and humane.
- **Imagery:** one photo in an organic ellipse mask; article cards use warm, flat-gradient spot illustrations rather than stock photos.
- **Layout:** a short page (about 2,500px): hero, Medical library promo ("Created by our doctors and grounded in the latest research"), a three-card article row ("Take care of yourself": illustration, serif title, excerpt, "Read more"), a rounded gradient CTA band ("Get started today"), and the footer.
- **Trust signals:** the doctor-authored claim on the library, TÜV and certification badges in the footer, and Imprint/Consent Settings.
- **Pricing:** none (free app).
- **Mobile:** clean. The hero, CTA and library stack well; a "Menu" label sits under the hamburger icon, which is good for findability.
- **Footer:** sparse four-column footer with certification marks.
- **Accessibility:** "Skip navigation block" is present. **Issue:** the translucent sticky nav visibly overlaps and garbles body text as you scroll (`ada-desktop-1.png`, `ada-desktop-2.png`). That is a legibility anti-pattern.
- **Worth adapting:**
  1. A consistent illustration system for health-library cards, cheaper and more culturally adaptable than stock photos (draw Nigerian people and settings).
  2. A calm gradient hero with a short headline and one CTA for an app-download landing page.
  3. A "Created by our doctors" line on the library. Tarragon can go further with a named CMO reviewer and a review date per article.

## 8. Cleveland Clinic (my.clevelandclinic.org)
Shots: `cleveland-desktop-0..4.png`, `cleveland-mobile-0..1.png`

- **Hero:** a full-bleed autoplay video (a family gathering) with a "Pause video" control, a bold white Roboto H1 "We're here when you need us — for every care in the world.", and three underlined text links (Our Providers / Locations and Directions / Appointments). A "scroll down" circle button sits in the corner.
- **Navigation:**
  - A utility bar: location switcher (Abu Dhabi, Canada, Florida, London, Nevada, Ohio), a phone number, MyChart, Medical Professionals, Careers, and "Donate Now" in green.
  - The main nav: Find a Provider / Locations / Services / Patients and Visitors / Health Library, plus search and a solid blue "Appointments" button.
  - A "Closures & Updates" alert pill.
- **Palette:** Cleveland blue #007BC2 for headings, links and buttons; white; mid-blue #0076BA and navy #1D4F91 footer; green logo accent.
- **Typography:** Roboto throughout. H2s are 32px bold blue; body text is 16px / 25.6px line height. Functional, not distinctive.
- **Imagery:** clinical-authentic staff photos (doctors in white coats reviewing notes) and line icons for each service line.
- **Services:** a three-by-three service-line grid (Cancer, Children's, Digestive, ENT, Heart, Neurology, Ob/Gyn, Orthopaedic, Primary Care), each with a line icon, blue title, one-line descriptor and a "Show services ⌄" expander. On mobile it becomes an accordion list.
- **Care navigation:** a "Not sure where to go for care?" module that routes symptoms to virtual, primary, express care or the ER, with "Get started".
- **Utility cards:** "Get Care" and "Need Help?" with phone numbers and task links (Pay your bill, Access MyChart).
- **Trust signals:** values statements with a link to "outcomes", "300+ locations", and a "Health Information You Can Trust" library section.
- **Mobile:** solid "Menu" button, video hero with stacked text links, services as an accordion.
- **Footer:** blue with three CTA blocks (Find a Provider, Locations, Appointments), a newsletter signup, dense link columns including Price Transparency, Financial Assistance and Virtual Second Opinions, and a policy row.
- **Accessibility:** video pause control and visible link underlines. Blue on white passes contrast. The cookie notice has only a close icon (no reject choice).
- **Worth adapting:**
  1. A "Not sure what you need?" router (symptoms or goals leading to Free check / Membership / urgent-care advice), with an explicit emergency line.
  2. Service lines with icon, title, descriptor and an expandable list. On mobile, an accordion.
  3. Task-oriented utility cards (Get care / Need help) with real contact routes.

## 9. Hims (hims.com)
Shots: `hims-desktop-0..4.png`, `hims-sub-0..2.png` (/weight-loss, since /pricing is a 404), `hims-mobile-0..1.png`

- **Hero:** no image hero. The H1 "Your best starts here" (CareSans, 57px) has the second half in a rust accent colour. Directly under it is a **product-category picker**: two large image cards ("Start your weight loss today", "Now available: Injectable TRT") and four compact pill cards (Have better sex / Regrow hair / Boost testosterone / Get a health check), each with a product render and a chevron.
- **Navigation:** minimal: logo, Log in pill, hamburger. A yellow promo bar ("…are here. Check them out →") sits above. Category pages add Treatment / Membership / Hims App / The Science / FAQs.
- **Palette:**
  - Warm earth tones: chocolate #3B2A1E, tan/sand #D8C6A8, cream #F4EDE3.
  - Rust/orange accents #C0623A and #F5B759, steel blue #2E5A78 for some sections.
  - Near-black text rgba(0,0,0,.88).
- **Typography:** CareSans (custom geometric sans, weight 410). A two-tone headline device: the first half is black, the second half is accent-coloured.
- **Imagery:** high-gloss 3D product renders (pills, pens, vials) on warm gradients; editorial portraits of men; an athletic motion shot.
- **Pricing (weight-loss page):**
  - "Weight loss that works" hero with "See if I'm eligible".
  - A **horizontal product-card carousel**: Rx tag, product name, "From $149/mo†", "Membership required", product render, and "Get started" / "View details" / "Important safety information" on every card.
  - Footnotes explain that the membership fee is billed separately.
  - A floating sticky "Start losing weight →" pill follows the scroll.
- **Trust signals:** "The best care by the best in medicine" (clinician portraits), star-rated testimonials in a carousel, and an FDA disclaimer about compounded drugs directly under the product rows.
- **CTAs:** quiz-style chips ("Get hard / Last longer…") and "Get started"; email capture for a "free Guide… written by board-certified doctors".
- **Mobile:** the category picker becomes a vertical list of pill rows with a thumbnail and chevron, which is very thumb-friendly.
- **Footer:** black, with Learn / Popular / Hims columns.
- **Accessibility:** all 52 images have alt text. Small grey disclaimer text over brown backgrounds is low contrast. No skip link.
- **Worth adapting:**
  1. A goal-picker directly under the hero ("Check my blood pressure / Manage diabetes / Plan a parent's health check / Annual screening") as tappable rows on mobile.
  2. "From ₦X" pricing on every item card, with what is and isn't included stated on the card itself.
  3. Safety information placed next to the offer, not buried. Copy the placement, not the urgency.
- **Do not adapt:** promotional urgency, product-as-hero (drug renders), and lifestyle/"optimise" framing. These conflict with Tarragon's no-fear, clinical-trust voice.

## 10. Carbon Health (carbonhealth.com): **blocked (Cloudflare)**, no screenshots
From general product knowledge, not observed today: a bright, friendly brand with a mix of clinic locations and app booking, and illustrated or bright lifestyle photography.
- **Worth adapting (to verify manually):** pair a location-finder with app booking for Tarragon's screening days or partner labs.

---

## Synthesis: principles for Tarragon Health

### What the strongest sites have in common
- **One promise and one primary action above the fold.** Every strong hero (One Medical, Teladoc, Mayo, Ada) is a short headline, one supporting line and one or two CTAs. None tries to list every service in the hero.
- **An editorial serif for headlines, a humanist sans for reading.** One Medical (GT Super), Teladoc (Reckless), Mayo (mayo-display), Ada (PT Serif) and Maven (serif italic accents) all use a serif to signal warmth and authority. Body text is 16–20px with roughly 1.6 line height.
- **Warm, restrained palettes anchored by one deep brand colour** (teal, forest, navy or aubergine), a warm off-white canvas, and one bright accent kept for CTAs.
- **Audience segmentation in the nav** (One Medical "For You / For Business", Teladoc "Individuals / Organizations / Clinicians", Maven's router), and B2B content on its own page.

### Fourteen principles for the Tarragon redesign

1. **Hero pattern: split layout, serif headline, one CTA.**
   - Left: a serif H1 with the tagline idea, a one-line subhead that names what Tarragon does (preventive checks and ongoing care, reviewed against care protocols), a primary Tarragon Green #0E7C52 pill ("Start free"), and a quiet secondary link ("See Membership").
   - Right: an authentic photo of a Nigerian adult or family moment with a phone, or the app on a phone.
   - Refs: `onemedical-desktop-0.png`, `teladoc-desktop-0.png`, `ada-desktop-0.png`.
2. **An audience router directly under the hero**, in three to four rows or cards:
   - "For me" (Free and Membership)
   - "For a parent or relative in Nigeria" (sponsor from abroad)
   - "For my employees" (employer programme)
   - On mobile these are full-width tappable rows with a chevron (Hims mobile pattern).
   - Refs: `maven-desktop-2.png` (audience rows), `hims-mobile-0.png`.
3. **A goal or condition picker as the service index.** Use cards for blood pressure, diabetes, the yearly health check, screening and mental wellbeing. Each card links to two to four sub-topics (the Teladoc sub-link pattern). Optionally use a rotating condition word in one headline (One Medical).
   - Refs: `teladoc-desktop-1.png`, `onemedical-desktop-1.png`, `cleveland-desktop-1.png`.
4. **Pricing card pattern: two plans, plus a plain "what's included" comparison.**
   - Show two side-by-side cards, Free (₦0) and Membership (₦100,000 per year), each with a three-to-five-item "what you get" list and one CTA.
   - Under them, a One Medical-style two-group table: "Included in Membership" versus "Paid per item". State renewal terms in one plain sentence ("renews yearly until you cancel").
   - No monthly price breakdown (per the founder's no-instalment rule).
   - Refs: `onemedical-sub-1.png`, `onemedical-sub-2.png`, `hims-sub-2.png`.
5. **"From ₦X" on every paid item card**, with inclusions and a safety or eligibility note on the card itself (Hims placement, without the Hims urgency).
6. **A sponsor-from-abroad section with its own page.** Its job is to answer the diaspora buyer's real questions: what my relative gets, how I see that they're cared for (in-app updates with their consent), and how I pay (Paystack card or voucher).
   - Use the Maven employer-page grammar for it: eyebrow, outcome-led H1, three-step "how it works", FAQ.
   - Ref: `maven-sub-0.png`.
7. **An employer programme page structure:**
   - eyebrow "TARRAGON FOR EMPLOYERS"
   - outcome-led H1
   - partner or employer logo strip, only real signed partners
   - problem stats, each with a cited source
   - programme tiles: aggregate-only reporting (a privacy promise, per I9), screening days, chronic-care programme
   - "Talk to us" CTA
   - Refs: `maven-sub-0.png`, `maven-sub-1.png`, `maven-sub-2.png`; tabbed B2B block on the homepage in `teladoc-desktop-2.png`.
8. **A trust strip whose every claim is checkable.**
   - Use real counts only, each with an info or source affordance (Doctolib).
   - Add an NDPC registration line, an "MDCN-registered doctors" line, and a named CMO.
   - Link each claim to its evidence (Mayo links its ranking).
   - Never use invented ratings or stock "member" testimonials.
   - Refs: `doctolib-desktop-1.png`, `mayo-desktop-1.png`.
9. **A privacy panel near the top of the page.** "Your health. Your data." Who can see what (Care Circle consent, employers see aggregates only), where data lives, and a link to the privacy notice and DPO. Ref: `doctolib-desktop-1.png`.
10. **A product-screen showcase.** One section with a phone mock-up of the real app (the Today screen, BP trend, care message), a four-item checklist of app abilities, and app-store badges. Use real UI screenshots, not invented screens.
    - Refs: `onemedical-desktop-2.png`, `doctolib-desktop-2.png`.
11. **The health library as a homepage tool, plus an article template with reviewer attribution.**
    - The homepage gets a search field plus topic chips (Mayo A–Z) and a three-card "latest articles" row with a consistent illustration system (Ada).
    - The article template has: H1, a one-paragraph summary, a "Medically reviewed by Dr ___, MDCN-registered, on [date]" line that is null-gated (no reviewer record means no line), a "Sources" list citing NICE and Nigerian guidelines, a "When to get help now" callout, and a related-articles block.
    - Refs: `mayo-desktop-0.png`, `ada-desktop-2.png`.
12. **A "Not sure what you need?" router.** Two or three questions lead to Free, Membership, or "this sounds urgent: go to the nearest hospital now", with the emergency line stated plainly and never behind a form. Ref: `cleveland-desktop-0.png` (the "Not sure where to go for care" module).
13. **Mobile-first details:**
    - Full-width stacked CTAs.
    - Swipeable service cards with dots (Teladoc).
    - Tappable rows instead of a grid (Hims).
    - A labelled "Menu" button (Ada, Cleveland).
    - Keep any announcement bar to one line: One Medical's wraps to three lines on 390px (`onemedical-mobile-0.png`).
    - Budget for low-end Android: a light weight-200 body font is a risk, so keep body text at 400 and at least 16px.
14. **A footer that does institutional work:**
    - Audience columns (Individuals, Families abroad, Employers, Clinicians).
    - A health-library topics column for SEO (the Doctolib model, Nigerian cities and topics).
    - Contact routes, NDPC and DPO line, accessibility statement, price transparency (Mayo, Cleveland).
    - "How to spot fake messages claiming to be Tarragon" (Doctolib's fraud link).
    - App badges.

### Visual system notes for Tarragon
- **Canvas and colour:**
  - Warm off-white canvas (around #F7F5F0) with Tarragon Green #0E7C52 for primary actions.
  - Clinical Navy #12324B for headings and dark bands (B2B sections and the footer).
  - One warm accent (a soft amber, as One Medical uses #FFC766) for a secondary CTA on dark backgrounds.
  - Clinical status colours stay out of marketing.
- **Type:** a serif display face for H1/H2 (weight 400–500, 48–72px desktop, 32–40px mobile) over a humanist sans at 16–18px, weight 400, line height 1.6.
- **Imagery:**
  - Authentic Nigerian people in real settings: home BP checks, a parent and adult child on a video call, a screening day.
  - Natural light, warm grade, tight crops.
  - Illustration only for library cards.
  - A single brand shape motif used sparingly, like One Medical's arc or Doctolib's blobs. Tarragon could use the Guard Leaf curve.
- **Spacing:** 96–160px between desktop sections and 56–72px on mobile; one idea per section.

### Anti-patterns to avoid
- **Fear or urgency sales tactics:** promo bars, countdown-style "lock in", product-as-hero drug renders (Hims). They break the brand voice and look predatory in a health context.
- **Unverifiable trust:** stock-photo "members", star ratings without a source, logos of partners without signed contracts (the Teladoc disclaimer shows even large players need to caveat testimonials).
- **Translucent sticky headers that sit over body text** (Ada, `ada-desktop-1.png`): the overlapping text becomes unreadable.
- **Thin body type** (One Medical weight 200) and **12px body text** (Doctolib): poor on low-end Android and in sunlight.
- **Autoplay video heroes without a pause control**, and heavy video on Nigerian mobile data. If video is used, make it a poster image with a play button.
- **Hiding the price behind "Book a demo"** for consumers (Maven). Tarragon's consumer prices should be visible. Only the employer programme should route to a conversation.
- **Cookie banners with only "Accept" or only a close icon** (Cleveland). Offer an equally prominent "Reject non-essential".
- **Wrapping announcement bars** that push the hero below the fold on mobile.
- **Search-first heroes** (Doctolib, Zocdoc) for a product that isn't a marketplace. They suit a directory page, not Tarragon's homepage.
- **"Doctor-led" as a headline claim, or promising one named doctor.** These are retired brand rules; describe the process instead ("reviewed by the doctors on your care team").
