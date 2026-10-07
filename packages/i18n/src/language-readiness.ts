/**
 * Language readiness (S86). DORMANT framework: the product is English only (decision D-14) and nothing in this file
 * adds, enables or widens a language. It is the process and the checks a language would have to pass before it could
 * ever be listed as enabled, proven in the tests with a test-only stub language that production config never names.
 *
 * Everything here is a pure function over data handed in: the registry (versioned PROPOSED config, key
 * `i18n.language_registry`), a catalogue per language, and the audio manifest. No file, network or model access, and no
 * Node built-in, so it is safe to import from the apps. It is deliberately NOT re-exported from `index.ts`: no screen
 * needs it today.
 *
 * Review standard (one mechanism, reused, never a third): a string set (the keys of one feature in one language) is
 * reviewed by a native speaker, then signed by the CMO. Each sign-off records `set_hash`, the SHA-256 of the English
 * source and the translated text it covered, exactly like the audio manifest drops a sign-off when a clip's script hash
 * changes. Edit one word and the sign-off no longer matches, so the feature can no longer be enabled until it is
 * reviewed and signed again. Clips use the manifest's own approvals, which already carry the recording's sha256.
 */

export type LanguageStatus = "draft" | "native_reviewed" | "clinician_signed";

/** Same shape as `Sign` in clinical-wording.ts, plus the fingerprint of what was signed. */
export interface StringSetSignoff {
  readonly by: string;
  readonly on: string;
  readonly version: number;
  readonly set_hash: string;
}

export interface FeatureDefinition {
  /** A key belongs to the feature with the longest matching prefix. The empty prefix is the catch-all. */
  readonly message_prefixes: readonly string[];
  /** Audio manifest groups (ONB, EMG, ...) whose clips belong to this feature. */
  readonly audio_groups: readonly string[];
  /** A clinical feature needs the CMO's signature; a non-clinical one needs the native review only. */
  readonly clinical: boolean;
}

export interface LanguageEntry {
  readonly status: LanguageStatus;
  /** The language the strings are written in. It needs no translation review and no recorded clip to be shown. */
  readonly source?: boolean;
  /** Feature keys this language is switched on for. Empty means dormant. */
  readonly enabled_for: readonly string[];
  readonly native_review: Readonly<Record<string, StringSetSignoff>>;
  readonly clinician_signoff: Readonly<Record<string, StringSetSignoff>>;
}

export interface LanguageRegistry {
  readonly source_language: string;
  readonly features: Readonly<Record<string, FeatureDefinition>>;
  readonly languages: Readonly<Record<string, LanguageEntry>>;
}

export type Catalogue = Readonly<Record<string, string>>;

export interface ManifestApproval {
  readonly review: string;
  readonly sha256?: string | null;
}
export interface ManifestFile {
  readonly sha256: string | null;
  readonly bytes?: number | null;
  /** For a non-source language: the source clip's `script_hash` when this clip was recorded. */
  readonly source_script_hash?: string | null;
  readonly approvals: readonly ManifestApproval[];
}
export interface ManifestClip {
  readonly id: string;
  readonly group: string;
  readonly clinical: boolean;
  readonly legal: boolean;
  /** A clip with one shared recording for every language (whole numbers): its file is under `shared`. */
  readonly language_neutral?: boolean;
  readonly script_hash: string;
  readonly files: Readonly<Record<string, ManifestFile | undefined>>;
}
export interface ManifestLike {
  readonly clips: readonly ManifestClip[];
}

// ---------------------------------------------------------------- hashing

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/**
 * SHA-256 of the UTF-8 text, as 64 hex characters. Pure so this file stays free of Node built-ins (it can be bundled by
 * the apps). The same function the audio manifest relies on for a recording: a sign-off is bound to the exact text.
 */
export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) bytes.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------- features and keys

/** The feature a message key belongs to (longest prefix wins). Undefined when no feature claims it. */
export function featureOfKey(key: string, features: LanguageRegistry["features"]): string | undefined {
  let best: { feature: string; length: number } | undefined;
  for (const [feature, def] of Object.entries(features)) {
    for (const prefix of def.message_prefixes) {
      if (key.startsWith(prefix) && (!best || prefix.length > best.length)) best = { feature, length: prefix.length };
    }
  }
  return best?.feature;
}

export function keysOfFeature(feature: string, sourceKeys: readonly string[], features: LanguageRegistry["features"]): string[] {
  return sourceKeys.filter((k) => featureOfKey(k, features) === feature).sort();
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

export interface KeyParity {
  readonly missing: readonly string[];
  readonly empty: readonly string[];
  readonly extra: readonly string[];
  readonly placeholder_mismatch: readonly string[];
}

/** Key parity against the source catalogue. A key present in English and missing, blank or re-shaped here is a failure. */
export function keyParity(source: Catalogue, other: Catalogue): KeyParity {
  const missing: string[] = [];
  const empty: string[] = [];
  const mismatch: string[] = [];
  for (const [key, text] of Object.entries(source)) {
    const value = other[key];
    if (value === undefined) missing.push(key);
    else if (value.trim() === "") empty.push(key);
    else if (placeholders(value) !== placeholders(text)) mismatch.push(key);
  }
  const extra = Object.keys(other).filter((k) => !(k in source));
  return { missing, empty, extra, placeholder_mismatch: mismatch };
}

/** Fingerprint of one feature's string set: the English source and the language's text for every key. */
export function stringSetHash(feature: string, source: Catalogue, other: Catalogue, features: LanguageRegistry["features"]): string {
  const rows = keysOfFeature(feature, Object.keys(source), features).map((k) => [k, source[k], other[k] ?? ""]);
  return sha256Hex(JSON.stringify(rows));
}

export function signoffMatches(signoff: StringSetSignoff | undefined, expectedHash: string): boolean {
  return signoff !== undefined && signoff.by.trim() !== "" && signoff.on.trim() !== "" && signoff.set_hash === expectedHash;
}

// ---------------------------------------------------------------- audio pairing

export interface PairingResult {
  readonly paired: boolean;
  readonly reason: "ok" | "no_file" | "not_recorded" | "script_changed" | "approval_missing" | "approval_hash_mismatch";
}

/**
 * Is this clip ready for this language? Same playable rule as `scripts/audio/ingest-recordings.mjs`: recorded, and every
 * review the clip needs signed against THIS recording's sha256. For a non-source language the recording must also
 * name the source script it was made from, so a changed source script unpairs it.
 */
export function clipPairing(clip: ManifestClip, language: string, sourceLanguage: string): PairingResult {
  const neutral = clip.language_neutral === true;
  const file = clip.files[neutral ? "shared" : language];
  if (!file) return { paired: false, reason: "no_file" };
  if (file.sha256 === null || file.sha256 === undefined) return { paired: false, reason: "not_recorded" };
  if (!neutral && language !== sourceLanguage && file.source_script_hash !== clip.script_hash) return { paired: false, reason: "script_changed" };
  const needed = ["brand", ...(clip.clinical ? ["clinical"] : []), ...(clip.legal ? ["legal"] : [])];
  for (const review of needed) {
    const mine = file.approvals.filter((a) => a.review === review);
    if (mine.length === 0) return { paired: false, reason: "approval_missing" };
    if (!mine.some((a) => a.sha256 === file.sha256)) return { paired: false, reason: "approval_hash_mismatch" };
  }
  return { paired: true, reason: "ok" };
}

export function clipsOfFeature(feature: string, manifest: ManifestLike, features: LanguageRegistry["features"]): ManifestClip[] {
  const groups = new Set(features[feature]?.audio_groups ?? []);
  return manifest.clips.filter((c) => groups.has(c.group));
}

/** The words a clip says in a language, falling back to the source language when there is none. */
export function audioScriptText(
  scripts: Readonly<Record<string, { readonly en: string; readonly other?: Readonly<Record<string, string>> }>>,
  clipId: string,
  language: string,
): string | undefined {
  const script = scripts[clipId];
  if (!script) return undefined;
  const own = language === "en" ? undefined : script.other?.[language];
  return own !== undefined && own.trim() !== "" ? own : script.en;
}

// ---------------------------------------------------------------- coverage report

export interface FeatureCoverage {
  readonly language: string;
  readonly feature: string;
  readonly keys_total: number;
  readonly keys_present: number;
  readonly keys_reviewed: number;
  readonly keys_signed: number;
  readonly audio_total: number;
  readonly audio_paired: number;
  readonly enabled: boolean;
}

export interface ReadinessInput {
  readonly registry: LanguageRegistry;
  readonly catalogues: Readonly<Record<string, Catalogue>>;
  readonly manifest: ManifestLike;
}

export function featureCoverage(input: ReadinessInput, language: string, feature: string): FeatureCoverage {
  const { registry, catalogues, manifest } = input;
  const source = catalogues[registry.source_language] ?? {};
  const own = catalogues[language] ?? {};
  const entry = registry.languages[language];
  const keys = keysOfFeature(feature, Object.keys(source), registry.features);
  const present = keys.filter((k) => (own[k] ?? "").trim() !== "");
  const hash = stringSetHash(feature, source, own, registry.features);
  const allPresent = present.length === keys.length;
  const isSource = language === registry.source_language;
  const reviewed = isSource || (allPresent && signoffMatches(entry?.native_review[feature], hash));
  const signed = isSource || (allPresent && signoffMatches(entry?.clinician_signoff[feature], hash));
  const clips = clipsOfFeature(feature, manifest, registry.features);
  const paired = clips.filter((c) => clipPairing(c, language, registry.source_language).paired);
  return {
    language,
    feature,
    keys_total: keys.length,
    keys_present: present.length,
    keys_reviewed: reviewed ? present.length : 0,
    keys_signed: signed ? present.length : 0,
    audio_total: clips.length,
    audio_paired: paired.length,
    enabled: entry?.enabled_for.includes(feature) ?? false,
  };
}

export function coverageReport(input: ReadinessInput): FeatureCoverage[] {
  const rows: FeatureCoverage[] = [];
  for (const language of Object.keys(input.registry.languages)) {
    for (const feature of Object.keys(input.registry.features)) rows.push(featureCoverage(input, language, feature));
  }
  return rows;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

/** A plain-text table for the CI log. */
export function formatCoverageReport(rows: readonly FeatureCoverage[]): string {
  const head = ["language", "feature", "keys present", "reviewed", "signed", "audio paired", "enabled"];
  const body = rows.map((r) => [
    r.language,
    r.feature,
    `${r.keys_present}/${r.keys_total} (${pct(r.keys_present, r.keys_total)})`,
    pct(r.keys_reviewed, r.keys_total),
    pct(r.keys_signed, r.keys_total),
    `${r.audio_paired}/${r.audio_total} (${pct(r.audio_paired, r.audio_total)})`,
    r.enabled ? "yes" : "no",
  ]);
  const all = [head, ...body];
  const widths = head.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

// ---------------------------------------------------------------- the gate

export type GateCode =
  | "unknown_feature"
  | "source_not_enabled_everywhere"
  | "status_too_low"
  | "key_missing"
  | "key_empty"
  | "placeholder_mismatch"
  | "native_review_missing_or_stale"
  | "clinician_signoff_missing_or_stale"
  | "audio_unpaired";

export interface GateViolation {
  readonly language: string;
  readonly feature: string;
  readonly code: GateCode;
  readonly detail: string;
}

const sample = (items: readonly string[]) => `${items.length} (${items.slice(0, 5).join(", ")}${items.length > 5 ? ", ..." : ""})`;

/**
 * The gate. A language may be listed as enabled for a feature only when every key is present, non-blank and shaped like
 * English, the string set is native-reviewed (and CMO-signed for a clinical feature) against its current text, and every
 * audio clip of the feature is recorded and signed against its recording. The source language is exempt from review and
 * audio (its missing clip falls back to text, spec 8.8) but must be enabled for every feature, which is what makes
 * fallback to English always possible. Returns every violation; an empty list means the registry may stand.
 */
export function checkLanguageGate(input: ReadinessInput): GateViolation[] {
  const { registry, catalogues, manifest } = input;
  const out: GateViolation[] = [];
  const source = catalogues[registry.source_language] ?? {};
  const featureKeys = Object.keys(registry.features);

  const sourceEntry = registry.languages[registry.source_language];
  for (const feature of featureKeys) {
    if (!sourceEntry || !sourceEntry.enabled_for.includes(feature)) {
      out.push({ language: registry.source_language, feature, code: "source_not_enabled_everywhere", detail: "the source language must stay enabled for every feature so fallback always exists" });
    }
  }

  for (const [language, entry] of Object.entries(registry.languages)) {
    if (language === registry.source_language) continue;
    const own = catalogues[language] ?? {};
    for (const feature of entry.enabled_for) {
      if (!registry.features[feature]) {
        out.push({ language, feature, code: "unknown_feature", detail: `"${feature}" is not a defined feature` });
        continue;
      }
      const def = registry.features[feature];
      const need: LanguageStatus = def.clinical ? "clinician_signed" : "native_reviewed";
      const rank: Record<LanguageStatus, number> = { draft: 0, native_reviewed: 1, clinician_signed: 2 };
      if (rank[entry.status] < rank[need]) {
        out.push({ language, feature, code: "status_too_low", detail: `status is ${entry.status}, a ${def.clinical ? "clinical" : "non-clinical"} feature needs ${need}` });
      }
      const keys = keysOfFeature(feature, Object.keys(source), registry.features);
      const scoped: Catalogue = Object.fromEntries(keys.map((k) => [k, source[k]]));
      const parity = keyParity(scoped, own);
      if (parity.missing.length) out.push({ language, feature, code: "key_missing", detail: sample(parity.missing) });
      if (parity.empty.length) out.push({ language, feature, code: "key_empty", detail: sample(parity.empty) });
      if (parity.placeholder_mismatch.length) out.push({ language, feature, code: "placeholder_mismatch", detail: sample(parity.placeholder_mismatch) });

      const hash = stringSetHash(feature, source, own, registry.features);
      if (!signoffMatches(entry.native_review[feature], hash)) {
        out.push({ language, feature, code: "native_review_missing_or_stale", detail: "no native review of the current text" });
      }
      if (def.clinical && !signoffMatches(entry.clinician_signoff[feature], hash)) {
        out.push({ language, feature, code: "clinician_signoff_missing_or_stale", detail: "no CMO signature of the current text" });
      }

      const bad = clipsOfFeature(feature, manifest, registry.features)
        .map((c) => ({ id: c.id, result: clipPairing(c, language, registry.source_language) }))
        .filter((c) => !c.result.paired)
        .map((c) => `${c.id}:${c.result.reason}`);
      if (bad.length) out.push({ language, feature, code: "audio_unpaired", detail: sample(bad) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- picker and fallback

/**
 * Languages the first-screen picker may list: those enabled for EVERY feature, so choosing one never produces a mixed
 * screen. Source language first, then the rest in registry order.
 */
export function pickerLanguages(registry: LanguageRegistry): string[] {
  const features = Object.keys(registry.features);
  return Object.entries(registry.languages)
    .filter(([, e]) => features.every((f) => e.enabled_for.includes(f)))
    .map(([code]) => code)
    .sort((a, b) => Number(b === registry.source_language) - Number(a === registry.source_language));
}

/** With one enabled language there is nothing to choose, so the picker renders nothing. */
export function shouldShowLanguagePicker(registry: LanguageRegistry): boolean {
  return pickerLanguages(registry).length > 1;
}

export interface ResolvedMessage {
  readonly text: string;
  readonly language: string;
  readonly fell_back: boolean;
}

/** A string in `language` only when that language is enabled for the key's feature and the key is present; else English. */
export function resolveMessage(input: Pick<ReadinessInput, "registry" | "catalogues">, key: string, language: string): ResolvedMessage {
  const { registry, catalogues } = input;
  const sourceText = catalogues[registry.source_language]?.[key] ?? key;
  const feature = featureOfKey(key, registry.features);
  const own = catalogues[language]?.[key];
  const usable =
    language !== registry.source_language &&
    feature !== undefined &&
    registry.languages[language]?.enabled_for.includes(feature) === true &&
    own !== undefined &&
    own.trim() !== "";
  return usable ? { text: own, language, fell_back: false } : { text: sourceText, language: registry.source_language, fell_back: language !== registry.source_language };
}

// ---------------------------------------------------------------- config parsing

const STATUSES: readonly string[] = ["draft", "native_reviewed", "clinician_signed"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate the PROPOSED-config value into a typed registry. Throws on any malformed part so a typo never means "enabled". */
export function parseLanguageRegistry(value: unknown): LanguageRegistry {
  if (!isRecord(value) || typeof value.source_language !== "string" || !isRecord(value.features) || !isRecord(value.languages)) {
    throw new Error("language registry: source_language, features and languages are required");
  }
  const features: Record<string, FeatureDefinition> = {};
  for (const [key, raw] of Object.entries(value.features)) {
    if (!isRecord(raw) || !Array.isArray(raw.message_prefixes) || !Array.isArray(raw.audio_groups) || typeof raw.clinical !== "boolean") {
      throw new Error(`language registry: feature "${key}" is malformed`);
    }
    features[key] = { message_prefixes: raw.message_prefixes.map(String), audio_groups: raw.audio_groups.map(String), clinical: raw.clinical };
  }
  const signoffs = (raw: unknown, where: string): Record<string, StringSetSignoff> => {
    if (raw === undefined) return {};
    if (!isRecord(raw)) throw new Error(`language registry: ${where} must be an object`);
    return Object.fromEntries(
      Object.entries(raw).map(([feature, s]) => {
        if (!isRecord(s) || typeof s.by !== "string" || typeof s.on !== "string" || typeof s.version !== "number" || typeof s.set_hash !== "string") {
          throw new Error(`language registry: ${where}.${feature} is malformed`);
        }
        return [feature, { by: s.by, on: s.on, version: s.version, set_hash: s.set_hash }];
      }),
    );
  };
  const languages: Record<string, LanguageEntry> = {};
  for (const [code, raw] of Object.entries(value.languages)) {
    if (!isRecord(raw) || typeof raw.status !== "string" || !STATUSES.includes(raw.status) || !Array.isArray(raw.enabled_for)) {
      throw new Error(`language registry: language "${code}" is malformed`);
    }
    languages[code] = {
      status: raw.status as LanguageStatus,
      source: raw.source === true,
      enabled_for: raw.enabled_for.map(String),
      native_review: signoffs(raw.native_review, `${code}.native_review`),
      clinician_signoff: signoffs(raw.clinician_signoff, `${code}.clinician_signoff`),
    };
  }
  const source = languages[value.source_language];
  if (!source) throw new Error("language registry: the source language must have an entry");
  for (const [code, entry] of Object.entries(languages)) {
    if (entry.source === true && code !== value.source_language) throw new Error(`language registry: "${code}" is marked source but the source language is "${value.source_language}"`);
  }
  if (source.source !== true) throw new Error("language registry: the source language entry must set source: true");
  return { source_language: value.source_language, features, languages };
}
