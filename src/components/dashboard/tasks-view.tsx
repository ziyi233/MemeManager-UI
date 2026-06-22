"use client"

import { useState, useEffect, useRef } from "react"
import { Terminal, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react"
import type { DashboardData, Job } from "@/lib/meme-manager"

function getJobTone(status: Job["status"]) {
  if (status === "succeeded") return "success"
  if (status === "failed") return "danger"
  if (status === "running") return "running"
  return "pending"
}

function getJobStatusLabel(status: Job["status"]) {
  switch (status) {
    case "running": return "执行中"
    case "succeeded": return "成功"
    case "failed": return "失败"
    default: return "排队中"
  }
}

function formatJobType(type: Job["type"]) {
  switch (type) {
    case "sync": return "同步仓库"
    case "sync_all": return "全部同步"
    case "remove": return "移除仓库"
    default: return "重载 API"
  }
}

function StatusIcon({ status, className }: { status: Job["status"], className?: string }) {
  if (status === "succeeded") return <CheckCircle2 className={`text-emerald-500 ${className}`} />
  if (status === "failed") return <XCircle className={`text-rose-500 ${className}`} />
  if (status === "running") return <Loader2 className={`text-blue-500 animate-spin ${className}`} />
  return <Clock className={`text-amber-500 ${className}`} />
}

export function TasksView({ data }: { data: DashboardData }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(data.jobs[0]?.id || null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logic if the job is running
  const selectedJob = data.jobs.find((job) => job.id === selectedJobId) || data.jobs[0] || null

  useEffect(() => {
    if (selectedJob && selectedJob.status === "running") {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [selectedJob?.logs.length, selectedJob?.status, selectedJob])

  if (data.jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border rounded-lg bg-card border-dashed">
        <Terminal className="size-10 mb-4 opacity-50" />
        <p>还没有任务记录</p>
      </div>
    )
  }

  return (
    <div className="grid min-h-[560px] gap-4 lg:h-[calc(100vh-190px)] lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* 左侧任务列表 */}
      <div className="flex min-h-[280px] flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3 text-sm font-medium">
          <span>任务列表</span>
          <span className="text-xs text-muted-foreground">{data.jobs.length} 条</span>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {data.jobs.map((job) => {
            const isSelected = selectedJob?.id === job.id
            return (
              <button
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                  className={`flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors ${
                  isSelected ? "bg-foreground text-background" : "hover:bg-muted"
                }`}
              >
                <StatusIcon status={job.status} className="size-4 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="font-medium text-sm">{formatJobType(job.type)}</span>
                    <span className={`shrink-0 text-[10px] ${isSelected ? "text-background/60" : "text-muted-foreground"}`}>
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className={`truncate text-xs ${isSelected ? "text-background/70" : "text-muted-foreground"}`} title={job.repoName || "全局任务"}>
                    {job.repoName || "全局任务"}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 右侧终端日志 */}
      <div className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-black bg-[#0c0c0c] shadow-sm">
        {selectedJob ? (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#161616] px-4 py-3 text-white/80">
              <div className="flex items-center gap-2">
                <Terminal className="size-4" />
                <span className="text-sm font-medium">
                  {formatJobType(selectedJob.type)} - {selectedJob.repoName || "全局任务"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  selectedJob.status === "succeeded" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" :
                  selectedJob.status === "failed" ? "border-rose-500/30 text-rose-400 bg-rose-500/10" :
                  selectedJob.status === "running" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                  "border-white/20 text-white/60 bg-white/5"
                }`}>
                  {getJobStatusLabel(selectedJob.status)}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-6">
              {selectedJob.logs.length === 0 ? (
                <div className="text-white/30 italic">等待日志输出...</div>
              ) : (
                <div className="space-y-1">
                  {selectedJob.logs.map((log, i) => {
                    let colorClass = "text-white/80"
                    if (log.level === "error") colorClass = "text-rose-400"
                    
                    return (
                      <div key={i} className={`whitespace-pre-wrap break-all ${colorClass}`}>
                        <span className="opacity-50 select-none mr-2">[{log.timestamp.split('T')[1] || log.timestamp}]</span>
                        {log.message}
                      </div>
                    )
                  })}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/30">
            未选择任务
          </div>
        )}
      </div>
    </div>
  )
}
