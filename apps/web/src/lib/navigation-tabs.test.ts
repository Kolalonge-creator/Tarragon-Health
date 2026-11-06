/**
 * 2026-11-06 visual pass: on the phone, the My Health tab stays lit on the pages PD-01 put inside it (vitals, medicines,
 * results), without lighting the "My health record" sidebar entry there; Home stays exact.
 */
import { getNavSections, itemIsActive, primaryNavItems, tabIsActive } from "./navigation";

const tabs = primaryNavItems(getNavSections("patient"));
const myHealth = tabs.find((t) => t.href === "/patient/my-health")!;

it("lights My Health on vitals, medicines and labs, but not Home or Messages", () => {
  for (const path of ["/patient/my-health", "/patient/vitals", "/patient/medications", "/patient/labs", "/patient/labs/result/x"]) {
    expect([path, tabIsActive(path, myHealth)]).toEqual([path, true]);
  }
  expect(tabIsActive("/patient", myHealth)).toBe(false);
  expect(tabIsActive("/patient/messages", myHealth)).toBe(false);
});

it("does not light the sidebar's My health record entry on those pages", () => {
  expect(itemIsActive("/patient/vitals", myHealth)).toBe(false);
});

it("leaves some patient pages to More", () => {
  expect(tabs.some((t) => tabIsActive("/patient/appointments", t))).toBe(false);
});
