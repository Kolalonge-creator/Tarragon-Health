/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { GroupRulesApproval, RuleSetActivation, SafetyRulesEditor } from "./cmo-panels";
import { NotesPanel, type NoteRow } from "./notes-panel";
import type { AdminGroup, Rule, RuleSet } from "@/lib/community/model";

const ok = { ok: true, message: "Done." };

const group: AdminGroup = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "s",
  name: "Heart health",
  description: "d",
  topic_code: "t",
  topic_label: "T",
  requires_cmo_rules: true,
  rules_text: "Be kind.",
  rules_version: 2,
  rules_approved: false,
  rules_approved_at: null,
  join_mode: "open",
  status: "draft",
  created_at: "2026-10-01T00:00:00Z",
  member_count: 0,
  held_posts: 0,
  open_reports: 0,
  open_signals: 0,
};
const draft: RuleSet = { version: 2, status: "draft", params: {}, notes: null, approved_at: null, rule_count: 5, safety_rule_count: 1 };
const live: RuleSet = { version: 1, status: "active", params: {}, notes: null, approved_at: "2026-09-01T00:00:00Z", rule_count: 5, safety_rule_count: 2 };
const rule: Rule = { id: 7, class: "emergency", kind: "regex", pattern: "\\ychest pain\\y", action: "safety", note: null };

describe("CMO panels", () => {
  it("have no axe violations", async () => {
    await expectNoA11yViolations(<GroupRulesApproval groups={[group]} onApproveGroupRules={jest.fn()} />);
    await expectNoA11yViolations(<GroupRulesApproval groups={[]} onApproveGroupRules={jest.fn()} />);
    await expectNoA11yViolations(
      <SafetyRulesEditor draft={draft} rules={[rule]} otherRuleCount={4} onSaveRule={jest.fn()} onDeleteRule={jest.fn()} onCreateDraft={jest.fn()} />,
    );
    await expectNoA11yViolations(
      <SafetyRulesEditor draft={null} rules={[]} otherRuleCount={0} onSaveRule={jest.fn()} onDeleteRule={jest.fn()} onCreateDraft={jest.fn()} />,
    );
    await expectNoA11yViolations(<RuleSetActivation sets={[draft, live]} onActivate={jest.fn()} />);
  });

  it("approves group rules for the version shown", async () => {
    const fn = jest.fn().mockResolvedValue(ok);
    render(<GroupRulesApproval groups={[group]} onApproveGroupRules={fn} />);
    expect(screen.getByText("Be kind.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve these rules" }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith({ groupId: group.id, rulesVersion: 2 }));
  });

  it("refuses an empty pattern before calling, then saves, and states the rules are the CMO's alone", async () => {
    const onSave = jest.fn().mockResolvedValue(ok);
    const { container } = render(
      <SafetyRulesEditor draft={draft} rules={[rule]} otherRuleCount={4} onSaveRule={onSave} onDeleteRule={jest.fn()} onCreateDraft={jest.fn()} />,
    );
    expect(container.textContent).toContain("Nobody else can write or remove them");
    expect(container.textContent).toContain("word");
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(screen.getByRole("alert").textContent).toBe("Please write a pattern.");
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "  \\ywant to die\\y " } });
    fireEvent.change(screen.getByLabelText("Kind of rule"), { target: { value: "self_harm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ version: 2, ruleClass: "self_harm", pattern: "\\ywant to die\\y" }));
  });

  it("asks before removing a rule", async () => {
    const onDelete = jest.fn().mockResolvedValue(ok);
    render(<SafetyRulesEditor draft={draft} rules={[rule]} otherRuleCount={0} onSaveRule={jest.fn()} onDeleteRule={onDelete} onCreateDraft={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ ruleId: 7 }));
  });

  it("explains the consequences before making a set live, and shows when the live one was approved", async () => {
    const onActivate = jest.fn().mockResolvedValue(ok);
    const { container } = render(<RuleSetActivation sets={[draft, live]} onActivate={onActivate} />);
    expect(container.textContent).toContain("Live now: version 1, approved on");
    fireEvent.click(screen.getByRole("button", { name: "Make version 2 live" }));
    expect(container.textContent).toContain("replaces the live version straight away");
    expect(container.textContent).toContain("both emergency and self-harm rules");
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, make version 2 live" }));
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith({ version: 2 }));
  });
});

const notes: NoteRow[] = [
  { id: "a", title: "From a colleague", body: "Walk daily.", authored_by_name: "Dr Ada", reviewed_by_name: null, reviewed_at: null, is_mine: false },
  { id: "b", title: "Mine", body: "Eat well.", authored_by_name: "Dr Me", reviewed_by_name: null, reviewed_at: null, is_mine: true },
  { id: "c", title: "Done", body: "Sleep.", authored_by_name: "Dr Me", reviewed_by_name: "Dr Bo", reviewed_at: "2026-10-05T09:00:00Z", is_mine: true },
  { id: "d", title: "Half", body: "x", authored_by_name: "Dr Z", reviewed_by_name: "Dr Bo", reviewed_at: null, is_mine: false },
];

describe("NotesPanel", () => {
  it("has no axe violations", async () => {
    await expectNoA11yViolations(<NotesPanel groupId="g" notes={notes} onPin={jest.fn()} onReview={jest.fn()} />);
  });

  it("only offers Review on other clinicians' unreviewed notes and never invents attribution", async () => {
    const onReview = jest.fn().mockResolvedValue(ok);
    const { container } = render(<NotesPanel groupId="g" notes={notes} onPin={jest.fn()} onReview={onReview} />);
    // "a" and "d" are waiting (d has a name but no time, so it is NOT treated as reviewed).
    expect(screen.getAllByRole("button", { name: "Review this note" })).toHaveLength(2);
    expect(container.textContent).toContain("Reviewed by Dr Bo on 5 Oct 2026");
    expect(container.textContent).not.toMatch(/Reviewed by Dr Bo on\s*$/);
    expect(container.textContent?.match(/Not yet reviewed/g)?.length).toBe(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Review this note" })[0]);
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({ id: "a" }));
  });

  it("requires a title and text before saving a note", async () => {
    const onPin = jest.fn().mockResolvedValue(ok);
    render(<NotesPanel groupId="g" notes={[]} onPin={onPin} onReview={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(screen.getByRole("alert").textContent).toMatch(/title and some text/);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello there" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Some words" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(onPin).toHaveBeenCalledWith({ groupId: "g", title: "Hello there", body: "Some words" }));
  });
});
