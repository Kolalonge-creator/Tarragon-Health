import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ResourcesManager } from "./resources-manager";

export default async function AdminResourcesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <Link href="/admin" className="text-sm text-brand-green hover:underline">
          ← Back to admin
        </Link>
      </div>
      <ResourcesManager />
    </div>
  );
}
