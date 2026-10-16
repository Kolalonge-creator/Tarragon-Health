# Assisted entry of readings: research note (2026-10-16)

Question: what do other products do when someone other than the patient has to get a reading into the record, and what should we copy,
given that we do not message patients by SMS and never turn an inbound message into an action (INV-08, "Never build automation from an
inbound message").

## What the search could and could not confirm

Confirmed from sources read in this pass:

- **Pharmacy-based care in Lagos.** A 2016 pilot had pharmacists take blood pressure and counsel while cardiologists enrolled patients and
  watched remotely through a mobile app. Of 336 enrolled, 236 were interviewed at entry and exit; mean systolic fell by about 9.9 mmHg and the
  share at target went from 24% to 56%. Pharmacists reported paper records, understaffing, an app that was not user-friendly and patients
  unwilling to pay as reasons readings went unreported. Source: Pharmacy-based hypertension care employing mHealth in Lagos, Nigeria (BMC
  Health Services Research, 2018), https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6277995/ . Lesson: the counter is a real place where
  readings are taken in Nigeria, and the failure was data capture burden, not clinical value. It is a strong case for a pharmacy path, and a
  warning that the path must be fast and must not need paper first.
- **Livongo (Teladoc)** records readings from a cellular blood pressure cuff with no phone step, and reports an uncontrolled six-week study
  (708 people, mean systolic fall 11.2 mmHg for those starting above 130/80). Its help centre lists a "share a health summary with doctor,
  friends or family" article; that is sharing OUT, not someone else entering readings. Source: MobiHealthNews, https://www.mobihealthnews.com/news/early-data-shows-livongo-lowers-blood-pressure-six-weeks .
- **Hello Heart** is single-arm observational: 74% of 5,115 eligible users recorded readings for two weeks or more. Nothing found about a
  helper entering readings.

NOT confirmed (no source found, so nothing below depends on it, and none of it should be quoted as fact): how Cadence and mDoc use SMS or
USSD in detail, whether Livongo or Hello Heart have a caregiver entry mode, and how Apple Health Sharing treats attribution. The brief names
SMS/USSD reach as the thing assisted entry replaces; that comes from the brief, not from this pass. Apple Health Sharing is read-only sharing
to a named person with per-category choice, from general product knowledge and unverified here.

## What we take from it

1. **The person chooses what the helper can do, per capability.** Like Apple's per-category sharing, ours is the `log_readings` capability on
   the existing Care Circle / "people who help you" grant, narrowable and revocable, expiring.
2. **Attribution is the safety property.** A record that cannot tell "my mother typed this" from "my son typed this for her" is read by the
   triage engines and the care team as the patient's own account. Ours was already stamped from the session (`logged_by_profile_id`); this
   work makes it visible ("Entered for you by Tunde", a caption on clinician charts) and stops the badge saying "Typed by you".
3. **The counter is real but needs verification before it writes.** The Lagos data say pharmacies are where readings are taken. A pharmacy
   staff member writing into a patient record needs branch verification and in-the-moment consent; neither exists in the schema, so the
   pharmacy path is a closed seam behind a go-live guard and an open question, not a guess.
4. **Rate limits and no backdating.** A helper is a bulk-entry channel by nature. Per-hour and per-day limits, and the existing rule that a
   typed reading's time is set by the database, stop a helper back-filling a record.
5. **No SMS in, no SMS out.** Entry happens in the app or on the web, offline-queue compatible. The helper's phone does the work; nothing
   depends on a notification.
