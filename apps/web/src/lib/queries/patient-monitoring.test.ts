import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { DEFAULT_ROSTER_LIMIT, loadPatientMonitoringRoster } from "./patient-monitoring";

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
type AssignmentsResult = { data: { patient_id: string }[] | null; error: { message: string } | null };

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
 * Stub covering exactly the query shapes loadPatientMonitoringRoster issues:
 * `.from("profiles")...limit(n)` (thenable, resolving to the given
 * `{ data, error }` sliced to whatever `n` the source actually requested),
 * `.from("care_team_assignment")...` for the `mineOnly` branch, and
 * `.rpc("patient_monitoring_latest_readings")`, always resolved empty here
 * since these tests care about the roster-truncation behaviour, not the
 * vitals join. Same shape as ./worklist-counts.test.ts's stub.
 *
 * Slicing `profiles.data` to the requested limit (rather than ignoring the
 * argument and always returning the full fixture) matters: it is what makes
 * the "flags truncation" test below actually exercise the `limit + 1` fetch
 * — without it, the test would still pass even if the source reverted to a
 * plain `.limit(limit)`, since `truncated` would then always compute `false`
 * on a `.limit(limit)`-capped result but the fixture would already have been
 * pre-shaped to `limit` and never `limit + 1` rows.
 */
function stubClient(profiles: ProfilesResult, assignments?: AssignmentsResult): Client {
  let requestedLimit: number | null = null;
  const profilesBuilder: Record<string, unknown> = {
    then: (resolve: (value: ProfilesResult) => unknown) => {
      const data =
        profiles.data && requestedLimit != null ? profiles.data.slice(0, requestedLimit) : profiles.data;
      return Promise.resolve({ ...profiles, data }).then(resolve);
    },
  };
  for (const method of ["select", "eq", "order", "ilike", "in"]) {
    profilesBuilder[method] = () => profilesBuilder;
  }
  profilesBuilder.limit = (n: number) => {
    requestedLimit = n;
    return profilesBuilder;
  };

  const assignmentsBuilder: Record<string, unknown> = {
    then: (resolve: (value: AssignmentsResult) => unknown) =>
      Promise.resolve(assignments ?? { data: [], error: null }).then(resolve),
  };
  for (const method of ["select", "eq"]) {
    assignmentsBuilder[method] = () => assignmentsBuilder;
  }

  return {
    from: (table: string) => (table === "care_team_assignment" ? assignmentsBuilder : profilesBuilder),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as Client;
}

/**
 * The roster fetch is capped at `limit` (DEFAULT_ROSTER_LIMIT in
 * production). Before this fix, a plain `.limit(limit)` fetch could never
 * tell "exactly `limit` patients, genuinely nothing more" apart from "more
 * than `limit` patients exist, silently cut off" — so a name search (or a
 * status/gender/age filter, applied client-side on the same fetch) past
 * row `limit` read identically to that patient never having existed on the
 * platform. Fetching `limit + 1` and slicing back is what makes `truncated`
 * decidable.
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

  it("applies the same behaviour at the real default limit", async () => {
    const client = stubClient({ data: makePatients(DEFAULT_ROSTER_LIMIT + 1), error: null });
    const result = await loadPatientMonitoringRoster(client, {});
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(DEFAULT_ROSTER_LIMIT);
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

  it("does not flag truncation when the mineOnly assignment lookup fails", async () => {
    const client = stubClient(
      { data: makePatients(4), error: null },
      { data: null, error: { message: "permission denied" } },
    );
    const result = await loadPatientMonitoringRoster(client, {
      limit: 3,
      mineOnly: true,
      callerId: "clinician-1",
    });
    expect(result.truncated).toBe(false);
    expect(result.rosterFailed).toBe(true);
    expect(result.rows).toHaveLength(0);
  });

  it("does not flag truncation when mineOnly resolves to no assigned patients", async () => {
    const client = stubClient({ data: makePatients(4), error: null }, { data: [], error: null });
    const result = await loadPatientMonitoringRoster(client, {
      limit: 3,
      mineOnly: true,
      callerId: "clinician-1",
    });
    expect(result.truncated).toBe(false);
    expect(result.rosterFailed).toBe(false);
    expect(result.rows).toHaveLength(0);
  });
});
