/**
 * Security audit 2026-11-05, M-8: adding a child creates a real auth user through the service role. Pinned here: only a
 * patient's own (non-dependant) account may do it, it is rate-limited, the raw provider error is never shown, and a record
 * that fails part-way is deleted rather than left orphaned.
 */
let profile: Record<string, unknown> | null = null;
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn(async () => profile) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/preventive/generate-vaccination-schedule", () => ({ generateVaccinationScheduleBestEffort: jest.fn() }));
const limitMock = jest.fn();
jest.mock("@/lib/security/abuse-limits", () => ({
  checkAbuseLimit: (...a: unknown[]) => limitMock(...a),
  ABUSE_LIMIT_MESSAGE: "Too many.",
}));

const createUser = jest.fn();
const deleteUser = jest.fn().mockResolvedValue({ error: null });
const rpc = jest.fn();
const insert = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ auth: { admin: { createUser, deleteUser } }, rpc, from: () => ({ insert }) }),
}));

import { addChildDependentAction } from "./add-child-actions";

const input = { full_name: "Ada", date_of_birth: "2020-01-01", sex: "female" };
const patient = { id: "p1", organisation_id: "org-1", role: "patient", is_dependent_account: false };

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  profile = patient;
  limitMock.mockReset().mockResolvedValue({ ok: true });
  createUser.mockReset().mockResolvedValue({ data: { user: { id: "child-1" } }, error: null });
  deleteUser.mockClear();
  rpc.mockReset().mockResolvedValue({ error: null });
  insert.mockReset().mockResolvedValue({ error: null });
});

it("a patient adds a child", async () => {
  expect(await addChildDependentAction(input)).toEqual({ message: "Added Ada to your family." });
  expect(limitMock).toHaveBeenCalledWith("add_dependant", "p1");
});

it.each([
  ["a staff account", { ...patient, role: "clinician" }],
  ["a dependant's record", { ...patient, is_dependent_account: true }],
])("refuses %s before creating anything", async (_label, who) => {
  profile = who;
  expect(await addChildDependentAction(input)).toHaveProperty("error");
  expect(createUser).not.toHaveBeenCalled();
});

it("refuses over the limit before creating anything", async () => {
  limitMock.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
  expect(await addChildDependentAction(input)).toEqual({ error: "Too many." });
  expect(createUser).not.toHaveBeenCalled();
});

it("never shows the raw provider error", async () => {
  createUser.mockResolvedValue({ data: { user: null }, error: { message: "duplicate key value violates unique constraint users_email_key" } });
  const result = await addChildDependentAction(input);
  expect(JSON.stringify(result)).not.toMatch(/constraint|users_email_key/);
});

it("deletes a half-made child when the access grant fails", async () => {
  insert.mockResolvedValue({ error: { message: "insert or update on table profile_access violates foreign key constraint" } });
  const result = await addChildDependentAction(input);
  expect(JSON.stringify(result)).not.toMatch(/profile_access|constraint/);
  expect(deleteUser).toHaveBeenCalledWith("child-1");
});

it("deletes a half-made child when the profile setup fails", async () => {
  rpc.mockResolvedValue({ error: { message: "boom" } });
  await addChildDependentAction(input);
  expect(deleteUser).toHaveBeenCalledWith("child-1");
});
