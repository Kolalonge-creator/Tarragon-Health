import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_SURFACES, scanAiSurface, scanAnalyticsCalls, scanPackageJson, scanText } from "./scan";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

describe("S87 extension rules discriminate (sabotage)", () => {
  const MKT = "apps/web/src/app/(marketing)/page.tsx";
  const ids = (content: string, file = "apps/web/src/x.tsx") => scanText(file, content).map((v) => v.rule);

  it("patient-sms catches Termii and sendSms-style sends, not the verification hook or a status check", () => {
    expect(ids('await fetch("https://api.ng.termii.com/api/sms/send", {})', "supabase/functions/paystack-webhook/handler.ts")).toContain("patient-sms");
    expect(ids("await sendReservationInviteSms(phone, text);", "supabase/functions/x/handler.ts")).toContain("patient-sms");
    expect(ids("const k = Deno.env.get('TERMII_API_KEY');", "supabase/functions/x/index.ts")).toContain("patient-sms");
    expect(ids("await sendTermiiSms(to, body);", "supabase/functions/x/index.ts")).toContain("patient-sms");
    expect(ids('fetch("https://api.ng.termii.com/api/sms/send")', "supabase/functions/auth-send-sms-hook/" + "provider.ts")).toEqual([]);
    expect(ids("Boolean(process.env.TERMII_API_KEY)", "apps/web/src/lib/status/check-dependencies.ts")).toEqual([]);
  });

  it("tracker-script and tracker-sdk fail on a tracker and pass on none", () => {
    expect(ids('<Script src="https://www.googletagmanager.com/gtag/js?id=G-1" />', "apps/web/src/app/layout.tsx")).toContain("tracker-script");
    expect(ids("fbq('track', 'PageView');")).toContain("tracker-script");
    expect(ids('<script src="https://cdn.example.com/a.js"></script>')).toContain("tracker-script");
    expect(ids("<main>Hello</main>")).toEqual([]);
    for (const dep of ["posthog-react-native", "@segment/analytics-react-native", "mixpanel-browser", "@vercel/analytics", "@react-native-firebase/analytics"]) {
      const bad = JSON.stringify({ dependencies: { [dep]: "1.0.0" } });
      expect(scanPackageJson("apps/mobile/package.json", bad).map((v) => v.rule)).toEqual(["tracker-sdk"]);
    }
    const ok = JSON.stringify({ dependencies: { "@sentry/nextjs": "1.0.0", next: "16.0.0" } });
    expect(scanPackageJson("apps/web/package.json", ok)).toEqual([]);
  });

  it("analytics-health-field flags health fields passed to a tracking call", () => {
    expect(scanAnalyticsCalls("a.ts", "track('bp_logged', { reading: 150 });").map((v) => v.rule)).toEqual(["analytics-health-field"]);
    expect(scanAnalyticsCalls("a.ts", "analytics.capture('x', {\n  condition: 'diabetes',\n});").length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", 'logEvent("screen_view", { screen: "home" });')).toEqual([]);
    expect(scanAnalyticsCalls("a.ts", "const reading = 5; render(reading);")).toEqual([]);
  });

  it("ai-label requires the shared label on every AI surface and flags a hand-typed one", () => {
    expect(scanAiSurface("s.tsx", "export const A = () => <Badge>x</Badge>;").map((v) => v.rule)).toEqual(["ai-label"]);
    expect(scanAiSurface("s.tsx", 'import { AiLabel } from "x"; <AiLabel variant="drafted" />')).toEqual([]);
    expect(scanAiSurface("m.tsx", "<MutedText>{AI_LABEL_TEXT.coach}</MutedText>")).toEqual([]);
    expect(ids('<Badge variant="grey">AI-drafted, not yet reviewed</Badge>')).toContain("ai-label");
    expect(ids("// an AI-drafted card\nconst a = 1;")).toEqual([]);
    expect(AI_SURFACES.length).toBeGreaterThanOrEqual(10);
  });

  it("marketing-claim, doctor-led, testimonial and trial copy are flagged; debunking and negation pass", () => {
    expect(ids('title: "This diet cures diabetes"', MKT)).toContain("marketing-claim");
    expect(ids('copy: "Guaranteed results in 30 days"', MKT)).toContain("marketing-claim");
    expect(ids('copy: "NAFDAC approved device"', MKT)).toContain("marketing-claim");
    expect(ids('copy: "Talk to an instant doctor"', MKT)).toContain("marketing-claim");
    expect(ids('copy: "Free healthcare for all"', MKT)).toContain("marketing-claim");
    expect(ids('copy: "Diabetes has no cure, only control"', MKT)).toEqual([]);
    expect(ids('copy: "Marketed as cancer cures that are not"', MKT)).toEqual([]);
    expect(ids('hero: "A doctor-led health app"', MKT)).toContain("doctor-led-headline");
    expect(ids('{ id: "t1", quote: "Changed my life", name: "A" }', MKT)).toContain("testimonial-hardcoded");
    expect(ids("type T = { quote: string };", MKT)).toEqual([]);
    expect(ids('copy: "Start your free trial"', MKT)).toContain("trial-copy");
    expect(ids('copy: "then you will be charged monthly"', MKT)).toContain("trial-copy");
    expect(ids('copy: "No free trial, no surprise charge"', MKT)).toEqual([]);
    // the same words outside marketing and copy are not scanned by the claims rules
    expect(ids('copy: "This diet cures diabetes"', "apps/web/src/lib/other.ts")).not.toContain("marketing-claim");
  });

  it("paystack-recurring flags plan or subscription creation", () => {
    expect(ids('await fetch("https://api.paystack.co/plan", { method: "POST" })', "apps/web/src/lib/paystack/plans.ts")).toContain("paystack-recurring");
    expect(ids("await createPlan({ interval: 'monthly' })", "apps/web/src/lib/paystack/plans.ts")).toContain("paystack-recurring");
    expect(ids('case "subscription.create": {', "supabase/functions/paystack-webhook/handler.ts")).toContain("paystack-recurring");
    expect(ids('fetch("https://api.paystack.co/transaction/initialize")', "apps/web/src/lib/paystack/transactions.ts")).toEqual([]);
  });

  it("the webhook no longer sends a reservation invite SMS or holds the retired credit branch", () => {
    const handler = readFileSync(join(repoRoot, "supabase/functions/paystack-webhook/handler.ts"), "utf8");
    expect(handler).not.toMatch(/termii|sendReservationInviteSms/i);
    expect(handler).not.toContain("platform_credit_topup");
  });
});
