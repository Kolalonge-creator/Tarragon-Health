/**
 * Regression test for PR #661 (2026-09-17): acceptConsents() used to ignore
 * ConsentStep's `onlyTypes` restriction entirely, inserting a patient_consents
 * row for every current consent_versions row regardless of what the caller
 * was actually shown. The one real caller of `onlyTypes` is the supporter/
 * sponsor onboarding path (`onlyTypes={["terms_of_service"]}`) — someone who
 * came only to pay for a relative's care and was shown only the
 * terms-of-service text. The bug silently recorded them as having agreed to
 * data_processing and telehealth too: a false consent record for exactly the
 * two categories the UI was built to avoid asking about.
 *
 * This proves, against the real `acceptConsents` server action: an
 * `onlyTypes`-scoped submission inserts ONLY the requested consent types; a
 * submission with no `onlyTypes` (the primary, non-supporter path) is
 * unaffected and still inserts every current version.
 */

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

const insert = jest.fn();
const consentVersionsSelect = jest.fn();

const CURRENT_VERSIONS = [
  { id: "v-dp", consent_type: "data_processing", version: 3 },
  { id: "v-th", consent_type: "telehealth", version: 2 },
  { id: "v-tos", consent_type: "terms_of_service", version: 5 },
];

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "supporter-1" } } }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { organisation_id: "org-1" } }),
            }),
          }),
        };
      }
      if (table === "consent_versions") {
        return {
          select: () => ({
            eq: consentVersionsSelect,
          }),
        };
      }
      if (table === "patient_consents") {
        return { insert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { acceptConsents } from "./actions";

function formDataFor(onlyTypes?: string[]) {
  const fd = new FormData();
  fd.set("accept", "on");
  for (const t of onlyTypes ?? []) fd.append("onlyTypes", t);
  return fd;
}

describe("acceptConsents — onlyTypes scoping (PR #661 regression)", () => {
  beforeEach(() => {
    insert.mockReset().mockResolvedValue({ error: null });
    consentVersionsSelect.mockReset().mockResolvedValue({ data: CURRENT_VERSIONS, error: null });
  });

  it("records only the requested consent type when onlyTypes is set (supporter path)", async () => {
    const result = await acceptConsents(undefined, formDataFor(["terms_of_service"]));

    expect(result?.error).toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as Array<{ consent_type: string }>;
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.consent_type)).toEqual(["terms_of_service"]);
  });

  it("never records data_processing or telehealth for an onlyTypes=[terms_of_service] submission", async () => {
    await acceptConsents(undefined, formDataFor(["terms_of_service"]));

    const rows = insert.mock.calls[0][0] as Array<{ consent_type: string }>;
    const recordedTypes = rows.map((r) => r.consent_type);
    expect(recordedTypes).not.toContain("data_processing");
    expect(recordedTypes).not.toContain("telehealth");
  });

  it("still records every current version when onlyTypes is absent (primary onboarding path)", async () => {
    const result = await acceptConsents(undefined, formDataFor());

    expect(result?.error).toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as Array<{ consent_type: string }>;
    expect(rows.map((r) => r.consent_type).sort()).toEqual(
      ["data_processing", "telehealth", "terms_of_service"].sort(),
    );
  });

  it("SABOTAGE: proves the test actually discriminates — an unscoped submission would fail the single-row assertion", async () => {
    // Same fixture, no onlyTypes: this must NOT look like the scoped result,
    // or check above would be passing vacuously regardless of the fix.
    await acceptConsents(undefined, formDataFor());
    const rows = insert.mock.calls[0][0] as Array<{ consent_type: string }>;
    expect(rows.length).not.toBe(1);
  });
});
