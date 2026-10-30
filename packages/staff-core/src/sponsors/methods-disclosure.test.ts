import { describe, expect, it, jest } from "@jest/globals";
import { describeMethods, loadMethodsDisclosure, parseMethodsDisclosure, type MethodsRpc } from "./methods-disclosure";

const ID = "6f1d7a52-0000-4000-8000-000000000001";
const block = (review: unknown) => ({
  ok: true,
  methods: {
    withheld: false, wording_version: 1,
    funding: { sponsor: "Acme", produced_by: "Tarragon Health", text: "Acme sponsors this programme and this report. Tarragon Health produced the figures from its own records." },
    definitions: {
      text: "The figures use the definition versions listed here.",
      outcome_measures: { version: 4, status: "signed", status_text: "Signed on 2026-10-14", signed_on: "2026-10-14" },
      cascade_of_care: { version: 1, status: "proposed_not_signed", status_text: "Proposed, not signed", signed_on: null },
    },
    minimum_cell: { minimum: 20, text: "A group smaller than 20 people is never shown." },
    exclusions: { applied_by_the_definition_in_use: true, text: "Not counted: people under 18." },
    review,
    descriptive_note: "These are descriptions of a group of members.",
  },
});
const none = { status: "not_independently_reviewed", text: "These figures have not been independently reviewed." };

describe("methods disclosure", () => {
  it("shows the sign status of each definition version and the review status", () => {
    const p = parseMethodsDisclosure(block(none));
    expect(p?.shown).toBe(true);
    if (!p?.shown) return;
    const lines = describeMethods(p.methods).lines.join("\n");
    expect(lines).toContain("Outcome measures: version 4. Signed on 2026-10-14.");
    expect(lines).toContain("Cascade of care: version 1. Proposed, not signed.");
    expect(lines).toContain("have not been independently reviewed");
  });
  it("shows a recorded review", () => {
    const p = parseMethodsDisclosure(block({ status: "independently_reviewed", text: "Independently reviewed by A (B) on 2026-10-20. Scope of the review: the figures.", reviewer: "A", organisation: "B", reviewed_on: "2026-10-20", scope: "the figures" }));
    expect(p?.shown && describeMethods(p.methods).lines.join("\n")).toContain("Independently reviewed by A (B)");
  });
  it("a withheld disclosure is off, a bad reply is unavailable (never shown as empty)", async () => {
    const off = jest.fn<MethodsRpc>().mockResolvedValue({ data: { ok: true, methods: { withheld: true, reason: "not_switched_on" } }, error: null });
    expect(await loadMethodsDisclosure(off, ID)).toEqual({ state: "off" });
    expect(await loadMethodsDisclosure(jest.fn<MethodsRpc>().mockResolvedValue({ data: { ok: false }, error: null }), ID)).toEqual({ state: "unavailable" });
    expect(await loadMethodsDisclosure(jest.fn<MethodsRpc>().mockResolvedValue({ data: null, error: { message: "x" } }), ID)).toEqual({ state: "unavailable" });
    expect(await loadMethodsDisclosure(jest.fn<MethodsRpc>().mockResolvedValue({ data: block({ status: "other" }), error: null }), ID)).toEqual({ state: "unavailable" });
  });
});
