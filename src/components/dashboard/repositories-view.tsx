"use client"

import { Fragment, useState } from "react"
import { AlertTriangle, Plus, Trash2, RefreshCw, Power, FolderArchive, Square } from "lucide-react"

import type { DashboardData, ManagedRepoView } from "@/lib/meme-manager"
import type { FlashMessage } from "./dashboard-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type RepoTone = "success" | "pending" | "danger"

function getRepoTone(status: ManagedRepoView["status"]): RepoTone {
  if (status === "ready") return "success"
  if (status === "error") return "danger"
  return "pending"
}

function getRepoStatusLabel(status: ManagedRepoView["status"]) {
  switch (status) {
    case "ready": return "已同步"
    case "error": return "异常"
    case "syncing": return "同步中"
    case "deleting": return "删除中"
    default: return "未同步"
  }
}

function formatDetail(repo: ManagedRepoView) {
  if (!repo.enabled) return "已停用，不写入共享目录"
  if (repo.status === "error") return repo.lastError || repo.statusMessage || "同步失败"
  if (repo.status === "deleting") return repo.statusMessage || "正在删除"
  if (repo.status === "syncing") return repo.statusMessage || "正在同步"
  if (repo.status === "unsynced") return repo.localExists ? "已添加但未同步" : "本地文件已删除，配置记录保留"
  return repo.statusMessage || "已同步"
}

function formatConflict(repo: ManagedRepoView, conflict: ManagedRepoView["conflicts"][number]) {
  if (conflict.ownerRepoId === repo.id) {
    return `${conflict.memeName} (已有，与 ${conflict.conflictingRepoName} 冲突)`
  }
  return `${conflict.memeName} (与 ${conflict.ownerRepoName} 冲突)`
}

interface RepositoriesViewProps {
  data: DashboardData
  refreshNow: () => Promise<void>
  setFlash: (msg: FlashMessage) => void
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>
}

export function RepositoriesView({ data, refreshNow, setFlash, fetchJson }: RepositoriesViewProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRepoIds, setPendingRepoIds] = useState<Record<string, string>>({})
  const [showAddForm, setShowAddForm] = useState(false)

  function setPending(repoId: string, value?: string) {
    setPendingRepoIds((current) => {
      const next = { ...current }
      if (value) next[repoId] = value
      else delete next[repoId]
      return next
    })
  }

  async function handleAddRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setFlash(null)

    const formData = new FormData(event.currentTarget)
    try {
      await fetchJson("/api/repos", {
        method: "POST",
        body: JSON.stringify({
          url: String(formData.get("repositoryUrl") || ""),
          branch: String(formData.get("branch") || "main"),
          customMemeRoot: String(formData.get("customMemeRoot") || ""),
        }),
      })
      await refreshNow()
      setFlash({ type: "success", text: "仓库添加成功，当前为未同步状态" })
      setShowAddForm(false)
      ;(event.target as HTMLFormElement).reset()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "添加仓库失败" })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSync(repoId: string) {
    setPending(repoId, "syncing")
    try {
      await fetchJson(`/api/repos/${repoId}/sync`, { method: "POST", body: JSON.stringify({}) })
      await refreshNow()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "同步失败" })
    } finally {
      setPending(repoId)
    }
  }

  async function handleToggle(repoId: string, enabled: boolean) {
    setPending(repoId, "toggling")
    try {
      await fetchJson(`/api/repos/${repoId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      await refreshNow()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "状态更新失败" })
    } finally {
      setPending(repoId)
    }
  }

  async function handleSaveRoot(repoId: string, customMemeRoot: string) {
    setPending(repoId, "saving")
    try {
      await fetchJson(`/api/repos/${repoId}`, {
        method: "PATCH",
        body: JSON.stringify({ customMemeRoot }),
      })
      await refreshNow()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "保存配置失败" })
    } finally {
      setPending(repoId)
    }
  }

  async function handleRemove(repoId: string) {
    if (!window.confirm("确定要移除这个仓库吗？")) return
    setPending(repoId, "deleting")
    try {
      await fetchJson(`/api/repos/${repoId}`, { method: "DELETE" })
      await refreshNow()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "移除失败" })
      setPending(repoId)
    }
  }

  async function handleStopJob(repoId: string, jobId: string) {
    setPending(repoId, "stopping")
    try {
      await fetchJson(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      await refreshNow()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "停止任务失败" })
    } finally {
      setPending(repoId)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">仓库列表</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {data.repos.length} 个受管仓库，{data.summary.linkedMemeCount} 个已共享表情
            {data.summary.conflictCount > 0 && <span className="text-amber-600 ml-1">· {data.summary.conflictCount} 处冲突</span>}
          </p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} className="shrink-0 bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
          <Plus className="mr-2 size-4" />
          添加仓库
        </Button>
      </div>

      {showAddForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6 shadow-sm overflow-hidden relative">
          <div className="absolute top-0 left-0 w-1 h-full bg-zinc-900 dark:bg-zinc-100" />
          <h3 className="text-base font-semibold mb-5">注册新仓库</h3>
          <form className="grid gap-5 md:grid-cols-4 md:items-end" onSubmit={handleAddRepository}>
            <div className="grid gap-2 md:col-span-2">
              <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">仓库 URL</label>
              <Input name="repositoryUrl" type="url" placeholder="https://github.com/example/memes.git" required className="h-9" />
            </div>
            <div className="grid gap-2">
              <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Git 分支</label>
              <Input name="branch" type="text" placeholder="main" defaultValue="main" className="h-9 font-mono text-sm" />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">表情提取目录</label>
              <Input name="customMemeRoot" type="text" placeholder="留空时自动识别" className="h-9 font-mono text-sm" />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)}>取消</Button>
              <Button type="submit" disabled={isSubmitting} className="min-w-[100px]">
                {isSubmitting ? "注册中..." : "确认注册"}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {data.repos.length === 0 ? (
          <div className="px-6 py-12 text-center text-zinc-500 text-sm">
            没有任何仓库
          </div>
        ) : (
          data.repos.map((repo) => {
            const localPending = pendingRepoIds[repo.id]
            const busy = repo.status === "syncing" || repo.status === "deleting" || Boolean(localPending)
            const canStop = (repo.status === "syncing" || repo.status === "deleting") && Boolean(repo.lastJobId)
            const conflicts = repo.conflicts || []
            const tone = getRepoTone(repo.status)

            return (
              <div key={repo.id} className={`flex flex-col lg:flex-row gap-6 p-5 lg:items-center bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors ${!repo.enabled || !repo.localExists ? "opacity-60 grayscale-[0.35]" : ""}`}>
                {/* Left: Identity */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-[15px] truncate max-w-[250px]" title={repo.name}>{repo.name}</span>
                    <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px] tracking-wide rounded-sm font-medium bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                      {repo.branch}
                    </Badge>
                    {!repo.enabled && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] rounded-sm text-zinc-500">已停用</Badge>
                    )}
                    {!repo.localExists && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] rounded-sm text-zinc-500">仅记录</Badge>
                    )}
                    {tone === "danger" && (
                      <Badge variant="destructive" className="h-5 px-1.5 text-[10px] rounded-sm bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800">异常</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-zinc-800">url</span>
                      <span className="min-w-0 truncate text-[13px] font-mono" title={repo.url}>{repo.url}</span>
                    </div>
                  </div>
                  <div className="text-[12px] text-zinc-500 mt-1 flex items-center gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${tone === "success" ? "bg-emerald-500" : tone === "pending" ? "bg-amber-400" : "bg-rose-500"}`} />
                      {formatDetail(repo)}
                    </span>
                    {repo.lastCommitHash && (
                      <>
                        <span className="opacity-40">•</span>
                        <span className="font-mono">{repo.lastCommitHash.slice(0, 7)}</span>
                      </>
                    )}
                  </div>
                  
                  {conflicts.length > 0 && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 flex items-start gap-1">
                      <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                      <span>{conflicts.length} 处冲突 (如: {conflicts.slice(0, 2).map((c) => formatConflict(repo, c)).join(", ")})</span>
                    </div>
                  )}
                </div>

                {/* Middle: Stats & Config */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 lg:gap-8 shrink-0">
                  <div className="flex gap-4 sm:gap-6">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-0.5">Total</span>
                      <span className="text-sm font-semibold">{repo.memeCount}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-0.5">Shared</span>
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-500">{repo.linkedMemeCount}</span>
                    </div>
                  </div>

                  <form 
                    className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const fd = new FormData(e.currentTarget)
                      void handleSaveRoot(repo.id, String(fd.get("customMemeRoot") || ""))
                    }}
                  >
                    <div className="relative">
                      <FolderArchive className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400" />
                      <Input
                        name="customMemeRoot"
                        defaultValue={repo.customMemeRoot || repo.memeRoot || ""}
                        placeholder="根目录"
                        className="h-8 pl-8 text-xs font-mono w-[140px] focus:w-[180px] transition-all bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 focus:bg-white"
                      />
                    </div>
                    <Button type="submit" variant="secondary" size="sm" disabled={busy} className="h-8 text-xs shrink-0 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                      {localPending === "saving" ? "保存中" : "保存路径"}
                    </Button>
                  </form>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center justify-end gap-2 shrink-0 border-t lg:border-t-0 pt-4 lg:pt-0 mt-2 lg:mt-0 w-full lg:w-auto border-zinc-100 dark:border-zinc-800">
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleSync(repo.id)} disabled={busy} className="h-8 text-xs w-20">
                    {localPending === "syncing" ? <RefreshCw className="size-3 animate-spin mr-1.5" /> : null}
                    {localPending === "syncing" ? "同步中" : "同步"}
                  </Button>
                  {canStop ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleStopJob(repo.id, repo.lastJobId as string)} disabled={localPending === "stopping"} className="h-8 text-xs w-20 border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900/60 dark:text-amber-400 dark:hover:bg-amber-950/40">
                      <Square className="size-3 mr-1.5" />
                      {localPending === "stopping" ? "停止中" : "停止"}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleToggle(repo.id, !repo.enabled)} disabled={busy} className="h-8 text-xs w-20">
                    <Power className={`size-3 mr-1.5 ${repo.enabled ? "text-rose-500" : "text-emerald-500"}`} />
                    {repo.enabled ? "停用" : "启用"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void handleRemove(repo.id)} disabled={busy} className="h-8 text-xs text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50">
                    <Trash2 className="size-3.5 mr-1.5" />
                    {repo.localExists ? "删除文件" : "移除记录"}
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
