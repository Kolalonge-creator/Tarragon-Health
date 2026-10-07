import { getProposedConfig } from "./proposed-config";

/**
 * S52 (spec 7.8, 7.9, INV-05, INV-06): the assistant's emergency guidance, its limits panel and the helpers that put the nearest
 * hospital in front of a patient. This file is BUNDLED into the web app and the mobile app, so the guidance works with no signal.
 *
 * Nigeria has no usable national crisis helpline, so there is no hotline in this file and none is invented. Any phone number comes from
 * versioned configuration (`assistant.emergency`, PROPOSED, CMO) and is shown only when it has been set. The emergency path points to
 * the NEAREST HOSPITAL (from the patient's state and the facilities we hold), the patient's own emergency contact, and the on-call page
 * the server sends.
 *
 * WORDING STATUS: every sentence below is PROPOSED wording. The self-harm copy in particular is a clinical document and needs the
 * Chief Medical Officer's sign-off before the assistant is switched on (OQ-289). Nothing here is marked approved. Plain, warm, no
 * fear-based urgency, no em dash, "your care team" and never "your doctor".
 */
export const EMERGENCY_BUTTON_LABEL = "Emergency";
export const EMERGENCY_COPY_STATUS = "proposed_awaiting_cmo_signoff" as const;

export const EMERGENCY_GUIDANCE = {
  title: "If this is an emergency",
  lines: [
    "Please go to the nearest hospital now, or ask someone near you to take you.",
    "If you can, bring someone with you and bring your medicines.",
    "Your care team has been told so they can follow up with you.",
  ],
} as const;

/** Self-harm gets its own, calmer copy. PROPOSED, awaiting the CMO (OQ-289). */
export const SELF_HARM_GUIDANCE = {
  title: "You do not have to face this alone",
  lines: [
    "I am really glad you told me. What you are feeling matters, and help is close.",
    "Please go to the nearest hospital now, or ask someone you trust to come and stay with you.",
    "If you have a person you trust, tell them how you are feeling right now.",
    "A clinician on call has been told so that your care team can reach you.",
  ],
} as const;

export const SELF_HARM_REPLY = [...SELF_HARM_GUIDANCE.lines].join(" ");

export const ASSISTANT_LIMITS = {
  title: "What I can and cannot do",
  lines: [
    "I give general guidance from content your care team has reviewed, and I can look at your own record.",
    "I cannot diagnose, I cannot change or suggest a dose, and I do not replace your care team or a hospital.",
    "I do not discuss the result of a screening test for HIV or hepatitis. Your care team does that with you privately.",
    "Every answer shows its sources. If something is wrong, use Report this answer and a clinician will look at it.",
  ],
} as const;

export interface EmergencyHospital {
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
}

export interface EmergencyAddendumInput {
  hospitals: readonly EmergencyHospital[];
  contactName: string | null;
  contactPhone: string | null;
}

/** One line a patient can read aloud to a driver. Never a link. */
export function formatHospitalLine(h: EmergencyHospital): string {
  const place = [h.city, h.address].filter((x): x is string => Boolean(x && x.trim())).join(", ");
  const phone = h.phone && h.phone.trim() ? `, phone ${h.phone.trim()}` : "";
  return `${h.name}${place ? ` (${place})` : ""}${phone}`;
}

/**
 * The part of the emergency reply the server adds after the fixed copy: the nearest hospitals we know of near the patient, and their own
 * saved emergency contact. Empty when there is nothing to add; the fixed copy always stands alone without it.
 */
export function buildEmergencyAddendum(input: EmergencyAddendumInput): string {
  const lines: string[] = [];
  if (input.hospitals.length > 0) {
    lines.push("Hospitals we know of near you:");
    for (const h of input.hospitals) lines.push(`- ${formatHospitalLine(h)}`);
  }
  if (input.contactName && input.contactPhone) {
    lines.push(`Your emergency contact is ${input.contactName}, phone ${input.contactPhone}.`);
  }
  for (const n of emergencyPhoneNumbers()) lines.push(`${n.label}: ${n.number}`);
  return lines.join("\n");
}

export interface EmergencyPhoneNumber {
  label: string;
  number: string;
}

/** Numbers the CMO has put in configuration. Empty today: none is invented or hard-coded. */
export function emergencyPhoneNumbers(): readonly EmergencyPhoneNumber[] {
  const value = getProposedConfig<{ phoneNumbers?: readonly EmergencyPhoneNumber[] }>("assistant.emergency").value;
  const list = (value as { phoneNumbers?: readonly EmergencyPhoneNumber[] }).phoneNumbers ?? [];
  return list.filter((n) => typeof n.label === "string" && typeof n.number === "string" && n.number.trim() !== "");
}

export function nearestHospitalsShown(): number {
  const value = getProposedConfig<{ nearestHospitalsShown?: number }>("assistant.emergency").value as { nearestHospitalsShown?: number };
  return typeof value.nearestHospitalsShown === "number" && value.nearestHospitalsShown > 0 ? value.nearestHospitalsShown : 3;
}
