import test from "node:test";
import assert from "node:assert/strict";
import { checkTarget, STAGES } from "./stages.js";

const REF = "abcdefghij0123456789";

test("local hosts are allowed", () => {
  for (const u of ["http://localhost:54321", "http://127.0.0.1:54321/rest/v1", "http://host.docker.internal:54321"]) assert.equal(checkTarget(u).ok, true, u);
});

test("a hosted project is allowed only when its ref is listed", () => {
  assert.equal(checkTarget(`https://${REF}.supabase.co`).ok, false);
  assert.equal(checkTarget(`https://${REF}.supabase.co`, "other, " + REF).ok, true);
  assert.equal(checkTarget(`https://${REF.toUpperCase()}.supabase.co`, REF).ok, true);
});

test("anything else is refused, including look-alike hosts (sabotage: an allowlist that only blocked the live ref would pass these)", () => {
  for (const u of ["https://example.com", "https://evil.com/localhost", `https://${REF}.supabase.co.evil.com`, "http://localhost.evil.com", "https://staging.tarragonhealth.com", "", undefined, "not a url"]) {
    assert.equal(checkTarget(u, REF).ok, false, String(u));
  }
});

test("the live project and the production domain are refused even when listed", () => {
  assert.equal(checkTarget("https://koiplnmbgnqnbywhpjlf.supabase.co", "koiplnmbgnqnbywhpjlf").ok, false);
  assert.equal(checkTarget("https://app.tarragonhealth.ng", "app").ok, false);
  assert.equal(checkTarget("https://tarragonhealth.ng").ok, false);
});

test("stages are queue-only: they carry doctors and timing, not Member counts", () => {
  for (const s of Object.values(STAGES)) {
    assert.equal("members" in s, false);
    assert.ok(s.doctors > 0);
  }
});
