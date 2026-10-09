/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";

jest.mock("./actions", () => {
  const ok = jest.fn(async () => ({ ok: true, message: "Saved." }));
  return {
    createGroupAction: ok, editGroupAction: ok, setGroupStatusAction: ok, saveTopicAction: ok, grantStaffAction: ok, revokeStaffAction: ok,
    saveRuleAction: ok, deleteRuleAction: ok, saveHostsAction: ok, activateRuleSetAction: ok, newDraftAction: ok, unpinAction: ok,
    unmaskAction: jest.fn(async () => ({ ok: true, message: "Recorded.", result: { profile_id: "p-1", full_name: "Ada Obi" } })),
  };
});

import { CreateGroupForm, EditGroupForm, GroupStatusButtons } from "./group-forms";
import { TopicForm } from "./topic-form";
import { GrantStaffForm, RevokeStaffForm } from "./staff-forms";
import { ActivateForm, AddRuleForm, DeleteRuleForm, HostsForm, NewDraftForm } from "./rule-forms";
import { UnmaskForm } from "./unmask-form";
import { UnpinForm } from "./unpin-form";

const topics = [{ code: "heart", label: "Heart health" }];
const group = { id: "g1", slug: "calm", name: "Calm", description: "d", topic_code: "heart", rules_text: "Be kind" };

describe("community admin forms accessibility", () => {
  it("group forms and status buttons", async () => {
    await expectNoA11yViolations(<CreateGroupForm topics={topics} />);
    await expectNoA11yViolations(<EditGroupForm group={group} topics={topics} />);
    await expectNoA11yViolations(<GroupStatusButtons id="g1" slug="calm" status="draft" name="Calm" />);
    await expectNoA11yViolations(<GroupStatusButtons id="g1" slug="calm" status="archived" name="Calm" />);
  });
  it("topic and staff forms", async () => {
    await expectNoA11yViolations(<TopicForm idPrefix="t-new" />);
    await expectNoA11yViolations(<TopicForm idPrefix="t-a" topic={{ code: "heart", label: "Heart", description: null, sort_order: 1, is_active: true, requires_cmo_rules: true }} />);
    await expectNoA11yViolations(<GrantStaffForm candidates={[{ id: "u1", full_name: "Ngozi", role: "care_coordinator" }]} groups={[{ id: "g1", name: "Calm" }]} />);
    await expectNoA11yViolations(<GrantStaffForm candidates={null} groups={[]} />);
    await expectNoA11yViolations(<RevokeStaffForm id="s1" who="Ngozi" />);
  });
  it("rule forms", async () => {
    await expectNoA11yViolations(<AddRuleForm version={3} />);
    await expectNoA11yViolations(<HostsForm version={3} hosts={["tarragonhealth.ng"]} />);
    await expectNoA11yViolations(<ActivateForm version={3} />);
    await expectNoA11yViolations(<NewDraftForm fromVersion={2} />);
    await expectNoA11yViolations(<DeleteRuleForm version={3} ruleId={4} />);
    await expectNoA11yViolations(<UnpinForm id="n1" groupId="g1" />);
  });
  it("unmask form states the privacy warning and shows the result once", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    await expectNoA11yViolations(<UnmaskForm groups={[{ id: "g1", name: "Calm" }]} />);
    render(<UnmaskForm groups={[{ id: "g1", name: "Calm" }]} />);
    expect(screen.getAllByText(/Do not type the member's name, phone number, email or any detail that identifies them/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByLabelText("Group")[0], { target: { value: "g1" } });
    fireEvent.change(screen.getAllByLabelText("Community name")[0], { target: { value: "calm-heron" } });
    fireEvent.change(screen.getAllByLabelText("Written reason")[0], { target: { value: "Safety review of a flagged post" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Look up this member" })[0]);
    await waitFor(() => expect(screen.getByText("Ada Obi")).toBeTruthy());
    expect(screen.getByText(/Chief Medical Officer has been told/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear this result" }));
    expect(screen.queryByText("Ada Obi")).toBeNull();
  });
});
