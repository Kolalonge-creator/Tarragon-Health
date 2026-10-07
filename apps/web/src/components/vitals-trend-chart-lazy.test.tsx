/** @jest-environment jsdom */
/**
 * A prior version of this card used a plain `next/dynamic(...)` call
 * directly on the patient dashboard's Server Component page — that
 * genuinely splits recharts into its own chunk, but `ssr: false` isn't
 * legal in a Server Component, so nothing was actually deferred: the
 * dynamic import still resolved and rendered on first load, exactly like a
 * static import would have. This proves LazyVitalsTrendChart's real
 * behaviour: it renders only a skeleton until the card intersects the
 * viewport, and only then mounts the (mocked) chart.
 */
import { act, render, screen } from "@testing-library/react";
import { LazyVitalsTrendChart } from "./vitals-trend-chart-lazy";

// next/dynamic's real loader machinery isn't what this test is about —
// the IntersectionObserver gating is. Swap it for a component that renders
// synchronously so intersection timing, not module loading, drives the
// assertions.
jest.mock("next/dynamic", () => () => {
  function MockChart({ patientId }: { patientId: string }) {
    return <div data-testid="real-chart">{patientId}</div>;
  }
  return MockChart;
});

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let observedCallback: ObserverCallback | null = null;
let disconnectSpy: jest.Mock;

class FakeIntersectionObserver {
  constructor(callback: ObserverCallback) {
    observedCallback = callback;
  }
  observe() {}
  disconnect() {
    disconnectSpy();
  }
  unobserve() {}
}

describe("LazyVitalsTrendChart", () => {
  beforeEach(() => {
    observedCallback = null;
    disconnectSpy = jest.fn();
    // @ts-expect-error — test-only global stub, jsdom has no real IntersectionObserver
    global.IntersectionObserver = FakeIntersectionObserver;
  });

  it("renders only the skeleton, never the real chart, before the card is visible", () => {
    render(<LazyVitalsTrendChart patientId="patient-1" />);

    expect(screen.queryByTestId("real-chart")).toBeNull();
  });

  it("mounts the real chart once the card intersects the viewport, and stops observing", () => {
    render(<LazyVitalsTrendChart patientId="patient-1" />);

    expect(observedCallback).not.toBeNull();
    act(() => {
      observedCallback!([{ isIntersecting: true }]);
    });

    expect(screen.getByTestId("real-chart").textContent).toBe("patient-1");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("stays on the skeleton while the card is observed but not yet intersecting", () => {
    render(<LazyVitalsTrendChart patientId="patient-1" />);

    act(() => {
      observedCallback!([{ isIntersecting: false }]);
    });

    expect(screen.queryByTestId("real-chart")).toBeNull();
  });

  it("renders the real chart immediately when IntersectionObserver isn't available, rather than never rendering it", () => {
    // @ts-expect-error — simulating an environment with no IntersectionObserver
    global.IntersectionObserver = undefined;

    render(<LazyVitalsTrendChart patientId="patient-1" />);

    expect(screen.queryByTestId("real-chart")).not.toBeNull();
  });
});
