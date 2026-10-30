import { readTrendBandsEligible } from "./trend-bands-eligibility";

type Profile = { data: { date_of_birth: string | null; is_pregnant: boolean | null } | null; error: unknown };
const GOOD_PROFILE: Profile = { data: { date_of_birth: "1980-01-01", is_pregnant: null }, error: null };

function run(opts: { profile?: Profile; pregnancy?: { data: unknown; error: { message?: string } | null }; moduleEnabled?: boolean }): Promise<boolean> {
  const pregnancy = opts.pregnancy ?? { data: { pregnancy: "not_pregnant", has_record: true, last_delivery_date: null }, error: null };
  return readTrendBandsEligible({ rpc: () => Promise.resolve(pregnancy) }, "p1", opts.moduleEnabled ?? true, opts.profile ?? GOOD_PROFILE);
}

describe("readTrendBandsEligible (OQ-555 follow-up)", () => {
  it("a readable adult who is not pregnant gets the band, as before", async () => {
    expect(await run({})).toBe(true);
  });
  it("the module off means no band, as before", async () => {
    expect(await run({ moduleEnabled: false })).toBe(false);
  });
  it("a recorded pregnancy means no band, as before", async () => {
    expect(await run({ pregnancy: { data: { pregnancy: "pregnant", has_record: true, last_delivery_date: null }, error: null } })).toBe(false);
  });
  it("the profile pregnancy flag still means no band", async () => {
    expect(await run({ profile: { data: { date_of_birth: "1980-01-01", is_pregnant: true }, error: null } })).toBe(false);
  });
  it("a recent delivery means no band, as before", async () => {
    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    expect(await run({ pregnancy: { data: { pregnancy: "not_pregnant", has_record: true, last_delivery_date: recent }, error: null } })).toBe(false);
  });
  it("an UNKNOWN pregnancy status (not tied, or a failed read) means no band, never a band for someone who may be pregnant", async () => {
    expect(await run({ pregnancy: { data: { pregnancy: "unknown", has_record: false, last_delivery_date: null }, error: null } })).toBe(false);
    expect(await run({ pregnancy: { data: null, error: { message: "boom" } } })).toBe(false);
  });
  it("an unreadable profile means no band", async () => {
    expect(await run({ profile: { data: null, error: { message: "x" } } })).toBe(false);
  });
});
