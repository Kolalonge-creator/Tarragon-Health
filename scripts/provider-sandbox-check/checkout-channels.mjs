// S71 checkout test run: the part that CAN be automated with a Paystack TEST key, and the list of what cannot (it needs a person, a test card or a
// bank-transfer simulation in the Paystack dashboard). Opt-in: runs only with `--only paystack-checkout`, so the default sandbox run is unchanged.
//
// Same hard rules as checks.mjs (refusal of any sk_live_ key and redaction are applied by runChecks and the CLI before this is reached):
// no money moves here. A transaction is initialised per channel and left unpaid; the platform database and webhook endpoint are never touched.
//
// STATUS: NOT RUN. No Paystack test key has been supplied. Nothing in this file has been executed against Paystack; it is exercised only against the
// repo's fake vendor in checkout-channels.test.mjs. Do not report a PASS from this file as evidence about Paystack until it has run with a real test key.
import { randomBytes } from "node:crypto";
import { createPaystackPayment } from "../../supabase/functions/_shared/integrations/index.ts";

/** The channels the checkout asks for (supabase/functions/_shared/commerce/checkout.ts DEFAULT_CHECKOUT_CHANNELS). Kept in step by the test. */
export const CHECKOUT_CHANNELS = ["card", "bank_transfer", "ussd"];

/** Every step a person must do with a test key. The ids are the headings of docs/design/S71-checkout-test-run.md; a test keeps them in step. */
export const MANUAL_STEPS = [
  { id: "M1", title: "Card payment, success" },
  { id: "M2", title: "Card payment, declined and abandoned" },
  { id: "M3", title: "Bank transfer, paid late" },
  { id: "M4", title: "USSD, paid late" },
  { id: "M5", title: "Webhook delivery and replay" },
  { id: "M6", title: "Reconcile sweep" },
  { id: "M7", title: "Refund" },
  { id: "M8", title: "Sponsor covered order (no payment)" },
  { id: "M9", title: "Foreign card estimate" },
];

const rand = () => randomBytes(5).toString("hex");
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

async function step(results, capability, fn) {
  try {
    const r = await fn();
    results.push({ provider: "paystack-checkout", capability, status: r?.skip ? "SKIP" : "PASS", detail: r?.skip ?? r?.detail ?? "" });
  } catch (e) {
    results.push({ provider: "paystack-checkout", capability, status: "FAIL", detail: e instanceof Error ? e.message : String(e) });
  }
}

export async function checkCheckoutChannels(env, fetchImpl, results) {
  const key = env.PAYSTACK_TEST_SECRET_KEY || env.PAYSTACK_SECRET_KEY;
  if (!key) return void results.push({ provider: "paystack-checkout", capability: "all", status: "SKIP", detail: "no PAYSTACK_TEST_SECRET_KEY" });
  const pay = createPaystackPayment({ secretKey: key, webhookSecret: env.PAYSTACK_WEBHOOK_SECRET || key, fetch: fetchImpl });
  for (const channel of CHECKOUT_CHANNELS) {
    const ref = `s71-${channel}-${Date.now()}-${rand()}`;
    await step(results, `${channel}: initialise a ${channel}-only checkout, leave it unpaid, and it reads as not paid`, async () => {
      const init = await pay.initializeTransaction({ reference: ref, email: "sandbox@example.com", amountKobo: 25_000, channels: [channel] });
      need(init.ok, `initialize: ${init.ok ? "" : `${init.error.code} (${init.error.message})`}`);
      need(init.data.authorizationUrl.startsWith("https://"), "no https checkout url");
      need(init.data.reference === ref, "reference was changed by the vendor");
      const v = await pay.verifyTransaction(ref);
      need(v.ok, `verify: ${v.ok ? "" : v.error.code}`);
      need(v.data.status !== "success", `an unpaid ${channel} charge reads ${v.data.status}`);
      need(v.data.currency === "NGN", `currency ${v.data.currency}`);
      return { detail: `unpaid status ${v.data.status}. Pay it by hand (see M${channel === "card" ? 1 : channel === "bank_transfer" ? 3 : 4}): ${init.data.authorizationUrl}` };
    });
  }
  for (const s of MANUAL_STEPS) results.push({ provider: "paystack-checkout", capability: `${s.id} ${s.title}`, status: "SKIP", detail: "NOT RUN: needs a person with a test key. See docs/design/S71-checkout-test-run.md" });
}
