const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { logPhoneTicketAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const good = { phone: "+2348012345678", subject: "Cannot log in", description: "The caller cannot sign in to the app", priority: "normal" };

beforeEach(() => rpc.mockReset());

describe("logPhoneTicketAction", () => {
  it("passes the call to the database and says logged", async () => {
    rpc.mockResolvedValue({ data: "id", error: null });
    expect(await goes(logPhoneTicketAction(fd(good)))).toBe("REDIRECT:/clinician/support-tickets?pn=logged");
    expect(rpc).toHaveBeenCalledWith("log_phone_support_ticket", { p_patient_phone: good.phone, p_subject: good.subject, p_description: good.description, p_priority: "normal", p_clinical_content: false });
  });
  it("a clinical call says so and sends the flag", async () => {
    rpc.mockResolvedValue({ data: "id", error: null });
    expect(await goes(logPhoneTicketAction(fd({ ...good, clinical: "on" })))).toBe("REDIRECT:/clinician/support-tickets?pn=logged_clinical");
    expect(rpc.mock.calls[0][1].p_clinical_content).toBe(true);
  });
  it("never calls the database with a malformed phone number or a short description", async () => {
    expect(await goes(logPhoneTicketAction(fd({ ...good, phone: "0801" })))).toBe("REDIRECT:/clinician/support-tickets?pn=bad_input");
    expect(await goes(logPhoneTicketAction(fd({ ...good, description: "short" })))).toBe("REDIRECT:/clinician/support-tickets?pn=bad_input");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "denied"], ["22023", "no_match"], ["XX000", "failed"]])("database error %s becomes %s, never success", async (code, n) => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code } });
    expect(await goes(logPhoneTicketAction(fd(good)))).toBe(`REDIRECT:/clinician/support-tickets?pn=${n}`);
  });
});
