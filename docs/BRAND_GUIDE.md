# Tarragon Health — Brand Guide (Condensed for Build Use)

Condensed from the Master Brand Package v2 for day-to-day engineering use: any UI copy, WhatsApp message templates, dashboard labels, or generated PDF report needs to match this. For the full rationale, campaign concepts, and print specs, see the source Master Brand Package doc.

## 1. Brand Truth (keep this in mind for every string of copy you write)
Tarragon Health is not selling healthcare — it's selling **continuity**: "the care between doctor visits." Every piece of copy should make someone feel, within five seconds: *someone is watching over this, consistently, so you don't have to carry it alone.*

**Archetype:** Guardian (primary — protective, watchful, safe) · Guide (secondary — helps families navigate a fragmented system with clarity). Never sound like a trendy wellness brand. Sound like a reliable health partner that families, clinicians, employers, HMOs, and investors can all trust.

## 2. Tagline System
- **Master tagline (use in headers, hero copy, app-store listing, social bio):** "Care that stays with you." — sentence case, full stop, never a question, never all-caps.
- **Functional descriptor (sits beneath the master line, never replaces it):** "Clinician-led health monitoring for you, your parents, and your loved ones."
- **Campaign/accessibility line (billboards, paid social, pricing page — not the brand line):** "Well within reach."
- Only one secondary tagline per page/asset — never stack two.

| Context | Line |
|---|---|
| Family product | Peace of mind for the people you love. |
| Chronic disease | Better follow-up. Better control. Better health. |
| Preventive health | Find risks early. Act before crisis. |
| Corporate/HMO | Smarter monitoring for healthier populations. |
| Premium ParentCare | Dedicated care coordination for your loved ones. |
| Diaspora marketing | Look after home, even from far away. |

## 3. Voice: Do / Don't
| Do | Don't |
|---|---|
| "Your BP has been a little high this week — your nurse will call today." | "WARNING: Abnormal reading detected." |
| "Dad's numbers looked good this week." | "Patient X-4471 vitals within normal parameters." |
| "12% of your team are pre-diabetic — here's what that could cost, and how we bring it down." | "Revolutionary AI-powered platform disrupting Nigerian healthcare!" |

**Words to use often:** Monitor · Follow-up · Remind · Coordinate · Support · Prevent · Escalate · Review · Loved ones · Parent · Family · Care gaps · Health record · Peace of mind
**Words to avoid entirely:** Cure · Guaranteed · Emergency response · Instant doctor · Replace hospital · Diagnose yourself · Perfect control · No complications · Free healthcare

Personality pillars: **Trustworthy** (we earn trust, don't claim it) · **Warm** (a nurse who knows your name, not a hospital PA system) · **Intelligent** (explain HbA1c in one clear sentence, never patronise) · **Calm** (notice things early and calmly, never alarmist) · **Premium but accessible** · **Nigerian-relevant** (local examples — jollof, garri, market BP cuffs — always).

## 4. Logo — "Guard Leaf"
Shield silhouette (protection, continuous monitoring) + sprout crown (two leaflets at the apex — prevention and growth) + checkmark vein (the leaf's midrib drawn as a checkmark — a completed reading, a closed care gap). Assets: `Tarragon_Health_Logo_Mark.png` (mark alone), `Tarragon_Health_Logo_Lockup.png` (mark + wordmark + tagline).

**Wordmark:** `TarragonHealth` — single word, camel-case. "Tarragon" in Charcoal Ink, "Health" in Tarragon Green.

**Usage rules:**
- Primary lockup (mark + wordmark + tagline) → website header, decks, letterheads, corporate proposals, app landing pages
- Wordmark alone → where space is limited or brand is already familiar
- Mark alone → app icon, favicon, social avatar, dashboard sidebar, watermark
- Clear space = height of the sprout crown, on all sides. Min size: 120px (full lockup), 32px (mark alone) — checkmark vein disappears below this
- Backgrounds: white, Warm Ivory, Soft Sage, or Deep Navy only
- **Never:** stretch, skew, rotate, add shadows, place over busy images, recolour the shield outside the palette (no blue, no red medical-cross styling)

## 5. Colour

### Brand palette
| Token | Hex | Use |
|---|---|---|
| Tarragon Green | `#0E7C52` | Mark, primary buttons, positive states, brand presence |
| Clinical Navy | `#12324B` | B2B, investor, and clinical-document contexts (institutional register) |
| Sprout Gold | *(see design token file)* | Screening reminders, upgrade prompts, premium moments — used sparingly, **never for alarm** |
| Soft Sage / Warm Ivory | *(see design token file)* | Calm default backgrounds |
| Charcoal Ink | *(see design token file)* | Standard text colour (not pure black) |

Usage ratio: 60% Ivory/Sage/White (space to breathe) · 25% Green/Forest/Navy (brand presence) · 10% Charcoal Ink (text) · 5% Sprout Gold (accents only).

*(Full hex values for Sprout Gold, Soft Sage, Warm Ivory, Charcoal Ink, and Deep Forest are defined in the project's existing CSS design-token file — pull from there, don't re-derive.)*

### Clinical status colours — a SEPARATE system, never confuse with brand colour
A 5-state system powers patient/family/nurse dashboards: **Green** (normal/on-track) · **Amber** (borderline/needs attention) · **Red** (abnormal/urgent — reserved strictly for true clinical alerts so it never loses meaning) · **Blue** (informational) · **Grey** (pending/not yet due). Always pair colour with an icon — never colour alone (colour-blind safety).

## 6. Typography
| Use | Typeface | Notes |
|---|---|---|
| Headlines/marketing | Sora (Bold/SemiBold) | Geometric, warm, free for commercial use |
| Product UI & body | Inter | Excellent legibility on low-end Android screens |
| Documents/Office | Calibri | Fallback for Word/Excel/PowerPoint exports |
| WhatsApp/SMS | Plain text only | Voice and structure carry the brand, not styling |

## 7. Icon System
Single rounded-stroke set, 2px weight, single colour (Deep Forest or Tarragon Green). **Never** photo-realistic medical icons. BP monitoring → cuff/pulse line · Diabetes → glucose droplet · Medication → pill bottle · Labs → test tube · ParentCare → parent+child figures · Nurse follow-up → headset · Preventive → shield+check · Family → linked circles · Escalation → care note · Pharmacy → medicine bag · Corporate → building+pulse · HMO → population grid.

## 8. Photography & Illustration
**Show:** adult children with parents, Nigerian families in natural settings, older adults using BP monitors, nurses on calm follow-up calls, people reassured (not sick), clean homes, technology used simply.
**Avoid:** emergency scenes, critically ill people, overly Western stock, hospital corridors only, doctors pointing at charts, fake call-centre smiles, generic wellness yoga imagery.

## 9. Dashboard UI Pattern
Card-based, never dense clinical tables for patients/families. Each card: current status (green/amber/red) · relevant trend · one clear next action.
- **Patient dashboard:** today's status, latest BP, latest glucose, medication, labs due, preventive checks, Health Passport, next action
- **Family dashboard:** "Is my loved one okay?", medication status, latest readings, upcoming actions, monthly report, alerts
- **Nurse dashboard:** patients due today, abnormal readings, missed medications, labs overdue, escalations, family updates pending, caseload metrics

## 10. Copy Reference Snippets

**WhatsApp check-in:**
> Good morning! Time for your BP reading. Reply with your numbers (e.g. 128/82) and I'll let you know how you're trending.

**Website hero:**
> Care that stays with you. Clinician-led health monitoring for you, your parents, and your loved ones.

**HMO pitch line:**
> We don't just manage chronic disease. We catch it earlier — and we can prove it.

**Social bio:**
> TarragonHealth
> Care that stays with you.
> Chronic disease, preventive health, and family care monitoring for Nigerians and their loved ones.

**App store description:**
> Tarragon Health helps you track your blood pressure, blood sugar, medications, lab checks, and preventive health reminders in one secure place. Families can monitor loved ones with consent, receive updates, and stay ahead of avoidable health crises.

## 11. Naming Architecture
Single master brand — **no independent sub-brands**. Product names are descriptive, not invented.
| Pattern | Example |
|---|---|
| [Tarragon] + [Condition/Audience] + [Care/Plan] | Hypertension Care, Diabetes Care, ParentCare, Family Plan, Chronic Care Plus |
| [Tarragon] + [Duration/Format] + [Programme] | Tarragon 90-Day Health Reset, Tarragon Free Health Tracker |
| [Premium] modifier — top diaspora tier only | Premium ParentCare |

**Rule:** never coin a standalone brand name (e.g. avoid "VitalTrack by Tarragon") for an internal product.

## 12. One-Page Quick Reference
| | |
|---|---|
| Master tagline | Care that stays with you. |
| Descriptor | Clinician-led health monitoring for you, your parents, and your loved ones. |
| Campaign line | Well within reach. |
| Logo | Guard Leaf — shield + sprout crown + checkmark vein |
| Wordmark | TarragonHealth (camel-case, Ink + Green) |
| Primary colour | Tarragon Green `#0E7C52` · B2B: Clinical Navy `#12324B` |
| Fonts | Sora (headlines) · Inter (UI/body) |
| Archetype | Guardian (primary) · Guide (secondary) |
| Voice in one line | A nurse who knows your name, not a hospital PA system |
| Best product CTA | Start monitoring. |
| Never do | Fear-based urgency · red medical crosses · Western stock photography · invented sub-brand names |
