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
  ["/clinician/capacity", "capacity cover surge mode pause intake gate headroom stop sales enrolments lead places rota gap 72 hours oldest task override rest 11 hours overnight pages fatigue cover offer on_call_cover_ok"],
  ["/admin/capacity", "capacity cover surge mode pause request intake gate headroom stop sales enrolments lead places rota gap 72 hours oldest task rest overnight pages cover offer on_call_cover_ok"],
  ["/clinician/ops-desk", "ops desk ops contact named person phone call expired page on call clinician chief medical officer deputy primary roster hours Lagos call log backup power inverter second internet link tested numbers checklist attest resilience uncovered nobody on duty OQ-441"],
  ["/clinician/fire-drills", "fire drill drills test page unannounced acknowledge time p50 p95 median on call reachable route device hour monthly report"],
  ["/admin/ops/desk", "ops desk ops contact named person phone call expired page on call clinician chief medical officer deputy primary roster hours Lagos call log backup power inverter second internet link tested numbers checklist attest resilience uncovered nobody on duty OQ-441"],
  ["/admin/fire-drills", "fire drill drills test page unannounced acknowledge time p50 p95 median on call reachable route device hour monthly report"],
  ["/clinician/device-check", "device check phone battery tecno infinix samsung xiaomi notifications auto-start service worker test page on call alerts"],
  ["/clinician/rest-and-cover", "rest cover offer fatigue overnight pages 11 hours fit to work next shift"],
  ["/clinician/risk-worklist", "risk worklist who to call first outreach deterioration dropout priority tier override patients ordered"],
  ["/clinician/mental-health-worklist", "mental health follow ups worklist phq9 gad7 anxiety depression mood rising score overdue screen sleep trouble missed check ins hand off shared summary tied patients follow up task wellbeing silence is not safety"],
  ["/admin/outcomes/engagement/founder", "founder view unfrozen small groups held back frozen figures to today pilot blind reason audited outcomes engagement not for sharing"],
  ["/admin/outcomes/engagement", "engagement outcomes honest dashboard health points rewards do points work self selection healthier people engage more association not proof high low engagement earners blood pressure control hba1c difference in differences pre period baseline confidence interval minimum group held back suppressed monthly report internal not publishable illinois wellness trial"],
  ["/clinician/engagement-outcomes", "engagement outcomes honest dashboard health points rewards do points work self selection healthier people engage more association not proof high low engagement earners blood pressure control hba1c difference in differences pre period baseline confidence interval minimum group held back suppressed monthly report internal not publishable illinois wellness trial cmo"],
  ["/admin/outcomes/measures", "outcomes hba1c weight phq9 gad7 mental health retention engagement completion response times escalation follow-up data quality missing data sync lag pathways"],
  ["/admin/outcomes/cascade", "cascade of care who hearts dhis2 screened diagnosed treated controlled hypertension diabetes funnel treatment control under 140/90 hba1c 7 selection bias enrolled eligible"],
  ["/admin/outcomes/export", "export outcomes csv download pilot report renewal sponsor file blood pressure control aggregate"],
  ["/admin/outcomes/response-times", "response times care team claim time complete overdue pages acknowledge follow up median slowest tasks priority class data quality"],
  ["/admin/sponsors", "sponsors programme code cohort insurer hmo employer corporate ngo members join group figures sponsor report aggregate consent share"],
  ["/admin/sponsors/institution", "institution console configuration request approve usage statement invoice link code overlap enrolment employer join code programme code collision procurement pack sponsor rewards budget pathways"],
  ["/admin/triage-agreement", "triage agreement accuracy automatic grade symptom checker clinician review coverage switch on off green amber red"],
  ["/clinician/triage-review", "review automatic grades triage agreement right higher lower completed tasks checker"],
  ["/admin/risk-fairness", "risk fairness bias distribution tiers sex age state region groups worklist ordering check monthly report cmo review"],
  ["/admin/outcomes", "outcomes blood pressure control 90 day report bp snapshot day 30 180 hypertension programme results adherence cohort"],
  ["/admin/access-fund", "community access fund donation donations gift pledge bank transfer grant grants hardship cannot afford restricted gift criteria approve donor"],
  ["/admin/organisation-prices", "organisation prices employer price per member seat 100000 flat default override employer pays discount negotiated invoice floor ceiling company corporate hmo"],
  ["/admin/catalogue", "catalogue prices price list items membership care pack consultation checkout paystack switch on off sell buy"],
  ["/clinician/lab-results", "lab result review held abnormal critical release disclosure disclose positive hiv hepatitis screening withhold"],
  ["/clinician/lab-fallback", "lab result fallback message disclosure unreachable patient sensitive hiv hepatitis held attempts wording sign cmo contact care team"],
  ["/admin/settings/lab-fallback", "lab result fallback message disclosure wording read only signed"],
  ["/admin/lab-turnaround", "lab turnaround specimen delay overdue rejected recollection in flight median hours partner laboratory samples"],
  ["/clinician/lab-panels", "lab ranges reference critical limits sign cmo release policy disclosure attempts panels essential annual health check"],
  ["/clinician/home-bp-programme", "home blood pressure check seven day protocol sign cmo bands 135 85 white coat masked pattern flag clinic reading cuff"],
  ["/admin/settings/home-bp-programme", "home blood pressure check seven day protocol bands pattern read only signed"],
  ["/clinician/cuff-guidance", "cuff size arm circumference upper arm measure small adult large extra large sign cmo home blood pressure check validated device"],
  ["/admin/settings/cuff-guidance", "cuff size arm circumference table read only signed home blood pressure"],
  ["/clinician/recommended-devices", "recommended blood pressure monitors validated device list review cmo stridebp validatebp nafdac registry cuff model"],
  ["/admin/settings/recommended-devices", "recommended blood pressure monitors validated device list add edit validatebp stridebp nafdac distributor cuff model"],
  ["/clinician/outcomes/cascade", "cascade of care who hearts dhis2 screened diagnosed treated controlled hypertension diabetes funnel treatment control under 140/90 hba1c 7 cmo read only"],
  ["/clinician/bp-band-report", "blood pressure bands app against alerts divergence report oq-67 thresholds 135 85 160 100 200 120 pregnancy personal target"],
  ["/admin/settings/bp-band-report", "blood pressure bands app against alerts divergence report oq-67 read only"],
  ["/clinician/cuff-check-rules", "home cuff clinic cuff check blood pressure monitor device reads differently validated cheap unvalidated cuff flag pairs sign cmo s07y"],
  ["/admin/settings/cuff-check-rules", "home cuff clinic cuff check blood pressure monitor device reads differently read only signed"],
  ["/admin/settings/lab-panels", "lab ranges reference critical limits release policy panels read only signed"],
  ["/clinician/health-report-config", "yearly health report settings sign cmo blood pressure target minimum readings recheck weeks mid year priorities statement"],
  ["/admin/settings/health-report-config", "yearly health report settings read only signed targets recheck weeks"],
  ["/clinician/serology-rules", "hepatitis hiv repeat rules anti hbs threshold immunity sign cmo serology annual"],
  ["/admin/settings/serology-rules", "hepatitis hiv repeat rules anti hbs threshold immunity read only serology"],
  ["/clinician/my-health-config", "lock screen pass wallet card fields sign cmo emergency basics initials blood group genotype allergies on file my health c8"],
  ["/admin/settings/my-health-config", "lock screen pass wallet card fields read only signed my health emergency basics"],
  ["/clinician/nutrition-targets-config", "nutrition targets daily calories energy floor safe minimum salt sugar fibre meal summary light balanced heavy words sign cmo food diary"],
  ["/clinician/lowcarb-protocol-config", "low carbohydrate low carb programme type 2 diabetes eligibility exclusions check in ketone ketones glucose pause stop medicine review deprescribing rules sign cmo s50b"],
  ["/admin/settings/lowcarb-protocol-config", "low carbohydrate low carb programme type 2 diabetes eligibility exclusions pause stop medicine review read only signed"],
  ["/clinician/nutrition-guidance-config", "eating plans food swaps hypertension salt diabetes carbohydrate kidney pregnancy weight dietitian sign cmo healthier swaps"],
  ["/admin/settings/nutrition-guidance-config", "eating plans food swaps read only signed"],
  ["/admin/settings/nutrition-targets-config", "nutrition targets daily calories safe minimum salt sugar fibre meal summary read only signed"],
  ["/clinician/observation-limits", "limits typed numbers plausibility water sleep mood inhaler puffs implausible typo sign cmo glucose weight pulse extended observations"],
  ["/admin/settings/observation-limits", "limits typed numbers plausibility water sleep mood inhaler puffs read only signed"],
  ["/clinician/home-card-config", "today screen cards home cards weekly summary streak readiness wearable estimate primary actions two sign cmo s47b"],
  ["/admin/settings/home-card-config", "today screen cards weekly summary streak readiness read only signed"],
  ["/clinician/activity-safety-config", "activity safety rules exercise workout rest gentle red amber pregnancy arthritis back pain hypertension sign cmo gate s48a"],
  ["/admin/settings/activity-safety-config", "activity safety rules exercise workout rest gentle read only signed gate"],
  ["/clinician/fasting-safety-config", "fasting safety rules ramadan lent religious fast insulin sulfonylurea medicine timing plan pregnancy type 1 kidney eating disorder sign cmo s50b"],
  ["/admin/settings/fasting-safety-config", "fasting safety rules ramadan lent read only signed gate"],
  ["/clinician/clinical-signoff", "sign signature sign off signoff hub approve what needs signing outstanding pending awaiting clinical director cmo s06 s07 s08 s09 s10 c1 c2 c3 c4 c5 c6 c7 c8 cuff wording low blood pressure adherence as needed prn limits lock screen pass"],
  ["/admin/ops/care-gaps", "care gaps with no owner unowned no coordinator no doctor available sev2 incident care-gap-unowned ops s90"],
  ["/clinician/clinical-signoff", "care gap rules s90 sign care gaps missed reading hba1c lipids refill adherence rising trend outreach ladder weekly cap quiet hours experiment shadow mode cmo"],
  ["/clinician/outreach", "care gaps why this gap is open missed reading hba1c lipids refill overdue adherence rising trend closure by outcome contact attempt log next attempt due coordinator doctor review shadow"],
  ["/dashboard/care-coordinator/outreach", "care gaps why this gap is open missed reading hba1c lipids refill overdue adherence closure by outcome contact attempt log next attempt due coordinator"],
  ["/clinician/assistant-review", "assistant ai coach chat monthly review sample conversations reported answers report an answer unsafe appropriate verdict clinical lead cmo audit read reason safety review ai health assistant"],
  ["/clinician/clinical-signoff", "sign signature sign off signoff hub approve what needs signing outstanding pending awaiting clinical director cmo"],
  ["/clinician/lpe-content-library", "sign approve review coaching content ai coach lifestyle blocks library reference copy"],
  ["/clinician/result-release-policies", "sign approve result release policy abnormal critical doctor delivered restricted hiv hepatitis cancer screen withhold patient"],
  ["/clinician/titration-protocols", "protocol protocols titration step table steps approve protocol approve sign hypertension blood pressure protocol dose increase medicine draft htn_hearts_ng check validate save draft definition json"],
  ["/clinician/triage-rules", "sign approve signature sign-off signoff bp blood pressure red amber green grade grading shadow rule set draft triage engine thresholds confirm adherence_follow_up"],
  ["/clinician/vitals-triage-rules", "sign approve signature sign-off signoff pulse heart rate bpm oxygen spo2 saturation temperature fever hypoxia tachycardia bradycardia red amber green grade grading shadow rule set draft triage engine thresholds news2 vitals single reading dedupe page divergence"],
  ["/clinician/glucose-triage-rules", "sign approve signature sign-off signoff glucose sugar diabetes hypoglycaemia hypo low sugar ketones dka ketoacidosis red amber green grade grading shadow rule set draft triage engine thresholds ada level 1 level 2 level 3 urgent same day amber_glucose_review confirm fast sugar wording monitor wearable cgm freshness dedupe"],
  ["/clinician/threshold-overrides", "personal alert thresholds override overrides patient specific target individualised range baseline chronic hypertension ckd kidney hypoglycaemia unawareness monthly review expiry revoke withdraw policy kill switch cmo oversight alert load fatigue"],
  ["/admin/task-types", "priority queue work tasks due urgent class adherence_follow_up adherence follow up silence check missed doses amber bp blood pressure review symptom titration dose sign-off async question result review referral letters repeat prescription red event critical"],
  ["/clinician/task-types", "priority queue work tasks due urgent class adherence_follow_up adherence follow up silence check missed doses amber bp blood pressure review symptom titration dose sign-off async question result review referral letters repeat prescription red event critical"],
  ["/admin/rota", "on call oncall rota roster shift schedule cover gap backup primary swap availability hours lead clinician leads capacity patients waiting assign reassign conflict of interest page paged priority case red event unacknowledged escalation"],
  ["/clinician/team-rota", "on call oncall rota roster shift schedule cover gap backup primary swap availability hours lead clinician leads capacity patients waiting assign reassign conflict of interest page paged priority case red event unacknowledged escalation"],
  ["/clinician/rota", "my hours on call rota shift cover swap availability declare"],
  ["/admin/symptom-safety", "symptom checker safety nafdac regulatory position counsel classification decision support medical device accuracy audit baseline monthly under triage confidence interval review time sla prevalence malaria typhoid lassa sickle cell degraded engine fails red flag"],
  ["/clinician/symptom-safety", "symptom checker safety nafdac regulatory position counsel classification decision support medical device accuracy audit baseline monthly under triage confidence interval review time sla prevalence malaria typhoid lassa sickle cell degraded engine fails red flag cmo"],
  ["/clinician/symptom-reviews", "symptom check reviews review symptom checker patient asked care team look final diagnosis code icd agrees category triage accuracy"],
  ["/admin/partner-quality", "partner partners quality lab laboratory pharmacy clinic score licence expired expiry turnaround complaint complaints suspend pause reinstate removal new work sourcing nafdac verified distributor"],
  ["/admin/pharmacy-scorecard", "pharmacy pharmacies scorecard score card partner turnaround supply dispense collection flags flagged raised out of stock cannot supply complaints licence expiry expires expiring review suggested suggestion removal pause suspend"],
  ["/admin/partner-settlements", "partner partners settlement settlements statement statements owed pay pharmacy clinic margin sponsor paid terms approve issue void bank reference month run drafts"],
  ["/clinician/skin-photo-reviews", "photo reviews skin photo rash wound eye picture image patient sent care team look review next step message audited no automated score not a diagnosis"],
  ["/admin/go-live", "go live golive guard guards switch on off launch enable disable clinical operations consultations scribe prescribing payouts lab booking signup sign-up sign up cover proposed values config configuration confirm confirmation owner sign-off signoff founder cmo"],
  ["/admin/ops/go-live", "go live golive guard guards read only view operations ops status conditions switch"],
  ["/admin/ops/clinicians", "clinician roster doctors staff suspend pause competency competencies request ask clinical lead reinstate licence indemnity eligible status level"],
  ["/clinician/roster", "clinician roster doctors staff suspend pause reinstate competency competencies grant approve decline request licence indemnity eligible status level"],
  ["/admin/settings/access/history", "grants history who has access permission permissions capability roles holders revoked granted audit expiry expires role grants"],
  ["/clinician/reliability", "reliability sla service level queue health waiting oldest wait past due red event page paged acknowledged acknowledgement unacknowledged on call cover gaps rota hand-back handback rate score band clinician advisory"],
  ["/clinician/workload", "workload caseload clinician clinicians claimed claims completed hand-back handback handed back median 90th percentile time to complete overdue past due busy how much work staff advisory"],
  ["/admin/ops/reliability", "reliability sla service level queue health waiting oldest wait past due red event page paged acknowledged acknowledgement unacknowledged on call cover gaps rota hand-back handback rate read only view operations ops"],
  ["/admin/settings/ai-governance/cost", "ai cost spend model price prices token tokens usage feature per million input output claude anthropic bill billing"],
  ["/admin/ops/automations", "automations automation scheduled jobs job cron schedule pause resume paused owner last run sweep nightly daily background routine safety critical"],
  ["/admin/ops/wall", "operations wall ops wall live board dashboard queue age oldest task open pages unacknowledged doctors online calls in progress tests this week notification delivery failures payments last hour alerts alert rules on call contacts incident all clear stale cron database connections disk webhooks zoom fallback"],
  ["/admin/ops/automation-health", "automation health automations scheduled job jobs cron schedule owner owners runbook failed stale unowned background task reminders chasing reports sync"],
  ["/admin/ops/ai-cost", "ai cost spend price prices model tokens naira kobo month monthly assistant coach scribe unpriced budget"],
  ["/admin/settings/translations", "translation translations translate language languages review native speaker clinical reviewed draft text strings pidgin yoruba hausa igbo"],
  ["/admin/ops/ai-monitoring", "ai monitoring monitor sample monthly scheduler review rules signed reported answers wrong patient report emergency cost spike escalation accuracy agreement"],
  ["/clinician/ai-monitoring", "ai monitoring monitor sample monthly scheduler review rules signed reported answers wrong patient report emergency cost spike escalation accuracy agreement"],
  ["/clinician/triage-protocols/compare", "compare triage protocol versions diff difference change control regression replay loosened red flag symptom checker knowledge base draft signed"],
  ["/admin/settings/triage-protocols/compare", "compare triage protocol versions diff difference change control regression replay loosened red flag symptom checker knowledge base draft signed"],
  ["/clinician/support-tickets", "support tickets queue log email log phone call ticket technical help sla overdue past target possible emergency red flag"],
  ["/clinician/support-tickets/thread", "patient support thread conversation app phone email one thread everything patient sent channels"],
  ["/clinician/ai-review", "ai review answers sample sampled flagged verdict accurate harmful minor issue assistant coach reported answer safety audit"],
  ["/clinician/content-review-backlog", "content review backlog health education article articles needs re-review text changed review date overdue never reviewed clinician reviewed unreviewed 213 cmo second reviewer dual key"],
  ["/clinician/research", "research protocol protocols ethics approval data sharing agreement de-identified export participants consent study evaluation registered cmo dpo data protection officer"],
  ["/admin/settings/research", "research protocol protocols data protection officer dpo confirm ethics approval data sharing agreement export study"],
  ["/admin/settings/signup-invites", "sign up signup invite invites invitation invite-only pilot allow list allowlist code phone email register new users open close public registration waitlist"],
  ["/admin/ops/directory-freshness", "directory freshness verification verify listing listings partner partners lab laboratory pharmacy facility specialist logistics delivery overdue stale due re-verify reverify check last verified schedule cadence"],
  ["/admin/ops/directory-chase", "partner chase list chase stale freshness score decays daily lab pharmacy facility listing last checked email notice contact stalest first would be hidden"],
  ["/clinician/pharmacy", "pharmacy messages pharmacy questions question questions flag flagged problem out of stock query prescriber prescription collected collection dispensed supplied sent where is my prescription pharmacist asked answer batch substitute strength dose unclear partner dispensing"],
  ["/clinician/quality/concerns", "speak up speakup whistleblow raise concern backup reader retaliation reply acknowledge deadline overdue"],
  ["/clinician/quality", "quality safety audit audits clinical audit request reassign reviewer second review critical miss follow-up close avoidability scribe hand-back handback review tier 1 first 20 extend count case file score outcome unsafe"],
  ["/clinician/go-live", "go live golive guard guards switch on off launch enable disable clinical operations consultations scribe prescribing payouts lab booking signup sign-up sign up cover proposed values config configuration confirm confirmation owner sign-off signoff founder cmo cuff wording attestation c4 home blood pressure pattern flag clinician only as needed limits wallet pass fast sugar wording sweet drink honey 15 grams recheck low sugar glucose"],
  ["/clinician/payout-approvals", "payout payouts approve approval approvals weekly draft pay clinician contracted cmo chief medical officer money"],
  ["/admin/earnings", "fee fees schedule earnings earned pay paid payout ledger contracted clinician per task consultation share on call shift lead month minimum guarantee adjustment correction statement salary kobo naira"],
  ["/admin/earnings/disputes", "earnings question dispute disputed line hold held response overdue answer correction reject pilot minimum top up activity check release deny contracted clinician finance"],
  ["/finance/money-reconciliation", "money reconciliation mismatch mismatches disagree one money truth paystack payment order entitlement refund stuck reversal consultation share earnings payout ledger journal 2000 4900 5200 finance read only"],
  ["/finance/settlement-tieout", "settlement tie-out tieout paystack settlement settled matched missing in ledger missing at paystack exceptions daily reconcile break finance read only"],
  ["/admin/payouts", "payout payouts weekly draft approve send paystack transfer bank account verified retry failed reversed clinician pay finance"],
  ["/clinician/payouts", "my payouts weekly statement bank account verify name tax tin withholding contractor paid transfer"],
  ["/clinician/earnings", "my earnings earned pay paid pending approved failed dispute question line statement pdf gross net withholding ledger fee schedule per task consultation on call shift lead month minimum top up correction"],
  ["/clinician/on-call", "on call page paged priority case red event acknowledge alarm escalation shift start test page I received the test page"],
  ["/admin/settings/media-library", "meditation sleep story soundscape breathing exercise journal prompt library calm audio review date expired publish placeholder wellbeing content"],
  ["/admin/settings/crisis-helplines", "crisis helpline suicide self harm emergency 112 verify phone surpin mani she writes woman card mental wellbeing distress callback"],
  ["/admin/settings/clinical-staff", "doctor clinician staff mdcn roster verify"],
  ["/admin/settings/members", "users logins accounts roles permissions invite provision"],
  ["/admin/patients", "patient people customers find search lookup support investigate purchases"],
  ["/admin/ops/incidents", "incident outage problem sev"],
  ["/admin/ops/event-bus", "event bus events outbox queue deliveries subscribers dead letter replay stuck lag falling behind heartbeat attempts retry process-events partner webhook"],
  ["/admin/ops/partner-webhooks", "partner webhook webhooks endpoint endpoints signing key secret rotate rotation re-enable reenable auto-disabled disabled event map mapping partner events process-events deployed"],
  ["/admin/ops/chain-health", "chain health canary test run synthetic check heartbeat grading graded task page paging acknowledged notice stuck dead letter timing how long reading parity legacy old alert engine compare red amber"],
  ["/clinician/chain-health", "chain health canary test run synthetic check heartbeat grading graded task page paging acknowledged notice stuck dead letter timing how long reading parity legacy old alert engine compare red amber"],
  ["/admin/ops/providers", "provider providers paystack zoom resend webhook webhooks inbox replay settlement reconciliation reconcile break breaks ledger mismatch circuit breaker health outage payment video email"],
  ["/admin/data-rights", "gdpr ndpa privacy deletion erasure access request"],
  ["/admin/promo-codes", "discount coupon voucher"],
  ["/admin/leads", "enquiries prospects contact form"],
  ["/clinician/learning-creator", "creator author write writing learning centre articles invited mdcn credentials evidence indemnity verify"],
  ["/admin/settings/health-education/creators", "creator creators clinician author authors write writers invite verify verification mdcn credentials indemnity suspend learning content partner"],
  ["/admin/settings/health-education/readiness", "readiness review date reviewer source sources self care what can i do next placeholder placeholders myth myths myth-busting series draft expired expiry overdue learning article articles"],
  ["/admin/settings/health-education/expiry", "expiry backlog expiring due soon days left 30 14 7 hidden by expiry expired hidden content owner owners assign owner reminders learning content renewal"],
  ["/clinician/learning-review", "expiry backlog expiring due soon days left 30 14 7 hidden by expiry expired hidden content owner owners assign owner reminders learning content renewal chief medical officer digest"],
  ["/admin/settings/health-education/search-gaps", "search searches no result zero results missing gaps synonyms words people type bp sugar belle plan content learn library"],
  ["/admin/settings/testing-days", "testing day testing days venue venues location city lga capacity waitlist waiting list lab laboratory team station registration check in specimen tube employer visit on site onsite headcount ecg urine urinalysis point of care poc"],
  ["/clinician/record-changes", "record changes patient asked correct change remove void allergy allergies entered by mistake wrong request confirm leave as it was waiting queue"],
  ["/clinician/poc-results", "point of care poc ecg trace interpret interpretation read urine urinalysis dipstick hba1c testing day employer visit release withhold held"],
  ["/admin/settings/reward-rules", "health points rewards rules earn earning points caps limits daily decay badges levels tiers redemption checkout discount engagement gamification wellness"],
  ["/admin/refund-requests", "refund refunds money back guarantee claim order payment paystack reverse"],
  ["/admin/directory-queues", "directory queues rating ratings moderate moderation reject publish held comment reported wrong listing verification reverify re-verify phone confirmed licence checked facility report"],
];

/** Pages inside an area that are not menu items of their own, but people look for them by name. */
export const ADMIN_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "Licences and cover", href: "/admin/credentialing/expiry", group: "Clinician credentialing", hint: "Licence and indemnity expiry, grace periods, pause or reinstate access." },
  { label: "Task types and priorities", href: "/admin/task-types", group: "Clinical queue", hint: "The kinds of clinical work, how urgent each is and who may take it." },
  { label: "Learning creators", href: "/admin/settings/health-education/creators", group: "Health education library", hint: "Invite clinician creators, verify their MDCN number and evidence, suspend and take their content down." },
  { label: "Learning content readiness", href: "/admin/settings/health-education/readiness", group: "Health education library", hint: "Published items missing a reviewer, date, source or self-care step, and draft placeholders." },
  { label: "Learning content expiry backlog", href: "/admin/settings/health-education/expiry", group: "Health education library", hint: "Learning content coming up for its review date in 30, 14 and 7 days, who owns it and what is already hidden." },
  { label: "Searches with no result", href: "/admin/settings/health-education/search-gaps", group: "Health education library", hint: "What patients searched for in the Learn library and did not find." },
  { label: "Health education feedback", href: "/admin/settings/health-education/feedback", group: "Health education library", hint: "Patient reports that a learning item is wrong or unclear." },
  { label: "Health education analytics", href: "/admin/settings/health-education/analytics", group: "Health education library", hint: "Views, completion and quiz results per learning item." },
  { label: "Record access review", href: "/admin/access-review", group: "Security and privacy", hint: "Who opened which patient record, untied and after-hours openings, and the retention review." },
  { label: "Providers", href: "/admin/ops/providers", group: "Operations", hint: "Whether Paystack, Zoom and Resend are answering, settlement breaks against the ledger, and the webhook inbox with replay." },
  { label: "Event bus", href: "/admin/ops/event-bus", group: "Operations", hint: "Every event the platform recorded, who handled it, what is stuck, and replay." },
  { label: "Partner webhooks", href: "/admin/ops/partner-webhooks", group: "Operations", hint: "Partner webhook endpoints, rotate a signing key, switch an auto-disabled endpoint back on, and which events go to partners." },
  { label: "Chain health", href: "/admin/ops/chain-health", group: "Operations", hint: "Whether readings become grades, tasks, pages and notices, the test run, timings, and the new grading against the old alerts." },
];

/** The same, for the Chief Medical Officer, whose account role cannot open /admin. */
export const CMO_EXTRA_PAGES: AdminSearchEntry[] = [
  { label: "AI monitoring", href: "/clinician/ai-monitoring", group: "Clinical governance", hint: "The monthly AI review sample, answers patients reported as wrong, and how often doctors agreed with the automatic grade." },
  { label: "Compare triage versions", href: "/clinician/triage-protocols/compare", group: "Clinical governance", hint: "What changed between two versions of the symptom triage rules, and the same cases replayed against both. Read only." },
  { label: "Support tickets", href: "/clinician/support-tickets", group: "Clinical queue", hint: "The support queue: log an email or a phone call as a ticket, see what is past its target and what looks like an emergency." },
  { label: "Clinician applications", href: "/clinician/credentialing", group: "Clinician credentialing", hint: "Review new clinicians, approve, grant competencies." },
  { label: "Licences and cover", href: "/clinician/credentialing/expiry", group: "Clinician credentialing", hint: "Licence and indemnity expiry, grace periods, pause or reinstate access." },
  { label: "Training and test content", href: "/clinician/credentialing/content", group: "Clinician credentialing", hint: "Write and approve the training modules and test scenarios." },
  { label: "Task types and priorities", href: "/clinician/task-types", group: "Clinical queue", hint: "The kinds of clinical work, how urgent each is and who may take it." },
  { label: "My follow-ups", href: "/clinician/follow-ups", group: "Clinical queue", hint: "Orders, referrals, lab requests and follow-up tasks you own or are tied to; closed only with an outcome and a reason (follow_up, clinical_follow_ups)." },
  { label: "Lifestyle coaching content", href: "/clinician/lpe-content-library", group: "Clinical governance", hint: "Review and approve the reference copy the AI Coach can draw on." },
  { label: "Result release policies", href: "/clinician/result-release-policies", group: "Clinical governance", hint: "Which abnormal results wait for a doctor before the patient sees them." },
  { label: "Shared work queues", href: "/clinician/worklists", group: "Clinical queue", hint: "Open lab results, abnormal screening, lifestyle flags and reviews, therapy and vaccination items across the organisation." },
  { label: "Safety concerns", href: "/clinician/quality/concerns", group: "Clinical governance", hint: "The speak-up inbox: replies, backup readers and reviews after a concern." },
  { label: "Learning creator credentials", href: "/clinician/learning-creator", group: "Learning Centre", hint: "If you were invited to write for the Learning Centre, send your MDCN number and evidence." },
  { label: "Titration protocols", href: "/clinician/titration-protocols", group: "Clinical sign-off", hint: "Write, check and approve the step table the dose suggestion tool reads." },
  { label: "Testing-day results", href: "/clinician/poc-results", group: "Clinical queue", hint: "Read ECG traces and release urine and HbA1c results from testing days and employer visits." },
  { label: "Record access review", href: "/clinician/access-review", group: "Security and privacy", hint: "Who opened which patient record, untied and after-hours openings, and the retention review." },
  { label: "Learning content review list", href: "/clinician/learning-review", group: "Clinical governance", hint: "Learning content coming up for its review date in 30, 14 and 7 days, who owns it and what is already hidden." },
  { label: "Chain health", href: "/clinician/chain-health", group: "Clinical governance", hint: "Whether readings become grades, tasks, pages and notices, the test run, timings, and the new grading against the old alerts." },
  { label: "Care funnel", href: "/clinician/funnel", group: "Clinical governance", hint: "Alerts, red-event pages, doctor reviews and emergencies over 30 days as a ratio per alert, and how often a patient's own lead handled the task." },
  { label: "Home blood pressure programme", href: "/clinician/home-bp-programme", group: "Clinical sign-off", hint: "Sign the seven-day home check protocol, the bands and the white-coat or masked pattern rule (C1 to C3)." },
  { label: "Home blood pressure cuff sizes", href: "/clinician/cuff-guidance", group: "Clinical sign-off", hint: "Sign the arm measurement to cuff size table shown inside the home check." },
  { label: "Recommended blood pressure monitors", href: "/clinician/recommended-devices", group: "Clinical sign-off", hint: "Review each monitor an admin entered against the public validation registry." },
  { label: "Cascade of care (hypertension, diabetes)", href: "/clinician/outcomes/cascade", group: "Clinical governance", hint: "Read only: enrolled, measured, diagnosed, on a medicine and controlled, for the Chief Medical Officer. Small numbers withheld; nothing shows until the definitions are signed (WP3)." },
  { label: "Blood pressure bands: app against alerts", href: "/clinician/bp-band-report", group: "Clinical governance", hint: "Read only: readings the app band and the live alert trigger place at different levels, and why (OQ-67)." },
  { label: "Home cuff vs clinic cuff check", href: "/clinician/cuff-check-rules", group: "Clinical sign-off", hint: "Sign how far apart the patient's own cuff and the clinic cuff may read, and how many pairs, before the care team is asked to consider a cuff check (clinician-only)." },
  { label: "My Health lock-screen pass fields", href: "/clinician/my-health-config", group: "Clinical sign-off", hint: "Sign what a lock-screen or wallet pass may show (C8)." },
  { label: "Low-carbohydrate programme rules", href: "/clinician/lowcarb-protocol-config", group: "Clinical sign-off", hint: "Sign who is offered the supervised low-carbohydrate programme for type 2 diabetes, the check-ins, the pause and stop lines and when a doctor reviews medicines (S50b)." },
  { label: "Nutrition targets", href: "/clinician/nutrition-targets-config", group: "Clinical sign-off", hint: "Confirm and sign the daily calorie minimums, salt, sugar and fibre numbers and the word summary lines (S49a)." },
  { label: "Eating plans and food swaps", href: "/clinician/nutrition-guidance-config", group: "Clinical sign-off", hint: "Review and sign the five condition eating plans and the healthier swap table (S50a)." },
  { label: "Yearly report settings", href: "/clinician/health-report-config", group: "Clinical sign-off", hint: "Sign the targets, minimum readings, priority windows and suggested recheck weeks behind every yearly report." },
  { label: "Hepatitis and HIV repeat rules", href: "/clinician/serology-rules", group: "Clinical sign-off", hint: "Confirm the anti-HBs level that records hepatitis B immunity." },
  { label: "Limits for typed numbers", href: "/clinician/observation-limits", group: "Clinical sign-off", hint: "Sign the typo limits for water, sleep, mood and inhaler logs, and restate the limits for glucose, weight, pulse and blood pressure (S47a)." },
  { label: "Fasting safety rules", href: "/clinician/fasting-safety-config", group: "Clinical sign-off", hint: "Sign who may start a Ramadan or Lent fasting plan, who is stopped, and which medicines need a signed timing plan first (S50b)." },
  { label: "Today screen and weekly summary", href: "/clinician/home-card-config", group: "Clinical sign-off", hint: "Confirm and sign which cards the Today screen shows, the weekly summary minimum and the wearable readiness thresholds (S47b)." },
  { label: "Activity safety rules", href: "/clinician/activity-safety-config", group: "Clinical sign-off", hint: "Sign when a patient is told to rest or kept to gentle activity, and the kinds blocked for pregnancy, arthritis and back pain." },
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
