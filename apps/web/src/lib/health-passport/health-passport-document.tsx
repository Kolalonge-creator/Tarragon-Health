/* eslint-disable jsx-a11y/alt-text -- `Image` here is @react-pdf/renderer's,
   not an HTML <img>. It renders into a PDF content stream and accepts no `alt`
   prop; the rule is matching on the component name alone. Every image in this
   document is decorative or duplicated in adjacent text (the QR codes print
   their URL and reference beside them), so nothing is lost to a reader who
   cannot see them. */
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatHba1cWithBracket } from "@/lib/rules/hba1c-bracket";
import { LIPID_ANALYTE_META, isLipidAnalyteCode } from "@/lib/lipids/analytes";
import { PDF_BRAND as C } from "./brand-assets";
import { chunk, shortDigest } from "./credential";
import type { HealthPassportData } from "./get-health-passport-data";

/**
 * The Health Passport document.
 *
 * This is the artefact the whole feature exists to produce: the thing a
 * relocating Nigerian hands to an NHS receptionist, a daughter in London hands
 * to a Lagos emergency department, an applicant attaches to a visa medical. It
 * is read by people who have never heard of TarragonHealth and have no reason to
 * extend it any goodwill, so the design has one job before it has any other —
 * make it obvious, in the first two seconds, that this document can be checked.
 *
 * That drives the layout:
 *
 *   - The verification panel sits on page one, above the clinical content, not
 *     buried in a footer. Someone deciding whether to trust the document should
 *     not have to hunt for the means to.
 *   - The attestation block is always present and always honest. A passport with
 *     no doctor attached says so plainly rather than leaving a gap that a reader
 *     might fill in generously. Nothing here implies a clinical review that did
 *     not happen (CLAUDE.md: never render a doctor-review claim without a real
 *     record behind it).
 *   - The last page is written for the institution, not the patient: what this
 *     document is, what the signature proves, what it does not prove, and how to
 *     check it independently without contacting us.
 *
 * The credential is optional. Two other reports reuse this component — the
 * quarterly report and the health-check report — and they are internal summaries
 * rather than credentials. Without a credential the document renders as a plain,
 * clearly-labelled summary; it never shows a verification panel it cannot back.
 */

// ---------------------------------------------------------------- data shapes

export interface PassportCredentialView {
  serial: string;
  issuedAt: string;
  expiresAt: string;
  contentDigest: string;
  signature: string;
  signingKid: string;
  algorithm: string;
  verifyUrl: string;
  /** PNG data URI. Null renders the URL and serial as text instead. */
  verifyQrDataUri: string | null;
  /** PNG data URI of the whole credential, for offline checking. Often null. */
  offlineQrDataUri: string | null;
  /** `THP1.<payload>.<signature>` — printed so it survives without a scanner. */
  compact: string | null;
  subjectDateOfBirth: string | null;
  subjectPatientRef: string | null;
  /**
   * Null when no doctor attested this passport. Rendered as an explicit
   * "not clinician-attested" state, never omitted — an absent block reads as an
   * oversight, and a reader filling that gap in themselves is the exact failure
   * the null-gating rule exists to prevent.
   */
  attestation: {
    doctorName: string;
    credentialType: string;
    credentialNumber: string;
    attestedAt: string;
    statement: string | null;
  } | null;
}

// ------------------------------------------------------------------ formatting

const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Heart rate",
  temperature: "Temperature",
  spo2: "Oxygen saturation",
};

/**
 * Patient-facing label for a lab analyte. Shared with the on-screen page so the
 * PDF and the dashboard can never call the same result two different things —
 * a receiving clinician comparing the two would rightly read that as sloppiness.
 */
function labResultLabel(code: string): string {
  if (isLipidAnalyteCode(code)) return LIPID_ANALYTE_META[code].label;
  if (code === "hba1c") return "HbA1c";
  const words = code.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatVitalValue(vitalType: string, latest: Record<string, unknown>): string {
  switch (vitalType) {
    case "blood_pressure":
      return `${latest.systolic}/${latest.diastolic} mmHg`;
    case "glucose":
      return `${latest.glucose_mmol_l} mmol/L`;
    case "weight":
      return `${latest.weight_kg} kg`;
    case "pulse":
      return `${latest.pulse_bpm} bpm`;
    case "temperature":
      return `${latest.temperature_c} °C`;
    case "spo2":
      return `${latest.spo2_pct}%`;
    default:
      return "Recorded";
  }
}

/**
 * Day-Month-Year with a spelled-out month. An all-numeric date is genuinely
 * ambiguous between Nigerian, British and American readers, and this document is
 * built to be read across exactly those borders — 03/04/2026 must never be the
 * thing an immigration officer has to guess about.
 */
function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function humanise(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * "MDCN MDCN/R/48812" is what naive concatenation produces, because a real
 * Nigerian registration number already carries its own authority prefix. On a
 * document whose credibility rests on looking carefully made, a stutter like
 * that is not cosmetic.
 */
function formatRegistration(authority: string | null, number: string | null): string | null {
  if (!authority || !number) return null;
  const trimmed = number.trim();
  return trimmed.toUpperCase().startsWith(authority.trim().toUpperCase())
    ? trimmed
    : `${authority.trim()} ${trimmed}`;
}

// ---------------------------------------------------------------------- styles

const styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 56,
    paddingHorizontal: 0,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: C.ink,
    backgroundColor: C.paper,
  },
  body: { paddingHorizontal: 38 },

  // Masthead — light ground, the real brand lockup, a decisive green rule.
  //
  // Light rather than a full-bleed green band for one non-negotiable reason: the
  // brand PNGs have NO ALPHA (see brand-assets.ts). On green, the lockup renders
  // as a white rectangle. It is drawn for a white ground, so it gets one. The
  // result is also simply the better document — a solid colour band reads as a
  // leaflet, and this is a record an immigration officer has to take seriously.
  // Tarragon Green stays everywhere it carries meaning: the rule below, every
  // section underline, the verification and attestation panels.
  masthead: {
    backgroundColor: C.paper,
    paddingHorizontal: 38,
    paddingTop: 26,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  lockup: { width: 172, height: 46 },
  // Fallback when the asset cannot be read: the wordmark typeset in two colours,
  // the way the real lockup sets it, rather than one flat string.
  wordmarkDark: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C.ink },
  wordmarkGreen: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C.green },
  tagline: { fontSize: 7, color: C.muted, marginTop: 3, letterSpacing: 0.9 },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.navy, textAlign: "right" },
  docKicker: {
    fontSize: 7,
    color: C.green,
    textAlign: "right",
    marginTop: 4,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  // A double rule: the brand green, then a navy hairline. Two weights read as
  // deliberate finishing on an official document where one reads as a border.
  mastheadRule: { height: 3, backgroundColor: C.green },
  mastheadHairline: { height: 0.75, backgroundColor: C.navy },

  // Subject block
  subjectRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 16,
    gap: 18,
  },
  subjectName: { fontSize: 17, fontFamily: "Helvetica-Bold", color: C.navy },
  subjectMeta: { fontSize: 9, color: C.muted, marginTop: 4 },

  // Cards
  card: {
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 5,
    padding: 13,
    marginBottom: 12,
  },
  cardAccent: { borderColor: C.green, backgroundColor: C.greenTint },
  cardNeutral: { borderColor: C.hairline, backgroundColor: C.navyTint },
  cardLabel: {
    fontSize: 7,
    letterSpacing: 1.1,
    color: C.muted,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },

  // Verification panel
  verifyRow: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  qr: { width: 92, height: 92 },
  verifyHeading: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: C.navy },
  verifyBody: { fontSize: 8.5, color: C.ink, marginTop: 4, lineHeight: 1.45 },
  serial: {
    fontFamily: "Courier-Bold",
    fontSize: 13,
    color: C.navy,
    letterSpacing: 0.6,
    marginTop: 7,
  },
  url: { fontFamily: "Courier", fontSize: 8.5, color: C.green, marginTop: 3 },

  // Attestation
  attestName: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: C.navy },
  attestReg: { fontSize: 9, color: C.green, fontFamily: "Helvetica-Bold", marginTop: 2 },
  attestMeta: { fontSize: 8.5, color: C.muted, marginTop: 3 },
  attestQuote: {
    fontSize: 9,
    color: C.ink,
    marginTop: 7,
    paddingLeft: 9,
    borderLeftWidth: 2,
    borderLeftColor: C.green,
    lineHeight: 1.45,
  },

  // Sections
  section: { marginTop: 6, marginBottom: 14 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1.5,
    borderBottomColor: C.green,
    paddingBottom: 4,
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: C.navy },
  sectionCount: { fontSize: 8, color: C.muted },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hairline,
    gap: 12,
  },
  rowAlt: { backgroundColor: "#F7FAFB" },
  rowLabel: { fontSize: 9.5, color: C.ink, fontFamily: "Helvetica-Bold", flexShrink: 1 },
  rowValue: { fontSize: 9.5, color: C.navy, textAlign: "right", flexShrink: 1 },
  rowNote: { fontSize: 8, color: C.muted, marginTop: 2 },
  empty: { fontSize: 9, color: C.muted, paddingVertical: 8, paddingHorizontal: 6 },

  // Cover contents strip
  contents: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: C.hairline,
    paddingTop: 10,
    marginTop: 4,
    gap: 8,
  },
  contentsCell: { flex: 1 },
  contentsNum: { fontSize: 17, fontFamily: "Helvetica-Bold", color: C.green },
  contentsLabel: { fontSize: 7.5, color: C.muted, marginTop: 2 },

  // Appendix
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.navy, marginBottom: 6 },
  para: { fontSize: 9, color: C.ink, lineHeight: 1.5, marginBottom: 7 },
  step: { flexDirection: "row", gap: 8, marginBottom: 7 },
  stepNum: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: C.green,
    color: "#FFFFFF",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    paddingTop: 3,
  },
  stepText: { fontSize: 9, color: C.ink, lineHeight: 1.45, flex: 1 },
  mono: { fontFamily: "Courier", fontSize: 7.5, color: C.navy, lineHeight: 1.4 },
  kv: { flexDirection: "row", paddingVertical: 3 },
  kvKey: { width: 118, fontSize: 8.5, color: C.muted },
  kvVal: { fontSize: 8.5, color: C.navy, fontFamily: "Courier", flex: 1 },

  // Footer, fixed on every page
  footer: {
    position: "absolute",
    bottom: 22,
    left: 38,
    right: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
    paddingTop: 7,
  },
  footerText: { fontSize: 7, color: C.muted },
  footerSerial: { fontSize: 7, color: C.muted, fontFamily: "Courier" },
});

// --------------------------------------------------------------- sub-components

function Masthead({
  title,
  lockupPng,
  reference,
}: {
  title: string;
  lockupPng: Buffer | null;
  reference: string | null;
}) {
  return (
    <View fixed>
      <View style={styles.masthead}>
        {lockupPng ? (
          <Image
            style={styles.lockup}
            src={{ data: lockupPng, format: "png" } as unknown as string}
          />
        ) : (
          // Typeset the wordmark the way the lockup does — "Tarragon" dark,
          // "Health" green — rather than one flat string, so a missing asset
          // degrades to something still recognisably the brand.
          <View>
            <Text>
              <Text style={styles.wordmarkDark}>Tarragon</Text>
              <Text style={styles.wordmarkGreen}>Health</Text>
            </Text>
            <Text style={styles.tagline}>CARE THAT STAYS WITH YOU</Text>
          </View>
        )}
        <View>
          <Text style={styles.docTitle}>{title}</Text>
          {/* The reference, repeated in the masthead of every page. On a
              document that will be photocopied and stapled into other people's
              files, the identifier belongs at the top as well as the foot. */}
          <Text style={styles.docKicker}>
            {reference ? reference : "ISSUED IN NIGERIA"}
          </Text>
        </View>
      </View>
      <View style={styles.mastheadRule} />
      <View style={styles.mastheadHairline} />
    </View>
  );
}

function Footer({ serial }: { serial: string | null }) {
  return (
    <View style={styles.footer} fixed>
      {/* The serial repeats on every page so a single detached sheet can still be
          traced back to the document it came from. */}
      <Text style={styles.footerSerial}>{serial ?? "Unsigned summary"}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
      <Text style={styles.footerText}>TarragonHealth · tarragonhealth.ng</Text>
    </View>
  );
}

function SectionHead({ title, count }: { title: string; count?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

function Row({
  label,
  value,
  note,
  index,
}: {
  label: string;
  value: string;
  note?: string | null;
  index: number;
}) {
  return (
    <View style={index % 2 === 1 ? [styles.row, styles.rowAlt] : styles.row} wrap={false}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * The panel that makes this a credential rather than a printout.
 *
 * Placed on page one and given the most visual weight on it, because the reader
 * this document has to win over is deciding whether to believe it before they
 * read a single clinical fact.
 */
function VerificationPanel({ credential }: { credential: PassportCredentialView }) {
  return (
    <View style={[styles.card, styles.cardAccent]} wrap={false}>
      <Text style={styles.cardLabel}>VERIFY THIS DOCUMENT</Text>
      <View style={styles.verifyRow}>
        {credential.verifyQrDataUri && (
          <Image style={styles.qr} src={credential.verifyQrDataUri} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.verifyHeading}>
            Confirm this record is genuine, in about ten seconds
          </Text>
          <Text style={styles.verifyBody}>
            Scan the code, or open the address below and enter the reference. No account and no
            login is needed. You will be told whether TarragonHealth issued this document, whether
            it is still current or has been withdrawn, and which doctor attested it.
          </Text>
          <Text style={styles.serial}>{credential.serial}</Text>
          <Text style={styles.url}>{credential.verifyUrl}</Text>
          <Text style={[styles.rowNote, { marginTop: 6 }]}>
            Document fingerprint {shortDigest(credential.contentDigest)} · Issued{" "}
            {formatDate(credential.issuedAt)} · Valid until {formatDate(credential.expiresAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Who stands behind the clinical content — or the plain statement that nobody
 * does yet.
 *
 * Both states are rendered with equal prominence on purpose. The failure mode
 * this guards against is not a false attestation (the database will not store an
 * attestation without a real doctor and a real registration number); it is a
 * reader assuming one because the document looks official. So the unattested
 * case says what the document IS and what it is NOT, in the same box, in the
 * same size type.
 */
function AttestationPanel({ credential }: { credential: PassportCredentialView }) {
  if (!credential.attestation) {
    return (
      <View style={[styles.card, styles.cardNeutral]} wrap={false}>
        <Text style={styles.cardLabel}>CLINICAL ATTESTATION</Text>
        <Text style={styles.attestName}>Not clinician-attested</Text>
        <Text style={[styles.verifyBody, { marginTop: 4 }]}>
          This is a signed export of the health record TarragonHealth holds for this person. The
          signature proves TarragonHealth issued it and that nothing in it has been altered since.
          It is not a doctor&rsquo;s opinion, a fitness-to-work statement or a medical examination.
          If you need a named, registered doctor to attest this record, the patient can request that
          from their TarragonHealth account and be issued a replacement that carries it.
        </Text>
      </View>
    );
  }

  const a = credential.attestation;
  return (
    <View style={[styles.card, styles.cardAccent]} wrap={false}>
      <Text style={styles.cardLabel}>CLINICAL ATTESTATION</Text>
      <Text style={styles.attestName}>Dr. {a.doctorName}</Text>
      <Text style={styles.attestReg}>
        Registration {formatRegistration(a.credentialType, a.credentialNumber)}
      </Text>
      <Text style={styles.attestMeta}>
        Reviewed this record and attested it on {formatDate(a.attestedAt)}.
      </Text>
      {a.statement ? <Text style={styles.attestQuote}>{a.statement}</Text> : null}
      <Text style={[styles.rowNote, { marginTop: 7 }]}>
        The registration number above is printed exactly as held on this doctor&rsquo;s
        TarragonHealth staff record and is shown again on the verification page.
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------- document

export function HealthPassportDocument({
  patientName,
  data,
  documentTitle = "Health Passport",
  credential = null,
  lockupPng = null,
}: {
  patientName: string;
  data: HealthPassportData;
  /**
   * Reused verbatim by the quarterly report and the health-check report — same
   * layout, same data shape (just a shorter period window), different title so
   * each reads as its own named artifact rather than a re-skinned Health
   * Passport. Those two pass no credential and render as plain summaries.
   */
  documentTitle?: string;
  credential?: PassportCredentialView | null;
  /** The Guard Leaf lockup PNG. Null degrades to a typeset wordmark. */
  lockupPng?: Buffer | null;
}) {
  const periodLabel = `${formatDate(data.periodStart)} to ${formatDate(data.periodEnd)}`;
  const serial = credential?.serial ?? null;
  const hasVitals = data.vitals.length > 0 || data.bmi !== null;

  const protocolRegistration = data.protocolAuthor
    ? formatRegistration(data.protocolAuthor.credentialType, data.protocolAuthor.credentialNumber)
    : null;
  const protocolLine = data.protocolAuthor
    ? `Care protocols supervised by Dr. ${data.protocolAuthor.fullName}${
        protocolRegistration ? ` (${protocolRegistration})` : ""
      }.`
    : "Care protocols supervised by this care team's Clinical Director.";

  return (
    <Document
      title={`${documentTitle}: ${patientName}${serial ? ` (${serial})` : ""}`}
      author="TarragonHealth"
      subject={
        credential
          ? `Signed TarragonHealth ${documentTitle}, reference ${credential.serial}. Verify at ${credential.verifyUrl}`
          : `TarragonHealth ${documentTitle} for ${patientName}`
      }
      creator="TarragonHealth"
      producer="TarragonHealth"
      // The whole credential, embedded in the file's own metadata. A verifier
      // with any PDF tool can lift it out and check the signature offline without
      // needing to scan anything or read a wrapped block of base64 off a page.
      keywords={credential?.compact ?? undefined}
    >
      <Page size="A4" style={styles.page}>
        <Masthead title={documentTitle} lockupPng={lockupPng} reference={serial} />
        <Footer serial={serial} />

        <View style={styles.body}>
          <View style={styles.subjectRow}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.subjectName}>{patientName}</Text>
              <Text style={styles.subjectMeta}>
                {credential?.subjectDateOfBirth
                  ? `Date of birth ${formatDate(credential.subjectDateOfBirth)}`
                  : "Date of birth not recorded"}
                {credential?.subjectPatientRef ? ` · Patient reference ${credential.subjectPatientRef}` : ""}
              </Text>
            </View>
            <View>
              <Text style={[styles.subjectMeta, { textAlign: "right" }]}>Record period</Text>
              <Text style={[styles.rowValue, { fontFamily: "Helvetica-Bold" }]}>{periodLabel}</Text>
            </View>
          </View>

          {credential ? (
            <>
              <VerificationPanel credential={credential} />
              <AttestationPanel credential={credential} />
            </>
          ) : (
            <View style={[styles.card, styles.cardNeutral]} wrap={false}>
              <Text style={styles.cardLabel}>ABOUT THIS DOCUMENT</Text>
              <Text style={styles.verifyBody}>
                A summary of the health record TarragonHealth holds for this person over the period
                shown. This copy carries no verification reference, so it cannot be checked by a
                third party. For a document an employer, clinic or embassy can verify, issue a
                Health Passport from the TarragonHealth account instead.
              </Text>
            </View>
          )}

          {/* What is in here, at a glance. On a credential the cover page has a
              job of its own — an official decides whether to trust the document
              before reading a single reading — so the record itself starts on a
              fresh page rather than crowding in underneath the attestation. */}
          <View style={styles.contents} wrap={false}>
            {[
              { n: data.vitals.length + (data.bmi !== null ? 1 : 0), label: "Vitals tracked" },
              { n: data.screenings.length, label: "Preventive screenings" },
              { n: data.labReadings.length, label: "Laboratory results" },
              { n: data.reviewedEscalations.length, label: "Doctor-reviewed cases" },
            ].map((cell) => (
              <View key={cell.label} style={styles.contentsCell}>
                <Text style={styles.contentsNum}>{cell.n}</Text>
                <Text style={styles.contentsLabel}>{cell.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.rowNote, { marginTop: 8, lineHeight: 1.5 }]}>
            {protocolLine} This is a summary of what TarragonHealth holds, not a complete medical
            record, and it does not replace a receiving clinician&rsquo;s own assessment.
          </Text>

          {/* The plain-English framing, on the cover where a first-time reader
              will actually meet it. Everyone downstream of this document has a
              different reason to be holding it, and the commonest failure is not
              disbelief but over-reading: treating a health record as a fitness
              certificate. Saying so here costs nothing and prevents that. */}
          <View style={[styles.card, styles.cardNeutral, { marginTop: 16 }]} wrap={false}>
            <Text style={styles.cardLabel}>WHAT THIS DOCUMENT IS</Text>
            <Text style={styles.verifyBody}>
              TarragonHealth is a Nigerian chronic-care and preventive-health platform. It operates
              no clinics; it coordinates a person&rsquo;s care between their doctors, laboratories
              and pharmacies, and holds the record that results. This is that record for the period
              shown, issued as a document you can check for yourself, so that you do not have to
              take a printout on trust. The &ldquo;How to verify&rdquo; page at the back explains
              what that check does and does not establish.
            </Text>
          </View>
        </View>

        <View style={styles.body} break>
          {/* -------------------------------------------------------- vitals */}
          <View style={styles.section}>
            <SectionHead
              title="Vitals"
              count={hasVitals ? `${data.vitals.length} measure${data.vitals.length === 1 ? "" : "s"} tracked` : undefined}
            />
            {!hasVitals && <Text style={styles.empty}>No vitals were logged in this period.</Text>}
            {data.bmi !== null && <Row index={0} label="BMI" value={`${data.bmi} kg/m²`} />}
            {data.vitals.map((v, i) => (
              <Row
                key={v.vitalType}
                index={data.bmi !== null ? i + 1 : i}
                label={VITAL_LABEL[v.vitalType] ?? humanise(v.vitalType)}
                value={formatVitalValue(v.vitalType, v.latest)}
                note={`${v.readingCount} reading${v.readingCount === 1 ? "" : "s"} this period · most recent ${formatDate(v.takenAt)}`}
              />
            ))}
          </View>

          {/* --------------------------------------------------- screenings */}
          <View style={styles.section}>
            <SectionHead
              title="Preventive screenings"
              count={data.screenings.length > 0 ? `${data.screenings.length} on record` : undefined}
            />
            {data.screenings.length === 0 && (
              <Text style={styles.empty}>No screenings fell due in this period.</Text>
            )}
            {data.screenings.map((s, i) => (
              <Row
                key={`${s.screenTypeName}-${i}`}
                index={i}
                label={s.screenTypeName}
                value={humanise(s.status)}
                note={
                  s.resultStatus
                    ? `Result: ${humanise(s.resultStatus)}${s.resultSummary ? `. ${s.resultSummary}` : ""}`
                    : `Due ${formatDate(s.dueDate)}`
                }
              />
            ))}
          </View>

          {/* -------------------------------------------------------- labs */}
          <View style={styles.section}>
            <SectionHead
              title="Laboratory results"
              count={data.labReadings.length > 0 ? `${data.labReadings.length} on record` : undefined}
            />
            {data.labReadings.length === 0 && (
              <Text style={styles.empty}>No laboratory results are on file for this period.</Text>
            )}
            {data.labReadings.map((r, i) => (
              <Row
                key={`${r.code}-${i}`}
                index={i}
                label={labResultLabel(r.code)}
                value={
                  r.code === "hba1c" ? formatHba1cWithBracket(r.value) : `${r.value} ${r.unit}`
                }
                note={`Taken ${formatDate(r.takenAt)}`}
              />
            ))}
          </View>

          {/* --------------------------------------------------- escalations */}
          {data.reviewedEscalations.length > 0 && (
            <View style={styles.section}>
              <SectionHead
                title="Reviewed by a doctor"
                count={`${data.reviewedEscalations.length} case${data.reviewedEscalations.length === 1 ? "" : "s"}`}
              />
              {data.reviewedEscalations.map((esc, i) => (
                <Row
                  key={esc.id}
                  index={i}
                  label={esc.reason}
                  value={formatDate(esc.reviewedAt)}
                  note="Escalated and closed by a member of the care team"
                />
              ))}
            </View>
          )}
        </View>
      </Page>

      {/* ------------------------------------------------------- verification page */}
      {credential && (
        <Page size="A4" style={styles.page}>
          <Masthead title="How to verify" lockupPng={lockupPng} reference={serial} />
          <Footer serial={serial} />

          <View style={[styles.body, { paddingTop: 24 }]}>
            <Text style={styles.h2}>For the organisation receiving this document</Text>
            <Text style={styles.para}>
              This page is written for whoever is checking this record: an admissions officer, an
              employer, a clinic, a consulate. It explains what can be confirmed, what cannot, and
              how to confirm it without contacting TarragonHealth at all.
            </Text>

            <View style={styles.step}>
              <Text style={styles.stepNum}>1</Text>
              <Text style={styles.stepText}>
                Open {credential.verifyUrl} or scan the code on the first page. The page opens with
                no account and no login.
              </Text>
            </View>
            <View style={styles.step}>
              <Text style={styles.stepNum}>2</Text>
              <Text style={styles.stepText}>
                Check the status. Genuine and current documents show as valid. A document that has
                been replaced by a newer one, withdrawn by the patient, corrected by the care team,
                or that has passed its expiry date will say so and explain which.
              </Text>
            </View>
            <View style={styles.step}>
              <Text style={styles.stepNum}>3</Text>
              <Text style={styles.stepText}>
                Confirm the person. Enter the date of birth printed on the first page. The full
                legal name is shown only to someone who can already state it, so a link on its own
                identifies nobody. Check that the name matches the person and the document in front
                of you.
              </Text>
            </View>
            <View style={styles.step}>
              <Text style={styles.stepNum}>4</Text>
              <Text style={styles.stepText}>
                Compare the document fingerprint, {shortDigest(credential.contentDigest)}, against
                the one shown on the verification page. If they match, the clinical content of this
                copy is exactly what was issued.
              </Text>
            </View>

            <Text style={[styles.h2, { marginTop: 14 }]}>What the signature does and does not prove</Text>
            <Text style={styles.para}>
              It proves that TarragonHealth issued this document, on the date shown, for the person
              named, and that not one character of it has changed since. It proves the clinical
              content matches what was recorded at the moment of issue.
            </Text>
            <Text style={styles.para}>
              It does not prove that a doctor examined this person, unless the attestation block on
              the first page names one. It is not a fitness-to-work or fitness-to-travel
              certificate, and it does not replace an examination that your own process requires.
              TarragonHealth operates no clinics; this is the record it holds and coordinates
              around, issued in a form you can check.
            </Text>

          </View>
        </Page>
      )}

      {/* The cryptographic appendix gets a page of its own rather than being
          squeezed under the guidance. It is written for a different reader —
          someone building a check into their own process, not someone doing one
          today — and a credential block that orphans three lines onto a stray
          page reads as a printing fault on a document whose whole job is to look
          trustworthy. */}
      {credential && (
        <Page size="A4" style={styles.page}>
          <Masthead title="Verification appendix" lockupPng={lockupPng} reference={serial} />
          <Footer serial={serial} />

          <View style={[styles.body, { paddingTop: 24 }]}>
            <Text style={styles.h2}>Checking it yourself, offline</Text>
            <Text style={styles.para}>
              The block below is the complete credential: the signed claims and an Ed25519 signature
              over them. Fetch the matching public key once from
              https://{"tarragonhealth.ng"}/.well-known/tarragon-passport-keys.json (key{" "}
              {credential.signingKid}) and you can verify this and every future TarragonHealth
              document with standard cryptographic tooling, with no further contact with us and no
              dependency on our systems staying online.
            </Text>
            <Text style={styles.para}>
              Verify the signature over the base64url-decoded payload segment exactly as it appears,
              byte for byte. Parsing the JSON and re-serialising it reorders the keys and the check
              will fail. The signature covers the canonical bytes, not the parsed object.
            </Text>

            <View style={styles.kv}>
              <Text style={styles.kvKey}>Algorithm</Text>
              <Text style={styles.kvVal}>{credential.algorithm}</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Key id</Text>
              <Text style={styles.kvVal}>{credential.signingKid}</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Content digest</Text>
              <Text style={styles.kvVal}>sha256:{credential.contentDigest}</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Reference</Text>
              <Text style={styles.kvVal}>{credential.serial}</Text>
            </View>

            {credential.offlineQrDataUri && (
              <View style={{ flexDirection: "row", gap: 14, marginTop: 12 }} wrap={false}>
                <Image style={{ width: 96, height: 96 }} src={credential.offlineQrDataUri} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>THE CREDENTIAL, MACHINE-READABLE</Text>
                  <Text style={[styles.verifyBody, { marginTop: 2 }]}>
                    Scanning this code gives you the complete signed credential without typing
                    anything. It is also embedded in this PDF&rsquo;s own metadata, so any PDF tool
                    can lift it out, and it is printed in full below for a reader with neither.
                  </Text>
                </View>
              </View>
            )}

            {/* Printed at full width and in one flowing block: a wrapped column
                next to the QR ran ~40% longer and orphaned its last few lines
                onto a page of their own, which looks like a printing fault on a
                document whose entire job is to look trustworthy. */}
            <Text style={[styles.cardLabel, { marginTop: 12 }]}>CREDENTIAL, IN FULL</Text>
            {credential.compact ? (
              chunk(credential.compact, 92).map((line, i) => (
                <Text key={i} style={styles.mono}>
                  {line}
                </Text>
              ))
            ) : (
              <Text style={styles.empty}>Not available for this document.</Text>
            )}
          </View>
        </Page>
      )}
    </Document>
  );
}
