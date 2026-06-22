"use client"

import type { DashboardData } from "@/lib/meme-manager"
import { CheckCircle2, XCircle, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function StatusCheck({ active, trueText, falseText }: { active: boolean, trueText: string, falseText: string }) {
  return (
    <div className="flex items-start gap-2">
      {active ? (
        <CheckCircle2 className="size-4 text-emerald-500 mt-0.5" />
      ) : (
        <XCircle className="size-4 text-muted-foreground mt-0.5" />
      )}
      <span className={`text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {active ? trueText : falseText}
      </span>
    </div>
  )
}

export function SettingsView({ data }: { data: DashboardData }) {
  const { summary } = data

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">系统设置</h2>
        <p className="text-sm text-muted-foreground mt-1">
          MemeManager 运行状态和全局配置摘要。
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">统计信息</CardTitle>
            <CardDescription>当前表情仓库的数据汇总</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">已管理仓库</span>
              <span className="font-medium">{summary.count} 个</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">总表情数</span>
              <span className="font-medium">{summary.totalMemeCount} 个</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">已共享表情</span>
              <span className="font-medium text-emerald-600">{summary.linkedMemeCount} 个</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">重名冲突</span>
              <span className={`font-medium ${summary.conflictCount > 0 ? "text-amber-600" : ""}`}>
                {summary.conflictCount} 处
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">环境配置</CardTitle>
            <CardDescription>Meme API 与拉取策略状态</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatusCheck
              active={summary.repoUrlPrefixConfigured}
              trueText="已配置仓库拉取源前缀 (镜像源)"
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

            <div className="mt-6 rounded-md bg-muted p-3 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground mb-1">目录信息</p>
                <div className="space-y-1 break-all">
                  <p><strong>数据根目录：</strong>{summary.dataRoot}</p>
                  <p><strong>共享表情池：</strong>{summary.managedMemesDir}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
