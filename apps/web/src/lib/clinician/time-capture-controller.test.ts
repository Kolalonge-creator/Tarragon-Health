/** @jest-environment jsdom */
import { attachTimeCapture, createTimeCaptureController, type TimeSink } from "./time-capture-controller";
import type { TimeEntryInput } from "./time-capture";

const PATIENT = "11111111-1111-4111-8111-111111111111";
const REF = "33333333-3333-4333-8333-333333333333";

function setup(opts: { beaconOk?: boolean } = {}) {
  let clock = 1_000_000;
  const log: string[] = [];
  const beacons: TimeEntryInput[] = [];
  const actions: TimeEntryInput[] = [];
  const sink: TimeSink = {
    beacon: (e) => {
      log.push("beacon");
      beacons.push(e);
      return opts.beaconOk !== false;
    },
    action: async (e) => {
      log.push("action");
      actions.push(e);
    },
  };
  let n = 0;
  const controller = createTimeCaptureController({
    source: "task",
    sourceRef: REF,
    patientId: PATIENT,
    now: () => clock,
    sink,
    newKey: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    active: true,
  });
  return { controller, log, beacons, actions, advance: (sec: number) => (clock += sec * 1000) };
}

describe("time capture controller", () => {
  it("sends the accumulated seconds by beacon before the form's own submit handler runs", () => {
    const { controller, log, advance } = setup();
    const detach = attachTimeCapture(document, window, controller, () => true);
    const form = document.createElement("form");
    document.body.appendChild(form);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      log.push("form handler");
    });
    advance(90);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(log).toEqual(["beacon", "form handler"]);
    detach();
  });

  it("sends the same entry key again if the beacon was refused, so a retry cannot double count", () => {
    const { controller, beacons, advance } = setup({ beaconOk: false });
    advance(30);
    controller.beforeSubmit();
    advance(20);
    controller.finish();
    expect(beacons).toHaveLength(2);
    expect(beacons[1]!.clientKey).toBe(beacons[0]!.clientKey);
    expect(beacons[1]!.seconds).toBeGreaterThan(beacons[0]!.seconds);
  });

  it("uses a fresh key once an entry was accepted", () => {
    const { controller, beacons, advance } = setup();
    advance(30);
    controller.beforeSubmit();
    advance(30);
    controller.finish();
    expect(beacons).toHaveLength(2);
    expect(beacons[1]!.clientKey).not.toBe(beacons[0]!.clientKey);
    expect(beacons[0]!.seconds + beacons[1]!.seconds).toBeLessThanOrEqual(60);
  });

  it("sends nothing for a glance under the minimum", () => {
    const { controller, log, advance } = setup();
    advance(2);
    controller.finish();
    expect(log).toEqual([]);
  });

  it("stops counting when its surface loses the focus and sends what it had", () => {
    const { controller, beacons, advance } = setup();
    advance(40);
    controller.setActive(false);
    advance(500);
    controller.finish();
    expect(beacons).toHaveLength(1);
    expect(beacons[0]!.seconds).toBe(40);
  });

  it("counts nothing in a hidden tab", () => {
    const { controller, beacons, advance } = setup();
    advance(10);
    controller.setActive(false);
    advance(3600);
    controller.setActive(true);
    advance(5);
    controller.finish();
    expect(beacons.map((b) => b.seconds)).toEqual([10, 5]);
  });

  it("removes every listener when detached", () => {
    const { controller, log, advance } = setup();
    const detach = attachTimeCapture(document, window, controller, () => true);
    detach();
    advance(60);
    document.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(log).toEqual([]);
  });
});
