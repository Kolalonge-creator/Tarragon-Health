import { describe, expect, it } from "@jest/globals";
import { generateApiKey, hashApiKey } from "./api-key";

/**
 * The environment/prefix pairing here is what the database's own
 * api_keys_prefix_matches_environment CHECK constraint enforces server-side
 * (see the integration_gateway_core migration) — these tests guard the
 * TypeScript half of that same contract: a live key must never come out of
 * generateApiKey with a th_test_ prefix, and vice versa, or the DB insert
 * would simply fail with a constraint violation the admin UI has to
 * surface as a confusing error instead of never happening.
 */

describe("generateApiKey", () => {
  it("defaults to a live key with the th_live_ prefix", () => {
    const { key, keyPrefix, environment } = generateApiKey();
    expect(environment).toBe("live");
    expect(key.startsWith("th_live_")).toBe(true);
    expect(keyPrefix).toBe(key.slice(0, 16));
  });

  it("issues a sandbox key with the th_test_ prefix when asked", () => {
    const { key, environment } = generateApiKey("sandbox");
    expect(environment).toBe("sandbox");
    expect(key.startsWith("th_test_")).toBe(true);
  });

  it("never mixes environment and prefix", () => {
    expect(generateApiKey("live").key.startsWith("th_test_")).toBe(false);
    expect(generateApiKey("sandbox").key.startsWith("th_live_")).toBe(false);
  });

  it("generates a unique key on every call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
  });

  it("keyHash is the sha256 hash used to look the key up later", () => {
    const { key, keyHash } = generateApiKey();
    expect(keyHash).toBe(hashApiKey(key));
  });
});

describe("hashApiKey", () => {
  it("is deterministic", () => {
    expect(hashApiKey("th_live_abc")).toBe(hashApiKey("th_live_abc"));
  });

  it("differs for different keys", () => {
    expect(hashApiKey("th_live_abc")).not.toBe(hashApiKey("th_live_xyz"));
  });
});
