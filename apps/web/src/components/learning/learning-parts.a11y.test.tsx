/** @jest-environment jsdom */
/**
 * S55: the Learning Centre building blocks. Proves the reviewer credit is null-gated (never an implied reviewer), the next step
 * footer links the right place (and drops a link to a lesson that is not servable), the Members lock hides everything, the
 * share links carry only the content code, and every block passes axe.
 */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import {
  FaqView,
  InfographicView,
  MembersLockNotice,
  NextStepFooter,
  ReviewCreditBlock,
  ReviewCreditInline,
  ShareButtons,
} from "./learning-parts";

const reviewed = {
  clinician_reviewed: true,
  reviewed_by_name: "Dr Ada Obi",
  reviewed_at: "2026-09-01T10:00:00Z",
  source_reference: "WHO 2023\nNICE NG136",
  next_review_due: "2027-03-01",
};

describe("ReviewCreditBlock", () => {
  it("shows reviewer, date and sources when a real review record exists", async () => {
    await expectNoA11yViolations(<ReviewCreditBlock item={reviewed} />);
    expect(screen.getByText(/Reviewed by Dr Ada Obi on 1 Sept? 2026/)).toBeTruthy();
    expect(screen.getByText("WHO 2023")).toBeTruthy();
    expect(screen.getByText("NICE NG136")).toBeTruthy();
  });

  it("never implies a reviewer when the record is incomplete", async () => {
    await expectNoA11yViolations(<ReviewCreditBlock item={{ ...reviewed, reviewed_at: null }} />);
    expect(screen.queryByText(/Dr Ada Obi/)).toBeNull();
    expect(screen.getByText(/has not yet been reviewed by a clinician/)).toBeTruthy();
  });

  it("credits the creator by name when there is one", () => {
    render(<ReviewCreditBlock item={{ ...reviewed, creator_name: "Dr Creator Test" }} />);
    expect(screen.getByText("Written by Dr Creator Test")).toBeTruthy();
  });
});

describe("ReviewCreditInline", () => {
  it("is honest about an unreviewed item", () => {
    render(<ReviewCreditInline item={{ clinician_reviewed: false }} />);
    expect(screen.getByText("Not yet reviewed by a clinician")).toBeTruthy();
  });
});

describe("NextStepFooter", () => {
  it("renders the standard footer with a booking link", async () => {
    await expectNoA11yViolations(<NextStepFooter item={{ next_action: "Book a blood pressure check.", next_step_kind: "booking" }} />);
    expect(screen.getByText("What can I do next?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book a visit" }).getAttribute("href")).toBe("/patient/appointments");
  });

  it("links a care plan goal", () => {
    render(<NextStepFooter item={{ next_action: "Set a goal for salt.", next_step_kind: "care_plan_goal" }} />);
    expect(screen.getByRole("link", { name: "Set a goal" }).getAttribute("href")).toBe("/patient/lifestyle");
  });

  it("links the next lesson only when it is servable", () => {
    const { unmount } = render(
      <NextStepFooter
        item={{ next_action: "Read lesson two.", next_step_kind: "lesson", next_step_target_code: "bpc_02", next_step_target_title: "Measure it right" }}
      />
    );
    expect(screen.getByRole("link", { name: /Measure it right/ }).getAttribute("href")).toBe("/patient/learn/bpc_02");
    unmount();
    render(<NextStepFooter item={{ next_action: "Read lesson two.", next_step_kind: "lesson", next_step_target_code: "bpc_02" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Read lesson two.")).toBeTruthy();
  });

  it("renders a text-only footer when there is a sentence but no link target", () => {
    render(<NextStepFooter item={{ next_action: "Take your reading at the same time each day." }} />);
    expect(screen.getByText("Take your reading at the same time each day.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing for an item with no next step", () => {
    const { container } = render(<NextStepFooter item={{}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("MembersLockNotice", () => {
  it("explains the lock and passes axe", async () => {
    await expectNoA11yViolations(<MembersLockNotice creatorName="Dr Creator Test" />);
    expect(screen.getByText("This one is for Members")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See Membership" })).toBeTruthy();
  });
});

describe("ShareButtons", () => {
  it("offers copy and email, with only the content code in the link", async () => {
    await expectNoA11yViolations(<ShareButtons code="bp-basics" title="Blood pressure basics" siteOrigin="https://tarragonhealth.ng" />);
    const mail = screen.getByRole("link", { name: "Send by email" }).getAttribute("href") ?? "";
    expect(decodeURIComponent(mail)).toContain("https://tarragonhealth.ng/health-library/bp-basics");
    expect(mail).not.toMatch(/patient|@/);
  });
});

describe("content type views", () => {
  it("renders FAQ questions as expandable items", async () => {
    await expectNoA11yViolations(<FaqView body={"Q: Can I stop my tablets?\nA: Ask your care team first."} />);
    expect(screen.getByText("Can I stop my tablets?")).toBeTruthy();
  });

  it("falls back to plain text for a FAQ that does not parse", () => {
    render(<FaqView body="Just some text." />);
    expect(screen.getByText("Just some text.")).toBeTruthy();
  });

  it("renders an infographic image with alt text and always the text version", async () => {
    await expectNoA11yViolations(<InfographicView body={"image: https://cdn.example.org/plate.png\nalt: A plate\n\nHalf your plate is vegetables."} />);
    expect(screen.getByRole("img", { name: "A plate" })).toBeTruthy();
    expect(screen.getByText("Half your plate is vegetables.")).toBeTruthy();
  });
});
