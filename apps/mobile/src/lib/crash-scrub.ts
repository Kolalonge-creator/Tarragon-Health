/**
 * S88a: the PHI scrubber for the JS crash reporter. Pure, no native imports.
 *
 * Policy (allowlist first): a crash message is written by a developer but can still carry a patient's words, because an
 * error is often built from the value that failed to parse ("invalid reading 142/91 for Ada Obi"). Pattern scrubbing
 * cannot catch everything (a lowercase "adaobi", a bare first name), so `scrubMessage` does NOT forward free text:
 *   1. a message is kept only when it matches a KNOWN system error pattern (Network request failed, undefined is not a
 *      function, Cannot read property of undefined, ...). What is sent is the pattern's own canonical text plus an HTTP
 *      status, never the original wording, so an identifier inside the message ("adaobi is not a function") is dropped;
 *   2. anything else is withheld: the reporter sends the error class (the event `type`) and a short hash of the
 *      pattern-scrubbed message, so the same bug groups together without a word of its text leaving the device.
 * `scrubFreeText` is the strengthened pattern scrubber. It is applied to the canonical text as defence in depth and to the
 * message before hashing, and is exported and tested on its own.
 *
 * Stack frames keep only function name, file base name and line:column.
 */

const MAX_MESSAGE = 200;
const MAX_FRAMES = 20;
const MAX_FRAME_LEN = 160;

const SENSITIVE_KEYS =
  "password|passcode|pin|token|access_token|refresh_token|authorization|auth|apikey|api_key|secret|cookie|session|name|first_?name|last_?name|full_?name|phone|mobile|email|address|dob|birth|nin|bvn|note|notes|message|text|body|comment|reading|systolic|diastolic|bp|glucose|pulse|weight|height|spo2|temperature|dose|medication|drug|diagnosis|symptom|result|value|patient|member|user";

/** Words after which a bare number is a clinical value or an age ("weight was 82.5", "glucose 7.2", "age 7"). */
const HEALTH_WORDS =
  "weight|height|bmi|glucose|sugar|bp|pressure|systolic|diastolic|pulse|heart\\s*rate|hr|spo2|oxygen|temp|temperature|age|aged|reading|readings|value|dose|dosage|mmol|mg|kg|lbs?|cm|units?|years?|yrs?|months?|result|score|a1c|hba1c|cholesterol|creatinine|egfr";

const RULES: [RegExp, string][] = [
  // Tokens first, so a bearer token is never half-eaten by a later rule.
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, "[token]"],
  [/\b(?:bearer|basic)\s+[\w.~+/=-]{8,}/gi, "[token]"],
  [/\b(?:sk|pk|rk|sbp|sb_secret|sb_publishable)_[\w-]{8,}/gi, "[token]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[token]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  // PostgREST filters and query-string pairs: eq.123, in.(1,2), ?select=*&patient_id=eq.x
  [/\b(?:eq|neq|gt|gte|lt|lte|like|ilike|is|cs|cd|fts|not\.eq|not\.in|in)\.(?:\([^)]*\)|[^\s&,)]+)/gi, "[filter]"],
  [/[?&][\w.[\]%-]+=[^\s&]*/g, ""],
  // A bare request or file path ("/rest/v1/patients/123"): path segments can carry ids.
  [/(^|\s)\/[\w.~%@-]+(?:\/[\w.~%@-]*)+/g, "$1[path]"],
  // Phones: +234..., 234..., 0803..., and any spaced/dashed run of 9+ digits.
  [/\+?\d[\d\s().-]{7,}\d/g, "[phone]"],
  // key=value / key: value / "key":"value" for sensitive keys. Value runs to a delimiter.
  [new RegExp(`(["']?\\b(?:${SENSITIVE_KEYS})["']?\\s*[:=]\\s*)(?:\\[\\w+\\]|"[^"]*"|'[^']*'|[^\\s,;&}\\])]+)`, "gi"), "$1[redacted]"],
  // Any other key=value pair.
  [/\b([A-Za-z_][\w.-]*)=(?:\[\w+\]|"[^"]*"|'[^']*'|[^\s&,;)\]}]+)/g, "$1=[redacted]"],
  // A number after a health word, decimals included: "weight was 82.5", "glucose 7.2", "age 7".
  [new RegExp(`\\b(${HEALTH_WORDS})\\b(?:\\s+(?:was|is|of|at|reads?|reading|=|:))*\\s*[:=]?\\s*\\d+(?:\\.\\d+)?`, "gi"), "$1 [vital]"],
  // Vitals-shaped: 120/80, 7.2 mmol/L, 140 mg/dL, 72 bpm, 98%, 68 kg, 7 years.
  [/\b\d{2,3}\s*\/\s*\d{2,3}\b/g, "[vital]"],
  [/\b\d+(?:\.\d+)?\s*(?:mmol\/l|mg\/dl|mmhg|bpm|kg|lbs?|cm|spo2|%|\u00b0c|c\b|f\b|units?|iu|mg|ml|mcg|years?|yrs?|y\/o|months?)/gi, "[vital]"],
  // Honorific plus name, then a capitalised name after a linking word ("for Ada Obi", "patient Chinedu Okafor").
  [/\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Dd]r|[Pp]rof|[Cc]hief|[Aa]lhaji|[Aa]lhaja|[Pp]astor|[Mm]allam)\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?/g, "[name]"],
  [/\b((?:for|patient|member|user|by|to|from|with|named?|called|of)\s+)[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?/g, "$1[name]"],
  // Any two capitalised words in a row read as a person's name ("Ada Obi has no profile", "Ada Obi's reading failed").
  // An identifier such as TypeError or readVitals is one token, so it is untouched.
  [/\b[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+/g, "[name]"],
];

/** Placeholders keep an HTTP status readable through the digit sweep. */
const STATUS_RE = /\b(HTTP|status|code)\s*[:=]?\s*([1-5]\d{2})\b/gi;

/** Blanks everything inside quotes: user text most often arrives as a quoted value. */
function blankQuoted(s: string): string {
  return s.replace(/"[^"]*"/g, '"[str]"').replace(/'[^']*'/g, "'[str]'").replace(/`[^`]*`/g, "`[str]`");
}

/** Every URL is reduced to scheme and host: no userinfo, port-less path, query or fragment survives. */
export function stripUrls(s: string): string {
  return s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#"'<>]*)[^\s"'<>]*/gi, (_m, scheme: string, authority: string) => {
    const host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
    return `${scheme}${host}`;
  });
}

/** Small non-cryptographic hash (FNV-1a, 32 bit) so a withheld message still groups. Not reversible in practice. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The strengthened pattern scrubber. Never the only line of defence (see the policy above). */
export function scrubFreeText(input: string): string {
  try {
    let s = input.slice(0, 2000).replace(/\s+/g, " ").trim();
    s = stripUrls(s);
    s = blankQuoted(s);
    const statuses: string[] = [];
    s = s.replace(STATUS_RE, (_m, label: string, code: string) => {
      statuses.push(`${label} ${code}`);
      return `\u0000${statuses.length - 1}\u0000`;
    });
    for (const [re, sub] of RULES) s = s.replace(re, sub);
    // Decimals and any run of two or more digits that is still left could be a reading, an age, a weight or an id.
    s = s.replace(/\d+\.\d+/g, "#").replace(/\d{2,}/g, "#");
    s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => statuses[Number(i)] ?? "");
    return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}...` : s;
  } catch {
    return "[unscrubbable message]";
  }
}

/**
 * Known system error shapes. The canonical text on the right is what is sent, never the original wording. `$1` style
 * captures are limited to the words undefined/null/function.
 */
const SYSTEM_PATTERNS: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
  [/^network request failed/i, "Network request failed"],
  [/^network request timed out/i, "Network request timed out"],
  [/^failed to fetch/i, "Failed to fetch"],
  [/^(?:the operation was aborted|aborted$|request aborted)/i, "Request aborted"],
  [/^request failed with status code \d{3}/i, "Request failed with status code"],
  [/^undefined is not an object/i, "undefined is not an object"],
  [/^undefined is not a function/i, "undefined is not a function"],
  [/^null is not an object/i, "null is not an object"],
  [/^[^\s]+ is not a function/i, "<identifier> is not a function"],
  [/^[^\s]+ is not a constructor/i, "<identifier> is not a constructor"],
  [/^[^\s]+ is not iterable/i, "<identifier> is not iterable"],
  [/^can't find variable/i, "Can't find variable <identifier>"],
  [/^cannot read propert(?:y|ies) .*? of (undefined|null)/i, (m) => `Cannot read property of ${m[1]!.toLowerCase()}`],
  [/^cannot read propert(?:y|ies) of (undefined|null)/i, (m) => `Cannot read property of ${m[1]!.toLowerCase()}`],
  [/^json parse error/i, "JSON Parse error"],
  [/^unexpected (?:token|end of json|character)/i, "Unexpected token in JSON"],
  [/^maximum update depth exceeded/i, "Maximum update depth exceeded"],
  [/^too many re-renders/i, "Too many re-renders"],
  [/^rendered (?:more|fewer) hooks/i, "Rendered a different number of hooks"],
  [/^text strings must be rendered within a <text> component/i, "Text strings must be rendered within a Text component"],
  [/^element type is invalid/i, "Element type is invalid"],
  [/^invalid hook call/i, "Invalid hook call"],
  [/^unable to resolve module/i, "Unable to resolve module"],
  [/^maximum call stack size exceeded/i, "Maximum call stack size exceeded"],
  [/^out of memory/i, "Out of memory"],
  [/^non-error thrown$/i, "non-Error thrown"],
];

function findStatus(s: string): string {
  STATUS_RE.lastIndex = 0;
  const m = STATUS_RE.exec(s) ?? /status code (\d{3})/i.exec(s);
  if (!m) return "";
  const code = m.length === 3 ? m[2] : m[1];
  return code ? ` (HTTP ${code})` : "";
}

export function scrubMessage(input: unknown): string {
  try {
    const raw = typeof input === "string" ? input : input instanceof Error ? input.message : "non-string error";
    const normalised = blankQuoted(stripUrls(raw.slice(0, 2000).replace(/\s+/g, " ").trim()));
    for (const [re, canonical] of SYSTEM_PATTERNS) {
      const m = re.exec(normalised);
      if (m) {
        const text = typeof canonical === "function" ? canonical(m) : canonical;
        return scrubFreeText(`${text}${findStatus(normalised)}`);
      }
    }
    return `message withheld (ref ${shortHash(scrubFreeText(raw))})`;
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
 * Parses V8/Hermes style lines ("at fn (path/index.android.bundle:1:2345)", "at fn (address at index.android.bundle:1:2)",
 * "fn@path:1:2") into function, file base name and position. Anything that does not parse is dropped, not forwarded: a
 * frame line is code, but we only trust what we parsed.
 */
export function scrubStack(stack: unknown): ScrubbedFrame[] {
  try {
    if (typeof stack !== "string") return [];
    const frames: ScrubbedFrame[] = [];
    for (const raw of stack.split("\n").slice(0, 60)) {
      // Hermes prints "address at <file>:<line>:<col>"; the words are noise, not part of the file name.
      const line = raw.trim().slice(0, 400).replace(/\baddress at\s+/gi, "");
      const m =
        /^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line) ?? /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
      if (!m) continue;
      const fn = (m[1] ?? "?").replace(/[^\w$.<> ]/g, "").slice(0, 80) || "?";
      const base = (m[2]!.split(/[\\/]/).pop() ?? "").split("?")[0]!.replace(/[^\w.$-]/g, "").slice(0, 80) || "?";
      frames.push({ function: fn, filename: base.slice(0, MAX_FRAME_LEN), lineno: Number(m[3]), colno: Number(m[4]) });
      if (frames.length >= MAX_FRAMES) break;
    }
    return frames;
  } catch {
    return [];
  }
}
