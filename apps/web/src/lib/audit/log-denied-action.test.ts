import * as Sentry from "@sentry/nextjs";
import {
  denialReasonFromError,
  handleIfPermissionDenied,
  isPermissionDeniedError,
  logDeniedAction,
} from "./log-denied-action";

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

describe("isPermissionDeniedError", () => {
  it("recognises a Postgres 42501 error", () => {
    expect(isPermissionDeniedError({ code: "42501", message: "permission denied" })).toBe(true);
  });

  it("rejects an unrelated Postgres error code", () => {
    // 22023 is amend_medication's "reason required" validation failure --
    // not an authority denial, must not be logged as one.
    expect(isPermissionDeniedError({ code: "22023", message: "invalid input" })).toBe(false);
  });

  it("rejects a non-error value", () => {
    expect(isPermissionDeniedError(null)).toBe(false);
    expect(isPermissionDeniedError(undefined)).toBe(false);
    expect(isPermissionDeniedError("permission denied")).toBe(false);
    expect(isPermissionDeniedError({})).toBe(false);
  });
});

describe("denialReasonFromError", () => {
  it("uses the real error message -- the guard clause a call site logs for can raise more than one message", () => {
    // e.g. private.enforce_emergency_escalation_tier raises this for a
    // terminal-state re-transition, not the bystander-claim case a
    // hardcoded guess would assume.
    expect(
      denialReasonFromError(
        { code: "42501", message: "This case was already resolved; it cannot be re-resolved or re-referred." },
        "fallback should not be used"
      )
    ).toBe("This case was already resolved; it cannot be re-resolved or re-referred.");
  });

  it("falls back when the error has no usable message", () => {
    expect(denialReasonFromError({ code: "42501" }, "fallback text")).toBe("fallback text");
    expect(denialReasonFromError(null, "fallback text")).toBe("fallback text");
    expect(denialReasonFromError({ code: "42501", message: "   " }, "fallback text")).toBe(
      "fallback text"
    );
  });

  it("caps at 300 characters, matching public.log_denied_action()'s own cap", () => {
    const longMessage = "x".repeat(500);
    expect(denialReasonFromError({ message: longMessage }, "fallback").length).toBe(300);
  });
});

describe("logDeniedAction", () => {
  function mockClient(response: { error: unknown } = { error: null }) {
    const rpc = jest.fn().mockResolvedValue(response);
    return { client: { rpc }, rpc };
  }

  const base = {
    action: "escalations.reassignment_denied",
    entityType: "escalations",
    entityId: "11111111-1111-1111-1111-111111111111",
    organisationId: "22222222-2222-2222-2222-222222222222",
  };

  it("calls public.log_denied_action with the right params, reason included", () => {
    const { client, rpc } = mockClient();
    logDeniedAction({ ...base, reason: "Reassignment attempted without CMO authority" }, client);

    expect(rpc).toHaveBeenCalledWith("log_denied_action", {
      p_action: base.action,
      p_entity_type: base.entityType,
      p_entity_id: base.entityId,
      p_organisation_id: base.organisationId,
      p_reason: "Reassignment attempted without CMO authority",
    });
  });

  it("omits p_reason cleanly when no reason is supplied", () => {
    const { client, rpc } = mockClient();
    logDeniedAction(base, client);

    expect(rpc).toHaveBeenCalledWith(
      "log_denied_action",
      expect.objectContaining({ p_reason: undefined })
    );
  });

  it("is fire-and-forget: an RPC rejection never throws, but is reported so the trail's own silent failures are visible", async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    const rpc = jest.fn().mockRejectedValue(new Error("network error"));
    // Must not throw synchronously...
    expect(() => logDeniedAction(base, { rpc })).not.toThrow();
    // ...and the rejection must actually be handled, not just deferred --
    // await the mocked call so a missing rejection handler would surface
    // here as an unhandled rejection rather than passing silently.
    await expect(rpc.mock.results[0]!.value).rejects.toThrow("network error");
    // Flush the microtask queue so the .then() rejection handler has run.
    await Promise.resolve();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: expect.objectContaining({ action: base.action }) })
    );
  });

  it("is fire-and-forget: an RPC error result never throws, but is reported", async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    const rpcError = { code: "42501", message: "permission denied" };
    const { client } = mockClient({ error: rpcError });
    expect(() => logDeniedAction(base, client)).not.toThrow();
    await Promise.resolve();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({ extra: expect.objectContaining({ action: base.action }) })
    );
  });

  it("does not report to Sentry when the RPC genuinely succeeds", async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    const { client } = mockClient({ error: null });
    logDeniedAction(base, client);
    await Promise.resolve();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("handleIfPermissionDenied", () => {
  const base = {
    action: "escalations.claim_denied",
    entityType: "escalations",
    entityId: "11111111-1111-1111-1111-111111111111",
    organisationId: "22222222-2222-2222-2222-222222222222",
    fallbackReason: "fallback reason",
  };

  it("logs a denial for a 42501, using the error's own message", () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    handleIfPermissionDenied(
      { code: "42501", message: "Only the doctor this case is assigned to can start reviewing it." },
      base,
      { rpc }
    );

    expect(rpc).toHaveBeenCalledWith(
      "log_denied_action",
      expect.objectContaining({
        p_action: base.action,
        p_reason: "Only the doctor this case is assigned to can start reviewing it.",
      })
    );
  });

  it("does not log anything for an unrelated error code -- the shared guard every call site relies on", () => {
    const rpc = jest.fn();
    // 42704 is amend_medication's "Prescription not found" -- not an
    // authority denial. The whole point of factoring this into one shared
    // helper is that no call site can forget this check.
    handleIfPermissionDenied({ code: "42704", message: "Prescription not found" }, base, { rpc });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not throw for a non-error value", () => {
    const rpc = jest.fn();
    expect(() => handleIfPermissionDenied(null, base, { rpc })).not.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
