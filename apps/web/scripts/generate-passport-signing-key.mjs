#!/usr/bin/env node
/**
 * Mint a Health Passport signing keypair.
 *
 *   node apps/web/scripts/generate-passport-signing-key.mjs [kid]
 *
 * Prints the private key (for the server environment) and the public key (for
 * `register_passport_signing_key`). It writes nothing and sends nothing
 * anywhere: the private half exists in this process and in your terminal
 * scrollback, and nowhere else, which is the only handling of it that is
 * actually safe.
 *
 * ## What to do with the output
 *
 *   1. Put HEALTH_PASSPORT_SIGNING_KEY and HEALTH_PASSPORT_SIGNING_KID into the
 *      server environment (Vercel project settings for production, .env.local
 *      for a machine). The base64 form is given because most secret stores
 *      mangle multi-line values.
 *   2. Register the PUBLIC half, as a platform admin:
 *
 *        select public.register_passport_signing_key('<kid>', '<public spki>');
 *
 *      Nothing verifies until this row exists — the verify page looks the public
 *      key up by kid.
 *
 * ## Rules that matter more than the convenience
 *
 *   - ONE KEY, ONE KID, FOREVER. Never re-point a kid at a different key: every
 *     passport already signed under it would stop verifying, in other people's
 *     filing cabinets, with no way to tell them. Rotating means a NEW kid.
 *   - NEVER put the private key in the database, in the repo, in a
 *     NEXT_PUBLIC_ variable, or in a log line.
 *   - LOSING IT IS SURVIVABLE. Generate a new kid and issue replacements;
 *     already-issued passports keep verifying because their public key stays
 *     published. LEAKING IT IS NOT — anyone holding it can mint documents that
 *     verify as ours, so retire the kid immediately and re-issue.
 *   - Use a different key per environment. A staging key that can sign something
 *     an embassy would accept is a production key with a misleading name.
 */

import { generateKeyPairSync } from "node:crypto";

const kid =
  process.argv[2] ??
  `thp-${new Date().toISOString().slice(0, 7)}`; // e.g. thp-2026-08

if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(kid)) {
  console.error(
    `Invalid kid "${kid}". Lowercase letters, digits, dot, underscore and hyphen; 3-64 characters.`
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicSpkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

console.log(`
Health Passport signing key — kid: ${kid}

────────────────────────────────────────────────────────────────────────
1. SERVER ENVIRONMENT (private — never commit, never store in the database)
────────────────────────────────────────────────────────────────────────

HEALTH_PASSPORT_SIGNING_KID=${kid}
HEALTH_PASSPORT_SIGNING_KEY=${Buffer.from(privatePem, "utf8").toString("base64")}

(that value is the PEM below, base64-encoded, because most secret stores
mangle multi-line values. Either form is accepted.)

${privatePem.trim()}

────────────────────────────────────────────────────────────────────────
2. DATABASE (public — safe to publish, and published on purpose)
────────────────────────────────────────────────────────────────────────

select public.register_passport_signing_key(
  '${kid}',
  '${publicSpkiBase64}'
);

Run as a platform admin. Until this row exists, nothing verifies.
Confirm afterwards at /.well-known/tarragon-passport-keys.json
`);
