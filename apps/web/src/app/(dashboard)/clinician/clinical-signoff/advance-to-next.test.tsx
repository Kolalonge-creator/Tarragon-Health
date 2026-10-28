/** @jest-environment jsdom */
import { act, render } from "@testing-library/react";
import { AdvanceToNext, nextLineAfterSigning } from "./advance-to-next";

describe("nextLineAfterSigning", () => {
  it("goes to the line that followed the signed one", () => {
    expect(nextLineAfterSigning(["a", "b", "c"], ["a", "c"])).toBe("c");
  });
  it("falls back to the first line when the signed one was last", () => {
    expect(nextLineAfterSigning(["a", "b", "c"], ["a", "b"])).toBe("a");
  });
  it("does nothing on the first render, when nothing was signed, or when everything is signed", () => {
    expect(nextLineAfterSigning([], ["a", "b"])).toBeNull();
    expect(nextLineAfterSigning(["a", "b"], ["a", "b"])).toBeNull();
    expect(nextLineAfterSigning(["a"], [])).toBeNull();
  });
});

describe("AdvanceToNext", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.useFakeTimers();
    Element.prototype.scrollIntoView = jest.fn();
  });
  afterEach(() => jest.useRealTimers());

  it("opens the next line after one disappears, and does not move on the first render", () => {
    document.body.innerHTML = '<details id="a"></details><details id="c"></details>';
    const { rerender } = render(<AdvanceToNext lineIds={["a", "b", "c"]} />);
    act(() => { jest.advanceTimersByTime(300); });
    expect((document.getElementById("c") as HTMLDetailsElement).open).toBe(false);
    rerender(<AdvanceToNext lineIds={["a", "c"]} />);
    act(() => { jest.advanceTimersByTime(300); });
    expect((document.getElementById("c") as HTMLDetailsElement).open).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
