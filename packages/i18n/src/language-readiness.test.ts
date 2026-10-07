import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { PROPOSED_CONFIG } from "../../shared/src/proposed-config/registry";
import { AUDIO_SCRIPTS } from "./audio-scripts";
import { catalogues as productionCatalogues, LOCALES } from "./translate";
import {
  audioScriptText,
  checkLanguageGate,
  clipPairing,
  coverageReport,
  featureOfKey,
  formatCoverageReport,
  keyParity,
  parseLanguageRegistry,
  pickerLanguages,
  resolveMessage,
  sha256Hex,
  shouldShowLanguagePicker,
  stringSetHash,
  type Catalogue,
  type LanguageRegistry,
  type ManifestClip,
  type ManifestLike,
  type ReadinessInput,
} from "./language-readiness";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "../../../audio/manifest.json"), "utf8")) as ManifestLike & { languages: string[] };

function productionRegistry(): LanguageRegistry {
  const entries = PROPOSED_CONFIG.filter((e) => e.key === "i18n.language_registry");
  const latest = entries.sort((a, b) => b.version - a.version)[0];
  return parseLanguageRegistry(latest.value);
}

// ---------------------------------------------------------------------------------------------------------------
// Production: dormant. Nothing but English exists anywhere.
// ---------------------------------------------------------------------------------------------------------------
describe("production language registry (dormant, D-14)", () => {
  const registry = productionRegistry();
  const input: ReadinessInput = { registry, catalogues: productionCatalogues, manifest };

  it("lists English and nothing else, enabled for every feature", () => {
    expect(Object.keys(registry.languages)).toEqual(["en"]);
    expect([...registry.languages.en.enabled_for].sort()).toEqual(Object.keys(registry.features).sort());
  });

  it("matches the languages the app, the catalogues and the audio manifest actually have", () => {
    expect([...LOCALES]).toEqual(Object.keys(registry.languages));
    expect(Object.keys(productionCatalogues)).toEqual(Object.keys(registry.languages));
    expect(manifest.languages).toEqual(Object.keys(registry.languages));
  });

  it("passes its own gate", () => {
    expect(checkLanguageGate(input)).toEqual([]);
  });

  it("claims every English key exactly once and every audio group exactly once", () => {
    for (const key of Object.keys(productionCatalogues.en)) expect([key, featureOfKey(key, registry.features) !== undefined]).toEqual([key, true]);
    const groups = new Set(manifest.clips.map((c) => c.group));
    for (const group of groups) {
      const owners = Object.entries(registry.features).filter(([, f]) => f.audio_groups.includes(group));
      expect([group, owners.length]).toEqual([group, 1]);
    }
    for (const f of Object.values(registry.features)) for (const g of f.audio_groups) expect(groups.has(g)).toBe(true);
  });

  it("sends any key no feature names (for example one added later) to a CLINICAL feature, never a plain one", () => {
    for (const [name, def] of Object.entries(registry.features)) {
      if (def.message_prefixes.includes("")) expect([name, def.clinical]).toEqual([name, true]);
    }
    for (const key of ["meds.anything", "vitals.anything", "titration.anything", "scribe.anything", "brand_new_area.thing"]) {
      const feature = featureOfKey(key, registry.features);
      expect([key, feature && registry.features[feature].clinical]).toEqual([key, true]);
    }
    expect(featureOfKey("app.name", registry.features)).toBe("general_ui");
  });

  it("does not show a language picker with one language", () => {
    expect(pickerLanguages(registry)).toEqual(["en"]);
    expect(shouldShowLanguagePicker(registry)).toBe(false);
  });

  it("reports English as fully present and the report prints", () => {
    const rows = coverageReport(input);
    expect(rows.length).toBe(Object.keys(registry.features).length);
    for (const r of rows) {
      expect(r.keys_present).toBe(r.keys_total);
      expect(r.keys_signed).toBe(r.keys_total);
    }
    const text = formatCoverageReport(rows);
    expect(text).toContain("general_ui");
    if (process.env.LANGUAGE_REPORT === "1") console.log(`\n${text}\n`);
  });

  it("still holds the manifest to English files (plus the shared number clips)", () => {
    for (const clip of manifest.clips) expect(Object.keys(clip.files).filter((k) => k !== "shared")).toEqual(clip.language_neutral ? [] : ["en"]);
  });

  it("falls back to the wording of the script for an unknown language", () => {
    const first = Object.keys(AUDIO_SCRIPTS)[0];
    expect(audioScriptText(AUDIO_SCRIPTS, first, "xx")).toBe(AUDIO_SCRIPTS[first].en);
    expect(audioScriptText(AUDIO_SCRIPTS, "NO-SUCH", "en")).toBeUndefined();
    expect(audioScriptText({ A: { en: "Hello", other: { xx: "xx Hello", yy: " " } } }, "A", "xx")).toBe("xx Hello");
    expect(audioScriptText({ A: { en: "Hello", other: { yy: " " } } }, "A", "yy")).toBe("Hello");
  });

  it("rejects a malformed registry instead of treating it as enabled", () => {
    expect(() => parseLanguageRegistry({})).toThrow();
    expect(() => parseLanguageRegistry({ source_language: "en", features: {}, languages: { xx: { status: "approved", enabled_for: [] } } })).toThrow(/malformed/);
    const en = { status: "draft", source: true, enabled_for: [] };
    expect(() => parseLanguageRegistry({ source_language: "en", features: {}, languages: { xx: { status: "draft", enabled_for: [] } } })).toThrow(/source language must have an entry/);
    expect(() => parseLanguageRegistry({ source_language: "en", features: {}, languages: { en, xx: { ...en } } })).toThrow(/marked source/);
    expect(() => parseLanguageRegistry({ source_language: "en", features: {}, languages: { en: { ...en, source: false } } })).toThrow(/must set source/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Dry run with a TEST-ONLY stub language. "xx" exists only in this file; no production config names it.
// ---------------------------------------------------------------------------------------------------------------
const SOURCE: Catalogue = {
  "triage.red.title": "Get help now",
  "triage.red.body": "Your reading means you need care now. Tell your care team {name}.",
  "app.welcome": "Welcome",
  "app.next": "Next",
};
const XX_TEXT: Catalogue = {
  "triage.red.title": "xx Get help now",
  "triage.red.body": "xx Your reading means you need care now. Tell your care team {name}.",
  "app.welcome": "xx Welcome",
  "app.next": "xx Next",
};
const FEATURES = {
  safety: { message_prefixes: ["triage."], audio_groups: ["EMG"], clinical: true },
  ui: { message_prefixes: [""], audio_groups: ["ONB"], clinical: false },
} as const;

const clip = (id: string, group: string, over: Partial<ManifestClip> = {}): ManifestClip => ({
  id,
  group,
  clinical: group === "EMG",
  legal: false,
  script_hash: `h-${id}`,
  files: { en: { sha256: null, approvals: [] } },
  ...over,
});

/** A stub language that satisfies the whole gate. Each test breaks exactly one thing. */
function readyStub(): { input: ReadinessInput; text: Catalogue; manifestClips: ManifestClip[] } {
  const text = { ...XX_TEXT };
  const sha = "a".repeat(64);
  const approvals = (reviews: string[]) => reviews.map((review) => ({ review, by: "test", sha256: sha }));
  const manifestClips = [
    clip("EMG-001", "EMG", { files: { en: { sha256: null, approvals: [] }, xx: { sha256: sha, bytes: 10, source_script_hash: "h-EMG-001", approvals: approvals(["brand", "clinical"]) } } }),
    clip("ONB-001", "ONB", { files: { en: { sha256: null, approvals: [] }, xx: { sha256: sha, bytes: 10, source_script_hash: "h-ONB-001", approvals: approvals(["brand"]) } } }),
  ];
  const sign = (feature: "safety" | "ui") => ({ by: "test CMO", on: "2026-01-01", version: 1, set_hash: stringSetHash(feature, SOURCE, text, FEATURES) });
  const registry: LanguageRegistry = {
    source_language: "en",
    features: FEATURES,
    languages: {
      en: { status: "draft", source: true, enabled_for: ["safety", "ui"], native_review: {}, clinician_signoff: {} },
      xx: { status: "clinician_signed", enabled_for: ["safety", "ui"], native_review: { safety: sign("safety"), ui: sign("ui") }, clinician_signoff: { safety: sign("safety") } },
    },
  };
  return { input: { registry, catalogues: { en: SOURCE, xx: text }, manifest: { clips: manifestClips } }, text, manifestClips };
}

const withInput = (base: ReadinessInput, over: Partial<ReadinessInput>): ReadinessInput => ({ ...base, ...over });
const codes = (input: ReadinessInput) => checkLanguageGate(input).map((v) => `${v.feature}:${v.code}`);

describe("language gate: dry run with a stub language", () => {
  it("passes when every key, signature and clip is complete (the control)", () => {
    expect(checkLanguageGate(readyStub().input)).toEqual([]);
  });

  it("fails key parity for a missing key", () => {
    const { input, text } = readyStub();
    const { "triage.red.title": _gone, ...rest } = text;
    expect(keyParity(SOURCE, rest).missing).toEqual(["triage.red.title"]);
    const result = codes(withInput(input, { catalogues: { en: SOURCE, xx: rest } }));
    expect(result).toContain("safety:key_missing");
    // The removed key also makes the signed text stale: it can never be enabled by leaving a hole.
    expect(result).toContain("safety:native_review_missing_or_stale");
  });

  it("fails a blank string and a string that lost its placeholder", () => {
    const { input, text } = readyStub();
    const result = codes(withInput(input, { catalogues: { en: SOURCE, xx: { ...text, "app.next": "  ", "triage.red.body": "xx no placeholder" } } }));
    expect(result).toContain("ui:key_empty");
    expect(result).toContain("safety:placeholder_mismatch");
  });

  it("cannot enable an unsigned string set", () => {
    const { input } = readyStub();
    const registry = input.registry;
    const xx = registry.languages.xx;
    const unsignedClinical: LanguageRegistry = { ...registry, languages: { ...registry.languages, xx: { ...xx, clinician_signoff: {} } } };
    expect(codes(withInput(input, { registry: unsignedClinical }))).toEqual(["safety:clinician_signoff_missing_or_stale"]);
    const unreviewed: LanguageRegistry = { ...registry, languages: { ...registry.languages, xx: { ...xx, native_review: {} } } };
    expect(codes(withInput(input, { registry: unreviewed })).sort()).toEqual(["safety:native_review_missing_or_stale", "ui:native_review_missing_or_stale"]);
  });

  it("holds a clinical feature to clinician_signed status and a plain one to native_reviewed", () => {
    const { input } = readyStub();
    const xx = input.registry.languages.xx;
    const asNative: LanguageRegistry = { ...input.registry, languages: { ...input.registry.languages, xx: { ...xx, status: "native_reviewed" } } };
    expect(codes(withInput(input, { registry: asNative }))).toEqual(["safety:status_too_low"]);
    const asDraft: LanguageRegistry = { ...input.registry, languages: { ...input.registry.languages, xx: { ...xx, status: "draft" } } };
    expect(codes(withInput(input, { registry: asDraft })).sort()).toEqual(["safety:status_too_low", "ui:status_too_low"]);
  });

  it("SABOTAGE: editing one signed word makes the signature stale, restoring it passes again", () => {
    const { input, text } = readyStub();
    expect(checkLanguageGate(input)).toEqual([]);
    const edited = { ...text, "app.welcome": "xx Welcome!" };
    expect(codes(withInput(input, { catalogues: { en: SOURCE, xx: edited } }))).toEqual(["ui:native_review_missing_or_stale"]);
    // A changed English source also invalidates a signature taken against the old English.
    expect(codes(withInput(input, { catalogues: { en: { ...SOURCE, "app.welcome": "Hello" }, xx: text } }))).toEqual(["ui:native_review_missing_or_stale"]);
    expect(checkLanguageGate(withInput(input, { catalogues: { en: SOURCE, xx: { ...text } } }))).toEqual([]);
  });

  it("fails pairing on an audio hash mismatch (approval signed a different recording)", () => {
    const { input, manifestClips } = readyStub();
    const [emg, onb] = manifestClips;
    const rerecorded: ManifestClip = { ...emg, files: { ...emg.files, xx: { ...emg.files.xx!, sha256: "b".repeat(64) } } };
    expect(clipPairing(rerecorded, "xx", "en")).toEqual({ paired: false, reason: "approval_hash_mismatch" });
    const result = checkLanguageGate(withInput(input, { manifest: { clips: [rerecorded, onb] } }));
    expect(result.map((v) => `${v.feature}:${v.code}`)).toEqual(["safety:audio_unpaired"]);
    expect(result[0].detail).toContain("EMG-001:approval_hash_mismatch");
  });

  it("fails pairing for a missing file, an unrecorded clip, a missing review and a changed source script", () => {
    const { manifestClips } = readyStub();
    const [emg] = manifestClips;
    expect(clipPairing({ ...emg, files: { en: emg.files.en } }, "xx", "en").reason).toBe("no_file");
    expect(clipPairing({ ...emg, files: { xx: { sha256: null, approvals: [] } } }, "xx", "en").reason).toBe("not_recorded");
    expect(clipPairing({ ...emg, files: { xx: { ...emg.files.xx!, approvals: [{ review: "brand", sha256: emg.files.xx!.sha256 }] } } }, "xx", "en").reason).toBe("approval_missing");
    expect(clipPairing({ ...emg, script_hash: "changed" }, "xx", "en").reason).toBe("script_changed");
  });

  it("requires a clinical clip to carry the clinical approval and a legal clip the legal one", () => {
    const { manifestClips } = readyStub();
    const [, onb] = manifestClips;
    expect(clipPairing({ ...onb, legal: true }, "xx", "en").reason).toBe("approval_missing");
  });

  it("flags an unknown feature and a source language that is not enabled everywhere", () => {
    const { input } = readyStub();
    const xx = input.registry.languages.xx;
    const en = input.registry.languages.en;
    const bad: LanguageRegistry = { ...input.registry, languages: { en: { ...en, enabled_for: ["ui"] }, xx: { ...xx, enabled_for: ["ghost"] } } };
    expect(codes(withInput(input, { registry: bad })).sort()).toEqual(["ghost:unknown_feature", "safety:source_not_enabled_everywhere"]);
  });

  it("reports coverage and audio pairing per language and feature", () => {
    const { input } = readyStub();
    const rows = coverageReport(input).filter((r) => r.language === "xx");
    expect(rows.map((r) => [r.feature, r.keys_present, r.keys_total, r.keys_reviewed, r.keys_signed, r.audio_paired, r.audio_total])).toEqual([
      ["safety", 2, 2, 2, 2, 1, 1],
      ["ui", 2, 2, 2, 0, 1, 1],
    ]);
    expect(formatCoverageReport(rows)).toContain("2/2 (100%)");
  });

  it("falls back to English when a language is not enabled for the feature or the key is missing", () => {
    const { input, text } = readyStub();
    expect(resolveMessage(input, "app.welcome", "xx")).toEqual({ text: "xx Welcome", language: "xx", fell_back: false });
    expect(resolveMessage(input, "app.welcome", "en")).toEqual({ text: "Welcome", language: "en", fell_back: false });
    const dormant: LanguageRegistry = { ...input.registry, languages: { ...input.registry.languages, xx: { ...input.registry.languages.xx, enabled_for: ["ui"] } } };
    expect(resolveMessage({ registry: dormant, catalogues: input.catalogues }, "triage.red.title", "xx")).toEqual({ text: "Get help now", language: "en", fell_back: true });
    const { "app.next": _x, ...partial } = text;
    expect(resolveMessage({ registry: input.registry, catalogues: { en: SOURCE, xx: partial } }, "app.next", "xx")).toEqual({ text: "Next", language: "en", fell_back: true });
    expect(resolveMessage(input, "app.welcome", "zz").fell_back).toBe(true);
  });

  it("hides the stub from the picker unless it is enabled for every feature, and shows the picker only with two", () => {
    const { input } = readyStub();
    expect(pickerLanguages(input.registry)).toEqual(["en", "xx"]);
    expect(shouldShowLanguagePicker(input.registry)).toBe(true);
    const partial: LanguageRegistry = { ...input.registry, languages: { ...input.registry.languages, xx: { ...input.registry.languages.xx, enabled_for: ["ui"] } } };
    expect(pickerLanguages(partial)).toEqual(["en"]);
    expect(shouldShowLanguagePicker(partial)).toBe(false);
    const dormant: LanguageRegistry = { ...input.registry, languages: { ...input.registry.languages, xx: { ...input.registry.languages.xx, enabled_for: [] } } };
    expect(shouldShowLanguagePicker(dormant)).toBe(false);
  });

  it("never lets the stub into production config", () => {
    expect(JSON.stringify(PROPOSED_CONFIG)).not.toMatch(/"xx"/);
    expect([...LOCALES]).not.toContain("xx");
  });

  it("hashes with real SHA-256 (published test vectors, including multi byte text)", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });
});
