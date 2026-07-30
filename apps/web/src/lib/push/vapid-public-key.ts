/**
 * VAPID public key for Web Push subscription (PushManager.subscribe's
 * applicationServerKey). Public keys are meant to be shipped to the
 * browser — RFC 8292 has no confidentiality requirement on this half of the
 * keypair, only the private key (an Edge Function secret, never sent to any
 * client) needs protecting. Falls back to the key generated for this build
 * so push works immediately; NEXT_PUBLIC_VAPID_PUBLIC_KEY overrides it if
 * the keys are ever rotated.
 */
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  "BLVTmSFVVgeoerYz8ftE-e7ykH57mPSn_WkvqPCC1J8HhAb075qxtyE6mUqM9sYvfvI81xpeHEA8aFzfFBvb6f8";
