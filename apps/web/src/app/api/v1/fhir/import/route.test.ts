/**
 * S44 acceptance: an import without the person's consent is refused and stores nothing. The consent check lives in the database function
 * `fhir_import_accept` (proved in packages/db/tests/s44_interoperability.sql); this proves the route hands every resource to that one atomic call,
 * keeps what it cannot propose as evidence rather than dropping it, answers each status honestly, and writes nothing itself.
 */
import type { Json } from "@tarragon/shared";

const rpc = jest.fn();
const fromTable = jest.fn();

jest.mock("@/lib/integrations/gateway", () => ({
  runGateway: async (
    request: Request,
    opts: { schema: { parse: (v: unknown) => unknown }; handle: (body: unknown, ctx: unknown) => Promise<{ status: number; body: unknown }> }
  ) => {
    const body = opts.schema.parse(await request.clone().json());
    const result = await opts.handle(body, {
      verified: { organisationId: "org-1", keyId: "key-1" },
      supabase: { rpc, from: fromTable },
      request,
    });
    return Response.json(result.body, { status: result.status });
  },
}));

jest.mock("@/lib/integrations/fhir/parse-resource", () => ({
  FHIR_PARSER_VERSION: 2,
  parseFhirResourceEntry: async (resource: { resourceType: string; id?: string }) =>
    resource.resourceType === "Observation"
      ? { ok: true, proposal: { resourceType: "Observation", fhirResourceId: resource.id ?? null, normalizedPayload: { vital_type: "glucose", glucose_mmol_l: 5.4 }, parseWarnings: [] } }
      : { ok: false, skip: { resourceType: resource.resourceType, reason: "outside the import allow-list" } },
}));

import { POST } from "./route";

const patientLookup = { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "patient-1" } }) }) }) }) }) };

function req(headers: Record<string, string> = { "x-fhir-source-system": "Helium Health" }): Request {
  return new Request("https://app.tarragonhealth.ng/api/v1/fhir/import?patient_number=TH-000123", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      resourceType: "Bundle",
      id: "bundle-1",
      entry: [
        { resource: { resourceType: "Observation", id: "o-1" } },
        { resource: { resourceType: "Condition", id: "c-1" } },
        {},
      ],
    }),
  });
}

describe("POST /api/v1/fhir/import", () => {
  beforeEach(() => {
    rpc.mockReset();
    fromTable.mockReset();
    fromTable.mockImplementation((table: string) => {
      if (table === "profiles") return patientLookup;
      throw new Error(`the route must not touch ${table} itself: the whole write is one database call`);
    });
  });

  it("refuses with 403 consent_required when the database says the person has not allowed this source, and writes nothing else", async () => {
    rpc.mockResolvedValue({ data: { status: "consent_required" }, error: null });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("consent_required");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fromTable).toHaveBeenCalledTimes(1); // only the patient lookup
  });

  it("requires the source system header before it looks at anything else", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hands every resource to the one atomic call: the proposable one with a payload, the rest as evidence with none", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", batch_id: "batch-1", already_processed: false, proposed_count: 1, stored_only_count: 1 }, error: null });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, Json>];
    expect(name).toBe("fhir_import_accept");
    expect(args.p_source).toBe("Helium Health");
    expect(args.p_patient).toBe("patient-1");
    const resources = args.p_resources as { fhir_resource_type: string; resource_type: string | null; normalized_payload: unknown }[];
    expect(resources.map((r) => [r.fhir_resource_type, r.resource_type, r.normalized_payload === null])).toEqual([
      ["Observation", "Observation", false],
      ["Condition", null, true],
    ]);
    const body = (await res.json()) as { proposed_count: number; skipped_count: number };
    expect(body.proposed_count).toBe(1);
    expect(body.skipped_count).toBe(2); // the Condition and the entry with no resource, both listed
  });

  it("answers an already-processed bundle as the idempotent retry it is", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", batch_id: "batch-1", already_processed: true, resource_counts: { Observation: 1 }, skip_reasons: [] }, error: null });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { already_processed: boolean }).already_processed).toBe(true);
  });

  it("is a 500 that says nothing was saved when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/Nothing was saved/);
  });
});
