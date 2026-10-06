import { describe, expect, it } from "@jest/globals";
import type { SpeechToText, TranscriptSegment } from "../../../../supabase/functions/_shared/integrations/index.ts";

export interface SpeechFixture {
  readonly provider: SpeechToText;
  /** Number of audio chunks that make the fixture return at least one segment. */
  readonly chunksForText: number;
  /** True when this fixture can be made to drop the connection on the Nth chunk. */
  readonly canDropMidStream?: boolean;
}

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const CONSENT = "c1a9e4d2-83b6-4f70-a5e1-92d04b7c6f18";
const chunk = (): Uint8Array => new Uint8Array([1, 2, 3, 4]);

export function runSpeechContract(name: string, make: () => SpeechFixture): void {
  describe(`SpeechToText contract: ${name}`, () => {
    it("will not start without a recorded scribe consent (INV-11)", async () => {
      const f = make();
      for (const scribeConsentId of ["", "yes", "not-a-uuid"]) {
        const r = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("consent_required");
      }
    });

    it("refuses a non-opaque encounter reference and an unsupported language", async () => {
      const f = make();
      const named = await f.provider.startStream({ encounterRef: "Ada Okafor", language: "en-NG", scribeConsentId: CONSENT });
      const lang = await f.provider.startStream({ encounterRef: ENC, language: "xx" as never, scribeConsentId: CONSENT });
      expect(named.ok).toBe(false);
      expect(lang.ok).toBe(false);
      if (!lang.ok) expect(lang.error.code).toBe("unsupported");
    });

    it("streams ordered, timestamped segments and returns them all on stop", async () => {
      const f = make();
      const s = await f.provider.startStream({ encounterRef: ENC, language: "pcm", scribeConsentId: CONSENT });
      if (!s.ok) throw new Error("stream");
      const live: TranscriptSegment[] = [];
      s.data.onSegment((seg) => live.push(seg));
      for (let i = 0; i < f.chunksForText; i++) expect((await s.data.push(chunk())).ok).toBe(true);
      const t = await s.data.stop();
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      expect(t.data.language).toBe("pcm");
      expect(t.data.segments.length).toBeGreaterThan(0);
      expect(t.data.segments).toEqual(live);
      t.data.segments.forEach((seg, i) => {
        expect(seg.index).toBe(i);
        expect(seg.startMs).toBeGreaterThanOrEqual(0);
        expect(seg.endMs).toBeGreaterThanOrEqual(seg.startMs);
        if (i > 0) expect(seg.startMs).toBeGreaterThanOrEqual(t.data.segments[i - 1]!.endMs);
        expect(["clinician", "patient", "unknown"]).toContain(seg.speaker);
        expect(seg.confidence === null || (seg.confidence >= 0 && seg.confidence <= 1)).toBe(true);
      });
      expect(t.data.durationMs).toBeGreaterThanOrEqual(t.data.segments[t.data.segments.length - 1]!.endMs);
    });

    it("stops cleanly twice with the same transcript, and refuses audio after stop", async () => {
      const f = make();
      const s = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId: CONSENT });
      if (!s.ok) throw new Error("stream");
      await s.data.push(chunk());
      const a = await s.data.stop();
      const b = await s.data.stop();
      expect(a).toEqual(b);
      const late = await s.data.push(chunk());
      expect(late.ok).toBe(false);
      if (!late.ok) expect(late.error.code).toBe("conflict");
    });

    it("continues the same timeline when restarted after a dropped connection", async () => {
      const f = make();
      const s = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId: CONSENT, resumeFrom: { offsetMs: 90_000, nextIndex: 12 } });
      if (!s.ok) throw new Error("stream");
      for (let i = 0; i < f.chunksForText; i++) await s.data.push(chunk());
      const t = await s.data.stop();
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      expect(t.data.segments[0]).toMatchObject({ index: 12 });
      expect(t.data.segments[0]!.startMs).toBeGreaterThanOrEqual(90_000);
      t.data.segments.forEach((seg, i) => expect(seg.index).toBe(12 + i));
      for (const resumeFrom of [{ offsetMs: -1, nextIndex: 0 }, { offsetMs: 0, nextIndex: 1.5 }]) {
        const bad = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId: CONSENT, resumeFrom });
        expect(bad.ok).toBe(false);
      }
    });

    it("refuses an empty audio chunk", async () => {
      const f = make();
      const s = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId: CONSENT });
      if (!s.ok) throw new Error("stream");
      expect((await s.data.push(new Uint8Array(0))).ok).toBe(false);
    });

    it("stops delivering segments to a handler that unsubscribed", async () => {
      const f = make();
      const s = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId: CONSENT });
      if (!s.ok) throw new Error("stream");
      let n = 0;
      const off = s.data.onSegment(() => (n += 1));
      off();
      for (let i = 0; i < f.chunksForText; i++) await s.data.push(chunk());
      expect(n).toBe(0);
    });

    it("never puts transcript text in an error", async () => {
      const f = make();
      const s = await f.provider.startStream({ encounterRef: ENC, language: "en-NG", scribeConsentId: CONSENT });
      if (!s.ok) throw new Error("stream");
      await s.data.push(chunk());
      await s.data.stop();
      const late = await s.data.push(chunk());
      const t = await s.data.stop();
      const text = t.ok ? t.data.segments.map((g) => g.text).filter((x) => x.length > 3) : [];
      for (const piece of text) expect(JSON.stringify(late)).not.toContain(piece);
    });
  });
}
