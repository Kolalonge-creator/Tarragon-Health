/** @jest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DESCRIBE_DRAFT,
  EXPLAINER_DRAFT,
  SAFETY_NET_DRAFT,
  describeTableSchema,
  explainResult,
  explainerConfigSchema,
  safetyNetConfigSchema,
  type DescribeTable,
} from "@tarragon/symptom-triage-engine";
import { t } from "@tarragon/i18n";
import { DescribeEntry } from "./describe-entry";
import { SafetyNetBlock } from "./safety-net-block";
import { SaveCardPanel } from "./save-card";
import { WhyThisResult } from "./why-this-result";

const sign = <T extends object>(c: T) => ({ ...c, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } });
const SIGNED_TABLE: DescribeTable = describeTableSchema.parse(sign(DESCRIBE_DRAFT));
const COMPLAINTS = [
  { key: "headache", label: "Headache" },
  { key: "chest_pain", label: "Chest pain" },
  { key: "breathlessness", label: "Breathlessness" },
];

afterEach(() => cleanup());

describe("DescribeEntry (the shared danger-phrase screen runs first)", () => {
  const onChoose = jest.fn<(k: string) => void>();
  const onDanger = jest.fn<(selfHarm: boolean) => void>();
  beforeEach(() => {
    onChoose.mockReset();
    onDanger.mockReset();
  });

  const type = (text: string) => {
    fireEvent.change(screen.getByLabelText(t("symptom.describe.label")), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: t("symptom.describe.button") }));
  };

  it("danger wording shows the emergency route at once, throws the text away, and never reaches the table", () => {
    render(<DescribeEntry complaints={COMPLAINTS} table={SIGNED_TABLE} onChoose={onChoose} onDanger={onDanger} />);
    type("I have a headache and I fainted");
    expect(onDanger).toHaveBeenCalledWith(false);
    expect(onChoose).not.toHaveBeenCalled();
    expect((screen.getByLabelText(t("symptom.describe.label")) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/sounds like/i)).toBeNull();
  });

  it("flags self-harm wording as such", () => {
    render(<DescribeEntry complaints={COMPLAINTS} table={SIGNED_TABLE} onChoose={onChoose} onDanger={onDanger} />);
    type("I want to kill myself");
    expect(onDanger).toHaveBeenCalledWith(true);
  });

  it("a clear description is offered as a suggestion the person confirms, then clears the words", () => {
    render(<DescribeEntry complaints={COMPLAINTS} table={SIGNED_TABLE} onChoose={onChoose} onDanger={onDanger} />);
    type("my head is paining me since morning");
    expect(screen.getByText(t("symptom.describe.match", "en", { name: "Headache" }))).toBeTruthy();
    expect(onChoose).not.toHaveBeenCalled(); // nothing starts until the person says yes
    expect((screen.getByLabelText(t("symptom.describe.label")) as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: t("symptom.describe.match_yes") }));
    expect(onChoose).toHaveBeenCalledWith("headache");
    expect(onDanger).not.toHaveBeenCalled();
  });

  it("two pathways in one sentence are offered as a choice, never picked", () => {
    render(<DescribeEntry complaints={[...COMPLAINTS, { key: "fever", label: "Fever" }]} table={SIGNED_TABLE} onChoose={onChoose} onDanger={onDanger} />);
    type("headache and my body is hot");
    expect(screen.getByText(t("symptom.describe.ambiguous"))).toBeTruthy();
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fever" }));
    expect(onChoose).toHaveBeenCalledWith("fever");
  });

  it("no match, and an unsigned table, send the person to the checklist with words that are not reassurance", () => {
    render(<DescribeEntry complaints={COMPLAINTS} table={null} onChoose={onChoose} onDanger={onDanger} />);
    type("I have a terrible headache");
    expect(screen.getByText(t("symptom.describe.no_match"))).toBeTruthy();
    expect(t("symptom.describe.no_match")).toMatch(/does not mean that all is well/);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("an unsigned table still screens for danger", () => {
    render(<DescribeEntry complaints={COMPLAINTS} table={null} onChoose={onChoose} onDanger={onDanger} />);
    type("I cannot breathe");
    expect(onDanger).toHaveBeenCalled();
  });

  it("does not store, send or log what was typed", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const fetchSpy = jest.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const logs = [jest.spyOn(console, "log"), jest.spyOn(console, "info"), jest.spyOn(console, "warn"), jest.spyOn(console, "error")];
    try {
      render(<DescribeEntry complaints={COMPLAINTS} table={SIGNED_TABLE} onChoose={onChoose} onDanger={onDanger} />);
      type("xyzzy-private-words headache");
      type("xyzzy-private-words I fainted");
      expect(setItem).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const l of logs) expect(JSON.stringify(l.mock.calls)).not.toContain("xyzzy");
      expect(document.cookie).not.toContain("xyzzy");
    } finally {
      globalThis.fetch = original;
      setItem.mockRestore();
      for (const l of logs) l.mockRestore();
    }
  });

  it("the typed words are not in the page once used", () => {
    render(<DescribeEntry complaints={COMPLAINTS} table={SIGNED_TABLE} onChoose={onChoose} onDanger={onDanger} />);
    type("xyzzy-private-words headache");
    expect(document.body.innerHTML).not.toContain("xyzzy");
  });
});

describe("SafetyNetBlock", () => {
  it("always shows the generic safety net, even with no config", () => {
    render(<SafetyNetBlock pathwayKey="headache" category="routine" config={null} />);
    expect(screen.getByText(t("symptom.net.title"))).toBeTruthy();
    expect(screen.getByText(t("symptom.net.generic.worse"))).toBeTruthy();
    expect(screen.getByText(t("symptom.net.nearest"))).toBeTruthy();
  });

  it("an unsigned config adds nothing; a signed one adds the pathway's lines; the number needs a signature AND a confirmation", () => {
    const { rerender } = render(<SafetyNetBlock pathwayKey="headache" category="routine" config={null} />);
    expect(screen.queryByText("you lose some of your vision")).toBeNull();
    const signed = safetyNetConfigSchema.parse(sign(SAFETY_NET_DRAFT));
    rerender(<SafetyNetBlock pathwayKey="headache" category="routine" config={signed} />);
    expect(screen.getByText("you lose some of your vision")).toBeTruthy();
    expect(screen.queryByText(/112/)).toBeNull();
    rerender(<SafetyNetBlock pathwayKey="headache" category="routine" config={{ ...signed, emergency_number: { value: "112", confirmed: true } }} />);
    expect(screen.getByText(t("symptom.net.number", "en", { number: "112" }))).toBeTruthy();
  });

  it("invents no helpline number", () => {
    render(<SafetyNetBlock pathwayKey="chest_pain" category="urgent" config={safetyNetConfigSchema.parse(sign(SAFETY_NET_DRAFT))} />);
    expect(document.body.textContent ?? "").not.toMatch(/\d{3}/);
  });
});

describe("WhyThisResult", () => {
  it("shows reasons and the person's own answers, and nothing like a ranking", () => {
    const config = explainerConfigSchema.parse(sign(EXPLAINER_DRAFT));
    const explanation = explainResult(
      {
        firedRuleKeys: ["headache.thunderclap_onset"],
        outcomeKey: null,
        tightenedBy: [],
        questionsAsked: [],
        capture: { presentingComplaintKey: "headache", onset: "sudden", severity: 9, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} },
        ruleConditions: { "headache.thunderclap_onset": { onset: "sudden", minSeverity: 8 } },
      },
      config,
    )!;
    render(<WhyThisResult explanation={explanation} />);
    expect(screen.getByText(t("symptom.why.title"))).toBeTruthy();
    expect(screen.getByText(/came on suddenly and is very strong/)).toBeTruthy();
    expect(screen.getByText(t("symptom.why.fact.onset.sudden"))).toBeTruthy();
    expect(screen.getByText(t("symptom.why.fact.severity", "en", { n: 9 }))).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/probab|likely|chance|%|rank|diagnos/i);
  });

  it("the engine produces nothing for an unsigned explainer, so the section is never rendered for it", () => {
    expect(
      explainResult(
        { firedRuleKeys: ["headache.thunderclap_onset"], outcomeKey: null, tightenedBy: [], questionsAsked: [], capture: { presentingComplaintKey: "headache", onset: "sudden", severity: 9, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} } },
        EXPLAINER_DRAFT,
      ),
    ).toBeNull();
  });
});

describe("SaveCardPanel (shared-phone safe)", () => {
  const writeText = jest.fn<(s: string) => Promise<void>>();
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("shows the plain text on request and writes nothing anywhere by itself", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    render(<SaveCardPanel text={"My symptom check\nBe seen soon"} onClear={() => undefined} />);
    expect(screen.queryByTestId("save-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.open") }));
    expect(screen.getByTestId("save-card").textContent).toContain("My symptom check");
    expect(setItem).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByText(t("symptom.card.shared_phone"))).toBeTruthy();
    setItem.mockRestore();
  });

  it("copy puts the card on the clipboard; clear removes it, overwrites the clipboard, and hands control back", async () => {
    const onClear = jest.fn();
    render(<SaveCardPanel text="the card" onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.open") }));
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.copy") }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("the card"));
    await waitFor(() => expect(screen.getByRole("button", { name: t("symptom.card.copied") })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.clear") }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(""));
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("save-card")).toBeNull());
  });

  it("clear without a copy does not touch the clipboard", async () => {
    const onClear = jest.fn();
    render(<SaveCardPanel text="the card" onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.clear") }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("a blocked clipboard does not break the screen", async () => {
    writeText.mockRejectedValue(new Error("blocked"));
    render(<SaveCardPanel text="the card" onClear={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.open") }));
    fireEvent.click(screen.getByRole("button", { name: t("symptom.card.copy") }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByTestId("save-card").textContent).toContain("the card");
  });
});
