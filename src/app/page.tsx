import { RepoDashboard, type DashboardData } from "@/components/repo-dashboard"
import { serverFetch } from "@/lib/server-api"

export const dynamic = "force-dynamic"

export default async function Home({
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { data } = await serverFetch("/repos")
  const dashboardData = data as DashboardData

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#content"
        className="absolute left-4 top-4 -translate-y-16 rounded-md border bg-white px-3 py-2 text-sm text-[var(--foreground)] shadow-sm transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        跳到内容
      </a>

      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RepoDashboard
          initialData={dashboardData}
        />
      </div>
    </main>
  )
}
