/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import { Highlight } from "./admin-search";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe("Highlight", () => {
  it("marks the first place the typed words appear, case-blind", () => {
    const { container } = render(<Highlight text="Acme Staff Health" query="  staff " />);
    expect(container.querySelector("mark")?.textContent).toBe("Staff");
    expect(container.textContent).toBe("Acme Staff Health");
  });

  it("marks nothing for a one-letter query or a title that does not contain it", () => {
    expect(render(<Highlight text="Acme" query="a" />).container.querySelector("mark")).toBeNull();
    expect(render(<Highlight text="Acme" query="zz" />).container.querySelector("mark")).toBeNull();
  });
});
