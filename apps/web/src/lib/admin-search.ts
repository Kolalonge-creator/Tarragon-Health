import type { NavSection } from "@/lib/navigation";

/**
 * Global search for the admin console. The index is every page the admin can reach (the sidebar plus every
 * settings page they may open), built on the server from the same lists that draw the menus, so a page added to a
 * menu is searchable with no second list to keep in step. Matching runs in the browser: no request per keystroke.
 */
export interface AdminSearchEntry {
  label: string;
  href: string;
  /** Where it lives in the menus, shown beside the label. */
  group: string;
  /** One line on what the page is for (the settings blurb). */
  hint?: string;
  /** Extra words people may type that the label does not contain. */
  keywords?: string;
}

/** Words an admin may use for a page whose title does not say it. Keyed by the path they match. */
const EXTRA_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ["/clinician/worklists", "queue worklist inbox pending waiting results lab abnormal screening flags reviews vaccination therapy approvals shared pool"],
  ["/admin/access-review", "audit access log opened viewed record who looked privacy snooping retention delete export"],
  ["/clinician/access-review", "audit access log opened viewed record who looked privacy snooping retention delete export"],
  ["/clinician/credentialing/expiry", "licence license mdcn indemnity expiry expires renewal renew grace suspended reinstate no date missing date record dates cover"],
  ["/clinician/credentialing/content", "training test scenarios questions modules approve content exam"],
  ["/clinician/credentialing", "doctor clinician onboarding application applicant apply verify verification mdcn folio credentials referees nysc approve dataflow primary source reference spot re-check recheck work list evidence"],
  ["/admin/credentialing/expiry", "licence license mdcn indemnity expiry expires renewal renew grace suspended reinstate no date missing date record dates cover"],
  ["/admin/credentialing", "doctor clinician onboarding application applicant apply verify verification mdcn folio credentials referees nysc dataflow primary source reference spot re-check recheck work list evidence"],
  ["/admin/memberships", "membership member grant end subscription free tier written questions entitlement"],
  ["/clinician/memberships", "membership member grant end subscription free tier written questions entitlement"],
  ["/clinician/risk-worklist", "risk worklist who to call first outreach deterioration dropout priority tier override patients ordered"],
  ["/admin/outcomes/export", "export outcomes csv download pilot report renewal sponsor file blood pressure control aggregate"],
  ["/admin/sponsors", "sponsors programme code cohort insurer hmo employer corporate ngo members join group figures sponsor report aggregate consent share"],
  ["/admin/triage-accuracy", "triage accuracy agreement automatic grade symptom checker clinician review coverage switch on off green amber red"],
  ["/clinician/triage-review", "review automatic grades triage agreement right higher lower completed tasks checker"],
  ["/admin/risk-fairness", "risk fairness bias distribution tiers sex age state groups worklist ordering check"],
  ["/admin/outcomes", "outcomes blood pressure control 90 day report bp snapshot day 30 180 hypertension programme results adherence cohort"],
  ["/admin/access-fund", "community access fund donation donations gift pledge bank transfer grant grants hardship cannot afford restricted gift criteria approve donor"],
  ["/admin/organisation-prices", "organisation prices employer price per member seat 100000 flat default override employer pays discount negotiated invoice floor ceiling company corporate hmo"],
  ["/admin/catalogue", "catalogue prices price list items membership care pack consultation checkout paystack switch on off sell buy"],
  ["/clinician/lab-results", "lab result review held abnormal critical release disclosure disclose positive hiv hepatitis screening withhold"],
  ["/clinician/lab-panels", "lab ranges reference critical limits sign cmo release policy disclosure attempts panels essential annual health check"],
  ["/clinician/home-bp-programme", "home blood pressure check seven day protocol sign cmo bands 135 85 white coat masked pattern flag clinic reading cuff"],
  ["/admin/settings/home-bp-programme", "home blood pressure check seven day protocol bands pattern read only signed"],
  ["/admin/settings/lab-panels", "lab ranges reference critical limits release policy panels read only signed"],
  ["/clinician/my-health-config", "lock screen pass wallet card fields sign cmo emergency basics initials blood group genotype allergies on file my health c8"],
  ["/admin/settings/my-health-config", "lock screen pass wallet card fields read only signed my health emergency basics"],
  ["/clinician/clinical-signoff", "sign signature sign off signoff hub approve what needs signing outstanding pending awaiting clinical director cmo s06 s07 s08 s09 s10 c1 c2 c3 c4 c5 c6 c7 c8 cuff wording low blood pressure adherence as needed prn limits lock screen pass"],
  ["/clinician/assistant-review", "assistant ai coach chat monthly review sample conversations reported answers report an answer unsafe appropriate verdict clinical lead cmo audit read reason safety review ai health assistant"],
  ["/clinician/clinical-signoff", "sign signature sign off signoff hub approve what needs signing outstanding pending awaiting clinical director cmo"],
  ["/clinician/lpe-content-library", "sign approve review coaching content ai coach lifestyle blocks library reference copy"],
  ["/clinician/result-release-policies", "sign approve result release policy abnormal critical doctor delivered restricted hiv hepatitis cancer screen withhold patient"],
  ["/clinician/titration-protocols", "protocol protocols titration step table steps approve protocol approve sign hypertension blood pressure protocol dose increase medicine draft htn_hearts_ng check validate save draft definition json"],
  ["/clinician/triage-rules", "sign approve signature sign-off signoff bp blood pressure red amber green grade grading shadow rule set draft triage engine thresholds confirm adherence_follow_up"],
  ["/clinician/glucose-triage-rules", "sign approve signature sign-off signoff glucose sugar diabetes hypoglycaemia hypo low sugar ketones dka ketoacidosis red amber green grade grading shadow rule set draft triage engine thresholds ada level 1 level 2 level 3 urgent same day amber_glucose_review confirm"],
  ["/admin/task-types", "priority queue work tasks due urgent class adherence_follow_up adherence follow up silence check missed doses amber bp blood pressure review symptom titration dose sign-off async question result review referral letters repeat prescription red event critical"],
  ["/clinician/task-types", "priority queue work tasks due urgent class adherence_follow_up adherence follow up silence check missed doses amber bp blood pressure review symptom titration dose sign-off async question result review referral letters repeat prescription red event critical"],
  ["/admin/rota", "on call oncall rota roster shift schedule cover gap backup primary swap availability hours lead clinician leads capacity patients waiting assign reassign conflict of interest page paged priority case red event unacknowledged escalation"],
  ["/clinician/team-rota", "on call oncall rota roster shift schedule cover gap backup primary swap availability hours lead clinician leads capacity patients waiting assign reassign conflict of interest page paged priority case red event unacknowledged escalation"],
  ["/clinician/rota", "my hours on call rota shift cover swap availability declare"],
  ["/admin/partner-quality", "partner partners quality lab laboratory pharmacy clinic score licence expired expiry turnaround complaint complaints suspend pause reinstate removal new work sourcing nafdac verified distributor"],
  ["/admin/partner-settlements", "partner partners settlement settlements statement statements owed pay pharmacy clinic margin sponsor paid terms approve issue void bank reference month run drafts"],
  ["/admin/go-live", "go live golive guard guards switch on off launch enable disable clinical operations consultations scribe prescribing payouts lab booking signup sign-up sign up cover proposed values config configuration confirm confirmation owner sign-off signoff founder cmo"],
  ["/admin/ops/go-live", "go live golive guard guards read only view operations ops status conditions switch"],
  ["/admin/ops/clinicians", "clinician roster doctors staff suspend pause competency competencies request ask clinical lead reinstate licence indemnity eligible status level"],
  ["/clinician/roster", "clinician roster doctors staff suspend pause reinstate competency competencies grant approve decline request licence indemnity eligible status level"],
  ["/admin/settings/access/history", "grants history who has access permission permissions capability roles holders revoked granted audit expiry expires role grants"],
  ["/clinician/reliability", "reliability sla service level queue health waiting oldest wait past due red event page paged acknowledged acknowledgement unacknowledged on call cover gaps rota hand-back handback rate score band clinician advisory"],
  ["/admin/ops/reliability", "reliability sla service level queue health waiting oldest wait past due red event page paged acknowledged acknowledgement unacknowledged on call cover gaps rota hand-back handback rate read only view operations ops"],
  ["/admin/ops/wall", "operations wall ops wall live board dashboard queue age oldest task open pages unacknowledged doctors online calls in progress tests this week notification delivery failures payments last hour alerts alert rules on call contacts incident all clear stale cron database connections disk webhooks zoom fallback"],
  ["/admin/ops/directory-freshness", "directory freshness verification verify listing listings partner partners lab laboratory pharmacy facility specialist logistics delivery overdue stale due re-verify reverify check last verified schedule cadence"],
  ["/clinician/pharmacy", "pharmacy messages pharmacy questions question questions flag flagged problem out of stock query prescriber prescription collected collection dispensed supplied sent where is my prescription pharmacist asked answer batch substitute strength dose unclear partner dispensing"],
  ["/clinician/quality/concerns", "speak up speakup whistleblow raise concern backup reader retaliation reply acknowledge deadline overdue"],
  ["/clinician/quality", "quality safety audit audits clinical audit request reassign reviewer second review critical miss follow-up close avoidability scribe hand-back handback review tier 1 first 20 extend count case file score outcome unsafe"],
  ["/clinician/go-live", "go live golive guard guards switch on off launch enable disable clinical operations consultations scribe prescribing payouts lab booking signup sign-up sign up cover proposed values config configuration confirm confirmation owner sign-off signoff founder cmo cuff wording attestation c4 home blood pressure pattern flag clinician only as needed limits wallet pass"],
  ["/clinician/payout-approvals", "payout payouts approve approval approvals weekly draft pay clinician contracted cmo chief medical officer money"],
  ["/admin/earnings", "fee fees schedule earnings earned pay paid payout ledger contracted clinician per task consultation share on call shift lead month minimum guarantee adjustment correction statement salary kobo naira"],
  ["/admin/payouts", "payout payouts weekly draft approve send paystack transfer bank account verified retry failed reversed clinician pay finance"],
  ["/clinician/payouts", "my payouts weekly statement bank account verify name tax tin withholding contractor paid transfer"],
  ["/clinician/earnings", "my earnings earned pay paid statement ledger fee schedule per task consultation on call shift lead month minimum top up correction"],
  ["/clinician/on-call", "on call page paged priority case red event acknowledge alarm escalation"],
  ["/admin/settings/clinical-staff", "doctor clinician staff mdcn roster verify"],
  ["/admin/settings/members", "users logins accounts roles permissions invite provision"],
  ["/admin/patients", "patient people customers find search lookup support investigate purchases"],
  ["/admin/ops/incidents", "incident outage problem sev"],
  ["/admin/ops/event-bus", "event bus events outbox queue deliveries subscribers dead letter replay stuck lag falling behind heartbeat attempts retry process-events partner webhook"],
  ["/admin/ops/chain-health", "chain health canary test run synthetic check heartbeat grading graded task page paging acknowledged notice stuck dead letter timing how long reading parity legacy old alert engine compare red amber"],
  ["/clinician/chain-health", "chain health canary test run synthetic check heartbeat grading graded task page paging acknowledged notice stuck dead letter timing how long reading parity legacy old alert engine compare red amber"],
  ["/admin/ops/providers", "provider providers paystack zoom resend webhook webhooks inbox replay settlement reconciliation reconcile break breaks ledger mismatch circuit breaker health outage payment video email"],
  ["/admin/data-rights", "gdpr ndpa privacy deletion erasure access request"],
  ["/admin/promo-codes", "discount coupon voucher"],
  ["/admin/leads", "enquiries prospects contact form"],
  ["/clinician/learning-creator", "creator author write writing learning centre articles invited mdcn credentials evidence indemnity verify"],
  ["/admin/settings/health-education/creators", "creator creators clinician author authors write writers invite verify verification mdcn credentials indemnity suspend learning content partner"],
  ["/admin/settings/health-education/readiness", "readiness review date reviewer source sources self care what can i do next placeholder placeholders myth myths myth-busting series draft expired expiry overdue learning article articles"],
  ["/admin/settings/health-education/search-gaps", "search searches no result zero results missing gaps synonyms words people type bp sugar belle plan content learn library"],
  ["/admin/settings/testing-days", "testing day testing days venue venues location city lga capacity waitlist waiting list lab laboratory team station registration check in specimen tube employer visit on site onsite headcount ecg urine urinalysis point of care poc"],
  ["/clinician/record-changes", "record changes patient asked correct change remove void allergy allergies entered by mistake wrong request confirm leave as it was waiting queue"],
  ["/clinician/poc-results", "point of care poc ecg trace interpret interpretation read urine urinalysis dipstick hba1c testing day employer visit release withhold held"],
  ["/admin/refund-requests", "refund refunds money back guarantee claim order payment paystack reverse"],
];

/** Pages inside an area that are not menu items of their own, but people look for them by name. */
export const ADMIN_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "Licences and cover", href: "/admin/credentialing/expiry", group: "Clinician credentialing", hint: "Licence and indemnity expiry, grace periods, pause or reinstate access." },
  { label: "Task types and priorities", href: "/admin/task-types", group: "Clinical queue", hint: "The kinds of clinical work, how urgent each is and who may take it." },
  { label: "Learning creators", href: "/admin/settings/health-education/creators", group: "Health education library", hint: "Invite clinician creators, verify their MDCN number and evidence, suspend and take their content down." },
  { label: "Learning content readiness", href: "/admin/settings/health-education/readiness", group: "Health education library", hint: "Published items missing a reviewer, date, source or self-care step, and draft placeholders." },
  { label: "Searches with no result", href: "/admin/settings/health-education/search-gaps", group: "Health education library", hint: "What patients searched for in the Learn library and did not find." },
  { label: "Health education feedback", href: "/admin/settings/health-education/feedback", group: "Health education library", hint: "Patient reports that a learning item is wrong or unclear." },
  { label: "Health education analytics", href: "/admin/settings/health-education/analytics", group: "Health education library", hint: "Views, completion and quiz results per learning item." },
  { label: "Record access review", href: "/admin/access-review", group: "Security and privacy", hint: "Who opened which patient record, untied and after-hours openings, and the retention review." },
  { label: "Providers", href: "/admin/ops/providers", group: "Operations", hint: "Whether Paystack, Zoom and Resend are answering, settlement breaks against the ledger, and the webhook inbox with replay." },
  { label: "Event bus", href: "/admin/ops/event-bus", group: "Operations", hint: "Every event the platform recorded, who handled it, what is stuck, and replay." },
  { label: "Chain health", href: "/admin/ops/chain-health", group: "Operations", hint: "Whether readings become grades, tasks, pages and notices, the test run, timings, and the new grading against the old alerts." },
];

/** The same, for the Chief Medical Officer, whose account role cannot open /admin. */
export const CMO_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "Clinician applications", href: "/clinician/credentialing", group: "Clinician credentialing", hint: "Review new clinicians, approve, grant competencies." },
  { label: "Licences and cover", href: "/clinician/credentialing/expiry", group: "Clinician credentialing", hint: "Licence and indemnity expiry, grace periods, pause or reinstate access." },
  { label: "Training and test content", href: "/clinician/credentialing/content", group: "Clinician credentialing", hint: "Write and approve the training modules and test scenarios." },
  { label: "Task types and priorities", href: "/clinician/task-types", group: "Clinical queue", hint: "The kinds of clinical work, how urgent each is and who may take it." },
  { label: "Lifestyle coaching content", href: "/clinician/lpe-content-library", group: "Clinical governance", hint: "Review and approve the reference copy the AI Coach can draw on." },
  { label: "Result release policies", href: "/clinician/result-release-policies", group: "Clinical governance", hint: "Which abnormal results wait for a doctor before the patient sees them." },
  { label: "Shared work queues", href: "/clinician/worklists", group: "Clinical queue", hint: "Open lab results, abnormal screening, lifestyle flags and reviews, therapy and vaccination items across the organisation." },
  { label: "Safety concerns", href: "/clinician/quality/concerns", group: "Clinical governance", hint: "The speak-up inbox: replies, backup readers and reviews after a concern." },
  { label: "Learning creator credentials", href: "/clinician/learning-creator", group: "Learning Centre", hint: "If you were invited to write for the Learning Centre, send your MDCN number and evidence." },
  { label: "Titration protocols", href: "/clinician/titration-protocols", group: "Clinical sign-off", hint: "Write, check and approve the step table the dose suggestion tool reads." },
  { label: "Testing-day results", href: "/clinician/poc-results", group: "Clinical queue", hint: "Read ECG traces and release urine and HbA1c results from testing days and employer visits." },
  { label: "Record access review", href: "/clinician/access-review", group: "Security and privacy", hint: "Who opened which patient record, untied and after-hours openings, and the retention review." },
  { label: "Chain health", href: "/clinician/chain-health", group: "Clinical governance", hint: "Whether readings become grades, tasks, pages and notices, the test run, timings, and the new grading against the old alerts." },
  { label: "Home blood pressure programme", href: "/clinician/home-bp-programme", group: "Clinical sign-off", hint: "Sign the seven-day home check protocol, the bands and the white-coat or masked pattern rule (C1 to C3)." },
  { label: "My Health lock-screen pass fields", href: "/clinician/my-health-config", group: "Clinical sign-off", hint: "Sign what a lock-screen or wallet pass may show (C8)." },
];

export interface SettingsPageInput {
  href: string;
  label: string;
  blurb: string;
  group: string;
}

/** Sidebar items plus settings pages, de-duplicated by path (the sidebar wins), with extra keywords attached. */
export function buildAdminSearchIndex(
  sections: NavSection[],
  settings: SettingsPageInput[],
  extras: AdminSearchEntry[] = ADMIN_EXTRA_PAGES,
): AdminSearchEntry[] {
  const seen = new Set<string>();
  const entries: AdminSearchEntry[] = [];
  const add = (entry: AdminSearchEntry) => {
    if (seen.has(entry.href)) return;
    seen.add(entry.href);
    const keywords = EXTRA_KEYWORDS.filter(([prefix]) => entry.href === prefix).map(([, words]) => words).join(" ");
    entries.push(keywords ? { ...entry, keywords } : entry);
  };
  for (const section of sections) {
    for (const item of section.items) add({ label: item.label, href: item.href, group: section.label ?? "Main" });
  }
  for (const page of settings) add({ label: page.label, href: page.href, group: `Settings, ${page.group}`, hint: page.blurb });
  for (const extra of extras) add(extra);
  return entries;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i] && ++i === needle.length) return true;
  return needle.length === 0;
}

function tokenScore(token: string, entry: AdminSearchEntry): number {
  const label = norm(entry.label);
  const other = norm(`${entry.group} ${entry.hint ?? ""} ${entry.keywords ?? ""}`);
  if (label === token) return 120;
  if (label.startsWith(token)) return 100;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 80;
  if (label.includes(token)) return 60;
  if (other.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 40;
  if (other.includes(token)) return 20;
  if (token.length >= 3 && isSubsequence(token, label)) return 8;
  return 0;
}

/** Every word typed must match something; the order of results follows how strongly each word matched. */
export function searchAdminEntries(entries: AdminSearchEntry[], query: string, limit = 10): AdminSearchEntry[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return entries.slice(0, limit);
  const scored: { entry: AdminSearchEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    let total = 0;
    for (const token of tokens) {
      const s = tokenScore(token, entry);
      if (s === 0) return;
      total += s;
    }
    scored.push({ entry, score: total, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((s) => s.entry);
}
