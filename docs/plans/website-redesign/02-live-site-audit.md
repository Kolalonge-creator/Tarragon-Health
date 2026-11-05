# Live audit: https://tarragonhealth.ng (2026-11-05)

Read-only. No sign-in, no form submitted, no repo files changed. Raw data in this folder:
`crawl.json` (status, redirects, meta per page), `text.json` (server HTML text), `pw.json` (Playwright timing/bytes/axe pass 1),
`axe2.json` (axe pass 2 with scroll-reveal animations forced visible), `shots/` (48 PNGs: 6 pages x 2 viewports x top + 2 scrolled + full page).
Scripts: `crawl.py`, `shots.cjs`, `axe2.cjs`, `net.cjs`.

## Summary

| Area | Result |
|---|---|
| Sitemap | 84 URLs, all 200, no redirects, no 4xx/5xx |
| Internal links (from all 84 pages) | 17 extra URLs, 0 broken; 1 redirect (`/patient/care` 307 to `/login`) |
| Linked but not in sitemap | `/monitoring`, `/therapy`, `/result-interpretation` (in the nav on all 84 pages, indexable) |
| Titles / descriptions | No duplicates, none missing; 35 of 40 articles have titles over 65 characters |
| H1 | Exactly 1 on every page |
| canonical / og:image | Present and self-referencing on all 84 |
| JSON-LD | MedicalOrganization + BreadcrumbList site-wide; FAQPage on /, /pricing, /faq and 24 articles; MedicalWebPage with reviewedBy on articles |
| noindex | Only `/impact`, which is still listed in the sitemap |
| Trackers before consent | None. 0 third-party requests, 0 cookies, nothing in localStorage before a choice |
| PageSpeed Insights API | HTTP 429 (daily quota with no key) on all 6 calls. Measured with Playwright instead (see section 5) |
| axe (true issues, animations off) | Only `color-contrast` (1 to 4 nodes per page) and `region` (1). Pass 1 showed 46 to 189 contrast failures, but those came from fade-in content caught mid-animation |
| Stale copy | "Membership Plus" still on /terms (and the "three plans" section) and /telehealth-consent. No "testing day", "17 tests" or "WhatsApp". Only ₦100,000 and ₦90,000 appear |

## Findings

### SEO and indexing

1. **[high] /terms and /telehealth-consent still describe three plans, including "Membership Plus".** /terms says "The plans: Free, Membership and Membership Plus. There are three plans." /telehealth-consent says "On Membership and Membership Plus, a doctor reviews…". Both are legal pages, so their wording binds. They need to match the two-plan model shown on /pricing ("Free, or Membership").
2. **[high] Legal pages show raw Markdown.** /terms has 46 literal `**` markers (for example `**Free.** The app…`) and /telehealth-consent has 12, along with `- ` bullets left as plain text. The Markdown is never rendered. It looks broken, and these are the pages a regulator or lawyer would read.
3. **[med] `/monitoring`, `/therapy` and `/result-interpretation` are missing from the sitemap.** All three are linked from the header/footer on every one of the 84 pages, return 200, have `index, follow` and have a self canonical. Either add them to the sitemap or noindex them on purpose. `/therapy` ("Talk to someone") especially needs a decision on whether it should be indexed.
4. **[med] `/impact` is in the sitemap but serves `noindex, follow`.** This sends Google a contradictory signal (Search Console flags it as "Submitted URL marked noindex"). Remove it from the sitemap until it goes public.
5. **[med] `/login` and `/signup` on the apex domain can be indexed by URL only.** They return 200 with no robots meta, no canonical and the generic title "TarragonHealth: Care that stays with you". robots.txt has `Disallow: /login` and `/signup`, which stops Google seeing any noindex at all. Every page links to both, so they can show up in results as bare URLs. Fix: send `X-Robots-Tag: noindex` or a meta noindex, and allow crawling of those two paths so Google can see it. The same applies to `app.tarragonhealth.ng/login` and `/signup` (200, no noindex).
6. **[med] `www.tarragonhealth.ng` serves the whole site with 200 instead of redirecting.** For example `https://www.tarragonhealth.ng/pricing` returns 200. The canonical tags point to the apex, so this is not a duplicate-content disaster, but it splits link equity and analytics. Add a 308 from www to the apex (http to https and the trailing-slash 308 already work).
7. **[med] Article titles are too long for search results.** 35 of the 40 `/resources/*` titles are over 65 characters (worst: diabetes-complications 112, cholesterol-and-heart-disease 100, hiv-hepatitis 98), because the " | TarragonHealth" suffix is added to an already long headline. Google will truncate them. Use a short SEO `title` that is separate from the on-page H1, or drop the suffix on articles.
8. **[low] Every sitemap `lastmod` is the build time** (2026-11-05T12:06:42Z on all static pages), so it changes on every deploy. Google ignores lastmod values that are not reliable. Use real content dates, as the articles already do in JSON-LD (`dateModified`).
9. **[low] `app.tarragonhealth.ng/robots.txt` is a copy of the apex file.** It says `Allow: /` with `Host:` and `Sitemap:` pointing to the apex. `/patient` correctly 307s to `/login` and robots disallows `/patient`, `/login` etc., so app routes are protected in practice. A dedicated `Disallow: /` for the app host, plus noindex on /login and /signup, would be cleaner. Marketing paths on the app host already 308 to the apex (for example `/pricing`), which is good.
10. **[low] Site-wide JSON-LD repeats the full MedicalOrganization + Person + PostalAddress graph on every page.** That is fine. Article pages use `author: Organization`. Since `reviewedBy` (Dr Kola Longe) is present, consider adding a Person author or `medicalAudience` for E-E-A-T. Optional.
11. **[low] `/symptom-checker` links to `/patient/care`, which 307s to `/login?redirect=…`.** That is a redirect hop on a public page. Link straight to `/login?redirect=/patient/care` or to `/signup`.

### Visual and UX (screenshots in `shots/`)

12. **[high] The cookie banner covers about 20% of the mobile viewport on every page.** It is around 330px of 844 (`home_mobile_0.png`). Together with the sticky top bar and header pill (about 230px), only about 35% of the first screen shows content. On /labs mobile the hero CTAs sit just above the banner. Make the banner more compact (one line plus two small buttons), and consider a non-sticky top bar on mobile.
13. **[high] On mobile the hero is a wall of text over a busy photo.** The /labs hero H1 runs 5 lines, then a 7-line paragraph sits directly on top of faces and patterned fabric (`labs_mobile_0.png`). The home hero body text overlaps the headscarf and the face. Readability depends on the photo, with a weak scrim. Shorten the hero copy (one sentence) and add a stronger gradient scrim, or put the text on a solid panel on mobile.
14. **[med] Pages are extremely long on mobile.** Home is 20,181px (about 24 screens), /resources is 22,854px and /pricing is 11,133px. The home page stacks the stat cards (Free / 12 hrs / Any lab / Next of Kin) as 4 full-width cards of about 380px each. Use a 2x2 compact grid or a horizontal scroller on mobile, and cut sections.
15. **[med] /resources is 40 cards in a 2-column grid, and most use the same placeholder.** The placeholder is a grey block with a centred icon (`resources_desktop_1.png`, `resources_mobile_1.png`). There is no search, no category jump links and no filter, and on desktop a large empty gap sits between the intro and the first section. Add category chips or anchors, a compact list layout for topic sections, and real or illustrated thumbnails.
16. **[med] Pricing cards are unbalanced and have no CTA.** The Free card has about 300px of empty space under its 4 bullets while the Membership card runs long (`pricing_desktop_1.png`). Neither card has its own button: the only CTAs ("Get started" / "Talk to us first") sit below both cards. The price (₦100,000 a year) uses the same weight as a subheading, and there are no tick icons on the feature lists. The message "lab tests not included, pay the laboratory directly" appears 3 times in a row (inside the card, then in two paragraphs below it).
17. **[med] CTA colours are inconsistent.** The hero primary buttons are gold (#C9962B-ish with dark text) while the header "Get started" and the pricing CTA are Tarragon Green. Two different "primary" colours on the same screen weaken the hierarchy. The brand guide says green is for primary actions.
18. **[med] /corporate shows no price.** The ₦90,000 employer seat price appears only on / and /pricing. /corporate also leaves the header "Get started" (the consumer signup) as the most prominent button, competing with "Request an employer health plan". The sample report mixes percentages and absolute counts ("12%", "8%", "60 employees", "25 employees") without a workforce size, so it reads inconsistently.
19. **[med] The repeated "Included:" card pattern looks templated.** /labs, /corporate and others list features as many bordered cards, each starting with a green "Included:" label (`labs_desktop_1.png`, `corporate_mobile_1.png`). Odd counts leave a full-width orphan card. Use a single list with ticks, or a 3-column icon grid.
20. **[med] Scroll-reveal animation hides content until it is scrolled into view.** In normal-speed screenshots, whole sections are blank or half-faded (`home_desktop_1.png`: "THE GAP" text column empty). This is also why the first axe pass reported 46 to 189 contrast failures (text captured at opacity 0.1 to 0.3). Users on slow devices, or anyone jumping by anchor, see empty areas. Reduce the effect, or reveal immediately for content already near the viewport.
21. **[low] The mobile header shows only the Guard Leaf mark, with no "TarragonHealth" wordmark** (`home_mobile_0.png`). Brand recall on mobile is weak. Show the wordmark (it fits beside "Get started").
22. **[low] The sticky header overlaps content while scrolling.** The rounded pill floats over section headings and headlines are cut behind it in the scrolled slices (`home_desktop_1.png`, `pricing_mobile_1.png`). Add `scroll-margin-top` for anchors, and use a solid background or blur on the pill.
23. **[low] On /about, the stat card "Free / THE APP ITSELF IS FREE" then describes Membership** (preventive plan, doctor review, monthly meeting, one price). The heading and the body contradict each other.
24. **[low] There is no horizontal overflow at 390px** (scrollWidth equals innerWidth on all 6 pages). A decorative blob (`absolute -right-12 -top-12 h-56 w-56`) extends past the viewport but is clipped. The /labs article carousel scrolls sideways on purpose.

### Tap targets (mobile 390x844)

25. **[med] 45 to 54 interactive elements per page are smaller than 24px in at least one dimension.** These include footer links (17px tall: "Services", "Chronic care", email/phone links), the home timeline step buttons ("Screening", "Reading", … 20px tall), the /labs carousel dots (10x10px) and the corporate form inputs (16px tall in the measured box). WCAG 2.2 AA sets a 24x24 minimum (target size). Footer links need line-height or padding of about 44px on touch screens.

### Performance (PSI blocked with HTTP 429, so Playwright measured these)

The mobile profile used 4x CPU throttling, 1.6 Mbps download and 150 ms latency. Desktop was unthrottled. These are lab numbers, not CrUX field data, and none was available.

| Page | Viewport | TTFB | LCP | CLS | Long-task excess (TBT proxy) | Requests | Transfer | JS | Images | Fonts |
|---|---|---|---|---|---|---|---|---|---|---|
| / | desktop | 108 ms | 1.01 s | 0 | 0 | 74 | 1,991 KB | 537 KB | 649 KB | 181 KB |
| / | mobile | 88 ms | 2.46 s | 0 | 64 ms | 61 | 1,868 KB | 516 KB | 577 KB | 181 KB |
| /pricing | mobile | 91 ms | 1.57 s | 0 | 43 ms | 37 | 733 KB | 459 KB | 0 | 180 KB |
| /corporate | mobile | 94 ms | 1.70 s | 0 | 49 ms | 44 | 691 KB | 485 KB | 19 KB | 81 KB |
| /about | mobile | 92 ms | 1.68 s | 0 | 45 ms | 39 | 665 KB | 468 KB | 17 KB | 81 KB |
| /labs | mobile | 90 ms | 1.82 s | 0 | 47 ms | 41 | 688 KB | 476 KB | 26 KB | 81 KB |
| /resources | mobile | 89 ms | 2.56 s | 0 | 41 ms | 40 | 684 KB | 469 KB | 21 KB | 81 KB |

26. **[med] The home hero downloads the photo twice, once at full size.** The `<video poster="/marketing/photos/hero/homepage-family-phone.jpg">` fetches the raw **555 KB JPG**, alongside the optimised `_next/image` version (about 85 KB) and the **402 KB** ambient MP4. That is about 1 MB for the hero, and mobile `load` came in at 9.5 s. Point `poster` at an optimised `/_next/image?...&w=828` URL or a small AVIF/WebP, and skip the video on mobile or slow connections (`prefers-reduced-data` or a width check). `motion-reduce:hidden` already exists.
27. **[med] JavaScript is about 460 to 540 KB (compressed) on every marketing page.** That is heavy for mostly static content. The two biggest chunks are 175 KB and 145 KB. Check what client components the marketing layout pulls in (the reveal animation, the cookie banner, nav prefetch), and move static sections to server components.
28. **[low] Fonts are 181 KB on / and /pricing** (one woff2 is 86 KB). Subset to Latin, and check whether both display weights need preloading.
29. **[low] Aggressive route prefetching: 35 `?_rsc=` requests on homepage load.** Each nav and footer route is prefetched twice with different `_rsc` keys. That wastes data on Nigerian mobile connections. Use `prefetch={false}` on footer links.
30. **[low] CLS is 0 on all pages and TTFB is about 90 ms** (Vercel edge). Both are good.

### Accessibility (axe-core 4.12.1)

The first pass ran with animations live and reported 46 to 189 `color-contrast` nodes per page. Almost all were faded-in text caught mid-animation (ratios 1.3 to 1.5). The second pass forced reveals visible and disabled transitions. Its real violations:

31. **[med] `color-contrast` (serious):**
    - Brand green `#0E7C52` links on Soft Sage `#E7EEE7` measure 4.41:1, below 4.5:1 for 14px text: the /gift and /pricing links in the home FAQ, and the /about inline link.
    - The `dt`/`dd` text `#BDD3CB` on `#236C51` in the dark-green stat strip measures 4.0:1 at 12px: home and /pricing (2 to 4 nodes).
    - Fix: darken the link green on sage to about `#0B6A46`, or underline the links and make them bold. Lighten the strip's small text to `#D9E8E1` or increase its size.
32. **[low] `region` (moderate): one `.sm:block` element on desktop sits outside any landmark** (likely the top utility bar "Care that stays with you / For individuals…"). Wrap it in a `<nav aria-label="Audience">` or `<header>`.
33. **[low] Not covered by axe:** the reveal animation (finding 20) and the small tap targets (finding 25). Both are real accessibility issues that axe did not flag.

### Privacy and trackers (homepage, before any consent choice)

34. **[ok] No third-party requests, no cookies set, nothing in localStorage before a choice.** The only requests are first-party document, static and RSC-prefetch requests. The banner wording ("anonymous, first-party analytics unless you say no") describes an opt-out model. No analytics call was seen before the choice, so behaviour is at least as strict as the wording. The banner's two buttons are about 35px tall on mobile: above the 24px minimum, but under the 44px comfort size. One wording point: under NDPA/GDPR-style consent, "unless you say no" implies analytics would run without an opt-in. Check that this matches the Cookie Policy and the intended legal basis.

### Copy checks

35. **[high] "Membership Plus":** found on /terms and /telehealth-consent (see finding 1). It is not on any other page, and none of the six rendered pages shows it.
36. **[ok] "testing day", "17 tests", "WhatsApp": 0 hits** in the server HTML of all 84 pages or in the rendered text of the six audited pages.
37. **[ok] Prices:** only ₦100,000 (on /, /pricing and /gift; the homepage also has one with a space, "₦ 100,000") and ₦90,000 (on / and /pricing). No other naira, dollar or pound amount appears anywhere. The spacing in "₦ 100,000" should be made consistent.

## Crawl detail: linked URLs not in the sitemap (all reachable)

| URL | Status | Linked from |
|---|---|---|
| /login, /signup | 200 (robots-disallowed, no noindex) | all 84 pages |
| /monitoring, /therapy, /result-interpretation | 200, indexable | all 84 pages |
| /patient/care | 307 to /login?redirect=%2Fpatient%2Fcare | /symptom-checker |
| /contact?source=… (10 variants) | 200 (canonical goes to /contact) | about, careers, corporate, hmo, partners, pricing, advanced-diagnostics |
| /signup?intent=support | 200 | /gift |
