/**
 * What a Free account sees on Testing days in place of the booking list: which Membership options exist, what each costs and whether it carries
 * the yearly blood panel. Everything comes from the Membership catalogue the shop already reads (prices stored in kobo, shown as naira); nothing
 * is typed here. When the catalogue is closed or unreadable there are no options and the screen shows only the plain "Part of Membership" prompt,
 * never a made-up price. Web and phone share this.
 *
 * T2-01, T2-02, T2-09 (2026-11-04): Membership Plus (the one option that carried the yearly blood panel) and the upgrade to it are retired,
 * and Tarragon testing days are closed to new bookings. An option that includes the panel is therefore never listed, even if a stale
 * catalogue still returns it, so showPanelTests is always false. Neither screen shows this offer any more; it is kept so an old caller
 * cannot bring Plus back.
 */
export interface TestingDaysCatalogueRow {
  code: string;
  kind: string;
  name_key: string;
  amount_kobo: number;
}

export interface TestingDaysOption {
  code: string;
  nameKey: string;
  amountKobo: number;
  panel: boolean;
}

export interface TestingDaysOffer {
  options: TestingDaysOption[];
  /** True when at least one option includes the yearly blood panel, so its test list is worth showing. */
  showPanelTests: boolean;
}

export function testingDaysOffer(
  rows: readonly TestingDaysCatalogueRow[] | null | undefined,
  isPanelIncluded: (code: string) => boolean | null,
  isUpgrade: (code: string) => boolean,
): TestingDaysOffer {
  const options = (rows ?? [])
    .filter((r) => r.kind === "membership" && !isUpgrade(r.code) && isPanelIncluded(r.code) !== true && Number.isInteger(r.amount_kobo) && r.amount_kobo > 0)
    .map((r): TestingDaysOption => ({ code: r.code, nameKey: r.name_key, amountKobo: r.amount_kobo, panel: isPanelIncluded(r.code) === true }))
    .sort((a, b) => a.amountKobo - b.amountKobo);
  return { options, showPanelTests: options.some((o) => o.panel) };
}
