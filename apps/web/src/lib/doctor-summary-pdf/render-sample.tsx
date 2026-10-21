/**
 * Renders the sample summary to a real PDF file. Run from apps/web with `pnpm exec tsx src/lib/doctor-summary-pdf/render-sample.tsx <out.pdf>`.
 * react-pdf is ESM only and Jest here is CommonJS, so the real render happens in a child process (see real-render.test.ts).
 */
import { writeFileSync } from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import { DoctorSummaryPdfDocument } from "./document";
import { sampleData } from "./sample-data";

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error("usage: render-sample.tsx <out.pdf>");
  const buffer = await renderToBuffer(DoctorSummaryPdfDocument({ data: sampleData() }));
  writeFileSync(out, buffer);
}

void main();
