"use client"

import { useState, useEffect, useCallback } from "react"
import { AlertTriangle, RefreshCw, LayoutGrid, TerminalSquare, Settings as SettingsIcon, Menu, X } from "lucide-react"

import type { DashboardData, Job } from "@/lib/meme-manager"
import { Button } from "@/components/ui/button"

import { RepositoriesView } from "./repositories-view"
import { TasksView } from "./tasks-view"
import { SettingsView } from "./settings-view"
import { ConflictsView } from "./conflicts-view"

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
  const [activeTab, setActiveTab] = useState<"repos" | "tasks" | "conflicts" | "settings">("repos")
  const [flash, setFlash] = useState<FlashMessage>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  
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

  const tabs = [
    { id: "repos", label: "仓库", icon: LayoutGrid },
    { id: "tasks", label: "任务", icon: TerminalSquare },
    { id: "conflicts", label: "冲突", icon: AlertTriangle },
    { id: "settings", label: "设置", icon: SettingsIcon },
  ] as const

  const titleMap = {
    repos: "Repositories",
    tasks: "Tasks Log",
    conflicts: "Conflicts",
    settings: "System Settings"
  }

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 overflow-hidden">
      {/* Mobile Header & Nav */}
      <div className="md:hidden flex flex-col fixed inset-x-0 top-0 z-30 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <div className="flex size-6 items-center justify-center rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black text-xs">M</div>
            <span>MemeManager</span>
          </div>
          <button className="p-2 -mr-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <nav className="flex flex-col p-4 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 space-y-2 shadow-xl">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  setMobileMenuOpen(false)
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                  activeTab === tab.id 
                    ? "bg-zinc-200/50 dark:bg-zinc-800/50 font-medium" 
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-64 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-100/40 dark:bg-zinc-900/40">
        <div className="flex h-16 shrink-0 items-center px-6 gap-3 border-b border-transparent">
          <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100 text-[13px] font-bold text-white dark:text-zinc-900 shadow-sm">
            M
          </div>
          <span className="font-semibold tracking-tight text-[15px]">MemeManager</span>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                activeTab === tab.id
                  ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-sm font-medium border border-zinc-200 dark:border-zinc-700/50"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-100 border border-transparent"
              }`}
            >
              <tab.icon className="size-[18px] opacity-80" strokeWidth={2} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 mt-14 md:mt-0">
        <header className="flex h-16 shrink-0 items-center justify-between px-4 md:px-8 border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
          <h1 className="text-lg font-semibold tracking-tight">{titleMap[activeTab]}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleReloadMemeApi()} className="h-8 px-3 text-xs">
              重载 API
            </Button>
            <Button size="sm" onClick={() => void handleSyncAll()} className="h-8 px-3 text-xs bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200">
              <RefreshCw className="mr-2 size-3.5" />
              全部同步
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1200px] p-4 md:p-8">
            {flash && (
              <div
                className={`mb-6 rounded-md border px-4 py-3 text-sm flex items-center gap-2 ${
                  flash.type === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400"
                }`}
              >
                {flash.text}
              </div>
            )}

            <div className={activeTab === "tasks" ? "" : "pb-12"}>
              {activeTab === "repos" && (
                <RepositoriesView
                  data={data}
                  refreshNow={refreshNow}
                  setFlash={setFlash}
                  fetchJson={fetchJson}
                />
              )}
              {activeTab === "tasks" && <TasksView data={data} />}
              {activeTab === "conflicts" && <ConflictsView data={data} />}
              {activeTab === "settings" && <SettingsView data={data} />}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
