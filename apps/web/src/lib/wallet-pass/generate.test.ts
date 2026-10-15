import { buildApplePassLayout, buildGoogleWalletLayout, issueWalletPass, missingCredentials, type WalletSigner } from "./generate";

const FACTS = {
  enabled: true,
  fields_signed: true,
  fields: ["initials", "blood_group", "genotype", "genotype_provenance", "allergies_on_file", "emergency_contact_phone", "unlock_hint"],
  initials: "AB",
  blood_group: "O+",
  genotype: "AS",
  genotype_provenance: "patient_attested",
  allergies_on_file: true,
  emergency_contact_phone: "+2348012345678",
};

function client(over: { guard?: unknown; guardError?: boolean; facts?: unknown; factsError?: boolean }) {
  const rpc = jest.fn(async (name: string) => {
    if (name === "go_live_guard_is_open") return over.guardError ? { data: null, error: { message: "x" } } : { data: over.guard ?? false, error: null };
    return over.factsError ? { data: null, error: { message: "x" } } : { data: over.facts ?? FACTS, error: null };
  });
  return { rpc } as never;
}

const CREDS = { appleTeamId: "T", applePassTypeId: "pass.test", appleCertificate: "c", googleIssuerId: "I", googleServiceAccount: "s" };
const signer: WalletSigner = { sign: jest.fn(async () => "signed") };

describe("issueWalletPass is dormant", () => {
  it("issues nothing while the guard is off, and does not even read the facts", async () => {
    const c = client({ guard: false });
    expect(await issueWalletPass({ supabase: c, platform: "apple", signer, credentials: CREDS })).toEqual({ status: "guard_off" });
    expect((c as unknown as { rpc: jest.Mock }).rpc).toHaveBeenCalledTimes(1);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("issues nothing when the field list is unsigned or the pass is off", async () => {
    expect((await issueWalletPass({ supabase: client({ guard: true, facts: { ...FACTS, fields_signed: false } }), platform: "apple", signer, credentials: CREDS })).status).toBe("off_or_unsigned");
    expect((await issueWalletPass({ supabase: client({ guard: true, facts: { ...FACTS, enabled: false } }), platform: "apple", signer, credentials: CREDS })).status).toBe("off_or_unsigned");
  });

  it("with no credentials and no signer it is 'not_configured' and names what is missing", async () => {
    const r = await issueWalletPass({ supabase: client({ guard: true }), platform: "apple", credentials: {} });
    expect(r).toEqual({ status: "not_configured", missing: ["APPLE_WALLET_TEAM_ID", "APPLE_WALLET_PASS_TYPE_ID", "APPLE_WALLET_CERTIFICATE", "signer"] });
  });

  it("a read failure is 'failed', never a pass", async () => {
    expect((await issueWalletPass({ supabase: client({ guardError: true }), platform: "google", signer, credentials: CREDS })).status).toBe("failed");
    expect((await issueWalletPass({ supabase: client({ guard: true, factsError: true }), platform: "google", signer, credentials: CREDS })).status).toBe("failed");
  });

  it("only when every gate is open does it hand the minimal layout to the signer (the gate opens, not only closes)", async () => {
    const sign = jest.fn(async (_platform: string, _layout: object) => "signed");
    const r = await issueWalletPass({ supabase: client({ guard: true }), platform: "google", signer: { sign }, credentials: CREDS, newId: () => "serial-1" });
    expect(r).toEqual({ status: "issued", platform: "google", body: "signed" });
    const layout = JSON.stringify(sign.mock.calls[0]?.[1]);
    expect(layout).toContain("O+");
    expect(layout.toLowerCase()).not.toMatch(/penicillin|metformin|hypertension|diabetes/);
  });
});

describe("layouts", () => {
  const payload = { rows: [{ key: "initials", label: "Initials", value: "AB" }, { key: "blood_group", label: "Blood group", value: "O+" }, { key: "genotype", label: "Genotype", value: "AS" }, { key: "unlock_hint", label: "Full record", value: "Full record needs your unlock" }] } as never;

  it("the Apple layout holds only the payload rows", () => {
    const l = buildApplePassLayout(payload, { teamId: "T", passTypeId: "pass.x", serial: "s1" });
    expect(JSON.stringify(l)).toContain("Full record needs your unlock");
    expect(l.generic.primaryFields).toHaveLength(1);
  });

  it("the Google layout holds only the payload rows", () => {
    const l = buildGoogleWalletLayout(payload, { issuerId: "I", objectSuffix: "o1" });
    expect(l.textModulesData).toHaveLength(4);
    expect(l.id).toBe("I.o1");
  });

  it("lists what a platform still needs", () => {
    expect(missingCredentials("google", {})).toEqual(["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT"]);
    expect(missingCredentials("google", CREDS)).toEqual([]);
  });
});
