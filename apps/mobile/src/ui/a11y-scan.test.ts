import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Accessibility scan (S34, spec D.2). Static, so it runs in Jest with no device.
 * It guards the three things a screen reader needs from every touchable:
 * a role, a name, and no unlabelled icon-only control. It cannot prove a screen
 * reads well on a phone; that stays a device check (docs/STAGE-1-SIGNOFF.md).
 */
const SRC = join(__dirname, "..");
const TAGS = ["Pressable", "TouchableOpacity", "TouchableHighlight", "PressableScale", "TouchableWithoutFeedback"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

const OPEN = new RegExp(`<(${TAGS.join("|")})\\b((?:[^>{]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*?)(/?)>`, "g");

interface Touchable {
  file: string;
  line: number;
  attrs: string;
  body: string;
}

function touchables(): Touchable[] {
  const found: Touchable[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(OPEN)) {
      const start = m.index ?? 0;
      let body = "";
      if (m[3] !== "/") {
        const close = text.indexOf(`</${m[1]}>`, start + m[0].length);
        body = close === -1 ? "" : text.slice(start + m[0].length, close);
      }
      found.push({ file: relative(SRC, file), line: text.slice(0, start).split("\n").length, attrs: m[2], body });
    }
  }
  return found;
}

const all = touchables();
const where = (t: Touchable) => `${t.file}:${t.line}`;

describe("accessibility scan", () => {
  it("finds the touchables it is meant to guard", () => {
    expect(all.length).toBeGreaterThan(80);
  });

  it("gives every touchable an accessibilityRole (a spread of props, or an explicit accessible={false}, is accepted)", () => {
    const missing = all
      .filter((t) => !t.attrs.includes("accessibilityRole") && !t.attrs.includes("{...") && !t.attrs.includes("accessible={false}"))
      .map(where);
    expect(missing).toEqual([]);
  });

  it("names every icon-only touchable with an accessibilityLabel", () => {
    const unnamed = all
      .filter((t) => !t.attrs.includes("accessibilityLabel") && !t.attrs.includes("{...") && !t.attrs.includes("accessible={false}"))
      .filter((t) => !/<(Text|AppText)\b/.test(t.body) && !/\{body\}|\{children\}/.test(t.body))
      .map(where);
    expect(unnamed).toEqual([]);
  });

  it("keeps text scalable: nothing switches font scaling off", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (/allowFontScaling=\{false\}/.test(readFileSync(file, "utf8"))) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it("does not use a hard-coded tiny hit area without padding it (hitSlop) on a small touchable", () => {
    const small = all.filter((t) => /(?:width|height):\s*(\d+)/.test(t.attrs)).filter((t) => {
      const sizes = [...t.attrs.matchAll(/(?:width|height):\s*(\d+)/g)].map((m) => Number(m[1]));
      return sizes.some((n) => n < 44) && !t.attrs.includes("hitSlop") && !t.attrs.includes("minHeight");
    });
    expect(small.map(where)).toEqual([]);
  });
});
