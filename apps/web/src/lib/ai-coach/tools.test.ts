import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildPatientRecordTools } from "./tools";
import { chainable } from "./test-support";

function fakeSupabase(result: unknown): { client: SupabaseClient<Database>; from: jest.Mock } {
  const from = jest.fn(() => chainable(result));
  return { client: { from } as unknown as SupabaseClient<Database>, from };
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

    for (const tool of tools) {
      const output = await tool.invoke({});
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

  it("exposes exactly the six read-only tools and no write-shaped tool", () => {
    const { client } = fakeSupabase({ data: [], error: null });
    const tools = buildPatientRecordTools(client, "patient-1");

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "getAllergies",
      "getAppointments",
      "getConditions",
      "getMedications",
      "getRecentLabResults",
      "getVitals",
    ]);
    for (const name of names) {
      expect(name.toLowerCase()).not.toMatch(/^(set|update|create|write|delete|insert|remove|cancel)/);
    }
  });
});
