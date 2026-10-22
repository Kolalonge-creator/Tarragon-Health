import { RUNWAY_CONFIG, runwayBar, stockLine } from "@tarragon/medicines";
import { loadRunwayConfig } from "./runway-config";

describe("runway config (item 9)", () => {
  it("the page's versioned config equals the compiled-in values the card uses", () => {
    expect(loadRunwayConfig()).toEqual(RUNWAY_CONFIG);
  });
  it("never offers a price: the bar and the stock line carry days and a time only", () => {
    expect(Object.keys(runwayBar(10) ?? {}).sort()).toEqual(["daysLeft", "fraction", "offerCollect", "tone"]);
    expect(JSON.stringify(stockLine(Date.now(), Date.now()))).not.toMatch(/price|kobo|commission/i);
  });
});
