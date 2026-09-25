import { attachPharmacyPartners } from "./pharmacy-orders";
import type { PharmacyMedication } from "./pharmacy-orders";

/**
 * pharmacy_partner_directory carries every partner row regardless of
 * is_active (20260925024716_fix_lab_pharmacy_directory_active_filter_and_
 * replay_guard.sql) — a deliberate change from its first version, which was
 * filtered `where is_active` and broke historical attribution elsewhere.
 * attachPharmacyPartners is the one caller that genuinely needs
 * active-only: it feeds a bookable catalogue, not an attribution read, so
 * it has to filter is_active itself rather than rely on the view to do it.
 *
 * Before this fix, a medication belonging to a now-inactive pharmacy
 * partner stayed in the catalogue with `pharmacy_partner: null` — and
 * pharmacy-catalogue.tsx's own "no structured address, don't hide it"
 * location-filter escape hatch matched that null partner too, so the
 * medication stayed visible AND bookable with zero identifying info about
 * which (inactive) partner it would be ordered from. This test proves
 * attachPharmacyPartners now drops that medication outright instead.
 */

type FakeDirectoryRow = {
  id: string;
  name: string | null;
  delivery: boolean | null;
  regions: string[] | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
  city: string | null;
  area: string | null;
  delivery_fee_kobo: number | null;
  is_active: boolean | null;
};

function fakeSupabase(directoryRows: FakeDirectoryRow[]) {
  const calls: { table: string; ids: string[] }[] = [];
  return {
    client: {
      from: (table: string) => ({
        select: () => ({
          in: (_col: string, ids: string[]) => {
            calls.push({ table, ids });
            return Promise.resolve({
              data: directoryRows.filter((r) => ids.includes(r.id)),
              error: null,
            });
          },
        }),
      }),
    } as unknown as Parameters<typeof attachPharmacyPartners>[0],
    calls,
  };
}

function medication(id: string, pharmacyPartnerId: string): PharmacyMedication {
  return {
    id,
    pharmacy_partner_id: pharmacyPartnerId,
    drug_name: `Drug ${id}`,
    pack_size: null,
    price_kobo: 1000,
    is_active: true,
    created_at: "2026-09-01T00:00:00Z",
  } as PharmacyMedication;
}

function directoryRow(id: string, name: string, isActive: boolean): FakeDirectoryRow {
  return {
    id,
    name,
    delivery: true,
    regions: [],
    address: null,
    latitude: null,
    longitude: null,
    state: null,
    city: null,
    area: null,
    delivery_fee_kobo: null,
    is_active: isActive,
  };
}

describe("attachPharmacyPartners", () => {
  it("drops a medication whose pharmacy partner has gone inactive, rather than nulling the partner", async () => {
    const { client } = fakeSupabase([
      directoryRow("partner-active", "Active Pharmacy", true),
      directoryRow("partner-inactive", "Inactive Pharmacy", false),
    ]);

    const result = await attachPharmacyPartners(client, [
      medication("med-1", "partner-active"),
      medication("med-2", "partner-inactive"),
    ]);

    expect(result.map((r) => r.id)).toEqual(["med-1"]);
    expect(result.every((r) => r.pharmacy_partner !== null)).toBe(true);
  });

  it("drops a medication whose partner id has no matching directory row at all", async () => {
    const { client } = fakeSupabase([directoryRow("partner-active", "Active Pharmacy", true)]);

    const result = await attachPharmacyPartners(client, [
      medication("med-1", "partner-active"),
      medication("med-2", "partner-missing"),
    ]);

    expect(result.map((r) => r.id)).toEqual(["med-1"]);
  });

  it("keeps every medication when all partners are active", async () => {
    const { client } = fakeSupabase([
      directoryRow("partner-a", "Pharmacy A", true),
      directoryRow("partner-b", "Pharmacy B", true),
    ]);

    const result = await attachPharmacyPartners(client, [
      medication("med-1", "partner-a"),
      medication("med-2", "partner-b"),
    ]);

    expect(result.map((r) => r.id)).toEqual(["med-1", "med-2"]);
    expect(result.map((r) => r.pharmacy_partner?.name)).toEqual(["Pharmacy A", "Pharmacy B"]);
  });

  it("returns an empty list for no medications, without querying the directory", async () => {
    const { client, calls } = fakeSupabase([]);
    const result = await attachPharmacyPartners(client, []);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
