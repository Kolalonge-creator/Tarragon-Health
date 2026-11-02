/**
 * A browser push subscription is bound to the VAPID public key it was created with
 * (applicationServerKey). After a key rotation the old subscription still exists, so
 * `getSubscription()` hands it back, and the push service then rejects every send signed
 * with the new key. Compare the stored key to the current one so the caller can drop
 * the stale subscription and subscribe again.
 *
 * A subscription that does not expose its key (null) is treated as matching: there is
 * nothing to compare, and discarding a working subscription is the worse mistake.
 */
export function sameApplicationServerKey(existing: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!existing) return true;
  const a = new Uint8Array(existing);
  if (a.length !== expected.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== expected[i]) return false;
  return true;
}
