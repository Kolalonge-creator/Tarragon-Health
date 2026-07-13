import { Providers } from "../(dashboard)/providers";

/**
 * /onboarding sits outside the (dashboard) route group (it's reached before
 * a patient has a dashboard to redirect into), so it doesn't inherit
 * (dashboard)/layout.tsx's QueryClientProvider. PlanSelector uses React
 * Query (useActivePatientPlans) — without this wrapper it throws "No
 * QueryClient set" at render time.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
