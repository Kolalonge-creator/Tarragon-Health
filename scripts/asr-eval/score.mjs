// S11-S15 R7: speech-to-text gold-set evaluation. Vendor neutral, offline, no audio, no network, no model call (INV-01).
//
// Scores a transcript (any vendor, converted to the small JSON shape below) against a clinician-corrected reference:
//   * overall WER;
//   * WER on drug names and on numbers (an error on a drug or a number is the error that hurts a patient: Afonja et al. 2024 found
//     models with a low overall WER still err more on clinical entities [P]);
//   * per speaker and per accent tag;
//   * every drug-name and number mismatch, with its context, so a person can read the exact words that went wrong.
// There is NO pass mark here. A threshold for choosing a vendor is the CMO's decision (Q19); this only measures.
//
// Transcript shape (reference and hypothesis alike; "speaker" is optional and defaults to "unknown"):
//   { "clipId": "c01", "accent": "yoruba", "segments": [ { "speaker": "clinician" | "patient" | "unknown", "text": "..." } ] }

const UNITS = new Map(Object.entries({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }));
const TEENS = new Map(Object.entries({ ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }));
const TENS = new Map(Object.entries({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }));
// A lone "one" is usually the pronoun ("one of my tablets"), so it becomes 1 only beside a dose or time word.
const DOSE_WORDS = new Set(["mg", "mcg", "ml", "g", "kg", "mmhg", "mmol", "tablet", "tablets", "tab", "tabs", "capsule", "capsules", "times", "unit", "units", "puff", "puffs", "drop", "drops", "daily", "day", "days", "week", "weeks", "month", "months", "hour", "hours"]);
const NEGATIONS = new Set(["not", "no", "never", "without", "nothing", "none", "dont", "doesnt", "didnt", "cant", "wont", "isnt", "arent", "nobody"]);

const isDigits = (t) => /^\d+(?:\.\d+)?$/.test(t);

/** Splits text into words, keeping decimals together (2.5) and dropping punctuation. A slash splits (120/80 is two numbers). */
export function tokenise(text) {
  const cleaned = String(text ?? "").toLowerCase().replace(/[’']/g, "").replace(/(\d),(\d{3})/g, "$1$2");
  return cleaned.match(/\d+(?:\.\d+)?|[\p{L}]+/gu) ?? [];
}

// Number grammar: [tens [unit]] | teen | unit, then "hundred [and] <below 100>", the colloquial "one twenty" (= 120, the way a blood pressure is
// read out), "thousand", and "point <digits>". Two unit words in a row ("five five") are two numbers, not 10.
function below100(t, j) {
  const w = t[j];
  if (TENS.has(w)) {
    const u = UNITS.get(t[j + 1]);
    return u !== undefined && u > 0 ? { v: TENS.get(w) + u, next: j + 2, kind: "tens" } : { v: TENS.get(w), next: j + 1, kind: "tens" };
  }
  if (TEENS.has(w)) return { v: TEENS.get(w), next: j + 1, kind: "teen" };
  if (UNITS.has(w)) return { v: UNITS.get(w), next: j + 1, kind: "unit" };
  return null;
}
function below1000(t, j) {
  const a = below100(t, j);
  if (!a) return null;
  if (t[a.next] === "hundred") {
    let next = a.next + 1;
    if (t[next] === "and") next += 1;
    const b = below100(t, next);
    return b && b.v > 0 ? { v: a.v * 100 + b.v, next: b.next } : { v: a.v * 100, next: a.next + 1 };
  }
  if (a.kind === "unit" && (a.v === 1 || a.v === 2)) {
    const b = below100(t, a.next);
    if (b && b.kind === "tens") return { v: a.v * 100 + b.v, next: b.next };
  }
  return { v: a.v, next: a.next, lone: a.kind === "unit" && a.next === j + 1 };
}
export function normaliseNumbers(tokens) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let n = below1000(tokens, i);
    if (!n) { out.push(tokens[i]); i += 1; continue; }
    let value = n.v;
    let next = n.next;
    let lone = n.lone === true;
    if (tokens[next] === "thousand") {
      const rest = below1000(tokens, next + 1);
      value = value * 1000 + (rest ? rest.v : 0);
      next = rest ? rest.next : next + 1;
      lone = false;
    }
    let text = String(value);
    if (tokens[next] === "point" && UNITS.has(tokens[next + 1])) {
      let k = next + 1;
      let dec = "";
      while (UNITS.has(tokens[k])) { dec += String(UNITS.get(tokens[k])); k += 1; }
      text = `${value}.${dec}`;
      next = k;
      lone = false;
    }
    if (lone && tokens[i] === "one" && !DOSE_WORDS.has(tokens[next])) { out.push("one"); i += 1; continue; }
    out.push(text);
    i = next;
  }
  return out;
}

/** Word list for one transcript: [{ w, speaker }]. */
export function words(transcript) {
  const out = [];
  for (const seg of transcript?.segments ?? []) {
    const speaker = seg.speaker === "clinician" || seg.speaker === "patient" ? seg.speaker : "unknown";
    for (const w of normaliseNumbers(tokenise(seg.text))) out.push({ w, speaker });
  }
  return out;
}

/** Word alignment with the three edit kinds. ops: { kind: "match"|"sub"|"del"|"ins", r: refIndex|null, h: hypIndex|null }. */
export function align(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) cost[i][0] = i;
  for (let j = 0; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = cost[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      cost[i][j] = Math.min(diag, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ kind: ref[i - 1] === hyp[j - 1] ? "match" : "sub", r: i - 1, h: j - 1 });
      i -= 1; j -= 1;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      ops.push({ kind: "del", r: i - 1, h: null });
      i -= 1;
    } else {
      ops.push({ kind: "ins", r: null, h: j - 1 });
      j -= 1;
    }
  }
  return ops.reverse();
}

const empty = () => ({ refWords: 0, errors: 0, subs: 0, dels: 0, ins: 0 });
const addOp = (acc, kind) => {
  if (kind === "match") return;
  acc.errors += 1;
  if (kind === "sub") acc.subs += 1;
  else if (kind === "del") acc.dels += 1;
  else acc.ins += 1;
};
const rate = (errors, total) => (total === 0 ? null : errors / total);

/** Builds the drug lookup from drug-names.json (groups plus brands). */
export function drugSet(list) {
  const set = new Set();
  for (const group of Object.values(list?.groups ?? {})) for (const n of group) set.add(String(n).toLowerCase());
  for (const n of list?.brand_names_commonly_said ?? []) set.add(String(n).toLowerCase());
  return set;
}

/** Scores one clip. */
export function scoreClip({ id, accent, reference, hypothesis }, drugs) {
  const ref = words(reference);
  const hyp = words(hypothesis);
  const ops = align(ref.map((x) => x.w), hyp.map((x) => x.w));
  const overall = empty();
  const bySpeaker = new Map();
  const drugAcc = { total: 0, wrong: 0 };
  const numAcc = { total: 0, wrong: 0 };
  const falseDrugs = [];
  const falseNumbers = [];
  const mismatches = [];
  let negations = 0;
  let negationsDropped = 0;
  const spk = (s) => { if (!bySpeaker.has(s)) bySpeaker.set(s, empty()); return bySpeaker.get(s); };
  overall.refWords = ref.length;
  for (const r of ref) spk(r.speaker).refWords += 1;

  const context = (ri, hi) => ({
    contextReference: ref.slice(Math.max(0, ri - 3), ri + 4).map((x) => x.w).join(" "),
    contextHeard: hi === null ? null : hyp.slice(Math.max(0, hi - 3), hi + 4).map((x) => x.w).join(" "),
  });
  const kindOf = (w) => (drugs.has(w) ? "drug" : isDigits(w) ? "number" : null);

  for (const op of ops) {
    addOp(overall, op.kind);
    if (op.kind === "ins") {
      addOp(spk(hyp[op.h].speaker), "ins");
      const k = kindOf(hyp[op.h].w);
      if (k === "drug") falseDrugs.push({ heard: hyp[op.h].w, ...context(Math.max(0, Math.min(op.h, ref.length - 1)), op.h) });
      if (k === "number") falseNumbers.push({ heard: hyp[op.h].w, ...context(Math.max(0, Math.min(op.h, ref.length - 1)), op.h) });
      continue;
    }
    const r = ref[op.r];
    addOp(spk(r.speaker), op.kind);
    if (NEGATIONS.has(r.w)) {
      negations += 1;
      if (op.kind !== "match") negationsDropped += 1;
    }
    const k = kindOf(r.w);
    if (k) {
      const acc = k === "drug" ? drugAcc : numAcc;
      acc.total += 1;
      if (op.kind !== "match") {
        acc.wrong += 1;
        mismatches.push({ kind: k, expected: r.w, heard: op.kind === "del" ? null : hyp[op.h].w, speaker: r.speaker, ...context(op.r, op.h ?? null) });
      }
    }
    if (op.kind === "sub") {
      const hk = kindOf(hyp[op.h].w);
      if (hk && hk !== k) (hk === "drug" ? falseDrugs : falseNumbers).push({ heard: hyp[op.h].w, ...context(op.r, op.h) });
    }
  }
  return { id, accent: accent ?? "untagged", overall, bySpeaker, drug: drugAcc, number: numAcc, negations, negationsDropped, falseDrugs, falseNumbers, mismatches };
}

const sum = (rows, pick) => rows.reduce((s, r) => s + pick(r), 0);

/** Corpus level: total errors over total reference words (not a mean of clip rates), overall and by accent and speaker. */
export function evaluate(clips, drugs) {
  const scored = clips.map((c) => scoreClip(c, drugs));
  const total = (rows) => {
    const words = sum(rows, (r) => r.overall.refWords);
    const errors = sum(rows, (r) => r.overall.errors);
    return {
      clips: rows.length, refWords: words, errors, wer: rate(errors, words),
      drugTerms: sum(rows, (r) => r.drug.total), drugWrong: sum(rows, (r) => r.drug.wrong), drugWer: rate(sum(rows, (r) => r.drug.wrong), sum(rows, (r) => r.drug.total)),
      numberTerms: sum(rows, (r) => r.number.total), numberWrong: sum(rows, (r) => r.number.wrong), numberWer: rate(sum(rows, (r) => r.number.wrong), sum(rows, (r) => r.number.total)),
      negations: sum(rows, (r) => r.negations), negationsDropped: sum(rows, (r) => r.negationsDropped),
      falseDrugs: sum(rows, (r) => r.falseDrugs.length), falseNumbers: sum(rows, (r) => r.falseNumbers.length),
    };
  };
  const groupBy = (keyOf) => {
    const m = new Map();
    for (const r of scored) { const k = keyOf(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ key, ...total(rows) }));
  };
  const speakers = new Map();
  for (const r of scored) for (const [s, acc] of r.bySpeaker) { const a = speakers.get(s) ?? empty(); a.refWords += acc.refWords; a.errors += acc.errors; a.subs += acc.subs; a.dels += acc.dels; a.ins += acc.ins; speakers.set(s, a); }
  const warnings = [];
  if (scored.length < 20) warnings.push(`Only ${scored.length} clip(s): the plan asks for a 20 to 30 clip gold set. These numbers are indicative, not evidence for choosing a vendor.`);
  const totals = total(scored);
  if (totals.drugTerms < 30) warnings.push(`Only ${totals.drugTerms} drug-name occurrence(s) in the references: a drug-name error rate on so few is not reliable.`);
  if (totals.numberTerms < 30) warnings.push(`Only ${totals.numberTerms} number occurrence(s) in the references: a number error rate on so few is not reliable.`);
  return {
    totals,
    byAccent: groupBy((r) => r.accent),
    bySpeaker: [...speakers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, a]) => ({ key, refWords: a.refWords, errors: a.errors, wer: rate(a.errors, a.refWords) })),
    clips: scored.map((r) => ({ id: r.id, accent: r.accent, refWords: r.overall.refWords, wer: rate(r.overall.errors, r.overall.refWords), drugWrong: r.drug.wrong, drugTerms: r.drug.total, numberWrong: r.number.wrong, numberTerms: r.number.total, negationsDropped: r.negationsDropped })),
    mismatches: scored.flatMap((r) => r.mismatches.map((m) => ({ clip: r.id, ...m }))),
    falseEntities: scored.flatMap((r) => [...r.falseDrugs.map((f) => ({ clip: r.id, kind: "drug", ...f })), ...r.falseNumbers.map((f) => ({ clip: r.id, kind: "number", ...f }))]),
    warnings,
  };
}

const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

/** A plain-text report. Every drug-name or number mismatch is printed with the words around it. */
export function renderReport(result) {
  const lines = [];
  const t = result.totals;
  lines.push(`Clips: ${t.clips}   reference words: ${t.refWords}`);
  lines.push(`Overall WER: ${pct(t.wer)}   drug-name error rate: ${pct(t.drugWer)} (${t.drugWrong}/${t.drugTerms})   number error rate: ${pct(t.numberWer)} (${t.numberWrong}/${t.numberTerms})`);
  lines.push(`Negations dropped: ${t.negationsDropped}/${t.negations}   drug names heard that were not said: ${t.falseDrugs}   numbers heard that were not said: ${t.falseNumbers}`);
  lines.push("");
  lines.push("By accent tag: accent | clips | words | WER | drug errors | number errors");
  for (const a of result.byAccent) lines.push(`${a.key} | ${a.clips} | ${a.refWords} | ${pct(a.wer)} | ${a.drugWrong}/${a.drugTerms} | ${a.numberWrong}/${a.numberTerms}`);
  lines.push("");
  lines.push("By speaker: speaker | words | WER");
  for (const s of result.bySpeaker) lines.push(`${s.key} | ${s.refWords} | ${pct(s.wer)}`);
  lines.push("");
  lines.push(`Drug-name and number mismatches (${result.mismatches.length}): clip | kind | said | heard | context`);
  for (const m of result.mismatches) lines.push(`${m.clip} | ${m.kind.toUpperCase()} | [[${m.expected}]] | ${m.heard === null ? "(missing)" : `[[${m.heard}]]`} | said: ...${m.contextReference}...  heard: ${m.contextHeard === null ? "(nothing there)" : `...${m.contextHeard}...`}`);
  if (result.falseEntities.length > 0) {
    lines.push("");
    lines.push(`Drug names or numbers in the transcript that the reference does not have (${result.falseEntities.length}):`);
    for (const f of result.falseEntities) lines.push(`${f.clip} | ${f.kind.toUpperCase()} | [[${f.heard}]]`);
  }
  for (const w of result.warnings) lines.push(`\nWARNING: ${w}`);
  lines.push("\nThere is no pass mark here. Choosing a vendor from these numbers is the CMO's decision (Q19).");
  return lines.join("\n");
}
