import { describe, expect, it, jest } from "@jest/globals";
import { S59D_DRAFT_PATHWAYS, SEED_PATHWAYS } from "@tarragon/symptom-triage-engine";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/go-live/constants", () => ({ SYMPTOM_CHECKER_GUARD: "symptom_checker_enabled" }));

import { getActivePathway, getActiveTriageProtocolConfig } from "./protocol";

type Row = { config: unknown; version: number; is_active: boolean; approved_at: string | null; approved_by: string | null };
const client = (row: Row | null, error: unknown = null) =>
  ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
  }) as never;

const signed = (pathways: unknown[], over: Partial<Row> = {}): Row => ({
  config: { version: 7, pathways },
  version: 7,
  is_active: true,
  approved_at: "2026-10-22T10:00:00Z",
  approved_by: "staff-1",
  ...over,
});

describe("the app loads only an ACTIVE and SIGNED triage protocol (S59d)", () => {
  it("returns the config of a signed active row", async () => {
    const got = await getActiveTriageProtocolConfig(client(signed([...SEED_PATHWAYS])));
    expect(got?.protocolVersion).toBe(7);
    expect((await getActivePathway("headache", client(signed([...SEED_PATHWAYS]))))?.pathway.key).toBe("headache");
  });

  it("refuses an active row with no signature, a half signature, and a row whose config version differs", async () => {
    const paths = [...SEED_PATHWAYS, ...S59D_DRAFT_PATHWAYS];
    expect(await getActiveTriageProtocolConfig(client(signed(paths, { approved_at: null, approved_by: null })))).toBeNull();
    expect(await getActiveTriageProtocolConfig(client(signed(paths, { approved_by: null })))).toBeNull();
    expect(await getActiveTriageProtocolConfig(client(signed(paths, { approved_at: null })))).toBeNull();
    expect(await getActivePathway("diabetes_complication", client(signed(paths, { approved_by: null })))).toBeNull();
  });

  it("serves a signed, re-attested row whose copied config still carries the older inner version (HIGH 1)", async () => {
    const got = await getActiveTriageProtocolConfig(client(signed([...SEED_PATHWAYS], { version: 8 })));
    expect(got?.protocolVersion).toBe(8);
    expect(got?.config.version).toBe(8);
  });

  it("fails closed on an error, an empty answer and a malformed config", async () => {
    expect(await getActiveTriageProtocolConfig(client(null))).toBeNull();
    expect(await getActiveTriageProtocolConfig(client(signed([]), { message: "boom" }))).toBeNull();
    expect(await getActiveTriageProtocolConfig(client(signed([{ nope: true }])))).toBeNull();
  });
});
