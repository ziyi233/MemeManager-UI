"use client"

import { Fragment, useState } from "react"
import { AlertTriangle, GitBranch, Plus, Trash2 } from "lucide-react"

import type { DashboardData, ManagedRepo } from "@/lib/meme-manager"
import type { FlashMessage } from "./dashboard-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type RepoTone = "success" | "pending" | "danger"

function getRepoTone(status: ManagedRepo["status"]): RepoTone {
  if (status === "ready") return "success"
  if (status === "error") return "danger"
  return "pending"
}

function getRepoStatusLabel(status: ManagedRepo["status"]) {
  switch (status) {
    case "ready":
      return "已同步"
    case "error":
      return "异常"
    case "syncing":
      return "同步中"
    case "deleting":
      return "删除中"
    default:
      return "未同步"
  }
}

function formatDetail(repo: ManagedRepo) {
  if (!repo.enabled) return "已停用，不会写入共享 meme 目录"
  if (repo.status === "error") return repo.lastError || repo.statusMessage || "同步失败"
  if (repo.status === "deleting") return repo.statusMessage || "正在删除仓库"
  if (repo.status === "syncing") return repo.statusMessage || "正在同步仓库"
  if (repo.status === "unsynced") return "已添加但未同步，不占用共享 meme 目录"
  return repo.statusMessage || "已同步"
}

function formatConflict(repo: ManagedRepo, conflict: ManagedRepo["conflicts"][number]) {
  if (conflict.ownerRepoId === repo.id) {
    return `${conflict.memeName} 已由当前仓库占用，与 ${conflict.conflictingRepoName} 重名`
  }
  return `${conflict.memeName} 与 ${conflict.ownerRepoName} 重名，当前未写入共享目录`
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
      setFlash({ type: "success", text: "仓库已添加，当前为未同步状态" })
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
      setFlash({ type: "error", text: error instanceof Error ? error.message : "仓库同步失败" })
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
      setFlash({ type: "error", text: error instanceof Error ? error.message : "更新仓库状态失败" })
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
      setFlash({ type: "error", text: error instanceof Error ? error.message : "更新 Meme Root 失败" })
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
      setFlash({ type: "error", text: error instanceof Error ? error.message : "移除仓库失败" })
      setPending(repoId)
    }
  }

  const statusClassName: Record<RepoTone, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">仓库列表</h2>
          <p className="text-sm text-muted-foreground mt-1">
            共 {data.repos.length} 个，{data.summary.linkedMemeCount} 个已共享
            {data.summary.conflictCount ? `，${data.summary.conflictCount} 处冲突` : ""}
          </p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="mr-2 size-4" />
          添加仓库
        </Button>
      </div>

      {showAddForm && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-medium mb-4">添加新仓库</h3>
          <form className="grid gap-4 md:grid-cols-4 md:items-end" onSubmit={handleAddRepository}>
            <div className="grid gap-2 md:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">仓库地址</label>
              <Input name="repositoryUrl" type="url" placeholder="https://github.com/example/memes.git" required />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-muted-foreground">分支</label>
              <Input name="branch" type="text" placeholder="main" defaultValue="main" />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">表情根目录</label>
              <Input name="customMemeRoot" type="text" placeholder="留空时自动识别，如 memes / meme / emoji" />
            </div>
            <div className="md:col-span-1 flex gap-2">
              <Button type="button" variant="outline" className="w-full" onClick={() => setShowAddForm(false)}>取消</Button>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "添加中..." : "确认添加"}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-md border bg-card shadow-sm overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[30%]">仓库</TableHead>
              <TableHead className="w-[20%]">状态</TableHead>
              <TableHead className="w-[15%]">统计</TableHead>
              <TableHead className="w-[20%]">根目录</TableHead>
              <TableHead className="w-[15%] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.repos.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  还没有添加任何仓库
                </TableCell>
              </TableRow>
            )}
            {data.repos.map((repo) => {
              const localPending = pendingRepoIds[repo.id]
              const busy = repo.status === "syncing" || repo.status === "deleting" || Boolean(localPending)
              const conflicts = repo.conflicts || []
              const tone = getRepoTone(repo.status)

              return (
                <Fragment key={repo.id}>
                  <TableRow className="align-top">
                    <TableCell className="py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate max-w-[200px]" title={repo.name}>{repo.name}</span>
                        {!repo.enabled && <Badge variant="secondary" className="text-[10px] px-1.5 h-4">已停用</Badge>}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <GitBranch className="size-3 shrink-0" />
                        <span className="truncate max-w-[200px]" title={repo.url}>{repo.url}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        分支: {repo.branch} {repo.lastCommitHash && `(${repo.lastCommitHash.slice(0, 7)})`}
                      </div>
                    </TableCell>

                    <TableCell className="py-4">
                      <Badge variant="outline" className={`font-normal ${statusClassName[tone]}`}>
                        {getRepoStatusLabel(repo.status)}
                      </Badge>
                      <p className="mt-2 text-xs text-muted-foreground line-clamp-2" title={formatDetail(repo)}>
                        {formatDetail(repo)}
                      </p>
                      {repo.lastSyncedAt && (
                        <p className="mt-1 text-[10px] text-muted-foreground">同步于: {repo.lastSyncedAt}</p>
                      )}
                    </TableCell>

                    <TableCell className="py-4">
                      <div className="flex gap-3">
                        <div className="text-center">
                          <div className="text-sm font-semibold">{repo.memeCount}</div>
                          <div className="text-[10px] text-muted-foreground">总数</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-semibold">{repo.linkedMemeCount}</div>
                          <div className="text-[10px] text-muted-foreground">已共享</div>
                        </div>
                        <div className="text-center">
                          <div className={`text-sm font-semibold ${repo.conflictCount ? "text-amber-600" : ""}`}>
                            {repo.conflictCount}
                          </div>
                          <div className="text-[10px] text-muted-foreground">冲突</div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="py-4">
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const fd = new FormData(e.currentTarget)
                          void handleSaveRoot(repo.id, String(fd.get("customMemeRoot") || ""))
                        }}
                      >
                        <Input
                          name="customMemeRoot"
                          defaultValue={repo.customMemeRoot || repo.memeRoot || ""}
                          placeholder="自动识别"
                          className="h-8 text-xs"
                        />
                        <Button type="submit" variant="secondary" size="sm" disabled={busy} className="h-8 px-2">
                          {localPending === "saving" ? "保存中" : "保存"}
                        </Button>
                      </form>
                    </TableCell>

                    <TableCell className="py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleSync(repo.id)} disabled={busy} className="h-8 px-2">
                          {localPending === "syncing" ? "同步中" : "同步"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleToggle(repo.id, !repo.enabled)} disabled={busy} className="h-8 px-2">
                          {localPending === "toggling" ? "..." : repo.enabled ? "停用" : "启用"}
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => void handleRemove(repo.id)} disabled={busy} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {conflicts.length > 0 && (
                    <TableRow className="bg-amber-50/50 hover:bg-amber-50/50">
                      <TableCell colSpan={5} className="py-2 text-xs text-amber-800">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold">重名冲突：</span>
                            {conflicts.slice(0, 3).map((c) => formatConflict(repo, c)).join("；")}
                            {conflicts.length > 3 && ` 等 ${conflicts.length} 处冲突`}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
