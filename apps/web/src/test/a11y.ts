import { render, type RenderResult } from "@testing-library/react";
import { axe, toHaveNoViolations, type JestAxeConfigureOptions } from "jest-axe";

expect.extend(toHaveNoViolations);

/**
 * Renders `ui` and asserts axe-core finds zero accessibility violations.
 *
 * Import in any `.test.tsx` that needs a DOM — pair with the file's own
 * `/** @jest-environment jsdom *\/` docblock (see jest.config.mjs's own doc
 * on why that's per-file rather than the default environment). Returns the
 * RTL `render()` result so a test can keep asserting on it (e.g. driving an
 * interaction and re-running `expectNoA11yViolations` on the updated DOM)
 * instead of rendering twice.
 *
 * `options` passes through to axe-core — e.g. to scope a run to specific
 * rules, or to disable a rule this component deliberately can't satisfy yet
 * (with a comment explaining why, never silently).
 */
export async function expectNoA11yViolations(
  ui: React.ReactElement,
  options?: JestAxeConfigureOptions
): Promise<RenderResult> {
  const result = render(ui);
  const results = await axe(result.container, options);
  expect(results).toHaveNoViolations();
  return result;
}
