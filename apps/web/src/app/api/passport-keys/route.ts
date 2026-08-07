import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { CREDENTIAL_FORMAT, VERIFY_ISSUER, VERIFY_ISSUER_DOMAIN } from "@/lib/health-passport/credential";

/**
 * The published public keys, served at
 * `/.well-known/tarragon-passport-keys.json` via a rewrite in next.config.ts.
 *
 * This endpoint is the thing that makes a Health Passport a credential rather
 * than a lookup. With it, an institution can verify a TarragonHealth document
 * entirely on their own — offline, indefinitely, with standard tooling, without
 * telling us they did it and without depending on us being online, in business,
 * or willing. That independence is the point: an institution will not build a
 * process around a check that only works while a Nigerian startup keeps its
 * servers up.
 *
 * Retired keys are published alongside active ones, forever. A key stops signing
 * new documents when it is retired; it never stops verifying the ones it already
 * signed, and dropping it here would silently invalidate every passport issued
 * under it.
 *
 * There is nothing to protect here — a public key is designed to be copied — so
 * the response is deliberately cacheable and open.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const supabase = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("passport_signing_keys")
    .select("kid, algorithm, public_key_spki, created_at, activated_at, retired_at")
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  return Response.json(
    {
      issuer: VERIFY_ISSUER,
      issuer_domain: VERIFY_ISSUER_DOMAIN,
      credential_format: CREDENTIAL_FORMAT,
      documentation: `https://${VERIFY_ISSUER_DOMAIN}/verify`,
      /**
       * The compact form is `THP1.<base64url canonical JSON payload>.<base64url
       * Ed25519 signature>`. Verify by base64url-decoding the middle segment,
       * reading `kid`, taking the matching `public_key_spki` below as DER SPKI,
       * and checking the signature over the decoded payload BYTES exactly as
       * they appear — not over a re-serialisation of the parsed JSON, which
       * would reorder keys and fail.
       */
      verification: {
        algorithm: "Ed25519",
        signed_input: "the base64url-decoded payload segment, verbatim UTF-8 bytes",
        public_key_encoding: "base64 (standard alphabet) of DER SubjectPublicKeyInfo",
      },
      keys: (data ?? []).map((k) => ({
        kid: k.kid,
        alg: k.algorithm,
        public_key_spki: k.public_key_spki,
        created_at: k.created_at,
        activated_at: k.activated_at,
        retired_at: k.retired_at,
        // Retired keys stay listed forever: they still verify every document
        // signed while they were live.
        status: k.retired_at ? "retired" : k.activated_at ? "active" : "published",
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
