import type { EmergencyClinicalFacts } from "./card";

/**
 * The offline card's QR carries PLAIN, HUMAN-READABLE TEXT — never a URL, and
 * never base64/compressed binary.
 *
 * This is deliberate, and it's the whole reason the offline card is safer than
 * the live link: any QR-scanner app on any phone (a stranger doctor's own
 * personal phone, no Tarragon app, no internet) shows the content directly as
 * text the instant it scans. A gzip+base64 blob would show as gibberish to
 * every scanner except one we'd have to build ourselves — reintroducing a
 * dependency on software existing at the point of care, which is the exact
 * failure mode "no network, no app" exists to avoid.
 *
 * The printed card ITSELF (not the QR) is the authoritative, complete record —
 * this text is a machine-readable duplicate of what's already legible on the
 * page, so truncating it under space pressure loses nothing a human reading
 * the card doesn't already have in front of them.
 */

/**
 * Conservative byte budget for a QR that still scans reliably at a card-sized
 * print (~4cm square) with ECC level M. Version-40/ECC-L QR codes can hold far
 * more, but this card is meant to survive being folded into a wallet for a
 * year, so keeping well under that ceiling matters more than maximum capacity.
 */
export const QR_TEXT_BYTE_BUDGET = 700;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Hard per-item cap so one unusually long name cannot itself blow the budget. */
const MAX_ITEM_BYTES = 60;

function truncateItem(item: string): string {
  if (byteLength(item) <= MAX_ITEM_BYTES) return item;
  let truncated = item;
  while (byteLength(truncated) > MAX_ITEM_BYTES - 1 && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Join items with "; ", dropping items from the end once the running total
 * would exceed `budget`, and say how many were dropped. `prefix` is charged
 * against the budget too, so the label itself never gets crowded out.
 *
 * Always includes at least one item when the list is non-empty, even if that
 * alone exceeds `budget` — a starved budget should overshoot slightly rather
 * than silently produce an empty list for a real allergy or medicine. Each
 * item is capped to `MAX_ITEM_BYTES` first, so this overshoot is bounded
 * rather than unlimited — a real capacity ceiling for a medium meant to fold
 * into a wallet, not just a soft target.
 */
function fitList(prefix: string, items: string[], budget: number): string {
  if (items.length === 0) return `${prefix}none recorded`;
  const capped = items.map(truncateItem);

  const included: string[] = [];
  for (const item of capped) {
    const candidate = [...included, item].join("; ");
    if (byteLength(prefix + candidate) > budget && included.length > 0) break;
    included.push(item);
  }
  const omitted = items.length - included.length;
  const suffix = omitted > 0 ? ` (+${omitted} more, see printed list)` : "";
  return `${prefix}${included.join("; ")}${suffix}`;
}

/**
 * Build the plain-text QR payload. `printedOn` is the print/generation date,
 * shown so a reader knows how current it might be — the same honesty the
 * printed page itself carries in its footer.
 *
 * PRIORITY ORDER when space runs short (highest first): name/DOB/blood,
 * allergies, contact, footer — these are computed first and their bytes
 * reserved before anything truncatable gets whatever budget is left.
 * Medicines are truncated before allergies; conditions is dropped entirely
 * before either list loses an item, since it is the least decision-critical
 * fact of the set (allergies and current medicines are what change what a
 * stranger does in the next ten minutes; a condition label rarely does).
 */
export function buildEmergencyQrText(facts: EmergencyClinicalFacts, printedOn: string): string {
  const fixedLines: string[] = ["TARRAGONHEALTH EMERGENCY CARD"];
  fixedLines.push(`Name: ${facts.full_name ?? "Not recorded"}`);
  if (facts.date_of_birth) {
    fixedLines.push(`DOB: ${facts.date_of_birth}${facts.sex ? ` (${facts.sex})` : ""}`);
  }
  if (facts.blood?.blood_group || facts.blood?.genotype) {
    const confirmed = facts.blood.provenance === "lab_document";
    const bloodBits = [
      facts.blood.blood_group ?? null,
      facts.blood.genotype ? `Genotype ${facts.blood.genotype}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    fixedLines.push(`Blood: ${bloodBits} (${confirmed ? "lab-confirmed" : "patient-reported, unconfirmed"})`);
  }

  const contactLine = facts.emergency_contact?.name
    ? `Contact: ${[
        facts.emergency_contact.name,
        facts.emergency_contact.relationship ? `(${facts.emergency_contact.relationship})` : null,
        facts.emergency_contact.phone ?? null,
      ]
        .filter(Boolean)
        .join(" ")}`
    : null;

  const footerLines = [`Printed: ${printedOn}`, "Not a substitute for clinical assessment."];

  // Reserve bytes for everything that must survive unabridged BEFORE handing
  // out whatever's left to the truncatable lists — this is the fix for the bug
  // an earlier version had, where allergies and medicines were each given
  // (almost) the full budget independently and could together blow past it.
  const mustSurvive = [...fixedLines, ...(contactLine ? [contactLine] : []), ...footerLines];
  let remaining = QR_TEXT_BYTE_BUDGET - byteLength(mustSurvive.join("\n"));

  const allergyItems = facts.allergies.map((a) => `${a.allergen}${a.severity ? ` (${a.severity})` : ""}`);
  const allergyLine = fitList("Allergies: ", allergyItems, Math.max(remaining, 0));
  remaining -= byteLength(allergyLine) + 1;

  const medicationItems = facts.medications.map((m) => `${m.drug_name}${m.dose ? ` ${m.dose}` : ""}`);
  const medicineLine =
    medicationItems.length > 0 ? fitList("Medicines: ", medicationItems, Math.max(remaining, 0)) : null;
  if (medicineLine) remaining -= byteLength(medicineLine) + 1;

  // Conditions is dropped entirely, not truncated to nothing, once there is
  // essentially no room left — the least essential fact goes first, per the
  // priority order above.
  const conditionItems = facts.conditions.map((c) => c.replace(/_/g, " "));
  const conditionsLine =
    conditionItems.length > 0 && remaining > 20 ? fitList("Conditions: ", conditionItems, remaining) : null;

  return [
    ...fixedLines,
    allergyLine,
    ...(medicineLine ? [medicineLine] : []),
    ...(conditionsLine ? [conditionsLine] : []),
    ...(contactLine ? [contactLine] : []),
    ...footerLines,
  ].join("\n");
}
