import {
  hasBroadcastLinkSecret,
  signBroadcastLinkMessage,
  verifyBroadcastLinkToken,
} from "./link-token";

describe("broadcast link signing", () => {
  const ORIGINAL_ENV = process.env.BROADCAST_LINK_SECRET;

  afterEach(() => {
    process.env.BROADCAST_LINK_SECRET = ORIGINAL_ENV;
  });

  it("reports no secret configured when the env var is unset", () => {
    delete process.env.BROADCAST_LINK_SECRET;
    expect(hasBroadcastLinkSecret()).toBe(false);
    expect(signBroadcastLinkMessage("unsub:abc")).toBeNull();
    expect(verifyBroadcastLinkToken("anything.anything", "unsub:abc")).toBe(false);
  });

  it("signs and verifies a token for the exact same message", () => {
    process.env.BROADCAST_LINK_SECRET = "test-secret-value";
    const token = signBroadcastLinkMessage("unsub:profile-123");
    expect(token).not.toBeNull();
    expect(verifyBroadcastLinkToken(token, "unsub:profile-123")).toBe(true);
  });

  it("namespaces by purpose — a token for one message never verifies for another", () => {
    process.env.BROADCAST_LINK_SECRET = "test-secret-value";
    const openToken = signBroadcastLinkMessage("open:notif-1");
    // Same secret, same "notif-1" substring, different purpose — must fail.
    expect(verifyBroadcastLinkToken(openToken, "click:notif-1:https://example.com")).toBe(false);
    expect(verifyBroadcastLinkToken(openToken, "open:notif-2")).toBe(false);
  });

  it("a click token's signature is tied to the destination URL — swapping the URL invalidates it", () => {
    process.env.BROADCAST_LINK_SECRET = "test-secret-value";
    const token = signBroadcastLinkMessage("click:notif-1:https://tarragonhealth.ng/book");
    expect(verifyBroadcastLinkToken(token, "click:notif-1:https://tarragonhealth.ng/book")).toBe(
      true
    );
    // An attacker holding a valid token cannot redirect it elsewhere by
    // reconstructing the expected message with a different URL.
    expect(verifyBroadcastLinkToken(token, "click:notif-1:https://evil.example.com")).toBe(false);
  });

  it("rejects a token signed under a different secret", () => {
    process.env.BROADCAST_LINK_SECRET = "secret-one";
    const token = signBroadcastLinkMessage("unsub:profile-123");
    process.env.BROADCAST_LINK_SECRET = "secret-two";
    expect(verifyBroadcastLinkToken(token, "unsub:profile-123")).toBe(false);
  });

  it("rejects a missing or malformed token", () => {
    process.env.BROADCAST_LINK_SECRET = "test-secret-value";
    expect(verifyBroadcastLinkToken(null, "unsub:profile-123")).toBe(false);
    expect(verifyBroadcastLinkToken("not-a-real-token", "unsub:profile-123")).toBe(false);
  });
});
