"use client"

import { AlertTriangle } from "lucide-react"

import type { DashboardData } from "@/lib/meme-manager"

export function ConflictsView({ data }: { data: DashboardData }) {
  const conflictRepos = data.repos.filter((repo) => repo.conflictCount > 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">冲突管理</h2>
        <p className="mt-1 text-sm text-zinc-500">
          当前检测到 {data.summary.conflictCount} 处表情目录重名。规则编辑稍后接入，这里先作为冲突总览入口。
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
        <AlertTriangle className="mx-auto mb-4 size-8 text-amber-500" />
        {conflictRepos.length ? (
          <p>已发现冲突仓库，后续会在这里配置“保留哪个表情目录”的规则。</p>
        ) : (
          <p>当前没有需要处理的冲突。</p>
        )}
      </div>
    </div>
  )
}
