import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * INV-15: money is integer minor units (kobo), never a float. This scan walks finance-facing code and fails when it
 * finds float handling of money: parseFloat, toFixed, or a multiply or divide by 100 (the naira/kobo conversion done
 * by hand). The one sanctioned conversion is `nairaToKobo` / `koboToNaira` / `nairaInputToKobo` (shared helpers).
 *
 * Existing violations are listed in ALLOW with a reason per entry. The list can only shrink: a new line that matches a
 * pattern and is not on it fails the build. Matching is on the trimmed source line, so moving code does not matter but
 * changing it does.
 */
const ROOT = join(__dirname, "..", "..");
const SCOPES = [join(ROOT, "app", "(dashboard)", "finance"), join(ROOT, "lib", "finance")];

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "parseFloat", re: /\bparseFloat\s*\(/ },
  { name: "toFixed", re: /\.toFixed\s*\(/ },
  { name: "hand conversion (/ 100 or * 100)", re: /[*/]\s*100\b(?!\s*[%_])/ },
];

interface Allowed {
  file: string;
  line: string;
  reason: string;
}

const ALLOW: Allowed[] = [
  {
    file: "app/(dashboard)/finance/_components/primitives.tsx",
    line: "const n = typeof value === \"number\" ? value : parseFloat(value);",
    reason: "Form input boundary: majorToMinor rounds once to integer minor units. Real violation of the pattern, tolerated until it is replaced by nairaInputToKobo (blank input behaviour differs, so not changed here).",
  },
  {
    file: "app/(dashboard)/finance/_components/primitives.tsx",
    line: "return Math.round(n * 100);",
    reason: "Same helper as above: single rounding to integer minor units at the input boundary.",
  },
  {
    file: "app/(dashboard)/finance/partner-settlements/actions.ts",
    line: "const invoicedTotalKobo = Math.round(parseFloat(invoicedTotalNaira) * 100);",
    reason: "Server action input boundary: naira text to integer kobo. Should move to nairaInputToKobo (rejects NaN, which this does not).",
  },
  {
    file: "app/(dashboard)/finance/partner-settlements/actions.ts",
    line: "invoiced_kobo: Math.round(parseFloat(invoicedNaira ?? \"\") * 100),",
    reason: "Same as above, per-line invoiced amount. NaN is not rejected here: follow-up, not fixed in this pass (do not refactor finance logic).",
  },
  {
    file: "app/(dashboard)/finance/_components/settings.tsx",
    line: "defaultValue={(s.threshold_minor / 100).toString()}",
    reason: "Display only: pre-fills a naira form field from an integer kobo value. Nothing is stored from this expression.",
  },
  {
    file: "app/(dashboard)/finance/_components/compliance.tsx",
    line: "setAmount((s.suggested_amount_minor / 100).toString());",
    reason: "Display only: pre-fills a naira form field from an integer kobo value.",
  },
  {
    file: "app/(dashboard)/finance/_components/employer-billing.tsx",
    line: "price: row.price_per_member_minor ? String(row.price_per_member_minor / 100) : \"\",",
    reason: "Display only: pre-fills a naira form field from an integer kobo value.",
  },
  {
    file: "app/(dashboard)/finance/_components/payables.tsx",
    line: "wht_rate_pct: vf.wht_applicable && vf.wht_rate_pct ? parseFloat(vf.wht_rate_pct) : null,",
    reason: "A percentage rate, not a money amount.",
  },
  {
    file: "app/(dashboard)/finance/_components/tax.tsx",
    line: "const rate = parseFloat(nr.rate_pct);",
    reason: "A percentage rate, not a money amount.",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export function findFloatMoney(files: { file: string; text: string }[]): { file: string; line: string; pattern: string }[] {
  const hits: { file: string; line: string; pattern: string }[] = [];
  for (const { file, text } of files) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
      for (const p of PATTERNS) if (p.re.test(line)) hits.push({ file, line, pattern: p.name });
    }
  }
  return hits;
}

const isAllowed = (h: { file: string; line: string }) => ALLOW.some((a) => a.file === h.file && a.line === h.line);

describe("INV-15: finance code never handles money as a float", () => {
  const files = SCOPES.flatMap((d) => walk(d)).map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, "utf8") }));

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no float money handling outside the allow-list", () => {
    const bad = findFloatMoney(files).filter((h) => !isAllowed(h));
    expect(bad).toEqual([]);
  });

  it("every allow-list entry still matches a real line (remove entries when the code is fixed)", () => {
    const hits = findFloatMoney(files);
    const unused = ALLOW.filter((a) => !hits.some((h) => h.file === a.file && h.line === a.line));
    expect(unused).toEqual([]);
  });

  it("every allow-list entry has a reason", () => {
    for (const a of ALLOW) expect(a.reason.length).toBeGreaterThan(20);
  });

  describe("sabotage: the scan really catches a float", () => {
    it.each([
      ["parseFloat", "const k = parseFloat(amount);"],
      ["toFixed", "const s = total.toFixed(2);"],
      ["hand conversion", "const kobo = naira * 100;"],
      ["hand conversion", "const naira = amount_kobo / 100;"],
    ])("flags %s", (_n, line) => {
      expect(findFloatMoney([{ file: "x.ts", text: line }]).length).toBe(1);
    });

    it("does not flag integer-safe code or comments", () => {
      expect(findFloatMoney([{ file: "x.ts", text: "const k = nairaToKobo(n);\n// naira * 100\nconst pct = 100;" }])).toEqual([]);
    });
  });
});
