import { constantTimeEqual, hmacHex } from "../integrations/crypto.ts";

/**
 * The one-click unsubscribe token (F10). It is an HMAC of the contact id under FD_UNSUBSCRIBE_SECRET, so a link cannot be forged or used to
 * unsubscribe someone else, and it carries no personal data. It does not expire: an old email must still be able to stop future ones.
 * Plain TypeScript on WebCrypto so the Edge Function that mints it and the web route that verifies it share one definition.
 */
const LENGTH = 40;

export async function unsubscribeToken(secret: string, contactId: string): Promise<string> {
  return (await hmacHex("SHA-256", secret, `fd-unsub:${contactId}`)).slice(0, LENGTH);
}

export async function verifyUnsubscribeToken(secret: string, contactId: string, token: string): Promise<boolean> {
  if (!secret || !/^[0-9a-f-]{36}$/.test(contactId) || !/^[0-9a-f]{40}$/.test(token)) return false;
  return constantTimeEqual(await unsubscribeToken(secret, contactId), token);
}
