import { activePatientUser, createPasskeyClient, passkeysAvailable } from "@/lib/passkeys/server";
import { passkeyRules } from "@/lib/passkeys/rules";
import { PasskeysPanel, type PasskeyRow } from "./passkeys-panel";

/**
 * Passkeys (optional), on the patient's own settings. A server component so the list comes from Auth, not from the browser.
 * Shows nothing unless the platform switch is on, or the person already has passkeys (so they can always remove them).
 * Patients only: any other role renders nothing.
 */
export async function PasskeysCard() {
  const who = await activePatientUser();
  if (!who.user) return null;
  const canAdd = await passkeysAvailable();

  let rows: PasskeyRow[] = [];
  try {
    const client = await createPasskeyClient();
    const { data } = await client.auth.passkey.list();
    rows = (data ?? []).map((p) => ({
      id: p.id,
      name: p.friendly_name && p.friendly_name.trim() !== "" ? p.friendly_name : "Passkey",
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at ?? null,
    }));
  } catch {
    rows = [];
  }

  if (!canAdd && rows.length === 0) return null;
  return <PasskeysPanel passkeys={rows} canAdd={canAdd} labelMax={passkeyRules().label_max_chars} />;
}
