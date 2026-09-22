/**
 * Regression: updatePassword() (the email-link half of password reset) never
 * called clear_login_failures() on success, unlike verifyPhoneReset's success
 * path. A patient locked out after 5 wrong passwords who then resets via the
 * emailed link — proving account ownership and setting a valid new password —
 * stayed locked: if their reset session ended before the 15-minute window
 * naturally expired, is_account_locked() would still refuse their brand-new
 * correct password. Proves updatePassword() now clears the lockout on a
 * successful update.
 */

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

const rpc = jest.fn();
const updateUser = jest.fn();
const profilesSingle = jest.fn().mockResolvedValue({ data: { role: "patient" } });

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc,
    auth: { updateUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profilesSingle }) }) }),
  }),
  getCurrentUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

import { updatePassword } from "./actions";

function passwordFormData(password: string, confirmPassword = password) {
  const fd = new FormData();
  fd.set("password", password);
  fd.set("confirmPassword", confirmPassword);
  return fd;
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  updateUser.mockReset();
});

describe("updatePassword — clears the account lockout on success", () => {
  it("calls clear_login_failures after a successful password update", async () => {
    updateUser.mockResolvedValue({ error: null });

    await updatePassword(undefined, passwordFormData("longenough1"));

    expect(rpc).toHaveBeenCalledWith("clear_login_failures");
  });

  it("does NOT call clear_login_failures when the password update itself fails", async () => {
    updateUser.mockResolvedValue({ error: { message: "some GoTrue error" } });

    await updatePassword(undefined, passwordFormData("longenough1"));

    expect(rpc).not.toHaveBeenCalled();
  });
});
