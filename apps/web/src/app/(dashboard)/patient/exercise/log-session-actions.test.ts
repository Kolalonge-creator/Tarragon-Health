/** P4: logging an exercise session. Real server actions, faked database client. */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const inserted: Record<string, unknown>[] = [];
const deleted: { id?: string; patient?: string }[] = [];
let insertError: { message: string } | null = null;
let signedIn = true;

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: signedIn ? { id: "patient-1" } : null },
      }),
    },
    from: (name: string) => {
      if (name === "profiles") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.single = async () => ({
          data: { organisation_id: "org-1" },
          error: null,
        });
        return c;
      }
      return {
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: insertError };
        },
        delete: () => {
          const rec: { id?: string; patient?: string } = {};
          const chain = {
            eq: (col: string, v: string) => {
              if (col === "id") rec.id = v;
              else rec.patient = v;
              if (rec.id && rec.patient) {
                deleted.push(rec);
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  })),
}));

import {
  deleteExerciseSessionAction,
  logExerciseSessionAction,
} from "./actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const base = {
  performed_on: "2026-10-29",
  duration_minutes: "25",
  kind: "walking",
};

beforeEach(() => {
  inserted.length = 0;
  deleted.length = 0;
  insertError = null;
  signedIn = true;
});

describe("logExerciseSessionAction", () => {
  it("stores the session against the signed-in patient, never a patient id from the form", async () => {
    const res = await logExerciseSessionAction(
      undefined,
      form({ ...base, patient_id: "someone-else" }),
    );
    expect(res).toEqual({ success: true, symptomReported: false });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      patient_id: "patient-1",
      organisation_id: "org-1",
      duration_minutes: 25,
      kind: "walking",
      enrollment_id: null,
      effort: null,
      symptom_during: false,
    });
  });

  it("reports a symptom back so the page can tell the person to stop and rest", async () => {
    const res = await logExerciseSessionAction(
      undefined,
      form({ ...base, symptom_during: "on", effort: "hard" }),
    );
    expect(res).toEqual({ success: true, symptomReported: true });
    expect(inserted[0]).toMatchObject({ symptom_during: true, effort: "hard" });
  });

  it.each([["0"], ["601"], ["abc"], ["12.5"]])(
    "rejects %s minutes before touching the database",
    async (minutes) => {
      const res = await logExerciseSessionAction(
        undefined,
        form({ ...base, duration_minutes: minutes }),
      );
      expect(res?.error).toBeTruthy();
      expect(inserted).toHaveLength(0);
    },
  );

  it("rejects an unknown kind and a malformed date", async () => {
    expect(
      (
        await logExerciseSessionAction(
          undefined,
          form({ ...base, kind: "swimming" }),
        )
      )?.error,
    ).toBeTruthy();
    expect(
      (
        await logExerciseSessionAction(
          undefined,
          form({ ...base, performed_on: "29/10/2026" }),
        )
      )?.error,
    ).toBeTruthy();
    expect(inserted).toHaveLength(0);
  });

  it("surfaces the database's own message (date window, someone else's programme)", async () => {
    insertError = { message: "Sessions can be logged up to 30 days back." };
    const res = await logExerciseSessionAction(undefined, form(base));
    expect(res).toEqual({
      error: "Sessions can be logged up to 30 days back.",
    });
  });

  it("refuses when signed out", async () => {
    signedIn = false;
    expect(await logExerciseSessionAction(undefined, form(base))).toEqual({
      error: "Not signed in",
    });
    expect(inserted).toHaveLength(0);
  });
});

describe("deleteExerciseSessionAction", () => {
  it("deletes only the signed-in patient's own row", async () => {
    const id = "6f1c2b1e-9a3d-4c55-8d7e-1a2b3c4d5e6f";
    expect(await deleteExerciseSessionAction(id)).toEqual({ success: true });
    expect(deleted).toEqual([{ id, patient: "patient-1" }]);
  });

  it("rejects a malformed id", async () => {
    expect(await deleteExerciseSessionAction("not-a-uuid")).toEqual({
      error: "Invalid input",
    });
    expect(deleted).toHaveLength(0);
  });
});
