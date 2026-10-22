/**
 * The immunisation card shown in the My Health hub, on the web and on the phone (S09y). Read-only: it reads the vaccination module's own records and
 * schedules and adds nothing to them. Each dose says how far it can be trusted: only a dose a care-team doctor verified is called verified; a dose the
 * patient typed in, or a photo of a card still waiting for a doctor, says so. Pure so it is unit tested.
 */
export type DoseTrust = "verified" | "waiting" | "self_reported" | "rejected";

export interface DoseInput {
  id: string;
  vaccine: string;
  doseNumber: number;
  dateAdministered: string;
  provider: string | null;
  verificationStatus: string;
  certificateSerial: string | null;
}

export interface NextDoseInput {
  vaccine: string;
  dueDate: string;
}

export interface ImmunisationCard {
  vaccines: { vaccine: string; doses: { id: string; doseNumber: number; date: string; provider: string | null; trust: DoseTrust; serial: string | null }[] }[];
  next: { vaccine: string; dueDate: string }[];
  /** `rejected` counts certificates a doctor did not accept: they are not listed as doses, but the card says how many there are so a dose never just vanishes. */
  counts: { total: number; verified: number; notVerified: number; rejected: number };
}

export function doseTrust(status: string): DoseTrust {
  if (status === "verified") return "verified";
  if (status === "pending_verification") return "waiting";
  if (status === "rejected") return "rejected";
  return "self_reported";
}

export function buildImmunisationCard(doses: readonly DoseInput[], next: readonly NextDoseInput[]): ImmunisationCard {
  const byVaccine = new Map<string, ImmunisationCard["vaccines"][number]>();
  for (const d of [...doses].sort((a, b) => a.dateAdministered.localeCompare(b.dateAdministered) || a.doseNumber - b.doseNumber)) {
    // A rejected certificate is not shown as a dose on the card: it was not accepted, and the card is something a person hands to a clinic.
    if (d.verificationStatus === "rejected") continue;
    const entry = byVaccine.get(d.vaccine) ?? { vaccine: d.vaccine, doses: [] };
    entry.doses.push({
      id: d.id,
      doseNumber: d.doseNumber,
      date: d.dateAdministered,
      provider: d.provider,
      trust: doseTrust(d.verificationStatus),
      // The Tarragon certificate serial only ever accompanies a verified dose.
      serial: d.verificationStatus === "verified" ? d.certificateSerial : null,
    });
    byVaccine.set(d.vaccine, entry);
  }
  const vaccines = [...byVaccine.values()].sort((a, b) => a.vaccine.localeCompare(b.vaccine));
  const shown = vaccines.flatMap((v) => v.doses);
  return {
    vaccines,
    next: [...next].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    counts: {
      total: shown.length,
      verified: shown.filter((d) => d.trust === "verified").length,
      notVerified: shown.filter((d) => d.trust !== "verified").length,
      rejected: doses.filter((d) => d.verificationStatus === "rejected").length,
    },
  };
}
