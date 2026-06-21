import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

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
}

export type ManagedRepo = RepoConfig & RepoState

type RepoConfigStore = {
  repos: RepoConfig[]
}

type RepoStateStore = {
  states: RepoState[]
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

function normalizeRepoName(url: string) {
  const repoName = url.split("/").filter(Boolean).pop() || "repo"
  return repoName.replace(/\.git$/i, "")
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

async function runGit(args: string[], cwd?: string) {
  await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  })
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

async function performSync(repo: RepoConfig): Promise<SyncResult> {
  const repoDir = getRepoDirectory(repo.id)
  let beforeHash: string | null = null

  if (await isGitRepository(repoDir)) {
    beforeHash = await readGitOutput(["rev-parse", "--short", "HEAD"], repoDir)
    await runGit(["fetch", "origin", repo.branch], repoDir)
    await runGit(["checkout", repo.branch], repoDir)
    await runGit(["pull", "--ff-only", "origin", repo.branch], repoDir)
  } else {
    if (await pathExists(repoDir)) {
      await fs.rm(repoDir, { recursive: true, force: true })
    }

    try {
      await runGit(["clone", "--branch", repo.branch, "--single-branch", repo.url, repoDir])
    } catch (error) {
      await fs.rm(repoDir, { recursive: true, force: true })
      throw error
    }
  }

  const detectedRoot = repo.customMemeRoot || (await detectMemeRoot(repoDir))
  if (!detectedRoot) {
    throw new Error("没有找到可加载的 meme 根目录，请手动填写 Meme Root")
  }

  const afterHash = await readGitOutput(["rev-parse", "--short", "HEAD"], repoDir)

  return {
    updated: !beforeHash || beforeHash !== afterHash,
    commitHash: afterHash || null,
    memeRoot: detectedRoot,
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
  }
}

export async function getDashboardData() {
  const repos = await listRepos()
  const summary = await getManagerSummary()
  return { repos, summary }
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

  await saveStatePatch(repoId, {
    status: "syncing",
    statusMessage: "正在同步仓库",
    lastSyncStartedAt: nowIso(),
    lastError: null,
    deleteStartedAt: null,
  })

  queueBackgroundTask(async () => {
    await withRepoLock(repoId, async () => {
      try {
        const result = await performSync(repo)
        const finishedAt = nowIso()
        await saveStatePatch(repoId, {
          status: "ready",
          statusMessage: result.updated ? `同步完成，已更新到 ${result.commitHash || "最新提交"}` : "已是最新版本",
          memeRoot: result.memeRoot,
          lastCommitHash: result.commitHash,
          lastSyncedAt: finishedAt,
          lastSyncFinishedAt: finishedAt,
          lastError: null,
        })
        await rebuildManagedMemes()
      } catch (error) {
        await saveStatePatch(repoId, {
          status: "error",
          statusMessage: "同步失败",
          lastSyncFinishedAt: nowIso(),
          lastError: formatError(error),
        })
      }
    })
  })

  return { queued: true }
}

export async function requestSyncAllRepos() {
  const repos = await readConfigStore()
  for (const repo of repos.repos) {
    await requestRepoSync(repo.id)
  }
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

  await saveStatePatch(repoId, {
    status: "deleting",
    statusMessage: "正在删除仓库",
    deleteStartedAt: nowIso(),
    lastError: null,
  })

  queueBackgroundTask(async () => {
    await withRepoLock(repoId, async () => {
      try {
        const latestConfig = await readConfigStore()
        latestConfig.repos = latestConfig.repos.filter((item) => item.id !== repoId)
        await writeConfigStore(latestConfig)

        const latestState = await readStateStore()
        latestState.states = latestState.states.filter((item) => item.repoId !== repoId)
        await writeStateStore(latestState)

        await fs.rm(getRepoDirectory(repoId), { recursive: true, force: true })
        await rebuildManagedMemes()
      } catch (error) {
        await saveStatePatch(repoId, {
          status: "error",
          statusMessage: "删除失败",
          deleteStartedAt: null,
          lastError: formatError(error),
        })
      }
    })
  })

  return { queued: true }
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
