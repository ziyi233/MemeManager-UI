"use client"

import { useEffect, useMemo, useState } from "react"
import { GitBranch, Plus, RefreshCw, Trash2 } from "lucide-react"

import type { ManagedRepo } from "@/lib/meme-manager"

type DashboardData = {
  repos: ManagedRepo[]
  summary: {
    count: number
    dataRoot: string
    managedMemesDir: string
    memeGeneratorMemeDirsEnv: string
  }
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

  const repoCount = useMemo(() => data.repos.length, [data.repos.length])

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

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <section id="content" className="h-fit rounded-xl border border-[var(--border)] bg-[var(--background-subtle)] p-5" style={{ scrollMarginTop: 24 }}>
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
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <h2 className="text-[16px] font-medium">仓库列表</h2>
            <span className="text-[13px] text-[var(--foreground-muted)]">共 {repoCount} 个</span>
          </div>

          <div className="divide-y divide-[var(--border)]">
            {data.repos.map((repo) => {
              const localPending = pendingRepoIds[repo.id]
              const busy = repo.status === "syncing" || repo.status === "deleting" || Boolean(localPending)

              return (
                <article key={repo.id} className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-[14px] font-medium">{repo.name}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[12px] ${statusClassName[getRepoTone(repo.status)]}`}>{getRepoStatusLabel(repo.status)}</span>
                      {!repo.enabled ? <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--foreground-muted)]">已停用</span> : null}
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-[13px] text-[var(--foreground-muted)]">
                      <GitBranch aria-hidden="true" className="size-4" />
                      <code translate="no" className="min-w-0 truncate font-mono text-[13px]">{repo.url}</code>
                    </div>

                    <p className="mt-2 text-[13px] text-[var(--foreground-muted)]">{formatMeta(repo)}</p>
                    <p className="mt-2 text-[13px] text-[var(--foreground-muted)]">{formatDetail(repo)}</p>

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

                  <div className="flex flex-wrap gap-2 md:justify-end">
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
