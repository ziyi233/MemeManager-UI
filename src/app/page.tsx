import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { serverFetch } from "@/lib/server-api"
import type { DashboardData } from "@/lib/meme-manager"

export const dynamic = "force-dynamic"

export default async function Home({
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { data } = await serverFetch("/repos")
  const dashboardData = data as DashboardData

  return <DashboardShell initialData={dashboardData} />
}
