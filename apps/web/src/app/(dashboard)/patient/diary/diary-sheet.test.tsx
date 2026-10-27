/** @jest-environment jsdom */
/**
 * The paper diary sheet (S07y), as the person meets it. Proves: the typed sheet works with no model; the photo button exists only when the reader is open; a
 * suggested row is never saved until the person ticks that it matches; a row with a problem says why in words; a failed save keeps every row; a saved row
 * leaves the sheet; the wording after saving is the same signed wording a typed reading gets; offline blocks the save and says so.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { activeWording } from "@tarragon/i18n";
import { DiarySheet } from "./diary-sheet";

const saveDiaryAction = jest.fn();
jest.mock("./actions", () => ({ saveDiaryAction: (...a: unknown[]) => saveDiaryAction(...a) }));
let mockOnline = true;
jest.mock("@/lib/network/use-online-status", () => ({ useOnlineStatus: () => mockOnline }));

// the browser's own clock: 2026-10-20 14:00 Lagos
const NOW = Date.UTC(2026, 9, 20, 13, 0);
let uuid = 0;

beforeEach(() => {
  mockOnline = true;
  saveDiaryAction.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  uuid = 0;
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` }, configurable: true });
  global.URL.createObjectURL = jest.fn(() => "blob:diary");
  global.URL.revokeObjectURL = jest.fn();
});
afterEach(() => jest.restoreAllMocks());

function typeRow(sys = "132", dia = "84", date = "2026-10-18", time = "08:30") {
  fireEvent.change(screen.getAllByLabelText("Date")[0] as HTMLElement, { target: { value: date } });
  fireEvent.change(screen.getAllByLabelText("Time")[0] as HTMLElement, { target: { value: time } });
  fireEvent.change(screen.getAllByLabelText("Top number (systolic)")[0] as HTMLElement, { target: { value: sys } });
  fireEvent.change(screen.getAllByLabelText("Bottom number (diastolic)")[0] as HTMLElement, { target: { value: dia } });
}

describe("DiarySheet: typed rows (no model)", () => {
  it("starts with one blank row and nothing to save", () => {
    render(<DiarySheet readerOpen={false} />);
    expect((screen.getByRole("button", { name: "Nothing to save yet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Readings can be dated up to 30 days back/)).toBeTruthy();
  });

  it("says the photo reader is not switched on, and still offers the sheet", () => {
    render(<DiarySheet readerOpen={false} />);
    expect(screen.getByTestId("diary-photo-closed").textContent).toMatch(/not switched on yet/);
    expect(screen.queryByRole("button", { name: /Read a photo of my diary page/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a glucose row" })).toBeTruthy();
  });

  it("offers the photo button when the reader is open", () => {
    render(<DiarySheet readerOpen />);
    expect(screen.getByRole("button", { name: "Read a photo of my diary page" })).toBeTruthy();
    expect(screen.getByText(/not kept/)).toBeTruthy();
  });

  it("a complete row can be saved; only what the server accepts leaves the sheet", async () => {
    saveDiaryAction.mockResolvedValue({ status: "done", results: [{ key: "00000000-0000-4000-8000-000000000001", status: "saved" }], bpAckLevel: "green", safetyAssessmentFailed: false });
    render(<DiarySheet readerOpen={false} />);
    typeRow();
    const save = await screen.findByRole("button", { name: "Save rows (1)" });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByTestId("diary-saved")).toBeTruthy());
    expect(saveDiaryAction).toHaveBeenCalledTimes(1);
    const sent = saveDiaryAction.mock.calls[0]?.[0] as { confirmed: boolean; systolic: string; date: string }[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ confirmed: true, systolic: "132", date: "2026-10-18" });
    expect(screen.getByTestId("diary-saved").textContent).toMatch(/Saved from your diary: 1/);
    expect(screen.getByTestId("diary-saved").textContent).toMatch(/Received by TarragonHealth/);
    // the saved row left; a fresh blank one is there
    expect((screen.getAllByLabelText("Top number (systolic)")[0] as HTMLInputElement).value).toBe("");
  });

  it("a crisis-range value gets the signed emergency wording, the same as a typed reading", async () => {
    saveDiaryAction.mockResolvedValue({ status: "done", results: [{ key: "00000000-0000-4000-8000-000000000001", status: "saved" }], bpAckLevel: "emergency", safetyAssessmentFailed: false });
    render(<DiarySheet readerOpen={false} />);
    typeRow("215", "125");
    fireEvent.click(await screen.findByRole("button", { name: "Save rows (1)" }));
    const note = await screen.findByTestId("diary-saved");
    expect(note.textContent).toContain(activeWording("EMG-001").title);
  });

  it("a safety check that did not finish is said in words, never as a plain 'saved'", async () => {
    saveDiaryAction.mockResolvedValue({ status: "done", results: [{ key: "00000000-0000-4000-8000-000000000001", status: "saved" }], bpAckLevel: "unknown", safetyAssessmentFailed: true });
    render(<DiarySheet readerOpen={false} />);
    typeRow();
    fireEvent.click(await screen.findByRole("button", { name: "Save rows (1)" }));
    const note = await screen.findByTestId("diary-saved");
    expect(note.textContent).toMatch(/could not finish checking them against your care protocols/);
  });

  it("a failed save keeps every row and says so", async () => {
    saveDiaryAction.mockResolvedValue({ status: "failed" });
    render(<DiarySheet readerOpen={false} />);
    typeRow();
    fireEvent.click(await screen.findByRole("button", { name: "Save rows (1)" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/We could not save that. Your rows are still here/)).toBeTruthy();
    expect((screen.getAllByLabelText("Top number (systolic)")[0] as HTMLInputElement).value).toBe("132");
  });

  it("a held value stays with the plain explanation; a saved one beside it is gone", async () => {
    render(<DiarySheet readerOpen={false} />);
    typeRow();
    fireEvent.click(screen.getByRole("button", { name: "Add a blood pressure row" }));
    fireEvent.change(screen.getAllByLabelText("Date")[1] as HTMLElement, { target: { value: "2026-10-19" } });
    fireEvent.change(screen.getAllByLabelText("Time")[1] as HTMLElement, { target: { value: "20:00" } });
    fireEvent.change(screen.getAllByLabelText("Top number (systolic)")[1] as HTMLElement, { target: { value: "120" } });
    fireEvent.change(screen.getAllByLabelText("Bottom number (diastolic)")[1] as HTMLElement, { target: { value: "80" } });
    saveDiaryAction.mockResolvedValue({
      status: "done",
      results: [
        { key: "00000000-0000-4000-8000-000000000001", status: "held" },
        { key: "00000000-0000-4000-8000-000000000002", status: "saved" },
      ],
      bpAckLevel: "green",
      safetyAssessmentFailed: false,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save rows (2)" }));
    expect(await screen.findByText(/does not look possible/)).toBeTruthy();
    expect(screen.getAllByLabelText("Top number (systolic)")).toHaveLength(1);
    expect(screen.getByTestId("diary-saved").textContent).toMatch(/Saved: 1\. Not saved: 1/);
  });

  it("a row that matched a reading already in the record leaves the sheet, and the person is told why", async () => {
    saveDiaryAction.mockResolvedValue({ status: "done", results: [{ key: "00000000-0000-4000-8000-000000000001", status: "merged" }], safetyAssessmentFailed: false });
    render(<DiarySheet readerOpen={false} />);
    typeRow();
    fireEvent.click(await screen.findByRole("button", { name: "Save rows (1)" }));
    const note = await screen.findByTestId("diary-saved");
    expect(note.textContent).toMatch(/Matched a reading already in your record from your device, so not added again: 1/);
    expect((screen.getAllByLabelText("Top number (systolic)")[0] as HTMLInputElement).value).toBe("");
  });

  it("explains a problem in words and does not offer to save the row", () => {
    render(<DiarySheet readerOpen={false} />);
    typeRow("80", "130");
    expect(screen.getByTestId("diary-row-problems").textContent).toMatch(/top number should be bigger than the bottom one/);
    expect((screen.getByRole("button", { name: "Nothing to save yet" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a date outside the window says how far back it can go, and the offline state blocks saving in words", () => {
    render(<DiarySheet readerOpen={false} />);
    typeRow("132", "84", "2026-08-01");
    expect(screen.getByTestId("diary-row-problems").textContent).toMatch(/more than 30 days ago/);
    mockOnline = false;
    render(<DiarySheet readerOpen={false} />);
    expect(screen.getAllByText(/You need a connection to save diary readings/).length).toBeGreaterThan(0);
  });

  it("a row can be removed, and the sheet is never left with no row at all", () => {
    render(<DiarySheet readerOpen={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove this row" }));
    expect(screen.getAllByLabelText("Date")).toHaveLength(1);
  });

  it("a glucose row asks for its unit and when it was taken, and never guesses either", () => {
    render(<DiarySheet readerOpen={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a glucose row" }));
    expect(screen.getByLabelText("Unit")).toBeTruthy();
    expect(screen.getByLabelText("When it was taken")).toBeTruthy();
    expect((screen.getByLabelText("Unit") as HTMLSelectElement).value).toBe("");
  });
});

describe("DiarySheet: a photo suggests rows, the person decides", () => {
  const suggested = {
    status: "suggested",
    skipped: 0,
    rows: [
      { key: "99999999-9999-4999-8999-999999999991", kind: "blood_pressure", date: "2026-10-18", time: "08:30", systolic: "132", diastolic: "84", pulse: "", glucose: "", glucoseUnit: "", glucoseContext: "", suggested: true, confirmed: false },
    ],
  };

  async function pickPhoto() {
    const input = document.getElementById("diary-photo") as HTMLInputElement;
    const file = new File([new Uint8Array(10)], "page.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  }

  it("shows the suggestion unchecked, next to the person's own photo, and will not save it until it is ticked", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => suggested })) as never;
    render(<DiarySheet readerOpen />);
    await pickPhoto();
    expect(await screen.findByText(/Rows found on your page: 1/)).toBeTruthy();
    expect(screen.getByText(/Suggested from your photo/)).toBeTruthy();
    expect(screen.getByAltText("Your diary page")).toBeTruthy();
    const nothing = screen.getByRole("button", { name: "Nothing to save yet" }) as HTMLButtonElement;
    expect(nothing.disabled).toBe(true);
    expect(screen.getByText(/Suggested rows not checked yet: 1\. They will not be saved\./)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("This row matches my diary"));
    expect((await screen.findByRole("button", { name: "Save rows (1)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("editing a suggested row makes the person check it again", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => suggested })) as never;
    render(<DiarySheet readerOpen />);
    await pickPhoto();
    await screen.findByText(/Rows found on your page: 1/);
    const box = screen.getByLabelText("This row matches my diary") as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Top number (systolic)"), { target: { value: "138" } });
    expect((screen.getByLabelText("This row matches my diary") as HTMLInputElement).checked).toBe(false);
  });

  it.each([
    [{ status: "unavailable" }, /Reading photos is not available just now/],
    [{ status: "not_open" }, /not switched on yet/],
    [{ status: "unreadable" }, /could not be read clearly/],
    [{ status: "rate_limited" }, /sent a lot of photos/],
    [{ status: "bad_file", reason: "too_big" }, /too large/],
  ])("answers %j in words and leaves the sheet to type into", async (body, text) => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => body })) as never;
    render(<DiarySheet readerOpen />);
    await pickPhoto();
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    expect(screen.getAllByLabelText("Date")).toHaveLength(1);
  });

  it("a dropped connection while reading says so and keeps the sheet", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as never;
    render(<DiarySheet readerOpen />);
    await pickPhoto();
    expect(await screen.findByText(/We could not read that photo/)).toBeTruthy();
  });

  it("refuses a file that is not a photo before it is sent anywhere", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    render(<DiarySheet readerOpen />);
    await act(async () => {
      fireEvent.change(document.getElementById("diary-photo") as HTMLInputElement, { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    });
    expect(await screen.findByText(/Please choose a photo/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
