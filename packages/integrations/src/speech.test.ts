import { createMockSpeech } from "../../../supabase/functions/_shared/integrations/index.ts";
import { runSpeechContract } from "./contracts/speech.contract";
import { describe, expect, it } from "@jest/globals";

const script = [
  { text: "Good morning, how have you been this week?", speaker: "clinician" as const, durationMs: 2800 },
  { text: "I dey fine small, but my head dey turn me.", speaker: "patient" as const, durationMs: 3100 },
  { text: "Okay. Let us check that together.", speaker: "clinician" as const, durationMs: 2000 },
];

runSpeechContract("mock", () => ({ provider: createMockSpeech({ script }), chunksForText: 2 }));

describe("mock speech to text", () => {
  const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
  const CONSENT = "c1a9e4d2-83b6-4f70-a5e1-92d04b7c6f18";

  it("drops the connection on the chosen chunk and keeps what it already had", async () => {
    const stt = createMockSpeech({ script, failOnChunk: 3 });
    const s = await stt.startStream({ encounterRef: ENC, scribeConsentId: CONSENT });
    if (!s.ok) throw new Error("stream");
    await s.data.push(new Uint8Array([1]));
    await s.data.push(new Uint8Array([1]));
    const dropped = await s.data.push(new Uint8Array([1]));
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) expect(dropped.error).toMatchObject({ code: "network", retryable: true });
    const t = await s.data.stop();
    expect(t.ok && t.data.segments).toHaveLength(2);
  });

  it("a script shorter than the audio just yields no more segments", async () => {
    const stt = createMockSpeech({ script: script.slice(0, 1) });
    const s = await stt.startStream({ encounterRef: ENC, scribeConsentId: CONSENT });
    if (!s.ok) throw new Error("stream");
    for (let i = 0; i < 4; i++) await s.data.push(new Uint8Array([1]));
    const t = await s.data.stop();
    expect(t.ok && t.data.segments).toHaveLength(1);
  });

  it("gives each stream its own id", async () => {
    const stt = createMockSpeech({ script });
    const a = await stt.startStream({ encounterRef: ENC, scribeConsentId: CONSENT });
    const b = await stt.startStream({ encounterRef: ENC, scribeConsentId: CONSENT });
    expect(a.ok && b.ok && a.data.id !== b.data.id).toBe(true);
  });
});
