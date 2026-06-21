import { exec, execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

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
  recentLogs: RepoLogEntry[]
}

export type ManagedRepo = RepoConfig & RepoState

export type RepoLogEntry = {
  timestamp: string
  level: "info" | "error"
  message: string
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed"

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

type SyncTaskResult = SyncResult & {
  logs: string[]
}

type RepoConfigStore = {
  repos: RepoConfig[]
}

type RepoStateStore = {
  states: RepoState[]
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

function getStateFile() {
  return path.join(getStateDir(), "repos-state.json")
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
    recentLogs: [],
  }
}

function normalizeRepoState(state: RepoState): RepoState {
  return {
    ...state,
    statusMessage: state.statusMessage ?? null,
    memeRoot: state.memeRoot ?? null,
    lastSyncStartedAt: state.lastSyncStartedAt ?? null,
    lastSyncedAt: state.lastSyncedAt ?? null,
    lastSyncFinishedAt: state.lastSyncFinishedAt ?? null,
    lastCommitHash: state.lastCommitHash ?? null,
    lastError: state.lastError ?? null,
    deleteStartedAt: state.deleteStartedAt ?? null,
    lastJobId: state.lastJobId ?? null,
    recentLogs: Array.isArray(state.recentLogs) ? state.recentLogs : [],
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
    return JSON.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback
    }

    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
}

async function seedDefaultDataIfNeeded() {
  await ensureStorage()
  await ensureExampleConfig()

  const configPath = getConfigFile()
  const statePath = getStateFile()

  if ((await pathExists(configPath)) && (await pathExists(statePath))) {
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

  const states = repos.map((repo) => createRepoState(repo.id))

  if (!(await pathExists(configPath))) {
    await writeJsonFile(configPath, { repos })
  }

  if (!(await pathExists(statePath))) {
    await writeJsonFile(statePath, { states })
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

async function readStateStore(): Promise<RepoStateStore> {
  await seedDefaultDataIfNeeded()
  const parsed = await readJsonFile<RepoStateStore>(getStateFile(), { states: [] })
  return {
    states: Array.isArray(parsed.states) ? parsed.states.map((state) => normalizeRepoState(state)) : [],
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

async function writeStateStore(store: RepoStateStore) {
  await ensureStorage()
  await withWriteLock("state", async () => {
    await writeJsonFile(getStateFile(), store)
  })
}

async function writeJobStore(store: JobStore) {
  await ensureStorage()
  await withWriteLock("state", async () => {
    await writeJsonFile(getJobsFile(), store)
  })
}

async function getStores() {
  const [configStore, stateStore] = await Promise.all([readConfigStore(), readStateStore()])
  const stateMap = new Map(stateStore.states.map((state) => [state.repoId, state]))

  const states = configStore.repos.map((repo) => stateMap.get(repo.id) || createRepoState(repo.id))
  if (states.length !== stateStore.states.length) {
    await writeStateStore({ states })
  }

  return {
    configStore,
    stateStore: { states },
  }
}

async function saveStatePatch(repoId: string, patch: Partial<RepoState>) {
  const stateStore = await readStateStore()
  const index = stateStore.states.findIndex((state) => state.repoId === repoId)

  if (index === -1) {
    stateStore.states.push({
      ...createRepoState(repoId),
      ...patch,
      repoId,
    })
  } else {
    stateStore.states[index] = normalizeRepoState({
      ...stateStore.states[index],
      ...patch,
      repoId,
    })
  }

  await writeStateStore(stateStore)
}

async function pushRepoLog(repoId: string, level: "info" | "error", message: string) {
  const entry: RepoLogEntry = {
    timestamp: nowIso(),
    level,
    message,
  }

  const stateStore = await readStateStore()
  const index = stateStore.states.findIndex((state) => state.repoId === repoId)
  if (index === -1) {
    stateStore.states.push({
      ...createRepoState(repoId),
      recentLogs: [entry],
      repoId,
    })
  } else {
    const logs = [...(stateStore.states[index].recentLogs || []), entry].slice(-50)
    stateStore.states[index] = normalizeRepoState({
      ...stateStore.states[index],
      recentLogs: logs,
      repoId,
    })
  }

  await writeStateStore(stateStore)
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
  if (job.repoId) {
    await saveStatePatch(job.repoId, { lastJobId: job.id })
  }
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
  if (job.repoId) {
    await pushRepoLog(job.repoId, level, message)
  }
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

async function readGitOutput(args: string[], cwd?: string) {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  })
  return result.stdout.trim()
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

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return "未知错误"
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

async function maybeAutoReloadMemeApi() {
  if (!isAutoReloadEnabled() || !isReloadConfigured()) {
    return
  }

  await triggerMemeApiReload()
}

async function rebuildManagedMemes() {
  const { configStore, stateStore } = await getStores()
  const stateMap = new Map(stateStore.states.map((state) => [state.repoId, state]))

  await withWriteLock("rebuild", async () => {
    const managedDir = getManagedMemesDir()
    await fs.rm(managedDir, { recursive: true, force: true })
    await ensureDir(managedDir)

    const linkedNames = new Map<string, string>()

    for (const repo of configStore.repos) {
      const state = stateMap.get(repo.id)
      if (!repo.enabled || state?.status !== "ready" || !state.memeRoot) {
        continue
      }

      const repoDir = getRepoDirectory(repo.id)
      const memeRootPath = path.resolve(repoDir, state.memeRoot)
      if (!(await pathExists(memeRootPath))) {
        continue
      }

      const entries = await fs.readdir(memeRootPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) {
          continue
        }

        const sourceDir = path.join(memeRootPath, entry.name)
        const initFile = path.join(sourceDir, "__init__.py")
        if (!(await pathExists(initFile))) {
          continue
        }

        const existingOwner = linkedNames.get(entry.name)
        if (existingOwner) {
          throw new Error(`表情目录重名: ${entry.name} 同时存在于 ${existingOwner} 和 ${repo.name}`)
        }

        linkedNames.set(entry.name, repo.name)
        await createDirectoryLink(sourceDir, path.join(managedDir, entry.name))
      }
    }
  })
}

async function performSync(repo: RepoConfig, jobId?: string): Promise<SyncTaskResult> {
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

  if (await isGitRepository(repoDir)) {
    await log(`更新远端地址为 ${remoteUrl}`)
    beforeHash = await readGitOutput(["rev-parse", "--short", "HEAD"], repoDir)
    await runGit(["remote", "set-url", "origin", remoteUrl], repoDir)
    await log(`抓取分支 ${repo.branch}`)
    await runGit(["fetch", "origin", repo.branch], repoDir)
    await log(`切换到分支 ${repo.branch}`)
    await runGit(["checkout", repo.branch], repoDir)
    await log(`拉取最新提交 ${repo.branch}`)
    await runGit(["pull", "--ff-only", "origin", repo.branch], repoDir)
  } else {
    if (await pathExists(repoDir)) {
      await log("检测到残留目录，先清理后重新拉取")
      await fs.rm(repoDir, { recursive: true, force: true })
    }

    try {
      await log(`克隆仓库 ${remoteUrl}`)
      await runGit(["clone", "--branch", repo.branch, "--single-branch", remoteUrl, repoDir])
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

export async function listRepos() {
  const { configStore, stateStore } = await getStores()
  const stateMap = new Map(stateStore.states.map((state) => [state.repoId, state]))

  return configStore.repos.map((repo) => ({
    ...repo,
    ...(stateMap.get(repo.id) || createRepoState(repo.id)),
  }))
}

export async function getManagerSummary() {
  const repos = await listRepos()
  return {
    count: repos.length,
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
  const summary = await getManagerSummary()
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
  await saveStatePatch(repo.id, createRepoState(repo.id))
  await rebuildManagedMemes()
  return repo
}

export async function requestRepoSync(repoId: string) {
  const configStore = await readConfigStore()
  const repo = configStore.repos.find((item) => item.id === repoId)
  if (!repo) {
    throw new Error("仓库不存在")
  }

  const stateStore = await readStateStore()
  const currentState = stateStore.states.find((state) => state.repoId === repoId) || createRepoState(repoId)
  if (currentState.status === "syncing" || currentState.status === "deleting") {
    return { queued: false }
  }

  const job = await createJob({
    type: "sync",
    repoId: repo.id,
    repoName: repo.name,
    message: "等待同步仓库",
  })

  await saveStatePatch(repoId, {
    status: "syncing",
    statusMessage: "正在同步仓库",
    lastSyncStartedAt: nowIso(),
    lastError: null,
    deleteStartedAt: null,
    lastJobId: job.id,
  })

  queueBackgroundTask(async () => {
    await withRepoLock(repoId, async () => {
      try {
        await startJob(job.id, `开始同步仓库 ${repo.name}`)
        const result = await performSync(repo, job.id)
        const finishedAt = nowIso()
        await appendJobLog(job.id, "info", "重建共享 meme 目录")
        await saveStatePatch(repoId, {
          status: "ready",
          statusMessage: result.updated ? `同步完成，已更新到 ${result.commitHash || "最新提交"}` : "已是最新版本",
          memeRoot: result.memeRoot,
          lastCommitHash: result.commitHash,
          lastSyncedAt: finishedAt,
          lastSyncFinishedAt: finishedAt,
          lastError: null,
          recentLogs: [],
        })
        await rebuildManagedMemes()
        await appendJobLog(job.id, "info", "共享 meme 目录重建完成")
        await maybeAutoReloadMemeApi()
        await finishJob(job.id, "succeeded", `同步完成：${repo.name}`)
      } catch (error) {
        await saveStatePatch(repoId, {
          status: "error",
          statusMessage: "同步失败",
          lastSyncFinishedAt: nowIso(),
          lastError: formatError(error),
        })
        await finishJob(job.id, "failed", `同步失败：${repo.name}`, formatError(error))
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
  for (const repo of repos.repos) {
    await appendJobLog(job.id, "info", `加入队列：${repo.name}`)
    await requestRepoSync(repo.id)
  }
  await finishJob(job.id, "succeeded", "已将全部仓库加入同步队列")
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

  const stateStore = await readStateStore()
  const currentState = stateStore.states.find((state) => state.repoId === repoId) || createRepoState(repoId)
  if (currentState.status === "syncing" || currentState.status === "deleting") {
    return { queued: false }
  }

  const job = await createJob({
    type: "remove",
    repoId: repo.id,
    repoName: repo.name,
    message: "等待删除仓库",
  })

  await saveStatePatch(repoId, {
    status: "deleting",
    statusMessage: "正在删除仓库",
    deleteStartedAt: nowIso(),
    lastError: null,
    lastJobId: job.id,
  })

  queueBackgroundTask(async () => {
    await withRepoLock(repoId, async () => {
      try {
        await startJob(job.id, `开始删除仓库 ${repo.name}`)
        const latestConfig = await readConfigStore()
        latestConfig.repos = latestConfig.repos.filter((item) => item.id !== repoId)
        await writeConfigStore(latestConfig)
        await appendJobLog(job.id, "info", "已移除仓库配置")

        const latestState = await readStateStore()
        latestState.states = latestState.states.filter((item) => item.repoId !== repoId)
        await writeStateStore(latestState)
        await appendJobLog(job.id, "info", "已移除仓库状态")

        await fs.rm(getRepoDirectory(repoId), { recursive: true, force: true })
        await appendJobLog(job.id, "info", "已删除本地仓库目录")
        await rebuildManagedMemes()
        await appendJobLog(job.id, "info", "共享 meme 目录重建完成")
        await maybeAutoReloadMemeApi()
        await finishJob(job.id, "succeeded", `删除完成：${repo.name}`)
      } catch (error) {
        await saveStatePatch(repoId, {
          status: "error",
          statusMessage: "删除失败",
          deleteStartedAt: null,
          lastError: formatError(error),
        })
        await finishJob(job.id, "failed", `删除失败：${repo.name}`, formatError(error))
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
  await saveStatePatch(repoId, {
    memeRoot: cleanRoot,
    statusMessage: "Meme Root 已更新，请重新同步",
    lastError: null,
  })
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
    const result = await triggerMemeApiReload()
    await finishJob(job.id, "succeeded", "Meme API 重载完成")
    return { ...result, jobId: job.id }
  } catch (error) {
    await finishJob(job.id, "failed", "Meme API 重载失败", formatError(error))
    throw error
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
