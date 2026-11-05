/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the phone's "check the file I just uploaded" call needs the person's own bearer token.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const check = jest.fn<(client: unknown, input: unknown, token?: string) => Promise<unknown>>();
jest.mock("@/lib/supabase/bearer", () => ({ createBearerClient: (t: string) => ({ token: t }) }));
jest.mock("@/lib/uploads/check-my-upload", () => ({ checkMyUpload: (c: unknown, i: unknown, t?: string) => check(c, i, t) }));

import { POST } from "./route";

const req = (body: unknown, auth?: string) =>
  new Request("https://app.example/api/mobile/upload-check", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });

beforeEach(() => {
  check.mockReset();
});

describe("POST /api/mobile/upload-check", () => {
  it("refuses a call with no bearer token", async () => {
    expect((await POST(req({ bucket: "b", path: "p" }))).status).toBe(401);
    expect(check).not.toHaveBeenCalled();
  });

  it("checks as the token's own user and returns the result", async () => {
    check.mockResolvedValue({ checked: true, refused: true });
    const res = await POST(req({ bucket: "patient-documents", path: "u1/a.jpg" }, "Bearer tok"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: true, refused: true });
    expect(check).toHaveBeenCalledWith({ token: "tok" }, { bucket: "patient-documents", path: "u1/a.jpg" }, "tok");
  });

  it("maps a refusal of the request to the right status", async () => {
    check.mockResolvedValue({ error: "Invalid request" });
    expect((await POST(req({}, "Bearer tok"))).status).toBe(400);
    check.mockResolvedValue({ error: "Not signed in" });
    expect((await POST(req({}, "Bearer tok"))).status).toBe(401);
  });
});
