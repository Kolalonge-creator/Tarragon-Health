import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { TestimonialsManager } from "./testimonials-manager";

export default async function TestimonialsSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Patient testimonials
        </h1>
        <p className="text-charcoal-ink/60">
          Patient-volunteered quotes with explicit publish consent. Publishing puts a quote on
          the public marketing site; declining keeps it private. Honour removal requests
          promptly — consent can be withdrawn at any time.
        </p>
      </div>
      <TestimonialsManager />
    </div>
  );
}
