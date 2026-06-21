import { requestSyncAllRepos } from "@/lib/meme-manager"

export async function POST() {
  await requestSyncAllRepos()
  return Response.json({ ok: true }, { status: 202 })
}
