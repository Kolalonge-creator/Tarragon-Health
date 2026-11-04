const updateMock = jest.fn();
const eqMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    from: jest.fn(() => ({ update: (row: unknown) => (updateMock(row), { eq: (...a: unknown[]) => eqMock(...a) }) })),
  }),
}));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

import { savePhone } from "./phone-actions";

function form(countryCode: string, phone: string) {
  const fd = new FormData();
  fd.set("countryCode", countryCode);
  fd.set("phone", phone);
  return fd;
}

beforeEach(() => {
  updateMock.mockReset();
  eqMock.mockReset().mockResolvedValue({ error: null });
});

describe("savePhone (onboarding phone step)", () => {
  it("stores a Nigerian number in E.164 on the caller's own profile", async () => {
    await expect(savePhone(undefined, form("+234", "08012345678"))).resolves.toEqual({ success: true });
    expect(updateMock).toHaveBeenCalledWith({ phone: "+2348012345678" });
    expect(eqMock).toHaveBeenCalledWith("id", "u1");
  });

  it("refuses an invalid number without writing anything", async () => {
    const out = await savePhone(undefined, form("+234", "12"));
    expect(out?.error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("never shows the raw database error", async () => {
    eqMock.mockResolvedValue({ error: { message: 'new row violates check constraint "profiles_phone_e164"' } });
    const out = await savePhone(undefined, form("+234", "08012345678"));
    expect(out).toEqual({ error: "We could not save that just then. Please try again." });
  });
});
