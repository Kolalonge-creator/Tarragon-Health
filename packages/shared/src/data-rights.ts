/**
 * What a patient sees about their consent receipts, data export and account deletion (S04b-2; OQ-49, OQ-50, OQ-53).
 *
 * One place for the wording and the state rules so web and mobile cannot disagree with each other or with the database.
 * Plain English only. No clinical record is deleted by the deletion flow: it closes the account and removes what the law
 * allows to be removed, and says plainly what is kept.
 */
import { getProposedConfig } from "./proposed-config";

const LAGOS = "Africa/Lagos";
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatLagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: LAGOS, day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ consent receipts */

export interface ConsentReceiptRow {
  id: string;
  consent_type: string;
  action: string;
  version: string;
  title: string;
  body: string;
  channel: string;
  consented_by_relation: string;
  recorded_at: string;
  text_sha256: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  web: "on the website",
  mobile: "in the app",
  staff_assisted: "with help from our team",
  system: "recorded by our system",
  unknown: "(how it was recorded was not kept)",
};

const WHO_LABEL: Record<string, string> = {
  self: "You",
  guardian: "A guardian on your behalf",
  staff: "Our team on your behalf",
  system: "Our system",
};

export function receiptChannelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? CHANNEL_LABEL.unknown!;
}

export function receiptWhoLabel(relation: string): string {
  return WHO_LABEL[relation] ?? WHO_LABEL.self!;
}

/** One line a person can read: who, what, which version, when, where. */
export function receiptSentence(
  row: Pick<ConsentReceiptRow, "action" | "title" | "version" | "recorded_at" | "channel" | "consented_by_relation">
): string {
  const verb = row.action === "withdrawn" ? "withdrew" : "agreed to";
  return `${receiptWhoLabel(row.consented_by_relation)} ${verb} "${row.title}" (version ${row.version}) on ${formatLagosDate(row.recorded_at)}, ${receiptChannelLabel(row.channel)}.`;
}

/* ------------------------------------------------------------------ export */

export interface ExportRequestLike {
  status: string;
  requested_at: string;
  due_at: string;
  fulfilled_at: string | null;
}

export type ExportPhase = "waiting" | "ready" | "expired" | "declined";

export interface ExportRequestView {
  phase: ExportPhase;
  canDownload: boolean;
  headline: string;
  detail: string;
}

/** How many days a fulfilled export stays downloadable: the security rules' export_review_days (the database reads the same row). */
export function exportDownloadDays(): number {
  const rules = getProposedConfig("security.rules").value as { export_review_days?: number };
  return rules.export_review_days ?? 30;
}

export function exportRequestView(row: ExportRequestLike, now: number = Date.now()): ExportRequestView {
  if (row.status === "denied") {
    return { phase: "declined", canDownload: false, headline: "We could not prepare this one", detail: "Our team has written back about why. You can ask again at any time." };
  }
  if (row.status === "fulfilled" && row.fulfilled_at) {
    const expiresAt = Date.parse(row.fulfilled_at) + exportDownloadDays() * DAY_MS;
    if (now < expiresAt) {
      return {
        phase: "ready",
        canDownload: true,
        headline: "Your data is ready",
        detail: `You can download it until ${formatLagosDate(new Date(expiresAt).toISOString())}. After that, ask again.`,
      };
    }
    return { phase: "expired", canDownload: false, headline: "This copy has expired", detail: "Ask again and we will prepare a fresh copy." };
  }
  return {
    phase: "waiting",
    canDownload: false,
    headline: row.status === "under_review" ? "Our team is preparing your data" : "We have your request",
    detail: `A person on our team checks every request before anything is released. We aim to have it ready by ${formatLagosDate(row.due_at)}, and often sooner.`,
  };
}

/* ------------------------------------------------------------------ deletion */

export interface DeletionRequestLike {
  status: string;
  requested_at: string;
  grace_ends_at: string | null;
}

export type DeletionPhase = "waiting" | "in_review" | "done" | "cancelled" | "declined";

export interface DeletionRequestView {
  phase: DeletionPhase;
  canCancel: boolean;
  daysLeft: number | null;
  headline: string;
  detail: string;
}

/** The waiting period the app asks for. The database holds any request to 7..30 days whatever is sent. */
export function deletionGraceDays(): number {
  const v = getProposedConfig("privacy.deletion_grace").value as { days?: number };
  return v.days ?? 14;
}

/** The grace_ends_at to send with a new request. */
export function deletionGraceEndsAt(now: number = Date.now()): string {
  return new Date(now + deletionGraceDays() * DAY_MS).toISOString();
}

export function deletionRequestView(row: DeletionRequestLike, now: number = Date.now()): DeletionRequestView {
  const ends = row.grace_ends_at ? Date.parse(row.grace_ends_at) : null;
  const inGrace = ends !== null && now < ends;
  const daysLeft = inGrace && ends !== null ? Math.max(1, Math.ceil((ends - now) / DAY_MS)) : null;
  switch (row.status) {
    case "cancelled":
      return { phase: "cancelled", canCancel: false, daysLeft: null, headline: "You cancelled this request", detail: "Nothing was changed on your account." };
    case "denied":
      return { phase: "declined", canCancel: false, daysLeft: null, headline: "We could not go ahead with this request", detail: "Our team has written back about why. Your account is unchanged." };
    case "completed":
      return { phase: "done", canCancel: false, daysLeft: null, headline: "Your account has been closed", detail: "What could be removed has been removed. The records we must keep are listed below." };
    default:
      if (inGrace) {
        return {
          phase: "waiting",
          canCancel: true,
          daysLeft,
          headline: `Your request is waiting, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left to change your mind`,
          detail: `Nothing happens before ${formatLagosDate(row.grace_ends_at as string)}. You can cancel until then and your account stays exactly as it is.`,
        };
      }
      return {
        phase: "in_review",
        canCancel: false,
        daysLeft: null,
        headline: "Our team is reviewing your request",
        detail: "The waiting period is over. A person on our team goes through your request and tells you exactly what was removed and what is kept.",
      };
  }
}

/** What closing an account removes. A person reviews every request; see docs/design/S39d-class-review.md. */
export const DELETION_REMOVED: readonly string[] = [
  "Your sign-in and contact details",
  "Your preferences and reminders",
  "Connected devices and the data they sent",
  "Anything you chose to share, such as with your Care Circle or for research",
];

/** What the law and clinical safety require us to keep. These are never erased by this flow. */
export const DELETION_KEPT: readonly string[] = [
  "Posted clinical records: your results, prescriptions, referrals, consultation notes and care plans",
  "The audit log that records who opened your record and when",
  "Financial and payment ledger entries",
  "Your consent history, so we can show what you agreed to and when",
];
