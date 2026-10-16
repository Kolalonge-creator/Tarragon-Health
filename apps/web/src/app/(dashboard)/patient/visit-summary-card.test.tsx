/** @jest-environment jsdom */
/**
 * AVS: the patient card shows the approved text, the checklist and the existing emergency wording; it renders nothing when
 * there is no approved summary, hides the write controls for a read-only (caregiver) view, and never invents urgent text.
 */
import { renderToStaticMarkup } from "react-dom/server";

const summaries = jest.fn();
const mutation = { mutate: jest.fn(), isPending: false, isError: false };
jest.mock("@/lib/queries/patient-visit-summaries", () => ({
  useMyVisitSummaries: (...a: unknown[]) => summaries(...a),
  useSetVisitItemDone: () => mutation,
  useAddVisitItemToTasks: () => mutation,
}));

import { t } from "@tarragon/i18n";
import { VisitSummaryCard } from "./visit-summary-card";

const item = (over: object = {}) => ({ id: "i1", kind: "medicine", params: { drug_name: "Amlodipine", dose: "5 mg" }, custom_text: null, due_on: null, done_at: null, task_id: null, ...over });
const summary = (over: object = {}) => ({
  id: "s1",
  note_id: "n1",
  revision: 1,
  summary_text: "Your blood pressure was a little high today.",
  approved_at: "2026-10-16T09:00:00Z",
  approved_by_name: "Dr Ade",
  items: [item(), item({ id: "i2", kind: "recheck", custom_text: "Check again", due_on: "2026-11-03", done_at: "2026-10-17T08:00:00Z", task_id: "t1" })],
  ...over,
});
const render = (props: { readOnly?: boolean } = {}) => renderToStaticMarkup(<VisitSummaryCard locale="en" patientId="p1" {...props} />);

beforeEach(() => summaries.mockReset());

describe("VisitSummaryCard", () => {
  it("renders nothing when there is no approved summary", () => {
    summaries.mockReturnValue({ data: [], isLoading: false, isError: false });
    expect(render()).toBe("");
  });

  it("shows the text, who checked it, the steps and the existing emergency wording", () => {
    summaries.mockReturnValue({ data: [summary()], isLoading: false, isError: false });
    const html = render();
    expect(html).toContain("Your blood pressure was a little high today.");
    expect(html).toContain("Dr Ade");
    expect(html).toContain("Take Amlodipine 5 mg as prescribed.");
    expect(html).toContain("Check again");
    expect(html).toContain(t("history.unwell", "en"));
    expect(html).toContain(t("avs.urgent.title", "en"));
  });

  it("marks a ticked step checked and shows the task state", () => {
    summaries.mockReturnValue({ data: [summary()], isLoading: false, isError: false });
    const html = render();
    expect(html).toContain(t("avs.item.task_added", "en"));
    expect(html).toContain(t("avs.item.add_task", "en"));
    expect(html.match(/checked=""/g)?.length).toBe(1);
  });

  it("is read only for a caregiver: no add-to-tasks button and the boxes are disabled", () => {
    summaries.mockReturnValue({ data: [summary()], isLoading: false, isError: false });
    const html = render({ readOnly: true });
    expect(html).not.toContain(t("avs.item.add_task", "en"));
    expect(html).toContain("disabled");
    expect(summaries).toHaveBeenCalledWith("p1");
  });

  it("asks for the signed-in person's own summaries (no patient id) when not read only", () => {
    summaries.mockReturnValue({ data: [summary()], isLoading: false, isError: false });
    render();
    expect(summaries).toHaveBeenCalledWith(null);
  });

  it("says a load failure plainly instead of looking empty", () => {
    summaries.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    expect(render()).toContain(t("avs.error.generic", "en"));
  });
});
