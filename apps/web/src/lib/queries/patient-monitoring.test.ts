import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadPatientMonitoringRoster } from "./patient-monitoring";

type Client = SupabaseClient<Database>;
type ProfileRow = {
  id: string;
  full_name: string;
  patient_number: string | null;
  avatar_url: string | null;
  sex: Database["public"]["Enums"]["sex"] | null;
  date_of_birth: string | null;
};
type ProfilesResult = { data: ProfileRow[] | null; error: { message: string } | null };

function makePatients(count: number): ProfileRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `patient-${i}`,
    full_name: `Patient ${i}`,
    patient_number: null,
    avatar_url: null,
    sex: null,
    date_of_birth: null,
  }));
}

/**
 * Stub covering exactly the query shape loadPatientMonitoringRoster issues:
 * one `.from("profiles")...limit(n)` fetch (thenable, resolving to the given
 * `{ data, error }`) plus one `.rpc("patient_monitoring_latest_readings")`
 * call, always resolved empty here — these tests care about the
 * roster-truncation behaviour, not the vitals join. Same shape as
 * ./worklist-counts.test.ts's stub.
 */
function stubClient(result: ProfilesResult): Client {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: ProfilesResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["from", "select", "eq", "order", "limit", "ilike", "in"]) {
    builder[method] = () => builder;
  }
  builder.rpc = () => Promise.resolve({ data: [], error: null });
  return builder as unknown as Client;
}

/**
 * The roster fetch is capped at `limit` (200 in production). Before this
 * fix, a plain `.limit(limit)` fetch could never tell "exactly `limit`
 * patients, genuinely nothing more" apart from "more than `limit` patients
 * exist, silently cut off" — so a name search past row `limit` read
 * identically to that patient never having existed on the platform. Fetching
 * `limit + 1` and slicing back is what makes `truncated` decidable; see
 * clinician/patients/page.tsx's `loadConditionPatientIds` for the same
 * pattern.
 */
describe("loadPatientMonitoringRoster truncation", () => {
  it("does not flag truncation when fewer rows than the cap match", async () => {
    const client = stubClient({ data: makePatients(2), error: null });
    const result = await loadPatientMonitoringRoster(client, { limit: 3 });
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(2);
  });

  it("does not flag truncation when exactly the cap matches", async () => {
    const client = stubClient({ data: makePatients(3), error: null });
    const result = await loadPatientMonitoringRoster(client, { limit: 3 });
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(3);
  });

  it("flags truncation and slices back to the cap when more than the cap matches", async () => {
    const client = stubClient({ data: makePatients(4), error: null });
    const result = await loadPatientMonitoringRoster(client, { limit: 3 });
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(3);
  });

  it("does not flag truncation on an empty result", async () => {
    const client = stubClient({ data: [], error: null });
    const result = await loadPatientMonitoringRoster(client, { limit: 3 });
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.rosterFailed).toBe(false);
  });

  it("does not flag truncation when the roster fetch itself fails", async () => {
    const client = stubClient({ data: null, error: { message: "permission denied" } });
    const result = await loadPatientMonitoringRoster(client, { limit: 3 });
    expect(result.truncated).toBe(false);
    expect(result.rosterFailed).toBe(true);
    expect(result.rows).toHaveLength(0);
  });
});
