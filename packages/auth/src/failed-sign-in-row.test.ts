import { describe, expect, it } from "@jest/globals";
import { failedSignInRow } from "./failed-sign-in-row";

describe("failedSignInRow (security audit 2026-11-05, H-7)", () => {
  it("never stores the raw email or phone", () => {
    const row = failedSignInRow("Ada@Example.com", "email_password", "203.0.113.7", "k");
    expect(JSON.stringify(row)).not.toMatch(/ada@example\.com/i);
    expect(row.event.identifier_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("groups the same account regardless of case and spacing", () => {
    const a = failedSignInRow("  Ada@Example.com ", "email_password", "203.0.113.7", "k");
    const b = failedSignInRow("ada@example.com", "email_password", "198.51.100.2", "k");
    expect(a.event.identifier_hash).toBe(b.event.identifier_hash);
  });

  it("depends on the key, so the hash cannot be looked up without it", () => {
    expect(failedSignInRow("ada@example.com", "email_password", "::1", "k1").event.identifier_hash).not.toBe(
      failedSignInRow("ada@example.com", "email_password", "::1", "k2").event.identifier_hash
    );
  });

  it("stores a null ip when there is no real address (audit_log.ip is inet)", () => {
    expect(failedSignInRow("+2348012345678", "phone_code", "unknown", "k").ip).toBeNull();
    expect(failedSignInRow("+2348012345678", "phone_code", "2001:db8::1", "k").ip).toBe("2001:db8::1");
  });

  it("is a failed auth.sign_in_failed row with the method", () => {
    expect(failedSignInRow("x@y.z", "phone_password", "::1", "k")).toMatchObject({
      action: "auth.sign_in_failed",
      entity_type: "auth_identifier",
      result: "failed",
      event: { method: "phone_password" },
    });
  });
});
