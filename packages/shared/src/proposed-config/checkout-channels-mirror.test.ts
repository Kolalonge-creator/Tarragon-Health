import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const edgeSrc = read("supabase/functions/_shared/commerce/checkout-channels.ts");
const paymentSrc = read("supabase/functions/_shared/integrations/payment.ts");

function strings(re: RegExp, src: string): string[] {
  const m = re.exec(src);
  if (!m?.[1]) throw new Error(`not found: ${re}`);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1] as string);
}
const ALLOW = strings(/PAYMENT_CHANNELS\s*=\s*\[([^\]]*)\]/, paymentSrc);
const MIRROR = strings(/CONFIGURED_CHECKOUT_CHANNELS:\s*unknown\s*=\s*\[([^\]]*)\]/, edgeSrc);
const FALLBACK = strings(/FALLBACK_CHECKOUT_CHANNELS[^=]*=\s*\[([^\]]*)\]/, edgeSrc);

describe("checkout.payment_channels mirrors the edge function constant", () => {
  const entry = getProposedConfig("checkout.payment_channels");
  it("is proposed and identical to the edge mirror and the fallback", () => {
    expect(entry.status).toBe("proposed");
    expect(entry.value).toEqual(MIRROR);
    expect(MIRROR).toEqual(FALLBACK);
  });
  it("is exactly the shipped default and does not contain qr", () => {
    expect(entry.value).toEqual(["card", "bank_transfer", "ussd"]);
    expect(entry.value as string[]).not.toContain("qr");
  });
  it("validates with Zod against the PAYMENT_CHANNELS allow-list", () => {
    const schema = z.array(z.enum(ALLOW as [string, ...string[]])).min(1).refine((a) => new Set(a).size === a.length);
    expect(schema.safeParse(entry.value).success).toBe(true);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse(["zap"]).success).toBe(false);
  });
});
