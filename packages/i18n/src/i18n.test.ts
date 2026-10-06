import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { asLocale, availableLocales, catalogues, en, LOCALES, pcm, resolveLocale, t } from "./index";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const BANNED = [/\bcures?\b/i, /\bcured\b/i, /instant doctor/i, /free healthcare/i, /your doctor/i, /—/];

describe("i18n catalogues", () => {
  it("has the same keys in every language (fails on a key present in one and missing in the other)", () => {
    const enKeys = Object.keys(en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(catalogues[locale]).sort()).toEqual(enKeys);
    }
    expect(Object.keys(pcm).sort()).toEqual(Object.keys(en).sort());
  });

  it("uses the same placeholders in every language", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(pcm[key])).toEqual(placeholders(en[key]));
    }
  });

  it("has no empty strings", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalogues[locale])) {
        expect([locale, key, value.trim().length > 0]).toEqual([locale, key, true]);
      }
    }
  });

  it("contains no banned words or em dashes", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalogues[locale])) {
        for (const re of BANNED) {
          expect([locale, key, re.test(value)]).toEqual([locale, key, false]);
        }
      }
    }
  });

  it("interpolates params and leaves a missing param visible", () => {
    expect(t("greeting.hello", "en", { name: "Ada" })).toBe("Hello, Ada");
    expect(t("greeting.hello", "pcm", { name: "Ada" })).toBe("How far, Ada");
    expect(t("greeting.hello", "en")).toBe("Hello, {name}");
  });

  it("falls back to English for an unknown locale and normalises junk", () => {
    expect(t("common.continue", "yo" as never)).toBe("Continue");
    expect(asLocale("pcm")).toBe("pcm");
    expect(asLocale(null)).toBe("en");
    expect(asLocale("fr")).toBe("en");
  });
});

describe("Edge Function i18n catalogue sync", () => {
  // The Edge Function bundles a subset of en.ts for credential.* and quality.* keys.
  // This test ensures that subset stays in step with the canonical catalogue.
  const cataloguePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/functions/_shared/i18n/catalogue.ts",
  );
  const raw = readFileSync(cataloguePath, "utf-8");
  const edgeCatalogue: Record<string, string> = {};
  for (const [, key, value] of raw.matchAll(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    edgeCatalogue[key] = value.replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }

  it("every Edge Function key exists in en.ts with the same value", () => {
    for (const [key, value] of Object.entries(edgeCatalogue)) {
      expect([key, (en as Record<string, string>)[key]]).toEqual([key, value]);
    }
  });

  it("every credential.* and quality.* key in en.ts is in the Edge Function catalogue", () => {
    for (const key of Object.keys(en)) {
      if (key.startsWith("credential.") || key.startsWith("quality.")) {
        expect([key, key in edgeCatalogue]).toEqual([key, true]);
      }
    }
  });
});

describe("Pidgin kill switch", () => {
  it("keeps Pidgin while on and resolves everything to English while off", () => {
    expect(resolveLocale("pcm", true)).toBe("pcm");
    expect(resolveLocale("pcm", false)).toBe("en");
    expect(resolveLocale("en", false)).toBe("en");
    expect(resolveLocale(undefined, false)).toBe("en");
  });

  it("offers Pidgin only while on", () => {
    expect(availableLocales(true)).toEqual(["en", "pcm"]);
    expect(availableLocales(false)).toEqual(["en"]);
  });
});
