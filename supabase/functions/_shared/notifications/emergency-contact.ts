/**
 * S85-D3: the one named SMS exception. A patient triggers an emergency; their own consented emergency contact is told, with
 * no condition, result or reading, to call them. The exact text is signed (D3) and lives only here; the sender template and the
 * tests both read it from this file. Pure code: no network, clock or database.
 */

/** Used when the payload carries no usable name. The DB trigger's own placeholder is treated as "no name". */
const NO_NAME_PLACEHOLDER = "someone who lists you as their emergency contact";

export function emergencyContactName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length === 0 || name === NO_NAME_PLACEHOLDER) return "them";
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/** Exactly: "Tarragon: please call {name} now." */
export function emergencyContactText(rawName: unknown): string {
  return `Tarragon: please call ${emergencyContactName(rawName)} now.`;
}

export interface ContactProfile { readonly id: string; readonly email: string | null }
export interface FanoutRow {
  readonly recipient_id: string;
  readonly organisation_id: string | null;
  readonly channel: "push" | "email" | "in_app";
  readonly template: "emergency_contact_alert";
  readonly priority: "routine";
  readonly payload: Record<string, unknown>;
}

/**
 * Push, email and in-app copies for a contact who is also a Tarragon account (matched by the phone number the patient gave).
 * Same content-free text as the SMS. Never SMS, never guarded: these do not wait for the SMS exception to be proven live.
 * `source` is the SMS row that triggered it, kept in the payload so a retry cannot fan out twice.
 */
export function planContactFanout(input: {
  readonly sourceNotificationId: string;
  readonly organisationId: string | null;
  readonly patientName: unknown;
  readonly patientId: string;
  readonly contact: ContactProfile | null;
}): FanoutRow[] {
  const c = input.contact;
  if (!c || c.id === input.patientId) return [];
  const base = { patient_name: emergencyContactName(input.patientName), source_notification_id: input.sourceNotificationId };
  const row = (channel: FanoutRow["channel"], extra: Record<string, unknown> = {}): FanoutRow => ({
    recipient_id: c.id, organisation_id: input.organisationId, channel, template: "emergency_contact_alert", priority: "routine",
    payload: { ...base, ...extra },
  });
  const rows = [row("push"), row("in_app")];
  if (c.email) rows.push(row("email", { to_email: c.email }));
  return rows;
}
