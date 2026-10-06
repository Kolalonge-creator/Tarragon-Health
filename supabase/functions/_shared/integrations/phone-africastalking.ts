import { httpJson, asObject, type FetchLike } from "./http.ts";
import { fail, ok, type ProviderResult } from "./result.ts";
import { isUuid } from "./ids.ts";
import { isE164, MAX_BRIDGE_MINUTES, type PhoneBridgeProvider, type PhoneBridgeState } from "./phone.ts";
import type { BridgeRecord, BridgeStore } from "./phone-store.ts";

/**
 * Phone bridge on Africa's Talking Voice (S21, OQ-131: the vendor choice was delegated to us by the founder on 2026-10-06;
 * their published Nigerian rates are about NGN 15 to 20 a minute a leg, against about USD 0.23 a minute on Twilio, which would put a
 * bridged half hour above the price of the consultation).
 *
 * How the two people are joined: we place a call to the PATIENT from a Tarragon-owned Africa's Talking number. When they pick up,
 * Africa's Talking calls our callback; the callback replies with a Dial to the CLINICIAN from the same number. Neither person ever
 * sees the other's number, and neither number is returned by any method here, written to a log, or kept after the bridge ends.
 *
 * Written against Africa's Talking's published Voice API (a form POST to /call with username, from, to and clientRequestId; JSON back
 * with `entries[].status` and `sessionId`; a callback that answers with XML `Dial` actions). It has NOT run against a live account:
 * the first sandbox test must confirm the call and callback shapes below before any real patient depends on it.
 *
 * Things Africa's Talking does not give us, and what we do about each:
 * - Its callbacks are not signed. The route that receives them checks a long secret in the URL, and every callback must also match a
 *   live bridge we created (by clientRequestId, else by session id), so a guessed URL alone does nothing.
 * - It does not report the second leg being answered separately. `clinicianAnswered` therefore means "the second call was dialled",
 *   and a bridge is `connected` once the patient has answered and the clinician has been dialled.
 * - There is no API to hang up a live call. `hangup` closes our record (so no further callback dials anyone), and the Dial carries
 *   `maxDuration` (the seconds left on the bridge) so the call stops at the limit even if nobody hangs up. The first sandbox test must
 *   confirm Africa's Talking honours that attribute; if it does not, set a duration cap on the number in their dashboard instead.
 */
export interface AfricasTalkingConfig {
  readonly username: string;
  readonly apiKey: string;
  /** A Voice number issued to us by Africa's Talking, in E.164. Both calls come from it. */
  readonly callerNumber: string;
  readonly sandbox?: boolean;
  readonly fetch: FetchLike;
  readonly store: BridgeStore;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

const randomBridgeId = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `br_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};

/** Removes anything that looks like a phone number from a vendor message before it can reach an error or a log. */
const scrub = (message: string): string => message.replace(/\+?\d[\d\s-]{6,}\d/g, "[number]");

const REJECT = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

export function createAfricasTalkingPhone(config: AfricasTalkingConfig): PhoneBridgeProvider {
  const now = config.now ?? (() => Date.now());
  const deps = { fetch: config.fetch, timeoutMs: config.timeoutMs ?? 10_000 };
  const base = config.sandbox ? "https://voice.sandbox.africastalking.com" : "https://voice.africastalking.com";

  const store = async <T>(work: () => Promise<T>): Promise<ProviderResult<T>> => {
    try {
      return ok(await work());
    } catch {
      return fail("vendor_error", "The bridge store is unavailable", true);
    }
  };

  return {
    name: "africastalking",
    isMock: false,

    async connect(input) {
      if (!isUuid(input.encounterRef)) return fail("invalid_input", "Encounter reference must be an opaque uuid");
      if (!isE164(input.patientPhone) || !isE164(input.clinicianPhone)) return fail("invalid_input", "Phone numbers must be in international format");
      if (input.patientPhone === input.clinicianPhone) return fail("invalid_input", "The two phone numbers must differ");
      if (!Number.isInteger(input.maxMinutes) || input.maxMinutes <= 0 || input.maxMinutes > MAX_BRIDGE_MINUTES) return fail("invalid_input", "Call length is out of range");
      if (!isE164(config.callerNumber) || !config.username || !config.apiKey) return fail("not_configured", "The calling number or credentials are not set", false);

      // A bridge past its limit, or one that never reached the vendor, is closed first so it cannot block (or be mistaken for) a live one.
      const swept = await store(() => config.store.expireStale(input.encounterRef, now()));
      if (!swept.ok) return swept;
      const existing = await store(() => config.store.findLiveByEncounter(input.encounterRef, now()));
      if (!existing.ok) return existing;
      if (existing.data) return ok({ bridgeId: existing.data.bridgeId, startedAtMs: existing.data.startedAtMs, expiresAtMs: existing.data.expiresAtMs });

      const startedAtMs = now();
      const record: BridgeRecord = {
        bridgeId: randomBridgeId(),
        encounterRef: input.encounterRef,
        clinicianPhone: input.clinicianPhone,
        providerSessionId: null,
        state: "ringing",
        patientAnswered: false,
        clinicianDialled: false,
        startedAtMs,
        expiresAtMs: startedAtMs + input.maxMinutes * 60_000,
      };
      const saved = await store(() => config.store.create(record));
      if (!saved.ok) return saved;
      if (!saved.data) {
        // someone else set up a bridge for this consultation in the same instant: use theirs, ring nobody twice
        const raced = await store(() => config.store.findLiveByEncounter(input.encounterRef, now()));
        if (raced.ok && raced.data) return ok({ bridgeId: raced.data.bridgeId, startedAtMs: raced.data.startedAtMs, expiresAtMs: raced.data.expiresAtMs });
        return fail("conflict", "A call is already being set up for this consultation", true);
      }

      const res = await httpJson(deps, {
        url: `${base}/call`,
        method: "POST",
        headers: { apiKey: config.apiKey, Accept: "application/json" },
        form: { username: config.username, from: config.callerNumber, to: input.patientPhone, clientRequestId: record.bridgeId },
      });
      const closeAsFailed = async () => {
        await store(() => config.store.update(record.bridgeId, { state: "failed" }));
      };
      if (!res.ok) {
        await closeAsFailed();
        return fail(res.error.code, scrub(res.error.message), res.error.retryable);
      }
      const body = asObject(res.data);
      const entries = Array.isArray(body?.["entries"]) ? (body["entries"] as unknown[]) : [];
      const first = asObject(entries[0]);
      const sessionId = first?.["sessionId"];
      if (first?.["status"] !== "Queued" || typeof sessionId !== "string" || sessionId.length === 0) {
        await closeAsFailed();
        const reason = typeof body?.["errorMessage"] === "string" && body["errorMessage"] !== "None" ? body["errorMessage"] : typeof first?.["status"] === "string" ? first["status"] : "The call was not accepted";
        return fail("vendor_error", scrub(reason), false);
      }
      const linked = await store(() => config.store.update(record.bridgeId, { providerSessionId: sessionId }));
      if (!linked.ok) return linked;
      return ok({ bridgeId: record.bridgeId, startedAtMs, expiresAtMs: record.expiresAtMs });
    },

    async status(bridgeId) {
      const found = await store(() => config.store.get(bridgeId));
      if (!found.ok) return found;
      let rec = found.data;
      if (!rec) return fail("not_found", "No such call", false);
      if ((rec.state === "ringing" || rec.state === "connected") && rec.expiresAtMs <= now()) {
        await store(() => config.store.update(bridgeId, { state: "ended" }));
        rec = { ...rec, state: "ended" };
      }
      const state: PhoneBridgeState = rec.state;
      return ok({ state, patientAnswered: rec.patientAnswered, clinicianAnswered: rec.clinicianDialled });
    },

    async hangup(bridgeId) {
      const found = await store(() => config.store.get(bridgeId));
      if (!found.ok) return found;
      if (!found.data) return fail("not_found", "No such call", false);
      // There is no API to hang up a live call: closing the record stops any further callback from dialling anyone.
      const closed = await store(() => config.store.update(bridgeId, { state: "ended" }));
      if (!closed.ok) return closed;
      return ok({ endedAtMs: now() });
    },
  };
}

export interface CallbackDeps {
  readonly store: BridgeStore;
  readonly callerNumber: string;
  readonly now?: () => number;
}

/**
 * Answers Africa's Talking's callback. Pure of HTTP: the route parses the form body and hands it here, and sends back `xml`.
 * - The patient has answered (isActive 1): claim the one-time right to dial and reply with a Dial to the clinician.
 * - The call has ended (isActive 0): close the bridge, which also forgets the clinician's number.
 * - Anything unknown, finished, expired, repeated or malformed gets a Reject and changes nothing.
 */
export async function handleAfricasTalkingCallback(form: Readonly<Record<string, string | undefined>>, deps: CallbackDeps): Promise<{ readonly xml: string }> {
  const now = (deps.now ?? (() => Date.now()))();
  try {
    const byId = typeof form["clientRequestId"] === "string" && /^br_[0-9a-f]{24}$/.test(form["clientRequestId"]) ? await deps.store.get(form["clientRequestId"]) : null;
    const rec = byId ?? (typeof form["sessionId"] === "string" && form["sessionId"].length > 0 ? await deps.store.findBySession(form["sessionId"]) : null);
    if (!rec) return { xml: REJECT };

    if (form["isActive"] === "0") {
      await deps.store.update(rec.bridgeId, { state: "ended" });
      return { xml: REJECT };
    }
    if (form["isActive"] !== "1" || !isE164(deps.callerNumber)) return { xml: REJECT };
    if (rec.expiresAtMs <= now) {
      await deps.store.update(rec.bridgeId, { state: "ended" });
      return { xml: REJECT };
    }
    const clinician = await deps.store.claimDial(rec.bridgeId, now);
    if (!clinician || !isE164(clinician)) return { xml: REJECT };
    // The vendor has no hang-up call, so the limit is also set on the Dial itself: a bridged call nobody ends stops billing at the limit.
    const seconds = Math.max(60, Math.ceil((rec.expiresAtMs - now) / 1000));
    return { xml: `<?xml version="1.0" encoding="UTF-8"?><Response><Dial phoneNumbers="${clinician}" callerId="${deps.callerNumber}" record="false" sequential="false" maxDuration="${seconds}"/></Response>` };
  } catch {
    // Never leave the vendor without an action (an empty reply aborts the call), and never explain what went wrong to it.
    return { xml: REJECT };
  }
}
