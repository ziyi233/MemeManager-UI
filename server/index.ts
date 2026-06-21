import Fastify from "fastify"
import cors from "@fastify/cors"

import {
  addRepo,
  getDashboardData,
  listJobs,
  reloadMemeApi,
  requestRemoveRepo,
  requestRepoSync,
  requestSyncAllRepos,
  setRepoEnabled,
  subscribeJobEvents,
  updateRepoMemeRoot,
} from "../src/lib/meme-manager"

const port = Number(process.env.SERVER_PORT || 3001)
const host = process.env.SERVER_HOST || "127.0.0.1"

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: true,
})

app.get("/health", async () => {
  return {
    status: "ok",
    name: "meme-manager-server",
    timestamp: new Date().toISOString(),
  }
})

app.get("/repos", async () => {
  return getDashboardData()
})

app.get("/jobs", async () => {
  return { jobs: await listJobs() }
})

app.get("/events", async (_request, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })

  reply.raw.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)

  const unsubscribe = subscribeJobEvents((event) => {
    reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  })

  const heartbeat = setInterval(() => {
    reply.raw.write("event: ping\ndata: {}\n\n")
  }, 15000)

  reply.raw.on("close", () => {
    clearInterval(heartbeat)
    unsubscribe()
    reply.raw.end()
  })

  return reply.hijack()
})

app.post("/repos", async (request, reply) => {
  const body = (request.body || {}) as {
    url?: string
    branch?: string
    customMemeRoot?: string
  }

  const repo = await addRepo({
    url: body.url || "",
    branch: body.branch || "main",
    customMemeRoot: body.customMemeRoot || "",
  })

  return reply.code(201).send({ ok: true, repo })
})

app.post("/repos/sync-all", async (_request, reply) => {
  await requestSyncAllRepos()
  return reply.code(202).send({ ok: true })
})

app.post("/repos/:repoId/sync", async (request, reply) => {
  const { repoId } = request.params as { repoId: string }
  const result = await requestRepoSync(repoId)
  return reply.code(202).send(result)
})

app.patch("/repos/:repoId", async (request, reply) => {
  const { repoId } = request.params as { repoId: string }
  const body = (request.body || {}) as {
    enabled?: boolean
    customMemeRoot?: string
  }

  if (typeof body.customMemeRoot === "string") {
    await updateRepoMemeRoot(repoId, body.customMemeRoot)
    return { ok: true }
  }

  if (typeof body.enabled === "boolean") {
    await setRepoEnabled(repoId, body.enabled)
    return { ok: true }
  }

  return reply.code(400).send({ error: "无效请求" })
})

app.delete("/repos/:repoId", async (request, reply) => {
  const { repoId } = request.params as { repoId: string }
  const result = await requestRemoveRepo(repoId)
  return reply.code(202).send(result)
})

app.post("/meme-api/reload", async (_request, reply) => {
  try {
    const result = await reloadMemeApi()
    return { ok: true, ...result }
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "重载失败",
    })
  }
})

app.listen({ host, port }).catch((error) => {
  app.log.error(error)
  process.exit(1)
})
