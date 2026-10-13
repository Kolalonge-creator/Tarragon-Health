import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLockScreenPayload, type Database, type LockScreenFacts, type LockScreenPayload } from "@tarragon/shared";

/**
 * Apple Wallet and Google Wallet pass generator (S09x-c). DORMANT BY DESIGN.
 *
 * It cannot issue anything today, for three independent reasons, each checked in this order and each failing closed:
 *   1. the `wallet_pass` go-live guard is off and has no conditions branch, so it cannot be switched on until the credentials session adds one;
 *   2. the CMO has not signed the pass field list (C8), so buildLockScreenPayload returns null;
 *   3. no Apple Pass Type ID certificate or Google Wallet issuer account exists, and no signer is wired. Nothing here fabricates one.
 * The layout builders below are pure and tested so the day the credentials exist the only missing piece is a WalletSigner.
 */

export type WalletPlatform = "apple" | "google";

export type WalletIssueResult =
  | { status: "guard_off" }
  | { status: "off_or_unsigned" }
  | { status: "not_configured"; missing: string[] }
  | { status: "failed" }
  | { status: "issued"; platform: WalletPlatform; body: Uint8Array | string };

/** Implemented by the future credentials session: signs the Apple .pkpass bundle or the Google Wallet JWT. Nothing implements it yet. */
export interface WalletSigner {
  sign(platform: WalletPlatform, layout: object): Promise<Uint8Array | string>;
}

export interface WalletCredentials {
  appleTeamId?: string;
  applePassTypeId?: string;
  appleCertificate?: string;
  googleIssuerId?: string;
  googleServiceAccount?: string;
}

export function readWalletCredentials(env: Record<string, string | undefined> = process.env): WalletCredentials {
  return {
    appleTeamId: env.APPLE_WALLET_TEAM_ID,
    applePassTypeId: env.APPLE_WALLET_PASS_TYPE_ID,
    appleCertificate: env.APPLE_WALLET_CERTIFICATE,
    googleIssuerId: env.GOOGLE_WALLET_ISSUER_ID,
    googleServiceAccount: env.GOOGLE_WALLET_SERVICE_ACCOUNT,
  };
}

export function missingCredentials(platform: WalletPlatform, c: WalletCredentials): string[] {
  const need: Array<[string, string | undefined]> =
    platform === "apple"
      ? [["APPLE_WALLET_TEAM_ID", c.appleTeamId], ["APPLE_WALLET_PASS_TYPE_ID", c.applePassTypeId], ["APPLE_WALLET_CERTIFICATE", c.appleCertificate]]
      : [["GOOGLE_WALLET_ISSUER_ID", c.googleIssuerId], ["GOOGLE_WALLET_SERVICE_ACCOUNT", c.googleServiceAccount]];
  return need.filter(([, v]) => !v).map(([k]) => k);
}

/** Apple pass.json (generic style). Fields come only from the minimal payload. The serial is random per issue, never derived from the patient. */
export function buildApplePassLayout(payload: LockScreenPayload, ids: { teamId: string; passTypeId: string; serial: string }) {
  return {
    formatVersion: 1,
    passTypeIdentifier: ids.passTypeId,
    teamIdentifier: ids.teamId,
    serialNumber: ids.serial,
    organizationName: "TarragonHealth",
    description: "Emergency basics",
    generic: {
      primaryFields: payload.rows.slice(0, 1).map((r) => ({ key: r.key, label: r.label, value: r.value })),
      secondaryFields: payload.rows.slice(1, 3).map((r) => ({ key: r.key, label: r.label, value: r.value })),
      auxiliaryFields: payload.rows.slice(3).map((r) => ({ key: r.key, label: r.label, value: r.value })),
    },
  };
}

/** Google Wallet generic object. */
export function buildGoogleWalletLayout(payload: LockScreenPayload, ids: { issuerId: string; objectSuffix: string }) {
  return {
    id: `${ids.issuerId}.${ids.objectSuffix}`,
    classId: `${ids.issuerId}.tarragon_emergency_basics`,
    state: "ACTIVE",
    cardTitle: { defaultValue: { language: "en", value: "TarragonHealth" } },
    header: { defaultValue: { language: "en", value: "Emergency basics" } },
    textModulesData: payload.rows.map((r) => ({ id: r.key, header: r.label, body: r.value })),
  };
}

export async function issueWalletPass(args: {
  supabase: SupabaseClient<Database>;
  platform: WalletPlatform;
  signer?: WalletSigner;
  credentials?: WalletCredentials;
  newId?: () => string;
}): Promise<WalletIssueResult> {
  const { supabase, platform } = args;

  const guard = await supabase.rpc("go_live_guard_is_open", { p_key: "wallet_pass" });
  if (guard.error) return { status: "failed" };
  if (guard.data !== true) return { status: "guard_off" };

  const facts = await supabase.rpc("my_lock_screen_facts");
  if (facts.error) return { status: "failed" };
  const payload = buildLockScreenPayload(facts.data as LockScreenFacts | null, { requireSigned: true });
  if (!payload) return { status: "off_or_unsigned" };

  const creds = args.credentials ?? readWalletCredentials();
  const missing = missingCredentials(platform, creds);
  if (missing.length > 0 || !args.signer) return { status: "not_configured", missing: args.signer ? missing : [...missing, "signer"] };

  const serial = (args.newId ?? (() => crypto.randomUUID()))();
  const layout =
    platform === "apple"
      ? buildApplePassLayout(payload, { teamId: creds.appleTeamId as string, passTypeId: creds.applePassTypeId as string, serial })
      : buildGoogleWalletLayout(payload, { issuerId: creds.googleIssuerId as string, objectSuffix: serial });
  try {
    return { status: "issued", platform, body: await args.signer.sign(platform, layout) };
  } catch {
    return { status: "failed" };
  }
}
