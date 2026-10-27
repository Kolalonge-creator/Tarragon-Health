import type { NextResponse } from "next/server";
import { exportDashboard } from "@/lib/outcomes/dashboard-export";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  return exportDashboard("cmo");
}
