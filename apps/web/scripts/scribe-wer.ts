/**
 * Measured word error rate for the scribe's speech-to-text on local, consented audio (S35, plan item 5).
 *
 *   pnpm scribe-wer <manifest.json>
 *
 * The manifest is a JSON array; each entry points at two plain-text files written by a person and a speech model:
 *   { "id": "pcm-001", "language": "pcm", "reference": "refs/pcm-001.txt", "hypothesis": "hyps/pcm-001.txt",
 *     "protectedTerms": ["amlodipine", "5 mg"] }
 * Paths are relative to the manifest. The reference is a clinician-checked transcript of the recording; the
 * hypothesis is what the speech model produced from the same audio. Nothing is sent anywhere and no audio is read.
 *
 * Output: a per-language table (WER, dropped negations, protected terms missed) and the worst samples. It exits 1 when
 * a sample file is missing, so a half-collected test set cannot look like a pass. There is NO pass mark here: a
 * threshold for switching a language on is a PROPOSED value for the CMO, not something this script decides.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { reportByLanguage, scoreSample } from "../src/lib/scribe/wer";

interface Entry {
  id: string;
  language: string;
  reference: string;
  hypothesis: string;
  protectedTerms?: string[];
}

function main(): number {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("usage: pnpm scribe-wer <manifest.json>");
    return 2;
  }
  const dir = dirname(resolve(manifestPath));
  const entries = JSON.parse(readFileSync(manifestPath, "utf8")) as Entry[];
  const results = [];
  let missing = 0;
  for (const e of entries) {
    try {
      results.push(
        scoreSample({
          id: e.id,
          language: e.language,
          reference: readFileSync(resolve(dir, e.reference), "utf8"),
          hypothesis: readFileSync(resolve(dir, e.hypothesis), "utf8"),
          protectedTerms: e.protectedTerms,
        }),
      );
    } catch {
      missing += 1;
      console.error(`missing or unreadable files for sample ${e.id}`);
    }
  }
  console.log("language | samples | words | WER | negations dropped/total | protected terms missed/total");
  for (const r of reportByLanguage(results)) {
    console.log(
      `${r.language} | ${r.samples} | ${r.referenceWords} | ${(r.wer * 100).toFixed(1)}% | ${r.negationsDropped}/${r.negationsInReference} | ${r.protectedTermsMissed}/${r.protectedTerms}`,
    );
  }
  console.log("\nworst samples:");
  for (const r of [...results].sort((a, b) => b.wer - a.wer).slice(0, 5)) {
    console.log(`${r.id} (${r.language}): ${(r.wer * 100).toFixed(1)}%${r.negationsDropped ? `, ${r.negationsDropped} negation(s) dropped` : ""}`);
  }
  return missing > 0 ? 1 : 0;
}

process.exit(main());
