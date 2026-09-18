import { denialReasonFromError, isPermissionDeniedError, logDeniedAction } from "./log-denied-action";

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

  it("is fire-and-forget: an RPC rejection never throws or produces an unhandled rejection", async () => {
    const rpc = jest.fn().mockRejectedValue(new Error("network error"));
    // Must not throw synchronously...
    expect(() => logDeniedAction(base, { rpc })).not.toThrow();
    // ...and the rejection must actually be handled, not just deferred --
    // await the mocked call so a missing .catch() would surface here as an
    // unhandled rejection rather than passing silently.
    await expect(rpc.mock.results[0]!.value).rejects.toThrow("network error");
  });

  it("is fire-and-forget: an RPC error result never throws", () => {
    const { client } = mockClient({ error: { code: "42501", message: "permission denied" } });
    expect(() => logDeniedAction(base, client)).not.toThrow();
  });
});
