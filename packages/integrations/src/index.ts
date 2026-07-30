/**
 * Vendor adapter interfaces (whatsapp, sms, voice, email, pay). Build spec v3 §2.1:
 * "Every external vendor sits behind an adapter interface in packages/integrations.
 * No vendor SDK may be imported directly by application code."
 *
 * Not yet built. Populated incrementally alongside M6 (notifications rails) and the
 * billing work (§15, buildable in parallel from M4 onward). Open vendor decisions
 * (voice provider, USSD aggregator) are tracked in the spec's §21/§6 -- do not guess
 * a vendor; the adapter interface itself is not blocked on that decision.
 */
export {};
