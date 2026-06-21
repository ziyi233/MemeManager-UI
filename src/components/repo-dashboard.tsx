"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, GitBranch, Plus, RefreshCw, Trash2 } from "lucide-react"

import type { Job, ManagedRepo, RepoLogEntry } from "@/lib/meme-manager"

export type DashboardData = {
  repos: ManagedRepo[]
  jobs: Job[]
  summary: {
    count: number
    totalMemeCount: number
    linkedMemeCount: number
    conflictCount: number
    dataRoot: string
    managedMemesDir: string
    memeGeneratorMemeDirsEnv: string
    repoUrlPrefixConfigured: boolean
    reloadConfigured: boolean
    autoReloadEnabled: boolean
  }
}

function getJobStatusLabel(status: Job["status"]) {
  switch (status) {
    case "running":
      return "进行中"
    case "succeeded":
      return "成功"
    case "failed":
      return "失败"
    default:
      return "排队中"
  }
}

function getJobTone(status: Job["status"]): RepoTone {
  if (status === "succeeded") return "success"
  if (status === "failed") return "danger"
  return "pending"
}

function formatJobType(type: Job["type"]) {
  switch (type) {
    case "sync":
      return "同步仓库"
    case "sync_all":
      return "全部同步"
    case "remove":
      return "移除仓库"
    default:
      return "重载 API"
  }
}

function formatLog(log: RepoLogEntry) {
  return `${log.timestamp} ${log.level === "error" ? "[ERROR]" : "[INFO]"} ${log.message}`
}

type RepoTone = "success" | "pending" | "danger"
type FlashMessage = {
  type: "success" | "error"
  text: string
} | null

const statusClassName: Record<RepoTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
}

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

function formatMeta(repo: ManagedRepo) {
  const parts = [`分支: ${repo.branch}`]
  if (repo.memeRoot) parts.push(`根目录: ${repo.memeRoot}`)
  if (repo.lastCommitHash) parts.push(`提交: ${repo.lastCommitHash}`)
  if (repo.lastSyncedAt) parts.push(`上次同步: ${repo.lastSyncedAt}`)
  return parts.join(" | ")
}

function formatConflict(repo: ManagedRepo, conflict: ManagedRepo["conflicts"][number]) {
  if (conflict.ownerRepoId === repo.id) {
    return `${conflict.memeName} 已由当前仓库占用，与 ${conflict.conflictingRepoName} 重名`
  }

  return `${conflict.memeName} 与 ${conflict.ownerRepoName} 重名，当前未写入共享目录`
}

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

export function RepoDashboard({
  initialData,
}: {
  initialData: DashboardData
}) {
  const [data, setData] = useState(initialData)
  const [flash, setFlash] = useState<FlashMessage>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRepoIds, setPendingRepoIds] = useState<Record<string, "syncing" | "deleting" | "saving" | "toggling">>({})
  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialData.jobs[0]?.id || null)

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
      } catch {
      }
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
      setSelectedJobId((current) => {
        if (payload.job.status === "failed") {
          return payload.job.id
        }
        return current || payload.job.id
      })
    }

    eventSource.addEventListener("job_created", (event) => handleJobEvent(event as MessageEvent<string>))
    eventSource.addEventListener("job_updated", (event) => handleJobEvent(event as MessageEvent<string>))
    eventSource.addEventListener("job_log", (event) => handleJobEvent(event as MessageEvent<string>))

    return () => {
      eventSource.close()
    }
  }, [])

  const repoCount = useMemo(() => data.repos.length, [data.repos.length])
  const selectedJob = data.jobs.find((job) => job.id === selectedJobId) || data.jobs[0] || null

  function setPending(repoId: string, value?: "syncing" | "deleting" | "saving" | "toggling") {
    setPendingRepoIds((current) => {
      const next = { ...current }
      if (value) {
        next[repoId] = value
      } else {
        delete next[repoId]
      }
      return next
    })
  }

  async function refreshNow() {
    const nextData = await fetchJson<DashboardData>("/api/repos", { cache: "no-store" })
    setData(nextData)
  }

  async function handleAddRepository(formData: FormData) {
    setIsSubmitting(true)
    setFlash(null)

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
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "添加仓库失败" })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSyncAll() {
    setFlash(null)
    try {
      await fetchJson("/api/repos/sync-all", { method: "POST", body: JSON.stringify({}) })
      setFlash({ type: "success", text: "已加入同步队列" })
      await refreshNow()
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
    setPending(repoId, "deleting")
    try {
      await fetchJson(`/api/repos/${repoId}`, { method: "DELETE" })
      await refreshNow()
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "移除仓库失败" })
      setPending(repoId)
    }
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div>
          <p className="text-[13px] font-medium text-[var(--foreground-muted)]">MemeManager</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.96px]">表情仓库</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReloadMemeApi()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-[14px] font-medium text-[var(--foreground)] transition-colors hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            重载 Meme API
          </button>
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-[14px] font-medium text-[var(--foreground)] transition-colors hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            全部同步
          </button>
        </div>
      </header>

      {flash ? (
        <section
          aria-live="polite"
          className={`mt-4 rounded-md border px-4 py-3 text-[14px] ${flash.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
        >
          {flash.text}
        </section>
      ) : null}

      <section className="grid min-w-0 gap-8 py-8 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="grid h-fit min-w-0 gap-5">
          <section id="content" className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background-subtle)] p-5" style={{ scrollMarginTop: 24 }}>
            <h2 className="text-[16px] font-medium">添加仓库</h2>
            <form
              className="mt-4 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleAddRepository(new FormData(event.currentTarget))
                event.currentTarget.reset()
              }}
            >
              <label className="grid gap-2 text-[13px] font-medium text-[var(--foreground-muted)]">
                仓库地址
                <input name="repositoryUrl" type="url" inputMode="url" autoComplete="off" placeholder="https://github.com/example/memes.git" className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-[14px] text-[var(--foreground)] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
              </label>

              <label className="grid gap-2 text-[13px] font-medium text-[var(--foreground-muted)]">
                分支
                <input name="branch" type="text" autoComplete="off" placeholder="main" className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-[14px] text-[var(--foreground)] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
              </label>

              <label className="grid gap-2 text-[13px] font-medium text-[var(--foreground-muted)]">
                表情根目录
                <input name="customMemeRoot" type="text" autoComplete="off" placeholder="留空时自动识别，如 memes / meme / emoji" className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-[14px] text-[var(--foreground)] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--foreground)] px-3 text-[14px] font-medium text-white transition-colors hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus aria-hidden="true" className="mr-2 size-4" />
                {isSubmitting ? "添加中..." : "添加为未同步仓库"}
              </button>
            </form>

            <div className="mt-6 border-t border-[var(--border)] pt-4 text-[13px] leading-5 text-[var(--foreground-muted)]">
              <p>未同步仓库只保存配置，不会立刻拉代码</p>
              <p className="mt-2">同步成功后，启用中的仓库会自动汇总到共享目录</p>
              <p className="mt-2">当前统计：{data.summary.totalMemeCount} 个表情，{data.summary.linkedMemeCount} 个已共享，{data.summary.conflictCount} 处冲突</p>
              <p className="mt-2">
                {data.summary.repoUrlPrefixConfigured
                  ? "当前已配置仓库拉取源前缀，同步时会优先走镜像源"
                  : "当前直接从仓库原始地址拉取，网络差时可以配置仓库拉取源前缀"}
              </p>
              <p className="mt-2">
                {data.summary.reloadConfigured
                  ? data.summary.autoReloadEnabled
                    ? "已配置自动重载，同步成功后会调用 Meme API 的 reload 接口"
                    : "已配置手动重载，可以在右上角点击按钮调用 Meme API 的 reload 接口"
                  : "还未配置 Meme API 重载方式，新增表情后需要你手动触发 meme-generator 的 /memes/reload"}
              </p>
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background-subtle)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-[16px] font-medium">最近任务</h2>
              <span className="text-[12px] text-[var(--foreground-muted)]">{data.jobs.length} 条</span>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
              {data.jobs.length ? data.jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`min-w-[200px] rounded-md border px-3 py-2.5 text-left transition-colors ${selectedJob?.id === job.id ? "border-[var(--foreground)] bg-white" : "border-[var(--border)] bg-white/60 hover:bg-white"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-medium text-[var(--foreground)]">{formatJobType(job.type)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName[getJobTone(job.status)]}`}>{getJobStatusLabel(job.status)}</span>
                  </div>
                  <p className="mt-1.5 truncate text-[11px] text-[var(--foreground-muted)]">{job.repoName || "全局任务"}</p>
                  <p className="mt-1 truncate text-[11px] text-[var(--foreground-muted)]">{job.message || "无任务说明"}</p>
                </button>
              )) : <p className="text-[13px] text-[var(--foreground-muted)]">还没有任务记录</p>}
            </div>

            <div className="mt-3 rounded-md border border-[var(--border)] bg-white p-3">
              {selectedJob ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2">
                    <span className="text-[13px] font-medium">{formatJobType(selectedJob.type)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName[getJobTone(selectedJob.status)]}`}>{getJobStatusLabel(selectedJob.status)}</span>
                  </div>
                  <pre className="mt-3 h-[300px] overflow-auto rounded-md border border-[var(--border)] bg-[#0b1020] p-3 font-mono text-[12px] leading-5 text-[#d7e0ff] whitespace-pre-wrap">{selectedJob.logs.length ? selectedJob.logs.map((log) => formatLog(log)).join("\n") : "等待日志输出..."}</pre>
                </>
              ) : (
                <p className="text-[13px] text-[var(--foreground-muted)]">还没有任务记录</p>
              )}
            </div>
          </section>
        </section>

        <section className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <h2 className="text-[16px] font-medium">仓库列表</h2>
            <span className="text-[13px] text-[var(--foreground-muted)]">
              共 {repoCount} 个，{data.summary.linkedMemeCount} 个已共享
              {data.summary.conflictCount ? `，${data.summary.conflictCount} 处冲突` : ""}
            </span>
          </div>

          <div className="divide-y divide-[var(--border)]">
            {data.repos.map((repo) => {
              const localPending = pendingRepoIds[repo.id]
              const busy = repo.status === "syncing" || repo.status === "deleting" || Boolean(localPending)
              const conflicts = repo.conflicts || []

              return (
                <article key={repo.id} className="grid min-w-0 gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-[14px] font-medium">{repo.name}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[12px] ${statusClassName[getRepoTone(repo.status)]}`}>{getRepoStatusLabel(repo.status)}</span>
                      {!repo.enabled ? <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--foreground-muted)]">已停用</span> : null}
                    </div>

                    <div className="mt-2 flex min-w-0 items-center gap-2 text-[13px] text-[var(--foreground-muted)]">
                      <GitBranch aria-hidden="true" className="size-4 shrink-0" />
                      <code translate="no" className="min-w-0 truncate font-mono text-[13px]">{repo.url}</code>
                    </div>

                    <p className="mt-2 text-[13px] text-[var(--foreground-muted)]">{formatMeta(repo)}</p>
                    <p className="mt-2 text-[13px] text-[var(--foreground-muted)]">{formatDetail(repo)}</p>

                    <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                      <span className="rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-[var(--foreground-muted)]">表情 {repo.memeCount}</span>
                      <span className="rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-[var(--foreground-muted)]">共享 {repo.linkedMemeCount}</span>
                      {repo.conflictCount ? <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">冲突 {repo.conflictCount}</span> : null}
                    </div>

                    {conflicts.length ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
                        <div className="flex items-center gap-2 font-medium">
                          <AlertTriangle aria-hidden="true" className="size-4" />
                          重名表情
                        </div>
                        <div className="mt-2 grid gap-1">
                          {conflicts.slice(0, 5).map((conflict) => (
                            <p key={`${conflict.memeName}-${conflict.ownerRepoId}-${conflict.conflictingRepoId}`}>{formatConflict(repo, conflict)}</p>
                          ))}
                          {conflicts.length > 5 ? <p>还有 {conflicts.length - 5} 处冲突未显示</p> : null}
                        </div>
                      </div>
                    ) : null}

                    <form
                      className="mt-3 flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const formData = new FormData(event.currentTarget)
                        void handleSaveRoot(repo.id, String(formData.get("customMemeRoot") || ""))
                      }}
                    >
                      <input name="customMemeRoot" type="text" defaultValue={repo.customMemeRoot || repo.memeRoot || ""} autoComplete="off" aria-label="表情根目录" placeholder="手动指定表情根目录" className="h-8 min-w-[220px] rounded-md border border-[var(--border)] bg-white px-3 text-[13px] text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
                      <button type="submit" disabled={busy} className="inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-white px-3 text-[13px] font-medium text-[var(--foreground)] transition-colors hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">
                        {localPending === "saving" ? "保存中..." : "保存根目录"}
                      </button>
                    </form>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                    <button type="button" onClick={() => void handleSync(repo.id)} disabled={busy} className="inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-white px-3 text-[14px] font-medium text-[var(--foreground)] transition-colors hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">
                      {repo.status === "syncing" || localPending === "syncing" ? "同步中..." : "同步"}
                    </button>
                    <button type="button" onClick={() => void handleToggle(repo.id, !repo.enabled)} disabled={busy} className="inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-white px-3 text-[14px] font-medium text-[var(--foreground)] transition-colors hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">
                      {localPending === "toggling" ? "更新中..." : repo.enabled ? "停用" : "启用"}
                    </button>
                    <button type="button" onClick={() => void handleRemove(repo.id)} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-[14px] font-medium text-[var(--foreground-muted)] transition-colors hover:bg-[#fafafa] hover:text-[var(--danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">
                      <Trash2 aria-hidden="true" className="size-4" />
                      {repo.status === "deleting" || localPending === "deleting" ? "删除中..." : "移除"}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>

        </section>
      </section>
    </>
  )
}
