import { z } from "zod";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

/**
 * Consent receipts as a one-page PDF (RCPT-1). The pure half: it validates what `public.consent_receipt_data` returned and turns it into
 * plain-language lines. Nothing here reads the database. The data holds no health reading or result, only the names of the kinds of
 * information a person chose, so neither does the page.
 *
 * Rules this file keeps:
 *  - wording that counsel has not approved is marked as placeholder on the page, every time;
 *  - a malformed response is an error, never a shorter receipt;
 *  - the file name never carries anything about the person or what they chose.
 */

const DATA_TYPES = ["vitals", "reproductive", "mental_health", "documents", "device_data"] as const;
const PURPOSES = ["care", "care_circle_sharing", "research", "sponsor_reporting"] as const;

const wordingStatus = z.enum(["draft_pending_counsel", "approved"]);

const matrixChange = z.object({
  data_type: z.enum(DATA_TYPES),
  purpose: z.enum(PURPOSES),
  action: z.enum(["granted", "withdrawn"]),
  source: z.string(),
  policy_version: z.number().int(),
  text_key: z.string(),
  wording_status: wordingStatus,
  required_for_care: z.boolean(),
  /** True when the wording now in force is the same version as at the time of the change. */
  wording_current: z.boolean(),
  at: z.string(),
});

const documentChange = z.object({
  consent_type: z.string(),
  action: z.enum(["accepted", "withdrawn"]),
  version: z.string(),
  title: z.string(),
  body: z.string(),
  is_optional: z.boolean(),
  is_draft: z.boolean(),
  text_sha256: z.string().nullable(),
  channel: z.string(),
  consented_by_relation: z.string(),
  at: z.string(),
});

const cell = z.object({
  data_type: z.enum(DATA_TYPES),
  purpose: z.enum(PURPOSES),
  required_for_care: z.boolean(),
  text_key: z.string(),
  wording_status: wordingStatus,
  policy_version: z.number().int(),
  granted: z.boolean(),
  changed_at: z.string().nullable(),
});

const documentInForce = z.object({
  consent_type: z.string(),
  version: z.string(),
  title: z.string(),
  is_optional: z.boolean(),
  is_draft: z.boolean(),
  at: z.string(),
});

const base = { person: z.string().nullable(), generated_at: z.string() };

export const consentReceiptDataSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("matrix_event"), ...base, change: matrixChange }),
  z.object({ scope: z.literal("document_event"), ...base, change: documentChange }),
  z.object({ scope: z.literal("all"), ...base, cells: z.array(cell).max(100), documents: z.array(documentInForce).max(100) }),
]);

export type ConsentReceiptData = z.infer<typeof consentReceiptDataSchema>;

export function parseConsentReceiptData(raw: unknown): ConsentReceiptData | null {
  const parsed = consentReceiptDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface ReceiptLine {
  label: string;
  value: string;
}

export interface ReceiptSection {
  heading: string | null;
  lines: ReceiptLine[];
  /** Text shown under the lines in a quieter style (for example the exact words a person saw). */
  quote?: string;
  /** True when the wording shown here is placeholder and must be marked as such. */
  placeholder: boolean;
}

export interface ReceiptView {
  title: string;
  person: string | null;
  prepared: string;
  sections: ReceiptSection[];
  /** Shown on the page whenever any wording in it is placeholder. Null when none is. */
  placeholderNote: string | null;
  howToWithdraw: string;
  noHealthData: string;
  keepPrivate: string;
}

const LAGOS = "Africa/Lagos";

export function receiptDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: LAGOS, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function receiptDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { timeZone: LAGOS, day: "numeric", month: "short", year: "numeric" });
}

const SOURCE_KEY: Record<string, MessageKey> = {
  patient: "consent.receipt.source.patient",
  bundle: "consent.receipt.source.bundle",
  circle_invite: "consent.receipt.source.circle_invite",
  handover: "consent.receipt.source.handover",
  account_closure: "consent.receipt.source.account_closure",
};

const CHANNEL_KEY: Record<string, MessageKey> = {
  web: "consent.receipt.channel.web",
  mobile: "consent.receipt.channel.mobile",
  staff_assisted: "consent.receipt.channel.staff_assisted",
  system: "consent.receipt.channel.system",
};

const WHO_KEY: Record<string, MessageKey> = {
  self: "consent.receipt.who.self",
  guardian: "consent.receipt.who.guardian",
  staff: "consent.receipt.who.staff",
  system: "consent.receipt.who.system",
};

function dataLabel(type: (typeof DATA_TYPES)[number], locale: Locale): string {
  return t(`consent.data.${type}` as MessageKey, locale);
}
function purposeLabel(purpose: (typeof PURPOSES)[number], locale: Locale): string {
  return t(`consent.purpose.${purpose}` as MessageKey, locale);
}

function wordingLine(status: "draft_pending_counsel" | "approved", locale: Locale): string {
  return status === "approved" ? t("consent.receipt.wording.approved", locale) : t("consent.receipt.wording.placeholder", locale);
}

export function buildConsentReceipt(data: ConsentReceiptData, locale: Locale = "en"): ReceiptView {
  const sections: ReceiptSection[] = [];
  let anyPlaceholder = false;
  let title: string;

  if (data.scope === "matrix_event") {
    const c = data.change;
    title = t("consent.receipt.title.change", locale);
    // The database keeps the wording version on the event but not the wording itself. If the version in force has changed since, say so and
    // show neither today's status nor today's text as if it were what the person saw.
    const placeholder = c.wording_current ? c.wording_status !== "approved" : false;
    anyPlaceholder ||= placeholder;
    sections.push({
      heading: null,
      placeholder,
      lines: [
        { label: t("consent.receipt.what", locale), value: dataLabel(c.data_type, locale) },
        { label: t("consent.receipt.purpose", locale), value: purposeLabel(c.purpose, locale) },
        { label: t("consent.receipt.choice", locale), value: c.action === "granted" ? t("consent.receipt.choice.granted", locale) : t("consent.receipt.choice.withdrawn", locale) },
        { label: t("consent.receipt.when", locale), value: receiptDateTime(c.at) },
        { label: t("consent.receipt.how_recorded", locale), value: t(SOURCE_KEY[c.source] ?? "consent.receipt.source.patient", locale) },
        { label: t("consent.receipt.wording_version", locale), value: String(c.policy_version) },
        { label: t("consent.receipt.wording_status", locale), value: c.wording_current ? wordingLine(c.wording_status, locale) : t("consent.receipt.wording.changed", locale) },
        ...(c.required_for_care ? [{ label: t("consent.receipt.needed", locale), value: t("consent.receipt.needed_value", locale) }] : []),
      ],
      quote: c.wording_current ? t(c.text_key as MessageKey, locale) : undefined,
    });
  } else if (data.scope === "document_event") {
    const c = data.change;
    title = t("consent.receipt.title.change", locale);
    anyPlaceholder ||= c.is_draft;
    sections.push({
      heading: null,
      placeholder: c.is_draft,
      lines: [
        { label: t("consent.receipt.what", locale), value: c.title },
        { label: t("consent.receipt.choice", locale), value: c.action === "withdrawn" ? t("consent.receipt.choice.withdrawn", locale) : t("consent.receipt.choice.granted", locale) },
        { label: t("consent.receipt.when", locale), value: receiptDateTime(c.at) },
        { label: t("consent.receipt.who_chose", locale), value: c.consented_by_relation === "legacy" ? t("consent.receipt.who.legacy", locale) : t(WHO_KEY[c.consented_by_relation] ?? "consent.receipt.who.self", locale) },
        { label: t("consent.receipt.how_recorded", locale), value: c.channel === "unknown" ? t("consent.receipt.channel.unknown", locale) : t(CHANNEL_KEY[c.channel] ?? "consent.receipt.channel.unknown", locale) },
        { label: t("consent.receipt.wording_version", locale), value: c.version },
        ...(c.is_draft ? [{ label: t("consent.receipt.wording_status", locale), value: t("consent.receipt.wording.placeholder", locale) }] : []),
        ...(c.text_sha256 ? [{ label: t("consent.receipt.fingerprint", locale), value: c.text_sha256.replace(/(.{16})(?=.)/g, "$1 ") }] : []),
      ],
      quote: c.body,
    });
  } else {
    title = t("consent.receipt.title.all", locale);
    const byType = new Map<string, typeof data.cells>();
    for (const c of data.cells) byType.set(c.data_type, [...(byType.get(c.data_type) ?? []), c]);
    for (const type of DATA_TYPES) {
      const cells = byType.get(type) ?? [];
      if (cells.length === 0) continue;
      const placeholder = cells.some((c) => c.wording_status !== "approved");
      anyPlaceholder ||= placeholder;
      sections.push({
        heading: placeholder ? `${dataLabel(type, locale)} (${t("consent.receipt.wording.placeholder_short", locale)})` : dataLabel(type, locale),
        placeholder,
        lines: cells.map((c) => ({
          label: purposeLabel(c.purpose, locale),
          value: `${c.granted ? t("consent.receipt.state.on", locale) : t("consent.receipt.state.off", locale)}${c.required_for_care ? `, ${t("consent.receipt.needed_value", locale)}` : ""}${c.changed_at ? `, ${t("consent.receipt.changed", locale)} ${receiptDate(c.changed_at)}` : ""}`,
        })),
      });
    }
    if (data.documents.length > 0) {
      const placeholder = data.documents.some((d) => d.is_draft);
      anyPlaceholder ||= placeholder;
      sections.push({
        heading: placeholder ? `${t("consent.receipt.documents", locale)} (${t("consent.receipt.wording.placeholder_short", locale)})` : t("consent.receipt.documents", locale),
        placeholder,
        lines: data.documents.map((d) => ({
          label: d.title,
          value: `${t("consent.receipt.version_short", locale)} ${d.version}, ${receiptDate(d.at)}${d.is_draft ? `, ${t("consent.receipt.wording.placeholder_short", locale)}` : ""}`,
        })),
      });
    }
  }

  return {
    title,
    person: data.person ? t("consent.receipt.for", locale, { name: data.person }) : null,
    prepared: t("consent.receipt.prepared", locale, { date: receiptDateTime(data.generated_at) }),
    sections,
    placeholderNote: anyPlaceholder ? t("consent.receipt.placeholder_note", locale) : null,
    howToWithdraw: t("consent.receipt.how_to_withdraw", locale),
    noHealthData: t("consent.receipt.no_health_data", locale),
    keepPrivate: t("consent.receipt.keep_private", locale),
  };
}

/** A name that says nothing about the person or what they chose. */
export function receiptFileName(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
  return `consent-receipt-${d}.pdf`;
}
