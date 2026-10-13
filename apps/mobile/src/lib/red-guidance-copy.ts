import { t } from "@tarragon/i18n";

/**
 * Two-tier (CMO 2026-10-08): the status box on the red screen. doctorReview is whether this patient's red event reaches a doctor
 * (a Member): true says the care team was told, false says in plain words that no doctor was alerted because they are on the Free
 * plan, null (could not be worked out, for example offline) makes no claim either way. A Free patient also gets the recheck
 * line, the emergency-contact line when a contact is saved, and a route to Membership that never blocks the guidance.
 */
export interface RedGuidanceStatus {
  tone: "ok" | "warn" | "plain";
  lines: string[];
  showJoin: boolean;
}

export function redGuidanceStatus(doctorReview: boolean | null, synced: boolean, hasEmergencyContact: boolean): RedGuidanceStatus {
  if (doctorReview === false) {
    const lines = [t("freered.no_doctor", "en"), t("freered.recheck", "en")];
    if (hasEmergencyContact) lines.push(t("freered.contact", "en"));
    return { tone: "plain", lines, showJoin: true };
  }
  if (doctorReview === true) {
    return {
      tone: synced ? "ok" : "warn",
      lines: [
        synced
          ? "Your care team has been notified and will follow up."
          : "We'll notify your care team as soon as you're back online. Call now if you need help sooner. Your reading is saved and won't be lost.",
      ],
      showJoin: false,
    };
  }
  return { tone: "plain", lines: ["Your reading is saved. Please do not wait to hear from us before you get care."], showJoin: false };
}
