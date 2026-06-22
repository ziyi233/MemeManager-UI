"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { RefreshCw, LayoutGrid, TerminalSquare, Settings as SettingsIcon } from "lucide-react"

import type { DashboardData, Job, ManagedRepo, RepoLogEntry } from "@/lib/meme-manager"
import { Button } from "@/components/ui/button"

import { RepositoriesView } from "./repositories-view"
import { TasksView } from "./tasks-view"
import { SettingsView } from "./settings-view"

export type FlashMessage = {
  type: "success" | "error"
  text: string
} | null

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })

  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || "请求失败")
  }

  return data
}

export function DashboardShell({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData)
  const [activeTab, setActiveTab] = useState<"repos" | "tasks" | "settings">("repos")
  const [flash, setFlash] = useState<FlashMessage>(null)
  
  const refreshNow = useCallback(async () => {
    try {
      const nextData = await fetchJson<DashboardData>("/api/repos", { cache: "no-store" })
      setData(nextData)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const nextData = await fetchJson<DashboardData>("/api/repos", {
          cache: "no-store",
        })
        if (!cancelled) {
          setData(nextData)
        }
      } catch {}
    }
    const timer = window.setInterval(() => {
      void refresh()
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const eventSource = new EventSource("/api/events")
    function handleJobEvent(event: MessageEvent<string>) {
      const payload = JSON.parse(event.data) as { job: Job }
      setData((current) => {
        const nextJobs = [...current.jobs]
        const index = nextJobs.findIndex((job) => job.id === payload.job.id)
        if (index === -1) {
          nextJobs.unshift(payload.job)
        } else {
          nextJobs[index] = payload.job
        }
        return {
          ...current,
          jobs: nextJobs.slice(0, 30),
        }
      })
    }
    eventSource.addEventListener("job_created", (event) => handleJobEvent(event as MessageEvent<string>))
    eventSource.addEventListener("job_updated", (event) => handleJobEvent(event as MessageEvent<string>))
    eventSource.addEventListener("job_log", (event) => handleJobEvent(event as MessageEvent<string>))
    return () => {
      eventSource.close()
    }
  }, [])

  async function handleSyncAll() {
    setFlash(null)
    try {
      await fetchJson("/api/repos/sync-all", { method: "POST", body: JSON.stringify({}) })
      setFlash({ type: "success", text: "已加入同步队列" })
      await refreshNow()
      setActiveTab("tasks")
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "同步失败" })
    }
  }

  async function handleReloadMemeApi() {
    setFlash(null)
    try {
      const result = await fetchJson<{ mode: "url" | "command" }>("/api/meme-api/reload", {
        method: "POST",
        body: JSON.stringify({}),
      })
      setFlash({ type: "success", text: result.mode === "url" ? "已发送重载请求" : "已执行重载命令" })
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "重载失败" })
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 font-semibold">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-[11px] text-primary-foreground shadow-sm">
              M
            </div>
            <div>
              <span className="block text-sm leading-none">MemeManager</span>
              <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Repository tasks and live git logs</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleReloadMemeApi()}>
              重载 API
            </Button>
            <Button size="sm" onClick={() => void handleSyncAll()}>
              <RefreshCw className="mr-2 size-3.5" />
              全部同步
            </Button>
          </div>
        </div>
      </header>

      <div className="border-b bg-background">
        <div className="mx-auto flex max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 py-2 text-sm">
            <button
              onClick={() => setActiveTab("repos")}
              className={`flex h-9 items-center gap-2 rounded-md px-3 transition-colors ${
                activeTab === "repos"
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
            >
              <LayoutGrid className="size-4" />
              仓库
            </button>
            <button
              onClick={() => setActiveTab("tasks")}
              className={`flex h-9 items-center gap-2 rounded-md px-3 transition-colors ${
                activeTab === "tasks"
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
            >
              <TerminalSquare className="size-4" />
              任务
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`flex h-9 items-center gap-2 rounded-md px-3 transition-colors ${
                activeTab === "settings"
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
            >
              <SettingsIcon className="size-4" />
              设置
            </button>
          </nav>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1440px] p-4 py-8 sm:px-6 lg:px-8">
        {flash && (
          <div
            className={`mb-6 rounded-md border px-4 py-3 text-sm ${
              flash.type === "error"
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-emerald-500/50 bg-emerald-50 text-emerald-700"
            }`}
          >
            {flash.text}
          </div>
        )}

        {activeTab === "repos" && (
          <RepositoriesView
            data={data}
            refreshNow={refreshNow}
            setFlash={setFlash}
            fetchJson={fetchJson}
          />
        )}
        {activeTab === "tasks" && <TasksView data={data} />}
        {activeTab === "settings" && <SettingsView data={data} />}
      </main>
    </div>
  )
}
