import type { Enums } from "@tarragon/shared";
import type { BadgeProps } from "@/components/ui/badge";
import type {
  DeviceDiagnosisResult,
  PatientDeviceDiagnosis,
  WearableConnectionDiagnosis,
} from "@/lib/queries/device-diagnosis";

/**
 * Plain-language rendering for 55.12's auto-diagnosis — shared between the
 * on-screen list (device-sync-support-card.tsx) and the pre-filled message
 * sent to the care team, so a patient never has to re-describe what the
 * screen already showed them.
 */

export const WEARABLE_PROVIDER_LABEL: Record<Enums<"wearable_provider">, string> = {
  apple_health: "Apple Health",
  oura: "Oura",
  whoop: "WHOOP",
  garmin: "Garmin",
  fitbit: "Fitbit",
  dexcom: "Dexcom (CGM)",
  libre: "FreeStyle Libre",
  android_health_connect: "Health Connect",
};

export const PATIENT_DEVICE_TYPE_LABEL: Record<Enums<"patient_device_type">, string> = {
  bp_cuff: "BP cuff",
  glucometer: "Glucometer",
  scale: "Weight scale",
  thermometer: "Thermometer",
  pulse_oximeter: "Pulse oximeter",
  smart_band: "Smart band",
};

export interface DiagnosisItem {
  id: string;
  name: string;
  summary: string;
  hasIssue: boolean;
  badgeVariant: NonNullable<BadgeProps["variant"]>;
  badgeLabel: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  });
}

export function formatConnectionDiagnosis(c: WearableConnectionDiagnosis): DiagnosisItem {
  const name = WEARABLE_PROVIDER_LABEL[c.provider] ?? c.provider;

  if (c.status === "disconnected") {
    return {
      id: c.id,
      name,
      summary: "Not connected right now.",
      hasIssue: false,
      badgeVariant: "grey",
      badgeLabel: "Disconnected",
    };
  }

  if (c.status === "error" || c.last_sync_error) {
    const since = c.last_synced_at
      ? `Hasn't synced since ${timeAgo(c.last_synced_at)}.`
      : "Has never synced successfully.";
    return {
      id: c.id,
      name,
      summary: c.last_sync_error ? `${since} Error: ${c.last_sync_error}` : since,
      hasIssue: true,
      badgeVariant: "red",
      badgeLabel: "Not syncing",
    };
  }

  return {
    id: c.id,
    name,
    summary: c.last_synced_at
      ? `Last synced ${timeAgo(c.last_synced_at)}. No errors.`
      : "Connected — waiting for the first sync.",
    hasIssue: false,
    badgeVariant: "green",
    badgeLabel: "Connected",
  };
}

export function formatDeviceDiagnosis(d: PatientDeviceDiagnosis): DiagnosisItem {
  const typeLabel = PATIENT_DEVICE_TYPE_LABEL[d.device_type] ?? d.device_type;
  const name = d.nickname ? `${d.nickname} (${typeLabel})` : typeLabel;

  if (d.status === "unpaired") {
    return {
      id: d.id,
      name,
      summary: "Unpaired — not connected to your account.",
      hasIssue: false,
      badgeVariant: "grey",
      badgeLabel: "Unpaired",
    };
  }

  if (d.last_sync_error) {
    const since = d.last_synced_at
      ? `Hasn't synced since ${timeAgo(d.last_synced_at)}.`
      : "Has never synced successfully.";
    return {
      id: d.id,
      name,
      summary: `${since} Error: ${d.last_sync_error}`,
      hasIssue: true,
      badgeVariant: "red",
      badgeLabel: "Not syncing",
    };
  }

  return {
    id: d.id,
    name,
    summary: d.last_synced_at
      ? `Last synced ${timeAgo(d.last_synced_at)}. No errors.`
      : "Paired — waiting for the first reading.",
    hasIssue: false,
    badgeVariant: "green",
    badgeLabel: "Working",
  };
}

/** Builds the subject/body for a new care-team thread, pre-filled entirely
 * from the diagnosis already on screen — the literal "reduces unnecessary
 * support questioning" requirement in spec 55.12. */
export function buildDiagnosisMessage(result: DeviceDiagnosisResult): {
  subject: string;
  body: string;
} {
  const items: DiagnosisItem[] = [
    ...result.connections.map(formatConnectionDiagnosis),
    ...result.devices.map(formatDeviceDiagnosis),
  ];
  const flagged = items.filter((i) => i.hasIssue);

  let subject: string;
  if (flagged.length === 1) {
    subject = `Device sync issue: ${flagged[0].name}`;
  } else if (flagged.length > 1) {
    subject = "Device sync issue: multiple devices";
  } else if (items.length > 0) {
    subject = "Device sync issue";
  } else {
    subject = "Device sync issue: no devices connected";
  }

  const intro =
    "I'm having trouble with my device syncing. Here's what my app shows for my devices right now (filled in automatically, so you don't need to ask):";
  const lines =
    items.length > 0
      ? items.map((i) => `- ${i.name}: ${i.summary}`)
      : ["- I don't have any wearables or Bluetooth devices connected to my account."];

  return { subject, body: [intro, "", ...lines].join("\n") };
}
