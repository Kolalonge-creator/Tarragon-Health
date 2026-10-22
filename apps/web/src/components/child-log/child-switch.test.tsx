/** @jest-environment jsdom */
/** S68b review fix: the REAL web switch flow relocks the private section (a link click, and a child change with no click). */
import { fireEvent, render, screen } from "@testing-library/react";

const lock = jest.fn(async () => undefined);
jest.mock("@/components/private-section/use-private-lock", () => ({ controllerFor: () => ({ lock }) }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(); }} className={className}>{children}</a>
  ),
}));

import { ChildSwitchLink, getChildSwitcher } from "./child-switch";

beforeEach(() => lock.mockClear());

describe("switching child on the web", () => {
  it("clicking 'switch child' relocks the mother's section, once the child on screen is known", () => {
    getChildSwitcher("acct-a").show("c1");
    render(<ChildSwitchLink accountId="acct-a" href="/patient/child">Switch child</ChildSwitchLink>);
    fireEvent.click(screen.getByRole("link", { name: /switch child/i }));
    expect(lock).toHaveBeenCalledTimes(1);
    getChildSwitcher("acct-a").show("c2");
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("a change of child that did not come through the link (the back button) relocks too", () => {
    const sw = getChildSwitcher("acct-b");
    sw.show("c1");
    sw.show("c2");
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("another account's switcher is separate, and nothing relocks before a child was shown", () => {
    render(<ChildSwitchLink accountId="acct-c" href="/patient/child">Switch child</ChildSwitchLink>);
    fireEvent.click(screen.getByRole("link", { name: /switch child/i }));
    expect(lock).not.toHaveBeenCalled();
  });
});
