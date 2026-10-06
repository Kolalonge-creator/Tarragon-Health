import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { emailFromEnv, paymentFromEnv, selectProvider, videoFromEnv, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/index.ts";

const noFetch: FetchLike = async () => ({ status: 200, ok: true, text: async () => "{}" });
const zoomEnv = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "c", ZOOM_CLIENT_SECRET: "s", ZOOM_SDK_KEY: "k", ZOOM_SDK_SECRET: "x" };

describe("adapters from the environment", () => {
  it("return null, never a mock, when not configured", () => {
    expect(paymentFromEnv({}, noFetch)).toBeNull();
    expect(paymentFromEnv({ PAYSTACK_SECRET_KEY: "" }, noFetch)).toBeNull();
    expect(emailFromEnv({ RESEND_API_KEY: "k" }, noFetch)).toBeNull();
    expect(emailFromEnv({ RESEND_FROM: "a <a@example.com>" }, noFetch)).toBeNull();
    for (const missing of Object.keys(zoomEnv)) {
      expect(videoFromEnv({ ...zoomEnv, [missing]: undefined }, noFetch)).toBeNull();
    }
  });

  it("build the real adapter when configured, with optional webhook secrets", () => {
    expect(paymentFromEnv({ PAYSTACK_SECRET_KEY: "sk" }, noFetch)).toMatchObject({ name: "paystack", isMock: false });
    expect(paymentFromEnv({ PAYSTACK_SECRET_KEY: "sk", PAYSTACK_WEBHOOK_SECRET: "wh" }, noFetch)).toMatchObject({ isMock: false });
    expect(emailFromEnv({ RESEND_API_KEY: "k", RESEND_FROM: "a <a@example.com>", RESEND_WEBHOOK_SECRET: "whsec_x", RESEND_REPLY_TO: "care@example.com" }, noFetch)).toMatchObject({ name: "resend" });
    expect(emailFromEnv({ RESEND_API_KEY: "k", RESEND_FROM: "a <a@example.com>" }, noFetch)).toMatchObject({ name: "resend" });
    expect(videoFromEnv(zoomEnv, noFetch)).toMatchObject({ name: "zoom" });
    expect(videoFromEnv({ ...zoomEnv, ZOOM_WEBHOOK_SECRET_TOKEN: "t" }, noFetch)).toMatchObject({ name: "zoom" });
  });

  it("an unconfigured production runtime gets an error from selectProvider, not a mock", () => {
    const r = selectProvider({ environment: "production", real: paymentFromEnv({}, noFetch), mock: () => createMockPayment() });
    expect(r.ok).toBe(false);
  });
});

describe("no mock in application code", () => {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
  const skipDirs = new Set(["node_modules", ".next", ".git", "dist", ".claude", ".expo", "build", "coverage"]);
  const allowed = (rel: string): boolean =>
    rel.startsWith(`supabase${sep}functions${sep}_shared${sep}integrations${sep}`) || rel.startsWith(`packages${sep}integrations${sep}`) || /\.test\.tsx?$/.test(rel) || rel.includes(`${sep}__tests__${sep}`);
  const walk = (dir: string, out: string[]): string[] => {
    for (const name of readdirSync(dir)) {
      if (skipDirs.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  };

  it("only the adapter package and tests may name createMockPayment, Video, Speech or Email", () => {
    const hits: string[] = [];
    for (const top of ["apps", "packages", "supabase"]) {
      for (const file of walk(join(root, top), [])) {
        const rel = relative(root, file);
        if (allowed(rel)) continue;
        if (/createMock(Payment|Video|Speech|Email)\b/.test(readFileSync(file, "utf8"))) hits.push(rel);
      }
    }
    expect(hits).toEqual([]);
  });
});
