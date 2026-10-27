/** @jest-environment jsdom */
/**
 * Found in the browser while building S07y: the sheet's first row got a random id on the server AND again in the browser, and that id was used in the DOM
 * ids, so the server HTML and the first browser render disagreed (a hydration mismatch). The DOM ids now come from useId. This renders the sheet twice with a
 * different random id each time and requires the HTML to be identical.
 */
import { renderToString } from "react-dom/server";
import { DiarySheet } from "./diary-sheet";

jest.mock("./actions", () => ({ saveDiaryAction: jest.fn() }));
jest.mock("@/lib/network/use-online-status", () => ({ useOnlineStatus: () => true }));

describe("DiarySheet server render", () => {
  it("does not depend on the random id of its first row", () => {
    const a = (() => {
      Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, configurable: true });
      return renderToString(<DiarySheet readerOpen />);
    })();
    const b = (() => {
      Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, configurable: true });
      return renderToString(<DiarySheet readerOpen />);
    })();
    expect(a).toBe(b);
    expect(a).not.toMatch(/aaaaaaaa-aaaa|bbbbbbbb-bbbb/);
  });
});
