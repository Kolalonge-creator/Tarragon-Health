import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { TaskTypesPage } from "@/components/queue/task-types-page";

export const metadata = { title: "Task types and priorities" };
export const dynamic = "force-dynamic";

export default async function AdminTaskTypes() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return <TaskTypesPage />;
}
