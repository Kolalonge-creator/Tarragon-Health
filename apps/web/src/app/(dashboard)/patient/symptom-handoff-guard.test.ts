import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Closed means closed (INV-14): with symptom_checker_enabled off, none of the new patient entry points (send a summary, attach one,
 * send a photo) reaches the database or storage. The database refuses as well (proved in packages/db/tests); this is the app half.
 */
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
const upload = jest.fn();
let open = false;
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ storage: { from: () => ({ upload, remove: jest.fn() }) } }) }));
jest.mock("@/lib/acting/acting-for", () => ({ resolveSubjectId: async (id: string) => id }));
jest.mock("@/lib/symptom-triage/protocol", () => ({ isSymptomCheckerOpen: async () => open }));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

import { sendSymptomSummary, attachSummaryToConsultation } from "./symptom-handoff-actions";
import { uploadSkinPhoto } from "./skin-photo-actions";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  rpc.mockReset();
  upload.mockReset();
  open = false;
});

describe("with the checker closed, nothing is sent", () => {
  it("send summary and attach summary answer unavailable and touch nothing", async () => {
    expect(await sendSymptomSummary(ID, null)).toEqual({ status: "unavailable" });
    expect(await attachSummaryToConsultation(ID, ID)).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a photo is not stored", async () => {
    const fd = new FormData();
    fd.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "a.jpg", { type: "image/jpeg" }));
    fd.set("body_area", "face");
    fd.set("consent", "on");
    expect(await uploadSkinPhoto(fd)).toEqual({ status: "unavailable" });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("with the checker open", () => {
  it("a photo without consent is refused before anything is stored", async () => {
    open = true;
    const fd = new FormData();
    fd.set("photo", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
    fd.set("body_area", "face");
    expect(await uploadSkinPhoto(fd)).toEqual({ status: "error", reason: "consent" });
    expect(upload).not.toHaveBeenCalled();
  });
  it("a file that is not a real JPEG or PNG is refused whatever its name says", async () => {
    open = true;
    const fd = new FormData();
    fd.set("photo", new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], "a.jpg", { type: "image/jpeg" }));
    fd.set("body_area", "face");
    fd.set("consent", "on");
    expect(await uploadSkinPhoto(fd)).toEqual({ status: "error", reason: "bad_type" });
    expect(upload).not.toHaveBeenCalled();
  });
  it("an intimate or unknown body area is refused", async () => {
    open = true;
    const fd = new FormData();
    fd.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "a.jpg", { type: "image/jpeg" }));
    fd.set("body_area", "genitals");
    fd.set("consent", "on");
    expect(await uploadSkinPhoto(fd)).toEqual({ status: "error", reason: "other" });
  });
});
