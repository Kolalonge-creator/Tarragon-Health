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
  ["/clinician/credentialing/expiry", "licence license mdcn indemnity expiry expires renewal renew grace suspended reinstate"],
  ["/clinician/credentialing/content", "training test scenarios questions modules approve content exam"],
  ["/clinician/credentialing", "doctor clinician onboarding application applicant apply verify verification mdcn folio credentials referees nysc approve"],
  ["/admin/credentialing/expiry", "licence license mdcn indemnity expiry expires renewal renew grace suspended reinstate"],
  ["/admin/credentialing", "doctor clinician onboarding application applicant apply verify verification mdcn folio credentials referees nysc"],
  ["/admin/memberships", "membership member grant end subscription free tier written questions entitlement"],
  ["/clinician/memberships", "membership member grant end subscription free tier written questions entitlement"],
  ["/admin/outcomes", "outcomes blood pressure control 90 day report bp snapshot day 30 180 hypertension programme results adherence cohort"],
  ["/admin/catalogue", "catalogue prices price list items membership care pack consultation checkout paystack switch on off sell buy"],
  ["/clinician/lab-results", "lab result review held abnormal critical release disclosure disclose positive hiv hepatitis screening withhold"],
  ["/clinician/lab-panels", "lab ranges reference critical limits sign cmo release policy disclosure attempts panels essential annual health check"],
  ["/admin/settings/lab-panels", "lab ranges reference critical limits release policy panels read only signed"],
  ["/clinician/clinical-signoff", "sign signature sign off signoff hub approve what needs signing outstanding pending awaiting clinical director cmo"],
  ["/clinician/lpe-content-library", "sign approve review coaching content ai coach lifestyle blocks library reference copy"],
  ["/clinician/result-release-policies", "sign approve result release policy abnormal critical doctor delivered restricted hiv hepatitis cancer screen withhold patient"],
  ["/clinician/titration-protocols", "protocol protocols titration step table steps approve protocol approve sign hypertension blood pressure protocol dose increase medicine draft htn_hearts_ng check validate save draft definition json"],
  ["/clinician/triage-rules", "sign approve signature sign-off signoff bp blood pressure red amber green grade grading shadow rule set draft triage engine thresholds confirm adherence_follow_up"],
  ["/admin/task-types", "priority queue work tasks due urgent class adherence_follow_up adherence follow up silence check missed doses amber bp blood pressure review symptom titration dose sign-off async question result review referral letters repeat prescription red event critical"],
  ["/clinician/task-types", "priority queue work tasks due urgent class adherence_follow_up adherence follow up silence check missed doses amber bp blood pressure review symptom titration dose sign-off async question result review referral letters repeat prescription red event critical"],
  ["/admin/rota", "on call oncall rota roster shift schedule cover gap backup primary swap availability hours lead clinician leads capacity patients waiting assign reassign conflict of interest page paged priority case red event unacknowledged escalation"],
  ["/clinician/team-rota", "on call oncall rota roster shift schedule cover gap backup primary swap availability hours lead clinician leads capacity patients waiting assign reassign conflict of interest page paged priority case red event unacknowledged escalation"],
  ["/clinician/rota", "my hours on call rota shift cover swap availability declare"],
  ["/admin/go-live", "go live golive guard guards switch on off launch enable disable clinical operations consultations scribe prescribing payouts lab booking signup sign-up sign up cover proposed values config configuration confirm confirmation owner sign-off signoff founder cmo"],
  ["/admin/ops/go-live", "go live golive guard guards read only view operations ops status conditions switch"],
  ["/admin/ops/clinicians", "clinician roster doctors staff suspend pause competency competencies request ask clinical lead reinstate licence indemnity eligible status level"],
  ["/clinician/roster", "clinician roster doctors staff suspend pause reinstate competency competencies grant approve decline request licence indemnity eligible status level"],
  ["/admin/settings/access/history", "grants history who has access permission permissions capability roles holders revoked granted audit expiry expires role grants"],
  ["/clinician/reliability", "reliability sla service level queue health waiting oldest wait past due red event page paged acknowledged acknowledgement unacknowledged on call cover gaps rota hand-back handback rate score band clinician advisory"],
  ["/admin/ops/reliability", "reliability sla service level queue health waiting oldest wait past due red event page paged acknowledged acknowledgement unacknowledged on call cover gaps rota hand-back handback rate read only view operations ops"],
  ["/admin/ops/directory-freshness", "directory freshness verification verify listing listings partner partners lab laboratory pharmacy facility specialist logistics delivery overdue stale due re-verify reverify check last verified schedule cadence"],
  ["/clinician/pharmacy-flags", "pharmacy pharmacist flag flagged problem out of stock query prescriber prescription message dispensing partner"],
  ["/clinician/quality/concerns", "speak up speakup whistleblow raise concern backup reader retaliation reply acknowledge deadline overdue"],
  ["/clinician/quality", "quality safety audit audits clinical audit hand-back handback review reviewer tier 1 first 20 case file score outcome unsafe concerns"],
  ["/clinician/go-live", "go live golive guard guards switch on off launch enable disable clinical operations consultations scribe prescribing payouts lab booking signup sign-up sign up cover proposed values config configuration confirm confirmation owner sign-off signoff founder cmo"],
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
  ["/admin/data-rights", "gdpr ndpa privacy deletion erasure access request"],
  ["/admin/promo-codes", "discount coupon voucher"],
  ["/admin/leads", "enquiries prospects contact form"],
  ["/admin/refund-requests", "refund refunds money back guarantee claim order payment paystack reverse"],
];

/** Pages inside an area that are not menu items of their own, but people look for them by name. */
export const ADMIN_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "Licences and cover", href: "/admin/credentialing/expiry", group: "Clinician credentialing", hint: "Licence and indemnity expiry, grace periods, pause or reinstate access." },
  { label: "Task types and priorities", href: "/admin/task-types", group: "Clinical queue", hint: "The kinds of clinical work, how urgent each is and who may take it." },
];

/** The same, for the Chief Medical Officer, whose account role cannot open /admin. */
export const CMO_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "Clinician applications", href: "/clinician/credentialing", group: "Clinician credentialing", hint: "Review new clinicians, approve, grant competencies." },
  { label: "Licences and cover", href: "/clinician/credentialing/expiry", group: "Clinician credentialing", hint: "Licence and indemnity expiry, grace periods, pause or reinstate access." },
  { label: "Training and test content", href: "/clinician/credentialing/content", group: "Clinician credentialing", hint: "Write and approve the training modules and test scenarios." },
  { label: "Task types and priorities", href: "/clinician/task-types", group: "Clinical queue", hint: "The kinds of clinical work, how urgent each is and who may take it." },
  { label: "Lifestyle coaching content", href: "/clinician/lpe-content-library", group: "Clinical governance", hint: "Review and approve the reference copy the AI Coach can draw on." },
  { label: "Result release policies", href: "/clinician/result-release-policies", group: "Clinical governance", hint: "Which abnormal results wait for a doctor before the patient sees them." },
  { label: "Safety concerns", href: "/clinician/quality/concerns", group: "Clinical governance", hint: "The speak-up inbox: replies, backup readers and reviews after a concern." },
  { label: "Titration protocols", href: "/clinician/titration-protocols", group: "Clinical sign-off", hint: "Write, check and approve the step table the dose suggestion tool reads." },
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
