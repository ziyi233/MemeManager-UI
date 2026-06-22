"use client"

import type { DashboardData } from "@/lib/meme-manager"
import { CheckCircle2, XCircle, Info, HardDrive, Cpu } from "lucide-react"

function StatusCheck({ active, trueText, falseText }: { active: boolean, trueText: string, falseText: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800/50">
      {active ? (
        <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" />
      ) : (
        <XCircle className="size-4 text-zinc-400 mt-0.5 shrink-0" />
      )}
      <span className={`text-[13px] leading-snug ${active ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-400"}`}>
        {active ? trueText : falseText}
      </span>
    </div>
  )
}

export function SettingsView({ data }: { data: DashboardData }) {
  const { summary } = data

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">系统设置</h2>
        <p className="text-sm text-zinc-500 mt-1">
          MemeManager 运行状态和全局配置摘要。此视图为只读信息。
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 统计信息卡片 */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex items-center gap-2">
            <HardDrive className="size-4 text-zinc-500" />
            <h3 className="font-semibold text-sm">存储统计</h3>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="flex justify-between items-center pb-4 border-b border-zinc-100 dark:border-zinc-800/50">
              <span className="text-[13px] text-zinc-500">已管理仓库</span>
              <span className="font-medium font-mono text-sm">{summary.count}</span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-zinc-100 dark:border-zinc-800/50">
              <span className="text-[13px] text-zinc-500">总表情数</span>
              <span className="font-medium font-mono text-sm">{summary.totalMemeCount}</span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-zinc-100 dark:border-zinc-800/50">
              <span className="text-[13px] text-zinc-500">已共享表情</span>
              <span className="font-medium font-mono text-sm text-emerald-600 dark:text-emerald-500">{summary.linkedMemeCount}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-zinc-500">重名冲突</span>
              <span className={`font-medium font-mono text-sm ${summary.conflictCount > 0 ? "text-amber-600 dark:text-amber-500" : "text-zinc-900 dark:text-zinc-100"}`}>
                {summary.conflictCount}
              </span>
            </div>
          </div>
        </div>

        {/* 环境配置卡片 */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex items-center gap-2">
            <Cpu className="size-4 text-zinc-500" />
            <h3 className="font-semibold text-sm">环境配置</h3>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <StatusCheck
              active={summary.repoUrlPrefixConfigured}
              trueText="已配置仓库拉取源前缀 (支持镜像加速)"
              falseText="未配置镜像源前缀，使用原始地址拉取"
            />
            <StatusCheck
              active={summary.reloadConfigured}
              trueText="已配置 Meme API 重载方式"
              falseText="未配置重载方式，需手动重载 API"
            />
            <StatusCheck
              active={summary.autoReloadEnabled}
              trueText="自动重载已启用，同步后将自动调用 API"
              falseText="自动重载未启用"
            />

            <div className="mt-4 rounded-lg bg-zinc-100 dark:bg-zinc-900/50 p-4 text-[13px] text-zinc-600 dark:text-zinc-400 flex items-start gap-3 border border-zinc-200 dark:border-zinc-800/50">
              <Info className="size-4 shrink-0 mt-0.5 text-zinc-500" />
              <div className="space-y-3 w-full min-w-0">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100 mb-1">数据根目录 (Data Root)</p>
                  <p className="font-mono text-[11px] truncate bg-white dark:bg-zinc-950 p-1.5 rounded border border-zinc-200 dark:border-zinc-800" title={summary.dataRoot}>
                    {summary.dataRoot}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100 mb-1">共享表情池 (Managed Memes Dir)</p>
                  <p className="font-mono text-[11px] truncate bg-white dark:bg-zinc-950 p-1.5 rounded border border-zinc-200 dark:border-zinc-800" title={summary.managedMemesDir}>
                    {summary.managedMemesDir}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}