/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { SignoffChecklist, type SignoffProps } from "./signoff-checklist";
import type { AdminGroup, Rule, RuleSet } from "@/lib/community/model";

configure({ asyncUtilTimeout: 8000 });

const ok = { ok: true, message: "Done." };
const draft: RuleSet = { version: 2, status: "draft", params: {}, notes: null, approved_at: null, rule_count: 20, safety_rule_count: 2 };
const rules: Rule[] = [
  { id: 1, class: "self_harm", kind: "regex", pattern: "\\ysuicid(?:e|al)\\y", action: "safety", note: "CMO approved" },
  { id: 2, class: "emergency", kind: "regex", pattern: "\\yslurred speech\\y", action: "safety", note: null },
];
const group: AdminGroup = {
  id: "33333333-3333-4333-8333-333333333333", slug: "h", name: "Healthy weight and habits", description: "d", topic_code: "weight_loss", topic_label: "W",
  requires_cmo_rules: true, rules_text: "Be kind.", rules_version: 1, rules_approved: false, rules_approved_at: null, join_mode: "open", status: "draft",
  created_at: "2026-10-01T00:00:00Z", member_count: 0, held_posts: 0, open_reports: 0, open_signals: 0,
};

function props(over: Partial<SignoffProps> = {}): SignoffProps {
  return {
    live: null,
    draft,
    draftSafetyRules: rules,
    waitingGroups: [group],
    attestations: [
      { code: "crisis_owner_named", met: false },
      { code: "consent_text_approved", met: false },
      { code: "clinical_safety_case_current", met: false },
    ],
    consentText: "What the groups are.",
    consentVersion: "v1-test",
    otherConditions: [{ code: "moderation_team_named", label: "A named moderator", met: false, detail: "0 moderators" }],
    onLoadStarter: jest.fn().mockResolvedValue(ok),
    onActivate: jest.fn().mockResolvedValue(ok),
    onApproveGroupRules: jest.fn().mockResolvedValue(ok),
    onAttest: jest.fn().mockResolvedValue(ok),
    ...over,
  };
}

describe("SignoffChecklist", () => {
  it("has no axe violations in the waiting, empty and finished states", async () => {
    await expectNoA11yViolations(<SignoffChecklist {...props()} />);
    await expectNoA11yViolations(<SignoffChecklist {...props({ draft: null, draftSafetyRules: [], waitingGroups: [] })} />);
    await expectNoA11yViolations(
      <SignoffChecklist
        {...props({
          draft: null,
          draftSafetyRules: [],
          waitingGroups: [],
          live: { ...draft, status: "active", approved_at: "2026-10-13T00:00:00Z", approved_by_name: "Dr Chief" },
          attestations: [
            { code: "crisis_owner_named", met: true },
            { code: "consent_text_approved", met: true },
            { code: "clinical_safety_case_current", met: true },
          ],
          otherConditions: [],
        })}
      />,
    );
  });

  it("cannot sign the rules until the tick-box is ticked, then signs that exact version", async () => {
    const p = props();
    render(<SignoffChecklist {...p} />);
    const sign = screen.getByRole("button", { name: /Sign and make version 2 live/ });
    expect((sign as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have read these rules/));
    fireEvent.click(sign);
    await waitFor(() => expect(p.onActivate).toHaveBeenCalledWith({ version: 2 }));
  });

  it("offers to load the approved rules when there is no draft and nothing live", async () => {
    const p = props({ draft: null, draftSafetyRules: [] });
    render(<SignoffChecklist {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Load the approved rules into a draft/ }));
    await waitFor(() => expect(p.onLoadStarter).toHaveBeenCalled());
  });

  it("approves a group's rules only after the tick", async () => {
    const p = props();
    render(<SignoffChecklist {...p} />);
    const approve = screen.getByRole("button", { name: /Approve these rules/ });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I approve them/));
    fireEvent.click(approve);
    await waitFor(() => expect(p.onApproveGroupRules).toHaveBeenCalledWith({ groupId: group.id, rulesVersion: 1 }));
  });

  it("will not record a statement without a note, and says what the safety case note needs", async () => {
    const p = props();
    render(<SignoffChecklist {...p} />);
    const buttons = screen.getAllByRole("button", { name: /Record this/ });
    const ticks = screen.getAllByLabelText(/This is true and I am recording it myself/);
    fireEvent.click(ticks[2]);
    fireEvent.click(buttons[2]);
    expect((await screen.findAllByText(/Name the safety case document, its version and who signed it/)).length).toBeGreaterThan(0);
    expect(p.onAttest).not.toHaveBeenCalled();
  });

  it("records a statement with the note, and warns that counsel has not reviewed the consent text", async () => {
    const p = props();
    render(<SignoffChecklist {...p} />);
    expect(screen.getAllByText(/Counsel has not reviewed it/).length).toBe(1);
    const notes = screen.getAllByLabelText("Your note");
    fireEvent.change(notes[0], { target: { value: "Dr Ada Obi owns the queue, first look within 30 minutes" } });
    fireEvent.click(screen.getAllByLabelText(/This is true and I am recording it myself/)[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /Record this/ })[0]);
    await waitFor(() =>
      expect(p.onAttest).toHaveBeenCalledWith({ code: "crisis_owner_named", note: "Dr Ada Obi owns the queue, first look within 30 minutes" }),
    );
  });
});
