/**
 * @jest-environment node
 *
 * Security audit 2026-11-05, M-2: a sandbox (th_test_) partner key used to read real patients' demographics, because
 * nothing checked the key's environment. A sandbox key now only resolves test patients.
 */

type Handle = (body: unknown, ctx: unknown) => Promise<{ status: number; body: unknown }>;
let environment: "live" | "sandbox" = "live";
const eqCalls: Array<[string, unknown]> = [];

jest.mock("@/lib/integrations/gateway", () => ({
  runGateway: async (request: Request, opts: { handle: Handle }) => {
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return chain;
      },
      maybeSingle: async () => ({ data: null }),
    };
    const result = await opts.handle({}, {
      verified: { organisationId: "org-1", environment },
      supabase: { from: () => chain },
      request,
    });
    return new Response(JSON.stringify(result.body), { status: result.status });
  },
}));

import { GET } from "./route";

const req = () => new Request("https://app.example/api/v1/patients?patient_number=TH-000123");

describe("GET /api/v1/patients key environment", () => {
  beforeEach(() => {
    eqCalls.length = 0;
  });

  it("restricts a sandbox key to test patients", async () => {
    environment = "sandbox";
    await GET(req());
    expect(eqCalls).toContainEqual(["is_test", true]);
  });

  it("does not add the test-patient filter for a live key", async () => {
    environment = "live";
    await GET(req());
    expect(eqCalls.find(([col]) => col === "is_test")).toBeUndefined();
    expect(eqCalls).toContainEqual(["organisation_id", "org-1"]);
  });
});
