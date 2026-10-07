import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { directionsHref, telHref } from "./directory-links";

describe("telHref", () => {
  it("builds a link only for a valid E.164 number", () => {
    expect(telHref("+2348012345678")).toBe("tel:+2348012345678");
    expect(telHref(" +2348012345678 ")).toBe("tel:+2348012345678");
    for (const bad of ["08012345678", "+0123", "tel:+2348012345678", "", null, undefined, "+234 801 234 5678", "javascript:alert(1)"]) expect(telHref(bad)).toBeNull();
  });
});

describe("directionsHref", () => {
  const withCoords = { latitude: 6.5244, longitude: 3.3792, name: "Test Hospital", address: "1 Road" };
  it("uses the phone's own maps app with coordinates", () => {
    expect(directionsHref(withCoords, "android")).toBe("geo:6.5244,3.3792?q=6.5244,3.3792(Test%20Hospital)");
    expect(directionsHref(withCoords, "web")).toBe("geo:6.5244,3.3792?q=6.5244,3.3792(Test%20Hospital)");
    expect(directionsHref(withCoords, "ios")).toBe("https://maps.apple.com/?daddr=6.5244,3.3792&q=Test%20Hospital");
  });
  it("falls back to the address, then to nothing", () => {
    expect(directionsHref({ name: "A", address: "2 Lane" }, "android")).toBe("geo:0,0?q=A%202%20Lane");
    expect(directionsHref({ name: "A", address: "  " }, "ios")).toBeNull();
    expect(directionsHref({ latitude: 999, longitude: 3, address: "2 Lane" }, "android")).toContain("geo:0,0");
  });
  it("encodes a name that tries to break out of the link", () => {
    expect(directionsHref({ latitude: 1, longitude: 2, name: "A) javascript:x" }, "android")).not.toContain(" ");
  });
  it("this file loads no map SDK, tracker or network call", () => {
    const src = readFileSync(new URL("./directory-links.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|import .*(mapbox|leaflet|google|analytics)|navigator\.geolocation/i);
  });
});
