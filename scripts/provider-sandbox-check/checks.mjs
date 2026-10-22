// Provider sandbox check: exercises the real vendor adapters (the same code the platform runs) against each vendor's SANDBOX or TEST
// mode with credentials from the environment, and says PASS / FAIL / SKIP per capability.
//
// Hard rules, enforced here and tested in checks.test.mjs:
//   * A live Paystack key (sk_live_...) in ANY variable stops the whole run before a single request is made.
//   * No secret is ever printed: every line goes through redact(), which masks each secret value (and its tail) found in the environment.
//   * Resend mail goes only to Resend's own test inboxes (@resend.dev). Termii is read-only (balance, sender ids): it never sends an SMS.
//   * Zoom has no sandbox, so a run creates one short real meeting under the dedicated test host user and deletes it; it only runs when
//     the caller passes allowZoomMeeting.
//   * Nothing here touches the platform database or a production webhook endpoint.
import { createHmac, randomBytes } from "node:crypto";
import {
  createPaystackPayment,
  createResendEmail,
  createZoomVideo,
  hmacHex,
} from "../../supabase/functions/_shared/integrations/index.ts";

export const SECRET_ENV_NAMES = [
  "PAYSTACK_TEST_SECRET_KEY", "PAYSTACK_SECRET_KEY", "PAYSTACK_WEBHOOK_SECRET",
  "ZOOM_CLIENT_SECRET", "ZOOM_SDK_SECRET", "ZOOM_WEBHOOK_SECRET_TOKEN",
  "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "TERMII_API_KEY",
];

/** A reason to refuse the whole run, or null. Looks at every variable, not just the Paystack ones: a live key in the wrong place is still live. */
export function refusal(env) {
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string" && /sk_live_/i.test(value)) return `${name} holds a live Paystack key (sk_live_). This check only runs with test keys. Nothing was called.`;
  }
  const paystack = env.PAYSTACK_TEST_SECRET_KEY || env.PAYSTACK_SECRET_KEY;
  if (paystack && !paystack.startsWith("sk_test_")) return "The Paystack key does not start with sk_test_. This check only runs with a test key. Nothing was called.";
  return null;
}

/** Masks every secret value in the environment (whole, and the 6-character tail) in any text that is about to be shown. */
export function makeRedactor(env) {
  const secrets = new Set();
  for (const name of SECRET_ENV_NAMES) {
    const v = env[name];
    if (typeof v === "string" && v.length >= 6) {
      secrets.add(v);
      secrets.add(v.slice(-6));
    }
  }
  const list = [...secrets].sort((a, b) => b.length - a.length);
  return (text) => list.reduce((acc, s) => acc.split(s).join("[redacted]"), String(text));
}

const rand = () => randomBytes(5).toString("hex");

// Independent re-implementations of each vendor's documented signature (node:crypto), so a mistake in the adapter's WebCrypto copy cannot
// hide behind the same mistake in its own test.
export const zoomSignature = (secret, ts, body) => `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
export const zoomChallenge = (secret, plain) => createHmac("sha256", secret).update(plain).digest("hex");
export const paystackSignature = (secret, body) => createHmac("sha512", secret).update(body).digest("hex");
export function svixSignature(secret, id, ts, body) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

/** Runs one named check; a thrown error becomes FAIL with a short reason, never a crash. */
async function step(results, provider, capability, fn) {
  try {
    const r = await fn();
    results.push({ provider, capability, status: r?.skip ? "SKIP" : "PASS", detail: r?.skip ?? r?.detail ?? "" });
  } catch (e) {
    results.push({ provider, capability, status: "FAIL", detail: e instanceof Error ? e.message : String(e) });
  }
}
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const needOk = (r, what) => {
  need(r.ok, `${what}: ${r.ok ? "" : `${r.error.code} (${r.error.message})`}`);
  return r.data;
};

// ---------------------------------------------------------------- Paystack
export async function checkPaystack(env, fetchImpl, results) {
  const key = env.PAYSTACK_TEST_SECRET_KEY || env.PAYSTACK_SECRET_KEY;
  if (!key) return void results.push({ provider: "paystack", capability: "all", status: "SKIP", detail: "no PAYSTACK_TEST_SECRET_KEY" });
  const webhookSecret = env.PAYSTACK_WEBHOOK_SECRET || key;
  const pay = createPaystackPayment({ secretKey: key, webhookSecret, fetch: fetchImpl });
  const ref = `sbx-${Date.now()}-${rand()}`;
  const trfRef = `sbx-trf-${Date.now()}-${rand()}`;
  const body = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: 10000, currency: "NGN", requested_amount: 10000, fees: 150, customer: { email: "sandbox@example.com" } } });

  await step(results, "paystack", "webhook signature: adapter agrees with an independent HMAC-SHA512, refuses tampering", async () => {
    const good = await pay.parseWebhook(body, paystackSignature(webhookSecret, body));
    need(good.ok && good.data.kind === "charge_success", "a correctly signed event was not accepted");
    const bad = await pay.parseWebhook(body.replace("10000", "1"), paystackSignature(webhookSecret, body));
    need(!bad.ok && bad.error.code === "invalid_signature", "a tampered body was accepted");
  });
  await step(results, "paystack", "list banks (paged by cursor)", async () => {
    const banks = needOk(await pay.listBanks(), "listBanks");
    need(banks.length >= 3, `only ${banks.length} banks came back`);
    return { detail: `${banks.length} banks` };
  });
  await step(results, "paystack", "initialize a transaction (no money moves)", async () => {
    const t = needOk(await pay.initializeTransaction({ reference: ref, email: "sandbox@example.com", amountKobo: 10000, channels: ["card", "bank_transfer"] }), "initialize");
    need(t.authorizationUrl.startsWith("https://"), "no https checkout url");
    need(t.reference === ref, "reference was changed by the vendor");
  });
  await step(results, "paystack", "verify an unpaid transaction is not success", async () => {
    const v = needOk(await pay.verifyTransaction(ref), "verify");
    need(v.status !== "success", `unpaid charge reads ${v.status}`);
    need(v.currency === "NGN", `currency ${v.currency}`);
    return { detail: `status ${v.status}` };
  });
  await step(results, "paystack", "a reused charge reference is a conflict, not a second checkout", async () => {
    const again = await pay.initializeTransaction({ reference: ref, email: "sandbox@example.com", amountKobo: 10000 });
    need(!again.ok && again.error.code === "conflict", `second initialize answered ${again.ok ? "ok" : again.error.code}`);
  });
  await step(results, "paystack", "resolve an account number", async () => {
    const r = await pay.resolveAccount({ accountNumber: "0000000000", bankCode: "058" });
    if (r.ok) return { detail: "resolved" };
    if (r.error.code === "not_found" || r.error.code === "vendor_error") return { skip: `test mode does not resolve this number (${r.error.code}); confirm with a real account in the live dashboard` };
    throw new Error(`resolveAccount: ${r.error.code}`);
  });
  let recipientCode = null;
  await step(results, "paystack", "create a transfer recipient", async () => {
    recipientCode = needOk(await pay.createTransferRecipient({ name: "Sandbox Test", accountNumber: "0000000000", bankCode: "058" }), "recipient").recipientCode;
    need(recipientCode.startsWith("RCP_"), "recipient code has an unexpected shape");
  });
  let first = null;
  await step(results, "paystack", "initiate a transfer (shape, status, kobo)", async () => {
    need(recipientCode, "no recipient to pay");
    first = needOk(await pay.initiateTransfer({ reference: trfRef, amountKobo: 10000, recipientCode, reason: "sandbox check" }), "transfer");
    need(first.amountKobo === 10000, `amount came back ${first.amountKobo}`);
    need(first.reference === trfRef, "transfer reference was changed");
    return { detail: `status ${first.status}${first.status === "needs_attention" ? " (an OTP is waiting: turn transfer OTP off in the dashboard to match the founder decision)" : ""}` };
  });
  await step(results, "paystack", "the same transfer reference never pays twice (idempotency)", async () => {
    need(first, "no first transfer");
    const second = await pay.initiateTransfer({ reference: trfRef, amountKobo: 10000, recipientCode, reason: "sandbox check" });
    if (second.ok) need(second.data.transferCode === first.transferCode, "a second, different transfer was created for the same reference");
    else need(second.error.code === "conflict", `second send answered ${second.error.code}`);
  });
  await step(results, "paystack", "verify a transfer by reference", async () => {
    need(first, "no first transfer");
    const v = needOk(await pay.verifyTransfer(trfRef), "verifyTransfer");
    need(v.transferCode === first.transferCode, "verify returned a different transfer");
  });
  await step(results, "paystack", "list settlements and one settlement's transactions (read only)", async () => {
    const l = needOk(await pay.listSettlements({ perPage: 5 }), "listSettlements");
    if (l.items.length === 0) return { skip: "no settlement exists in test mode yet; the field names stay unproven until a live settlement is read once" };
    const t = needOk(await pay.listSettlementTransactions(l.items[0].settlementId, { perPage: 5 }), "listSettlementTransactions");
    return { detail: `${l.items.length} settlements, ${t.items.length} lines in the first` };
  });
}

// ---------------------------------------------------------------- Zoom
export async function checkZoom(env, fetchImpl, results, { allowZoomMeeting }) {
  if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) return void results.push({ provider: "zoom", capability: "all", status: "SKIP", detail: "no ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET" });
  const secret = env.ZOOM_WEBHOOK_SECRET_TOKEN || `sbx-${rand()}`;
  const zoom = createZoomVideo({
    accountId: env.ZOOM_ACCOUNT_ID, clientId: env.ZOOM_CLIENT_ID, clientSecret: env.ZOOM_CLIENT_SECRET,
    sdkKey: env.ZOOM_SDK_KEY || undefined, sdkSecret: env.ZOOM_SDK_SECRET || undefined,
    webhookSecretToken: secret, hostUserId: env.ZOOM_HOST_USER_ID || undefined, fetch: fetchImpl,
  });
  const now = Date.now();
  const sec = String(Math.floor(now / 1000));
  const ended = JSON.stringify({ event: "meeting.ended", event_ts: now, payload: { object: { id: "81000000001", uuid: "x" } } });

  await step(results, "zoom", "webhook signature and endpoint validation: adapter agrees with an independent HMAC-SHA256", async () => {
    const headers = { "x-zm-request-timestamp": sec, "x-zm-signature": zoomSignature(secret, sec, ended) };
    const good = await zoom.parseWebhook(ended, headers, now);
    need(good.ok && good.data?.kind === "room_ended", "a correctly signed event was not accepted");
    const stale = await zoom.parseWebhook(ended, { "x-zm-request-timestamp": String(Number(sec) - 600), "x-zm-signature": zoomSignature(secret, String(Number(sec) - 600), ended) }, now);
    need(!stale.ok && stale.error.code === "stale_event", "a 10 minute old signed event was not refused");
    const forged = await zoom.parseWebhook(ended, { ...headers, "x-zm-signature": "v0=" + "0".repeat(64) }, now);
    need(!forged.ok && forged.error.code === "invalid_signature", "a forged signature was accepted");
    need((await hmacHex("SHA-256", secret, "abc")) === zoomChallenge(secret, "abc"), "the challenge answer differs from an independent HMAC");
  });
  await step(results, "zoom", "a host user is named (Server-to-Server OAuth cannot use \"me\")", async () => {
    need(env.ZOOM_HOST_USER_ID, "ZOOM_HOST_USER_ID is not set. Zoom's account-level token cannot resolve \"me\", so creating a room will be refused. Set it to the dedicated host user's id or email.");
  });
  if (!allowZoomMeeting) return void results.push({ provider: "zoom", capability: "create / join / dial-in / end a room", status: "SKIP", detail: "Zoom has no sandbox: pass --allow-zoom-meeting to create and delete one short real meeting under the test host user" });

  let roomId = null;
  await step(results, "zoom", "create a room (token, host user, 5 minute meeting, waiting room, no recording)", async () => {
    const r = needOk(await zoom.createRoom({ encounterRef: "5b0c8d4e-3f50-4f0a-9d1e-7a6d2b9e1c11", expiresAtMs: Date.now() + 5 * 60_000 }), "createRoom");
    need(/^\d{9,12}$/.test(r.roomId), `room id ${r.roomId} is not a Zoom meeting id`);
    need(r.recording === "off", "recording is not off");
    roomId = r.roomId;
  });
  await step(results, "zoom", "patient gets a join link, clinician gets a different host link", async () => {
    need(roomId, "no room");
    const p = needOk(await zoom.joinLink({ roomId, role: "patient", mediaMode: "video" }), "patient link");
    const c = needOk(await zoom.joinLink({ roomId, role: "clinician", mediaMode: "video" }), "clinician link");
    need(p.url !== c.url, "both roles got the same link");
  });
  await step(results, "zoom", "Nigerian dial-in numbers", async () => {
    need(roomId, "no room");
    const r = await zoom.dialIn({ roomId, country: "NG" });
    if (r.ok) return { detail: `${r.data.numbers.length} numbers` };
    if (r.error.code === "not_found") return { skip: "the Zoom account carries no Nigerian dial-in numbers: audio-by-phone fallback is not available until it does" };
    throw new Error(`dialIn: ${r.error.code}`);
  });
  await step(results, "zoom", "Meeting SDK join token and host key", async () => {
    need(roomId, "no room");
    if (!env.ZOOM_SDK_KEY || !env.ZOOM_SDK_SECRET) return { skip: "no ZOOM_SDK_KEY / ZOOM_SDK_SECRET (links work without them)" };
    const t = needOk(await zoom.joinToken({ roomId, identity: "5b0c8d4e-3f50-4f0a-9d1e-7a6d2b9e1c11", role: "clinician", ttlSeconds: 300, hostKeyTtlSeconds: 300 }), "joinToken");
    need(t.token.split(".").length === 3, "token is not a JWT");
    need(typeof t.zak === "string" && t.zak.length >= 8, "no host key came back");
  });
  if (roomId) {
    await step(results, "zoom", "end and delete the room, and ending twice is safe", async () => {
      needOk(await zoom.endRoom(roomId, "clinician"), "first end");
      needOk(await zoom.endRoom(roomId, "clinician"), "second end");
    });
  }
}

// ---------------------------------------------------------------- Resend
const TEST_INBOX = /@resend\.dev$/i;
export async function checkResend(env, fetchImpl, results) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return void results.push({ provider: "resend", capability: "all", status: "SKIP", detail: "no RESEND_API_KEY / RESEND_FROM" });
  const whsec = env.RESEND_WEBHOOK_SECRET || `whsec_${randomBytes(24).toString("base64")}`;
  const mail = createResendEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM, webhookSecret: whsec, fetch: fetchImpl });
  const idem = `sbx-${Date.now()}-${rand()}:email`;
  const base = { subject: "Tarragon sandbox check", text: "Sandbox check. Nothing to do.", audience: "staff", idempotencyKey: idem };
  const send = (to, key) => {
    need(TEST_INBOX.test(to), "refusing to send to a real address");
    return mail.send({ ...base, to, idempotencyKey: key });
  };
  let id1 = null;
  await step(results, "resend", "send to the delivered@resend.dev test inbox", async () => {
    id1 = needOk(await send("delivered@resend.dev", idem), "send").providerMessageId;
    need(id1.length > 8, "message id looks wrong");
  });
  await step(results, "resend", "the same Idempotency-Key returns the same message (no double send)", async () => {
    need(id1, "no first send");
    const again = needOk(await send("delivered@resend.dev", idem), "second send");
    need(again.providerMessageId === id1, "a second message id was issued for the same key");
  });
  await step(results, "resend", "send to the bounced@resend.dev test inbox", async () => {
    needOk(await send("bounced@resend.dev", `${idem}-b`), "bounce send");
  });
  await step(results, "resend", "webhook (Svix) signature: adapter agrees with an independent HMAC-SHA256, refuses tampering and replay", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: id1 ?? "00000000-0000-0000-0000-000000000000", to: ["delivered@resend.dev"] } });
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const headers = { id: `msg_${rand()}`, timestamp: ts, signature: svixSignature(whsec, `msg_x`, ts, body) };
    headers.signature = svixSignature(whsec, headers.id, ts, body);
    const good = await mail.parseWebhook(body, headers, now);
    need(good.ok && good.data?.event === "delivered", "a correctly signed event was not accepted");
    const bad = await mail.parseWebhook(body.replace("delivered", "complained"), headers, now);
    need(!bad.ok, "a tampered body was accepted");
    const late = await mail.parseWebhook(body, headers, now + 10 * 60_000);
    need(!late.ok, "a 10 minute old event was accepted");
  });
}

// ---------------------------------------------------------------- Termii (read only)
export async function checkTermii(env, fetchImpl, results) {
  if (!env.TERMII_API_KEY) return void results.push({ provider: "termii", capability: "all", status: "SKIP", detail: "no TERMII_API_KEY" });
  const base = (env.TERMII_BASE_URL || "https://api.ng.termii.com").replace(/\/+$/, "");
  const get = async (path) => {
    const res = await fetchImpl(`${base}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(env.TERMII_API_KEY)}`, { method: "GET", headers: {} });
    const text = await res.text();
    need(res.ok, `HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { throw new Error("reply is not JSON"); }
  };
  await step(results, "termii", "read the account balance (no SMS is sent)", async () => {
    const d = await get("/api/get-balance");
    need(typeof d === "object" && d !== null && ("balance" in d || "user" in d), "balance reply has an unexpected shape");
  });
  await step(results, "termii", "list sender IDs and report whether one is approved (no SMS is sent)", async () => {
    const d = await get("/api/sender-id");
    const rows = Array.isArray(d?.data) ? d.data : [];
    const approved = rows.filter((r) => String(r?.status ?? "").toLowerCase() === "active");
    if (approved.length === 0) return { skip: "no approved sender ID yet: SMS to Nigerian numbers will be filtered until one is (registration is the founder's step)" };
    return { detail: `${approved.length} approved` };
  });
}

/** Runs everything that has credentials. `only` is a list of provider names or empty for all. */
export async function runChecks({ env, fetch: fetchImpl, only = [], allowZoomMeeting = false }) {
  const stop = refusal(env);
  if (stop) return { refused: stop, results: [] };
  const results = [];
  const want = (n) => only.length === 0 || only.includes(n);
  if (want("paystack")) await checkPaystack(env, fetchImpl, results);
  if (want("zoom")) await checkZoom(env, fetchImpl, results, { allowZoomMeeting });
  if (want("resend")) await checkResend(env, fetchImpl, results);
  if (want("termii")) await checkTermii(env, fetchImpl, results);
  return { refused: null, results };
}

export function renderResults(results, redact) {
  const lines = [];
  let provider = "";
  for (const r of results) {
    if (r.provider !== provider) {
      provider = r.provider;
      lines.push(`\n${provider.toUpperCase()}`);
    }
    lines.push(`  ${r.status.padEnd(4)}  ${r.capability}${r.detail ? `\n          ${r.detail}` : ""}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  lines.push(`\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIP")} skipped`);
  return redact(lines.join("\n"));
}
