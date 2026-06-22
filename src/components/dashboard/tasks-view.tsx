"use client"

import { useState, useEffect, useRef } from "react"
import { Terminal, CheckCircle2, XCircle, Clock, Loader2, ListTree } from "lucide-react"
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
      <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] min-h-[400px] text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-950 border-dashed">
        <Terminal className="size-10 mb-4 opacity-30" />
        <p className="text-sm">还没有任务记录</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-140px)] min-h-[500px] rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-950 shadow-sm">
      {/* 左侧任务列表 */}
      <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/50 dark:bg-zinc-900/20">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/50 shrink-0">
          <ListTree className="size-4 text-zinc-500" />
          <span className="text-sm font-semibold">执行历史</span>
          <span className="ml-auto text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{data.jobs.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {data.jobs.map((job) => {
            const isSelected = selectedJob?.id === job.id
            return (
              <button
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className={`w-full flex items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  isSelected 
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 shadow-sm" 
                    : "hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <StatusIcon status={job.status} className={`size-4 mt-0.5 shrink-0 ${isSelected && job.status !== 'running' ? 'opacity-90' : ''}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={`font-medium text-sm truncate ${isSelected ? '' : 'text-zinc-900 dark:text-zinc-100'}`}>
                      {formatJobType(job.type)}
                    </span>
                    <span className={`shrink-0 text-[10px] tabular-nums ${isSelected ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-400"}`}>
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className={`truncate text-[11px] ${isSelected ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500"}`} title={job.repoName || "全局任务"}>
                    {job.repoName || "全局任务"}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 右侧终端日志 */}
      <div className="flex-1 flex flex-col bg-[#09090b] min-h-0">
        {selectedJob ? (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#121214] px-5 py-3 text-zinc-300">
              <div className="flex items-center gap-3">
                <Terminal className="size-4 opacity-50" />
                <span className="text-sm font-mono tracking-wide">
                  {formatJobType(selectedJob.type)} <span className="opacity-40 ml-1">/</span> <span className="text-white font-semibold ml-1">{selectedJob.repoName || "全局任务"}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-2 py-0.5 font-medium rounded-sm border ${
                  selectedJob.status === "succeeded" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" :
                  selectedJob.status === "failed" ? "border-rose-500/30 text-rose-400 bg-rose-500/10" :
                  selectedJob.status === "running" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                  "border-white/20 text-white/60 bg-white/5"
                }`}>
                  {getJobStatusLabel(selectedJob.status)}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-[13px] leading-relaxed">
              {selectedJob.logs.length === 0 ? (
                <div className="text-white/20 italic">等待日志输出...</div>
              ) : (
                <div className="space-y-1.5">
                  {selectedJob.logs.map((log, i) => {
                    let colorClass = "text-zinc-300"
                    if (log.level === "error") colorClass = "text-rose-400"
                    
                    return (
                      <div key={i} className={`whitespace-pre-wrap break-all ${colorClass}`}>
                        <span className="text-zinc-600 select-none mr-3 text-[11px]">[{log.timestamp.split('T')[1] || log.timestamp}]</span>
                        {log.message}
                      </div>
                    )
                  })}
                  <div ref={logsEndRef} className="h-4" />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
            未选择任务
          </div>
        )}
      </div>
    </div>
  )
}