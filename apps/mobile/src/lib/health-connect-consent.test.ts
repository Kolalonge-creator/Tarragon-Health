/**
 * The gate that keeps `health-connect.ts`'s `requestHealthConnectPermissions()`
 * from ever calling the native OS permission dialog before the patient has
 * seen TarragonHealth's own rationale screen — see that module and
 * health-connect-consent.ts's own header comment for why this exists.
 */
import * as asyncStorageMock from "../test/mocks/async-storage";
import {
  hasAcceptedHealthConnectRationale,
  markHealthConnectRationaleAccepted,
} from "./health-connect-consent";

describe("hasAcceptedHealthConnectRationale", () => {
  it("defaults to false before the rationale has ever been accepted", async () => {
    expect(await hasAcceptedHealthConnectRationale()).toBe(false);
  });

  it("becomes true once markHealthConnectRationaleAccepted has been called", async () => {
    await markHealthConnectRationaleAccepted();
    expect(await hasAcceptedHealthConnectRationale()).toBe(true);
  });

  it("stays accepted across repeated checks, not just the next one", async () => {
    await markHealthConnectRationaleAccepted();
    expect(await hasAcceptedHealthConnectRationale()).toBe(true);
    expect(await hasAcceptedHealthConnectRationale()).toBe(true);
  });
});

describe("markHealthConnectRationaleAccepted", () => {
  it("does not throw when the underlying write fails (best-effort)", async () => {
    asyncStorageMock.__failNextSet();
    await expect(markHealthConnectRationaleAccepted()).resolves.toBeUndefined();
    // The failed write must not have left a stale "true" behind either.
    expect(await hasAcceptedHealthConnectRationale()).toBe(false);
  });
});
