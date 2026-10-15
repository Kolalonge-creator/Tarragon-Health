/**
 * S54 (OQ-70, OQ-76): a guardian is reminded about, and asked the catch-up questions for, the dependants they manage.
 * Their answers are recorded for the dependant, the reminder text names the dependant by first name only and never a medicine, and a
 * dependant who cannot be read never hides the guardian's own doses.
 */
import { answerCatchUp, runCatchUpCheck } from "./catch-up";
import { ownerOfNotification } from "./reminder-owner";
import { loadManagedDependants } from "./acting";
import { clearLocalMirror } from "./offline-store";
import { logDose } from "./medications";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
let mockFailFor: string | null = null;
let mockFailGrants = false;

jest.mock("./api", () => ({ ...(jest.requireActual("./api") as object), postVitalReading: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("./medications", () => ({ ...(jest.requireActual("./medications") as object), logDose: jest.fn().mockResolvedValue({}) }));
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "guardian" } } } }) },
    from: (table: string) => {
      let patient: string | null = null;
      let grantee: string | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: string) => {
          if (col === "patient_id") patient = val;
          if (col === "grantee_user_id") grantee = val;
          return q;
        },
        is: () => q,
        gte: () => q,
        in: () => q,
        then: (res: (v: unknown) => unknown) => {
          if (mockFailGrants && grantee) return Promise.resolve({ data: null, error: { message: "offline" } }).then(res);
          if (mockFailFor && patient === mockFailFor) return Promise.resolve({ data: null, error: { message: "denied" } }).then(res);
          let rows = mockTables[table] ?? [];
          if (patient) rows = rows.filter((r) => r.patient_id === patient);
          if (grantee) rows = rows.filter((r) => r.grantee === grantee);
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return q;
    },
  },
}));

const NOW = Date.parse("2026-10-05T10:00:00Z"); // 11:00 in Lagos: today's 08:00 dose has closed
const med = (id: string, patient: string, name: string) => ({ id, patient_id: patient, drug_name: name, schedule_times: ["08:00"], schedule_spec: null, source: "patient", dose: null, created_at: "2026-10-04T00:00:00Z" });
const grant = (profile: string, level: string, dependent: boolean, org: string | null = "org-1", name = "Ada Okafor") => ({
  grantee: "guardian",
  permission_level: level,
  profile: { id: profile, full_name: name, is_dependent_account: dependent, organisation_id: org },
});

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockFailFor = null;
  (logDose as jest.Mock).mockClear();
  await clearLocalMirror();
});

describe("which dependants a guardian manages", () => {
  it("only manage-level grants on dependant accounts, by first name, with an organisation", async () => {
    mockTables.profile_access = [grant("kid", "manage", true), grant("adult", "manage", false), grant("viewonly", "view", true), grant("noorg", "manage", true, null)];
    expect(await loadManagedDependants("guardian")).toEqual([{ profileId: "kid", organisationId: "org-1", firstName: "Ada" }]);
  });
  it("manages nobody is an empty list", async () => {
    mockTables.profile_access = [];
    expect(await loadManagedDependants("guardian")).toEqual([]);
  });
  it("a failed read is NULL, never an empty list (so a replan cannot cancel the dependants' reminders)", async () => {
    mockFailGrants = true;
    expect(await loadManagedDependants("guardian")).toBeNull();
    mockFailGrants = false;
  });
});

describe("whose reminder is it", () => {
  const map = new Map([["kidMed", "Ada"], ["kidMed2", "Ada"], ["sibMed", "Tolu"]]);
  it("names one dependant when every dose is theirs", () => {
    expect(ownerOfNotification(["kidMed|2026-10-05|08:00", "kidMed2|2026-10-05|08:00"], map)).toBe("Ada");
  });
  it("stays generic for the owner's own dose, a mix, or two different dependants", () => {
    expect(ownerOfNotification(["ownMed|2026-10-05|08:00"], map)).toBeNull();
    expect(ownerOfNotification(["kidMed|2026-10-05|08:00", "ownMed|2026-10-05|08:00"], map)).toBeNull();
    expect(ownerOfNotification(["kidMed|2026-10-05|08:00", "sibMed|2026-10-05|08:00"], map)).toBeNull();
    expect(ownerOfNotification([], map)).toBeNull();
  });
});

describe("the catch-up sheet for a guardian (OQ-76)", () => {
  it("asks about the guardian's own doses and each dependant's, naming the dependant", async () => {
    mockTables.profile_access = [grant("kid", "manage", true)];
    mockTables.medications = [med("own", "guardian", "Own"), med("kidMed", "kid", "Kid medicine")];
    const res = await runCatchUpCheck("guardian", NOW);
    expect(res.status).toBe("show");
    if (res.status !== "show") return;
    const mine = res.items.filter((i) => !i.person);
    const theirs = res.items.filter((i) => i.person);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((i) => i.person?.profileId === "kid" && i.person?.firstName === "Ada" && i.medicationId === "kidMed")).toBe(true);
    expect(mine.every((i) => i.medicationId === "own")).toBe(true);
  });

  it("records a dependant's answer for the dependant, and the guardian's own under the guardian", async () => {
    const base = { medicationId: "m", drugName: "x", time: "08:00", date: "2026-10-05", status: "pending", dueAtMs: 0, state: "missed", closeMinutes: 120, windowMinutes: 0, doseText: null, foodNote: null, origin: "patient_added", doseLabel: null } as never;
    await answerCatchUp("guardian", "org-g", { ...(base as object), person: { profileId: "kid", organisationId: "org-1", firstName: "Ada" } } as never, "took");
    expect((logDose as jest.Mock).mock.calls[0][0]).toBe("kid");
    expect((logDose as jest.Mock).mock.calls[0][1]).toBe("org-1");
    await answerCatchUp("guardian", "org-g", base, "skipped");
    expect((logDose as jest.Mock).mock.calls[1][0]).toBe("guardian");
  });

  it("a dependant who cannot be read never hides the guardian's own doses", async () => {
    mockTables.profile_access = [grant("kid", "manage", true)];
    mockTables.medications = [med("own", "guardian", "Own"), med("kidMed", "kid", "Kid medicine")];
    mockFailFor = "kid";
    const res = await runCatchUpCheck("guardian", NOW);
    expect(res.status).toBe("show");
    if (res.status === "show") expect(res.items.every((i) => !i.person)).toBe(true);
  });

  it("a person who manages nobody sees exactly what they saw before", async () => {
    mockTables.profile_access = [];
    mockTables.medications = [med("own", "guardian", "Own")];
    const res = await runCatchUpCheck("guardian", NOW);
    expect(res.status).toBe("show");
    if (res.status === "show") expect(res.items.every((i) => !i.person)).toBe(true);
  });
});
