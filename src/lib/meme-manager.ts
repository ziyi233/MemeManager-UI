import { exec, execFile, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)
const jobEventBus = new EventEmitter()

export type DashboardData = {
  repos: ManagedRepoView[]
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

export type RepoStatus = "unsynced" | "syncing" | "ready" | "error" | "deleting"

export type RepoConfig = {
  id: string
  name: string
  url: string
  branch: string
  enabled: boolean
  customMemeRoot: string | null
}

export type RepoState = {
  repoId: string
  status: RepoStatus
  statusMessage: string | null
  memeRoot: string | null
  lastSyncStartedAt: string | null
  lastSyncedAt: string | null
  lastSyncFinishedAt: string | null
  lastCommitHash: string | null
  lastError: string | null
  deleteStartedAt: string | null
  lastJobId: string | null
  memeCount: number
  linkedMemeCount: number
  conflictCount: number
  conflicts: MemeConflict[]
  recentLogs: RepoLogEntry[]
}

export type ManagedRepo = RepoConfig & RepoState

export type ManagedRepoView = ManagedRepo & {
  localExists: boolean
}

export type RepoLogEntry = {
  timestamp: string
  level: "info" | "error"
  message: string
}

export type MemeConflict = {
  memeName: string
  ownerRepoId: string
  ownerRepoName: string
  conflictingRepoId: string
  conflictingRepoName: string
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled"

export type Job = {
  id: string
  type: "sync" | "sync_all" | "remove" | "reload"
  repoId: string | null
  repoName: string | null
  status: JobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  message: string | null
  error: string | null
  logs: RepoLogEntry[]
}

export type JobEvent = {
  type: "job_created" | "job_updated" | "job_log"
  job: Job
  log?: RepoLogEntry
}

type RepoScanEntry = ManagedRepoView & {
  memeNames: string[]
  memeRootPath: string | null
}

type RepoScanOptions = {
  includeActiveJobs?: boolean
}

type SyncTaskResult = SyncResult & {
  logs: string[]
}

type RepoConfigStore = {
  repos: RepoConfig[]
}

type JobStore = {
  jobs: Job[]
}

type ExampleConfig = {
  repos?: Array<{
    url: string
    branch?: string
    customMemeRoot?: string
    enabled?: boolean
  }>
}

type SyncResult = {
  updated: boolean
  commitHash: string | null
  memeRoot: string
}

type ReloadResult = {
  mode: "url" | "command"
}

const MEME_ROOT_CANDIDATES = ["memes", "meme", "emoji"]

const repoLocks = new Map<string, Promise<void>>()
const activeRepoJobs = new Map<string, string>()
const activeJobControllers = new Map<string, AbortController>()
let stateWriteLock: Promise<void> = Promise.resolve()
let rebuildLock: Promise<void> = Promise.resolve()

function getDataRoot() {
  const configured = process.env.DATA_ROOT?.trim()
  if (configured) {
    return path.resolve(configured)
  }

  return path.join(process.cwd(), "data")
}

function getConfigDir() {
  return path.join(getDataRoot(), "config")
}

function getStateDir() {
  return path.join(getDataRoot(), "state")
}

function getConfigFile() {
  return path.join(getConfigDir(), "repos.json")
}

function getJobsFile() {
  return path.join(getStateDir(), "jobs.json")
}

function getExampleConfigFile() {
  return path.join(getDataRoot(), "example-config.json")
}

function getReposDir() {
  return path.join(getDataRoot(), "repos")
}

function getManagedMemesDir() {
  return path.join(getDataRoot(), "managed", "memes")
}

function nowIso() {
  return new Date().toISOString()
}

function buildJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isTruthy(value?: string) {
  if (!value) {
    return false
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function getReloadUrl() {
  return process.env.MEME_API_RELOAD_URL?.trim() || ""
}

function getRepoUrlPrefix() {
  return process.env.MEME_REPO_URL_PREFIX?.trim() || ""
}

function getReloadCommand() {
  return process.env.MEME_API_RELOAD_COMMAND?.trim() || ""
}

function isReloadConfigured() {
  return Boolean(getReloadUrl() || getReloadCommand())
}

function isAutoReloadEnabled() {
  return isTruthy(process.env.MEME_API_AUTO_RELOAD)
}

function normalizeRepoName(url: string) {
  const repoName = url.split("/").filter(Boolean).pop() || "repo"
  return repoName.replace(/\.git$/i, "")
}

function resolveRepoGitUrl(url: string) {
  const prefix = getRepoUrlPrefix()
  if (!prefix) {
    return url
  }

  return `${prefix}${url}`
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function buildRepoId(url: string, existingIds: Set<string>) {
  const baseName = slugify(normalizeRepoName(url)) || `repo-${Date.now()}`
  let id = baseName
  let counter = 2

  while (existingIds.has(id)) {
    id = `${baseName}-${counter}`
    counter += 1
  }

  return id
}

function createRepoConfig(input: {
  id: string
  name: string
  url: string
  branch: string
  enabled?: boolean
  customMemeRoot?: string | null
}): RepoConfig {
  return {
    id: input.id,
    name: input.name,
    url: input.url,
    branch: input.branch,
    enabled: input.enabled ?? true,
    customMemeRoot: input.customMemeRoot || null,
  }
}

function createRepoState(repoId: string): RepoState {
  return {
    repoId,
    status: "unsynced",
    statusMessage: "已添加，等待首次同步",
    memeRoot: null,
    lastSyncStartedAt: null,
    lastSyncedAt: null,
    lastSyncFinishedAt: null,
    lastCommitHash: null,
    lastError: null,
    deleteStartedAt: null,
    lastJobId: null,
    memeCount: 0,
    linkedMemeCount: 0,
    conflictCount: 0,
    conflicts: [],
    recentLogs: [],
  }
}

function normalizeJob(job: Job): Job {
  return {
    ...job,
    repoId: job.repoId ?? null,
    repoName: job.repoName ?? null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    message: job.message ?? null,
    error: job.error ?? null,
    logs: Array.isArray(job.logs) ? job.logs : [],
  }
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function isGitRepository(targetPath: string) {
  return pathExists(path.join(targetPath, ".git"))
}

async function ensureStorage() {
  await ensureDir(getConfigDir())
  await ensureDir(getStateDir())
  await ensureDir(getReposDir())
  await ensureDir(getManagedMemesDir())
}

async function ensureExampleConfig() {
  const sourcePath = path.resolve(process.cwd(), "data", "example-config.json")
  const targetPath = getExampleConfigFile()

  if (await pathExists(targetPath)) {
    return
  }

  await ensureDir(path.dirname(targetPath))
  await fs.copyFile(sourcePath, targetPath)
}

async function withWriteLock<T>(type: "state" | "rebuild", task: () => Promise<T>) {
  const currentLock = type === "state" ? stateWriteLock : rebuildLock
  let release: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => {
    release = resolve
  })

  if (type === "state") {
    stateWriteLock = currentLock.then(() => nextLock)
  } else {
    rebuildLock = currentLock.then(() => nextLock)
  }

  await currentLock

  try {
    return await task()
  } finally {
    release()
  }
}

async function withRepoLock<T>(repoId: string, task: () => Promise<T>) {
  const currentLock = repoLocks.get(repoId) || Promise.resolve()
  let release: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => {
    release = resolve
  })
  repoLocks.set(repoId, currentLock.then(() => nextLock))

  await currentLock

  try {
    return await task()
  } finally {
    release()
    if (repoLocks.get(repoId) === nextLock) {
      repoLocks.delete(repoId)
    }
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    if (!raw.trim()) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback
    }

    if (error instanceof SyntaxError) {
      return fallback
    }

    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8")
  await fs.rename(tempPath, filePath)
}

async function seedDefaultDataIfNeeded() {
  await ensureStorage()
  await ensureExampleConfig()

  const configPath = getConfigFile()

  if (await pathExists(configPath)) {
    if (!(await pathExists(getJobsFile()))) {
      await writeJsonFile(getJobsFile(), { jobs: [] })
    }
    return
  }

  const example = await readJsonFile<ExampleConfig>(getExampleConfigFile(), {})
  const repoInputs = Array.isArray(example.repos) ? example.repos : []
  const existingIds = new Set<string>()

  const repos = repoInputs.map((repo) => {
    const id = buildRepoId(repo.url, existingIds)
    existingIds.add(id)
    return createRepoConfig({
      id,
      name: normalizeRepoName(repo.url),
      url: repo.url,
      branch: repo.branch || "main",
      enabled: repo.enabled ?? true,
      customMemeRoot: repo.customMemeRoot,
    })
  })

  if (!(await pathExists(configPath))) {
    await writeJsonFile(configPath, { repos })
  }

  if (!(await pathExists(getJobsFile()))) {
    await writeJsonFile(getJobsFile(), { jobs: [] })
  }
}

async function readConfigStore(): Promise<RepoConfigStore> {
  await seedDefaultDataIfNeeded()
  const parsed = await readJsonFile<RepoConfigStore>(getConfigFile(), { repos: [] })
  return {
    repos: Array.isArray(parsed.repos) ? parsed.repos : [],
  }
}

async function readJobStore(): Promise<JobStore> {
  await seedDefaultDataIfNeeded()
  const parsed = await readJsonFile<JobStore>(getJobsFile(), { jobs: [] })
  return {
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs.map((job) => normalizeJob(job)) : [],
  }
}

async function writeConfigStore(store: RepoConfigStore) {
  await ensureStorage()
  await writeJsonFile(getConfigFile(), store)
}

async function writeJobStore(store: JobStore) {
  await ensureStorage()
  await withWriteLock("state", async () => {
    await writeJsonFile(getJobsFile(), store)
  })
}

async function createJob(input: Pick<Job, "type" | "repoId" | "repoName" | "message">) {
  const jobStore = await readJobStore()
  const job: Job = {
    id: buildJobId(),
    type: input.type,
    repoId: input.repoId,
    repoName: input.repoName,
    status: "pending",
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    message: input.message,
    error: null,
    logs: [],
  }
  jobStore.jobs.unshift(job)
  jobStore.jobs = jobStore.jobs.slice(0, 100)
  await writeJobStore(jobStore)
  jobEventBus.emit("job", {
    type: "job_created",
    job,
  } satisfies JobEvent)
  return job
}

async function updateJob(jobId: string, patch: Partial<Job>) {
  const jobStore = await readJobStore()
  const index = jobStore.jobs.findIndex((job) => job.id === jobId)
  if (index === -1) {
    return
  }
  jobStore.jobs[index] = normalizeJob({
    ...jobStore.jobs[index],
    ...patch,
    id: jobStore.jobs[index].id,
  })
  await writeJobStore(jobStore)
  jobEventBus.emit("job", {
    type: "job_updated",
    job: jobStore.jobs[index],
  } satisfies JobEvent)
}

async function appendJobLog(jobId: string, level: "info" | "error", message: string) {
  const entry: RepoLogEntry = {
    timestamp: nowIso(),
    level,
    message,
  }

  const jobStore = await readJobStore()
  const index = jobStore.jobs.findIndex((job) => job.id === jobId)
  if (index === -1) {
    return
  }
  const job = jobStore.jobs[index]
  jobStore.jobs[index] = normalizeJob({
    ...job,
    logs: [...job.logs, entry].slice(-100),
  })
  await writeJobStore(jobStore)
  jobEventBus.emit("job", {
    type: "job_log",
    job: jobStore.jobs[index],
    log: entry,
  } satisfies JobEvent)
}

async function startJob(jobId: string, message: string) {
  await updateJob(jobId, {
    status: "running",
    startedAt: nowIso(),
    message,
  })
  await appendJobLog(jobId, "info", message)
}

async function finishJob(jobId: string, status: JobStatus, message: string, error?: string) {
  await updateJob(jobId, {
    status,
    finishedAt: nowIso(),
    message,
    error: error || null,
  })
  await appendJobLog(jobId, status === "failed" ? "error" : "info", message)
  if (error) {
    await appendJobLog(jobId, "error", error)
  }
}

async function runGit(args: string[], cwd?: string) {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  })
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

async function runGitStream(
  args: string[],
  cwd: string | undefined,
  onLine: (line: string, level: "info" | "error") => Promise<void>,
  signal?: AbortSignal,
) {
  await onLine(`$ git ${args.join(" ")}`, "info")

  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
    })

    if (signal?.aborted) {
      child.kill()
      reject(new Error("任务已取消"))
      return
    }

    const abort = () => {
      child.kill()
      reject(new Error("任务已取消"))
    }
    signal?.addEventListener("abort", abort, { once: true })

    let stdoutBuffer = ""
    let stderrBuffer = ""

    const flushBuffer = async (buffer: string, level: "info" | "error") => {
      const normalized = buffer.replace(/\r/g, "")
      const lines = normalized.split("\n")
      const tail = lines.pop() || ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) {
          void onLine(trimmed, level)
        }
      }
      return tail
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString()
      void flushBuffer(stdoutBuffer, "info").then((tail) => {
        stdoutBuffer = tail
      })
    })

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString()
      void flushBuffer(stderrBuffer, "error").then((tail) => {
        stderrBuffer = tail
      })
    })

    child.on("error", reject)
    child.on("close", async (code) => {
      signal?.removeEventListener("abort", abort)
      if (stdoutBuffer.trim()) {
        await onLine(stdoutBuffer.trim(), "info")
      }
      if (stderrBuffer.trim()) {
        await onLine(stderrBuffer.trim(), "error")
      }

      if (code === 0) {
        resolve()
        return
      }

      if (signal?.aborted) {
        reject(new Error("任务已取消"))
        return
      }

      reject(new Error(`git ${args[0]} 失败，退出码 ${code}`))
    })
  })
}

async function readGitOutput(args: string[], cwd?: string) {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  })
  return result.stdout.trim()
}

async function readGitOutputSafe(args: string[], cwd?: string) {
  try {
    return await readGitOutput(args, cwd)
  } catch {
    return null
  }
}

async function isMemeContainerDirectory(targetPath: string) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue
    }

    const initFile = path.join(targetPath, entry.name, "__init__.py")
    if (await pathExists(initFile)) {
      return true
    }
  }

  return false
}

async function listMemeDirectoryNames(memeRootPath: string) {
  const entries = await fs.readdir(memeRootPath, { withFileTypes: true })
  const names: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue
    }

    const initFile = path.join(memeRootPath, entry.name, "__init__.py")
    if (await pathExists(initFile)) {
      names.push(entry.name)
    }
  }

  return names.sort((left, right) => left.localeCompare(right))
}

async function detectMemeRoot(repoPath: string) {
  for (const candidate of MEME_ROOT_CANDIDATES) {
    const candidatePath = path.join(repoPath, candidate)
    if ((await pathExists(candidatePath)) && (await isMemeContainerDirectory(candidatePath))) {
      return candidate
    }
  }

  if (await isMemeContainerDirectory(repoPath)) {
    return "."
  }

  const entries = await fs.readdir(repoPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue
    }

    const nestedPath = path.join(repoPath, entry.name)
    if (await isMemeContainerDirectory(nestedPath)) {
      return entry.name
    }
  }

  return null
}

async function createDirectoryLink(target: string, linkPath: string) {
  if (process.platform === "win32") {
    await fs.symlink(target, linkPath, "junction")
    return
  }

  await fs.symlink(target, linkPath, "dir")
}

function getRepoDirectory(repoId: string) {
  return path.join(getReposDir(), repoId)
}

async function scanRepoFromDisk(repo: RepoConfig): Promise<RepoScanEntry> {
  const repoDir = getRepoDirectory(repo.id)
  const baseState = createRepoState(repo.id)

  if (!(await pathExists(repoDir))) {
    return {
      ...repo,
      ...baseState,
      localExists: false,
      status: "unsynced",
      statusMessage: "本地仓库目录不存在，等待同步",
      memeNames: [],
      memeRootPath: null,
    }
  }

  if (!(await isGitRepository(repoDir))) {
    return {
      ...repo,
      ...baseState,
      localExists: true,
      status: "error",
      statusMessage: "本地目录存在，但不是 Git 仓库",
      lastError: "本地目录存在，但没有 .git",
      memeNames: [],
      memeRootPath: null,
    }
  }

  const [commitHash, branchName] = await Promise.all([
    readGitOutputSafe(["rev-parse", "--short", "HEAD"], repoDir),
    readGitOutputSafe(["branch", "--show-current"], repoDir),
  ])

  const detectedRoot = repo.customMemeRoot || (await detectMemeRoot(repoDir))
  if (!detectedRoot) {
    return {
      ...repo,
      ...baseState,
      localExists: true,
      status: "error",
      statusMessage: "未找到可加载的表情根目录",
      lastCommitHash: commitHash,
      lastError: "未找到包含 meme 插件的目录",
      memeNames: [],
      memeRootPath: null,
    }
  }

  const memeRootPath = path.resolve(repoDir, detectedRoot)
  if (!(await pathExists(memeRootPath))) {
    return {
      ...repo,
      ...baseState,
      localExists: true,
      status: "error",
      statusMessage: `表情根目录不存在：${detectedRoot}`,
      memeRoot: detectedRoot,
      lastCommitHash: commitHash,
      lastError: `表情根目录不存在：${detectedRoot}`,
      memeNames: [],
      memeRootPath: null,
    }
  }

  const memeNames = await listMemeDirectoryNames(memeRootPath)
  return {
    ...repo,
    ...baseState,
    localExists: true,
    branch: branchName || repo.branch,
    status: "ready",
    statusMessage: repo.enabled ? "已从本地仓库感知" : "已停用，不写入共享目录",
    memeRoot: detectedRoot,
    lastCommitHash: commitHash,
    memeCount: memeNames.length,
    memeNames,
    memeRootPath,
  }
}

async function scanReposFromDisk(options: RepoScanOptions = {}) {
  const configStore = await readConfigStore()
  const scannedRepos = await Promise.all(configStore.repos.map((repo) => scanRepoFromDisk(repo)))
  const linkedNames = new Map<string, { repoId: string; repoName: string }>()

  for (const repo of scannedRepos) {
    repo.linkedMemeCount = 0
    repo.conflictCount = 0
    repo.conflicts = []
  }

  for (const repo of scannedRepos) {
    if (!repo.enabled || repo.status !== "ready") {
      continue
    }

    for (const memeName of repo.memeNames) {
      const existingOwner = linkedNames.get(memeName)
      if (existingOwner) {
        const conflict: MemeConflict = {
          memeName,
          ownerRepoId: existingOwner.repoId,
          ownerRepoName: existingOwner.repoName,
          conflictingRepoId: repo.id,
          conflictingRepoName: repo.name,
        }
        scannedRepos.find((item) => item.id === existingOwner.repoId)?.conflicts.push(conflict)
        repo.conflicts.push(conflict)
        continue
      }

      linkedNames.set(memeName, { repoId: repo.id, repoName: repo.name })
      repo.linkedMemeCount += 1
    }
  }

  for (const repo of scannedRepos) {
    repo.conflictCount = repo.conflicts.length
  }

  if (options.includeActiveJobs) {
    const jobs = await readJobStore()
    const activeJobs = jobs.jobs.filter((job) => job.status === "pending" || job.status === "running")
    for (const job of activeJobs) {
      if (!job.repoId) {
        continue
      }
      const repo = scannedRepos.find((item) => item.id === job.repoId)
      if (!repo) {
        continue
      }
      repo.status = job.type === "remove" ? "deleting" : "syncing"
      repo.statusMessage = job.message || (job.type === "remove" ? "正在删除仓库" : "正在执行任务")
      repo.lastJobId = job.id
    }
  }

  return scannedRepos
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return "未知错误"
}

function isCancelledError(error: unknown) {
  return error instanceof Error && error.message === "任务已取消"
}

async function triggerMemeApiReload(): Promise<ReloadResult> {
  const reloadUrl = getReloadUrl()
  if (reloadUrl) {
    const response = await fetch(reloadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "meme-manager-ui" }),
      cache: "no-store",
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(text || `重载请求失败，状态码 ${response.status}`)
    }

    return { mode: "url" }
  }

  const reloadCommand = getReloadCommand()
  if (reloadCommand) {
    await execAsync(reloadCommand, {
      windowsHide: true,
    })
    return { mode: "command" }
  }

  throw new Error("未配置 Meme API 重载方式")
}

async function maybeAutoReloadMemeApi(jobId?: string) {
  if (!isAutoReloadEnabled() || !isReloadConfigured()) {
    return
  }

  if (jobId) {
    await appendJobLog(jobId, "info", "开始自动重载 Meme API")
  }
  await triggerMemeApiReload()
  if (jobId) {
    await appendJobLog(jobId, "info", "自动重载 Meme API 完成")
  }
}

async function rebuildManagedMemes(jobId?: string) {
  const scannedRepos = await scanReposFromDisk()

  async function log(message: string) {
    if (jobId) {
      await appendJobLog(jobId, "info", message)
    }
  }

  await withWriteLock("rebuild", async () => {
    const managedDir = getManagedMemesDir()
    await log("清理旧的共享 meme 目录")
    await fs.rm(managedDir, { recursive: true, force: true })
    await ensureDir(managedDir)
    await log("开始重建共享 meme 目录")

    const linkedNames = new Map<string, { repoId: string; repoName: string }>()
    let conflictCount = 0

    for (const repo of scannedRepos) {
      if (repo.status !== "ready" || !repo.memeRoot || !repo.memeRootPath) {
        continue
      }

      await log(`扫描仓库 ${repo.name} 的表情目录：${repo.memeRoot}`)

      if (!repo.enabled) {
        await log(`仓库 ${repo.name} 已停用，统计 ${repo.memeNames.length} 个表情目录但不写入共享目录`)
        continue
      }

      for (const memeName of repo.memeNames) {
        const sourceDir = path.join(repo.memeRootPath, memeName)

        const existingOwner = linkedNames.get(memeName)
        if (existingOwner) {
          conflictCount += 1
          await log(`发现重名表情 ${memeName}: ${existingOwner.repoName} 已占用，跳过 ${repo.name}`)
          continue
        }

        linkedNames.set(memeName, { repoId: repo.id, repoName: repo.name })
        await createDirectoryLink(sourceDir, path.join(managedDir, memeName))
        await log(`已链接表情目录 ${memeName} <- ${repo.name}`)
      }
    }

    await log(`共享 meme 目录重建完成，共 ${linkedNames.size} 个表情目录，发现 ${conflictCount} 处冲突`)
  })
}

async function performSync(repo: RepoConfig, jobId?: string, signal?: AbortSignal): Promise<SyncTaskResult> {
  const repoDir = getRepoDirectory(repo.id)
  const remoteUrl = resolveRepoGitUrl(repo.url)
  let beforeHash: string | null = null
  const logs: string[] = []

  async function log(message: string) {
    logs.push(message)
    if (jobId) {
      await appendJobLog(jobId, "info", message)
    }
  }

  async function streamGit(args: string[], cwd?: string) {
    if (signal?.aborted) {
      throw new Error("任务已取消")
    }

    if (!jobId) {
      await runGit(args, cwd)
      return
    }

    await runGitStream(args, cwd, async (line, level) => {
      await appendJobLog(jobId, level, line)
    }, signal)
  }

  if (await isGitRepository(repoDir)) {
    await log(`更新远端地址为 ${remoteUrl}`)
    beforeHash = await readGitOutput(["rev-parse", "--short", "HEAD"], repoDir)
    await streamGit(["remote", "set-url", "origin", remoteUrl], repoDir)
    await log(`抓取分支 ${repo.branch}`)
    await streamGit(["fetch", "origin", repo.branch], repoDir)
    await log(`切换到分支 ${repo.branch}`)
    await streamGit(["checkout", repo.branch], repoDir)
    await log(`拉取最新提交 ${repo.branch}`)
    await streamGit(["pull", "--ff-only", "origin", repo.branch], repoDir)
  } else {
    if (await pathExists(repoDir)) {
      await log("检测到残留目录，先清理后重新拉取")
      await fs.rm(repoDir, { recursive: true, force: true })
    }

    try {
      await log(`克隆仓库 ${remoteUrl}`)
      await streamGit(["clone", "--branch", repo.branch, "--single-branch", remoteUrl, repoDir])
    } catch (error) {
      await fs.rm(repoDir, { recursive: true, force: true })
      throw error
    }
  }

  await log("识别表情根目录")
  const detectedRoot = repo.customMemeRoot || (await detectMemeRoot(repoDir))
  if (!detectedRoot) {
    throw new Error("没有找到可加载的 meme 根目录，请手动填写 Meme Root")
  }

  const afterHash = await readGitOutput(["rev-parse", "--short", "HEAD"], repoDir)
  await log(`识别结果：${detectedRoot}`)
  await log(`当前提交：${afterHash}`)

  return {
    updated: !beforeHash || beforeHash !== afterHash,
    commitHash: afterHash || null,
    memeRoot: detectedRoot,
    logs,
  }
}

function queueBackgroundTask(task: () => Promise<void>) {
  setTimeout(() => {
    void task()
  }, 0)
}

async function hasActiveRepoJob(repoId: string) {
  return activeRepoJobs.has(repoId)
}

export async function listRepos() {
  return scanReposFromDisk({ includeActiveJobs: true })
}

export async function getManagerSummary() {
  const repos = await listRepos()
  const totalMemeCount = repos.reduce((total, repo) => total + repo.memeCount, 0)
  const linkedMemeCount = repos.reduce((total, repo) => total + repo.linkedMemeCount, 0)
  const conflictCount = repos.reduce((total, repo) => total + repo.conflictCount, 0) / 2

  return {
    count: repos.length,
    totalMemeCount,
    linkedMemeCount,
    conflictCount,
    dataRoot: getDataRoot(),
    managedMemesDir: getManagedMemesDir(),
    memeGeneratorMemeDirsEnv: JSON.stringify([getManagedMemesDir()]),
    repoUrlPrefixConfigured: Boolean(getRepoUrlPrefix()),
    reloadConfigured: isReloadConfigured(),
    autoReloadEnabled: isAutoReloadEnabled(),
  }
}

export async function getDashboardData() {
  const repos = await listRepos()
  const totalMemeCount = repos.reduce((total, repo) => total + repo.memeCount, 0)
  const linkedMemeCount = repos.reduce((total, repo) => total + repo.linkedMemeCount, 0)
  const conflictCount = repos.reduce((total, repo) => total + repo.conflictCount, 0) / 2
  const summary = {
    count: repos.length,
    totalMemeCount,
    linkedMemeCount,
    conflictCount,
    dataRoot: getDataRoot(),
    managedMemesDir: getManagedMemesDir(),
    memeGeneratorMemeDirsEnv: JSON.stringify([getManagedMemesDir()]),
    repoUrlPrefixConfigured: Boolean(getRepoUrlPrefix()),
    reloadConfigured: isReloadConfigured(),
    autoReloadEnabled: isAutoReloadEnabled(),
  }
  const jobs = (await readJobStore()).jobs.slice(0, 12)
  return { repos, summary, jobs }
}

export async function addRepo(input: {
  url: string
  branch: string
  customMemeRoot?: string
}) {
  const url = input.url.trim()
  const branch = input.branch.trim() || "main"
  const customMemeRoot = input.customMemeRoot?.trim() || null

  if (!url) {
    throw new Error("Repository URL 不能为空")
  }

  const configStore = await readConfigStore()
  if (configStore.repos.some((repo) => repo.url === url)) {
    throw new Error("这个仓库已经添加过了")
  }

  const id = buildRepoId(url, new Set(configStore.repos.map((repo) => repo.id)))
  const repo = createRepoConfig({
    id,
    name: normalizeRepoName(url),
    url,
    branch,
    customMemeRoot,
  })

  configStore.repos.unshift(repo)
  await writeConfigStore(configStore)
  await rebuildManagedMemes()
  return repo
}

export async function requestRepoSync(repoId: string) {
  const configStore = await readConfigStore()
  const repo = configStore.repos.find((item) => item.id === repoId)
  if (!repo) {
    throw new Error("仓库不存在")
  }

  if (await hasActiveRepoJob(repoId)) {
    return { queued: false }
  }

  const job = await createJob({
    type: "sync",
    repoId: repo.id,
    repoName: repo.name,
    message: "等待同步仓库",
  })
  const controller = new AbortController()
  activeRepoJobs.set(repoId, job.id)
  activeJobControllers.set(job.id, controller)

  queueBackgroundTask(async () => {
    await withRepoLock(repoId, async () => {
      try {
        await startJob(job.id, `开始同步仓库 ${repo.name}`)
        const result = await performSync(repo, job.id, controller.signal)
        await appendJobLog(job.id, "info", "重建共享 meme 目录")
        await appendJobLog(job.id, "info", result.updated ? `同步完成，已更新到 ${result.commitHash || "最新提交"}` : "已是最新版本")
        await appendJobLog(job.id, "info", `识别根目录：${result.memeRoot}`)
        await rebuildManagedMemes(job.id)
        await maybeAutoReloadMemeApi(job.id)
        await finishJob(job.id, "succeeded", `同步完成：${repo.name}`)
      } catch (error) {
        if (isCancelledError(error)) {
          await finishJob(job.id, "cancelled", `已停止：${repo.name}`)
          return
        }
        await finishJob(job.id, "failed", `同步失败：${repo.name}`, formatError(error))
      } finally {
        if (activeRepoJobs.get(repoId) === job.id) {
          activeRepoJobs.delete(repoId)
        }
        activeJobControllers.delete(job.id)
      }
    })
  })

  return { queued: true, jobId: job.id }
}

export async function requestSyncAllRepos() {
  const job = await createJob({
    type: "sync_all",
    repoId: null,
    repoName: null,
    message: "等待全部同步",
  })
  await startJob(job.id, "开始批量同步仓库")
  const repos = await readConfigStore()
  let queuedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const repo of repos.repos) {
    try {
      const result = await requestRepoSync(repo.id)
      if (result.queued) {
        queuedCount += 1
        await appendJobLog(job.id, "info", `已加入队列：${repo.name}`)
      } else {
        skippedCount += 1
        await appendJobLog(job.id, "info", `跳过仓库：${repo.name}，已有任务正在执行`)
      }
    } catch (error) {
      failedCount += 1
      await appendJobLog(job.id, "error", `仓库入队失败：${repo.name}，${formatError(error)}`)
    }
  }
  await finishJob(job.id, "succeeded", `批量同步入队完成：${queuedCount} 个加入，${skippedCount} 个跳过，${failedCount} 个失败`)
  return { queued: queuedCount, skipped: skippedCount, failed: failedCount, jobId: job.id }
}

export async function toggleRepoEnabled(repoId: string) {
  const configStore = await readConfigStore()
  const index = configStore.repos.findIndex((repo) => repo.id === repoId)
  if (index === -1) {
    throw new Error("仓库不存在")
  }

  configStore.repos[index] = {
    ...configStore.repos[index],
    enabled: !configStore.repos[index].enabled,
  }
  await writeConfigStore(configStore)
  await rebuildManagedMemes()
  return configStore.repos[index]
}

export async function setRepoEnabled(repoId: string, enabled: boolean) {
  const configStore = await readConfigStore()
  const index = configStore.repos.findIndex((repo) => repo.id === repoId)
  if (index === -1) {
    throw new Error("仓库不存在")
  }

  configStore.repos[index] = {
    ...configStore.repos[index],
    enabled,
  }
  await writeConfigStore(configStore)
  await rebuildManagedMemes()
  await maybeAutoReloadMemeApi()
  return configStore.repos[index]
}

export async function requestRemoveRepo(repoId: string) {
  const configStore = await readConfigStore()
  const repo = configStore.repos.find((item) => item.id === repoId)
  if (!repo) {
    throw new Error("仓库不存在")
  }

  if (await hasActiveRepoJob(repoId)) {
    return { queued: false }
  }

  const job = await createJob({
    type: "remove",
    repoId: repo.id,
    repoName: repo.name,
    message: "等待删除仓库",
  })
  const controller = new AbortController()
  activeRepoJobs.set(repoId, job.id)
  activeJobControllers.set(job.id, controller)

  queueBackgroundTask(async () => {
    await withRepoLock(repoId, async () => {
      try {
        if (controller.signal.aborted) {
          throw new Error("任务已取消")
        }
        const repoDir = getRepoDirectory(repoId)
        const localExists = await pathExists(repoDir)
        await startJob(job.id, localExists ? `开始删除本地仓库 ${repo.name}` : `开始移除仓库记录 ${repo.name}`)

        if (localExists) {
          await fs.rm(repoDir, { recursive: true, force: true })
          await appendJobLog(job.id, "info", "已删除本地仓库目录，配置记录已保留")
        } else {
          const latestConfig = await readConfigStore()
          latestConfig.repos = latestConfig.repos.filter((item) => item.id !== repoId)
          await writeConfigStore(latestConfig)
          await appendJobLog(job.id, "info", "本地目录不存在，已移除仓库配置记录")
        }

        await rebuildManagedMemes(job.id)
        await maybeAutoReloadMemeApi(job.id)
        await finishJob(job.id, "succeeded", localExists ? `本地仓库已删除：${repo.name}` : `仓库记录已移除：${repo.name}`)
      } catch (error) {
        if (isCancelledError(error)) {
          await finishJob(job.id, "cancelled", `已停止：${repo.name}`)
          return
        }
        await finishJob(job.id, "failed", `删除失败：${repo.name}`, formatError(error))
      } finally {
        if (activeRepoJobs.get(repoId) === job.id) {
          activeRepoJobs.delete(repoId)
        }
        activeJobControllers.delete(job.id)
      }
    })
  })

  return { queued: true, jobId: job.id }
}

export async function updateRepoMemeRoot(repoId: string, memeRoot: string) {
  const cleanRoot = memeRoot.trim()
  if (!cleanRoot) {
    throw new Error("Meme Root 不能为空")
  }

  const configStore = await readConfigStore()
  const index = configStore.repos.findIndex((repo) => repo.id === repoId)
  if (index === -1) {
    throw new Error("仓库不存在")
  }

  configStore.repos[index] = {
    ...configStore.repos[index],
    customMemeRoot: cleanRoot,
  }
  await writeConfigStore(configStore)
  await rebuildManagedMemes()
  await maybeAutoReloadMemeApi()
}

export async function reloadMemeApi() {
  const job = await createJob({
    type: "reload",
    repoId: null,
    repoName: null,
    message: "等待重载 Meme API",
  })

  await startJob(job.id, "开始重载 Meme API")
  try {
    await appendJobLog(job.id, "info", "准备调用 Meme API reload")
    const result = await triggerMemeApiReload()
    await appendJobLog(job.id, "info", result.mode === "url" ? "已通过 URL 调用 reload" : "已通过命令调用 reload")
    await finishJob(job.id, "succeeded", "Meme API 重载完成")
    return { ...result, jobId: job.id }
  } catch (error) {
    await finishJob(job.id, "failed", "Meme API 重载失败", formatError(error))
    throw error
  }
}

export async function listJobs() {
  return (await readJobStore()).jobs.slice(0, 100)
}

export async function cancelJob(jobId: string) {
  const jobStore = await readJobStore()
  const job = jobStore.jobs.find((item) => item.id === jobId)
  if (!job) {
    throw new Error("任务不存在")
  }

  if (job.status !== "pending" && job.status !== "running") {
    return { cancelled: false, status: job.status }
  }

  const controller = activeJobControllers.get(jobId)
  if (controller) {
    await appendJobLog(jobId, "info", "收到停止请求，正在终止任务")
    controller.abort()
  } else {
    await finishJob(jobId, "cancelled", "已丢弃过期任务记录")
  }

  if (job.repoId && activeRepoJobs.get(job.repoId) === jobId) {
    activeRepoJobs.delete(job.repoId)
  }
  activeJobControllers.delete(jobId)

  return { cancelled: true }
}

export function subscribeJobEvents(listener: (event: JobEvent) => void) {
  jobEventBus.on("job", listener)
  return () => {
    jobEventBus.off("job", listener)
  }
}

export function getComposeExample() {
  const dataRoot = process.env.DATA_ROOT || "/data"
  const managedDir = path.posix.join(dataRoot.replace(/\\/g, "/"), "managed/memes")

  return `services:
  meme-generator:
    image: ghcr.io/memecrafters/meme-generator:latest
    ports:
      - "2233:2233"
    environment:
      MEME_DIRS: '["${managedDir}"]'
    volumes:
      - meme-data:${dataRoot}

  meme-manager-ui:
    image: ghcr.io/your-name/mememanager-ui:latest
    ports:
      - "3000:3000"
    environment:
      DATA_ROOT: ${dataRoot}
    volumes:
      - meme-data:${dataRoot}

volumes:
  meme-data:
`
}
