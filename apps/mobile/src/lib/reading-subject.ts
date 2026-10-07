import { loadPeopleISupport } from "./acting";

/**
 * Whose device or reading is this? (S70a, 18.1, shared phones). One phone is often used by a family: the signed-in person, and people they
 * look after. A device is paired TO a person, and a reading is saved FOR a person, so the pairing and photo screens ask. Only people the
 * signed-in user may act for with manage access are offered (a view-only supporter cannot add readings); the server checks the same thing
 * again, so this list only keeps a refusal from being the first the person hears of it.
 */
export interface ReadingSubject {
  profileId: string;
  label: string;
  isSelf: boolean;
}

export interface SupportedPersonLike {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
}

export function buildSubjects(selfId: string, supported: readonly SupportedPersonLike[]): ReadingSubject[] {
  const people = supported
    .filter((p) => p.permissionLevel === "manage" && p.profileId !== selfId)
    .map((p) => ({ profileId: p.profileId, label: p.fullName?.trim() || "Someone you support", isSelf: false }));
  return [{ profileId: selfId, label: "Mine", isSelf: true }, ...people];
}

/** Falls back to just the person themselves when the list cannot be loaded: a shared-phone picker is a convenience, never a gate. */
export async function loadReadingSubjects(selfId: string): Promise<ReadingSubject[]> {
  try {
    return buildSubjects(selfId, await loadPeopleISupport(selfId));
  } catch {
    return buildSubjects(selfId, []);
  }
}

/** Which of the people on this phone have a device paired with this Bluetooth id, so an incoming reading asks "whose is this?" only when it must. */
export function ownersOfDevice(bleDeviceId: string, devices: readonly { ble_device_id: string; patient_id: string }[]): string[] {
  return [...new Set(devices.filter((d) => d.ble_device_id === bleDeviceId).map((d) => d.patient_id))];
}
