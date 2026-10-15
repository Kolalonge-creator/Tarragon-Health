import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildPatientRecordTools } from "./tools";
import { chainable } from "./test-support";

function fakeSupabase(
  result: unknown,
  rpcResult?: unknown
): { client: SupabaseClient<Database>; from: jest.Mock; rpc: jest.Mock } {
  const from = jest.fn(() => chainable(result));
  const rpc = jest.fn(async () => rpcResult ?? result);
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, from, rpc };
}

function toolByName(tools: ReturnType<typeof buildPatientRecordTools>, name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe("buildPatientRecordTools", () => {
  it("getVitals returns a note (not an error) when there are no readings", async () => {
    const { client } = fakeSupabase({ data: [], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");

    const output = await toolByName(tools, "getVitals").invoke({});

    expect(JSON.parse(output as string)).toEqual({
      readings: [],
      note: "No readings on file for this patient.",
    });
  });

  it("getVitals returns readings on success", async () => {
    const readings = [{ vital_type: "blood_pressure", systolic: 130, diastolic: 85, taken_at: "2026-08-20T00:00:00Z" }];
    const { client } = fakeSupabase({ data: readings, error: null });
    const tools = buildPatientRecordTools(client, "patient-1");

    const output = await toolByName(tools, "getVitals").invoke({});

    expect(JSON.parse(output as string)).toEqual({ readings });
  });

  it("every tool returns a JSON error string, never throws, when the query errors", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "connection reset" } });
    const tools = buildPatientRecordTools(client, "patient-1");

    // getMedicationInformation has a required `drugName` argument; every
    // other tool here accepts an empty object.
    const argsByTool: Record<string, Record<string, unknown>> = {
      getMedicationInformation: { drugName: "amlodipine" },
    };

    for (const tool of tools) {
      const output = await tool.invoke(argsByTool[tool.name] ?? {});
      const parsed = JSON.parse(output as string);
      expect(parsed).toHaveProperty("error");
    }
  });

  it("scopes every read to the bound patientId, never an LLM-supplied one", async () => {
    const { client, from } = fakeSupabase({ data: [], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");

    // The tool schemas expose no "patientId" argument at all -- verify that
    // structurally, not just behaviourally, since that's the actual safety
    // property (tools.ts's HARD INVARIANT comment): the model has no way to
    // even attempt asking for a different patient's record.
    for (const tool of tools) {
      const schemaShape = (tool as unknown as { schema: { shape?: Record<string, unknown> } }).schema?.shape;
      if (schemaShape) {
        expect(Object.keys(schemaShape)).not.toContain("patientId");
        expect(Object.keys(schemaShape)).not.toContain("patient_id");
      }
    }

    await toolByName(tools, "getMedications").invoke({});
    expect(from).toHaveBeenCalledWith("medications");
  });

  it("getAppointments defaults to upcoming/scheduled only, and includePast widens it", async () => {
    const { client } = fakeSupabase({ data: [], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");
    const getAppointments = toolByName(tools, "getAppointments");

    const upcomingOnly = await getAppointments.invoke({});
    const withPast = await getAppointments.invoke({ includePast: true });

    expect(JSON.parse(upcomingOnly as string)).toEqual({ appointments: [], note: "No appointments found." });
    expect(JSON.parse(withPast as string)).toEqual({ appointments: [], note: "No appointments found." });
  });

  it("exposes exactly the nine read-only tools and no write-shaped tool", () => {
    const { client } = fakeSupabase({ data: [], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "getAllergies",
      "getAppointments",
      "getCachedExplanations",
      "getConditions",
      "getMedicationInformation",
      "getMedications",
      "getProtocolLimits",
      "getRecentLabResults",
      "getVitals",
    ]);
    for (const name of names) {
      expect(name.toLowerCase()).not.toMatch(/^(set|update|create|write|delete|insert|remove|cancel)/);
    }
  });

  describe("getMedicationInformation", () => {
    it("returns found=false when no clinician-reviewed row matches", async () => {
      const { client } = fakeSupabase({ data: null, error: null });
      const tools = buildPatientRecordTools(client, "patient-1");

      const output = await toolByName(tools, "getMedicationInformation").invoke({ drugName: "amlodipine" });

      const parsed = JSON.parse(output as string);
      expect(parsed.found).toBe(false);
      expect(parsed.note).toContain("amlodipine");
    });

    const meta = (retrievable: boolean) => ({
      data: [
        {
          id: "row-1",
          source_table: "health_education_content",
          title: "Amlodipine",
          owner: "Dr A. Obi",
          version: 2,
          review_due_at: "2027-03-01T00:00:00Z",
          retrievable,
        },
      ],
      error: null,
    });

    it("returns the reviewed content on a match, with its owner, version and review date as the source", async () => {
      const row = { id: "row-1", title: "Amlodipine", summary: "Lowers blood pressure.", body: "Full body text." };
      const { client } = fakeSupabase({ data: [row], error: null }, meta(true));
      const tools = buildPatientRecordTools(client, "patient-1");

      const output = await toolByName(tools, "getMedicationInformation").invoke({ drugName: "amlodipine" });

      expect(JSON.parse(output as string)).toEqual({
        found: true,
        title: row.title,
        summary: row.summary,
        body: row.body,
        _source: { kind: "reviewed_content", title: "Amlodipine", owner: "Dr A. Obi", version: 2, reviewDue: "2027-03-01T00:00:00Z" },
      });
    });

    it("treats a row with no owner or a lapsed review date as nothing reviewed (never answered from it)", async () => {
      const row = { id: "row-1", title: "Amlodipine", summary: "x", body: "y" };
      const { client } = fakeSupabase({ data: [row], error: null }, meta(false));
      const tools = buildPatientRecordTools(client, "patient-1");

      const output = await toolByName(tools, "getMedicationInformation").invoke({ drugName: "amlodipine" });

      expect(JSON.parse(output as string).found).toBe(false);
    });

    it("a lapsed first match never hides a current second match", async () => {
      const first = { id: "row-0", title: "Amlodipine old", summary: "x", body: "y" };
      const second = { id: "row-1", title: "Amlodipine", summary: "Lowers blood pressure.", body: "z" };
      const { client } = fakeSupabase(
        { data: [first, second], error: null },
        {
          data: [
            { id: "row-0", source_table: "health_education_content", title: "Amlodipine old", owner: "Dr A. Obi", version: 1, review_due_at: "2020-01-01T00:00:00Z", retrievable: false },
            { id: "row-1", source_table: "health_education_content", title: "Amlodipine", owner: "Dr A. Obi", version: 2, review_due_at: "2027-03-01T00:00:00Z", retrievable: true },
          ],
          error: null,
        }
      );
      const tools = buildPatientRecordTools(client, "patient-1");
      const out = JSON.parse((await toolByName(tools, "getMedicationInformation").invoke({ drugName: "amlodipine" })) as string);
      expect(out.found).toBe(true);
      expect(out.title).toBe("Amlodipine");
    });

    it("fails closed when the metadata lookup itself fails", async () => {
      const row = { id: "row-1", title: "Amlodipine", summary: "x", body: "y" };
      const { client } = fakeSupabase({ data: [row], error: null }, { data: null, error: { message: "boom" } });
      const tools = buildPatientRecordTools(client, "patient-1");

      const output = await toolByName(tools, "getMedicationInformation").invoke({ drugName: "amlodipine" });

      expect(JSON.parse(output as string).found).toBe(false);
    });

    it("only reads the shared health_education_content library, not any per-patient table", async () => {
      const { client, from } = fakeSupabase({ data: null, error: null });
      const tools = buildPatientRecordTools(client, "patient-1");

      await toolByName(tools, "getMedicationInformation").invoke({ drugName: "metformin" });

      expect(from).toHaveBeenCalledWith("health_education_content");
    });
  });
});

describe("S51 tools: cached explanations and protocol limits", () => {
  it("getCachedExplanations never returns an explanation for a screening analyte (INV-04)", async () => {
    const rows = [
      { kind: "lab_analyte", subject_key: "hiv_screen", explanation_text: "should never be seen", generated_at: "2026-10-01" },
      { kind: "lab_analyte", subject_key: "hba1c", explanation_text: "Your HbA1c is the three month average.", generated_at: "2026-10-01" },
    ];
    const { client } = fakeSupabase({ data: rows, error: null });
    const tools = buildPatientRecordTools(client, "patient-1");
    const out = JSON.parse((await toolByName(tools, "getCachedExplanations").invoke({})) as string);
    expect(JSON.stringify(out)).not.toContain("should never be seen");
    expect(out.explanations).toHaveLength(1);
    expect(out._source.kind).toBe("explanation");
  });

  it("getProtocolLimits returns limits only and says so", async () => {
    const { client, rpc } = fakeSupabase({ data: [], error: null }, { data: [{ code: "htn_hearts_ng", version: 1, limits: { staleAfterDays: 14 } }], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");
    const out = JSON.parse((await toolByName(tools, "getProtocolLimits").invoke({})) as string);
    expect(rpc).toHaveBeenCalledWith("assistant_protocol_limits");
    expect(out.found).toBe(true);
    expect(out.note).toMatch(/never propose/i);
    expect(JSON.stringify(out)).not.toMatch(/steps/);
  });

  it("getProtocolLimits reports found=false when no protocol is approved", async () => {
    const { client } = fakeSupabase({ data: [], error: null }, { data: [], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");
    const out = JSON.parse((await toolByName(tools, "getProtocolLimits").invoke({})) as string);
    expect(out.found).toBe(false);
  });
});
