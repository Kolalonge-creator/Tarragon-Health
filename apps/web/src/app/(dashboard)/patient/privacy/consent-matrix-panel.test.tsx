/** @jest-environment jsdom */
/**
 * Consent matrix panel (S42): a needed-for-care cell has no switch, an optional cell takes two taps to turn off, a bundle
 * shows its state, and "switch off everything optional" is two taps and only offered when something optional is on.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONSENT_DATA_TYPES, CONSENT_PURPOSES, type ConsentMatrix } from "@tarragon/shared";
import { ConsentMatrixPanel } from "./consent-matrix-panel";

const setCell = jest.fn();
const applyBundle = jest.fn();
const withdrawAll = jest.fn();
jest.mock("./consent-matrix-actions", () => ({
  setConsentCellAction: (...a: unknown[]) => setCell(...a),
  applyConsentBundleAction: (...a: unknown[]) => applyBundle(...a),
  withdrawAllOptionalConsentsAction: (...a: unknown[]) => withdrawAll(...a),
}));

function matrix(on: Array<[string, string]> = []): ConsentMatrix {
  return {
    cells: CONSENT_DATA_TYPES.flatMap((data_type) =>
      CONSENT_PURPOSES.map((purpose) => ({
        data_type,
        purpose,
        required_for_care: purpose === "care",
        sensitive: data_type === "reproductive" || data_type === "mental_health",
        text_key: `consent.matrix.${data_type}.${purpose}`,
        wording_status: "draft_pending_counsel" as const,
        granted: purpose === "care" || on.some(([d, p]) => d === data_type && p === purpose),
        changed_at: null,
      })),
    ),
    bundles: [
      { code: "help_research", text_key: "consent.bundle.help_research", cells: [{ data_type: "vitals", purpose: "research" }, { data_type: "documents", purpose: "research" }] },
    ],
  };
}

beforeEach(() => {
  setCell.mockReset().mockResolvedValue({ ok: true });
  applyBundle.mockReset().mockResolvedValue({ ok: true });
  withdrawAll.mockReset().mockResolvedValue({ ok: true });
});

describe("ConsentMatrixPanel", () => {
  it("says the wording is a draft", () => {
    render(<ConsentMatrixPanel matrix={matrix()} history={[]} />);
    expect(screen.getByText(/waiting for legal review/i)).toBeTruthy();
  });

  it("simple view: a bundle can be turned on with one tap", async () => {
    render(<ConsentMatrixPanel matrix={matrix()} history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /turn on/i }));
    await waitFor(() => expect(applyBundle).toHaveBeenCalledWith({ code: "help_research" }));
  });

  it("advanced view: needed-for-care cells show a badge and no switch", () => {
    render(<ConsentMatrixPanel matrix={matrix()} history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /every choice/i }));
    expect(screen.getAllByText(/needed for your care/i)).toHaveLength(5);
    // 15 optional cells, each with a Turn on button; no care cell has one
    expect(screen.getAllByRole("button", { name: /^turn on$/i })).toHaveLength(15);
  });

  it("turning an optional cell off takes two taps", async () => {
    render(<ConsentMatrixPanel matrix={matrix([["vitals", "research"]])} history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /every choice/i }));
    fireEvent.click(screen.getByRole("button", { name: /^turn off$/i }));
    expect(setCell).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /yes, turn off/i }));
    await waitFor(() => expect(setCell).toHaveBeenCalledWith({ dataType: "vitals", purpose: "research", granted: false }));
  });

  it("shows the database's refusal instead of pretending it worked", async () => {
    setCell.mockResolvedValue({ error: "This one is needed to give you care." });
    render(<ConsentMatrixPanel matrix={matrix([["vitals", "research"]])} history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /every choice/i }));
    fireEvent.click(screen.getByRole("button", { name: /^turn off$/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, turn off/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/needed to give you care/i);
  });

  it("offers 'switch off everything optional' only when something optional is on, in two taps", async () => {
    const { rerender } = render(<ConsentMatrixPanel matrix={matrix()} history={[]} />);
    expect(screen.queryByRole("button", { name: /switch off everything optional/i })).toBeNull();
    rerender(<ConsentMatrixPanel matrix={matrix([["vitals", "research"]])} history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /switch off everything optional/i }));
    expect(withdrawAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /yes, switch them all off/i }));
    await waitFor(() => expect(withdrawAll).toHaveBeenCalled());
  });

  it("lists the history newest first as given", () => {
    render(
      <ConsentMatrixPanel
        matrix={matrix()}
        history={[{ data_type: "vitals", purpose: "research", action: "withdrawn", at: "2026-10-06T10:00:00Z" }]}
      />,
    );
    expect(screen.getByText(/turned off/i)).toBeTruthy();
  });
});
