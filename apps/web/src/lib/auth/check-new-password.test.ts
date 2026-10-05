import * as Sentry from "@sentry/nextjs";

jest.mock("@sentry/nextjs", () => ({ captureMessage: jest.fn() }));
const verdictMock = jest.fn();
jest.mock("@tarragon/auth/password-check", () => ({ checkPasswordAcceptable: (...a: unknown[]) => verdictMock(...a) }));

import { checkNewPassword } from "./check-new-password";

beforeEach(() => {
  (Sentry.captureMessage as jest.Mock).mockClear();
  verdictMock.mockReset();
});

describe("checkNewPassword", () => {
  it("reports a skipped check (range service down) without the password, and still allows it", async () => {
    verdictMock.mockResolvedValue({ ok: true, breach: "unknown" });
    const v = await checkNewPassword("a-long-unusual-passphrase-42");
    expect(v).toEqual({ ok: true, breach: "unknown" });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain("passphrase");
  });

  it("stays quiet for a clean result and for a refusal", async () => {
    verdictMock.mockResolvedValue({ ok: true, breach: "clean" });
    await checkNewPassword("x");
    verdictMock.mockResolvedValue({ ok: false, reason: "breached", message: "m" });
    await checkNewPassword("x");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
