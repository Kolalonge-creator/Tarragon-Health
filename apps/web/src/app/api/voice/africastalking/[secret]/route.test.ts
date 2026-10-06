import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const handle = jest.fn<(form: Record<string, string>, deps: { callerNumber: string }) => Promise<{ xml: string }>>();
jest.mock("@tarragon/integrations", () => ({
  constantTimeEqual: (a: string, b: string) => a === b,
  handleAfricasTalkingCallback: (form: Record<string, string>, deps: { callerNumber: string }) => handle(form, deps),
}));
jest.mock("@/lib/consultations/bridge-store", () => ({ createBridgeStore: () => ({}) }));

import { POST } from "./route";

const SECRET = "s".repeat(32);
const call = (secret: string, body: string | null = "isActive=1&clientRequestId=br_aaaaaaaaaaaaaaaaaaaaaaaa") =>
  POST(new Request(`https://app.example/api/voice/africastalking/${secret}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }), { params: Promise.resolve({ secret }) });

const saved = { ...process.env };
beforeEach(() => {
  handle.mockReset();
  handle.mockResolvedValue({ xml: "<Response><Reject/></Response>" });
  process.env.AT_VOICE_CALLBACK_SECRET = SECRET;
  process.env.AT_VOICE_NUMBER = "+2342013330000";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("Africa's Talking callback route", () => {
  it("answers 404 and does nothing for a wrong secret", async () => {
    const res = await call("w".repeat(32));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers 404 when the secret or the number is not configured, or the secret is too short to be one", async () => {
    delete process.env.AT_VOICE_CALLBACK_SECRET;
    expect((await call(SECRET)).status).toBe(404);
    process.env.AT_VOICE_CALLBACK_SECRET = "short";
    expect((await call("short")).status).toBe(404);
    process.env.AT_VOICE_CALLBACK_SECRET = SECRET;
    delete process.env.AT_VOICE_NUMBER;
    expect((await call(SECRET)).status).toBe(404);
    expect(handle).not.toHaveBeenCalled();
  });

  it("hands the form fields to the handler and returns its XML, never cached", async () => {
    handle.mockResolvedValue({ xml: '<Response><Dial phoneNumbers="+2348097654321"/></Response>' });
    const res = await call(SECRET);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain("<Dial");
    expect(handle).toHaveBeenCalledWith({ isActive: "1", clientRequestId: "br_aaaaaaaaaaaaaaaaaaaaaaaa" }, expect.objectContaining({ callerNumber: "+2342013330000" }));
  });

  it("still answers with an action when the body cannot be read", async () => {
    const res = await POST({ formData: async () => { throw new Error("bad body"); } } as unknown as Request, { params: Promise.resolve({ secret: SECRET }) });
    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledWith({}, expect.anything());
  });
});
