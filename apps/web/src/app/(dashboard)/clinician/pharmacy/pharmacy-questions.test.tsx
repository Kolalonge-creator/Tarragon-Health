/** @jest-environment jsdom */
/**
 * S28 (OQ-269): the prescriber's page. A pharmacy's question is answered from a fixed list only, an answer says it changes nothing,
 * an already-answered question shows its answer, and where each prescription has got to is listed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y";
import { PharmacyQuestions } from "./pharmacy-questions";
import type { PrescriberOverview } from "@/lib/pharmacy-collection/model";

jest.setTimeout(30000); // the suite runs in parallel in CI; the 5 s default flaked under load
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const answerPharmacyQuestion = jest.fn();
jest.mock("@/lib/pharmacy-collection/prescriber-actions", () => ({ answerPharmacyQuestion: (...a: unknown[]) => answerPharmacyQuestion(...a) }));

const Q1 = "7a4e2c1b-5d3f-4e8a-b6c9-0f1e2d3c4b5a";
const Q2 = "8b5f3d2c-6e4a-4f9b-87da-1a2f3e4d5c6b";
const RX = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const OVERVIEW: PrescriberOverview = {
  questions: [
    { question_id: Q1, prescription_id: RX, asked_at: "2026-10-07T09:00:00Z", pharmacy_name: "Yaba Pharmacy", reason_code: "dose_unclear", patient_name: "Ada Obi", medicines: ["Amlodipine"], answered_at: null, answer_code: null },
    { question_id: Q2, prescription_id: RX, asked_at: "2026-10-06T09:00:00Z", pharmacy_name: "Yaba Pharmacy", reason_code: "call_me", patient_name: "Ada Obi", medicines: ["Amlodipine"], answered_at: "2026-10-06T10:00:00Z", answer_code: "keep_as_written" },
  ],
  collection: [{ prescription_id: RX, state: "sent", patient_name: "Ada Obi", sent_at: "2026-10-07T08:00:00Z", dispensed_at: null, pharmacy_name: "Yaba Pharmacy", medicines: ["Amlodipine"] }],
  earlier: [{ flag_id: Q2, patient_name: "Ada Obi", pharmacy_name: "Yaba Pharmacy", kind: "query_to_prescriber", reason: "Is this the right strength for her?", created_at: "2026-10-01T09:00:00Z", items: [{ drug: "Amlodipine", dose: "5 mg" }] }],
};

beforeEach(() => {
  refresh.mockReset();
  answerPharmacyQuestion.mockReset().mockResolvedValue({ ok: true });
});

describe("PharmacyQuestions", () => {
  it("shows an open question in plain words and offers only the three fixed answers (no text box)", () => {
    render(<PharmacyQuestions overview={OVERVIEW} />);
    expect(screen.getByText(/Yaba Pharmacy asks: The dose or directions are unclear/)).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Supply it as written", "A new prescription is coming", "The patient will be asked to contact the care team",
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/does not change the prescription/)).toBeTruthy();
  });

  it("answers with the chosen code and refreshes", async () => {
    render(<PharmacyQuestions overview={OVERVIEW} />);
    fireEvent.click(screen.getByRole("button", { name: "A new prescription is coming" }));
    await waitFor(() => expect(answerPharmacyQuestion).toHaveBeenCalledWith({ flagId: Q1, answer: "new_prescription_coming" }), { timeout: 5000 });
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 5000 });
  });

  it("shows a refusal instead of pretending it was answered", async () => {
    answerPharmacyQuestion.mockResolvedValue({ ok: false, error: "That question has already been answered." });
    render(<PharmacyQuestions overview={OVERVIEW} />);
    fireEvent.click(screen.getByRole("button", { name: "Supply it as written" }));
    await screen.findByText("That question has already been answered.", undefined, { timeout: 5000 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("an answered question shows its answer and no buttons; collection state is listed", () => {
    render(<PharmacyQuestions overview={{ ...OVERVIEW, questions: [OVERVIEW.questions[1]!] }} />);
    expect(screen.getByText(/Supply it as written/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/Waiting at Yaba Pharmacy since/)).toBeTruthy();
    expect(screen.getByText(/any other pharmacy/)).toBeTruthy();
  });

  it("says so calmly when there is nothing", () => {
    render(<PharmacyQuestions overview={{ questions: [], collection: [], earlier: [] }} />);
    expect(screen.getByText("No pharmacy is waiting for an answer from you.")).toBeTruthy();
    expect(screen.getByText("None of your recent prescriptions has been sent to a pharmacy.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(<PharmacyQuestions overview={OVERVIEW} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
