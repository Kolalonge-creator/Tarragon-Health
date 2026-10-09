/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { AppealQueue } from "./appeal-queue";
import { SampleQueue } from "./sample-queue";
import { DisplayNameForm } from "./display-name-form";
import { ModerationQueue } from "./moderation-queue";
import type { AppealItem, ModItem, SampleItem } from "@/lib/community/model";

const removal: AppealItem = {
  appeal_id: "11111111-1111-4111-8111-111111111111",
  kind: "removal",
  group_name: "Living with diabetes",
  created_at: "2026-10-09T10:00:00Z",
  member_says: "I was only sharing what helped me.",
  original_reason_code: "medical_advice",
  sanction_kind: null,
  author_handle: "QuietHeron42",
  body: "Stop your tablets, this works better.",
};
const sanction: AppealItem = { ...removal, appeal_id: "22222222-2222-4222-8222-222222222222", kind: "sanction", sanction_kind: "mute", author_handle: null, body: null };
const goneBody: AppealItem = { ...removal, appeal_id: "33333333-3333-4333-8333-333333333333", body: null };
const ok = { ok: true, message: "Decision upheld." };

describe("AppealQueue", () => {
  it("has no axe violations (cards, empty, confirm step)", async () => {
    const { container } = await expectNoA11yViolations(<AppealQueue items={[removal, sanction, goneBody]} onDecide={jest.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reverse the decision" })[0]);
    expect(await axe(container)).toHaveNoViolations();
    await expectNoA11yViolations(<AppealQueue items={[]} onDecide={jest.fn()} />);
  });

  it("shows the member's words, the reason and the post, and no identity", () => {
    const { container } = render(<AppealQueue items={[removal, sanction, goneBody]} onDecide={jest.fn()} />);
    expect(screen.getAllByText("I was only sharing what helped me.").length).toBe(3);
    expect(screen.getAllByText(/Medical advice or telling others to change a medicine/).length).toBeGreaterThan(0);
    expect(screen.getByText("Stop your tablets, this works better.")).toBeTruthy();
    expect(screen.getByText(/Mute \(cannot post for a while\)/)).toBeTruthy();
    expect(screen.getByText("The text of this post is no longer kept.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/@|\+234|profile/i);
  });

  it("upholds straight away, sending the note", async () => {
    const onDecide = jest.fn().mockResolvedValue(ok);
    render(<AppealQueue items={[removal]} onDecide={onDecide} />);
    fireEvent.change(screen.getByLabelText(/Note \(optional/), { target: { value: "  Clear breach  " } });
    fireEvent.click(screen.getByRole("button", { name: "Uphold the decision" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ appealId: removal.appeal_id, decision: "uphold", note: "Clear breach" }));
    expect(await screen.findByText(/Decision upheld\./)).toBeTruthy();
  });

  it("asks before reversing, and going back sends nothing", async () => {
    const onDecide = jest.fn().mockResolvedValue({ ok: true, message: "Decision reversed." });
    render(<AppealQueue items={[removal]} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: "Reverse the decision" }));
    expect(screen.getByText(/Reversing puts the post back/)).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reverse the decision" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reverse it" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ appealId: removal.appeal_id, decision: "overturn" }));
  });

  it("explains a sanction reversal differently", () => {
    render(<AppealQueue items={[sanction]} onDecide={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reverse the decision" }));
    expect(screen.getByText(/lifts the sanction/)).toBeTruthy();
  });

  it("shows a refusal and a thrown error in plain words", async () => {
    const onDecide = jest.fn().mockResolvedValueOnce({ ok: false, message: "This appeal has already been decided." }).mockRejectedValueOnce(new Error("db exploded: relation x"));
    render(<AppealQueue items={[removal]} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: "Uphold the decision" }));
    expect((await screen.findByText(/Not done/)).textContent).toBe("Not done: This appeal has already been decided.");
    fireEvent.click(screen.getByRole("button", { name: "Uphold the decision" }));
    await waitFor(() => expect(screen.getByText(/Not done/).textContent).toBe("Not done: That could not be done. Please try again."));
  });

  it("has a calm empty state", () => {
    render(<AppealQueue items={[]} onDecide={jest.fn()} />);
    expect(screen.getByText("No appeals are waiting for you.")).toBeTruthy();
  });
});

const sample: SampleItem = {
  sample_id: "44444444-4444-4444-8444-444444444444",
  decision: "removed",
  group_name: "Living with diabetes",
  author_handle: "SoftMango7",
  body: "Buy my herbal tea.",
  reason_code: "selling",
  created_at: "2026-10-09T10:00:00Z",
};
const approved: SampleItem = { ...sample, sample_id: "55555555-5555-4555-8555-555555555555", decision: "approved", reason_code: null, body: null };

describe("SampleQueue", () => {
  it("has no axe violations", async () => {
    await expectNoA11yViolations(<SampleQueue items={[sample, approved]} onReview={jest.fn()} />);
    await expectNoA11yViolations(<SampleQueue items={[]} onReview={jest.fn()} />);
  });

  it("shows the decision, the reason and no identity", () => {
    const { container } = render(<SampleQueue items={[sample, approved]} onReview={jest.fn()} />);
    expect(screen.getByText(/the post was removed\. Reason: Selling or promoting/)).toBeTruthy();
    expect(screen.getByText(/the post was approved/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/@|\+234|profile/i);
  });

  it("needs a choice, then saves agreement with the note", async () => {
    const onReview = jest.fn().mockResolvedValue({ ok: true, message: "Thank you." });
    render(<SampleQueue items={[sample]} onReview={onReview} />);
    fireEvent.click(screen.getByRole("button", { name: "Save my answer" }));
    expect(screen.getByRole("alert").textContent).toBe("Please choose whether you agree.");
    expect(onReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("I do not agree"));
    fireEvent.change(screen.getByLabelText(/Note \(optional/), { target: { value: " Too strict " } });
    fireEvent.click(screen.getByRole("button", { name: "Save my answer" }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({ sampleId: sample.sample_id, agrees: false, note: "Too strict" }));
    expect(await screen.findByText(/Thank you\./)).toBeTruthy();
  });

  it("sends agreement without a note", async () => {
    const onReview = jest.fn().mockResolvedValue({ ok: true, message: "Thank you." });
    render(<SampleQueue items={[sample]} onReview={onReview} />);
    fireEvent.click(screen.getByLabelText("I agree"));
    fireEvent.click(screen.getByRole("button", { name: "Save my answer" }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({ sampleId: sample.sample_id, agrees: true }));
  });

  it("shows a thrown error in plain words", async () => {
    const onReview = jest.fn().mockRejectedValue(new Error("relation x"));
    render(<SampleQueue items={[sample]} onReview={onReview} />);
    fireEvent.click(screen.getByLabelText("I agree"));
    fireEvent.click(screen.getByRole("button", { name: "Save my answer" }));
    expect((await screen.findByText(/Not done/)).textContent).toBe("Not done: That could not be done. Please try again.");
  });
});

describe("DisplayNameForm", () => {
  it("has no axe violations, including with an error showing", async () => {
    const { container } = await expectNoA11yViolations(<DisplayNameForm onSave={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Name members will see"), { target: { value: "Ada 7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains what members see and that nothing shows until chosen", () => {
    render(<DisplayNameForm onSave={jest.fn()} />);
    expect(screen.getByText(/members see it and your role at the top of the groups you are assigned to/)).toBeTruthy();
    expect(screen.getByText(/Nothing shows until you choose a name/)).toBeTruthy();
  });

  it("refuses numbers before calling the action, and saves a valid or empty name", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true, message: "Saved." });
    render(<DisplayNameForm onSave={onSave} />);
    const input = screen.getByLabelText("Name members will see");
    fireEvent.change(input, { target: { value: "Ada 7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/No numbers/);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " Ada O. " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: "Ada O." }));
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ name: "" }));
  });
});

const item: ModItem = {
  post_id: "66666666-6666-4666-8666-666666666666",
  group_id: "77777777-7777-4777-8777-777777777777",
  group_name: "Living with diabetes",
  author_handle: "QuietHeron42",
  is_reply: false,
  body: "I have stopped eating most days.",
  state: "held",
  reasons: ["eating_disorder"],
  created_at: "2026-10-09T10:00:00Z",
  report_count: 0,
  report_reasons: [],
  author_is_new: false,
};

describe("ModerationQueue send to a safety reviewer", () => {
  const ui = (onDecide = jest.fn().mockResolvedValue({ ok: true, message: "Sent." })) => ({ onDecide, ui: <ModerationQueue items={[item]} onDecide={onDecide} onSanction={jest.fn()} /> });

  it("has no axe violations with the confirm step open", async () => {
    const { container } = await expectNoA11yViolations(ui().ui);
    fireEvent.click(screen.getByRole("button", { name: "Send to a safety reviewer" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the eating-disorder hint in words, and a readable reason", () => {
    render(ui().ui);
    expect(screen.getByText("Possible eating-disorder wording. If you are worried about the writer, send it to a safety reviewer.")).toBeTruthy();
    expect(screen.getByText("Possible eating-disorder wording")).toBeTruthy();
    expect(screen.queryByText("eating_disorder")).toBeNull();
  });

  it("shows no hint for other reasons", () => {
    render(<ModerationQueue items={[{ ...item, reasons: ["commerce"] }]} onDecide={jest.fn()} onSanction={jest.fn()} />);
    expect(screen.queryByText(/Possible eating-disorder wording/)).toBeNull();
  });

  it("explains, asks first, and only then sends", async () => {
    const { onDecide, ui: el } = ui();
    render(el);
    fireEvent.click(screen.getByRole("button", { name: "Send to a safety reviewer" }));
    expect(screen.getByText(/From then on only a safety reviewer can see it/)).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send to a safety reviewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it to a safety reviewer" }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ postId: item.post_id, decision: "send_to_safety" }));
  });
});
