import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StatsDashboard } from "@/components/stats-dashboard";
import { getAuthSession } from "@/lib/auth";
import { getUserGameStatsHistory } from "@/lib/db";
import { computeProgressDashboard } from "@/lib/progress-stats";

export const metadata: Metadata = {
  title: "Progress | LcStudy"
};

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/signin");

  const history = await getUserGameStatsHistory(session.user.id);
  const stats = computeProgressDashboard(history);

  return <StatsDashboard stats={stats} />;
}
