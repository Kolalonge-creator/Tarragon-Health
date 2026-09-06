import type { ChatAnthropic } from "@langchain/anthropic";
import { extractLabReport } from "./extract";
import type { TemplateHints } from "./corpus";

function fakeModel(raw: Record<string, unknown>, capture: (messages: unknown[]) => void): ChatAnthropic {
  return {
    withStructuredOutput: () => ({
      invoke: async (messages: unknown[]) => {
        capture(messages);
        return raw;
      },
    }),
  } as unknown as ChatAnthropic;
}

const MINIMAL_EXTRACTION = {
  report_date: null,
  lab_name: null,
  patient_name: null,
  rows: [],
  unreadable_reason: null,
};

type SystemBlock = { type: string; text: string; cache_control?: { type: string } };

describe("extractLabReport prompt caching", () => {
  it("marks the fixed vocabulary/instructions block as a cache breakpoint when there are no template hints", async () => {
    let captured: unknown[] = [];
    const model = fakeModel(MINIMAL_EXTRACTION, (messages) => {
      captured = messages;
    });

    const result = await extractLabReport({
      fileBase64: "ZmFrZQ==",
      mediaType: "image/png",
      model,
    });

    expect(result.ok).toBe(true);
    const systemMessage = captured[0] as { content: SystemBlock[] };
    expect(systemMessage.content).toHaveLength(1);
    expect(systemMessage.content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("keeps per-laboratory template hints as a separate, uncached block after the cached one", async () => {
    let captured: unknown[] = [];
    const model = fakeModel(MINIMAL_EXTRACTION, (messages) => {
      captured = messages;
    });
    const templateHints: TemplateHints = {
      labelAliases: { "SERUM CREAT": "creatinine" },
      unitDefaults: { creatinine: "umol/L" },
    };

    await extractLabReport({
      fileBase64: "ZmFrZQ==",
      mediaType: "image/png",
      templateHints,
      model,
    });

    const systemMessage = captured[0] as { content: SystemBlock[] };
    // Two blocks: the fixed, cached instructions+vocabulary, then the
    // per-laboratory hints with no cache_control of its own -- putting the
    // hints INSIDE the cached block (or ahead of it) would invalidate the
    // cached vocabulary on every request for a laboratory this platform has
    // already learned something about, which is exactly the traffic where
    // caching matters most.
    expect(systemMessage.content).toHaveLength(2);
    expect(systemMessage.content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(systemMessage.content[1].cache_control).toBeUndefined();
    expect(systemMessage.content[1].text).toContain("SERUM CREAT");
    // Rendered text is unchanged from the pre-caching single-string prompt --
    // no separator was reintroduced between the two blocks.
    expect(systemMessage.content[0].text.endsWith("\n")).toBe(false);
    expect(systemMessage.content[1].text.startsWith("\n")).toBe(true);
  });
});
