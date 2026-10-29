/** @jest-environment jsdom */
/** Design audit P1 item 9: the web twins of the mobile kit components. */
import { render, screen, fireEvent } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { HeroMetric } from "./hero-metric";
import { EmptyState } from "./empty-state";
import { ListItem } from "./list-item";
import { Sheet } from "./sheet";

describe("HeroMetric", () => {
  it("shows the number, unit, a worded status chip and the sentence", () => {
    render(<HeroMetric label="Blood pressure" value="134/81" unit="mmHg" status={{ label: "At target", variant: "green" }} caption="Within your target range." />);
    expect(screen.getByText("134/81")).not.toBeNull();
    expect(screen.getByText("mmHg")).not.toBeNull();
    expect(screen.getByText("At target")).not.toBeNull();
    expect(screen.getByText("Within your target range.")).not.toBeNull();
  });
  it("never invents a number before a first reading", () => {
    render(<HeroMetric label="Blood pressure" value={null} status={{ label: "At target", variant: "green" }} emptyText="Log your first reading." />);
    expect(screen.getByText("Log your first reading.")).not.toBeNull();
    expect(screen.queryByText("At target")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("renders title, body and the single action", () => {
    render(<EmptyState icon={Inbox} title="Nothing yet" body="Add one to start." action={<button>Add</button>} />);
    expect(screen.getByRole("heading", { name: "Nothing yet" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).not.toBeNull();
  });
});

describe("ListItem", () => {
  it("is a link when given an href, plain otherwise", () => {
    const { rerender } = render(<ListItem title="Lab results" href="/patient/labs" />);
    expect(screen.getByRole("link", { name: /Lab results/ }).getAttribute("href")).toBe("/patient/labs");
    rerender(<ListItem title="Lab results" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Sheet", () => {
  it("renders only when open and closes from the Close button and Escape", () => {
    const onClose = jest.fn();
    const { rerender } = render(<Sheet open={false} onClose={onClose} title="Hello"><p>Body</p></Sheet>);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Sheet open onClose={onClose} title="Hello"><p>Body</p></Sheet>);
    expect(screen.getByRole("dialog", { name: "Hello" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
