/**
 * S88a: the PHI scrubber for the JS crash reporter. Pure, no native imports.
 *
 * Policy: the reporter sends an allowlist of fields (see crash-report.ts) and every free-text field passes through here
 * first. A crash message is written by a developer but can still carry a patient's words, because an error is often built
 * from the value that failed to parse ("invalid reading 142/91 for Ada Obi"). So the scrubber is deliberately blunt: it
 * would rather blank something harmless than let a value through.
 *
 * Removed from messages: quoted string contents, emails, phone numbers (E.164 and Nigerian local), JWTs and bearer tokens,
 * UUIDs, key=value pairs whose key names a sensitive field, honorific-plus-name, vitals-shaped numbers and units, and every
 * remaining run of two or more digits (HTTP statuses are kept). Stack frames keep only function name, file base name and
 * line:column.
 */

const MAX_MESSAGE = 200;
const MAX_FRAMES = 20;
const MAX_FRAME_LEN = 160;

const SENSITIVE_KEYS =
  "password|passcode|pin|token|access_token|refresh_token|authorization|auth|apikey|api_key|secret|cookie|session|name|first_?name|last_?name|full_?name|phone|mobile|email|address|dob|birth|nin|bvn|note|notes|message|text|body|comment|reading|systolic|diastolic|bp|glucose|pulse|weight|height|spo2|temperature|dose|medication|drug|diagnosis|symptom|result|value|patient|member|user";

const RULES: [RegExp, string][] = [
  // Tokens first, so a bearer token is never half-eaten by a later rule.
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, "[token]"],
  [/\b(?:bearer|basic)\s+[\w.~+/=-]{8,}/gi, "[token]"],
  [/\b(?:sk|pk|rk|sbp|sb_secret|sb_publishable)_[\w-]{8,}/gi, "[token]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[token]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  // Phones: +234..., 234..., 0803..., and any spaced/dashed run of 9+ digits.
  [/\+?\d[\d\s().-]{7,}\d/g, "[phone]"],
  // key=value / key: value / "key":"value" for sensitive keys. Value runs to a delimiter.
  [new RegExp(`(["']?\\b(?:${SENSITIVE_KEYS})["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&}\\])]+)`, "gi"), "$1[redacted]"],
  // Honorific plus name, then a capitalised name after a linking word ("for Ada Obi", "patient Chinedu Okafor").
  [/\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Dd]r|[Pp]rof|[Cc]hief|[Aa]lhaji|[Aa]lhaja|[Pp]astor|[Mm]allam)\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?/g, "[name]"],
  [/\b((?:for|patient|member|user|by|to|from|with|named?|called|of)\s+)[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?/g, "$1[name]"],
  // Two or more capitalised words mid-sentence read as a person's name. A single bare name cannot be told from an
  // identifier, so the rule stays blunt on pairs and the quote/digit/key rules carry the rest.
  [/([a-z,:;]\s+)[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+/g, "$1[name]"],
  // Vitals-shaped: 120/80, 7.2 mmol/L, 140 mg/dL, 72 bpm, 98%, 68 kg.
  [/\b\d{2,3}\s*\/\s*\d{2,3}\b/g, "[vital]"],
  [/\b\d+(?:\.\d+)?\s*(?:mmol\/l|mg\/dl|mmhg|bpm|kg|lbs?|cm|spo2|%|°c|c\b|f\b|units?|iu|mg|ml|mcg)/gi, "[vital]"],
];

/** Placeholders keep an HTTP status readable through the digit sweep. */
const STATUS_RE = /\b(HTTP|status|code)\s*[:=]?\s*([1-5]\d{2})\b/gi;

/** Blanks everything inside quotes: user text most often arrives as a quoted value. */
function blankQuoted(s: string): string {
  return s.replace(/"[^"]*"/g, '"[str]"').replace(/'[^']*'/g, "'[str]'").replace(/`[^`]*`/g, "`[str]`");
}

export function scrubMessage(input: unknown): string {
  try {
    let s = typeof input === "string" ? input : input instanceof Error ? input.message : "non-string error";
    s = s.slice(0, 2000).replace(/\s+/g, " ").trim();
    s = blankQuoted(s);
    const statuses: string[] = [];
    s = s.replace(STATUS_RE, (_m, label: string, code: string) => {
      statuses.push(`${label} ${code}`);
      return `\u0000${statuses.length - 1}\u0000`;
    });
    for (const [re, sub] of RULES) s = s.replace(re, sub);
    // Anything that is still a number of two or more digits could be a reading, an age, a weight or an id.
    s = s.replace(/\d{2,}/g, "#");
    s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => statuses[Number(i)] ?? "");
    return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}...` : s;
  } catch {
    return "[unscrubbable message]";
  }
}

/** Error type names are code identifiers; anything unusual is replaced rather than trusted. */
export function scrubErrorType(input: unknown): string {
  const t = typeof input === "string" ? input : "Error";
  return /^[A-Za-z_$][\w$]{0,60}$/.test(t) ? t : "Error";
}

export interface ScrubbedFrame {
  function: string;
  filename: string;
  lineno?: number;
  colno?: number;
}

/**
 * Parses V8/Hermes style lines ("at fn (path/index.android.bundle:1:2345)", "fn@path:1:2") into function, file base name
 * and position. Anything that does not parse is dropped, not forwarded: a frame line is code, but we only trust what we parsed.
 */
export function scrubStack(stack: unknown): ScrubbedFrame[] {
  try {
    if (typeof stack !== "string") return [];
    const frames: ScrubbedFrame[] = [];
    for (const raw of stack.split("\n").slice(0, 60)) {
      const line = raw.trim().slice(0, 400);
      const m =
        /^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line) ?? /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
      if (!m) continue;
      const fn = (m[1] ?? "?").replace(/[^\w$.<> ]/g, "").slice(0, 80) || "?";
      const base = (m[2].split(/[\\/]/).pop() ?? "").split("?")[0].replace(/[^\w.$-]/g, "").slice(0, 80) || "?";
      frames.push({ function: fn, filename: base.slice(0, MAX_FRAME_LEN), lineno: Number(m[3]), colno: Number(m[4]) });
      if (frames.length >= MAX_FRAMES) break;
    }
    return frames;
  } catch {
    return [];
  }
}
